import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './lib/env.js';
import { authRouter } from './api/auth.routes.js';
import { xeroRouter } from './api/xero.routes.js';
import { dashboardRouter } from './api/dashboard.routes.js';
import { tenantsRouter } from './api/tenants.routes.js';
import { telemetryRouter, analyticsRouter } from './api/telemetry.routes.js';
import { bootScheduler } from './scheduler/index.js';
import { apiLimiter, syncLimiter } from './middleware/rateLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Trust proxy so rate limiter sees real client IPs behind Railway/nginx
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

// Global rate limit on all API routes (120 req/min per IP)
app.use('/api', apiLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV, time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/xero', xeroRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/admin/analytics', analyticsRouter);

// ---- Serve frontend in production ----------------------------------------
// In production the Vite build output sits at ../frontend/dist relative to the
// backend source root (two levels up from dist/index.js).
if (env.NODE_ENV === 'production') {
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist, { maxAge: '30d', immutable: true }));
  // SPA fallback: any non-API route serves index.html so React Router works.
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  // Dev: 404 for unknown routes (frontend runs on Vite dev server)
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
}

// Bind to 0.0.0.0 in production so Railway's healthcheck can reach the
// container - the default 'localhost' only listens on loopback.
const HOST = env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';
const server = app.listen(env.PORT, HOST, async () => {
  console.log(`[server] listening on http://${HOST}:${env.PORT}`);
  try {
    await bootScheduler();
  } catch (e) {
    console.error('[server] scheduler boot failed:', e);
  }
});

process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received, closing');
  server.close(() => process.exit(0));
});

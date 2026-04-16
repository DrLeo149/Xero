import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './lib/env.js';
import { authRouter } from './api/auth.routes.js';
import { xeroRouter } from './api/xero.routes.js';
import { dashboardRouter } from './api/dashboard.routes.js';
import { tenantsRouter } from './api/tenants.routes.js';
import { telemetryRouter, analyticsRouter } from './api/telemetry.routes.js';
import { bootScheduler } from './scheduler/index.js';

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV, time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/xero', xeroRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/admin/analytics', analyticsRouter);

// 404 fallback
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

const server = app.listen(env.PORT, async () => {
  console.log(`[server] listening on http://localhost:${env.PORT}`);
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

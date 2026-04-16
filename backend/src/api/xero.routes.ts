import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { env, xeroConfigured } from '../lib/env.js';
import { newXeroClient } from '../xero/client.js';
import { requireAuth, requireRole, resolveTenant } from '../middleware/auth.js';
import { runSync } from '../xero/sync.js';

export const xeroRouter = Router();

/**
 * In-memory store of pending OAuth state → tenantId.
 * Small and short-lived; acceptable for a single-process app.
 * Each entry expires after 10 minutes.
 */
const pendingStates = new Map<string, { tenantId: string; userId: string; expiresAt: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingStates) if (v.expiresAt < now) pendingStates.delete(k);
}, 60_000).unref();

/**
 * GET /api/xero/connect?tenantId=...
 * Admin (or client for their own tenant) kicks off OAuth.
 * Returns the Xero consent URL the frontend should redirect the user to.
 */
xeroRouter.get('/connect', requireAuth, resolveTenant(true), async (req, res) => {
  if (!xeroConfigured) {
    return res.status(503).json({
      error: 'Xero is not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in backend/.env',
    });
  }

  const tenantId = req.tenantId!;
  // Clients can only connect their own tenant (enforced by resolveTenant, redundant check)
  if (req.user!.role === 'client' && req.user!.tenantId !== tenantId) {
    return res.status(403).json({ error: 'Cannot connect Xero for another tenant' });
  }

  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, {
    tenantId,
    userId: req.user!.sub,
    expiresAt: Date.now() + 10 * 60_000,
  });

  const client = newXeroClient();
  await client.initialize();
  const consentUrl = await client.buildConsentUrl();
  // Inject our state into the Xero URL
  const url = new URL(consentUrl);
  url.searchParams.set('state', state);
  console.log('[xero connect] consent URL:', url.toString());
  console.log('[xero connect] scope param:', url.searchParams.get('scope'));
  res.json({ url: url.toString() });
});

/**
 * GET /api/xero/callback?code=...&state=...
 * Xero redirects here after user approves. We exchange the code for tokens,
 * fetch the list of connected orgs, and store the connection.
 *
 * Because the browser hits this URL directly (not our SPA), we redirect back
 * to the frontend with a success/error flag after writing to DB.
 */
xeroRouter.get('/callback', async (req, res) => {
  const { state, error: xeroErr } = req.query as Record<string, string>;
  if (xeroErr) {
    return res.redirect(`${env.FRONTEND_URL}/settings?xero=error&msg=${encodeURIComponent(xeroErr)}`);
  }
  if (!state || !pendingStates.has(state)) {
    return res.redirect(`${env.FRONTEND_URL}/settings?xero=error&msg=invalid_state`);
  }
  const pending = pendingStates.get(state)!;
  pendingStates.delete(state);

  try {
    const client = newXeroClient();
    // xero-node validates state via this.config.state - supply our verified state
    (client as any).config.state = state;
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const tokenSet = await client.apiCallback(fullUrl);
    await client.updateTenants(false);

    const xeroTenant = client.tenants?.[0];
    if (!xeroTenant) throw new Error('No Xero organisation returned after consent');

    await prisma.xeroConnection.upsert({
      where: { tenantId: pending.tenantId },
      create: {
        tenantId: pending.tenantId,
        xeroTenantId: xeroTenant.tenantId,
        orgName: xeroTenant.tenantName ?? 'Unknown',
        accessToken: tokenSet.access_token!,
        refreshToken: tokenSet.refresh_token!,
        expiresAt: new Date((tokenSet.expires_at ?? Math.floor(Date.now() / 1000) + 1800) * 1000),
        scopes: env.XERO_SCOPES,
        connectedBy: pending.userId,
      },
      update: {
        xeroTenantId: xeroTenant.tenantId,
        orgName: xeroTenant.tenantName ?? 'Unknown',
        accessToken: tokenSet.access_token!,
        refreshToken: tokenSet.refresh_token!,
        expiresAt: new Date((tokenSet.expires_at ?? Math.floor(Date.now() / 1000) + 1800) * 1000),
        scopes: env.XERO_SCOPES,
        connectedBy: pending.userId,
        connectedAt: new Date(),
      },
    });

    res.redirect(`${env.FRONTEND_URL}/settings?xero=connected`);
  } catch (e: any) {
    console.error('[xero callback]', e);
    res.redirect(`${env.FRONTEND_URL}/settings?xero=error&msg=${encodeURIComponent(e.message ?? 'unknown')}`);
  }
});

/** POST /api/xero/sync - trigger a manual sync for the current tenant */
xeroRouter.post('/sync', requireAuth, resolveTenant(true), async (req, res) => {
  const tenantId = req.tenantId!;
  try {
    const log = await runSync(tenantId, 'manual');
    res.json(log);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/xero/status - connection status for the current tenant */
xeroRouter.get('/status', requireAuth, resolveTenant(true), async (req, res) => {
  const conn = await prisma.xeroConnection.findUnique({ where: { tenantId: req.tenantId! } });
  const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId! } });
  res.json({
    connected: !!conn,
    orgName: conn?.orgName ?? null,
    connectedAt: conn?.connectedAt ?? null,
    lastSyncedAt: tenant?.lastSyncedAt ?? null,
    refreshCron: tenant?.refreshCron ?? null,
  });
});

/** DELETE /api/xero/disconnect - admin only */
xeroRouter.delete('/disconnect', requireAuth, requireRole('admin'), resolveTenant(true), async (req, res) => {
  await prisma.xeroConnection.deleteMany({ where: { tenantId: req.tenantId! } });
  res.json({ ok: true });
});

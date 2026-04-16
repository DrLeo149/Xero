import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import { env, xeroConfigured } from '../lib/env.js';
import { newXeroClient } from '../xero/client.js';
import { signJwt } from '../auth/jwt.js';
import { requireAuth, requireRole, resolveTenant } from '../middleware/auth.js';
import { runSync } from '../xero/sync.js';

export const xeroRouter = Router();

/**
 * In-memory store of pending OAuth state.
 * Two flavours:
 *   - "connect": admin/client linking Xero to an existing tenant (has tenantId + userId)
 *   - "signup":  anonymous user signing up via Xero (no tenantId/userId yet)
 */
interface PendingConnect { kind: 'connect'; tenantId: string; userId: string; expiresAt: number }
interface PendingSignup { kind: 'signup'; expiresAt: number }
type PendingState = PendingConnect | PendingSignup;

const pendingStates = new Map<string, PendingState>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingStates) if (v.expiresAt < now) pendingStates.delete(k);
}, 60_000).unref();

/**
 * GET /api/xero/signup
 * Anonymous - no login required. Starts OAuth flow that will auto-create
 * a user + tenant on callback. This is the main self-serve entry point.
 */
xeroRouter.get('/signup', async (_req, res) => {
  if (!xeroConfigured) {
    return res.status(503).json({
      error: 'Xero is not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET in backend/.env',
    });
  }

  const state = crypto.randomBytes(24).toString('hex');
  pendingStates.set(state, { kind: 'signup', expiresAt: Date.now() + 10 * 60_000 });

  const client = newXeroClient();
  await client.initialize();
  const consentUrl = await client.buildConsentUrl();
  const url = new URL(consentUrl);
  url.searchParams.set('state', state);
  // Redirect the browser directly to Xero (called as a full page navigation)
  res.redirect(url.toString());
});

/**
 * GET /api/xero/connect?tenantId=...
 * Admin (or client for their own tenant) kicks off OAuth for an existing tenant.
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
    kind: 'connect',
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
 * Xero redirects here after user approves. Two flows:
 *
 *   1. "connect" - existing user linking Xero to their tenant. Stores tokens,
 *      redirects to /settings.
 *
 *   2. "signup" - anonymous user. Auto-creates tenant + user from Xero profile,
 *      issues a JWT, and redirects to the dashboard with the token in a
 *      short-lived fragment so the SPA can pick it up.
 */
xeroRouter.get('/callback', async (req, res) => {
  const { state, error: xeroErr } = req.query as Record<string, string>;
  if (xeroErr) {
    return res.redirect(`${env.FRONTEND_URL}/login?xero=error&msg=${encodeURIComponent(xeroErr)}`);
  }
  if (!state || !pendingStates.has(state)) {
    return res.redirect(`${env.FRONTEND_URL}/login?xero=error&msg=invalid_state`);
  }
  const pending = pendingStates.get(state)!;
  pendingStates.delete(state);

  try {
    const client = newXeroClient();
    (client as any).config.state = state;
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const tokenSet = await client.apiCallback(fullUrl);
    await client.updateTenants(false);

    const xeroTenant = client.tenants?.[0];
    if (!xeroTenant) throw new Error('No Xero organisation returned after consent');

    const tokenData = {
      xeroTenantId: xeroTenant.tenantId,
      orgName: xeroTenant.tenantName ?? 'Unknown',
      accessToken: tokenSet.access_token!,
      refreshToken: tokenSet.refresh_token!,
      expiresAt: new Date((tokenSet.expires_at ?? Math.floor(Date.now() / 1000) + 1800) * 1000),
      scopes: env.XERO_SCOPES,
    };

    // ---- Flow 1: existing-user connect ----
    if (pending.kind === 'connect') {
      await prisma.xeroConnection.upsert({
        where: { tenantId: pending.tenantId },
        create: { ...tokenData, tenantId: pending.tenantId, connectedBy: pending.userId },
        update: { ...tokenData, connectedBy: pending.userId, connectedAt: new Date() },
      });
      return res.redirect(`${env.FRONTEND_URL}/settings?xero=connected`);
    }

    // ---- Flow 2: self-serve signup ----
    // Get the user's email from the id_token claims
    const idClaims = tokenSet.claims?.() ?? {} as any;
    const email = (idClaims.email as string | undefined)?.toLowerCase();
    if (!email) throw new Error('Xero did not return an email. Make sure openid+email scopes are granted.');

    // Check if this user already exists (returning user)
    let user = await prisma.user.findUnique({ where: { email } });

    if (user && user.tenantId) {
      // Returning user - update Xero tokens and log them in
      await prisma.xeroConnection.upsert({
        where: { tenantId: user.tenantId },
        create: { ...tokenData, tenantId: user.tenantId, connectedBy: user.id },
        update: { ...tokenData, connectedBy: user.id, connectedAt: new Date() },
      });
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

      const jwt = signJwt({
        sub: user.id,
        email: user.email,
        role: user.role as 'admin' | 'client',
        tenantId: user.tenantId,
      });
      return res.redirect(`${env.FRONTEND_URL}/auth/callback#token=${jwt}`);
    }

    // Brand new user - create tenant + user + xero connection in one transaction
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { companyName: xeroTenant.tenantName ?? email.split('@')[0] },
      });

      const newUser = await tx.user.create({
        data: {
          email,
          name: (idClaims.name as string) ?? (idClaims.given_name as string) ?? null,
          passwordHash: '', // no password - Xero-only auth
          role: 'client',
          tenantId: tenant.id,
          lastLoginAt: new Date(),
        },
      });

      await tx.xeroConnection.create({
        data: { ...tokenData, tenantId: tenant.id, connectedBy: newUser.id },
      });

      return { tenant, user: newUser };
    });

    const jwt = signJwt({
      sub: result.user.id,
      email: result.user.email,
      role: 'client',
      tenantId: result.tenant.id,
    });

    // Kick off first sync in the background (don't await)
    runSync(result.tenant.id, 'initial').catch((e) =>
      console.error('[signup] initial sync failed:', e.message),
    );

    return res.redirect(`${env.FRONTEND_URL}/auth/callback#token=${jwt}`);
  } catch (e: any) {
    console.error('[xero callback]', e);
    res.redirect(`${env.FRONTEND_URL}/login?xero=error&msg=${encodeURIComponent(e.message ?? 'unknown')}`);
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

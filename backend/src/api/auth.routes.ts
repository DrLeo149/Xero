import { Router } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import {
  signAccessToken,
  createRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
} from '../auth/jwt.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/** POST /auth/login - email + password (admin login) */
authRouter.post('/login', authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role as 'admin' | 'client',
    tenantId: user.tenantId,
  });
  const refreshToken = await createRefreshToken(user.id);

  res.json({
    token,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    },
  });
});

/**
 * POST /auth/refresh - exchange a refresh token for a new access + refresh pair.
 * The old refresh token is consumed (single-use rotation).
 */
const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post('/refresh', authLimiter, async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Missing refresh token' });

  const result = await rotateRefreshToken(parsed.data.refreshToken);
  if (!result) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const user = await prisma.user.findUnique({ where: { id: result.userId } });
  if (!user) return res.status(401).json({ error: 'User not found' });

  const token = signAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role as 'admin' | 'client',
    tenantId: user.tenantId,
  });

  res.json({
    token,
    refreshToken: result.newToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    },
  });
});

/** POST /auth/logout - revoke all refresh tokens for the user */
authRouter.post('/logout', requireAuth, async (req, res) => {
  await revokeAllRefreshTokens(req.user!.sub);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
  });
});

/** PATCH /auth/me - update the current user's display name */
const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(80).nullable(),
});
authRouter.patch('/me', requireAuth, async (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid name' });
  const updated = await prisma.user.update({
    where: { id: req.user!.sub },
    data: { name: parsed.data.name },
  });
  res.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    tenantId: updated.tenantId,
  });
});

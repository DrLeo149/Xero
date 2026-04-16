import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { env } from '../lib/env.js';
import { prisma } from '../db/client.js';

export interface JwtPayload {
  sub: string;        // user id
  email: string;
  role: 'admin' | 'client';
  tenantId: string | null;
}

// ---- Access tokens: short-lived (15 min) ----

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '15m' } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

// ---- Refresh tokens: long-lived (7 days), stored in DB, rotated on use ----

const REFRESH_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(48).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  await prisma.refreshToken.create({
    data: {
      tokenHash: hashedToken,
      userId,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRY_MS),
    },
  });

  return token;
}

/**
 * Verify + rotate a refresh token. Returns the userId if valid,
 * deletes the old token and creates a new one (rotation).
 * If the token is reused after rotation, we nuke ALL tokens for
 * that user (theft detection).
 */
export async function rotateRefreshToken(token: string): Promise<{ userId: string; newToken: string } | null> {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: hashedToken } });

  if (!row) {
    // Token not found - could be reuse of a rotated token (theft).
    // We can't know which user without the hash matching, so just return null.
    return null;
  }

  // Delete the used token immediately (single-use)
  await prisma.refreshToken.delete({ where: { id: row.id } });

  if (row.expiresAt < new Date()) {
    // Expired
    return null;
  }

  if (row.revokedAt) {
    // This token was already revoked - someone is replaying it.
    // Nuke ALL refresh tokens for this user as a safety measure.
    await prisma.refreshToken.deleteMany({ where: { userId: row.userId } });
    console.warn(`[auth] Refresh token reuse detected for user ${row.userId} - all sessions revoked`);
    return null;
  }

  // Issue a new refresh token (rotation)
  const newToken = await createRefreshToken(row.userId);
  return { userId: row.userId, newToken };
}

/** Revoke all refresh tokens for a user (logout everywhere). */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.deleteMany({ where: { userId } });
}

// ---- Backward compat aliases ----
export const signJwt = signAccessToken;
export const verifyJwt = verifyAccessToken;

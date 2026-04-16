import jwt from 'jsonwebtoken';
import { env } from '../lib/env.js';

export interface JwtPayload {
  sub: string;        // user id
  email: string;
  role: 'admin' | 'client';
  tenantId: string | null;
}

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyJwt(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

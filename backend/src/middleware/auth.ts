import { Request, Response, NextFunction } from 'express';
import { verifyJwt, JwtPayload } from '../auth/jwt.js';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  try {
    req.user = verifyJwt(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: Array<'admin' | 'client'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

/**
 * Tenant scope: resolves the effective tenantId for this request.
 * - Clients: always pinned to their own tenantId from JWT.
 * - Admins: may supply ?tenantId=... (or X-Tenant-Id header) to operate on a specific tenant.
 * Attaches `req.tenantId`. If no tenant resolvable and one is required, returns 400.
 */
declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

export function resolveTenant(required = true) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

    if (req.user.role === 'client') {
      if (!req.user.tenantId) return res.status(403).json({ error: 'Client user has no tenant' });
      req.tenantId = req.user.tenantId;
      return next();
    }

    // Admin
    const explicit = (req.query.tenantId as string) || (req.headers['x-tenant-id'] as string);
    if (explicit) {
      req.tenantId = explicit;
      return next();
    }
    if (required) {
      return res.status(400).json({ error: 'Admin must specify tenantId (query or X-Tenant-Id header)' });
    }
    next();
  };
}

import rateLimit from 'express-rate-limit';

/**
 * Rate limiters - layered defense against brute force and abuse.
 *
 * Three tiers:
 *   1. authLimiter  - login/signup endpoints: 10 req / 15 min per IP
 *   2. apiLimiter   - general API: 120 req / min per IP
 *   3. syncLimiter  - manual refresh: 5 req / 5 min per IP (Xero rate limits)
 */

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                     // 10 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: false,
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,        // 1 minute
  max: 120,                    // 120 requests
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Slow down.' },
});

export const syncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,    // 5 minutes
  max: 5,                      // 5 syncs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sync requests. Wait a few minutes.' },
});

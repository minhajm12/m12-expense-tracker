import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Global rate limiter for all general API endpoints.
 * Configured generously in development to allow rich UI navigations and data sync,
 * while defending production from denial-of-service and abusive scraping.
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'production' ? 2000 : 10000, // 2,000 req/15min in prod, 10,000 in dev
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req: Request) => {
    if (env.NODE_ENV === 'test') return true;
    // Skip health and readiness checks
    if (req.path === '/health' || req.path === '/live' || req.path === '/ready') return true;
    return false;
  },
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP address. Please try again after a few minutes.',
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  },
});

/**
 * Strict rate limiter for sensitive authentication endpoints (login, register, reset password).
 * Defends against brute-force credential stuffing and password dictionary attacks.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.NODE_ENV === 'production' ? 25 : 100, // 25 attempts/15min in prod, 100 in dev
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (req: Request, res: Response) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts. For your security, this IP has been temporarily throttled. Please try again after 15 minutes.',
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  },
});

import { Request, Response, NextFunction } from 'express';
import { cacheGet, cacheSet } from '../lib/cache';
import { normaliseToCacheKey } from '../lib/normalise';

/**
 * Cache middleware for profile list/search endpoints.
 *
 * Usage: router.get('/profiles', cacheMiddleware, profilesHandler)
 *
 * Flow:
 *  1. Extract query params → normalise → generate cache key
 *  2. Check Redis — if hit, return immediately (no DB call)
 *  3. If miss, call next() and intercept res.json() to store the result
 *
 * Why intercept res.json()?
 * This lets us add caching to existing route handlers without modifying
 * them. The handler runs normally; we just store what it produces.
 */
export function cacheMiddleware(req: Request, res: Response, next: NextFunction) {
  // Only cache successful GET requests
  if (req.method !== 'GET') return next();

  const filters = req.query as Record<string, string>;
  const cacheKey = normaliseToCacheKey(filters);

  cacheGet(cacheKey).then((cached) => {
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(JSON.parse(cached));
    }

    // Cache miss — intercept res.json to store the result
    res.setHeader('X-Cache', 'MISS');
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheSet(cacheKey, JSON.stringify(body)).catch((err) =>
          console.error('[cache middleware] set error:', err)
        );
      }
      return originalJson(body);
    };

    next();
  }).catch(() => {
    // If Redis is down, proceed without caching — never block a request
    next();
  });
}

import { createClient } from 'redis';

/**
 * Redis cache layer.
 *
 * Why Redis?
 * Analyst query patterns are highly repetitive — the same demographic
 * filter combinations are explored multiple times within a session and
 * across teams. A 5-minute TTL cache means any query repeated within
 * that window costs ~1ms (Redis) instead of ~200-800ms (Postgres full scan).
 *
 * If REDIS_URL is not set (local dev without Redis), all cache operations
 * are silently no-ops so the app still works — it just won't cache.
 */

let client: ReturnType<typeof createClient> | null = null;
let connected = false;

async function getClient() {
  if (!process.env.REDIS_URL) return null;

  if (!client) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('[redis] error:', err));
    await client.connect();
    connected = true;
  }

  return client;
}

const CACHE_TTL_SECONDS = 300; // 5 minutes — balances freshness vs hit rate

export async function cacheGet(key: string): Promise<string | null> {
  try {
    const c = await getClient();
    if (!c) return null;
    return await c.get(key);
  } catch (err) {
    console.error('[cache] get error:', err);
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttl = CACHE_TTL_SECONDS): Promise<void> {
  try {
    const c = await getClient();
    if (!c) return;
    await c.set(key, value, { EX: ttl });
  } catch (err) {
    console.error('[cache] set error:', err);
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const c = await getClient();
    if (!c) return;
    await c.del(key);
  } catch (err) {
    console.error('[cache] del error:', err);
  }
}

/**
 * Invalidate all keys matching a pattern.
 * Used after bulk ingestion to flush stale query results.
 * pattern example: 'query:*'
 */
export async function cacheFlushPattern(pattern: string): Promise<void> {
  try {
    const c = await getClient();
    if (!c) return;
    let cursor = 0;
    do {
      const reply = await (c as any).scan(cursor, { MATCH: pattern, COUNT: 100 });
      cursor = reply.cursor;
      if (reply.keys.length > 0) {
        await c.del(reply.keys);
      }
    } while (cursor !== 0);
  } catch (err) {
    console.error('[cache] flush error:', err);
  }
}

/**
 * Forge Intelligence — KV-backed feed cache.
 *
 * Replaces the upstream module-level cache singletons (per-isolate,
 * reset on cold start, and a `setInterval` that leaks on serverless) with a
 * KV-backed cache that is shared across isolates and survives cold starts.
 *
 * Two tiers: a short-lived FRESH entry (the poll interval) and a long-lived
 * STALE entry, so a transient upstream failure degrades to last-known-good
 * data instead of an empty layer — the resilience the singletons faked but
 * couldn't deliver on serverless.
 */

import { kv } from "@/lib/kv";
import { logger } from "@/lib/logger";

export interface CachedResult<T> {
  data: T;
  /** true when served from the fresh or stale cache rather than freshly produced. */
  cached: boolean;
  stale?: boolean;
}

export async function cachedJson<T>(
  key: string,
  freshTtlSeconds: number,
  producer: () => Promise<T>,
  opts: { staleTtlSeconds?: number } = {},
): Promise<CachedResult<T>> {
  const freshKey = `fi:cache:${key}`;
  const staleKey = `fi:cache:stale:${key}`;
  const staleTtl = opts.staleTtlSeconds ?? Math.max(freshTtlSeconds * 20, 3600);

  try {
    const hit = await kv.get<T>(freshKey);
    if (hit != null) return { data: hit, cached: true };
  } catch {
    /* KV read miss/error → fall through to producer */
  }

  try {
    const data = await producer();
    await Promise.allSettled([
      kv.set(freshKey, data, { ex: freshTtlSeconds }),
      kv.set(staleKey, data, { ex: staleTtl }),
    ]);
    return { data, cached: false };
  } catch (err) {
    // Upstream failed — serve last-known-good if we have it.
    try {
      const stale = await kv.get<T>(staleKey);
      if (stale != null) {
        logger.warn("[intel-cache] serving stale after producer failure", {
          key,
          error: err instanceof Error ? err.message : String(err),
        });
        return { data: stale, cached: true, stale: true };
      }
    } catch {
      /* ignore stale-read error; rethrow the original */
    }
    throw err;
  }
}

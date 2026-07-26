/**
 * Per-endpoint rate limiting.
 *
 * Ported from the host platform, with one deliberate behavioural difference:
 * the host limiter fails OPEN on a KV error, because a KV outage there would
 * take down every product surface at once. Here the aggressive RECON buckets
 * fail CLOSED — this app's whole point is that its sharp tools stay gated, and
 * a cache outage is not a reason to unlock them. Feed buckets still fail open,
 * because refusing public feeds during a cache blip helps nobody.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { kv } from "@/lib/kv";
import { logger } from "@/lib/logger";

interface RateLimitConfig {
  limit: number;
  windowSeconds: number;
  /** Refuse requests when the backing store is unavailable. */
  failClosed?: boolean;
}

const LIMITS: Record<string, RateLimitConfig> = {
  // Feed proxies. Per-minute and roomy: the console fires a burst when layers
  // toggle, and each response is cached, so real upstream load stays low.
  "intel-feed": { limit: 120, windowSeconds: 60 },
  // Passive and aggressive RECON. Tight, and gated at the handler too.
  "intel-recon": { limit: 20, windowSeconds: 3600, failClosed: true },
  // AI analyst — cost-bounded.
  "intel-ai": { limit: 20, windowSeconds: 3600, failClosed: true },
};

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function checkRateLimit(
  endpoint: string,
  identifier: string,
): Promise<NextResponse | null> {
  const config = LIMITS[endpoint];
  if (!config) return null;

  const key = `fi:ratelimit:${endpoint}:${identifier}`;
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;

  try {
    const pipeline = await kv.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zadd(key, { score: now, member: `${now}:${Math.random().toString(36).slice(2, 10)}` });
    pipeline.expire(key, config.windowSeconds);
    const results = await pipeline.exec();
    const currentCount = (results[1] as number) ?? 0;

    if (currentCount >= config.limit) {
      const retryAfter = Math.ceil(config.windowSeconds / 2);
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later.", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    return null;
  } catch (err) {
    logger.error("[rate-limit] store error", {
      endpoint,
      error: err instanceof Error ? err.message : String(err),
    });
    if (config.failClosed) {
      return NextResponse.json(
        {
          error: "rate_limiter_unavailable",
          detail: "This tool is gated behind a rate limiter that is currently unreachable.",
        },
        { status: 503 },
      );
    }
    return null;
  }
}

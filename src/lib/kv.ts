/**
 * Key-value store used by the feed cache (`fi:cache:*`).
 *
 * Driver resolution:
 *   REDIS_URL set  → Redis (ioredis)
 *   otherwise      → in-process memory
 *
 * The memory driver is genuinely usable: every cached value is a feed response
 * that can be re-fetched, so losing the cache on restart costs latency and
 * nothing else. That is what lets this app run with zero infrastructure.
 * Multi-instance deployments should set REDIS_URL so the cache is shared and
 * rate-limit counters are global.
 */

/**
 * Signature note: `get` is generic and `set` takes an `{ ex }` options object,
 * because that is the contract the copied code was written against. Values are
 * stored as parsed objects in memory and JSON in Redis, so callers get their
 * type back either way.
 */
interface PipelineClient {
  zremrangebyscore(key: string, min: number, max: number): PipelineClient;
  zcard(key: string): PipelineClient;
  zadd(key: string, entry: { score: number; member: string }): PipelineClient;
  expire(key: string, seconds: number): PipelineClient;
  exec(): Promise<unknown[]>;
}

interface KVClient {
  get<T = string>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  pipeline(): PipelineClient;
}

function memoryClient(): KVClient {
  const store = new Map<string, { value: unknown; expiresAt?: number }>();
  const zsets = new Map<string, Array<{ score: number; member: string }>>();

  return {
    async get<T = string>(key: string): Promise<T | null> {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value as T;
    },
    async set(key, value, options) {
      store.set(key, {
        value,
        expiresAt: options?.ex ? Date.now() + options.ex * 1000 : undefined,
      });
    },
    async del(key) {
      store.delete(key);
    },
    pipeline(): PipelineClient {
      const ops: Array<() => unknown> = [];
      const api: PipelineClient = {
        zremrangebyscore(key, min, max) {
          ops.push(() => {
            const rows = zsets.get(key) ?? [];
            zsets.set(
              key,
              rows.filter((r) => r.score < min || r.score > max),
            );
          });
          return api;
        },
        zcard(key) {
          ops.push(() => (zsets.get(key) ?? []).length);
          return api;
        },
        zadd(key, entry) {
          ops.push(() => zsets.set(key, [...(zsets.get(key) ?? []), entry]));
          return api;
        },
        expire() {
          // Memory entries carry their own expiry.
          ops.push(() => undefined);
          return api;
        },
        async exec() {
          return ops.map((op) => op());
        },
      };
      return api;
    },
  };
}

function redisClient(url: string): KVClient {
  // Required lazily so the memory path never loads the Redis driver.

  const { Redis } = require("ioredis") as typeof import("ioredis");
  const redis = new Redis(url);

  return {
    async get<T = string>(key: string): Promise<T | null> {
      const raw = await redis.get(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    },
    async set(key, value, options) {
      const raw = typeof value === "string" ? value : JSON.stringify(value);
      if (options?.ex) await redis.set(key, raw, "EX", options.ex);
      else await redis.set(key, raw);
    },
    async del(key) {
      await redis.del(key);
    },
    pipeline(): PipelineClient {
      const p = redis.pipeline();
      const api: PipelineClient = {
        zremrangebyscore(key, min, max) {
          p.zremrangebyscore(key, min, max);
          return api;
        },
        zcard(key) {
          p.zcard(key);
          return api;
        },
        zadd(key, entry) {
          p.zadd(key, entry.score, entry.member);
          return api;
        },
        expire(key, seconds) {
          p.expire(key, seconds);
          return api;
        },
        async exec() {
          const results = await p.exec();
          // ioredis returns [err, value] tuples; the callers want the values.
          return (results ?? []).map(([, value]) => value);
        },
      };
      return api;
    },
  };
}

let client: KVClient | null = null;

function resolve(): KVClient {
  if (client) return client;
  const url = process.env.REDIS_URL;
  client = url ? redisClient(url) : memoryClient();
  return client;
}

export const kv: KVClient = {
  get: <T = string>(key: string) => resolve().get<T>(key),
  set: (key, value, options) => resolve().set(key, value, options),
  del: (key) => resolve().del(key),
  pipeline: () => resolve().pipeline(),
};

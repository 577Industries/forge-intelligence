/**
 * Forge Intelligence — honest attributed fetch.
 *
 * Replaces the upstream Osiris `stealthFetch`, which spoofed
 * X-Forwarded-For / User-Agent to evade upstream rate limits. On shared 577i
 * infra that would poison egress-IP reputation and risk bans that take down
 * billing / portal / cfraw. This helper does the opposite: one honest,
 * attributed User-Agent, a hard timeout, and respect for upstream limits.
 */

export const FI_USER_AGENT =
  "ForgeIntelligence/1.0 (+https://577industries.com)";

export interface FiFetchInit extends RequestInit {
  /** Hard abort after this many ms (default 10s). Ignored if `signal` is set. */
  timeoutMs?: number;
}

export async function fiFetch(
  url: string,
  init: FiFetchInit = {},
): Promise<Response> {
  const { timeoutMs = 10_000, headers, signal, ...rest } = init;
  return fetch(url, {
    ...rest,
    signal: signal ?? AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": FI_USER_AGENT, ...headers },
  });
}

export async function fiFetchJson<T = unknown>(
  url: string,
  init: FiFetchInit = {},
): Promise<T> {
  const res = await fiFetch(url, init);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function fiFetchText(
  url: string,
  init: FiFetchInit = {},
): Promise<string> {
  const res = await fiFetch(url, init);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  return res.text();
}

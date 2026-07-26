/**
 * Forge Intelligence — SSRF egress guard.
 *
 * Every RECON/OSINT route turns a user-supplied host into a network request,
 * so this is the security boundary for the whole toolkit. It hardens two real
 * gaps in the upstream Osiris guard:
 *
 *  1. IPv6 bypass — upstream matched blocked ranges with raw string
 *     `startsWith` and no canonicalization, so an expanded literal like
 *     `0:0:0:0:0:0:0:1` (loopback) or `0:0:0:0:0:ffff:7f00:1` (IPv4-mapped
 *     loopback) slipped straight through. Here IPv6 is parsed to a 128-bit
 *     integer and range-checked numerically, and IPv4-mapped addresses are
 *     unwrapped and re-checked against the IPv4 denylist.
 *
 *  2. DNS-rebinding TOCTOU — upstream validated the hostname then called
 *     plain `fetch()`, which re-resolves at connect time; a TTL=0 rebinder
 *     could pass validation and then connect to 169.254.169.254 (live on
 *     Vercel/AWS). Here the validated IP is PINNED at the socket layer via an
 *     undici dispatcher whose `lookup` can only ever return that address, so
 *     the connection cannot land anywhere else.
 *
 * Redirects are followed manually with every hop re-validated and re-pinned.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { Agent, request as undiciRequest } from "undici";

import { FI_USER_AGENT } from "./fetch";

// ── IPv4 ────────────────────────────────────────────────────────────────

const IPV4_BLOCKS: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local incl. 169.254.169.254 cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

export function ipv4ToInt(ip: string): number {
  const p = ip.split(".").map(Number);
  return p[0] * 0x1000000 + p[1] * 0x10000 + p[2] * 0x100 + p[3];
}

/**
 * Canonical dotted-quad only. Decimal (`2130706433`), hex (`0x7f.0.0.1`) and
 * octal (`0177.0.0.1`) forms are rejected outright rather than coerced — the
 * kernel would resolve them, so accepting them is a bypass.
 */
export function parseIPv4(s: string): string | null {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) return null;
  const parts = s.split(".").map(Number);
  if (parts.some((n) => n < 0 || n > 255 || !Number.isInteger(n))) return null;
  return parts.join(".");
}

export function ipv4Blocked(ip: string): boolean {
  const v = ipv4ToInt(ip);
  for (const [net, bits] of IPV4_BLOCKS) {
    const size = Math.pow(2, 32 - bits);
    if (Math.floor(v / size) === Math.floor(ipv4ToInt(net) / size)) return true;
  }
  return false;
}

// ── IPv6 ────────────────────────────────────────────────────────────────

/** Parse any valid IPv6 textual form (compressed, expanded, IPv4-mapped) to a 128-bit int. */
export function parseIPv6(input: string): bigint | null {
  let s = input.trim().replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!s.includes(":")) return null;

  // Unwrap a trailing dotted-quad (e.g. ::ffff:127.0.0.1) into two hex groups.
  const v4m = s.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (v4m) {
    const v4 = parseIPv4(v4m[1]);
    if (!v4) return null;
    const n = ipv4ToInt(v4);
    const hi = (n >>> 16) & 0xffff;
    const lo = n & 0xffff;
    s = s.slice(0, s.length - v4m[1].length) + hi.toString(16) + ":" + lo.toString(16);
  }

  const dbl = s.split("::");
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(":") : [];
  const tail = dbl.length === 2 ? (dbl[1] ? dbl[1].split(":") : []) : [];
  let groups: string[];
  if (dbl.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  let value = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    value = (value << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return value;
}

function inV6Range(value: bigint, baseHex: string, prefixLen: number): boolean {
  const base = parseIPv6(baseHex);
  if (base === null) return false;
  const shift = BigInt(128 - prefixLen);
  return value >> shift === base >> shift;
}

/** True if the 128-bit address is in a reserved/internal range. */
export function ipv6Blocked(value: bigint): boolean {
  if (value === BigInt(0)) return true; // ::
  if (value === BigInt(1)) return true; // ::1 loopback

  // IPv4-mapped ::ffff:0:0/96 — unwrap and apply the IPv4 denylist.
  if (inV6Range(value, "::ffff:0:0", 96)) {
    const v4 = Number(value & BigInt(0xffffffff));
    const dotted = [
      (v4 >>> 24) & 0xff,
      (v4 >>> 16) & 0xff,
      (v4 >>> 8) & 0xff,
      v4 & 0xff,
    ].join(".");
    return ipv4Blocked(dotted);
  }

  return (
    inV6Range(value, "64:ff9b::", 96) || // NAT64
    inV6Range(value, "100::", 64) || // discard
    inV6Range(value, "2001:db8::", 32) || // documentation
    inV6Range(value, "fc00::", 7) || // unique-local
    inV6Range(value, "fe80::", 10) || // link-local
    inV6Range(value, "ff00::", 8) // multicast
  );
}

// ── Hostname validation ─────────────────────────────────────────────────

const NAME_BLOCKLIST = [
  /^localhost$/i,
  /\.localhost$/i,
  /^host\.docker\.internal$/i,
  /\.local$/i,
  /\.internal$/i,
  /^metadata\.google\.internal$/i,
];

const HOSTNAME_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  /** Validated addresses safe to connect to (literal input or DNS answers). */
  ips?: string[];
}

export function isAddressBlocked(addr: string): boolean {
  const fam = isIP(addr);
  if (fam === 4) {
    const c = parseIPv4(addr);
    return c === null || ipv4Blocked(c);
  }
  if (fam === 6) {
    const v = parseIPv6(addr);
    return v === null || ipv6Blocked(v);
  }
  return true; // not an IP → caller shouldn't be connecting to it
}

/**
 * Validate that `host` (IP literal or hostname) is a safe egress target.
 * Returns the concrete addresses to pin the socket to.
 */
export async function validateHost(host: string): Promise<ValidationResult> {
  const trimmed = host.trim();
  if (!trimmed) return { ok: false, reason: "empty host" };
  const bare = trimmed.replace(/^\[|\]$/g, "");

  if (NAME_BLOCKLIST.some((re) => re.test(trimmed.toLowerCase()))) {
    return { ok: false, reason: "hostname matches a reserved name pattern" };
  }

  const fam = isIP(bare);
  if (fam === 4) {
    const c = parseIPv4(bare);
    if (!c) return { ok: false, reason: "non-canonical IPv4 form rejected" };
    if (ipv4Blocked(c)) return { ok: false, reason: "IPv4 in a reserved range" };
    return { ok: true, ips: [c] };
  }
  if (fam === 6) {
    const v = parseIPv6(bare);
    if (v === null) return { ok: false, reason: "unparseable IPv6" };
    if (ipv6Blocked(v)) return { ok: false, reason: "IPv6 in a reserved range" };
    return { ok: true, ips: [bare] };
  }

  if (!HOSTNAME_RE.test(trimmed)) {
    return { ok: false, reason: "invalid hostname syntax" };
  }

  let answers: Array<{ address: string; family: number }>;
  try {
    answers = await dnsLookup(trimmed, { all: true });
  } catch (err) {
    return { ok: false, reason: `DNS lookup failed: ${(err as Error).message}` };
  }
  if (!answers.length) return { ok: false, reason: "host has no A/AAAA records" };

  for (const a of answers) {
    if (isAddressBlocked(a.address)) {
      return { ok: false, reason: `host resolves to a reserved address (${a.address})` };
    }
  }
  return { ok: true, ips: answers.map((a) => a.address) };
}

// ── Pinned, redirect-safe fetch ─────────────────────────────────────────

export interface SafeResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
}

/** Dispatcher whose DNS lookup can only ever return the pre-validated IP. */
function pinnedDispatcher(ip: string): Agent {
  return new Agent({
    connect: {
      lookup: (
        _hostname: string,
        _options: unknown,
        cb: (err: Error | null, address: string, family: number) => void,
      ) => cb(null, ip, isIP(ip) === 6 ? 6 : 4),
    },
  });
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
  /** Optional per-feature egress allowlist (exact host or ".suffix" match). */
  allowHosts?: string[];
}

function hostAllowed(hostname: string, allow?: string[]): boolean {
  if (!allow?.length) return true;
  const h = hostname.toLowerCase();
  return allow.some((a) => {
    const s = a.toLowerCase();
    return h === s || h.endsWith(`.${s}`);
  });
}

/**
 * Fetch with the target validated AND socket-pinned to the validated IP, so a
 * rebind between check and connect cannot redirect us to internal space.
 * Redirects are followed manually and each hop is re-validated + re-pinned.
 */
export async function safeFetch(
  inputUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const { timeoutMs = 10_000, maxRedirects = 3, allowHosts } = opts;
  let current = inputUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      throw new Error("safeFetch: invalid URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`safeFetch: blocked protocol ${url.protocol}`);
    }
    if (!hostAllowed(url.hostname, allowHosts)) {
      throw new Error("safeFetch: host not in the feature allowlist");
    }

    const check = await validateHost(url.hostname);
    if (!check.ok || !check.ips?.length) {
      throw new Error(`safeFetch: blocked target — ${check.reason}`);
    }

    const dispatcher = pinnedDispatcher(check.ips[0]);
    try {
      const res = await undiciRequest(url.toString(), {
        method: (opts.method ?? "GET") as "GET",
        headers: { "user-agent": FI_USER_AGENT, ...opts.headers },
        dispatcher,
        // undici's request() does not follow redirects — we handle each hop
        // ourselves so every target is re-validated and re-pinned.
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });

      if (res.statusCode >= 300 && res.statusCode < 400) {
        const loc = res.headers.location;
        const locStr = Array.isArray(loc) ? loc[0] : loc;
        if (!locStr) {
          return {
            status: res.statusCode,
            headers: res.headers,
            text: () => res.body.text(),
            json: <T,>() => res.body.json() as Promise<T>,
          };
        }
        // Drain so the socket can be released before the next hop.
        await res.body.dump();
        current = new URL(locStr, url).toString();
        continue;
      }

      return {
        status: res.statusCode,
        headers: res.headers,
        text: () => res.body.text(),
        json: <T,>() => res.body.json() as Promise<T>,
      };
    } finally {
      void dispatcher.close().catch(() => {});
    }
  }
  throw new Error("safeFetch: too many redirects");
}

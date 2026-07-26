# Forge Intelligence — security posture

An OSINT console is an unusually attractive target: it fetches attacker-
influenced URLs, renders attacker-influenced text, and offers tools that can
be pointed at third parties. This document records the controls, and — where
the fork fixes real upstream vulnerabilities — what was wrong and why.

## Egress guard (SSRF)

`src/lib/intelligence/ssrf-guard.ts` is the single choke point for any fetch
whose destination is influenced by user input. It fixes **two exploitable
flaws** carried by the upstream implementation.

### 1. IPv6 literals bypassed the private-range check

The upstream compared address strings by prefix, so `::1` was blocked but its
fully-expanded equivalent `0:0:0:0:0:0:0:1` was not — the same loopback
address written differently walked straight through. Compressed forms,
IPv4-mapped addresses (`::ffff:127.0.0.1`) and zero-padded groups all had the
same property.

The guard now parses IPv6 to a 128-bit integer and range-checks numerically,
so every textual spelling of an address collapses to one value:

```ts
// range checks are arithmetic, not textual
if (v6 >= LOOPBACK_START && v6 <= LOOPBACK_END) return blocked("loopback");
```

### 2. DNS rebinding between validation and fetch

Validating a hostname and then calling `fetch()` on that hostname resolves DNS
**twice**. An attacker controlling the authoritative server can answer the
first query with a public address and the second with `169.254.169.254` — the
check passes and the request still reaches cloud instance metadata. This is a
time-of-check/time-of-use bug, and it is not fixable by validating harder.

`safeFetch` closes it by pinning the *validated IP* at the socket layer, so
the connection cannot land anywhere else:

```ts
function pinnedDispatcher(ip: string): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, cb) => cb(null, ip, isIP(ip) === 6 ? 6 : 4),
    },
  });
}
```

Blocked ranges: loopback, private (RFC 1918), link-local (including the
cloud-metadata address), carrier-grade NAT, multicast, reserved, and the IPv6
equivalents of each. Covered by 51 unit tests.

### Removed: `stealthFetch`

The upstream shipped a fetch wrapper that rotated forged `X-Forwarded-For`
headers and browser User-Agents to evade upstream rate limits. Forge
Intelligence identifies itself honestly on every request:

```
ForgeIntelligence/1.0 (+https://577industries.com)
```

Evading a data provider's rate limit is both a terms violation and an
integrity problem — an operator cannot trust intelligence gathered by a client
that lies about who it is.

## RECON access control — blast-radius tiers

`src/lib/intelligence/access.ts`. The proxy does **not** authenticate
`/api/intelligence/*`, so each aggressive handler enforces this itself.

| Tier | Tools | Control |
|---|---|---|
| **Passive** | DNS, RDAP/WHOIS, IP intel, BGP, certificates, CVE, sanctions | Open (demo tier), rate-limited. Reads public registries; never contacts the target. |
| **Aggressive** | Shodan exposure, breach lookup, port scanning | Authenticated 577i session **required**, tighter rate limit, and an audit entry naming operator and target. |

The split is by legal exposure, not by how interesting the data is: scanning
implicates CFAA-class law, and breach lookups are third-party personal data in
GDPR/CCPA territory. Breach lookup additionally demands an explicit purpose
declaration, because it doubles as an email-enumeration oracle.

Active scanning ships **unconfigured** and returns 503 until an operator
supplies a backend — see [operations.md](operations.md#active-scanning).

## Cross-site scripting

Map popups are built as HTML and handed to MapLibre's `setHTML`, and every
interpolated value originates in a third-party feed — USGS place names, GDELT
headlines, ADS-B callsigns. That is a genuine injection sink across a trust
boundary.

All popup content goes through `esc()` in `src/intelligence/lib/popups.ts`.
The module is deliberately split out of the map component so the escaping is
unit-testable; the suite includes a hostile-content case asserting that no
renderer leaks raw markup.

## Content Security Policy and the tile proxy

The app's CSP (`buildCsp()` in `src/proxy.ts`) sets `connect-src 'self'`, so
the browser cannot reach external origins at all. Rather than widen it, the
console routes basemap traffic through a same-origin proxy:

- `/api/intelligence/tiles` accepts only an allowlist of basemap hosts
  (`cartocdn.com`, `arcgisonline.com`, `openfreemap.org`). The upstream
  exposed an open `?url=` parameter, which is an SSRF primitive by
  construction.
- `frame-src` is widened for `youtube-nocookie.com` / `youtube.com` **only**,
  so broadcasts play through the broadcaster's official player. No stream is
  proxied or re-hosted.

## Subsystem isolation

The console is scoped to `.fi-root` (`src/app/intelligence/intelligence.css`)
and mounts inside its own route segment. It does not mutate `html`/`body`
globals, and its design tokens cannot leak into the rest of the app — the same
containment rule the cfraw subsystem follows.

The console route is `robots: noindex`; the public `/intelligence` marketing
page is the indexable surface.

## Rate limiting

Every route sits behind a dedicated bucket via `checkRateLimit`. Aggressive
RECON tools get tighter buckets than feeds.

The shared limiter **fails open** on KV error (`src/lib/onboard/rate-limit.ts`):
a KV outage would otherwise take down every feed at once, so availability is
preferred over enforcement. Rate limiting is therefore a cost and abuse control,
not a security boundary — the aggressive RECON tools never rely on it alone.
They are gated by `requireOperator()`, which fails closed because it depends on
session verification rather than on KV.

## What this fork does not do

- No IP or User-Agent spoofing.
- No re-serving of third-party video, camera imagery or copyrighted media.
- No scanning of third-party infrastructure out of the box.
- No fabricated data points anywhere — an unavailable source reports as
  unavailable.

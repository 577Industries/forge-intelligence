# Forge Intelligence — operations

Activation paths for the capabilities that need an operator decision, plus the
routine runbook. The console works with none of these configured — everything
below unlocks an addition.

Step-by-step activation for each optional provider — including what it
costs and what it obliges us to display — is in
[provider-activation.md](provider-activation.md).

## Environment matrix

| Variable | Unlocks | Without it |
|---|---|---|
| `FI_ANALYST_MODEL` | Overrides the analyst model | Defaults to `google/gemini-3.7-flash` via the AI gateway |
| `EIA_API_KEY` | Energy quotes from the EIA | `/api/intelligence/markets` returns 503 |
| `FI_MARKETS_URL` | Points the ticker at a quote source | Ticker carries intelligence data, no quotes |
| `FI_GEOIP_URL` | Coordinates on RECON IP lookups | RDAP network data without geolocation |
| `NVD_API_KEY` | CVE rate limit 5 → 50 req/30s | Lower limit; lookups still work |
| `SHODAN_API_KEY` | Host-exposure lookups via the licensed Shodan host API | RECON Shodan tool returns 503 `shodan_unconfigured` |
| `FI_BREACH_LICENSED` | Breach-exposure lookups, attesting a provider licence | RECON Leaks tool returns 503 `breach_lookup_unlicensed` |
| `SCANNER_URL` / `SCANNER_KEY` | Active port scanning | Scanner returns 503 |
| `FI_SCANNER_DISABLED_TYPES` | Blocks named scan profiles | All profiles the backend offers are permitted |

None of these fabricate data when unset — see [data-sources.md](data-sources.md).

## Geo-IP (self-hosted MaxMind GeoLite2)

RECON IP lookups return RDAP registry data by default. Coordinates require a
geolocation database.

**Why self-hosted:** the commercial-friendly free options are either
non-commercial (ip-api.com) or per-query metered. GeoLite2 is free for
commercial use and the City database is a few hundred MB — too large for a
serverless bundle, which is why it belongs on the VPS rather than in Next.

Activation:

1. Create a free MaxMind account and generate a licence key.
2. On your server, install `geoipupdate` with that key and a weekly cron
   (GeoLite2 is re-issued on Tuesdays; a stale database silently degrades
   accuracy rather than failing).
3. Serve a small HTTP wrapper behind the existing Traefik, exposing
   `/geoip/{ip}` and returning `{ lat, lng, city, country }`.
4. Set `FI_GEOIP_URL="https://geoip.internal.example/geoip/{ip}"`.
   The `{ip}` token is substituted per lookup — `osint/ip/route.ts` already
   merges the response, so no application change is needed.
5. **Licence obligation:** GeoLite2 requires visible attribution wherever the
   data is displayed. Surface it in the RECON IP panel.

## Energy quotes

1. Request a free API key at <https://www.eia.gov/opendata/>.
2. Set `EIA_API_KEY`.
3. Set `FI_MARKETS_URL` to this deployment's own markets route
   (`https://<host>/api/intelligence/markets`).

The route serves WTI, Brent, Gulf Coast gasoline and diesel spot prices with a
session-over-session change percentage, cached 30 minutes fresh / 24 hours
stale. Spot prices settle once per business day, so the cache is far finer
than the data actually moves. A single failing series is dropped rather than
blanking the ticker.

## Active scanning

**Read this before enabling.** Port scanning infrastructure you do not own or
have written authorisation to test is unlawful in most jurisdictions
(CFAA-class exposure in the US, Computer Misuse Act in the UK, and equivalents
elsewhere). The capability ships wired but unconfigured, and returns 503 until
a backend exists.

Preconditions:

1. A defined engagement scope with **written** authorisation from the asset
   owner.
2. A scanning backend you operate, exposed to the app as `SCANNER_URL`. If
   `SCANNER_KEY` is set it is appended as a `?key=` **query parameter**, not a
   bearer header — so treat it as log-visible and scope it accordingly.
3. `FI_SCANNER_DISABLED_TYPES` set to block profiles outside the engagement.
   The valid profile names are exactly `quick`, `ssl`, `headers`, `rdns`,
   `tech` and `vuln`; naming anything else silently disables nothing.

The endpoint already requires an authenticated operator and writes an audit
entry naming operator and target on every invocation — see
[security.md](security.md#recon-access-control--blast-radius-tiers). Those
controls are necessary but not sufficient; authorisation is a legal
precondition the software cannot verify for you.

## Layer refresh cadences

Declared per layer in `src/intelligence/lib/layers.ts` (`refreshMs`) and
derived into `REFRESH_MS_BY_DOMAIN`, which takes the **fastest** cadence among
layers sharing an endpoint so a sub-toggle is never starved.

| Cadence | Layers |
|---|---|
| 20s | Satellites (positions are propagated per request) |
| 45s | Aircraft (military airframes + 7700 emergency squawks) |
| 5m | Seismic, conflict zones, cyber activity, GDELT news intel |
| 15m | Active fires, severe weather, solar weather |
| never | Ports, chokepoints, CCTV networks, broadcasters, infrastructure |

Polling only runs for enabled layers, and stops entirely while the tab is
hidden — revealing it refreshes anything that went stale, then resumes. Server
KV TTLs sit under these cadences, so most polls hit warm cache.

To change a cadence, edit the layer's `refreshMs`; nothing else needs to know.

## Routine checks

- **A layer shows no data.** Call its route directly
  (`/api/intelligence/<domain>`). Routes fail closed and report the upstream
  failure rather than emitting an empty success.
- **Rate-limit 503s in local production mode.** `next start` runs as
  `NODE_ENV=production`, where the KV driver refuses to fall back to memory
  and the limiter fails closed. Set `FORGE_ALLOW_KV_MEMORY_IN_PROD=1` for
  local prod-mode runs only. Deployed environments have KV configured.
- **Tiles blank.** Check `/api/intelligence/tiles`; only allowlisted basemap
  hosts pass, so a new basemap host must be added to the allowlist.
- **Adding a geo asset.** Every dataset needs a named source and a licence
  permitting commercial display before it ships — see `data-sources.md`. Run
  `npm run audit:data-sources` to check the inventory.

## Console imagery

`npm run capture:intelligence` regenerates the console screenshots in
`docs/intelligence/images/`. Feeds come from the e2e fixtures and the basemap
from real tiles, so the images are presentable but deterministic — a refresh
does not silently change what the picture claims. `--check` verifies the files
exist and stay inside budget; `--hermetic` runs with fixture tiles too.

The scenes are asserted by `e2e/intelligence/console.spec.ts`, so a scene that
drifts fails CI before it can produce a misleading image.

![Layer rail with the aviation, space, hazard and threat groups enabled](images/02-layers.webp)

![The RECON toolkit panel, with licence-gated tools marked](images/03-recon.webp)

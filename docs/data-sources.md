# Forge Intelligence — data sources

Every upstream feed the console consumes, with its licence and commercial
status. This file is the answer to "can we ship this?" — if a source is not
listed here, it is not wired in.

Two rules govern the inventory, and both are load-bearing:

1. **Commercial-use clean.** 577 Industries is a commercial entity, so a
   source that is free only for non-commercial use is disqualified regardless
   of how good the data is. This is why several upstream Osiris feeds were
   replaced rather than ported (see [Rejected sources](#rejected-sources)).
2. **No fabricated intelligence.** When a source is unavailable the layer
   reports that it has no data. Nothing on this surface invents a reading —
   a plausible-looking fake datum on an intelligence console is worse than a
   blank one.

## Live feeds

| Domain | Source | Licence / status | Key |
|---|---|---|---|
| `earthquakes` | [USGS earthquake feeds](https://earthquake.usgs.gov/earthquakes/feed/) | US federal — public domain | none |
| `fires` | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) (VIIRS/MODIS) + [NASA EONET](https://eonet.gsfc.nasa.gov/) | US federal — public domain | none |
| `weather` | [NASA EONET](https://eonet.gsfc.nasa.gov/) (severe-storm events) | US federal — public domain | none |
| `space-weather` | [NOAA SWPC](https://services.swpc.noaa.gov/) (aurora ovals, planetary K) | US federal — public domain | none |
| `satellites` | [CelesTrak](https://celestrak.org/) TLE sets, propagated locally with SGP4 | Free redistribution; attribution requested | none |
| `flights` | [airplanes.live](https://api.airplanes.live/) v2 (military + emergency squawks) | Free public API, commercial use permitted | none |
| `gdelt` | [GDACS](https://www.gdacs.org/) disaster alerts | UN/EC joint programme — open data | none |
| `conflicts` | Curated conflict anchors, enriched with a live event count from [BBC World RSS](https://feeds.bbci.co.uk/) | Curated public knowledge; RSS headline counts only | none |
| `markets` | [EIA petroleum spot prices](https://www.eia.gov/opendata/) | US federal — public domain | `EIA_API_KEY` (free) |

## Static reference data

Curated by 577 Industries from public knowledge. These never poll — a fixed
list of ports does not change between page loads.

| Domain | Contents | Note |
|---|---|---|
| `maritime` | Global container/energy/naval ports + strategic chokepoints | Live AIS vessel tracking is **not** included; see below |
| `infrastructure` | Internet exchange points, nuclear plants, grid interconnects | Indicative reference markers, not an asset inventory |
| `cctv` | Public open-data traffic-camera **networks** with official portal links | Links out to operator portals (TfL, NYC DOT, Caltrans, DriveBC, 511ON, VicRoads, NDW, ASFINAG, WSDOT, FL511, data.gov.sg) — no camera imagery is re-served |
| `cyber-attacks` | National cyber commands / CERTs and significant-activity regions | Clearly labelled as indicative, **not** a live attack feed |
| `live-news` | 24/7 broadcaster channels with playback metadata | Embeds via YouTube's official privacy-preserving player only |

## RECON toolkit sources

| Tool | Source | Licence / status |
|---|---|---|
| `dns` | Public DNS resolution via the platform resolver — no third-party endpoint | Public infrastructure |
| `whois` / `ip` | [RDAP](https://about.rdap.org/) (registry APIs) | Open registry protocol, commercial use permitted |
| `bgp` | [RIPEstat](https://stat.ripe.net/) | Free for commercial use with attribution |
| `certs` | [crt.sh](https://crt.sh/) Certificate Transparency logs | Public CT logs |
| `cve` | [NVD](https://services.nvd.nist.gov/) | US federal — public domain (`NVD_API_KEY` optional, raises rate limit) |
| `sanctions` | [US Treasury OFAC SDN list](https://sanctionslistservice.ofac.treas.gov/) | US federal — public domain |
| `shodan` | [Shodan](https://www.shodan.io/) host API | Commercial use requires a Shodan enterprise licence — the deployment supplies `SHODAN_API_KEY`, and the route reports unconfigured without one. The keyless InternetDB endpoint is **non-commercial only** and is deliberately not used. |
| `leaks` | [XposedOrNot](https://xposedornot.com/) breach analytics | Commercial use requires a licensing agreement with the provider; redistribution needs written authorisation; attribution is mandatory and is returned on every response. Gated behind `FI_BREACH_LICENSED=1`. Personal data — also auth-gated with an audit trail, see [security.md](security.md). |
| `scanner` | Operator-supplied scanning backend | Unconfigured by default; see [operations.md](operations.md) |

## Basemap and imagery

| Asset | Source | Licence |
|---|---|---|
| Vector basemap | [OpenFreeMap](https://openfreemap.org/) dark style, OpenMapTiles schema, data © OpenStreetMap contributors | Free for commercial use, no key and no request cap; attribution to OpenFreeMap, OpenMapTiles and OpenStreetMap is **required** and rendered by the map's attribution control |
| Satellite imagery | [Esri ArcGIS World Imagery](https://server.arcgisonline.com/) | Esri terms; attribution required — the credit string is taken verbatim from the service's own `copyrightText` metadata |
| 3D building footprints | [OpenFreeMap](https://openfreemap.org/) | OSM-derived, ODbL |

All three are fetched through the same-origin `/api/intelligence/tiles` proxy
with a host allowlist — the browser never contacts them directly, because the
app's CSP forbids it. See [security.md](security.md#tile-proxy).

## Rejected sources

Recorded so nobody re-adds them:

| Source | Why not |
|---|---|
| CoinGecko crypto ticker | Free tier is **non-commercial**; token prices also carry no intelligence value. The upstream's token panel was promotional and was removed outright. |
| ip-api.com geolocation | Free tier is **non-commercial**. Replaced by RDAP, with optional self-hosted MaxMind GeoLite2 for coordinates. |
| aisstream.io live AIS | WebSocket streaming does not fit the cached-route model, and the terms do not cover redistribution. Ports and chokepoints are served as reference data instead. |
| Hot-linked camera feeds (YouTube/EarthCam/sheriff cams) | Copyright, privacy and ToS exposure. The upstream aggregated 2,000+; we link to operator portals instead. |
| Simulated cyber-attack animation | The upstream layer generated fake attacks. Fabricated intelligence is not shippable at any quality bar. |
| TeleGeography submarine-cable geometry | Published **CC BY-NC-SA** — non-commercial, and ShareAlike is incompatible with our licensing. The cable layer that shipped on 2026-07-25 drew from it and was removed on 2026-07-26. |
| Procedurally generated cable corridors | The same removed layer padded 127 real routes with 590 synthetic corridor polylines — one template per corridor, replicated with random jitter. Generated geometry rendered as observed infrastructure is the exact failure this file exists to prevent. |
| CARTO basemap tiles | CARTO's own terms restrict hosted basemap tiles to enterprise customers and non-profit grantees: *"For commercial purposes, you will need an Enterprise license."* Replaced with OpenFreeMap, which serves the same OpenMapTiles schema. |
| Shodan InternetDB (keyless) | *"Free for non-commercial use"* — a commercial deployment needs an enterprise licence, so the route uses the licensed host API with an operator-supplied key instead. |

## Attribution obligations

Credits that must be *visible*, not merely recorded here, are rendered by the
map's attribution control (`ForgeIntelMap.tsx`). Disabling that control puts the
subsystem in breach of the basemap licences — it is not cosmetic.

- **OpenFreeMap · OpenMapTiles · OpenStreetMap** contributors — basemap, glyphs,
  sprites and building data. Required by OpenFreeMap's terms and by ODbL.
- **Esri** — satellite imagery, credited verbatim from the service metadata
  while the satellite layer is enabled.
- **XposedOrNot** — breach data, returned on every `leaks` response.
- **CelesTrak** — orbital element sets.
- **RIPE NCC** — RIPEstat BGP data.
- **MaxMind** — if `FI_GEOIP_URL` is wired to GeoLite2, the GeoLite2 licence
  requires visible attribution in the RECON IP panel.

See [ATTRIBUTION.md](ATTRIBUTION.md) for upstream-project provenance.

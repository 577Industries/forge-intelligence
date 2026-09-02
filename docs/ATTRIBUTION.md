# Forge Intelligence — attribution & provenance

Forge Intelligence is 577 Industries' fourth frontier technology: a real-time
OSINT fusion console. It is a **derivative work** of the open-source project
**Osiris** and is distributed in good faith under that project's license.

## Upstream

| | |
|---|---|
| **Project** | Osiris — Open Source Intelligence & Reconnaissance Integrated System |
| **Source** | https://github.com/simplifaisoul/osiris |
| **Author** | simplifaisoul |
| **License** | MIT (© 2026 simplifaisoul) |

The MIT license text is retained verbatim in the repository-root [`NOTICE`](../../NOTICE)
file, as the license requires.

## What Forge Intelligence changes vs. upstream

This fork is a substantive re-architecture, not a re-skin:

- **Branding & design** — rebranded to Forge Intelligence with the 577i design
  system; all "Osiris" wordmarks, glyphs, and Egyptian-mythology motifs removed.
- **AI analyst** — the upstream's direct `@google/generative-ai` SDK dependency is
  replaced by an analyst routed through the 577i AI gateway (default Gemini 3.7
  Flash, overridable via `FI_ANALYST_MODEL`), so the model is a configuration
  choice rather than a hard-wired vendor SDK.
- **Security** — the upstream IP / User-Agent spoofing layer (`stealthFetch`) is
  removed; the SSRF egress guard is hardened (IPv6-literal + DNS-rebinding fixes);
  all external data is proxied server-side; aggressive RECON tools are auth-gated.
- **Isolation** — the app is embedded as a scoped 577i subsystem (`.fi-root`),
  with no global CSS / html-body mutations leaking into the host.
- **Removed** — the upstream cryptocurrency-token panel, crypto ticker, and
  donation solicitations are stripped entirely; the ticker now carries energy
  markets, which correlate with the conflict and chokepoint layers.
- **Data integrity** — the upstream's simulated cyber-attack animation is
  replaced by clearly-labelled reference data. No layer fabricates readings.

## Data-source attributions

Forge Intelligence surfaces third-party open data (USGS, NASA, NOAA, GDACS,
CelesTrak, airplanes.live, US Treasury OFAC, RDAP, RIPEstat, EIA and others).
Each source's own attribution and license terms apply. The per-source
inventory — including licences, commercial status and the sources we
deliberately rejected — is maintained in
[`data-sources.md`](data-sources.md), and the security controls in
[`security.md`](security.md).

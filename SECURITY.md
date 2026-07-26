# Security policy

## Reporting

Report vulnerabilities privately to **security@577industries.com**. Please do
not open a public issue for a security problem.

Include what you did, what you expected, and what happened. A proof of concept
helps. We will acknowledge within three working days.

## Scope

The parts of this codebase most worth your attention:

| Area | Why |
|---|---|
| `src/lib/intelligence/ssrf-guard.ts` | The egress choke point. Every fetch whose destination is influenced by input goes through it. |
| `src/app/api/intelligence/tiles/route.ts` | A proxy with a host allowlist. A bypass is an SSRF primitive. |
| `src/intelligence/lib/popups.ts` | Renders third-party feed text into HTML. The escaping boundary. |
| `src/app/api/intelligence/osint/*` | Tools that reach third parties. Anything that lets an unauthenticated caller run a gated tool is a finding. |

## Known upstream findings

This project is a hardened fork of [Osiris](https://github.com/simplifaisoul/osiris).
Two exploitable SSRF flaws in the upstream implementation were found during that
work, disclosed to the upstream maintainer, and fixed here. Both are documented
with the vulnerable pattern and the fix in [docs/security.md](docs/security.md).

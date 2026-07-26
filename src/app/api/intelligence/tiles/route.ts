/**
 * Forge Intelligence — basemap tile / style proxy.
 *
 * The browser cannot fetch map tiles directly: the app's CSP
 * (`connect-src 'self' …` in src/proxy.ts) blocks external origins. So the
 * MapLibre client rewrites basemap requests (style.json, glyphs, sprites,
 * raster/vector tiles) through this same-origin proxy.
 *
 * SECURITY: unlike the upstream open `?url=` passthrough (an SSRF vector),
 * this proxy fetches ONLY from a strict host allowlist over https, so it
 * can never be turned into a request-forgery primitive against internal
 * infrastructure. This is the per-feature egress-allowlist principle applied
 * to the basemap.
 */

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Trusted basemap CDNs. Match is exact host OR a subdomain of these.
 *
 * Keep this list to hosts whose terms permit commercial display. CARTO was
 * removed because its basemap tiles require a CARTO enterprise agreement for
 * commercial use; OpenFreeMap serves the same OpenMapTiles schema without one.
 */
const ALLOWED_TILE_HOSTS = [
  "server.arcgisonline.com",
  "tiles.openfreemap.org",
] as const;

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_TILE_HOSTS.some(
    (allowed) => h === allowed || h.endsWith(`.${allowed}`),
  );
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: { "User-Agent": "ForgeIntelligence/1.0 (+577industries.com)" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "upstream error", status: upstream.status },
        { status: 502 },
      );
    }

    const contentType =
      upstream.headers.get("content-type") ?? "application/octet-stream";
    const body = await upstream.arrayBuffer();

    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": contentType,
        // Tiles/styles are effectively immutable — cache hard at the edge.
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  }
}

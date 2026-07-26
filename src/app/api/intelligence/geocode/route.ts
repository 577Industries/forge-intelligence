/**
 * Forge Intelligence — place search + reverse geocoding.
 *
 * Backs the console search box and the right-click region dossier. Proxies
 * OpenStreetMap Nominatim server-side with an honest, contactable User-Agent
 * and aggressive caching, which is what their usage policy requires — the
 * upstream hit it directly from the browser on every keystroke.
 *
 * Attribution (© OpenStreetMap contributors) is surfaced in-product.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

interface Place {
  name: string;
  lat: number;
  lng: number;
  type?: string;
}

interface NominatimRow {
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
  addresstype?: string;
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const lat = req.nextUrl.searchParams.get("lat");
  const lng = req.nextUrl.searchParams.get("lng");

  // Reverse geocode (region dossier).
  if (lat && lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      return NextResponse.json({ error: "invalid coordinates" }, { status: 400 });
    }
    const key = `geocode:rev:${la.toFixed(2)},${ln.toFixed(2)}`;
    try {
      const { data } = await cachedJson<Place | null>(key, 86_400, async () => {
        const row = await fiFetchJson<NominatimRow>(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${la}&lon=${ln}&zoom=8`,
          { timeoutMs: 8000 },
        );
        if (!row.display_name) return null;
        return {
          name: row.display_name,
          lat: la,
          lng: ln,
          type: row.addresstype ?? row.type,
        };
      });
      return NextResponse.json({
        place: data,
        attribution: "© OpenStreetMap contributors",
      });
    } catch {
      return NextResponse.json(
        { place: null, attribution: "© OpenStreetMap contributors" },
        { status: 200 },
      );
    }
  }

  // Forward search.
  if (q.length < 2 || q.length > 120) {
    return NextResponse.json({ error: "query too short" }, { status: 400 });
  }
  const key = `geocode:fwd:${q.toLowerCase()}`;
  try {
    const { data } = await cachedJson<Place[]>(key, 86_400, async () => {
      const rows = await fiFetchJson<NominatimRow[]>(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`,
        { timeoutMs: 8000 },
      );
      return (Array.isArray(rows) ? rows : [])
        .filter((r) => r.lat && r.lon)
        .map((r) => ({
          name: r.display_name ?? q,
          lat: Number(r.lat),
          lng: Number(r.lon),
          type: r.addresstype ?? r.type,
        }));
    });
    return NextResponse.json({
      results: data,
      attribution: "© OpenStreetMap contributors",
    });
  } catch {
    return NextResponse.json(
      { results: [], attribution: "© OpenStreetMap contributors", error: "search unavailable" },
      { status: 502 },
    );
  }
}

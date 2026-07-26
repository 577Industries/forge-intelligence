/**
 * Forge Intelligence — seismic feed.
 *
 * Real-time M2.5+ earthquakes from USGS (keyless). Passive: fixed upstream
 * host, honest fetch, KV-cached with stale fallback, rate-limited.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const USGS_FEED =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";

interface Quake {
  id: string;
  lat: number;
  lng: number;
  depth: number;
  magnitude: number | null;
  place: string | null;
  time: number | null;
  url: string | null;
  tsunami: number | null;
  alert: string | null;
}

async function produce(): Promise<{ earthquakes: Quake[]; total: number }> {
  const data = await fiFetchJson<{ features?: unknown[] }>(USGS_FEED, {
    timeoutMs: 10_000,
  });
  const features = Array.isArray(data.features) ? data.features : [];
  const earthquakes: Quake[] = features.map((raw) => {
    const f = raw as {
      id?: string;
      geometry?: { coordinates?: number[] };
      properties?: Record<string, unknown>;
    };
    const coords = f.geometry?.coordinates ?? [0, 0, 0];
    const props = f.properties ?? {};
    return {
      id: String(f.id ?? `${coords[1]},${coords[0]}`),
      lat: Number(coords[1] ?? 0),
      lng: Number(coords[0] ?? 0),
      depth: Number(coords[2] ?? 0),
      magnitude: (props.mag as number) ?? null,
      place: (props.place as string) ?? null,
      time: (props.time as number) ?? null,
      url: (props.url as string) ?? null,
      tsunami: (props.tsunami as number) ?? null,
      alert: (props.alert as string) ?? null,
    };
  });
  return { earthquakes, total: earthquakes.length };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;

  try {
    const { data } = await cachedJson("earthquakes", 300, produce, {
      staleTtlSeconds: 3600,
    });
    return NextResponse.json(
      { ...data, timestamp: new Date().toISOString() },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=60, stale-while-revalidate=300",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { earthquakes: [], total: 0, error: "USGS unavailable" },
      { status: 502 },
    );
  }
}

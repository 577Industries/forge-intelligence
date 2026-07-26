/**
 * Forge Intelligence — space weather (auroral oval).
 *
 * NOAA SWPC OVATION aurora nowcast (keyless): a global grid of aurora
 * probabilities. We keep only cells above a visibility threshold and sample
 * them so the layer shows where auroras are active without plotting the full
 * ~65k-cell grid. Passive; honest fetch; KV-cached.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const OVATION =
  "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
const MIN_PROB = 8; // percent
const MAX_POINTS = 1500;

interface AuroraPoint {
  lat: number;
  lng: number;
  prob: number;
}

async function produce(): Promise<{ aurora: AuroraPoint[]; total: number }> {
  const data = await fiFetchJson<{ coordinates?: [number, number, number][] }>(
    OVATION,
    { timeoutMs: 12_000 },
  );
  const coords = data.coordinates ?? [];
  const hot = coords.filter((c) => c[2] >= MIN_PROB);
  const step = hot.length > MAX_POINTS ? Math.ceil(hot.length / MAX_POINTS) : 1;
  const aurora: AuroraPoint[] = [];
  for (let i = 0; i < hot.length; i += step) {
    const [lng, lat, prob] = hot[i];
    // OVATION longitudes are 0..360; normalize to -180..180.
    aurora.push({ lat, lng: lng > 180 ? lng - 360 : lng, prob });
  }
  return { aurora, total: aurora.length };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  try {
    const { data } = await cachedJson("space-weather", 600, produce, {
      staleTtlSeconds: 3600,
    });
    return NextResponse.json(
      { ...data, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return NextResponse.json(
      { aurora: [], total: 0, error: "space weather unavailable" },
      { status: 502 },
    );
  }
}

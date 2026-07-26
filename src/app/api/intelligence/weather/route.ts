/**
 * Forge Intelligence — severe weather feed.
 *
 * Active severe-weather events from NASA EONET (keyless). Filtered to
 * weather-relevant categories (storms / dust / ice / floods / drought /
 * temperature extremes); wildfires + volcanoes + quakes are excluded here
 * because they have their own layers. Passive; honest fetch; KV-cached.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { logger } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const EONET =
  "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=250&days=20";

const WEATHER_CATEGORIES = new Set([
  "severeStorms",
  "dustHaze",
  "seaLakeIce",
  "drought",
  "floods",
  "snow",
  "tempExtremes",
]);

interface WeatherPoint {
  lat: number;
  lng: number;
  title: string;
  category: string;
}

interface EonetEvent {
  title?: string;
  categories?: { id?: string; title?: string }[];
  geometry?: { coordinates?: number[] }[];
}

async function produce(): Promise<{ weather: WeatherPoint[]; total: number }> {
  const data = await fiFetchJson<{ events?: EonetEvent[] }>(EONET, { timeoutMs: 12_000 });
  const weather: WeatherPoint[] = [];
  for (const e of data.events ?? []) {
    const catId = e.categories?.[0]?.id ?? "";
    if (!WEATHER_CATEGORIES.has(catId)) continue;
    const geo = e.geometry?.[e.geometry.length - 1];
    const coords = geo?.coordinates;
    if (!coords || coords.length < 2) continue;
    weather.push({
      lat: coords[1],
      lng: coords[0],
      title: e.title ?? "Weather event",
      category: e.categories?.[0]?.title ?? catId,
    });
  }
  return { weather, total: weather.length };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  try {
    const { data } = await cachedJson("weather", 900, produce, { staleTtlSeconds: 7200 });
    return NextResponse.json(
      { ...data, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" } },
    );
  } catch (err) {
    logger.error("[intel-weather] weather feed unavailable", {
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // audit-ignore: honest-failure — the empty array is paired with a 502 and an
    // explicit `error` field, so the client cannot read this as a successful
    // empty result. Not synthetic data; the upstream error is logged above.
    return NextResponse.json(
      { weather: [], total: 0, error: "weather unavailable" },
      { status: 502 },
    );
  }
}

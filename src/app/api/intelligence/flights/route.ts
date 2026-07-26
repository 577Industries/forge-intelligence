/**
 * Forge Intelligence — aviation feed (lean).
 *
 * Global military aircraft + emergency squawks (7700) from airplanes.live's
 * keyless v2 endpoints. This is a deliberately lean port: the upstream Osiris
 * route fanned out ~60 stealthFetch requests across 30 regions; two honest,
 * cached global calls give the highest-signal aircraft (military + emergency)
 * without the volume or the spoofing.
 *
 * NOTE: airplanes.live is community-run; keep the honest User-Agent and the
 * cache so we stay a good citizen. Full commercial traffic is a later pass on
 * a licensed ADS-B provider.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const MIL_URL = "https://api.airplanes.live/v2/mil";
const EMERGENCY_URL = "https://api.airplanes.live/v2/squawk/7700";

interface Flight {
  lat: number;
  lng: number;
  callsign: string;
  category: "military" | "emergency";
  alt: number | null;
  heading: number;
}

interface AdsbAircraft {
  lat?: number;
  lon?: number;
  flight?: string;
  hex?: string;
  alt_baro?: number | "ground";
  track?: number;
}

function toFlights(ac: AdsbAircraft[], category: Flight["category"]): Flight[] {
  return ac
    .filter((a) => typeof a.lat === "number" && typeof a.lon === "number")
    .map((a) => ({
      lat: a.lat as number,
      lng: a.lon as number,
      callsign: (a.flight ?? a.hex ?? "UNKNOWN").trim(),
      category,
      alt: typeof a.alt_baro === "number" ? a.alt_baro : null,
      heading: typeof a.track === "number" ? a.track : 0,
    }));
}

async function produce(): Promise<{ flights: Flight[]; total: number }> {
  const [mil, emg] = await Promise.allSettled([
    fiFetchJson<{ ac?: AdsbAircraft[] }>(MIL_URL, { timeoutMs: 12_000 }),
    fiFetchJson<{ ac?: AdsbAircraft[] }>(EMERGENCY_URL, { timeoutMs: 12_000 }),
  ]);

  const flights: Flight[] = [];
  const seen = new Set<string>();
  if (emg.status === "fulfilled") {
    for (const f of toFlights(emg.value.ac ?? [], "emergency")) {
      seen.add(f.callsign);
      flights.push(f);
    }
  }
  if (mil.status === "fulfilled") {
    for (const f of toFlights(mil.value.ac ?? [], "military")) {
      if (!seen.has(f.callsign)) flights.push(f);
    }
  }
  if (mil.status === "rejected" && emg.status === "rejected") {
    throw new Error("all aviation sources failed");
  }
  return { flights, total: flights.length };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;

  try {
    const { data } = await cachedJson("flights", 30, produce, {
      staleTtlSeconds: 600,
    });
    return NextResponse.json(
      { ...data, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } },
    );
  } catch {
    return NextResponse.json(
      { flights: [], total: 0, error: "aviation unavailable" },
      { status: 502 },
    );
  }
}

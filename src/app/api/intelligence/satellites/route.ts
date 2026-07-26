/**
 * Forge Intelligence — orbital tracking.
 *
 * Live satellite positions computed server-side from CelesTrak TLEs
 * (keyless) via SGP4 (satellite.js). TLE sets change slowly, so they're
 * KV-cached (4h); positions are propagated fresh to "now" on each request
 * (cheap). Uses the "visual" group (brightest/notable satellites) to keep
 * the layer legible rather than plotting tens of thousands of objects.
 */

import { NextRequest, NextResponse } from "next/server";
import * as satellite from "satellite.js";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchText } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const CELESTRAK_VISUAL =
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=tle";

interface Tle {
  name: string;
  line1: string;
  line2: string;
}

interface SatPoint {
  lat: number;
  lng: number;
  alt: number;
  name: string;
}

function parseTleText(text: string): Tle[] {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const out: Tle[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (l1?.startsWith("1 ") && l2?.startsWith("2 ")) {
      out.push({ name, line1: l1, line2: l2 });
    }
  }
  return out;
}

async function getTles(): Promise<Tle[]> {
  const { data } = await cachedJson<Tle[]>(
    "satellites-tle",
    4 * 3600,
    async () => {
      const text = await fiFetchText(CELESTRAK_VISUAL, { timeoutMs: 15_000 });
      if (!text.includes("1 ") || text.toLowerCase().includes("error"))
        throw new Error("bad TLE payload");
      return parseTleText(text);
    },
    { staleTtlSeconds: 24 * 3600 },
  );
  return data;
}

function propagate(tles: Tle[], now: Date): SatPoint[] {
  const gmst = satellite.gstime(now);
  const out: SatPoint[] = [];
  for (const tle of tles) {
    try {
      const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
      const pv = satellite.propagate(satrec, now);
      if (!pv) continue;
      const eci = pv.position;
      if (!eci || typeof eci === "boolean") continue;
      const geo = satellite.eciToGeodetic(eci, gmst);
      const lat = satellite.degreesLat(geo.latitude);
      const lng = satellite.degreesLong(geo.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      out.push({ lat, lng, alt: Math.round(geo.height), name: tle.name });
    } catch {
      /* skip un-propagatable TLE */
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  try {
    const tles = await getTles();
    const satellites = propagate(tles, new Date());
    return NextResponse.json(
      { satellites, total: satellites.length, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" } },
    );
  } catch {
    return NextResponse.json(
      { satellites: [], total: 0, error: "orbital data unavailable" },
      { status: 502 },
    );
  }
}

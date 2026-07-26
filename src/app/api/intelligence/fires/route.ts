/**
 * Forge Intelligence — active-fire feed.
 *
 * NASA FIRMS (VIIRS/MODIS, keyless 24h global CSV) + NASA EONET volcanoes.
 * Passive: fixed upstream hosts, honest fetch, KV-cached, rate-limited.
 * The CSV is sampled to ~2000 points so the WebGL layer stays smooth.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson, fiFetchText } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const FIRMS_SOURCES = [
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv",
  "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv",
];
const EONET_VOLCANOES =
  "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes&limit=50";

interface FirePoint {
  lat: number;
  lng: number;
  brightness: number;
  confidence: string;
  frp: number;
  type: "fire" | "volcano";
  title?: string;
}

const MAX_POINTS = 2000;

function parseFiresCsv(csv: string): FirePoint[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const latIdx = header.indexOf("latitude");
  const lngIdx = header.indexOf("longitude");
  const brightIdx =
    header.indexOf("bright_ti4") !== -1
      ? header.indexOf("bright_ti4")
      : header.indexOf("brightness");
  const confIdx = header.indexOf("confidence");
  const frpIdx = header.indexOf("frp");

  const out: FirePoint[] = [];
  const step = lines.length > MAX_POINTS ? Math.ceil(lines.length / MAX_POINTS) : 1;
  for (let i = 1; i < lines.length; i += step) {
    const cols = lines[i].split(",");
    const lat = parseFloat(cols[latIdx]);
    const lng = parseFloat(cols[lngIdx]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    out.push({
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      brightness: parseFloat(cols[brightIdx]) || 0,
      confidence: cols[confIdx] || "unknown",
      frp: parseFloat(cols[frpIdx]) || 0,
      type: "fire",
    });
  }
  return out;
}

async function produce(): Promise<{ fires: FirePoint[]; total: number; source: string }> {
  let fires: FirePoint[] = [];
  let source = "";

  for (const url of FIRMS_SOURCES) {
    try {
      const text = await fiFetchText(url, { timeoutMs: 15_000 });
      if (text.includes("latitude") && text.length > 200) {
        const parsed = parseFiresCsv(text);
        if (parsed.length > 0) {
          fires = parsed;
          source = url.includes("SUOMI") ? "NASA FIRMS (VIIRS)" : "NASA FIRMS (MODIS)";
          break;
        }
      }
    } catch {
      /* try next source */
    }
  }

  // Best-effort volcano enrichment from EONET.
  try {
    const volc = await fiFetchJson<{ events?: unknown[] }>(EONET_VOLCANOES, {
      timeoutMs: 10_000,
    });
    const volcanoes: FirePoint[] = (volc.events ?? []).flatMap((raw) => {
      const e = raw as { title?: string; geometry?: { coordinates?: number[] }[] };
      const geo = e.geometry?.[e.geometry.length - 1];
      if (!geo?.coordinates) return [];
      return [
        {
          lat: geo.coordinates[1],
          lng: geo.coordinates[0],
          brightness: 500,
          confidence: "high",
          frp: 100,
          type: "volcano" as const,
          title: e.title,
        },
      ];
    });
    fires = [...fires, ...volcanoes];
    if (!source && volcanoes.length) source = "NASA EONET";
  } catch {
    /* volcanoes optional */
  }

  return { fires, total: fires.length, source: source || "unknown" };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;

  try {
    const { data } = await cachedJson("fires", 600, produce, {
      staleTtlSeconds: 7200,
    });
    return NextResponse.json(
      { ...data, timestamp: new Date().toISOString() },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=600, stale-while-revalidate=1200",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { fires: [], total: 0, error: "fire data unavailable" },
      { status: 502 },
    );
  }
}

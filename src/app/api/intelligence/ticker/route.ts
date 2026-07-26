/**
 * Forge Intelligence — status ticker feed.
 *
 * Drives the bottom status ticker. Deliberately built on US-government
 * public-domain sources (NOAA SWPC, USGS) rather than the upstream's crypto
 * ticker, whose CoinGecko free tier is non-commercial — and whose token panel
 * was pump-promotion we stripped.
 *
 * Market quotes are an OPTIONAL add-on: set FI_MARKETS_URL to a licensed
 * provider endpoint returning [{symbol, price, changePct}]. Unset → the
 * ticker simply carries intelligence data instead of fabricating quotes.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const NOAA_KP =
  "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";
const USGS_SIGNIFICANT =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";

interface Quote {
  symbol: string;
  price: number;
  changePct?: number;
}

interface TickerData {
  kp: number | null;
  kpLevel: "quiet" | "unsettled" | "active" | "storm" | null;
  largestQuake: { magnitude: number; place: string } | null;
  significantQuakes: number;
  quotes: Quote[];
  marketsConfigured: boolean;
}

function kpLevel(kp: number): TickerData["kpLevel"] {
  if (kp < 3) return "quiet";
  if (kp < 4) return "unsettled";
  if (kp < 5) return "active";
  return "storm";
}

async function produce(): Promise<TickerData> {
  const [kpRes, quakeRes, marketRes] = await Promise.allSettled([
    fiFetchJson<{ kp_index?: number; estimated_kp?: number }[]>(NOAA_KP, {
      timeoutMs: 8000,
    }),
    fiFetchJson<{ features?: { properties?: { mag?: number; place?: string } }[] }>(
      USGS_SIGNIFICANT,
      { timeoutMs: 8000 },
    ),
    process.env.FI_MARKETS_URL
      ? fiFetchJson<Quote[]>(process.env.FI_MARKETS_URL, { timeoutMs: 8000 })
      : Promise.resolve<Quote[]>([]),
  ]);

  let kp: number | null = null;
  if (kpRes.status === "fulfilled" && Array.isArray(kpRes.value) && kpRes.value.length) {
    const last = kpRes.value[kpRes.value.length - 1];
    const v = last.estimated_kp ?? last.kp_index;
    if (typeof v === "number") kp = Math.round(v * 10) / 10;
  }

  let largestQuake: TickerData["largestQuake"] = null;
  let significantQuakes = 0;
  if (quakeRes.status === "fulfilled") {
    const feats = quakeRes.value.features ?? [];
    significantQuakes = feats.length;
    for (const f of feats) {
      const mag = f.properties?.mag;
      if (typeof mag === "number" && (!largestQuake || mag > largestQuake.magnitude)) {
        largestQuake = { magnitude: mag, place: f.properties?.place ?? "unknown" };
      }
    }
  }

  const quotes =
    marketRes.status === "fulfilled" && Array.isArray(marketRes.value)
      ? marketRes.value.slice(0, 8)
      : [];

  return {
    kp,
    kpLevel: kp === null ? null : kpLevel(kp),
    largestQuake,
    significantQuakes,
    quotes,
    marketsConfigured: Boolean(process.env.FI_MARKETS_URL),
  };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  try {
    const { data } = await cachedJson("ticker", 120, produce, {
      staleTtlSeconds: 1800,
    });
    return NextResponse.json(
      { ...data, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch {
    return NextResponse.json(
      { kp: null, kpLevel: null, largestQuake: null, significantQuakes: 0, quotes: [], marketsConfigured: false, error: "ticker unavailable" },
      { status: 502 },
    );
  }
}

/**
 * Forge Intelligence — energy market quotes.
 *
 * Feeds the console ticker with the commodity prices that actually move WITH
 * the console's other layers: a Hormuz chokepoint alert, a Red Sea shipping
 * disruption or a refinery fire shows up in crude before it shows up in
 * headlines. (The upstream shipped a crypto ticker; token prices tell an
 * intelligence operator nothing, and its CoinGecko free tier bars commercial
 * use.)
 *
 * Source: the U.S. Energy Information Administration (EIA) — a federal
 * statistical agency, so the data is public domain and free to redistribute.
 * The API key is free but rate-limited per key, hence the KV cache.
 *
 * Emits the shape the ticker already consumes: [{ symbol, price, changePct }].
 * Point FI_MARKETS_URL at this route to switch the ticker on. Without
 * EIA_API_KEY the route reports 503 rather than inventing prices — a
 * fabricated quote on an intelligence surface is worse than a missing one.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

/**
 * EIA daily spot-price series. Petroleum spot prices settle once per business
 * day, so a 30-minute cache is already far finer than the data changes.
 */
const SERIES: Array<{ id: string; symbol: string }> = [
  { id: "RWTC", symbol: "WTI" }, // Cushing OK WTI spot, $/bbl
  { id: "RBRTE", symbol: "BRENT" }, // Europe Brent spot, $/bbl
  { id: "EER_EPMRU_PF4_RGC_DPG", symbol: "RBOB" }, // Gulf Coast gasoline, $/gal
  { id: "EER_EPD2F_PF4_RGC_DPG", symbol: "DIESEL" }, // Gulf Coast ULSD, $/gal
];

const FRESH_TTL_SECONDS = 30 * 60;
const STALE_TTL_SECONDS = 24 * 60 * 60;

interface EiaResponse {
  response?: {
    data?: Array<{ period?: string; value?: number | string; series?: string }>;
  };
}

interface Quote {
  symbol: string;
  price: number;
  changePct?: number;
}

/**
 * Pull the two most recent observations for one series.
 *
 * `changePct` is session-over-session, which is why we ask for two rows and
 * not one: a price with no delta reads as noise on a ticker.
 */
async function fetchSeries(
  apiKey: string,
  series: { id: string; symbol: string },
): Promise<Quote | null> {
  const url =
    `https://api.eia.gov/v2/petroleum/pri/spt/data/?api_key=${encodeURIComponent(apiKey)}` +
    `&frequency=daily&data[0]=value&facets[series][]=${encodeURIComponent(series.id)}` +
    `&sort[0][column]=period&sort[0][direction]=desc&length=2`;

  const json = await fiFetchJson<EiaResponse>(url, { timeoutMs: 8000 });
  const rows = json.response?.data ?? [];
  const values = rows
    .map((r) => (typeof r.value === "string" ? Number(r.value) : r.value))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  if (values.length === 0) return null;

  const [latest, previous] = values;
  const quote: Quote = {
    symbol: series.symbol,
    price: Math.round(latest * 100) / 100,
  };
  if (previous && previous !== 0) {
    quote.changePct = Math.round(((latest - previous) / previous) * 1000) / 10;
  }
  return quote;
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;

  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "markets_unconfigured",
        detail: "Set EIA_API_KEY to enable energy quotes (free key, eia.gov/opendata).",
      },
      { status: 503 },
    );
  }

  const { data: quotes } = await cachedJson<Quote[]>(
    "intel:markets:eia",
    FRESH_TTL_SECONDS,
    async () => {
      // One slow or failed series must not blank the whole ticker.
      const settled = await Promise.allSettled(
        SERIES.map((series) => fetchSeries(apiKey, series)),
      );
      const rows: Quote[] = [];
      for (const [i, result] of settled.entries()) {
        if (result.status === "fulfilled" && result.value) {
          rows.push(result.value);
        } else if (result.status === "rejected") {
          console.error(
            `[forge-intel] EIA series ${SERIES[i].id} failed:`,
            result.reason,
          );
        }
      }
      if (rows.length === 0) throw new Error("no EIA series returned data");
      return rows;
    },
    { staleTtlSeconds: STALE_TTL_SECONDS },
  );

  return NextResponse.json(quotes, {
    headers: { "Cache-Control": "public, s-maxage=1800" },
  });
}

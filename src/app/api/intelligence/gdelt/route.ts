/**
 * Forge Intelligence — global event feed (news intel).
 *
 * Geo-coded global disaster/hazard events from GDACS (keyless RSS). Passive;
 * honest fetch; KV-cached; rate-limited. Parsed by splitting on <item> (no
 * regex over the whole doc) to avoid ReDoS on large XML.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchText } from "@/lib/intelligence/fetch";
import { logger } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const GDACS_RSS = "https://www.gdacs.org/xml/rss.xml";

interface EventPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  url: string;
  type: "earthquake" | "weather" | "volcano" | "conflict";
}

function field(item: string, tag: string): string | null {
  const m =
    item.match(new RegExp(`<${tag}><!\\[CDATA\\[(.*?)\\]\\]></${tag}>`, "i")) ??
    item.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "i"));
  return m ? m[1] : null;
}

async function produce(): Promise<{ events: EventPoint[]; total: number }> {
  const xml = await fiFetchText(GDACS_RSS, { timeoutMs: 10_000 });
  const items = xml.split(/<item>/i).slice(1);
  const events: EventPoint[] = [];
  let id = 0;
  for (const raw of items) {
    const item = raw.split(/<\/item>/i)[0];
    const title = field(item, "title");
    const lat = parseFloat(field(item, "geo:lat") ?? "");
    const lng = parseFloat(field(item, "geo:long") ?? "");
    if (!title || Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const et = field(item, "gdacs:eventtype") ?? "UNK";
    const type: EventPoint["type"] =
      et === "EQ" ? "earthquake" : et === "VO" ? "volcano" : et === "TC" || et === "FL" ? "weather" : "conflict";
    events.push({
      id: `gdacs-${id++}`,
      lat,
      lng,
      name: title,
      url: field(item, "link") ?? "",
      type,
    });
  }
  return { events, total: events.length };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  try {
    const { data } = await cachedJson("gdelt", 300, produce, { staleTtlSeconds: 3600 });
    return NextResponse.json(
      { ...data, timestamp: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    logger.error("[intel-gdelt] GDACS feed unavailable", {
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // audit-ignore: honest-failure — the empty array is paired with a 502 and an
    // explicit `error` field, so the client cannot read this as a successful
    // empty result. Not synthetic data; the upstream error is logged above.
    return NextResponse.json(
      { events: [], total: 0, error: "GDACS unavailable" },
      { status: 502 },
    );
  }
}

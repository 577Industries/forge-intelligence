/**
 * Forge Intelligence — conflict-zone feed.
 *
 * A curated set of active conflict/tension anchors (public geopolitical
 * knowledge) enriched with a best-effort live event count from world-news RSS.
 * Passive; honest fetch; KV-cached; rate-limited. Degrades to the static
 * anchors if the RSS enrichment fails — the zones always render.
 *
 * DISCLAIMER surfaced in-product: anchors are indicative, not authoritative;
 * severity + boundaries are editorial and may lag real events.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchText } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

type Severity = "war" | "high" | "elevated";

interface ConflictAnchor {
  id: string;
  label: string;
  severity: Severity;
  lat: number;
  lng: number;
  region: string;
  description: string;
  keywords: string[];
}

const CONFLICT_ANCHORS: ConflictAnchor[] = [
  { id: "ukraine", label: "Ukraine", severity: "war", lat: 48.5, lng: 31.2, region: "ukraine", description: "Active frontlines across eastern and southern regions.", keywords: ["ukraine"] },
  { id: "gaza", label: "Gaza", severity: "war", lat: 31.35, lng: 34.35, region: "gaza", description: "Military operations and humanitarian crisis in the Gaza Strip.", keywords: ["gaza", "israel hamas"] },
  { id: "sudan", label: "Sudan", severity: "war", lat: 15.0, lng: 30.0, region: "sudan", description: "Armed conflict between SAF and RSF factions.", keywords: ["sudan"] },
  { id: "myanmar", label: "Myanmar", severity: "war", lat: 19.5, lng: 96.5, region: "myanmar", description: "Military junta vs opposition forces.", keywords: ["myanmar"] },
  { id: "yemen", label: "Yemen", severity: "war", lat: 15.5, lng: 48.0, region: "yemen", description: "Houthi operations, Red Sea maritime threats, coalition strikes.", keywords: ["yemen", "houthi"] },
  { id: "drc", label: "DRC (East)", severity: "war", lat: -1.0, lng: 28.5, region: "drc", description: "M23 offensive and regional instability in eastern Congo.", keywords: ["congo", "m23"] },
  { id: "syria", label: "Syria", severity: "high", lat: 35.0, lng: 38.5, region: "syria", description: "Civil conflict and localized insurgencies.", keywords: ["syria"] },
  { id: "lebanon", label: "Lebanon", severity: "high", lat: 33.38, lng: 35.48, region: "lebanon", description: "Cross-border military operations in southern Lebanon.", keywords: ["lebanon", "hezbollah"] },
  { id: "sahel", label: "Sahel", severity: "high", lat: 14.0, lng: 5.0, region: "sahel", description: "Insurgencies and coups across Mali, Burkina Faso, Niger.", keywords: ["sahel", "mali", "burkina"] },
  { id: "somalia", label: "Somalia", severity: "high", lat: 5.0, lng: 46.0, region: "somalia", description: "Al-Shabaab insurgency and counter-terrorism operations.", keywords: ["somalia", "shabaab"] },
  { id: "red-sea", label: "Red Sea", severity: "high", lat: 16.0, lng: 40.0, region: "red-sea", description: "Anti-ship missile and drone attacks on maritime traffic.", keywords: ["red sea"] },
  { id: "taiwan-strait", label: "Taiwan Strait", severity: "elevated", lat: 24.0, lng: 119.5, region: "taiwan", description: "Elevated military drills and regional tension.", keywords: ["taiwan"] },
  { id: "korean-dmz", label: "Korean DMZ", severity: "elevated", lat: 38.3, lng: 127.0, region: "korea", description: "Cross-border tension and military posturing.", keywords: ["north korea", "korean"] },
];

const RSS_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.aljazeera.com/xml/rss/all.xml",
];

/** Best-effort: count world-news headlines matching each anchor's keywords. */
async function liveEventCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const feeds = await Promise.allSettled(
    RSS_FEEDS.map((url) => fiFetchText(url, { timeoutMs: 8000 })),
  );
  const titles: string[] = [];
  for (const feed of feeds) {
    if (feed.status !== "fulfilled") continue;
    for (const chunk of feed.value.split(/<item>/i).slice(1)) {
      const m =
        chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) ??
        chunk.match(/<title>(.*?)<\/title>/i);
      if (m) titles.push(m[1].replace(/<[^>]*>/g, "").toLowerCase());
    }
  }
  for (const title of titles) {
    for (const zone of CONFLICT_ANCHORS) {
      if (zone.keywords.some((k) => k.split(" ").every((t) => title.includes(t)))) {
        counts[zone.id] = (counts[zone.id] ?? 0) + 1;
        break;
      }
    }
  }
  return counts;
}

async function produce() {
  let counts: Record<string, number> = {};
  try {
    counts = await liveEventCounts();
  } catch {
    /* degrade to static anchors */
  }
  const zones = CONFLICT_ANCHORS.map((z) => ({
    ...z,
    eventCount: counts[z.id] ?? 0,
    lastUpdated: new Date().toISOString(),
  }));
  return {
    zones,
    totalZones: zones.length,
    activeWarzones: zones.filter((z) => z.severity === "war").length,
  };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;

  try {
    const { data } = await cachedJson("conflicts", 300, produce, {
      staleTtlSeconds: 3600,
    });
    return NextResponse.json(
      { ...data, timestamp: new Date().toISOString() },
      {
        headers: {
          "Cache-Control":
            "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch {
    return NextResponse.json(
      { zones: [], totalZones: 0, activeWarzones: 0, error: "unavailable" },
      { status: 502 },
    );
  }
}

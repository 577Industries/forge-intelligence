/**
 * Forge Intelligence — critical infrastructure (curated).
 *
 * A curated set of strategically significant infrastructure nodes — major
 * internet exchange points, nuclear plants, and grid interconnects — as
 * reference markers. Public knowledge; static; no key. Indicative, not an
 * exhaustive or operational asset inventory.
 */

import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const NODES = [
  // Internet exchange points
  { name: "DE-CIX Frankfurt", lat: 50.11, lng: 8.68, type: "ixp" },
  { name: "AMS-IX Amsterdam", lat: 52.37, lng: 4.90, type: "ixp" },
  { name: "LINX London", lat: 51.51, lng: -0.12, type: "ixp" },
  { name: "Equinix Ashburn (IAD)", lat: 39.02, lng: -77.46, type: "ixp" },
  { name: "IX.br São Paulo", lat: -23.55, lng: -46.63, type: "ixp" },
  { name: "HKIX Hong Kong", lat: 22.32, lng: 114.17, type: "ixp" },
  { name: "JPNAP Tokyo", lat: 35.68, lng: 139.77, type: "ixp" },
  { name: "NIXI Mumbai", lat: 19.08, lng: 72.88, type: "ixp" },
  // Nuclear power
  { name: "Kashiwazaki-Kariwa NPP", lat: 37.43, lng: 138.60, type: "nuclear" },
  { name: "Bruce NPP", lat: 44.32, lng: -81.60, type: "nuclear" },
  { name: "Zaporizhzhia NPP", lat: 47.51, lng: 34.59, type: "nuclear" },
  { name: "Gravelines NPP", lat: 51.01, lng: 2.14, type: "nuclear" },
  { name: "Palo Verde NGS", lat: 33.39, lng: -112.86, type: "nuclear" },
  // Grid / energy interconnects
  { name: "Three Gorges Dam", lat: 30.82, lng: 111.00, type: "grid" },
  { name: "Itaipu Dam", lat: -25.41, lng: -54.59, type: "grid" },
  { name: "Grand Inga (planned)", lat: -5.53, lng: 13.62, type: "grid" },
];

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  return NextResponse.json(
    {
      nodes: NODES,
      total: NODES.length,
      note: "Indicative reference set of critical infrastructure; not an exhaustive inventory.",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=86400" } },
  );
}

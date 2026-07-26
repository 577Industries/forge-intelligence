/**
 * Forge Intelligence — cyber activity (curated, indicative).
 *
 * There is no reliable keyless live global cyber-attack feed, and the upstream
 * layer was a simulated attack animation. Rather than fabricate live "attacks",
 * this serves a curated, clearly-labelled set of significant cyber-activity
 * hubs (national cyber commands / CERTs and regions associated with major
 * threat activity) as indicative reference markers. Static; no key.
 *
 * DISCLAIMER (surfaced in-product): indicative reference only — not real-time
 * attack telemetry and not attribution.
 */

import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const HUBS = [
  { name: "US Cyber Command (Fort Meade)", lat: 39.108, lng: -76.771, kind: "command" },
  { name: "NCSC-UK (London)", lat: 51.505, lng: -0.09, kind: "cert" },
  { name: "ANSSI (Paris)", lat: 48.857, lng: 2.295, kind: "cert" },
  { name: "BSI (Bonn)", lat: 50.735, lng: 7.10, kind: "cert" },
  { name: "CISA (Arlington)", lat: 38.88, lng: -77.11, kind: "cert" },
  { name: "CERT-In (New Delhi)", lat: 28.61, lng: 77.21, kind: "cert" },
  { name: "JPCERT/CC (Tokyo)", lat: 35.68, lng: 139.77, kind: "cert" },
  { name: "Cyber activity — E. Europe", lat: 55.75, lng: 37.62, kind: "activity" },
  { name: "Cyber activity — E. Asia", lat: 39.90, lng: 116.40, kind: "activity" },
  { name: "Cyber activity — Middle East", lat: 35.70, lng: 51.42, kind: "activity" },
  { name: "Cyber activity — DPRK", lat: 39.02, lng: 125.75, kind: "activity" },
];

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  return NextResponse.json(
    {
      hubs: HUBS,
      total: HUBS.length,
      note: "Indicative cyber-activity reference set — not real-time telemetry or attribution.",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=86400" } },
  );
}

/**
 * Forge Intelligence — CCTV networks (curated, open-data only).
 *
 * The upstream Osiris CCTV layer aggregated 2,000+ cameras, including
 * hot-linked YouTube/EarthCam/sheriff feeds we deliberately do NOT re-serve
 * (copyright/privacy/ToS). This is a curated set of public open-data traffic
 * camera NETWORKS with their official portal links — markers link out; no
 * stream is embedded or proxied. Static; no key.
 */

import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const NETWORKS = [
  { id: "tfl", name: "TfL JamCams", lat: 51.507, lng: -0.128, operator: "Transport for London", url: "https://www.tfl.gov.uk/traffic/status" },
  { id: "wsdot", name: "WSDOT Cameras", lat: 47.606, lng: -122.332, operator: "Washington State DOT", url: "https://wsdot.com/travel/real-time/map" },
  { id: "caltrans", name: "Caltrans QuickMap", lat: 34.052, lng: -118.244, operator: "California DOT", url: "https://quickmap.dot.ca.gov/" },
  { id: "nycdot", name: "NYC DOT Traffic Cams", lat: 40.713, lng: -74.006, operator: "NYC DOT", url: "https://webcams.nyctmc.org/" },
  { id: "511on", name: "Ontario 511", lat: 43.653, lng: -79.383, operator: "Ontario MTO", url: "https://511on.ca/" },
  { id: "drivebc", name: "DriveBC", lat: 49.283, lng: -123.121, operator: "British Columbia MOT", url: "https://drivebc.ca/" },
  { id: "vicroads", name: "VicTraffic", lat: -37.814, lng: 144.963, operator: "VicRoads (AU)", url: "https://traffic.vicroads.vic.gov.au/" },
  { id: "ndw", name: "NDW Open Data", lat: 52.09, lng: 5.12, operator: "Nationaal Dataportaal Wegverkeer (NL)", url: "https://opendata.ndw.nu/" },
  { id: "sgdata", name: "Singapore Traffic Cams", lat: 1.352, lng: 103.82, operator: "data.gov.sg (LTA)", url: "https://data.gov.sg/" },
  { id: "asfinag", name: "ASFINAG Webcams", lat: 48.209, lng: 16.363, operator: "ASFINAG (AT)", url: "https://www.asfinag.at/verkehr/webcams/" },
  { id: "fl511", name: "FL511 Cameras", lat: 27.994, lng: -81.76, operator: "Florida DOT", url: "https://fl511.com/" },
];

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  return NextResponse.json(
    {
      networks: NETWORKS,
      total: NETWORKS.length,
      note: "Curated public open-data traffic-camera networks; markers link to official portals.",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=86400" } },
  );
}

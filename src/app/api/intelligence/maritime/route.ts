/**
 * Forge Intelligence — maritime intelligence (static).
 *
 * Global ports (container / energy / naval) + strategic chokepoints. This is
 * curated reference data (public geographic/maritime knowledge), so the route
 * is a fast static serve — no external fetch, no key.
 *
 * NOTE: live AIS vessel tracking (upstream aisstream.io WebSocket) is NOT
 * ported — you cannot host a WebSocket server on Vercel serverless. A polled
 * REST AIS source or the VPS tier is the path for live vessels.
 */

import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const PORTS = [
  // Container
  { name: "Shanghai", lat: 31.23, lng: 121.47, type: "container" as const },
  { name: "Singapore", lat: 1.26, lng: 103.84, type: "container" as const },
  { name: "Ningbo-Zhoushan", lat: 29.87, lng: 121.55, type: "container" as const },
  { name: "Shenzhen", lat: 22.54, lng: 114.05, type: "container" as const },
  { name: "Busan", lat: 35.1, lng: 129.04, type: "container" as const },
  { name: "Rotterdam", lat: 51.9, lng: 4.5, type: "container" as const },
  { name: "Dubai (Jebel Ali)", lat: 25.01, lng: 55.06, type: "container" as const },
  { name: "Port Klang", lat: 2.99, lng: 101.39, type: "container" as const },
  { name: "Antwerp", lat: 51.3, lng: 4.4, type: "container" as const },
  { name: "Hamburg", lat: 53.55, lng: 9.97, type: "container" as const },
  { name: "Los Angeles", lat: 33.74, lng: -118.27, type: "container" as const },
  { name: "Long Beach", lat: 33.75, lng: -118.19, type: "container" as const },
  { name: "Savannah", lat: 32.08, lng: -81.09, type: "container" as const },
  { name: "Felixstowe", lat: 51.96, lng: 1.35, type: "container" as const },
  { name: "Colombo", lat: 6.94, lng: 79.84, type: "container" as const },
  { name: "Santos", lat: -23.95, lng: -46.31, type: "container" as const },
  // Energy
  { name: "Ras Tanura", lat: 26.64, lng: 50.16, type: "energy" as const },
  { name: "Fujairah", lat: 25.14, lng: 56.35, type: "energy" as const },
  { name: "Novorossiysk", lat: 44.72, lng: 37.77, type: "energy" as const },
  { name: "Houston Ship Channel", lat: 29.73, lng: -95.27, type: "energy" as const },
  { name: "Kharg Island", lat: 29.24, lng: 50.33, type: "energy" as const },
  { name: "Primorsk", lat: 60.35, lng: 28.7, type: "energy" as const },
  // Naval
  { name: "Norfolk Naval Station", lat: 36.95, lng: -76.33, type: "naval" as const },
  { name: "San Diego Naval Base", lat: 32.69, lng: -117.15, type: "naval" as const },
  { name: "Pearl Harbor", lat: 21.35, lng: -157.97, type: "naval" as const },
  { name: "Yokosuka", lat: 35.28, lng: 139.67, type: "naval" as const },
  { name: "Severomorsk", lat: 69.07, lng: 33.42, type: "naval" as const },
  { name: "Tartus", lat: 34.89, lng: 35.89, type: "naval" as const },
  { name: "Zhanjiang", lat: 21.2, lng: 110.39, type: "naval" as const },
  { name: "Portsmouth", lat: 50.8, lng: -1.11, type: "naval" as const },
  { name: "Toulon", lat: 43.12, lng: 5.93, type: "naval" as const },
  { name: "Changi Naval Base", lat: 1.33, lng: 104.01, type: "naval" as const },
  { name: "Visakhapatnam", lat: 17.69, lng: 83.3, type: "naval" as const },
];

const CHOKEPOINTS = [
  { name: "Strait of Hormuz", lat: 26.57, lng: 56.25, risk: "HIGH" as const },
  { name: "Strait of Malacca", lat: 2.5, lng: 101.5, risk: "MODERATE" as const },
  { name: "Suez Canal", lat: 30.43, lng: 32.34, risk: "ELEVATED" as const },
  { name: "Bab el-Mandeb", lat: 12.58, lng: 43.33, risk: "CRITICAL" as const },
  { name: "Panama Canal", lat: 9.08, lng: -79.68, risk: "LOW" as const },
  { name: "Turkish Straits", lat: 41.12, lng: 29.07, risk: "MODERATE" as const },
  { name: "Danish Straits", lat: 55.7, lng: 12.6, risk: "LOW" as const },
  { name: "Cape of Good Hope", lat: -34.36, lng: 18.47, risk: "LOW" as const },
  { name: "Taiwan Strait", lat: 24.0, lng: 119.0, risk: "ELEVATED" as const },
  { name: "Lombok Strait", lat: -8.47, lng: 115.72, risk: "LOW" as const },
];

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;

  return NextResponse.json(
    {
      ports: PORTS,
      chokepoints: CHOKEPOINTS,
      totalPorts: PORTS.length,
      totalChokepoints: CHOKEPOINTS.length,
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=86400" } },
  );
}

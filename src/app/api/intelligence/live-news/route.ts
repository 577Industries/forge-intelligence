/**
 * Forge Intelligence — live broadcast network (static).
 *
 * Curated 24/7 news broadcasters with locations and playback metadata.
 * Static reference data (public broadcaster info) — no key, no scrape.
 *
 * Playback policy: channels that permit embedding are played through
 * YouTube's OFFICIAL privacy-preserving player (youtube-nocookie), which is
 * the sanctioned embedding mechanism. We never proxy, re-host or re-serve a
 * stream. Channels that block embedding open externally instead.
 */

import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

interface Feed {
  id: string;
  name: string;
  city: string;
  lat: number;
  lng: number;
  lang: string;
  /** YouTube channel id, used with the official live embed player. */
  channelId: string;
  /** False when the broadcaster blocks embedding — we link out instead. */
  embeddable: boolean;
  url: string;
}

const FEEDS: Feed[] = [
  // Sky News returns "Video unavailable" in the embed player (verified
  // 2026-07-22) — the broadcaster restricts embedded playback. Link out
  // rather than render a dead frame.
  { id: "skynews", name: "Sky News", city: "London", lat: 51.5, lng: -0.118, lang: "en", channelId: "UCoMdktPbSTixAyNGwb-UYkQ", embeddable: false, url: "https://www.youtube.com/@SkyNews/live" },
  { id: "france24en", name: "France 24 EN", city: "Paris", lat: 48.83, lng: 2.28, lang: "en", channelId: "UCQfwfsi5VrQ8yKZ-UWmAEFg", embeddable: true, url: "https://www.youtube.com/@FRANCE24English/live" },
  { id: "dwnews", name: "DW News", city: "Berlin", lat: 52.508, lng: 13.376, lang: "en", channelId: "UCknLrEdhRCp1aegoMqRaCZg", embeddable: true, url: "https://www.youtube.com/@dwnews/live" },
  { id: "aljazeera", name: "Al Jazeera EN", city: "Doha", lat: 25.286, lng: 51.534, lang: "en", channelId: "UCNye-wNBqNL5ZzHSJj3l8Bg", embeddable: true, url: "https://www.youtube.com/@aljazeeraenglish/live" },
  { id: "nhkworld", name: "NHK World", city: "Tokyo", lat: 35.69, lng: 139.692, lang: "en", channelId: "UCSPEjw8F2nQDtmUKPFNF7_A", embeddable: true, url: "https://www.youtube.com/@nhkworldjapan/live" },
  { id: "cna", name: "CNA 24/7", city: "Singapore", lat: 1.29, lng: 103.852, lang: "en", channelId: "UC83jt4dlz1Gjl58fzQrrKZg", embeddable: true, url: "https://www.youtube.com/@ChannelNewsAsia/live" },
  { id: "wion", name: "WION", city: "New Delhi", lat: 28.614, lng: 77.209, lang: "en", channelId: "UC_gUM8rL-Lrg6O3adPW9K1g", embeddable: true, url: "https://www.youtube.com/@WION/live" },
  { id: "nbcnews", name: "NBC News NOW", city: "New York", lat: 40.759, lng: -73.98, lang: "en", channelId: "UCeY0bbntWzzVIaj2z3QigXg", embeddable: false, url: "https://www.youtube.com/@NBCNews/live" },
  { id: "cbsnews", name: "CBS News 24/7", city: "New York", lat: 40.764, lng: -73.973, lang: "en", channelId: "UC8p1vwvWtl6T73JiExfWs1g", embeddable: false, url: "https://www.youtube.com/@CBSNews/live" },
  { id: "abcnews", name: "ABC News Live", city: "New York", lat: 40.763, lng: -73.979, lang: "en", channelId: "UCBi2mrWuNuyYy4gbM6fU18Q", embeddable: false, url: "https://www.youtube.com/@ABCNews/live" },
  { id: "cspan", name: "C-SPAN", city: "Washington DC", lat: 38.897, lng: -77.036, lang: "en", channelId: "UCb--64Gl51jIEVE-GLDAVTg", embeddable: false, url: "https://www.youtube.com/@cspan/live" },
  { id: "cbc", name: "CBC News", city: "Toronto", lat: 43.644, lng: -79.387, lang: "en", channelId: "UCKy1dAqELon0zgzZPOz9SVw", embeddable: false, url: "https://www.youtube.com/@CBCNews/live" },
];

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-feed", getClientIp(req));
  if (limited) return limited;
  return NextResponse.json(
    {
      feeds: FEEDS,
      total: FEEDS.length,
      note: "Embeddable channels play via YouTube's official player; others open externally. No stream is proxied or re-hosted.",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, s-maxage=86400" } },
  );
}

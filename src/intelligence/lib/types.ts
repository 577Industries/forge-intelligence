/**
 * Forge Intelligence — shared client data shapes for the map layers.
 * Mirrors the /api/intelligence/* response envelopes the console consumes.
 * Keyed by fetch-domain (the layer catalog's fetchKey).
 */

export interface QuakePoint {
  lat: number;
  lng: number;
  magnitude: number | null;
  place: string | null;
  depth: number;
}

export interface FirePoint {
  lat: number;
  lng: number;
  type: "fire" | "volcano";
  frp: number;
}

export interface ConflictZone {
  id: string;
  label: string;
  severity: "war" | "high" | "elevated";
  lat: number;
  lng: number;
  description: string;
  eventCount: number;
}

export interface FlightPoint {
  lat: number;
  lng: number;
  callsign: string;
  category: "military" | "emergency";
  alt: number | null;
  heading: number;
}

export interface PortPoint {
  lat: number;
  lng: number;
  name: string;
  type: "container" | "energy" | "naval";
}

export interface ChokepointPoint {
  lat: number;
  lng: number;
  name: string;
  risk: "CRITICAL" | "HIGH" | "ELEVATED" | "MODERATE" | "LOW";
}

export interface EventPoint {
  lat: number;
  lng: number;
  name: string;
  type: "earthquake" | "weather" | "volcano" | "conflict";
}

export interface NewsFeed {
  id: string;
  lat: number;
  lng: number;
  name: string;
  city: string;
  /** YouTube channel id for the official live embed player. */
  channelId: string;
  /** False when the broadcaster blocks embedding — open externally instead. */
  embeddable: boolean;
  url: string;
}

export interface WeatherPoint {
  lat: number;
  lng: number;
  title: string;
  category: string;
}

export interface SatPoint {
  lat: number;
  lng: number;
  alt: number;
  name: string;
}

export interface AuroraPoint {
  lat: number;
  lng: number;
  prob: number;
}

export interface CctvNetwork {
  lat: number;
  lng: number;
  name: string;
  operator: string;
  url: string;
}

export interface InfraNode {
  lat: number;
  lng: number;
  name: string;
  type: "ixp" | "nuclear" | "grid";
}

export interface CyberHub {
  lat: number;
  lng: number;
  name: string;
  kind: "command" | "cert" | "activity";
}

/** Keyed by layer fetch-domain; each holds the raw API response envelope. */
export interface IntelData {
  earthquakes?: { earthquakes: QuakePoint[] };
  fires?: { fires: FirePoint[] };
  conflicts?: { zones: ConflictZone[] };
  flights?: { flights: FlightPoint[] };
  maritime?: { ports: PortPoint[]; chokepoints: ChokepointPoint[] };
  gdelt?: { events: EventPoint[] };
  "live-news"?: { feeds: NewsFeed[] };
  weather?: { weather: WeatherPoint[] };
  satellites?: { satellites: SatPoint[] };
  "space-weather"?: { aurora: AuroraPoint[] };
  cctv?: { networks: CctvNetwork[] };
  infrastructure?: { nodes: InfraNode[] };
  "cyber-attacks"?: { hubs: CyberHub[] };
}

/**
 * Forge Intelligence — intelligence-layer catalog.
 *
 * The data model driving the layer rail and the fetch-dedup logic. Each
 * layer maps to a data domain served (in Phase 2) from /api/intelligence/*.
 * `fetchKey` collapses sub-toggles (e.g. flight classes) onto one endpoint,
 * so the console fetches a domain once regardless of how many of its layers
 * are enabled.
 */

export type LayerGroupId =
  | "aviation"
  | "maritime"
  | "space"
  | "surveil"
  | "hazard"
  | "threat"
  | "network"
  | "display";

export interface LayerDef {
  /** Stable key, also the activeLayers map key. */
  id: string;
  label: string;
  /** Endpoint domain under /api/intelligence; sub-toggles share one. */
  fetchKey: string | null;
  defaultOn?: boolean;
  /** Short description for the rail tooltip. */
  hint?: string;
  /**
   * Re-poll cadence while the layer is enabled. Omitted for domains whose
   * data is static reference material (ports, chokepoints, CCTV networks,
   * broadcaster list) — re-fetching those is pure waste.
   *
   * Cadence tracks how fast the underlying feed actually moves, not how fast
   * we could ask: satellite positions are recomputed per request, aircraft
   * move continuously, while USGS/GDELT publish in minutes and FIRMS in
   * hours. Server-side KV TTLs sit under these, so most polls hit warm cache.
   */
  refreshMs?: number;
}

/** Poll cadences, in ms. Named so the catalog reads as intent, not magic numbers. */
const SECONDS = 1000;
const MINUTES = 60 * SECONDS;

export interface LayerGroup {
  id: LayerGroupId;
  label: string;
  layers: LayerDef[];
}

export const LAYER_GROUPS: readonly LayerGroup[] = [
  {
    id: "aviation",
    label: "Aviation",
    layers: [
      // One toggle, because one feed. /api/intelligence/flights serves exactly
      // two categories — military airframes and 7700 emergency squawks — so a
      // "Commercial" or "Private" toggle would render military traffic under a
      // civil label. Split this only when a licensed commercial ADS-B feed
      // actually backs the extra toggles.
      { id: "flights_military", label: "Military & emergency", fetchKey: "flights", hint: "Military airframes and 7700 emergency squawks", refreshMs: 45 * SECONDS },
    ],
  },
  {
    id: "maritime",
    label: "Maritime",
    layers: [
      { id: "maritime", label: "Vessels & ports", fetchKey: "maritime", defaultOn: true },
      { id: "chokepoints", label: "Chokepoints", fetchKey: "maritime" },
    ],
  },
  {
    id: "space",
    label: "Space",
    layers: [
      { id: "satellites", label: "Satellites", fetchKey: "satellites", refreshMs: 20 * SECONDS },
      { id: "space_weather", label: "Solar weather", fetchKey: "space-weather", refreshMs: 15 * MINUTES },
    ],
  },
  {
    id: "surveil",
    label: "Surveillance",
    layers: [
      { id: "cctv", label: "CCTV network", fetchKey: "cctv", defaultOn: true },
      { id: "live_news", label: "Live broadcasts", fetchKey: "live-news", defaultOn: true },
    ],
  },
  {
    id: "hazard",
    label: "Hazard",
    layers: [
      { id: "earthquakes", label: "Seismic (M2.5+)", fetchKey: "earthquakes", defaultOn: true, refreshMs: 5 * MINUTES },
      { id: "fires", label: "Active fires", fetchKey: "fires", refreshMs: 15 * MINUTES },
      { id: "weather", label: "Severe weather", fetchKey: "weather", refreshMs: 15 * MINUTES },
    ],
  },
  {
    id: "threat",
    label: "Threat",
    layers: [
      { id: "conflicts", label: "Conflict zones", fetchKey: "conflicts", defaultOn: true, refreshMs: 5 * MINUTES },
      { id: "cyber", label: "Cyber attacks", fetchKey: "cyber-attacks", refreshMs: 5 * MINUTES },
      { id: "news_intel", label: "News intel (GDELT)", fetchKey: "gdelt", defaultOn: true, refreshMs: 5 * MINUTES },
    ],
  },
  {
    id: "network",
    label: "Network",
    layers: [
      { id: "infrastructure", label: "Infrastructure", fetchKey: "infrastructure" },
    ],
  },
  {
    id: "display",
    label: "Display",
    layers: [
      { id: "day_night", label: "Day / night terminator", fetchKey: null, defaultOn: true, hint: "Solar illumination overlay (client-computed)" },
    ],
  },
] as const;

/** Flat map of every layer id → default on/off state. */
export function defaultActiveLayers(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const group of LAYER_GROUPS) {
    for (const layer of group.layers) out[layer.id] = Boolean(layer.defaultOn);
  }
  return out;
}

/**
 * Fetch-domain → poll cadence, derived from the catalog.
 *
 * Sub-toggles share one endpoint (the three aviation classes hit `flights`),
 * so a domain polls at the FASTEST cadence any of its layers asks for —
 * anything slower would starve that layer.
 */
export const REFRESH_MS_BY_DOMAIN: Readonly<Record<string, number>> = (() => {
  const out: Record<string, number> = {};
  for (const group of LAYER_GROUPS) {
    for (const layer of group.layers) {
      if (!layer.fetchKey || !layer.refreshMs) continue;
      const prev = out[layer.fetchKey];
      out[layer.fetchKey] = prev ? Math.min(prev, layer.refreshMs) : layer.refreshMs;
    }
  }
  return out;
})();

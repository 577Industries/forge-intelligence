/**
 * Deterministic Forge Intelligence feed fixtures.
 *
 * Shapes mirror the `/api/intelligence/*` envelopes in
 * `src/intelligence/lib/types.ts`. Values are fixed so entity counts, popup
 * text and rail state are assertable — the live feeds move constantly, so a
 * suite that talked to them could only assert "something rendered".
 *
 * One record deliberately carries hostile HTML (`conflicts[1].label`) so the
 * popup escaping boundary is exercised end-to-end, not only in the unit test.
 */

export const XSS_PROBE = '<img src=x onerror="window.__xss=1">';

export const INTEL_FEEDS = {
  earthquakes: {
    earthquakes: [
      { lat: 38.2, lng: 142.1, magnitude: 6.4, place: "off the coast of Honshu", depth: 24 },
      { lat: -21.5, lng: -68.3, magnitude: 5.1, place: "Antofagasta, Chile", depth: 110 },
      { lat: 61.2, lng: -149.9, magnitude: 3.2, place: "Anchorage, Alaska", depth: 41 },
    ],
  },
  fires: {
    fires: [
      { lat: -3.1, lng: -60.0, type: "fire", frp: 42.5 },
      { lat: 37.7, lng: 14.0, type: "volcano", frp: 310.2 },
    ],
  },
  conflicts: {
    zones: [
      {
        id: "ukraine",
        label: "Ukraine",
        severity: "war",
        lat: 48.5,
        lng: 31.2,
        description: "Active frontlines across the east.",
        eventCount: 128,
      },
      {
        id: "probe",
        label: XSS_PROBE,
        severity: "elevated",
        lat: 12.0,
        lng: 45.0,
        description: XSS_PROBE,
        eventCount: 3,
      },
    ],
  },
  flights: {
    flights: [
      { lat: 21.35, lng: -157.71, callsign: "HAMR01", category: "military", alt: 8200, heading: 50 },
      { lat: 51.48, lng: -0.45, callsign: "RRR7412", category: "military", alt: 11000, heading: 275 },
      { lat: 35.68, lng: 139.69, callsign: "SQUAWK77", category: "emergency", alt: 3400, heading: 190 },
    ],
  },
  maritime: {
    ports: [
      { lat: 31.23, lng: 121.47, name: "Shanghai", type: "container" },
      { lat: 1.26, lng: 103.84, name: "Singapore", type: "container" },
      { lat: 26.0, lng: 50.6, name: "Ras Tanura", type: "energy" },
    ],
    chokepoints: [
      { lat: 26.57, lng: 56.25, name: "Strait of Hormuz", risk: "CRITICAL" },
      { lat: 12.58, lng: 43.33, name: "Bab el-Mandeb", risk: "HIGH" },
    ],
  },
  gdelt: {
    events: [
      { lat: -14.8, lng: 26.3, name: "Forest fire notification in Zambia", type: "weather" },
      { lat: 14.6, lng: 121.0, name: "Tropical cyclone advisory", type: "weather" },
    ],
  },
  "live-news": {
    feeds: [
      {
        id: "skynews",
        lat: 51.5,
        lng: -0.118,
        name: "Sky News",
        city: "London",
        channelId: "UCoMdktPbSTixAyNGwb-UYkQ",
        embeddable: false,
        url: "https://www.youtube.com/@SkyNews",
      },
    ],
  },
  weather: {
    weather: [{ lat: 22.4, lng: 115.1, title: "Typhoon Noul", category: "Severe Storms" }],
  },
  satellites: {
    satellites: [
      { lat: 27.0, lng: -53.3, alt: 922, name: "ATLAS CENTAUR 2" },
      { lat: 67.6, lng: -110.5, alt: 830, name: "THOR ABLESTAR" },
    ],
  },
  "space-weather": {
    aurora: [
      { lat: 67, lng: 20, prob: 65 },
      { lat: -67, lng: 140, prob: 40 },
    ],
  },
  cctv: {
    networks: [
      {
        lat: 51.507,
        lng: -0.128,
        name: "TfL JamCams",
        operator: "Transport for London",
        url: "https://www.tfl.gov.uk/traffic/status",
      },
    ],
  },
  infrastructure: {
    nodes: [
      { lat: 50.11, lng: 8.68, name: "DE-CIX Frankfurt", type: "ixp" },
      { lat: 45.35, lng: 4.75, name: "Bugey Nuclear", type: "nuclear" },
    ],
  },
  "cyber-attacks": {
    hubs: [{ lat: 39.108, lng: -76.771, name: "US Cyber Command", kind: "command" }],
  },
  ticker: {
    kp: 2.3,
    kpLevel: "quiet",
    largestQuake: { magnitude: 6.4, place: "off the coast of Honshu" },
    significantQuakes: 3,
    quotes: [],
    marketsConfigured: false,
  },
} as const;

/** Total map-plottable entities across every fixture domain. */
export const TOTAL_FIXTURE_ENTITIES =
  INTEL_FEEDS.earthquakes.earthquakes.length +
  INTEL_FEEDS.fires.fires.length +
  INTEL_FEEDS.conflicts.zones.length +
  INTEL_FEEDS.flights.flights.length +
  INTEL_FEEDS.maritime.ports.length +
  INTEL_FEEDS.maritime.chokepoints.length +
  INTEL_FEEDS.gdelt.events.length +
  INTEL_FEEDS["live-news"].feeds.length +
  INTEL_FEEDS.weather.weather.length +
  INTEL_FEEDS.satellites.satellites.length +
  INTEL_FEEDS["space-weather"].aurora.length +
  INTEL_FEEDS.cctv.networks.length +
  INTEL_FEEDS.infrastructure.nodes.length +
  INTEL_FEEDS["cyber-attacks"].hubs.length;

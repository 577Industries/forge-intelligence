"use client";

/**
 * Forge Intelligence — base map (WebGL globe) + live intelligence layers.
 *
 * Original 577i implementation. Renders a MapLibre GL globe with the CARTO
 * dark-matter basemap proxied through /api/intelligence/tiles (CSP-safe), a
 * client-computed day/night terminator, and the live geo-intel layers
 * (seismic / fires / conflict) rendered as GPU circle layers from the
 * console's fetched data. More domains (flights, maritime, …) land as their
 * routes ship.
 *
 * Must be dynamically imported with { ssr: false } — it touches WebGL/DOM.
 */

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

import { FI_API_BASE, FI_MAP_DEFAULTS } from "@/intelligence/lib/brand";
import { LAYER_POPUPS } from "@/intelligence/lib/popups";
import type { IntelData } from "@/intelligence/lib/types";

// OpenFreeMap's public instance: no key, no request cap, and commercial use is
// explicitly permitted. Attribution is mandatory, which is why the map mounts a
// real AttributionControl below rather than suppressing it.
const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/dark";
const PROXY_HOSTS = ["arcgisonline.com", "openfreemap.org"];

/**
 * Credits are not hardcoded here: MapLibre reads them from each source's
 * TileJSON, so OpenFreeMap/OpenMapTiles/OpenStreetMap arrive with the basemap
 * and the Esri credit appears only while the satellite layer is on. Adding a
 * `customAttribution` copy on top just renders every credit twice.
 *
 * The requirement this satisfies is that the control exists at all — see
 * docs/intelligence/data-sources.md, "Attribution obligations".
 */

export interface ForgeIntelMapProps {
  activeLayers: Record<string, boolean>;
  data: IntelData;
  projection?: "globe" | "mercator";
  /** Base imagery: vector basemap or satellite raster overlay. */
  mapStyle?: "map" | "satellite";
  /** Extruded building footprints (high zoom only). */
  buildings3d?: boolean;
  /** Fired on right-click so the console can open a region dossier. */
  onRightClick?: (coords: { lat: number; lng: number }) => void;
  /** Fired on cursor move for the coordinate readout. */
  onMouseCoords?: (coords: { lat: number; lng: number }) => void;
  /** Fired on camera move — drives the scale bar. */
  onViewState?: (v: { zoom: number; lat: number }) => void;
  /** Fired when a broadcast marker is clicked (feed id). */
  onBroadcastClick?: (feedId: string) => void;
  /** Imperative camera target (bump `ts` to re-trigger). */
  flyTo?: { lat: number; lng: number; zoom?: number; ts: number } | null;
}

const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const BUILDINGS_TILEJSON = "https://tiles.openfreemap.org/planet";

/** Map layer id → predicate over activeLayers deciding its visibility. */
const LAYER_VISIBILITY: Array<
  [string, (a: Record<string, boolean>) => boolean]
> = [
  ["fi-earthquakes", (a) => !!a.earthquakes],
  ["fi-fires", (a) => !!a.fires],
  ["fi-conflicts", (a) => !!a.conflicts],
  ["fi-flights", (a) => !!a.flights_military],
  ["fi-ports", (a) => !!a.maritime],
  ["fi-chokepoints", (a) => !!a.chokepoints],
  ["fi-gdelt", (a) => !!a.news_intel],
  ["fi-news", (a) => !!a.live_news],
  ["fi-weather", (a) => !!a.weather],
  ["fi-satellites", (a) => !!a.satellites],
  ["fi-aurora", (a) => !!a.space_weather],
  ["fi-cctv", (a) => !!a.cctv],
  ["fi-infra", (a) => !!a.infrastructure],
  ["fi-cyber", (a) => !!a.cyber],
];

/** Same table, keyed for creation-time lookup. */
const LAYER_VISIBILITY_BY_ID = new Map(LAYER_VISIBILITY);

type FC = GeoJSON.FeatureCollection<GeoJSON.Point>;

function fc<T extends { lat: number; lng: number }>(
  rows: T[],
  props: (r: T) => Record<string, unknown> = () => ({}),
): FC {
  return {
    type: "FeatureCollection",
    features: rows
      .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      .map((r) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [r.lng, r.lat] },
        properties: props(r),
      })),
  };
}

/** Solar terminator polygon (standard subsolar-point astronomy). */
function terminatorRing(now: Date): [number, number][] {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start) / 86_400_000);
  const declination = -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
  const decRad = (declination * Math.PI) / 180;
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const subsolarLng = (12 - utcHours) * 15;
  const ring: [number, number][] = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const lngRad = ((lng - subsolarLng) * Math.PI) / 180;
    ring.push([lng, (Math.atan(-Math.cos(lngRad) / Math.tan(decRad)) * 180) / Math.PI]);
  }
  const darkPole = declination >= 0 ? -90 : 90;
  ring.push([180, darkPole], [-180, darkPole], ring[0]);
  return ring;
}

function nightFeature(now: Date): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [terminatorRing(now)] },
    properties: {},
  };
}

export default function ForgeIntelMap({
  activeLayers,
  data,
  projection = "globe",
  mapStyle = "map",
  buildings3d = false,
  onRightClick,
  onMouseCoords,
  onViewState,
  onBroadcastClick,
  flyTo,
}: ForgeIntelMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  // Callback refs — the init effect runs once, so reading props directly in
  // its handlers would capture stale closures.
  const rightClickRef = useRef(onRightClick);
  const mouseCoordsRef = useRef(onMouseCoords);
  const viewStateRef = useRef(onViewState);
  const broadcastRef = useRef(onBroadcastClick);
  const newsBoundRef = useRef(false);
  /** Layer ids whose popup/cursor handlers are already attached. */
  const popupBoundRef = useRef<Set<string>>(new Set());
  const lastCoordEmit = useRef(0);
  const lastViewEmit = useRef(0);
  /** Latest toggles, for effects that must not re-run when they change. */
  const activeLayersRef = useRef(activeLayers);
  activeLayersRef.current = activeLayers;
  /** Per-domain envelope last pushed to the map, so upserts skip untouched domains. */
  const renderedRef = useRef<IntelData>({});
  rightClickRef.current = onRightClick;
  mouseCoordsRef.current = onMouseCoords;
  viewStateRef.current = onViewState;
  broadcastRef.current = onBroadcastClick;

  // Init once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: FI_MAP_DEFAULTS.center,
      zoom: FI_MAP_DEFAULTS.zoom,
      minZoom: FI_MAP_DEFAULTS.minZoom,
      maxZoom: FI_MAP_DEFAULTS.maxZoom,
      maxPitch: 85,
      // Basemap licences require visible credit, so the control stays on. It is
      // compact by default to keep the HUD clean; clicking expands it.
      attributionControl: { compact: true },
      transformRequest: (url) => {
        if (PROXY_HOSTS.some((h) => url.includes(h))) {
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          return { url: `${origin}${FI_API_BASE}/tiles?url=${encodeURIComponent(url)}` };
        }
        return { url };
      },
    });
    mapRef.current = map;

    // Surface MapLibre errors. Without this, a rejected style expression
    // throws inside the load listener and the whole setup aborts SILENTLY —
    // no layers, no ready flag, no console output.
    map.on("error", (e) => {
      console.error("[forge-intel] map error:", (e as { error?: unknown })?.error ?? e);
    });

    map.on("contextmenu", (e) => {
      rightClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    // Throttled — mousemove fires far too often to drive React state raw.
    map.on("mousemove", (e) => {
      const now = Date.now();
      if (now - lastCoordEmit.current < 120) return;
      lastCoordEmit.current = now;
      mouseCoordsRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    map.on("move", () => {
      const now = Date.now();
      if (now - lastViewEmit.current < 150) return;
      lastViewEmit.current = now;
      viewStateRef.current?.({
        zoom: map.getZoom(),
        lat: map.getCenter().lat,
      });
    });

    map.on("load", () => {
      try {
      try {
        map.setProjection({ type: projection });
      } catch {
        /* projection unsupported — ignore */
      }
      map.setSky?.({
        "sky-color": "#0a1420",
        "horizon-color": "#0d1b2a",
        "fog-color": "#04060b",
        "sky-horizon-blend": 0.5,
        "horizon-fog-blend": 0.6,
        "fog-ground-blend": 0.4,
      });
      // Satellite imagery — sits above the vector basemap, below everything
      // else. Tiles are proxied (allowlisted host) like the basemap.
      map.addSource("fi-satellite", {
        type: "raster",
        tiles: [SATELLITE_TILES],
        tileSize: 256,
        // Verbatim from the service's own `copyrightText` metadata — re-check
        // it when bumping the imagery layer; Esri revises the credited vendors.
        attribution: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community",
      });
      map.addLayer({
        id: "fi-satellite",
        type: "raster",
        source: "fi-satellite",
        layout: { visibility: mapStyle === "satellite" ? "visible" : "none" },
        paint: { "raster-opacity": 0.85 },
      });

      // Extruded building footprints — only meaningful at street zoom.
      map.addSource("fi-buildings", { type: "vector", url: BUILDINGS_TILEJSON });
      map.addLayer({
        id: "fi-buildings",
        type: "fill-extrusion",
        source: "fi-buildings",
        "source-layer": "building",
        minzoom: 13,
        layout: { visibility: buildings3d ? "visible" : "none" },
        paint: {
          // `coalesce` yields the generic `value` type, which MapLibre's
          // expression validator rejects where a number is required — it
          // throws inside addLayer. Coerce explicitly with to-number.
          "fill-extrusion-color": [
            "interpolate", ["linear"],
            ["to-number", ["coalesce", ["get", "render_height"], 10]],
            0, "#1b2436", 60, "#27405c", 200, "#38bdf8",
          ],
          "fill-extrusion-height": ["to-number", ["coalesce", ["get", "render_height"], 10]],
          "fill-extrusion-base": ["to-number", ["coalesce", ["get", "render_min_height"], 0]],
          "fill-extrusion-opacity": 0.75,
        },
      });

      map.addSource("fi-night", { type: "geojson", data: nightFeature(new Date()) });
      map.addLayer({
        id: "fi-night",
        type: "fill",
        source: "fi-night",
        paint: { "fill-color": "#000010", "fill-opacity": activeLayers.day_night ? 0.42 : 0 },
      });
      // Expose the map on a namespaced handle. Map popups need to call back
      // into the app (the upstream used a brand-named global for this), and it
      // makes the console inspectable from the console.
      (window as unknown as Record<string, unknown>).__forgeIntel = { map };
      setReady(true);
      } catch (err) {
        // Never let one bad layer silently kill the whole console.
        console.error("[forge-intel] map setup failed:", err);
        setReady(true);
      }
    });

    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
    };
    // Init runs once; subsequent changes handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the day/night terminator every 5 min.
  useEffect(() => {
    const id = setInterval(() => {
      const map = mapRef.current;
      if (!map || !ready) return;
      (map.getSource("fi-night") as maplibregl.GeoJSONSource | undefined)?.setData(
        nightFeature(new Date()),
      );
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [ready]);

  // Upsert the live-data circle layers whenever new data arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    // Only rebuild the domain that actually changed. `data` is replaced
    // wholesale on every feed update, so without this guard one domain's
    // refresh re-serialised GeoJSON for all fifteen layers. Each domain's
    // envelope is a fresh object only when that feed was re-fetched, so an
    // identity check is a sound change signal.
    const rendered = renderedRef.current;
    const changed = <K extends keyof IntelData>(key: K) => {
      if (rendered[key] === data[key]) return false;
      rendered[key] = data[key];
      return true;
    };

    // Ports and chokepoints are two layers off ONE envelope, so evaluate it
    // once — calling changed("maritime") per layer would report false for the
    // second and leave chokepoints unrendered.
    const maritimeChanged = changed("maritime");

    const upsert = (id: string, features: FC, addLayer: () => void) => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(features);
      } else {
        map.addSource(id, { type: "geojson", data: features });
        addLayer();
        // Layers are created visible by default, but several layers share one
        // fetch-domain (ports + chokepoints; the three aviation toggles), so a
        // fetch triggered by an ENABLED layer also creates its DISABLED
        // siblings. Apply visibility at creation or those siblings flash on.
        // Read through a ref so this effect need not depend on activeLayers.
        const isVisible = LAYER_VISIBILITY_BY_ID.get(id);
        if (isVisible && map.getLayer(id)) {
          map.setLayoutProperty(
            id,
            "visibility",
            isVisible(activeLayersRef.current) ? "visible" : "none",
          );
        }
      }
    };

    if (data.earthquakes?.earthquakes && changed("earthquakes")) {
      upsert(
        "fi-earthquakes",
        fc(data.earthquakes.earthquakes, (r) => ({
          mag: r.magnitude ?? 0,
          place: r.place ?? "Unknown location",
          depth: r.depth,
        })),
        () =>
          map.addLayer({
            id: "fi-earthquakes",
            type: "circle",
            source: "fi-earthquakes",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "mag"], 2, 3, 5, 9, 7, 16],
              "circle-color": [
                "interpolate", ["linear"], ["get", "mag"],
                2, "#38bdf8", 4, "#ffa500", 6, "#ff4d4d",
              ],
              "circle-opacity": 0.7,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(255,255,255,0.35)",
            },
          }),
      );
    }

    if (data.fires?.fires && changed("fires")) {
      upsert(
        "fi-fires",
        fc(data.fires.fires, (r) => ({
          volcano: r.type === "volcano" ? 1 : 0,
          kind: r.type,
          frp: r.frp,
        })),
        () =>
          map.addLayer({
            id: "fi-fires",
            type: "circle",
            source: "fi-fires",
            paint: {
              "circle-radius": ["case", ["==", ["get", "volcano"], 1], 6, 2.5],
              "circle-color": ["case", ["==", ["get", "volcano"], 1], "#ff4d4d", "#ff8c00"],
              "circle-opacity": 0.75,
            },
          }),
      );
    }

    if (data.conflicts?.zones && changed("conflicts")) {
      upsert(
        "fi-conflicts",
        fc(data.conflicts.zones, (r) => ({
          severity: r.severity,
          label: r.label,
          description: r.description,
          events: r.eventCount,
        })),
        () =>
          map.addLayer({
            id: "fi-conflicts",
            type: "circle",
            source: "fi-conflicts",
            paint: {
              "circle-radius": [
                "match", ["get", "severity"], "war", 11, "high", 8, "elevated", 6, 6,
              ],
              "circle-color": [
                "match", ["get", "severity"], "war", "#ff4d4d", "high", "#ffa500", "elevated", "#ffd700", "#ffd700",
              ],
              "circle-opacity": 0.28,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": [
                "match", ["get", "severity"], "war", "#ff4d4d", "high", "#ffa500", "elevated", "#ffd700", "#ffd700",
              ],
            },
          }),
      );
    }

    if (data.flights?.flights && changed("flights")) {
      upsert(
        "fi-flights",
        fc(data.flights.flights, (r) => ({
          emergency: r.category === "emergency" ? 1 : 0,
          callsign: r.callsign,
          category: r.category,
          alt: r.alt ?? "",
          heading: r.heading,
        })),
        () =>
          map.addLayer({
            id: "fi-flights",
            type: "circle",
            source: "fi-flights",
            paint: {
              "circle-radius": ["case", ["==", ["get", "emergency"], 1], 5, 3],
              "circle-color": ["case", ["==", ["get", "emergency"], 1], "#ff4d4d", "#38bdf8"],
              "circle-opacity": 0.85,
              "circle-stroke-width": 0.5,
              "circle-stroke-color": "rgba(255,255,255,0.4)",
            },
          }),
      );
    }

    if (data.maritime?.ports && maritimeChanged) {
      upsert(
        "fi-ports",
        fc(data.maritime.ports, (r) => ({ ptype: r.type, name: r.name })),
        () =>
          map.addLayer({
            id: "fi-ports",
            type: "circle",
            source: "fi-ports",
            paint: {
              "circle-radius": 4,
              "circle-color": [
                "match", ["get", "ptype"], "naval", "#38bdf8", "energy", "#ffa500", "container", "#00d4aa", "#00d4aa",
              ],
              "circle-opacity": 0.8,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(0,0,0,0.5)",
            },
          }),
      );
    }

    if (data.maritime?.chokepoints && maritimeChanged) {
      upsert(
        "fi-chokepoints",
        fc(data.maritime.chokepoints, (r) => ({ risk: r.risk, name: r.name })),
        () =>
          map.addLayer({
            id: "fi-chokepoints",
            type: "circle",
            source: "fi-chokepoints",
            paint: {
              "circle-radius": 7,
              "circle-color": "transparent",
              "circle-stroke-width": 2,
              "circle-stroke-color": [
                "match", ["get", "risk"],
                "CRITICAL", "#ff4d4d", "HIGH", "#ffa500", "ELEVATED", "#ffd700", "MODERATE", "#38bdf8", "#00d4aa",
              ],
            },
          }),
      );
    }

    if (data.gdelt?.events && changed("gdelt")) {
      upsert(
        "fi-gdelt",
        fc(data.gdelt.events, (r) => ({ etype: r.type, name: r.name })),
        () =>
          map.addLayer({
            id: "fi-gdelt",
            type: "circle",
            source: "fi-gdelt",
            paint: {
              "circle-radius": 4,
              "circle-color": [
                "match", ["get", "etype"],
                "weather", "#e040fb", "volcano", "#ff8c00", "earthquake", "#ffa500", "#448aff",
              ],
              "circle-opacity": 0.7,
            },
          }),
      );
    }

    if (data["live-news"]?.feeds && changed("live-news")) {
      upsert(
        "fi-news",
        fc(data["live-news"].feeds, (r) => ({ fid: r.id })),
        () =>
          map.addLayer({
            id: "fi-news",
            type: "circle",
            source: "fi-news",
            paint: {
              "circle-radius": 4,
              "circle-color": "#38bdf8",
              "circle-opacity": 0.9,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": "#ffffff",
            },
          }),
      );
      // Bind the broadcast click delegate once the layer exists.
      if (!newsBoundRef.current && map.getLayer("fi-news")) {
        newsBoundRef.current = true;
        map.on("click", "fi-news", (e) => {
          const fid = e.features?.[0]?.properties?.fid;
          if (typeof fid === "string") broadcastRef.current?.(fid);
        });
        map.on("mouseenter", "fi-news", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "fi-news", () => {
          map.getCanvas().style.cursor = "";
        });
      }
    }

    if (data.weather?.weather && changed("weather")) {
      upsert(
        "fi-weather",
        fc(data.weather.weather, (r) => ({ title: r.title, category: r.category })),
        () =>
          map.addLayer({
            id: "fi-weather",
            type: "circle",
            source: "fi-weather",
            paint: {
              "circle-radius": 5,
              "circle-color": "#e040fb",
              "circle-opacity": 0.5,
              "circle-stroke-width": 1,
              "circle-stroke-color": "#e040fb",
            },
          }),
      );
    }

    if (data.satellites?.satellites && changed("satellites")) {
      upsert(
        "fi-satellites",
        fc(data.satellites.satellites, (r) => ({ name: r.name, alt: r.alt })),
        () =>
          map.addLayer({
            id: "fi-satellites",
            type: "circle",
            source: "fi-satellites",
            paint: { "circle-radius": 2, "circle-color": "#00e676", "circle-opacity": 0.8 },
          }),
      );
    }

    if (data["space-weather"]?.aurora && changed("space-weather")) {
      upsert(
        "fi-aurora",
        fc(data["space-weather"].aurora, (r) => ({ prob: r.prob })),
        () =>
          map.addLayer({
            id: "fi-aurora",
            type: "circle",
            source: "fi-aurora",
            paint: { "circle-radius": 3, "circle-color": "#00ff88", "circle-opacity": 0.35, "circle-blur": 0.6 },
          }),
      );
    }

    if (data.cctv?.networks && changed("cctv")) {
      upsert(
        "fi-cctv",
        fc(data.cctv.networks, (r) => ({ name: r.name, operator: r.operator })),
        () =>
          map.addLayer({
            id: "fi-cctv",
            type: "circle",
            source: "fi-cctv",
            paint: { "circle-radius": 3, "circle-color": "#448aff", "circle-opacity": 0.85 },
          }),
      );
    }

    if (data.infrastructure?.nodes && changed("infrastructure")) {
      upsert(
        "fi-infra",
        fc(data.infrastructure.nodes, (r) => ({ itype: r.type, name: r.name })),
        () =>
          map.addLayer({
            id: "fi-infra",
            type: "circle",
            source: "fi-infra",
            paint: {
              "circle-radius": 4,
              "circle-color": [
                "match", ["get", "itype"], "nuclear", "#ffa500", "grid", "#38bdf8", "ixp", "#00d4aa", "#00d4aa",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(0,0,0,0.5)",
            },
          }),
      );
    }

    if (data["cyber-attacks"]?.hubs && changed("cyber-attacks")) {
      upsert(
        "fi-cyber",
        fc(data["cyber-attacks"].hubs, (r) => ({ ckind: r.kind, name: r.name })),
        () =>
          map.addLayer({
            id: "fi-cyber",
            type: "circle",
            source: "fi-cyber",
            paint: {
              "circle-radius": 5,
              "circle-color": ["match", ["get", "ckind"], "activity", "#ff4d4d", "#38bdf8"],
              "circle-opacity": 0.5,
              "circle-stroke-width": 1.5,
              "circle-stroke-color": ["match", ["get", "ckind"], "activity", "#ff4d4d", "#38bdf8"],
            },
          }),
      );
    }

    // Bind feature popups for any layer that now exists. Layers are created
    // lazily as their data arrives, so this runs after every upsert pass and
    // skips what it has already bound — MapLibre has no "off by layer" that
    // would make rebinding safe.
    for (const [layerId, render] of LAYER_POPUPS) {
      if (popupBoundRef.current.has(layerId) || !map.getLayer(layerId)) continue;
      popupBoundRef.current.add(layerId);

      map.on("click", layerId, (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        // Anchor on the click rather than the feature centroid — it keeps the
        // popup under the cursor for dense clusters where several markers
        // overlap within a few pixels.
        new maplibregl.Popup({ closeButton: true, maxWidth: "300px", className: "fi-popup" })
          .setLngLat(e.lngLat)
          .setHTML(render(feature.properties ?? {}))
          .addTo(map);
      });
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    }
  }, [data, ready]);

  // Toggle data-layer + night visibility from activeLayers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const [layerId, isVisible] of LAYER_VISIBILITY) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(
          layerId,
          "visibility",
          isVisible(activeLayers) ? "visible" : "none",
        );
      }
    }
    if (map.getLayer("fi-night")) {
      map.setPaintProperty("fi-night", "fill-opacity", activeLayers.day_night ? 0.42 : 0);
    }
    // No `data` dep: newly-created layers now get their visibility at creation
    // time (see `upsert`), so this only needs to run when the toggles change.
  }, [activeLayers, ready]);

  // Satellite imagery toggle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("fi-satellite")) return;
    map.setLayoutProperty(
      "fi-satellite",
      "visibility",
      mapStyle === "satellite" ? "visible" : "none",
    );
  }, [mapStyle, ready]);

  // 3D buildings toggle. Give the camera some pitch when enabling, otherwise
  // extrusions are invisible from straight overhead.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("fi-buildings")) return;
    map.setLayoutProperty(
      "fi-buildings",
      "visibility",
      buildings3d ? "visible" : "none",
    );
    if (buildings3d && map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 800 });
    if (!buildings3d && map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 600 });
  }, [buildings3d, ready]);

  // Imperative camera moves (search results, view presets).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !flyTo) return;
    map.flyTo({
      center: [flyTo.lng, flyTo.lat],
      zoom: flyTo.zoom ?? 6,
      duration: 1600,
      essential: true,
    });
  }, [flyTo, ready]);

  // React to projection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    try {
      map.setProjection({ type: projection });
    } catch {
      /* ignore */
    }
  }, [projection, ready]);

  return <div ref={containerRef} className="absolute inset-0 h-full w-full" />;
}

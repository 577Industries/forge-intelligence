"use client";

/**
 * Forge Intelligence — console.
 *
 * Full-screen WebGL globe plus the operator chrome: layer rail, map modes
 * (globe / 2D / satellite / 3D buildings), search, view presets, scale bar,
 * status ticker, live alerts, right-click region dossier, the RECON toolkit
 * and the AI analyst. Everything renders inside `.fi-root` / `.fi-viewport`
 * (scoped by app/layout.tsx) without touching the host document.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LayerRail } from "@/intelligence/components/LayerRail";
import {
  AnalystPanel,
  EntityGraph,
  LiveAlerts,
  LiveFeedViewer,
  RegionDossier,
  ReconPanel,
} from "@/intelligence/components/LazyPanels";
import {
  ScaleBar,
  SearchBox,
  ViewPresets,
  type FlyTarget,
} from "@/intelligence/components/MapControls";
import { StatusTicker } from "@/intelligence/components/StatusTicker";
import { FI_API_BASE, FI_PRODUCT } from "@/intelligence/lib/brand";
import { defaultActiveLayers, REFRESH_MS_BY_DOMAIN } from "@/intelligence/lib/layers";
import {
  isDue,
  LAYER_FETCH_KEYS,
  refreshDomains,
} from "@/intelligence/lib/refresh";
import type { IntelData } from "@/intelligence/lib/types";
import type { AnalystContext } from "@/lib/intelligence/analyst";

// WebGL/DOM — must be client-only.
const ForgeIntelMap = dynamic(
  () => import("@/intelligence/components/ForgeIntelMap"),
  {
    ssr: false,
    loading: () => (
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ color: "var(--color-fi-muted)", fontFamily: "var(--font-mono)" }}
      >
        Initializing globe…
      </div>
    ),
  },
);

type PanelId = "analyst" | "recon" | "alerts" | "graph";
const TOOLS: Array<{ label: string; panel: PanelId | null }> = [
  { label: "Recon", panel: "recon" },
  { label: "Graph", panel: "graph" },
  { label: "Alerts", panel: "alerts" },
  { label: "Search", panel: null },
  { label: "Analyst", panel: "analyst" },
];

export default function IntelligenceConsolePage() {
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>(
    () => defaultActiveLayers(),
  );
  const [projection, setProjection] = useState<"globe" | "mercator">("globe");
  const [mapStyle, setMapStyle] = useState<"map" | "satellite">("map");
  const [buildings3d, setBuildings3d] = useState(false);
  const [data, setData] = useState<IntelData>({});
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [view, setView] = useState({ zoom: 2.4, lat: 30 });
  const [dossier, setDossier] = useState<{ lat: number; lng: number } | null>(null);
  const [broadcastId, setBroadcastId] = useState<string | null>(null);
  const fetchedRef = useRef<Set<string>>(new Set());

  /** Per-domain last-success timestamp — drives the rail's freshness readout. */
  const [fetchedAt, setFetchedAt] = useState<Record<string, number>>({});
  // The polling effect needs the same timestamps but must NOT depend on them:
  // depending on `fetchedAt` would restart every interval on each successful
  // poll, so a domain would never actually reach its cadence. Written where
  // the timestamp is produced (never during render).
  const fetchedAtRef = useRef<Record<string, number>>({});

  // Tab visibility gates polling (see the live-refresh effect below).
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onVisibility = () => setVisible(!document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Panels are code-split (see LazyPanels) and so must not be mounted until
  // first use, or their chunks would load on first paint and save nothing.
  // Once opened a panel STAYS mounted — it owns conversation/query state that
  // an operator would not expect to lose by closing the panel — and the
  // `open` prop keeps driving visibility exactly as it did before.
  const [mountedPanels, setMountedPanels] = useState<ReadonlySet<PanelId>>(
    () => new Set(),
  );
  const togglePanel = useCallback((id: PanelId) => {
    setMountedPanels((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    setOpenPanel((v) => (v === id ? null : id));
  }, []);
  const closePanel = useCallback(() => setOpenPanel(null), []);

  const fetchDomain = useCallback((key: string) => {
    return fetch(`${FI_API_BASE}/${key}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        // Replace only this domain's envelope. The map keys its per-domain
        // upserts off envelope identity, so leaving siblings untouched is
        // what stops one feed's refresh rebuilding every other map layer.
        const at = Date.now();
        setData((prev) => ({ ...prev, [key]: json }));
        fetchedAtRef.current = { ...fetchedAtRef.current, [key]: at };
        setFetchedAt(fetchedAtRef.current);
      });
  }, []);

  // Fetch-dedup: pull each feed-domain the first time one of its layers is
  // enabled. Domains without a route yet 404 → left marked fetched.
  useEffect(() => {
    for (const [layerId, key] of LAYER_FETCH_KEYS) {
      if (!activeLayers[layerId] || fetchedRef.current.has(key)) continue;
      fetchedRef.current.add(key);
      fetchDomain(key).catch(() => fetchedRef.current.delete(key));
    }
  }, [activeLayers, fetchDomain]);

  // Live refresh. Volatile domains re-poll on the cadence declared in the
  // layer catalog, but ONLY while at least one of their layers is enabled and
  // the tab is actually being looked at: a backgrounded console should cost
  // the operator (and the upstream feeds) nothing. Hiding the tab tears the
  // timers down; revealing it re-runs this effect, which refreshes any domain
  // that went stale while hidden before restarting its interval.
  useEffect(() => {
    if (!visible) return;
    const enabled = refreshDomains(activeLayers);
    if (enabled.length === 0) return;

    const swallow = () => {}; // a failed poll keeps the last good data on screen
    const timers = enabled.map((key) => {
      // Catch up first if the domain went stale while the tab was hidden,
      // then settle into its cadence.
      if (isDue(key, fetchedAtRef.current, Date.now())) {
        fetchDomain(key).catch(swallow);
      }
      return window.setInterval(
        () => fetchDomain(key).catch(swallow),
        REFRESH_MS_BY_DOMAIN[key],
      );
    });
    return () => timers.forEach(clearInterval);
  }, [activeLayers, visible, fetchDomain]);

  // Console keyboard shortcuts. Scoped: ignored while typing, and only while
  // the console is mounted — they never leak into the rest of the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "/":
          e.preventDefault();
          document.querySelector<HTMLInputElement>("[data-fi-search]")?.focus();
          break;
        case "g":
          setProjection("globe");
          break;
        case "m":
          setProjection("mercator");
          break;
        case "s":
          setMapStyle((v) => (v === "satellite" ? "map" : "satellite"));
          break;
        case "b":
          setBuildings3d((v) => !v);
          break;
        case "r":
          togglePanel("recon");
          break;
        case "a":
          togglePanel("analyst");
          break;
        case "e":
          togglePanel("alerts");
          break;
        case "Escape":
          setOpenPanel(null);
          setDossier(null);
          setBroadcastId(null);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  const activeCount = useMemo(
    () => Object.values(activeLayers).filter(Boolean).length,
    [activeLayers],
  );

  const entityCount = useMemo(
    () =>
      (data.earthquakes?.earthquakes?.length ?? 0) +
      (data.fires?.fires?.length ?? 0) +
      (data.conflicts?.zones?.length ?? 0) +
      (data.flights?.flights?.length ?? 0) +
      (data.maritime?.ports?.length ?? 0) +
      (data.maritime?.chokepoints?.length ?? 0) +
      (data.gdelt?.events?.length ?? 0) +
      (data["live-news"]?.feeds?.length ?? 0) +
      (data.weather?.weather?.length ?? 0) +
      (data.satellites?.satellites?.length ?? 0) +
      (data["space-weather"]?.aurora?.length ?? 0) +
      (data.cctv?.networks?.length ?? 0) +
      (data.infrastructure?.nodes?.length ?? 0) +
      (data["cyber-attacks"]?.hubs?.length ?? 0),
    [data],
  );

  const analystContext: AnalystContext = useMemo(
    () => ({
      activeLayers: Object.entries(activeLayers)
        .filter(([, on]) => on)
        .map(([id]) => id),
      entityCounts: {
        earthquakes: data.earthquakes?.earthquakes?.length ?? 0,
        fires: data.fires?.fires?.length ?? 0,
        conflicts: data.conflicts?.zones?.length ?? 0,
        flights: data.flights?.flights?.length ?? 0,
        satellites: data.satellites?.satellites?.length ?? 0,
      },
      conflicts:
        data.conflicts?.zones?.map((z) => ({
          label: z.label,
          severity: z.severity,
          eventCount: z.eventCount,
        })) ?? [],
      earthquakes:
        data.earthquakes?.earthquakes
          ?.slice(0, 15)
          .map((q) => ({ place: q.place, magnitude: q.magnitude })) ?? [],
    }),
    [activeLayers, data],
  );

  // Stable identity so the memoised LayerRail actually skips data-tick renders.
  const toggleLayer = useCallback(
    (id: string) => setActiveLayers((prev) => ({ ...prev, [id]: !prev[id] })),
    [],
  );
  const handleFly = useCallback((t: FlyTarget) => setFlyTo(t), []);
  const handleViewState = useCallback((v: { zoom: number; lat: number }) => setView(v), []);
  const handleCoords = useCallback((c: { lat: number; lng: number }) => setCoords(c), []);
  const handleRightClick = useCallback(
    (c: { lat: number; lng: number }) => setDossier(c),
    [],
  );
  const handleBroadcast = useCallback((id: string) => setBroadcastId(id), []);
  const activeBroadcast =
    data["live-news"]?.feeds?.find((f) => f.id === broadcastId) ?? null;

  const modeBtn = (active: boolean) => ({
    padding: "5px 10px",
    borderRadius: "8px",
    background: active ? "rgba(56,189,248,0.18)" : "transparent",
    color: active ? "var(--color-fi-sky)" : "var(--color-fi-text-2)",
    cursor: "pointer",
  });

  return (
    <main className="fi-viewport">
      <ForgeIntelMap
        activeLayers={activeLayers}
        data={data}
        projection={projection}
        mapStyle={mapStyle}
        buildings3d={buildings3d}
        flyTo={flyTo}
        onViewState={handleViewState}
        onMouseCoords={handleCoords}
        onRightClick={handleRightClick}
        onBroadcastClick={handleBroadcast}
      />
      <div className="fi-vignette" />

      {/* Brand header */}
      <header
        className="fi-glass"
        style={{
          position: "absolute",
          top: "var(--fi-edge)",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "8px 16px",
          zIndex: 200,
        }}
      >
        <span
          aria-hidden
          className="fi-pulse"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--color-fi-sky)",
            boxShadow: "0 0 10px var(--color-fi-sky)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.8rem",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--color-fi-heading)",
            fontWeight: 700,
          }}
        >
          {FI_PRODUCT}
        </span>
      </header>

      <LayerRail
        activeLayers={activeLayers}
        onToggle={toggleLayer}
        fetchedAt={fetchedAt}
      />
      <SearchBox onFly={handleFly} />
      <ViewPresets onFly={handleFly} />
      <ScaleBar zoom={view.zoom} lat={view.lat} />
      <StatusTicker data={data} entityCount={entityCount} />

      {/* Map modes */}
      <div
        className="fi-glass"
        style={{
          position: "absolute",
          top: "var(--fi-edge)",
          right: "var(--fi-edge)",
          display: "flex",
          padding: "4px",
          gap: "4px",
          zIndex: 200,
        }}
      >
        <button
          type="button"
          onClick={() => setProjection("globe")}
          className="fi-label"
          aria-pressed={projection === "globe"}
          style={modeBtn(projection === "globe")}
        >
          Globe
        </button>
        <button
          type="button"
          onClick={() => setProjection("mercator")}
          className="fi-label"
          aria-pressed={projection === "mercator"}
          style={modeBtn(projection === "mercator")}
        >
          2D
        </button>
        <button
          type="button"
          onClick={() => setMapStyle((v) => (v === "satellite" ? "map" : "satellite"))}
          className="fi-label"
          aria-pressed={mapStyle === "satellite"}
          style={modeBtn(mapStyle === "satellite")}
        >
          Sat
        </button>
        <button
          type="button"
          onClick={() => setBuildings3d((v) => !v)}
          className="fi-label"
          aria-pressed={buildings3d}
          style={modeBtn(buildings3d)}
          title="3D buildings (street zoom)"
        >
          3D
        </button>
      </div>

      {/* Tool strip */}
      <nav
        style={{
          position: "absolute",
          top: "50%",
          right: "var(--fi-edge)",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          zIndex: 200,
        }}
        aria-label="Console tools"
      >
        {TOOLS.map((tool) => {
          const live = tool.panel !== null || tool.label === "Search";
          const active = tool.panel !== null && openPanel === tool.panel;
          return (
            <button
              key={tool.label}
              type="button"
              disabled={!live}
              title={tool.label}
              onClick={
                tool.panel
                  ? () => togglePanel(tool.panel as PanelId)
                  : tool.label === "Search"
                    ? () =>
                        document
                          .querySelector<HTMLInputElement>("[data-fi-search]")
                          ?.focus()
                    : undefined
              }
              className="fi-glass fi-label"
              aria-pressed={tool.panel ? active : undefined}
              style={{
                width: "46px",
                height: "46px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.55rem",
                color: active
                  ? "var(--color-fi-void)"
                  : live
                    ? "var(--color-fi-sky)"
                    : "var(--color-fi-muted)",
                background: active ? "var(--color-fi-sky)" : undefined,
                cursor: live ? "pointer" : "not-allowed",
                opacity: live ? 1 : 0.6,
              }}
            >
              {tool.label.slice(0, 4)}
            </button>
          );
        })}
      </nav>

      {/* Mounted on first open, then kept mounted — see `mountedPanels`. */}
      {mountedPanels.has("analyst") && (
        <AnalystPanel
          open={openPanel === "analyst"}
          onClose={closePanel}
          context={analystContext}
        />
      )}
      {mountedPanels.has("recon") && (
        <ReconPanel open={openPanel === "recon"} onClose={closePanel} />
      )}
      {mountedPanels.has("graph") && (
        <EntityGraph open={openPanel === "graph"} onClose={closePanel} />
      )}
      {mountedPanels.has("alerts") && (
        <LiveAlerts
          open={openPanel === "alerts"}
          onClose={closePanel}
          data={data}
          onFly={handleFly}
        />
      )}

      {/* These two are already target-driven — they render null without a
          target, so gating on the target is behaviourally identical and lets
          their chunks load on first use. */}
      {dossier && (
        <RegionDossier target={dossier} onClose={() => setDossier(null)} data={data} />
      )}
      {activeBroadcast && (
        <LiveFeedViewer feed={activeBroadcast} onClose={() => setBroadcastId(null)} />
      )}

      {/* Status footer */}
      <footer
        className="fi-glass"
        style={{
          position: "absolute",
          bottom: "var(--fi-edge)",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: "18px",
          padding: "7px 16px",
          zIndex: 200,
        }}
      >
        <span className="fi-label">
          Layers <span className="fi-value">{activeCount}</span>
        </span>
        <span className="fi-label">
          Entities <span className="fi-value">{entityCount}</span>
        </span>
        <span className="fi-label">
          {coords
            ? `${coords.lat.toFixed(2)}°, ${coords.lng.toFixed(2)}°`
            : `Projection ${projection}`}
        </span>
        <a
          href="/intelligence"
          className="fi-label"
          style={{ color: "var(--color-fi-sky)", textDecoration: "none" }}
        >
          ← Overview
        </a>
      </footer>
    </main>
  );
}

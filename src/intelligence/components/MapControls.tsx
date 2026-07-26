"use client";

/**
 * Forge Intelligence — map chrome: scale bar, view presets, search box.
 *
 * Small, self-contained console controls. The scale bar is computed from the
 * live camera (zoom + latitude) rather than guessed; presets and search both
 * drive the map's imperative flyTo.
 */

import { useEffect, useRef, useState } from "react";

import { FI_API_BASE } from "@/intelligence/lib/brand";

export interface FlyTarget {
  lat: number;
  lng: number;
  zoom?: number;
  ts: number;
}

// ── Scale bar ────────────────────────────────────────────────────────

/** Web-mercator ground resolution at the equator, metres per pixel at z0. */
const EQUATOR_MPP = 156543.03392;
const NICE_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000,
  50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
];

export function ScaleBar({ zoom, lat }: { zoom: number; lat: number }) {
  const mpp = (EQUATOR_MPP * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  if (!Number.isFinite(mpp) || mpp <= 0) return null;

  const targetPx = 110;
  const rawMetres = mpp * targetPx;
  const metres = NICE_STEPS.find((s) => s >= rawMetres) ?? NICE_STEPS[NICE_STEPS.length - 1];
  const widthPx = Math.round(metres / mpp);
  const label = metres >= 1000 ? `${Math.round(metres / 1000)} km` : `${metres} m`;

  return (
    <div
      style={{
        position: "absolute",
        left: "calc(var(--fi-edge) + 248px)",
        // Sits ABOVE the status ticker (which occupies edge+46 → edge+80).
        bottom: "calc(var(--fi-edge) + 90px)",
        zIndex: 190,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
      aria-label={`Map scale: ${label}`}
    >
      <div
        style={{
          width: widthPx,
          height: 6,
          borderLeft: "1px solid var(--color-fi-text-2)",
          borderRight: "1px solid var(--color-fi-text-2)",
          borderBottom: "1px solid var(--color-fi-text-2)",
        }}
      />
      <span className="fi-label" style={{ fontSize: "0.62rem" }}>
        {label}
      </span>
    </div>
  );
}

// ── View presets ─────────────────────────────────────────────────────

const PRESETS: Array<{ id: string; label: string; lat: number; lng: number; zoom: number }> = [
  { id: "global", label: "Global", lat: 30, lng: 12, zoom: 2.4 },
  { id: "europe", label: "Europe", lat: 50, lng: 12, zoom: 3.6 },
  { id: "mena", label: "MENA", lat: 28, lng: 40, zoom: 3.6 },
  { id: "indopac", label: "Indo-Pacific", lat: 12, lng: 118, zoom: 3.2 },
  { id: "ukraine", label: "Ukraine", lat: 48.5, lng: 31.2, zoom: 5.4 },
  { id: "hormuz", label: "Hormuz", lat: 26.57, lng: 56.25, zoom: 6.5 },
  { id: "conus", label: "CONUS", lat: 39, lng: -98, zoom: 3.4 },
];

export function ViewPresets({ onFly }: { onFly: (t: FlyTarget) => void }) {
  return (
    <div
      className="fi-glass"
      style={{
        position: "absolute",
        top: "calc(var(--fi-edge) + 44px)",
        right: "var(--fi-edge)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: 6,
        zIndex: 200,
      }}
      aria-label="View presets"
    >
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          className="fi-label"
          onClick={() => onFly({ lat: p.lat, lng: p.lng, zoom: p.zoom, ts: Date.now() })}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            cursor: "pointer",
            background: "transparent",
            color: "var(--color-fi-text-2)",
            fontSize: "0.58rem",
            textAlign: "right",
          }}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

// ── Search ───────────────────────────────────────────────────────────

interface Place {
  name: string;
  lat: number;
  lng: number;
}

export function SearchBox({ onFly }: { onFly: (t: FlyTarget) => void }) {
  const [q, setQ] = useState("");
  // Results are keyed to the query they belong to, so a stale response can
  // never render against a newer query (and we never reset state in-effect).
  const [resolved, setResolved] = useState<{ key: string; places: Place[] }>({
    key: "",
    places: [],
  });
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmed = q.trim();
  const results = resolved.key === trimmed ? resolved.places : [];

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (trimmed.length < 2) return;
    // Debounced — Nominatim's usage policy (and basic manners) forbid a
    // request per keystroke.
    timer.current = setTimeout(() => {
      setLoading(true);
      fetch(`${FI_API_BASE}/geocode?q=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => setResolved({ key: trimmed, places: j?.results ?? [] }))
        .catch(() => setResolved({ key: trimmed, places: [] }))
        .finally(() => setLoading(false));
    }, 450);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [trimmed]);

  return (
    <div
      style={{
        position: "absolute",
        top: "var(--fi-edge)",
        left: "calc(var(--fi-edge) + 248px)",
        width: 280,
        zIndex: 210,
      }}
    >
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search place…  (/)"
        aria-label="Search places"
        data-fi-search
        className="fi-glass"
        style={{
          width: "100%",
          padding: "8px 12px",
          color: "var(--color-fi-text)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.75rem",
        }}
      />
      {(results.length > 0 || loading) && (
        <div
          className="fi-glass fi-scroll"
          style={{ marginTop: 6, maxHeight: 220, overflowY: "auto", padding: 4 }}
        >
          {loading && (
            <p className="fi-label" style={{ padding: 8 }}>
              Searching…
            </p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.lat},${r.lng},${i}`}
              type="button"
              onClick={() => {
                onFly({ lat: r.lat, lng: r.lng, zoom: 8, ts: Date.now() });
                setQ("");
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 9px",
                borderRadius: 6,
                cursor: "pointer",
                background: "transparent",
                color: "var(--color-fi-text)",
                fontSize: "0.75rem",
                lineHeight: 1.35,
              }}
            >
              {r.name}
            </button>
          ))}
          {results.length > 0 && (
            <p className="fi-label" style={{ padding: "6px 9px", fontSize: "0.55rem" }}>
              © OpenStreetMap contributors
            </p>
          )}
        </div>
      )}
    </div>
  );
}

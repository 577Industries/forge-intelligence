"use client";

/**
 * Forge Intelligence — layer rail.
 *
 * Left-hand HUD panel listing the intelligence-layer catalog grouped by
 * domain, each with a toggle. Toggling updates the console's activeLayers
 * map; the map + (Phase 2) fetch-dedup logic react to it.
 */

import { memo, useEffect, useState } from "react";

import { LAYER_GROUPS } from "@/intelligence/lib/layers";

export interface LayerRailProps {
  activeLayers: Record<string, boolean>;
  onToggle: (id: string) => void;
  /** Fetch-domain → last successful fetch (epoch ms). */
  fetchedAt?: Record<string, number>;
}

/** Coarse relative age — the rail has ~46px of room, and exactness adds nothing. */
function age(sinceMs: number): string {
  const s = Math.max(0, Math.round(sinceMs / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function LayerRailImpl({ activeLayers, onToggle, fetchedAt = {} }: LayerRailProps) {
  const activeCount = Object.values(activeLayers).filter(Boolean).length;

  // Re-render on a slow tick so ages stay honest between polls: without it a
  // 5-minute layer would read "0s" for five minutes. Owned by the rail (not
  // the console) so it re-renders ~40 rows and nothing else, and it only runs
  // once something has actually been fetched.
  const [, setTick] = useState(0);
  const hasTimestamps = Object.keys(fetchedAt).length > 0;
  useEffect(() => {
    if (!hasTimestamps) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, [hasTimestamps]);

  return (
    <aside
      className="fi-glass fi-scroll"
      style={{
        position: "absolute",
        top: "var(--fi-edge)",
        left: "var(--fi-edge)",
        bottom: "var(--fi-edge)",
        width: "232px",
        padding: "14px",
        overflowY: "auto",
        zIndex: 50,
      }}
      aria-label="Intelligence layers"
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <span className="fi-eyebrow">Layers</span>
        <span className="fi-value" style={{ fontSize: "0.7rem" }}>
          {activeCount} active
        </span>
      </div>

      {LAYER_GROUPS.map((group) => (
        <div key={group.id} style={{ marginBottom: "14px" }}>
          <div className="fi-label" style={{ marginBottom: "6px" }}>
            {group.label}
          </div>
          {group.layers.map((layer) => {
            const on = Boolean(activeLayers[layer.id]);
            // Only meaningful for an enabled layer that re-polls; static
            // reference layers (ports, CCTV, broadcasters) have no staleness.
            const at = layer.fetchKey ? fetchedAt[layer.fetchKey] : undefined;
            const showAge = on && layer.refreshMs != null && at != null;
            return (
              <div
                key={layer.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  padding: "5px 0",
                }}
              >
                <span
                  title={layer.hint}
                  style={{
                    fontSize: "0.8rem",
                    color: on ? "var(--color-fi-text)" : "var(--color-fi-text-2)",
                  }}
                >
                  {layer.label}
                </span>
                {showAge && (
                  <span
                    className="fi-label"
                    title={`Last updated ${new Date(at).toLocaleTimeString()}`}
                    style={{
                      marginLeft: "auto",
                      fontSize: "0.5rem",
                      color: "var(--color-fi-muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {age(Date.now() - at)}
                  </span>
                )}
                <button
                  type="button"
                  className="fi-toggle"
                  aria-pressed={on}
                  aria-label={`Toggle ${layer.label}`}
                  onClick={() => onToggle(layer.id)}
                />
              </div>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

/**
 * The rail renders ~40 rows and depends only on the toggles, but the console
 * re-renders on every data tick (and will do so far more often once layers
 * poll). Memoised so a data update doesn't rebuild the whole rail — this only
 * holds while `onToggle` is referentially stable, which the console ensures
 * with `useCallback`.
 */
export const LayerRail = memo(LayerRailImpl);

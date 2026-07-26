"use client";

/**
 * Forge Intelligence — live alerts.
 *
 * Derives alerts from the layers already on the picture rather than inventing
 * a separate alert feed: significant seismic, emergency squawks, active war
 * zones, critical chokepoints. Clicking an alert flies the camera to it.
 */

import type { FlyTarget } from "@/intelligence/components/MapControls";
import type { IntelData } from "@/intelligence/lib/types";

type Severity = "critical" | "high" | "info";

interface Alert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  lat: number;
  lng: number;
}

const SEV_COLOR: Record<Severity, string> = {
  critical: "var(--color-fi-alert)",
  high: "var(--color-fi-warn)",
  info: "var(--color-fi-sky)",
};

export function deriveAlerts(data: IntelData): Alert[] {
  const out: Alert[] = [];

  for (const q of data.earthquakes?.earthquakes ?? []) {
    if ((q.magnitude ?? 0) >= 5) {
      out.push({
        id: `quake-${q.lat},${q.lng}`,
        severity: (q.magnitude ?? 0) >= 6.5 ? "critical" : "high",
        title: `M${q.magnitude} seismic`,
        detail: q.place ?? "Unknown location",
        lat: q.lat,
        lng: q.lng,
      });
    }
  }

  for (const f of data.flights?.flights ?? []) {
    if (f.category === "emergency") {
      out.push({
        id: `emg-${f.callsign}`,
        severity: "critical",
        title: `Emergency squawk · ${f.callsign}`,
        detail: "Aircraft broadcasting 7700",
        lat: f.lat,
        lng: f.lng,
      });
    }
  }

  for (const z of data.conflicts?.zones ?? []) {
    if (z.severity === "war") {
      out.push({
        id: `conflict-${z.id}`,
        severity: "high",
        title: `${z.label} · active conflict`,
        detail: z.eventCount ? `${z.eventCount} recent reports` : z.description,
        lat: z.lat,
        lng: z.lng,
      });
    }
  }

  for (const c of data.maritime?.chokepoints ?? []) {
    if (c.risk === "CRITICAL" || c.risk === "HIGH") {
      out.push({
        id: `choke-${c.name}`,
        severity: c.risk === "CRITICAL" ? "critical" : "info",
        title: `${c.name}`,
        detail: `Chokepoint risk: ${c.risk}`,
        lat: c.lat,
        lng: c.lng,
      });
    }
  }

  const rank: Record<Severity, number> = { critical: 0, high: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 40);
}

export function LiveAlerts({
  open,
  onClose,
  data,
  onFly,
}: {
  open: boolean;
  onClose: () => void;
  data: IntelData;
  onFly: (t: FlyTarget) => void;
}) {
  if (!open) return null;
  const alerts = deriveAlerts(data);

  return (
    <aside
      className="fi-glass fi-scroll"
      style={{
        position: "absolute",
        top: "var(--fi-edge)",
        right: "calc(var(--fi-edge) + 62px)",
        bottom: "var(--fi-edge)",
        width: 320,
        padding: 16,
        overflowY: "auto",
        zIndex: 260,
      }}
      aria-label="Live alerts"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="fi-eyebrow">Live Alerts</span>
        <button
          type="button"
          onClick={onClose}
          className="fi-label"
          aria-label="Close alerts"
          style={{ cursor: "pointer", color: "var(--color-fi-muted)", background: "none" }}
        >
          ✕
        </button>
      </div>

      <p className="fi-label" style={{ margin: "10px 0 14px" }}>
        {alerts.length} derived from active layers
      </p>

      {alerts.length === 0 && (
        <p style={{ fontSize: "0.8rem", color: "var(--color-fi-muted)", lineHeight: 1.5 }}>
          Nothing above threshold on the layers currently loaded. Enable more
          domains to widen coverage.
        </p>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        {alerts.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onFly({ lat: a.lat, lng: a.lng, zoom: 6, ts: Date.now() })}
            style={{
              textAlign: "left",
              padding: "9px 10px",
              borderRadius: 8,
              cursor: "pointer",
              background: "var(--color-fi-surface)",
              border: `1px solid var(--color-fi-rule)`,
              borderLeft: `3px solid ${SEV_COLOR[a.severity]}`,
              color: "var(--color-fi-text)",
            }}
          >
            <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{a.title}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--color-fi-text-2)", marginTop: 2 }}>
              {a.detail}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

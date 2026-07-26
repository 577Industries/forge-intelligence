"use client";

/**
 * Forge Intelligence — region dossier.
 *
 * Right-click anywhere on the globe to get a local read: the place name
 * (reverse-geocoded) plus everything from the loaded layers within a radius.
 * Built entirely from data already on the picture — no new intelligence is
 * invented for the dossier.
 */

import { useEffect, useState } from "react";

import { FI_API_BASE } from "@/intelligence/lib/brand";
import type { IntelData } from "@/intelligence/lib/types";

const RADIUS_KM = 600;

/** Great-circle distance in km. */
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface Nearby {
  label: string;
  items: string[];
}

function collect(data: IntelData, lat: number, lng: number): Nearby[] {
  const near = <T extends { lat: number; lng: number }>(rows: T[] | undefined) =>
    (rows ?? []).filter((r) => haversineKm(lat, lng, r.lat, r.lng) <= RADIUS_KM);

  const out: Nearby[] = [];

  const quakes = near(data.earthquakes?.earthquakes);
  if (quakes.length)
    out.push({
      label: "Seismic",
      items: quakes
        .slice(0, 6)
        .map((q) => `M${q.magnitude ?? "?"} · ${q.place ?? "unknown"}`),
    });

  const zones = near(data.conflicts?.zones);
  if (zones.length)
    out.push({
      label: "Conflict",
      items: zones.map((z) => `${z.label} (${z.severity})`),
    });

  const flights = near(data.flights?.flights);
  if (flights.length)
    out.push({
      label: "Military air",
      items: flights.slice(0, 8).map((f) => `${f.callsign}${f.alt ? ` · ${f.alt} ft` : ""}`),
    });

  const ports = near(data.maritime?.ports);
  if (ports.length)
    out.push({ label: "Ports", items: ports.slice(0, 8).map((p) => `${p.name} (${p.type})`) });

  const chokes = near(data.maritime?.chokepoints);
  if (chokes.length)
    out.push({ label: "Chokepoints", items: chokes.map((c) => `${c.name} · ${c.risk}`) });

  const fires = near(data.fires?.fires);
  if (fires.length) out.push({ label: "Fire activity", items: [`${fires.length} hotspots`] });

  const events = near(data.gdelt?.events);
  if (events.length)
    out.push({ label: "Events", items: events.slice(0, 6).map((e) => e.name) });

  const infra = near(data.infrastructure?.nodes);
  if (infra.length)
    out.push({ label: "Infrastructure", items: infra.map((n) => `${n.name} (${n.type})`) });

  return out;
}

export function RegionDossier({
  target,
  onClose,
  data,
}: {
  target: { lat: number; lng: number } | null;
  onClose: () => void;
  data: IntelData;
}) {
  // Keyed to the target so a stale reverse-geocode can't render against a new
  // point, and so we never reset state synchronously inside the effect.
  const [resolved, setResolved] = useState<{ key: string; name: string | null }>({
    key: "",
    name: null,
  });
  const key = target ? `${target.lat.toFixed(4)},${target.lng.toFixed(4)}` : "";
  const place = resolved.key === key ? resolved.name : null;

  useEffect(() => {
    if (!target) return;
    let alive = true;
    fetch(`${FI_API_BASE}/geocode?lat=${target.lat}&lng=${target.lng}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setResolved({ key, name: j?.place?.name ?? null });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [target, key]);

  if (!target) return null;
  const sections = collect(data, target.lat, target.lng);

  return (
    <aside
      className="fi-glass fi-scroll"
      style={{
        position: "absolute",
        left: "calc(var(--fi-edge) + 248px)",
        top: "calc(var(--fi-edge) + 48px)",
        width: 330,
        maxHeight: "60vh",
        overflowY: "auto",
        padding: 16,
        zIndex: 300,
      }}
      aria-label="Region dossier"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="fi-eyebrow">Region Dossier</span>
        <button
          type="button"
          onClick={onClose}
          className="fi-label"
          aria-label="Close dossier"
          style={{ cursor: "pointer", color: "var(--color-fi-muted)", background: "none" }}
        >
          ✕
        </button>
      </div>

      <p className="fi-value" style={{ fontSize: "0.75rem", margin: "10px 0 2px" }}>
        {target.lat.toFixed(3)}°, {target.lng.toFixed(3)}°
      </p>
      <p style={{ fontSize: "0.78rem", color: "var(--color-fi-text-2)", lineHeight: 1.45 }}>
        {place ?? "Resolving place…"}
      </p>
      <p className="fi-label" style={{ margin: "12px 0 10px" }}>
        Within {RADIUS_KM} km · from loaded layers
      </p>

      {sections.length === 0 ? (
        <p style={{ fontSize: "0.78rem", color: "var(--color-fi-muted)", lineHeight: 1.5 }}>
          No loaded-layer activity in range. Enable more domains for wider coverage.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sections.map((s) => (
            <div key={s.label}>
              <div className="fi-label" style={{ color: "var(--color-fi-sky)" }}>
                {s.label}
              </div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                {s.items.map((it, i) => (
                  <li
                    key={i}
                    style={{ fontSize: "0.75rem", lineHeight: 1.5, color: "var(--color-fi-text)" }}
                  >
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

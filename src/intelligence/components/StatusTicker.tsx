"use client";

/**
 * Forge Intelligence — bottom status ticker.
 *
 * Scrolling situational readout. Built on public-domain government feeds
 * (NOAA space weather, USGS seismic) plus the layers already loaded in the
 * console. Market quotes appear only when a licensed provider is configured
 * (FI_MARKETS_URL) — we don't ship the upstream's non-commercial crypto feed.
 */

import { useEffect, useState } from "react";

import { FI_API_BASE } from "@/intelligence/lib/brand";
import type { IntelData } from "@/intelligence/lib/types";

interface Quote {
  symbol: string;
  price: number;
  changePct?: number;
}

interface TickerFeed {
  kp: number | null;
  kpLevel: "quiet" | "unsettled" | "active" | "storm" | null;
  largestQuake: { magnitude: number; place: string } | null;
  significantQuakes: number;
  quotes: Quote[];
}

interface TickerItem {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "alert";
}

const TONE: Record<string, string> = {
  ok: "var(--color-fi-ok)",
  warn: "var(--color-fi-warn)",
  alert: "var(--color-fi-alert)",
};

export function StatusTicker({
  data,
  entityCount,
}: {
  data: IntelData;
  entityCount: number;
}) {
  const [feed, setFeed] = useState<TickerFeed | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`${FI_API_BASE}/ticker`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j) setFeed(j);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const items: TickerItem[] = [];

  if (feed?.kp !== null && feed?.kp !== undefined) {
    items.push({
      label: "Kp index",
      value: `${feed.kp} · ${feed.kpLevel ?? ""}`.trim(),
      tone: feed.kpLevel === "storm" ? "alert" : feed.kpLevel === "active" ? "warn" : "ok",
    });
  }
  if (feed?.largestQuake) {
    items.push({
      label: "Largest quake 24h",
      value: `M${feed.largestQuake.magnitude} · ${feed.largestQuake.place}`,
      tone: feed.largestQuake.magnitude >= 6 ? "alert" : "warn",
    });
  }
  if (feed?.significantQuakes) {
    items.push({ label: "Significant seismic", value: `${feed.significantQuakes} events` });
  }

  const warzones = (data.conflicts?.zones ?? []).filter((z) => z.severity === "war").length;
  if (data.conflicts?.zones?.length) {
    items.push({
      label: "Conflict zones",
      value: `${data.conflicts.zones.length} tracked · ${warzones} active war`,
      tone: warzones > 0 ? "alert" : undefined,
    });
  }
  if (data.flights?.flights?.length) {
    const emergency = data.flights.flights.filter((f) => f.category === "emergency").length;
    items.push({
      label: "Military air",
      value: `${data.flights.flights.length} tracked${emergency ? ` · ${emergency} emergency` : ""}`,
      tone: emergency ? "alert" : undefined,
    });
  }
  if (data.satellites?.satellites?.length) {
    items.push({ label: "Orbital", value: `${data.satellites.satellites.length} objects` });
  }
  if (data.fires?.fires?.length) {
    items.push({ label: "Active fires", value: `${data.fires.fires.length} hotspots`, tone: "warn" });
  }
  items.push({ label: "Entities on picture", value: String(entityCount) });

  for (const q of feed?.quotes ?? []) {
    items.push({
      label: q.symbol,
      value:
        q.changePct === undefined
          ? String(q.price)
          : `${q.price} (${q.changePct > 0 ? "+" : ""}${q.changePct.toFixed(2)}%)`,
      tone: q.changePct === undefined ? undefined : q.changePct >= 0 ? "ok" : "alert",
    });
  }

  if (items.length === 0) return null;

  const row = (key: string) => (
    <div style={{ display: "flex", gap: 28, paddingRight: 28, flex: "none" }}>
      {items.map((it, i) => (
        <span
          key={`${key}-${i}`}
          style={{ display: "inline-flex", gap: 8, alignItems: "baseline", flex: "none" }}
        >
          <span className="fi-label">{it.label}</span>
          <span
            className="fi-value"
            style={{ fontSize: "0.72rem", color: it.tone ? TONE[it.tone] : undefined }}
          >
            {it.value}
          </span>
          <span aria-hidden style={{ color: "var(--color-fi-rule-hi)" }}>·</span>
        </span>
      ))}
    </div>
  );

  return (
    <div
      className="fi-glass"
      style={{
        position: "absolute",
        left: "var(--fi-edge)",
        right: "var(--fi-edge)",
        bottom: "calc(var(--fi-edge) + 46px)",
        height: 34,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
        zIndex: 190,
        padding: "0 12px",
      }}
      aria-label="Status ticker"
    >
      <span
        aria-hidden
        className="fi-pulse"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--color-fi-ok)",
          marginRight: 12,
          flex: "none",
        }}
      />
      <div className="fi-ticker-track" style={{ overflow: "hidden", flex: 1 }}>
        <div className="fi-marquee" style={{ display: "flex", width: "max-content" }}>
          {row("a")}
          {row("b")}
        </div>
      </div>
    </div>
  );
}

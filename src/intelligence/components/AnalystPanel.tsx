"use client";

/**
 * Forge Intelligence — AI analyst panel.
 *
 * Slide-in HUD panel: the operator asks a question, the current on-screen
 * picture is sent to /api/intelligence/analyst, and the assessment renders
 * here. Degrades gracefully to a clear "not configured" notice when no valid
 * Google key is set.
 */

import { useState } from "react";

import { FI_API_BASE } from "@/intelligence/lib/brand";
import type { AnalystContext } from "@/lib/intelligence/analyst";

export interface AnalystPanelProps {
  open: boolean;
  onClose: () => void;
  context: AnalystContext;
}

export function AnalystPanel({ open, onClose, context }: AnalystPanelProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await fetch(`${FI_API_BASE}/analyst`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, context }),
      });
      const data = await res.json();
      if (res.ok && data.analysis) setAnswer(data.analysis);
      else setError(data.detail ?? "The analyst request failed.");
    } catch {
      setError("Network error reaching the analyst.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside
      className="fi-glass fi-scroll"
      style={{
        position: "absolute",
        top: "var(--fi-edge)",
        right: "calc(var(--fi-edge) + 62px)",
        bottom: "var(--fi-edge)",
        width: "340px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        overflowY: "auto",
        zIndex: 260,
      }}
      aria-label="AI analyst"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="fi-eyebrow">AI Analyst</span>
        <button
          type="button"
          onClick={onClose}
          className="fi-label"
          aria-label="Close analyst"
          style={{ cursor: "pointer", color: "var(--color-fi-muted)", background: "none" }}
        >
          ✕
        </button>
      </div>

      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        placeholder="Ask about the current picture — e.g. 'summarize the highest-risk regions on screen'"
        rows={3}
        className="fi-scroll"
        style={{
          width: "100%",
          resize: "vertical",
          background: "var(--color-fi-surface)",
          border: "1px solid var(--color-fi-rule)",
          borderRadius: "8px",
          color: "var(--color-fi-text)",
          fontFamily: "var(--font-sans)",
          fontSize: "0.85rem",
          padding: "9px 10px",
        }}
      />

      <button
        type="button"
        onClick={submit}
        disabled={loading || !query.trim()}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.7rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 700,
          padding: "9px",
          borderRadius: "8px",
          border: "none",
          cursor: loading || !query.trim() ? "not-allowed" : "pointer",
          background: loading || !query.trim() ? "var(--color-fi-surface-2)" : "var(--color-fi-sky)",
          color: loading || !query.trim() ? "var(--color-fi-muted)" : "var(--color-fi-void)",
        }}
      >
        {loading ? "Analyzing…" : "Run assessment"}
      </button>

      {error && (
        <div
          style={{
            fontSize: "0.8rem",
            lineHeight: 1.5,
            color: "var(--color-fi-warn)",
            border: "1px solid rgba(255,165,0,0.3)",
            borderRadius: "8px",
            padding: "10px",
          }}
        >
          {error}
        </div>
      )}

      {answer && (
        <div
          style={{
            fontSize: "0.85rem",
            lineHeight: 1.6,
            color: "var(--color-fi-text)",
            whiteSpace: "pre-wrap",
          }}
        >
          {answer}
        </div>
      )}
    </aside>
  );
}

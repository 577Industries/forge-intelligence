"use client";

/**
 * Forge Intelligence — RECON toolkit panel.
 *
 * Passive tools (DNS, WHOIS) run for anyone; aggressive tools (host exposure,
 * breach lookup) are marked and require an authenticated operator — the API
 * returns 401 and we surface that plainly rather than pretending it ran.
 * Breach lookups additionally require a stated lawful purpose.
 */

import { useState } from "react";

import { FI_API_BASE } from "@/intelligence/lib/brand";

interface ReconTool {
  id: string;
  label: string;
  param: string;
  placeholder: string;
  path: string;
  aggressive: boolean;
  hint: string;
}

const TOOLS: ReconTool[] = [
  { id: "dns", label: "DNS", param: "domain", placeholder: "example.com", path: "/osint/dns", aggressive: false, hint: "A / AAAA / MX / NS / TXT / CNAME" },
  { id: "whois", label: "WHOIS", param: "domain", placeholder: "example.com", path: "/osint/whois", aggressive: false, hint: "RDAP registration record" },
  { id: "certs", label: "Certs", param: "domain", placeholder: "example.com", path: "/osint/certs", aggressive: false, hint: "Certificate transparency — passive subdomain discovery" },
  { id: "ip", label: "IP", param: "ip", placeholder: "8.8.8.8", path: "/osint/ip", aggressive: false, hint: "RDAP network registration + origin org" },
  { id: "bgp", label: "BGP", param: "target", placeholder: "8.8.8.8 or AS15169", path: "/osint/bgp", aggressive: false, hint: "Prefix, origin AS and neighbours (RIPEstat)" },
  { id: "cve", label: "CVE", param: "q", placeholder: "CVE-2024-3094 or keyword", path: "/osint/cve", aggressive: false, hint: "NIST National Vulnerability Database" },
  { id: "sanctions", label: "Sanctions", param: "q", placeholder: "name / vessel / org", path: "/osint/sanctions", aggressive: false, hint: "US Treasury OFAC SDN — screening support, not compliance advice" },
  { id: "shodan", label: "Exposure", param: "ip", placeholder: "8.8.8.8", path: "/osint/shodan", aggressive: true, hint: "Open ports / CPEs / CVEs (Shodan InternetDB)" },
  { id: "leaks", label: "Breach", param: "email", placeholder: "name@example.com", path: "/osint/leaks", aggressive: true, hint: "Breach-corpus membership (PII — purpose required)" },
];

export interface ReconPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ReconPanel({ open, onClose }: ReconPanelProps) {
  const [toolId, setToolId] = useState("dns");
  const [query, setQuery] = useState("");
  const [purpose, setPurpose] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;
  const tool = TOOLS.find((t) => t.id === toolId) ?? TOOLS[0];

  const run = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ [tool.param]: q });
      if (tool.id === "leaks") params.set("purpose", purpose.trim());
      const res = await fetch(`${FI_API_BASE}${tool.path}?${params}`);
      const data = await res.json();
      if (res.ok) setResult(data);
      else setError(data.detail ?? data.error ?? `Request failed (${res.status}).`);
    } catch {
      setError("Network error running the tool.");
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
        width: "360px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        overflowY: "auto",
        zIndex: 260,
      }}
      aria-label="RECON toolkit"
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="fi-eyebrow">RECON Toolkit</span>
        <button
          type="button"
          onClick={onClose}
          className="fi-label"
          aria-label="Close RECON"
          style={{ cursor: "pointer", color: "var(--color-fi-muted)", background: "none" }}
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setToolId(t.id);
              // Reset the query too — tools take different target types
              // (domain vs IP vs email), so carrying it over is nonsense.
              setQuery("");
              setPurpose("");
              setResult(null);
              setError(null);
            }}
            className="fi-label"
            aria-pressed={t.id === toolId}
            style={{
              padding: "5px 9px",
              borderRadius: "7px",
              cursor: "pointer",
              background: t.id === toolId ? "rgba(56,189,248,0.18)" : "transparent",
              border: "1px solid var(--color-fi-rule)",
              color: t.id === toolId ? "var(--color-fi-sky)" : "var(--color-fi-text-2)",
            }}
          >
            {t.label}
            {t.aggressive ? " ⚿" : ""}
          </button>
        ))}
      </div>

      <p style={{ fontSize: "0.72rem", color: "var(--color-fi-muted)", lineHeight: 1.5 }}>
        {tool.hint}
        {tool.aggressive && " · requires an authenticated operator"}
      </p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && run()}
        placeholder={tool.placeholder}
        style={{
          background: "var(--color-fi-surface)",
          border: "1px solid var(--color-fi-rule)",
          borderRadius: "8px",
          color: "var(--color-fi-text)",
          fontFamily: "var(--font-mono)",
          fontSize: "0.82rem",
          padding: "9px 10px",
        }}
      />

      {tool.id === "leaks" && (
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="Lawful purpose (required)"
          style={{
            background: "var(--color-fi-surface)",
            border: "1px solid var(--color-fi-rule)",
            borderRadius: "8px",
            color: "var(--color-fi-text)",
            fontFamily: "var(--font-sans)",
            fontSize: "0.8rem",
            padding: "9px 10px",
          }}
        />
      )}

      <button
        type="button"
        onClick={run}
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
        {loading ? "Running…" : `Run ${tool.label}`}
      </button>

      {error && (
        <div
          style={{
            fontSize: "0.78rem",
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

      {result !== null && (
        <pre
          className="fi-scroll"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "0.7rem",
            lineHeight: 1.5,
            color: "var(--color-fi-text)",
            background: "var(--color-fi-surface)",
            border: "1px solid var(--color-fi-rule)",
            borderRadius: "8px",
            padding: "10px",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </aside>
  );
}

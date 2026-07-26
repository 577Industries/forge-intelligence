"use client";

/**
 * Forge Intelligence — entity link graph.
 *
 * Seed an entity (domain / IP / ASN), then pivot: every node can be expanded
 * to reveal what it connects to. Backed by /api/intelligence/entity/expand,
 * which is entirely passive (registries, public DNS, certificate transparency,
 * public routing table) — investigating a target never touches it.
 *
 * Built on @xyflow/react, which the platform already ships.
 */

import {
  Background,
  Controls,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useState } from "react";

import { FI_API_BASE } from "@/intelligence/lib/brand";

type EntityType = "domain" | "ip" | "asn" | "org" | "prefix";

interface ApiNode {
  id: string;
  type: EntityType;
  label: string;
}
interface ApiEdge {
  source: string;
  target: string;
  label: string;
}

const TYPE_COLOR: Record<EntityType, string> = {
  domain: "#38bdf8",
  ip: "#00d4aa",
  asn: "#ffa500",
  org: "#448aff",
  prefix: "#9aa4b2",
};

function styleFor(type: EntityType, isRoot: boolean): React.CSSProperties {
  const color = TYPE_COLOR[type] ?? "#9aa4b2";
  return {
    background: "rgba(12,17,28,0.92)",
    border: `1px solid ${color}`,
    borderLeftWidth: isRoot ? 4 : 1,
    borderRadius: 8,
    color: "#E6EAF0",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    padding: "6px 9px",
    maxWidth: 190,
  };
}

/** Place new children on a circle around their parent. */
function radial(cx: number, cy: number, count: number, index: number, radius: number) {
  const angle = (2 * Math.PI * index) / Math.max(count, 1) - Math.PI / 2;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

export function EntityGraph({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [seed, setSeed] = useState("");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const expand = useCallback(
    async (value: string, origin: { x: number; y: number } | null) => {
      const v = value.trim();
      if (!v || loading) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${FI_API_BASE}/entity/expand?value=${encodeURIComponent(v)}`,
        );
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Expansion failed.");
          return;
        }

        const root: ApiNode = data.root;
        const newNodes: ApiNode[] = data.nodes ?? [];
        const newEdges: ApiEdge[] = data.edges ?? [];
        const center = origin ?? { x: 0, y: 0 };

        setNodes((prev) => {
          const byId = new Map(prev.map((n) => [n.id, n]));
          if (!byId.has(root.id)) {
            byId.set(root.id, {
              id: root.id,
              position: center,
              data: { label: root.label },
              style: styleFor(root.type, true),
            });
          }
          newNodes.forEach((n, i) => {
            if (byId.has(n.id)) return;
            byId.set(n.id, {
              id: n.id,
              position: radial(center.x, center.y, newNodes.length, i, 260),
              data: { label: n.label },
              style: styleFor(n.type, false),
            });
          });
          return [...byId.values()];
        });

        setEdges((prev) => {
          const byId = new Map(prev.map((e) => [e.id, e]));
          for (const e of newEdges) {
            const id = `${e.source}->${e.target}`;
            if (byId.has(id)) continue;
            byId.set(id, {
              id,
              source: e.source,
              target: e.target,
              label: e.label,
              style: { stroke: "rgba(56,189,248,0.35)" },
              labelStyle: { fill: "#9aa4b2", fontSize: 9 },
            });
          }
          return [...byId.values()];
        });

        setExpanded((prev) => new Set(prev).add(root.id));
        if (newNodes.length === 0) setError("No further connections found.");
      } catch {
        setError("Network error during expansion.");
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (expanded.has(node.id)) return;
      void expand(node.id, node.position);
    },
    [expand, expanded],
  );

  if (!open) return null;

  return (
    <section
      className="fi-glass"
      style={{
        position: "absolute",
        top: "calc(var(--fi-edge) + 48px)",
        left: "calc(var(--fi-edge) + 248px)",
        right: "calc(var(--fi-edge) + 62px)",
        bottom: "calc(var(--fi-edge) + 92px)",
        display: "flex",
        flexDirection: "column",
        padding: 14,
        gap: 10,
        zIndex: 280,
      }}
      aria-label="Entity link graph"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="fi-eyebrow">Entity Graph</span>
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && expand(seed, { x: 0, y: 0 })}
          placeholder="domain, IP or AS number…"
          style={{
            flex: 1,
            background: "var(--color-fi-surface)",
            border: "1px solid var(--color-fi-rule)",
            borderRadius: 8,
            color: "var(--color-fi-text)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.75rem",
            padding: "7px 10px",
          }}
        />
        <button
          type="button"
          onClick={() => expand(seed, { x: 0, y: 0 })}
          disabled={loading || !seed.trim()}
          className="fi-label"
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            cursor: loading || !seed.trim() ? "not-allowed" : "pointer",
            background: loading || !seed.trim() ? "var(--color-fi-surface-2)" : "var(--color-fi-sky)",
            color: loading || !seed.trim() ? "var(--color-fi-muted)" : "var(--color-fi-void)",
            fontWeight: 700,
          }}
        >
          {loading ? "Pivoting…" : "Pivot"}
        </button>
        <button
          type="button"
          onClick={() => {
            setNodes([]);
            setEdges([]);
            setExpanded(new Set());
            setError(null);
          }}
          className="fi-label"
          style={{ padding: "7px 10px", cursor: "pointer", color: "var(--color-fi-text-2)" }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={onClose}
          className="fi-label"
          aria-label="Close entity graph"
          style={{ cursor: "pointer", color: "var(--color-fi-muted)", background: "none" }}
        >
          ✕
        </button>
      </div>

      <p className="fi-label" style={{ fontSize: "0.58rem" }}>
        {nodes.length} entities · {edges.length} links · click any node to pivot ·
        passive sources only
        {error ? ` · ${error}` : ""}
      </p>

      <div style={{ flex: 1, minHeight: 0, borderRadius: 10, overflow: "hidden" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodeClick={onNodeClick}
          fitView
          proOptions={{ hideAttribution: false }}
          style={{ background: "var(--color-fi-base)" }}
        >
          <Background color="rgba(255,255,255,0.06)" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}

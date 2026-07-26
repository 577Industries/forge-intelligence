/**
 * Forge Intelligence — entity expansion (link analysis backend).
 *
 * Given one entity, return the entities it connects to and how. This is the
 * pivot primitive behind the link graph: domain → addresses / nameservers /
 * subdomains / registrar, address → network + origin AS, AS → neighbours.
 *
 * Entirely PASSIVE — registries, public DNS, certificate transparency and the
 * public routing table. Nothing is sent to the entity being investigated.
 */

import { Resolver } from "node:dns/promises";

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { isAddressBlocked } from "@/lib/intelligence/ssrf-guard";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 45;

export type EntityType = "domain" | "ip" | "asn" | "org" | "prefix";

interface GraphNode {
  id: string;
  type: EntityType;
  label: string;
}
interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

const DOMAIN_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const RESERVED = /(^localhost$|\.localhost$|\.local$|\.internal$)/i;
const ASN_RE = /^as\d{1,10}$/i;

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

async function expandDomain(domain: string) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const r = new Resolver({ timeout: 5000, tries: 2 });

  const [a, aaaa, ns] = await Promise.all([
    settle(r.resolve4(domain)),
    settle(r.resolve6(domain)),
    settle(r.resolveNs(domain)),
  ]);

  for (const ip of [...(a ?? []), ...(aaaa ?? [])].slice(0, 12)) {
    nodes.push({ id: ip, type: "ip", label: ip });
    edges.push({ source: domain, target: ip, label: "resolves to" });
  }
  for (const host of (ns ?? []).slice(0, 8)) {
    const h = host.toLowerCase();
    nodes.push({ id: h, type: "domain", label: h });
    edges.push({ source: domain, target: h, label: "nameserver" });
  }

  // Subdomains from certificate transparency (passive).
  const certs = await settle(
    fiFetchJson<{ name_value?: string }[]>(
      `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`,
      { timeoutMs: 25_000 },
    ),
  );
  if (Array.isArray(certs)) {
    const subs = new Set<string>();
    for (const row of certs) {
      for (const n of (row.name_value ?? "").split("\n")) {
        const h = n.trim().toLowerCase();
        if (h && !h.startsWith("*.") && h !== domain && h.endsWith(`.${domain}`)) {
          subs.add(h);
        }
      }
    }
    for (const sub of [...subs].slice(0, 15)) {
      nodes.push({ id: sub, type: "domain", label: sub });
      edges.push({ source: domain, target: sub, label: "subdomain" });
    }
  }

  return { nodes, edges };
}

async function expandIp(ip: string) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const rdap = await settle(
    fiFetchJson<{ name?: string; country?: string; entities?: { handle?: string }[] }>(
      `https://rdap.org/ip/${encodeURIComponent(ip)}`,
      { timeoutMs: 10_000, headers: { accept: "application/rdap+json" } },
    ),
  );
  if (rdap?.name) {
    const org = `net:${rdap.name}`;
    nodes.push({
      id: org,
      type: "org",
      label: `${rdap.name}${rdap.country ? ` (${rdap.country})` : ""}`,
    });
    edges.push({ source: ip, target: org, label: "registered to" });
  }

  const bgp = await settle(
    fiFetchJson<{ data?: { asns?: { asn?: number; holder?: string }[]; block?: { resource?: string } } }>(
      `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(ip)}`,
      { timeoutMs: 12_000 },
    ),
  );
  const prefix = bgp?.data?.block?.resource;
  if (prefix) {
    nodes.push({ id: prefix, type: "prefix", label: prefix });
    edges.push({ source: ip, target: prefix, label: "in prefix" });
  }
  for (const a of (bgp?.data?.asns ?? []).slice(0, 4)) {
    if (!a.asn) continue;
    const id = `AS${a.asn}`;
    nodes.push({ id, type: "asn", label: `${id}${a.holder ? ` · ${a.holder}` : ""}` });
    edges.push({ source: prefix ?? ip, target: id, label: "announced by" });
  }

  return { nodes, edges };
}

async function expandAsn(asn: string) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const n = await settle(
    fiFetchJson<{ data?: { neighbours?: { asn?: number; type?: string }[] } }>(
      `https://stat.ripe.net/data/asn-neighbours/data.json?resource=${encodeURIComponent(asn.toUpperCase())}`,
      { timeoutMs: 12_000 },
    ),
  );
  for (const nb of (n?.data?.neighbours ?? []).slice(0, 20)) {
    if (!nb.asn) continue;
    const id = `AS${nb.asn}`;
    nodes.push({ id, type: "asn", label: id });
    edges.push({ source: asn.toUpperCase(), target: id, label: nb.type ?? "peer" });
  }
  return { nodes, edges };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  const value = (req.nextUrl.searchParams.get("value") ?? "").trim();
  if (!value || value.length > 253) {
    return NextResponse.json({ error: "missing or oversized value" }, { status: 400 });
  }

  // Infer the entity type rather than trusting the caller.
  let type: EntityType;
  if (ASN_RE.test(value)) type = "asn";
  else if (/^[\d.]+$/.test(value) || value.includes(":")) type = "ip";
  else type = "domain";

  if (type === "ip" && isAddressBlocked(value)) {
    return NextResponse.json({ error: "reserved address refused" }, { status: 400 });
  }
  if (type === "domain" && (!DOMAIN_RE.test(value) || RESERVED.test(value))) {
    return NextResponse.json({ error: "invalid or reserved domain" }, { status: 400 });
  }

  try {
    const { data } = await cachedJson(
      `entity-expand:${type}:${value.toLowerCase()}`,
      21_600,
      async () => {
        if (type === "domain") return expandDomain(value.toLowerCase());
        if (type === "ip") return expandIp(value);
        return expandAsn(value);
      },
    );

    return NextResponse.json({
      root: { id: type === "asn" ? value.toUpperCase() : value.toLowerCase(), type, label: value },
      ...data,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "expansion failed", nodes: [], edges: [] },
      { status: 502 },
    );
  }
}

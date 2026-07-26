/**
 * Forge Intelligence — certificate transparency (PASSIVE).
 *
 * Queries crt.sh for logged certificates covering a domain. This is a purely
 * passive way to enumerate subdomains and infrastructure history — no packets
 * are sent to the target, which is why it stays in the open tier where an
 * active scan would not.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 45;

const DOMAIN_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const RESERVED = /(^localhost$|\.localhost$|\.local$|\.internal$)/i;

interface CrtRow {
  name_value?: string;
  issuer_name?: string;
  not_before?: string;
  not_after?: string;
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  const domain = (req.nextUrl.searchParams.get("domain") ?? "").trim().toLowerCase();
  if (!domain || domain.length > 253 || !DOMAIN_RE.test(domain)) {
    return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  }
  if (RESERVED.test(domain)) {
    return NextResponse.json({ error: "reserved domain refused" }, { status: 400 });
  }

  try {
    const { data } = await cachedJson(`osint-certs:${domain}`, 21_600, async () => {
      const rows = await fiFetchJson<CrtRow[]>(
        `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`,
        { timeoutMs: 30_000 },
      );
      const list = Array.isArray(rows) ? rows : [];

      // name_value may hold several SANs separated by newlines.
      const hosts = new Set<string>();
      for (const r of list) {
        for (const n of (r.name_value ?? "").split("\n")) {
          const h = n.trim().toLowerCase();
          if (h && !h.startsWith("*.")) hosts.add(h);
        }
      }
      const recent = list
        .slice(0, 25)
        .map((r) => ({
          issuer: r.issuer_name ?? null,
          notBefore: r.not_before ?? null,
          notAfter: r.not_after ?? null,
        }));

      return {
        subdomains: [...hosts].sort().slice(0, 200),
        subdomainCount: hosts.size,
        certificates: recent,
        totalLogged: list.length,
      };
    });

    return NextResponse.json({
      domain,
      ...data,
      source: "crt.sh certificate transparency logs",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { domain, subdomains: [], error: "certificate transparency unavailable" },
      { status: 502 },
    );
  }
}

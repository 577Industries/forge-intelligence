/**
 * Forge Intelligence — CVE lookup (PASSIVE).
 *
 * NIST National Vulnerability Database. US-government work (public domain) and
 * keyless, though NVD rate-limits unauthenticated callers — set NVD_API_KEY to
 * raise the ceiling. Accepts a CVE id or a keyword search.
 *
 * This reads a public vulnerability catalogue; it does not test any target,
 * which is why it sits in the open tier while the scanner does not.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 45;

const NVD = "https://services.nvd.nist.gov/rest/json/cves/2.0";
const CVE_RE = /^CVE-\d{4}-\d{4,7}$/i;

interface NvdMetric {
  cvssData?: { baseScore?: number; baseSeverity?: string; vectorString?: string };
}
interface NvdCve {
  cve?: {
    id?: string;
    published?: string;
    lastModified?: string;
    descriptions?: { lang?: string; value?: string }[];
    metrics?: {
      cvssMetricV31?: NvdMetric[];
      cvssMetricV30?: NvdMetric[];
      cvssMetricV2?: NvdMetric[];
    };
    references?: { url?: string }[];
  };
}

function summarize(v: NvdCve) {
  const c = v.cve ?? {};
  const m =
    c.metrics?.cvssMetricV31?.[0] ??
    c.metrics?.cvssMetricV30?.[0] ??
    c.metrics?.cvssMetricV2?.[0];
  return {
    id: c.id ?? null,
    published: c.published ?? null,
    lastModified: c.lastModified ?? null,
    description:
      c.descriptions?.find((d) => d.lang === "en")?.value ??
      c.descriptions?.[0]?.value ??
      null,
    cvssScore: m?.cvssData?.baseScore ?? null,
    severity: m?.cvssData?.baseSeverity ?? null,
    vector: m?.cvssData?.vectorString ?? null,
    references: (c.references ?? []).slice(0, 6).map((r) => r.url).filter(Boolean),
  };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 120) {
    return NextResponse.json({ error: "query must be 3–120 characters" }, { status: 400 });
  }

  const url = CVE_RE.test(q)
    ? `${NVD}?cveId=${encodeURIComponent(q.toUpperCase())}`
    : `${NVD}?keywordSearch=${encodeURIComponent(q)}&resultsPerPage=20`;

  try {
    const { data } = await cachedJson(`osint-cve:${q.toLowerCase()}`, 21_600, async () => {
      const res = await fiFetchJson<{ vulnerabilities?: NvdCve[]; totalResults?: number }>(
        url,
        {
          timeoutMs: 30_000,
          headers: process.env.NVD_API_KEY
            ? { apiKey: process.env.NVD_API_KEY }
            : undefined,
        },
      );
      return {
        total: res.totalResults ?? 0,
        results: (res.vulnerabilities ?? []).slice(0, 20).map(summarize),
      };
    });

    return NextResponse.json({
      query: q,
      ...data,
      source: "NIST National Vulnerability Database",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      {
        query: q,
        total: 0,
        results: [],
        error:
          "NVD unavailable (unauthenticated callers are rate-limited; set NVD_API_KEY to raise the ceiling)",
      },
      { status: 502 },
    );
  }
}

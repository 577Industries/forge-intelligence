/**
 * Forge Intelligence — OFAC SDN screening (PASSIVE).
 *
 * Searches the US Treasury Specially Designated Nationals list. Sourced
 * DIRECTLY from Treasury (US-government work, public domain → commercially
 * usable) rather than the third-party mirror the upstream used, whose terms
 * are more restrictive and which can lag the official list.
 *
 * Caching is two-tier because the list is ~5.6 MB: a best-effort parsed index
 * (24h) plus a per-query result cache (24h). If the index is too large for the
 * KV backend the set fails silently and we re-parse — slower, never wrong.
 *
 * DISCLAIMER (surfaced in-product): screening support, NOT compliance advice.
 * Matching is normalized substring; confirm every hit against the official
 * list before acting.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchText } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const SDN_CSV = "https://sanctionslistservice.ofac.treas.gov/api/download/sdn.csv";
const EMPTY = "-0-";
const MAX_MATCHES = 50;

interface SdnEntry {
  id: string;
  name: string;
  type: string | null;
  program: string | null;
}

/** Minimal RFC4180-ish row splitter (handles quoted fields containing commas). */
function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function clean(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return !t || t === EMPTY ? null : t;
}

/** Normalize for matching: case/diacritic/punctuation-insensitive. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadIndex(): Promise<SdnEntry[]> {
  const { data } = await cachedJson<SdnEntry[]>(
    "sanctions-sdn-index",
    86_400,
    async () => {
      const csv = await fiFetchText(SDN_CSV, { timeoutMs: 45_000 });
      const rows: SdnEntry[] = [];
      for (const line of csv.split("\n")) {
        if (!line.trim()) continue;
        const f = splitCsvRow(line);
        const name = clean(f[1]);
        if (!name) continue;
        rows.push({
          id: (f[0] ?? "").trim(),
          name,
          type: clean(f[2]),
          program: clean(f[3]),
        });
      }
      return rows;
    },
    { staleTtlSeconds: 7 * 86_400 },
  );
  return data;
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 120) {
    return NextResponse.json(
      { error: "query must be 3–120 characters" },
      { status: 400 },
    );
  }

  try {
    const { data } = await cachedJson(
      `sanctions-q:${norm(q)}`,
      86_400,
      async () => {
        const index = await loadIndex();
        const needle = norm(q);
        const matches = index
          .filter((e) => norm(e.name).includes(needle))
          .slice(0, MAX_MATCHES);
        return { total: matches.length, matches, indexSize: index.length };
      },
    );

    return NextResponse.json({
      query: q,
      ...data,
      source: "US Treasury OFAC SDN list",
      disclaimer:
        "Screening support only — not legal or compliance advice. Normalized substring matching yields false positives and negatives; verify against the official OFAC list before acting.",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { query: q, total: 0, matches: [], error: "sanctions list unavailable" },
      { status: 502 },
    );
  }
}

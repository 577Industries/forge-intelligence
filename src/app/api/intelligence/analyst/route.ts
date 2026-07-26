/**
 * Forge Intelligence — AI analyst endpoint.
 *
 * POST { query, context } → { analysis } via the AI gateway (Gemini 3.6 Flash
 * by default; FI_ANALYST_MODEL overrides). Rate-limited for cost control.
 * CSRF is enforced by the proxy (same-origin Origin check) — no bypass needed.
 * Returns 503 "analyst_unavailable" when no valid Google key is configured.
 */

import { NextRequest, NextResponse } from "next/server";

import {
  analyze,
  FI_ANALYST_MODEL,
  type AnalystContext,
} from "@/lib/intelligence/analyst";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const MAX_QUERY_CHARS = 2000;

export async function POST(req: NextRequest) {
  const limited = await checkRateLimit("intel-ai", getClientIp(req));
  if (limited) return limited;

  let body: { query?: unknown; context?: AnalystContext };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const query =
    typeof body.query === "string" ? body.query.trim().slice(0, MAX_QUERY_CHARS) : "";
  if (!query) {
    return NextResponse.json({ error: "empty query" }, { status: 400 });
  }

  try {
    const analysis = await analyze(query, body.context ?? {});
    return NextResponse.json({ analysis, model: FI_ANALYST_MODEL });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const noKey = /api key|not valid|unauthor|permission|credential/i.test(detail);
    return NextResponse.json(
      {
        error: "analyst_unavailable",
        detail: noKey
          ? "AI analyst not configured — set a valid GOOGLE_GENERATIVE_AI_API_KEY (or FI_ANALYST_MODEL)."
          : "AI analyst request failed.",
      },
      { status: 503 },
    );
  }
}

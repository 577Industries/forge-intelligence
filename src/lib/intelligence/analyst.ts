/**
 * Forge Intelligence — AI analyst.
 *
 * Routes through the 577i AI gateway (src/lib/ai/gateway.ts) — NOT a direct
 * provider SDK (the upstream Osiris `@google/generative-ai` import is dropped).
 * Default model is Gemini 3.6 Flash; override with FI_ANALYST_MODEL
 * (a "provider/model" gateway string) without touching code.
 *
 * Requires a valid GOOGLE_GENERATIVE_AI_API_KEY. If the key is missing or
 * invalid the route returns a clear "not configured" 503 rather than crashing.
 */

import { generateText } from "ai";

import { model } from "@/lib/ai/gateway";

export const FI_ANALYST_MODEL =
  process.env.FI_ANALYST_MODEL ?? "google/gemini-3.6-flash";

const SYSTEM_PROMPT = `You are the Forge Intelligence analyst — an open-source
intelligence (OSINT) fusion assistant for a real-time global monitoring console.

You are given a snapshot of the current operational picture (live layers and
entity counts the operator has on screen) and an analyst query. Produce a
concise, sober assessment:
- Lead with the single most decision-relevant judgement.
- Ground every claim in the provided data or clearly labelled general knowledge.
- Flag uncertainty explicitly; never fabricate specific events, casualties, or
  coordinates that are not in the data.
- Keep it tight (a few short paragraphs or bullets). No preamble.

You are an analytic aid, not an authority. Do not claim classified access or
real-time feeds beyond the open sources listed.`;

export interface AnalystConflict {
  label: string;
  severity: string;
  eventCount: number;
}
export interface AnalystQuake {
  place: string | null;
  magnitude: number | null;
}
export interface AnalystContext {
  activeLayers?: string[];
  entityCounts?: Record<string, number>;
  conflicts?: AnalystConflict[];
  earthquakes?: AnalystQuake[];
}

/** Compact, token-budgeted serialization of the on-screen picture. */
export function serializeContext(ctx: AnalystContext): string {
  const lines: string[] = [];
  if (ctx.activeLayers?.length) {
    lines.push(`ACTIVE LAYERS: ${ctx.activeLayers.join(", ")}`);
  }
  if (ctx.entityCounts && Object.keys(ctx.entityCounts).length) {
    lines.push(
      "ENTITY COUNTS: " +
        Object.entries(ctx.entityCounts)
          .map(([k, v]) => `${k}=${v}`)
          .join(", "),
    );
  }
  if (ctx.conflicts?.length) {
    lines.push(
      "CONFLICT ZONES: " +
        ctx.conflicts
          .slice(0, 15)
          .map((c) => `${c.label} [${c.severity}, ${c.eventCount} recent]`)
          .join("; "),
    );
  }
  if (ctx.earthquakes?.length) {
    lines.push(
      "RECENT SEISMIC: " +
        ctx.earthquakes
          .slice(0, 15)
          .map((q) => `M${q.magnitude ?? "?"} ${q.place ?? "unknown"}`)
          .join("; "),
    );
  }
  return lines.length ? lines.join("\n") : "(no live layers loaded)";
}

export async function analyze(
  query: string,
  ctx: AnalystContext,
): Promise<string> {
  const picture = serializeContext(ctx);
  const result = await generateText({
    model: model(FI_ANALYST_MODEL),
    instructions: SYSTEM_PROMPT,
    prompt: `## CURRENT OPERATIONAL PICTURE\n${picture}\n\n## ANALYST QUERY\n${query}\n\nProvide your assessment.`,
    maxOutputTokens: 900,
  });
  return result.text;
}

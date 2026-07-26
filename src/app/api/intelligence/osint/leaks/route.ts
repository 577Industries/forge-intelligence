/**
 * Forge Intelligence — breach exposure (AGGRESSIVE, auth-gated, PII).
 *
 * Returns which public breach corpora an email address appears in. This is
 * personal data about a third party (GDPR/CCPA lawful-basis territory) and is
 * also an email-enumeration oracle, so it requires an authenticated operator,
 * a tight rate limit, an explicit purpose declaration, and an audit entry.
 *
 * Results are membership indicators from aggregated public breach datasets —
 * not authoritative, and never returned with credential material.
 *
 * LICENCE: the upstream provider (XposedOrNot) requires a licensing agreement
 * for commercial use, forbids redistribution without written authorisation, and
 * requires visible attribution wherever its data is displayed. This route is
 * therefore licence-gated: it reports unconfigured unless the deployment sets
 * FI_BREACH_LICENSED=1 to attest it holds that agreement, and every response
 * carries the required attribution.
 */

import { NextRequest, NextResponse } from "next/server";

import { auditRecon, requireOperator } from "@/lib/intelligence/access";
import { fiFetch } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Never echo a full address back into logs. */
function redactEmail(email: string): string {
  const [user, domain] = email.split("@");
  const head = user.slice(0, 2);
  return `${head}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

export async function GET(req: NextRequest) {
  const access = await requireOperator();
  if (!access.ok) return access.response;

  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  if (process.env.FI_BREACH_LICENSED !== "1") {
    return NextResponse.json(
      {
        error: "breach_lookup_unlicensed",
        detail:
          "Breach exposure lookup requires a commercial licensing agreement with the data provider. Set FI_BREACH_LICENSED=1 to attest this deployment holds one.",
      },
      { status: 503 },
    );
  }

  const email = (req.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  const purpose = (req.nextUrl.searchParams.get("purpose") ?? "").trim();

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  if (purpose.length < 8) {
    return NextResponse.json(
      {
        error: "purpose_required",
        detail:
          "State a lawful purpose (min 8 chars) for querying breach data about a third party.",
      },
      { status: 400 },
    );
  }

  auditRecon(access.operator, "breach-exposure", redactEmail(email), { purpose });

  try {
    const res = await fiFetch(
      `https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`,
      { timeoutMs: 12_000, cache: "no-store" },
    );
    if (!res.ok) {
      return NextResponse.json(
        { email: redactEmail(email), breached: false, breaches: [], note: "no records or source unavailable" },
        { status: res.status === 404 ? 200 : 502 },
      );
    }
    const data = (await res.json()) as {
      ExposedBreaches?: { breaches_details?: unknown[] };
    };
    const details = data.ExposedBreaches?.breaches_details ?? [];
    return NextResponse.json({
      email: redactEmail(email),
      breached: details.length > 0,
      breachCount: details.length,
      breaches: details,
      attribution: "Breach data provided by XposedOrNot (xposedornot.com)",
      disclaimer:
        "Aggregated from public breach datasets; indicative only, not authoritative. No credentials are returned.",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "breach lookup failed" },
      { status: 502 },
    );
  }
}

/**
 * Forge Intelligence — active scanning (MOST AGGRESSIVE, heavily gated).
 *
 * This is the only tool in the toolkit that sends packets to a third party.
 * Port/service/TLS/vulnerability scanning of infrastructure you do not own can
 * violate the CFAA (US), the Computer Misuse Act (UK) and equivalents — so the
 * controls here are deliberately heavier than anywhere else in the product:
 *
 *   1. Authenticated operator (session required).
 *   2. EXPLICIT authorization attestation — the operator must assert they own
 *      the target or hold written permission to test it.
 *   3. A written justification, recorded in the audit log with the operator
 *      identity and target.
 *   4. SSRF guard on the target (no internal/reserved space, ever).
 *   5. Tight rate limit.
 *
 * Scanning is NOT performed in this process: Vercel's serverless runtime can't
 * do it, and running it from shared platform IPs would be reckless. The route
 * proxies to an operator-provisioned scanner backend (SCANNER_URL/SCANNER_KEY)
 * so the egress and the legal responsibility sit with the deployment that owns
 * them. With no backend configured it returns 503 rather than pretending.
 */

import { NextRequest, NextResponse } from "next/server";

import { auditRecon, requireOperator } from "@/lib/intelligence/access";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { validateHost } from "@/lib/intelligence/ssrf-guard";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Scan profiles. `vuln` is the sharpest edge — deployments can withhold it. */
const SCAN_TYPES = ["quick", "ssl", "headers", "rdns", "tech", "vuln"] as const;
type ScanType = (typeof SCAN_TYPES)[number];

function disabledTypes(): Set<string> {
  return new Set(
    (process.env.FI_SCANNER_DISABLED_TYPES ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function POST(req: NextRequest) {
  const access = await requireOperator();
  if (!access.ok) return access.response;

  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  const base = process.env.SCANNER_URL;
  if (!base) {
    return NextResponse.json(
      {
        error: "scanner_not_configured",
        detail:
          "Active scanning requires an operator-provisioned scanner backend (SCANNER_URL). None is configured for this deployment.",
      },
      { status: 503 },
    );
  }

  let body: {
    target?: unknown;
    scanType?: unknown;
    authorized?: unknown;
    justification?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const target = typeof body.target === "string" ? body.target.trim() : "";
  const scanType = (
    typeof body.scanType === "string" ? body.scanType.toLowerCase() : "quick"
  ) as ScanType;
  const justification =
    typeof body.justification === "string" ? body.justification.trim() : "";

  if (!target) {
    return NextResponse.json({ error: "missing target" }, { status: 400 });
  }
  if (!SCAN_TYPES.includes(scanType)) {
    return NextResponse.json(
      { error: `scanType must be one of: ${SCAN_TYPES.join(", ")}` },
      { status: 400 },
    );
  }
  if (disabledTypes().has(scanType)) {
    return NextResponse.json(
      {
        error: "scan_type_disabled",
        detail: `The '${scanType}' profile is disabled for this deployment.`,
      },
      { status: 403 },
    );
  }
  if (body.authorized !== true) {
    return NextResponse.json(
      {
        error: "authorization_attestation_required",
        detail:
          "You must attest that you own this target or hold written authorization to test it. Scanning third-party infrastructure without permission may be unlawful.",
      },
      { status: 400 },
    );
  }
  if (justification.length < 12) {
    return NextResponse.json(
      {
        error: "justification_required",
        detail: "Provide a written justification (min 12 characters) for this scan.",
      },
      { status: 400 },
    );
  }

  // Never let a scan be aimed at internal space, whatever the backend allows.
  const check = await validateHost(target);
  if (!check.ok) {
    return NextResponse.json(
      { error: "target_refused", detail: check.reason },
      { status: 400 },
    );
  }

  auditRecon(access.operator, `scanner:${scanType}`, target, {
    justification,
    attested: true,
    resolved: check.ips,
  });

  try {
    const url = new URL(`/scan/${scanType}`, base);
    url.searchParams.set("target", target);
    if (process.env.SCANNER_KEY) url.searchParams.set("key", process.env.SCANNER_KEY);

    const result = await fiFetchJson<unknown>(url.toString(), { timeoutMs: 55_000 });
    return NextResponse.json({
      target,
      scanType,
      result,
      operator: access.operator.email,
      disclaimer:
        "Active scan performed by the configured scanner backend under the operator's attested authorization.",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "scanner_backend_unavailable" },
      { status: 502 },
    );
  }
}

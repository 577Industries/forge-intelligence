/**
 * Forge Intelligence — RECON access control.
 *
 * The toolkit is split by blast radius:
 *
 *  - PASSIVE tools (DNS, RDAP/WHOIS, IP intel, sanctions) read public
 *    registries. Open to the demo tier, rate-limited.
 *  - AGGRESSIVE tools (port/vuln scanning, breach-data lookup, Shodan
 *    exposure data) probe or expose third parties and carry real legal
 *    weight (CFAA-class scanning, GDPR-class PII). Those require an
 *    authenticated 577i session, a tighter rate limit, and an audit log
 *    entry naming the operator and target.
 *
 * The proxy does NOT auth /api/intelligence/*, so every aggressive handler
 * must call requireOperator() itself.
 */

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { logger } from "@/lib/logger";

export interface Operator {
  email: string;
}

export type AccessResult =
  | { ok: true; operator: Operator }
  | { ok: false; response: NextResponse };

/** Require an authenticated operator for an aggressive RECON tool. */
export async function requireOperator(): Promise<AccessResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "authentication_required",
          detail:
            "This RECON tool probes or exposes third-party data and requires an authenticated Forge Intelligence operator.",
        },
        { status: 401 },
      ),
    };
  }
  return { ok: true, operator: { email } };
}

/**
 * Audit an aggressive RECON action. Structured so the operator, tool and
 * target are always recoverable from logs — a requirement for anything that
 * touches third-party infrastructure or personal data.
 */
export function auditRecon(
  operator: Operator,
  tool: string,
  target: string,
  extra: Record<string, unknown> = {},
): void {
  logger.info("[intel-recon] aggressive tool invoked", {
    component: "forge-intelligence",
    tool,
    operator: operator.email,
    target,
    ...extra,
  });
}

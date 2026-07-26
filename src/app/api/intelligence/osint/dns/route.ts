/**
 * Forge Intelligence — DNS records (PASSIVE).
 *
 * Resolves A / AAAA / MX / NS / TXT / CNAME for a domain. Reads public DNS
 * only — it makes no HTTP request to the target — so it stays in the open
 * demo tier behind a rate limit. Reserved/internal names are refused so the
 * endpoint can't be used to probe internal naming.
 */

import { Resolver } from "node:dns/promises";

import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const DOMAIN_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const RESERVED =
  /(^localhost$|\.localhost$|^host\.docker\.internal$|\.local$|\.internal$)/i;

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
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

  const r = new Resolver({ timeout: 5000, tries: 2 });
  const [a, aaaa, mx, ns, txt, cname] = await Promise.all([
    settle(r.resolve4(domain)),
    settle(r.resolve6(domain)),
    settle(r.resolveMx(domain)),
    settle(r.resolveNs(domain)),
    settle(r.resolveTxt(domain)),
    settle(r.resolveCname(domain)),
  ]);

  return NextResponse.json({
    domain,
    records: {
      A: a ?? [],
      AAAA: aaaa ?? [],
      MX: mx ?? [],
      NS: ns ?? [],
      TXT: (txt ?? []).map((chunks) => chunks.join("")),
      CNAME: cname ?? [],
    },
    timestamp: new Date().toISOString(),
  });
}

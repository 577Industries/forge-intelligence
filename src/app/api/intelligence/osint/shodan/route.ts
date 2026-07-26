/**
 * Forge Intelligence — host exposure (AGGRESSIVE, auth-gated, licence-gated).
 *
 * Returns open ports, CPEs, hostnames and known CVEs for an arbitrary IP.
 * Shodan did the scanning, so we send no packets to the target — but surfacing
 * another party's exposure is offensive-recon output, so it requires an
 * authenticated operator, a tight rate limit, and an audit entry. Reserved and
 * internal IPs are refused outright.
 *
 * LICENCE: Shodan's keyless InternetDB endpoint is free for non-commercial use
 * only — "if you're using the InternetDB API to make money then you need an
 * enterprise license". 577i is a commercial operator, so this route deliberately
 * does NOT call the keyless endpoint. It requires the deployment to supply its
 * own licensed Shodan key and reports unconfigured when none is present, which
 * keeps the licence obligation with whoever runs the deployment.
 */

import { NextRequest, NextResponse } from "next/server";

import { auditRecon, requireOperator } from "@/lib/intelligence/access";
import { fiFetch } from "@/lib/intelligence/fetch";
import { isAddressBlocked } from "@/lib/intelligence/ssrf-guard";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const access = await requireOperator();
  if (!access.ok) return access.response;

  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  const apiKey = process.env.SHODAN_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      {
        error: "shodan_unconfigured",
        detail:
          "Host-exposure lookup requires an operator-supplied Shodan licence key (SHODAN_API_KEY). None is configured for this deployment.",
      },
      { status: 503 },
    );
  }

  const ip = (req.nextUrl.searchParams.get("ip") ?? "").trim();
  if (!ip) return NextResponse.json({ error: "missing ip" }, { status: 400 });
  if (isAddressBlocked(ip)) {
    return NextResponse.json(
      { error: "target must be a public IP address" },
      { status: 400 },
    );
  }

  auditRecon(access.operator, "shodan-host", ip);

  try {
    const url = new URL(`https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}`);
    url.searchParams.set("key", apiKey);
    const res = await fiFetch(url.toString(), {
      timeoutMs: 10_000,
      cache: "no-store",
    });
    if (res.status === 404) {
      return NextResponse.json({
        ip,
        found: false,
        ports: [],
        cpes: [],
        hostnames: [],
        vulns: [],
        source: "Shodan",
        timestamp: new Date().toISOString(),
      });
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: "exposure lookup unavailable", status: res.status },
        { status: 502 },
      );
    }
    const data = (await res.json()) as Record<string, unknown>;
    return NextResponse.json({
      ip,
      found: true,
      ports: data.ports ?? [],
      cpes: data.cpes ?? [],
      hostnames: data.hostnames ?? [],
      tags: data.tags ?? [],
      vulns: data.vulns ?? [],
      org: data.org ?? null,
      os: data.os ?? null,
      source: "Shodan",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "exposure lookup failed" },
      { status: 502 },
    );
  }
}

/**
 * Forge Intelligence — domain registration / WHOIS (PASSIVE).
 *
 * RDAP lookup against the public rdap.org bootstrap. Passive: it reads a
 * registry, it does NOT connect to the queried domain. (The upstream Osiris
 * route also fired a live HEAD request at the user's host to fingerprint
 * headers — that turns the endpoint into a connectivity oracle, so it is
 * deliberately NOT ported here.)
 */

import { NextRequest, NextResponse } from "next/server";

import { fiFetch } from "@/lib/intelligence/fetch";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const DOMAIN_RE =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;
const RESERVED =
  /(^localhost$|\.localhost$|^host\.docker\.internal$|\.local$|\.internal$)/i;

interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown;
}
interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapResponse {
  ldhName?: string;
  status?: string[];
  events?: RdapEvent[];
  entities?: RdapEntity[];
  nameservers?: { ldhName?: string }[];
}

function eventDate(events: RdapEvent[] | undefined, action: string): string | null {
  return events?.find((e) => e.eventAction === action)?.eventDate ?? null;
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
    const res = await fiFetch(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      { timeoutMs: 10_000, headers: { accept: "application/rdap+json" } },
    );
    if (res.status === 404) {
      return NextResponse.json(
        { domain, found: false, timestamp: new Date().toISOString() },
        { status: 200 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        { error: "registry unavailable", status: res.status },
        { status: 502 },
      );
    }
    const rdap = (await res.json()) as RdapResponse;

    const registrar = rdap.entities?.find((e) => e.roles?.includes("registrar"));
    return NextResponse.json({
      domain,
      found: true,
      ldhName: rdap.ldhName ?? domain,
      status: rdap.status ?? [],
      registration: eventDate(rdap.events, "registration"),
      expiration: eventDate(rdap.events, "expiration"),
      lastChanged: eventDate(rdap.events, "last changed"),
      registrar: registrar ? (registrar.vcardArray ?? null) : null,
      nameservers: (rdap.nameservers ?? [])
        .map((n) => n.ldhName)
        .filter((n): n is string => Boolean(n)),
      source: "rdap.org",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "registry lookup failed" },
      { status: 502 },
    );
  }
}

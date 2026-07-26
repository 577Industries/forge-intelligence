/**
 * Forge Intelligence — IP registration intel (PASSIVE).
 *
 * Uses RDAP (the registries' own protocol) for authoritative network
 * ownership: allocation, CIDR, country, and the responsible org. Deliberately
 * NOT ip-api.com, which the upstream used — its free tier is non-commercial
 * and plaintext HTTP. Geolocation is an optional add-on: set FI_GEOIP_URL to a
 * licensed provider ({ip} is substituted); unset → registration data only,
 * rather than shipping a licence violation.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { isAddressBlocked } from "@/lib/intelligence/ssrf-guard";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

interface RdapEntity {
  roles?: string[];
  handle?: string;
  vcardArray?: unknown;
}
interface RdapIp {
  handle?: string;
  name?: string;
  country?: string;
  type?: string;
  startAddress?: string;
  endAddress?: string;
  cidr0_cidrs?: { v4prefix?: string; v6prefix?: string; length?: number }[];
  entities?: RdapEntity[];
  remarks?: { description?: string[] }[];
}

/** Pull a display name out of a jCard without pretending to fully parse it. */
function vcardName(vcard: unknown): string | null {
  if (!Array.isArray(vcard) || vcard.length < 2) return null;
  const props = vcard[1];
  if (!Array.isArray(props)) return null;
  for (const p of props) {
    if (Array.isArray(p) && p[0] === "fn" && typeof p[3] === "string") return p[3];
  }
  return null;
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  const ip = (req.nextUrl.searchParams.get("ip") ?? "").trim();
  if (!ip) return NextResponse.json({ error: "missing ip" }, { status: 400 });
  if (isAddressBlocked(ip)) {
    return NextResponse.json(
      { error: "target must be a public IP address" },
      { status: 400 },
    );
  }

  try {
    const { data } = await cachedJson(`osint-ip:${ip}`, 86_400, async () => {
      const rdap = await fiFetchJson<RdapIp>(
        `https://rdap.org/ip/${encodeURIComponent(ip)}`,
        { timeoutMs: 10_000, headers: { accept: "application/rdap+json" } },
      );
      const org =
        rdap.entities?.find((e) => e.roles?.includes("registrant")) ??
        rdap.entities?.[0];
      const cidr = rdap.cidr0_cidrs?.[0];
      return {
        handle: rdap.handle ?? null,
        netName: rdap.name ?? null,
        country: rdap.country ?? null,
        type: rdap.type ?? null,
        range:
          rdap.startAddress && rdap.endAddress
            ? `${rdap.startAddress} – ${rdap.endAddress}`
            : null,
        cidr: cidr
          ? `${cidr.v4prefix ?? cidr.v6prefix}/${cidr.length ?? ""}`
          : null,
        org: org ? (vcardName(org.vcardArray) ?? org.handle ?? null) : null,
      };
    });

    // Optional licensed geolocation.
    let geo: unknown = null;
    const geoUrl = process.env.FI_GEOIP_URL;
    if (geoUrl) {
      try {
        geo = await fiFetchJson(geoUrl.replace("{ip}", encodeURIComponent(ip)), {
          timeoutMs: 8000,
        });
      } catch {
        /* optional */
      }
    }

    return NextResponse.json({
      ip,
      ...data,
      geo,
      geoConfigured: Boolean(geoUrl),
      source: "RDAP (regional internet registries)",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ip, error: "registry lookup failed" },
      { status: 502 },
    );
  }
}

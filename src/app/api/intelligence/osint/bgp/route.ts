/**
 * Forge Intelligence — BGP / routing intel (PASSIVE).
 *
 * RIPEstat: which prefix and origin AS announce an address, plus the AS's
 * neighbours. Reads the public routing table — nothing is sent to the target.
 */

import { NextRequest, NextResponse } from "next/server";

import { cachedJson } from "@/lib/intelligence/cache";
import { fiFetchJson } from "@/lib/intelligence/fetch";
import { isAddressBlocked } from "@/lib/intelligence/ssrf-guard";
import { checkRateLimit, getClientIp } from "@/lib/onboard/rate-limit";

export const runtime = "nodejs";

const RIPE = "https://stat.ripe.net/data";

interface PrefixOverview {
  data?: {
    /** The announced prefix covering the queried resource. */
    resource?: string;
    asns?: { asn?: number; holder?: string }[];
    /** The much broader IANA/RIR administered block — NOT the announcement. */
    block?: { resource?: string; desc?: string };
  };
}
interface AsnNeighbours {
  data?: { neighbours?: { asn?: number; type?: string }[] };
}

export async function GET(req: NextRequest) {
  const limited = await checkRateLimit("intel-recon", getClientIp(req));
  if (limited) return limited;

  const target = (req.nextUrl.searchParams.get("target") ?? "").trim();
  if (!target) {
    return NextResponse.json({ error: "missing target (IP or ASxxxx)" }, { status: 400 });
  }

  const isAsn = /^as\d{1,10}$/i.test(target);
  if (!isAsn && isAddressBlocked(target)) {
    return NextResponse.json(
      { error: "target must be a public IP address or an AS number (e.g. AS15169)" },
      { status: 400 },
    );
  }

  try {
    const { data } = await cachedJson(`osint-bgp:${target.toLowerCase()}`, 21_600, async () => {
      // ASNs and addresses need DIFFERENT RIPEstat endpoints — prefix-overview
      // only accepts a prefix/IP and returns nothing useful for an AS number.
      if (isAsn) {
        const as = target.toUpperCase();
        const overview = await fiFetchJson<{
          data?: { resource?: string; holder?: string; announced?: boolean };
        }>(`${RIPE}/as-overview/data.json?resource=${encodeURIComponent(as)}`, {
          timeoutMs: 12_000,
        });
        let neighbours: { asn?: number; type?: string }[] = [];
        try {
          const n = await fiFetchJson<AsnNeighbours>(
            `${RIPE}/asn-neighbours/data.json?resource=${encodeURIComponent(as)}`,
            { timeoutMs: 12_000 },
          );
          neighbours = (n.data?.neighbours ?? []).slice(0, 40);
        } catch {
          /* neighbours optional */
        }
        return {
          prefix: null,
          administeredBlock: null,
          blockDescription: null,
          asn: overview.data?.resource ?? as,
          holder: overview.data?.holder ?? null,
          announced: overview.data?.announced ?? null,
          originAsns: [
            { asn: Number(as.replace(/^AS/i, "")), holder: overview.data?.holder ?? null },
          ],
          neighbours,
        };
      }

      const overview = await fiFetchJson<PrefixOverview>(
        `${RIPE}/prefix-overview/data.json?resource=${encodeURIComponent(target)}`,
        { timeoutMs: 12_000 },
      );
      const asns = overview.data?.asns ?? [];
      const primary = asns[0]?.asn;

      let neighbours: { asn?: number; type?: string }[] = [];
      if (primary) {
        try {
          const n = await fiFetchJson<AsnNeighbours>(
            `${RIPE}/asn-neighbours/data.json?resource=AS${primary}`,
            { timeoutMs: 12_000 },
          );
          neighbours = (n.data?.neighbours ?? []).slice(0, 40);
        } catch {
          /* neighbours optional */
        }
      }

      return {
        // `data.resource` is the ANNOUNCED prefix (e.g. 8.8.8.0/24).
        // `data.block` is the far broader IANA/RIR administered block
        // (e.g. 8.0.0.0/8) — labelling that as "the prefix" would badly
        // mislead an analyst, so the two are reported separately.
        prefix: overview.data?.resource ?? target,
        administeredBlock: overview.data?.block?.resource ?? null,
        blockDescription: overview.data?.block?.desc ?? null,
        originAsns: asns.map((a) => ({ asn: a.asn ?? null, holder: a.holder ?? null })),
        neighbours,
      };
    });

    return NextResponse.json({
      target,
      ...data,
      source: "RIPEstat",
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { target, error: "routing data unavailable" },
      { status: 502 },
    );
  }
}

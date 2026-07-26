import { describe, expect, test } from "vitest";

import {
  ipv4Blocked,
  ipv6Blocked,
  isAddressBlocked,
  parseIPv4,
  parseIPv6,
  validateHost,
} from "../ssrf-guard";

describe("parseIPv4 — canonical dotted-quad only", () => {
  test("accepts canonical form", () => {
    expect(parseIPv4("127.0.0.1")).toBe("127.0.0.1");
    expect(parseIPv4("8.8.8.8")).toBe("8.8.8.8");
  });

  // Non-canonical forms resolve fine at the kernel level, so accepting them
  // would be a straight bypass of the denylist.
  test.each([
    ["decimal", "2130706433"],
    ["hex", "0x7f.0.0.1"],
    ["octal", "0177.0.0.1"],
    ["short", "127.1"],
    ["out of range", "999.0.0.1"],
  ])("rejects %s form", (_label, input) => {
    expect(parseIPv4(input)).toBeNull();
  });
});

describe("ipv4Blocked", () => {
  test.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
  ])("blocks reserved %s", (ip) => {
    expect(ipv4Blocked(ip)).toBe(true);
  });

  test.each(["8.8.8.8", "1.1.1.1", "93.184.216.34"])(
    "allows public %s",
    (ip) => {
      expect(ipv4Blocked(ip)).toBe(false);
    },
  );
});

describe("parseIPv6 canonicalization", () => {
  test("compressed and expanded loopback parse to the same value", () => {
    expect(parseIPv6("::1")).toBe(BigInt(1));
    expect(parseIPv6("0:0:0:0:0:0:0:1")).toBe(BigInt(1));
    expect(parseIPv6("0000:0000:0000:0000:0000:0000:0000:0001")).toBe(BigInt(1));
  });

  test("unspecified address", () => {
    expect(parseIPv6("::")).toBe(BigInt(0));
  });

  test("IPv4-mapped forms parse equivalently", () => {
    expect(parseIPv6("::ffff:127.0.0.1")).toBe(parseIPv6("::ffff:7f00:1"));
  });

  test("rejects malformed input", () => {
    expect(parseIPv6("not-an-ip")).toBeNull();
    expect(parseIPv6("1:2:3")).toBeNull();
    expect(parseIPv6("::1::2")).toBeNull();
  });
});

describe("ipv6Blocked — regression for the upstream string-prefix bypass", () => {
  // The upstream guard matched blocked ranges with raw `startsWith`, so any
  // EXPANDED literal slipped through. These must all be blocked.
  test.each([
    ["compressed loopback", "::1"],
    ["EXPANDED loopback (upstream bypass)", "0:0:0:0:0:0:0:1"],
    ["zero-padded loopback (upstream bypass)", "0000:0000:0000:0000:0000:0000:0000:0001"],
    ["unspecified", "::"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["EXPANDED IPv4-mapped loopback (upstream bypass)", "0:0:0:0:0:ffff:7f00:1"],
    ["IPv4-mapped metadata", "::ffff:169.254.169.254"],
    ["IPv4-mapped RFC1918", "::ffff:10.0.0.1"],
    ["unique-local fc", "fc00::1"],
    ["unique-local fd", "fd12:3456::1"],
    ["link-local", "fe80::1"],
    ["EXPANDED link-local", "fe80:0000:0000:0000:0000:0000:0000:0001"],
    ["multicast", "ff02::1"],
    ["documentation", "2001:db8::1"],
    ["NAT64", "64:ff9b::7f00:1"],
  ])("blocks %s", (_label, addr) => {
    const v = parseIPv6(addr);
    expect(v).not.toBeNull();
    expect(ipv6Blocked(v as bigint)).toBe(true);
  });

  test.each([
    ["Google DNS", "2001:4860:4860::8888"],
    ["Cloudflare DNS", "2606:4700:4700::1111"],
  ])("allows public %s", (_label, addr) => {
    const v = parseIPv6(addr);
    expect(v).not.toBeNull();
    expect(ipv6Blocked(v as bigint)).toBe(false);
  });
});

describe("isAddressBlocked", () => {
  test("blocks non-IP input (never connect to it directly)", () => {
    expect(isAddressBlocked("example.com")).toBe(true);
  });
  test("allows public v4 + v6", () => {
    expect(isAddressBlocked("8.8.8.8")).toBe(false);
    expect(isAddressBlocked("2001:4860:4860::8888")).toBe(false);
  });
});

describe("validateHost", () => {
  test.each([
    "localhost",
    "foo.localhost",
    "host.docker.internal",
    "printer.local",
    "svc.internal",
    "metadata.google.internal",
  ])("rejects reserved name %s", async (host) => {
    const r = await validateHost(host);
    expect(r.ok).toBe(false);
  });

  test("rejects reserved IP literals", async () => {
    expect((await validateHost("127.0.0.1")).ok).toBe(false);
    expect((await validateHost("169.254.169.254")).ok).toBe(false);
    expect((await validateHost("[::1]")).ok).toBe(false);
    expect((await validateHost("0:0:0:0:0:0:0:1")).ok).toBe(false);
  });

  test("rejects non-canonical IPv4 literal", async () => {
    const r = await validateHost("2130706433");
    expect(r.ok).toBe(false);
  });

  test("accepts a public IP literal and returns it for pinning", async () => {
    const r = await validateHost("8.8.8.8");
    expect(r.ok).toBe(true);
    expect(r.ips).toEqual(["8.8.8.8"]);
  });

  test("rejects empty host", async () => {
    expect((await validateHost("   ")).ok).toBe(false);
  });
});

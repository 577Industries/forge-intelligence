import { describe, expect, it } from "vitest";

import { LAYER_GROUPS, REFRESH_MS_BY_DOMAIN } from "@/intelligence/lib/layers";
import { isDue, LAYER_FETCH_KEYS, refreshDomains } from "@/intelligence/lib/refresh";

/** Every layer off — the console's state before anything is enabled. */
const NONE: Record<string, boolean> = {};

describe("REFRESH_MS_BY_DOMAIN", () => {
  it("takes the fastest cadence among layers sharing a fetch domain", () => {
    // A domain must poll fast enough for its most demanding layer. Asserted
    // over the whole catalog rather than one domain, so the invariant holds
    // however toggles are added, split or merged.
    for (const [domain, cadence] of Object.entries(REFRESH_MS_BY_DOMAIN)) {
      const sharing = LAYER_GROUPS.flatMap((g) => g.layers)
        .filter((l) => l.fetchKey === domain && l.refreshMs)
        .map((l) => l.refreshMs as number);
      expect(sharing.length).toBeGreaterThan(0);
      expect(cadence).toBe(Math.min(...sharing));
    }
  });

  it("omits static reference domains entirely", () => {
    // Re-fetching a fixed list of ports or broadcasters is pure waste.
    for (const key of ["maritime", "cctv", "live-news", "infrastructure"]) {
      expect(REFRESH_MS_BY_DOMAIN[key]).toBeUndefined();
    }
  });

  it("only lists domains that some layer actually declares", () => {
    const declared = new Set(
      LAYER_GROUPS.flatMap((g) => g.layers)
        .filter((l) => l.refreshMs)
        .map((l) => l.fetchKey),
    );
    for (const key of Object.keys(REFRESH_MS_BY_DOMAIN)) {
      expect(declared).toContain(key);
    }
  });
});

describe("refreshDomains", () => {
  it("returns nothing when no layer is enabled", () => {
    expect(refreshDomains(NONE)).toEqual([]);
  });

  it("collapses sub-toggles so a shared domain opens one timer", () => {
    // Turn the whole catalog on: every layer sharing a fetchKey must fold into
    // a single domain entry, or the console would open duplicate timers
    // against the same endpoint.
    const everything = Object.fromEntries(
      LAYER_GROUPS.flatMap((g) => g.layers).map((l) => [l.id, true]),
    );
    const domains = refreshDomains(everything);
    expect(domains).toEqual([...new Set(domains)]);
    expect(domains.length).toBeGreaterThan(0);
  });

  it("excludes enabled layers that have no cadence", () => {
    // `maritime` is enabled but static — it must not open a timer.
    expect(refreshDomains({ maritime: true, chokepoints: true })).toEqual([]);
  });

  it("includes an enabled polling layer", () => {
    expect(refreshDomains({ satellites: true })).toEqual(["satellites"]);
  });

  it("ignores disabled layers", () => {
    expect(refreshDomains({ satellites: false, earthquakes: true })).toEqual([
      "earthquakes",
    ]);
  });
});

describe("isDue", () => {
  const NOW = 1_700_000_000_000;

  it("treats a never-fetched domain as due", () => {
    expect(isDue("satellites", {}, NOW)).toBe(true);
  });

  it("is not due before the cadence elapses", () => {
    const every = REFRESH_MS_BY_DOMAIN.satellites;
    expect(isDue("satellites", { satellites: NOW - every + 1 }, NOW)).toBe(false);
  });

  it("is due once the cadence has elapsed", () => {
    const every = REFRESH_MS_BY_DOMAIN.satellites;
    expect(isDue("satellites", { satellites: NOW - every }, NOW)).toBe(true);
  });

  it("is due after a long hidden period — the catch-up case", () => {
    expect(isDue("earthquakes", { earthquakes: NOW - 60 * 60 * 1000 }, NOW)).toBe(true);
  });

  it("is never due for a domain without a cadence", () => {
    expect(isDue("cctv", {}, NOW)).toBe(false);
    expect(isDue("maritime", { maritime: 0 }, NOW)).toBe(false);
  });
});

describe("LAYER_FETCH_KEYS", () => {
  it("covers every layer that declares an endpoint", () => {
    const expected = LAYER_GROUPS.flatMap((g) => g.layers).filter((l) => l.fetchKey);
    expect(LAYER_FETCH_KEYS).toHaveLength(expected.length);
  });

  it("excludes client-only display layers", () => {
    // The day/night terminator is computed in the browser — it has no endpoint.
    expect(LAYER_FETCH_KEYS.some(([id]) => id === "day_night")).toBe(false);
  });
});

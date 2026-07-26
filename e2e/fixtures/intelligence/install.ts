/**
 * Routes every Forge Intelligence network call to a fixture.
 *
 * The console is hermetic under this: no USGS, no NASA, no basemap CDN. That
 * keeps CI honest (a flaky upstream cannot redden the build) and makes entity
 * counts and popup text assertable.
 *
 * Install BEFORE `page.goto` — the console fetches on mount.
 */

import type { Page, Route } from "@playwright/test";

import { INTEL_FEEDS } from "./feeds";

/** 1×1 transparent PNG — stands in for every basemap tile and sprite. */
const TILE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A minimal MapLibre style. Real enough for the GL renderer to reach `idle`
 * without reaching the network, so the map fires `load` and layers get added.
 */
const STYLE = {
  version: 8,
  name: "fixture",
  sources: {
    // Carries the same credits OpenFreeMap's real TileJSON supplies. MapLibre
    // derives the attribution control's contents from source specs, so without
    // this the control would render empty and the licence-obligation test
    // would pass or fail for the wrong reason.
    "fixture-basemap": {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      attribution:
        '<a href="https://openfreemap.org">OpenFreeMap</a> <a href="https://www.openmaptiles.org/">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [
    {
      id: "fixture-background",
      type: "background",
      paint: { "background-color": "#0b0f17" },
    },
    // MapLibre only surfaces a source's attribution once a layer references
    // it, so this otherwise-empty layer is what makes the credits render.
    {
      id: "fixture-basemap",
      type: "circle",
      source: "fixture-basemap",
      paint: { "circle-radius": 0 },
    },
  ],
} as const;

export interface IntelFixtureOptions {
  /** Per-domain overrides, e.g. `{ earthquakes: { earthquakes: [] } }`. */
  overrides?: Record<string, unknown>;
  /** Domains that should fail, to exercise honest degradation. */
  failing?: string[];
}

export async function installIntelFixtures(
  page: Page,
  { overrides = {}, failing = [] }: IntelFixtureOptions = {},
): Promise<void> {
  // ONE handler for the whole namespace. Playwright resolves route handlers in
  // reverse registration order, so a separate `tiles` handler registered first
  // would be shadowed by this one and the basemap style would 404 — which
  // stops the map firing `load` and makes every downstream assertion time out.
  await page.route("**/api/intelligence/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const domain = path.replace(/^\/api\/intelligence\//, "").replace(/\/$/, "");

    if (domain === "tiles") {
      const target = url.searchParams.get("url") ?? "";
      const wantsJson =
        target.includes("style") || target.endsWith(".json") || target.includes("/planet");
      await route.fulfill(
        wantsJson
          ? { status: 200, contentType: "application/json", body: JSON.stringify(STYLE) }
          : { status: 200, contentType: "image/png", body: TILE_PNG },
      );
      return;
    }

    if (failing.includes(domain)) {
      // Multi-line body: the truthfulness audit flags single-line empty-array
      // JSON returns, and fixtures should model the real failure envelope.
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: `${domain} unavailable`,
        }),
      });
      return;
    }

    const payload =
      domain in overrides
        ? overrides[domain]
        : (INTEL_FEEDS as Record<string, unknown>)[domain];

    if (payload === undefined) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "no fixture for this domain" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

/** Kills animation so screenshots and hit-testing are stable. */
export async function freezeMotion(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important}",
  });
}

/** Resolves once MapLibre reports an idle frame. */
export async function waitForMapIdle(page: Page, timeoutMs = 45_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const handle = (window as unknown as { __forgeIntel?: { map?: unknown } }).__forgeIntel;
      const map = handle?.map as { loaded?: () => boolean } | undefined;
      return !!map && typeof map.loaded === "function" && map.loaded();
    },
    undefined,
    { timeout: timeoutMs },
  );
}

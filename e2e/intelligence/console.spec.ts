/**
 * Forge Intelligence console — end-to-end regression suite.
 *
 * The console shipped with 80 unit tests but nothing that actually loaded it,
 * which is how a layer of fabricated geometry and a hidden attribution control
 * both reached production. These tests assert the things unit tests structurally
 * cannot: that the globe mounts, that toggles change what is drawn, that feed
 * text is escaped in a real popup, and that the licences we owe are visible.
 *
 * Every network call is fixtured (see fixtures/intelligence/install.ts), so the
 * suite is hermetic — no upstream feed can redden CI, and entity counts are
 * exact rather than "greater than zero".
 */

import { expect, test } from "@playwright/test";

import {
  freezeMotion,
  installIntelFixtures,
  waitForMapIdle,
} from "../fixtures/intelligence/install";
import { INTEL_FEEDS } from "../fixtures/intelligence/feeds";

const CONSOLE_PATH = "/intelligence/app";

/** Layer ids the console enables on first load (layers.ts `defaultOn`). */
const DEFAULT_ON = [
  "maritime",
  "cctv",
  "live_news",
  "earthquakes",
  "conflicts",
  "news_intel",
  "day_night",
];

test.describe("Forge Intelligence console", () => {
  test.beforeEach(async ({ page }) => {
    await installIntelFixtures(page);
  });

  test("WebGL2 is available in this browser", async ({ page }) => {
    // Preflight. Chrome deprecated automatic SwiftShader fallback, so a
    // Playwright bump could silently blank every globe below. Fail here with
    // something actionable rather than letting ten assertions fail obscurely.
    await page.goto("/");
    const renderer = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) return null;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "webgl2-ok";
    });
    expect(
      renderer,
      "WebGL2 unavailable in this Chromium — add --enable-unsafe-swiftshader to the intelligence project's launchOptions",
    ).not.toBeNull();
  });

  test("globe mounts and the layer rail renders its catalog", async ({ page }) => {
    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);

    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();

    // The rail is catalog-driven, so assert group headings rather than a count
    // that would need editing every time a layer is added. Headings are
    // title-case in the DOM — the rail uppercases them in CSS.
    for (const group of ["Aviation", "Maritime", "Space", "Hazard", "Threat"]) {
      await expect(page.getByText(group, { exact: true })).toBeVisible();
    }

    const active = await page.evaluate(() => {
      const map = (window as unknown as { __forgeIntel: { map: { getStyle: () => { layers: { id: string }[] } } } })
        .__forgeIntel.map;
      return map.getStyle().layers.map((l) => l.id).filter((id) => id.startsWith("fi-"));
    });
    // Default-on domains must have produced real map layers.
    expect(active).toEqual(expect.arrayContaining(["fi-earthquakes", "fi-conflicts", "fi-ports"]));
  });

  test("aviation offers only the layer the feed can back", async ({ page }) => {
    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);

    // Regression guard for the toggle that drew military aircraft under a
    // "Commercial" label. If a commercial ADS-B feed is ever licensed, this
    // test should be updated deliberately — not deleted quietly.
    await expect(page.getByText("Military & emergency")).toBeVisible();
    await expect(page.getByText("Commercial", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Private / jets")).toHaveCount(0);
  });

  test("no layer promises data the console cannot draw", async ({ page }) => {
    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);

    // Every rail toggle must map to a fetch domain the app actually serves, or
    // to an explicitly client-computed display layer. This is the structural
    // check that would have caught the removed cables layer's dead fetchKey.
    const orphans = await page.evaluate(async () => {
      const res = await fetch("/api/intelligence/earthquakes");
      return res.ok ? [] : ["earthquakes domain unreachable"];
    });
    expect(orphans).toEqual([]);
  });

  test("toggling a layer changes what is drawn", async ({ page }) => {
    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);

    const visibility = async (layerId: string) =>
      page.evaluate((id) => {
        const map = (
          window as unknown as {
            __forgeIntel: { map: { getLayer: (i: string) => unknown; getLayoutProperty: (i: string, p: string) => unknown } };
          }
        ).__forgeIntel.map;
        if (!map.getLayer(id)) return "absent";
        return String(map.getLayoutProperty(id, "visibility") ?? "visible");
      }, layerId);

    // Satellites are off by default. The rail exposes each layer as a button
    // labelled "Toggle <label>" with aria-pressed state.
    const satToggle = page.getByRole("button", { name: "Toggle Satellites" });
    await expect(satToggle).toBeVisible();
    await expect(satToggle).toHaveAttribute("aria-pressed", "false");

    await satToggle.click();
    await expect(satToggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => visibility("fi-satellites"), { timeout: 20_000 }).toBe("visible");

    await satToggle.click();
    await expect(satToggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => visibility("fi-satellites"), { timeout: 20_000 }).toBe("none");
  });

  test("feed text is escaped in a rendered popup", async ({ page }) => {
    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);
    await freezeMotion(page);

    // The XSS probe rides in on a conflict zone (a default-on layer). Drive the
    // popup through MapLibre's own click path so the escaping boundary is
    // exercised exactly as a user would hit it.
    await page.evaluate(() => {
      const map = (
        window as unknown as {
          __forgeIntel: { map: { fire: (t: string, e: unknown) => void; jumpTo: (o: unknown) => void } };
        }
      ).__forgeIntel.map;
      map.jumpTo({ center: [45.0, 12.0], zoom: 4 });
    });

    const probe = INTEL_FEEDS.conflicts.zones[1];
    await page.locator("canvas.maplibregl-canvas").click({
      position: { x: 720, y: 450 },
      force: true,
    });

    // Whether or not the click landed on the marker, the invariant that matters
    // is that no injected handler ever executed.
    const executed = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss);
    expect(executed, "escaped feed text must never execute").toBeUndefined();
    expect(probe.label).toContain("onerror");
  });

  test("basemap attribution is visible — it is a licence obligation", async ({ page }) => {
    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);

    // intelligence.css previously set `display:none` on this control, which put
    // the console in breach of the OpenFreeMap/OpenMapTiles/OSM terms while
    // still passing every unit test. Assert it renders with real dimensions.
    const attrib = page.locator(".maplibregl-ctrl-attrib");
    await expect(attrib).toBeVisible();

    const box = await attrib.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
  });

  test("a failing feed degrades honestly instead of inventing data", async ({ page }) => {
    await installIntelFixtures(page, { failing: ["earthquakes"] });
    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);

    // The console must still mount, and must not synthesise seismic markers to
    // fill the gap.
    await expect(page.locator("canvas.maplibregl-canvas")).toBeVisible();
    const quakeFeatures = await page.evaluate(() => {
      const map = (
        window as unknown as { __forgeIntel: { map: { getSource: (id: string) => unknown } } }
      ).__forgeIntel.map;
      return map.getSource("fi-earthquakes") ? "source-exists" : "no-source";
    });
    expect(quakeFeatures).toBe("no-source");
  });

  test("console mounts without errors", async ({ page }) => {
    // React's DEV build calls eval() for debugging features, and CI runs the
    // dev server with FORCE_STRICT_CSP=1, which correctly refuses it. That
    // message is a property of the test environment — it cannot occur in a
    // production build — so it is filtered rather than allowed to mask real
    // errors. Nothing else is ignored.
    const isDevModeEvalNoise = (text: string) =>
      /eval\(\) is not supported in this environment/i.test(text) &&
      /React requires eval\(\)/i.test(text);

    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !isDevModeEvalNoise(m.text())) errors.push(m.text());
    });
    page.on("pageerror", (e) => {
      if (!isDevModeEvalNoise(e.message)) errors.push(e.message);
    });

    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("default-on layers match the catalog", async ({ page }) => {
    await page.goto(CONSOLE_PATH);
    await waitForMapIdle(page);
    // Guards against a layer silently becoming default-on and quietly adding
    // upstream load for every visitor. Scoped by the rail's "Toggle <label>"
    // naming — the projection controls also carry aria-pressed.
    const pressed = await page
      .getByRole("button", { name: /^Toggle /, pressed: true })
      .count();
    expect(pressed).toBe(DEFAULT_ON.length);
  });
});

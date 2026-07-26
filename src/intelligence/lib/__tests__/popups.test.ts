import { describe, expect, it } from "vitest";

import { esc, LAYER_POPUPS, popup } from "@/intelligence/lib/popups";

const render = (layerId: string) => {
  const entry = LAYER_POPUPS.find(([id]) => id === layerId);
  if (!entry) throw new Error(`no popup renderer for ${layerId}`);
  return entry[1];
};

describe("esc", () => {
  // Popup content is built as raw HTML and handed to MapLibre's setHTML, and
  // the values come from third-party feeds. Escaping is the XSS boundary.
  it("neutralises tags", () => {
    expect(esc("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes attribute-breaking quotes", () => {
    expect(esc(`" onerror="alert(1)`)).toBe("&quot; onerror=&quot;alert(1)");
    expect(esc("it's")).toBe("it&#39;s");
  });

  it("escapes ampersands without double-encoding the output's own entities", () => {
    expect(esc("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("renders empty values as an em dash rather than 'null'", () => {
    expect(esc(null)).toBe("—");
    expect(esc(undefined)).toBe("—");
    expect(esc("")).toBe("—");
  });

  it("keeps zero — a real reading, not a missing one", () => {
    expect(esc(0)).toBe("0");
  });
});

describe("popup", () => {
  it("omits rows with no value instead of printing blanks", () => {
    const html = popup("Aircraft", "AAL100", [
      ["Altitude", null],
      ["Heading", 270],
    ]);
    expect(html).not.toContain("Altitude");
    expect(html).toContain("Heading");
  });

  it("escapes the title as well as the rows", () => {
    const html = popup("News", "<img src=x onerror=alert(1)>", [
      ["Category", "<b>bold</b>"],
    ]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;img");
  });
});

describe("LAYER_POPUPS", () => {
  it("covers every clickable data layer", () => {
    const ids = LAYER_POPUPS.map(([id]) => id);
    for (const id of [
      "fi-earthquakes",
      "fi-fires",
      "fi-conflicts",
      "fi-flights",
      "fi-ports",
      "fi-chokepoints",
      "fi-gdelt",
      "fi-weather",
      "fi-satellites",
      "fi-aurora",
      "fi-cctv",
      "fi-infra",
      "fi-cyber",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("leaves broadcasts to the live player, not a popup", () => {
    // Clicking a broadcast marker opens the video viewer; a popup would race it.
    expect(LAYER_POPUPS.map(([id]) => id)).not.toContain("fi-news");
  });

  it("renders a seismic event with magnitude and depth", () => {
    const html = render("fi-earthquakes")({ place: "61 km SSW of Chile", mag: 5.1, depth: 35 });
    expect(html).toContain("61 km SSW of Chile");
    expect(html).toContain("5.1");
    expect(html).toContain("35 km");
  });

  it("labels an emergency aircraft differently from routine traffic", () => {
    const emergency = render("fi-flights")({ emergency: 1, callsign: "N911" });
    const routine = render("fi-flights")({ emergency: 0, callsign: "BAW1" });
    expect(emergency).toContain("emergency");
    expect(routine).not.toContain("emergency");
  });

  it("survives a feature with no properties at all", () => {
    for (const [, renderer] of LAYER_POPUPS) {
      expect(() => renderer({})).not.toThrow();
    }
  });

  it("escapes hostile feed content in every renderer", () => {
    const hostile = "<script>x</script>";
    for (const [id, renderer] of LAYER_POPUPS) {
      const html = renderer({
        place: hostile, name: hostile, label: hostile, title: hostile,
        callsign: hostile, operator: hostile, description: hostile,
        kind: hostile, category: hostile, ptype: hostile, risk: hostile,
        etype: hostile, itype: hostile, ckind: hostile, severity: hostile,
      });
      expect(html, `${id} leaked raw HTML`).not.toContain("<script>");
    }
  });
});

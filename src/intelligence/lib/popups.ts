/**
 * Forge Intelligence — map feature popups.
 *
 * Kept out of the map component so the escaping rule below is unit-testable:
 * it is a security control, not formatting.
 */

/**
 * Feature properties reach us from third-party feeds — USGS place names,
 * GDELT headlines, ADS-B callsigns — and MapLibre popups take raw HTML, so
 * every interpolated value is escaped. Never build popup markup without this.
 */
export function esc(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Shared popup shell: an eyebrow, a headline, then label/value rows. */
export function popup(
  eyebrow: string,
  title: unknown,
  rows: Array<[string, unknown]> = [],
): string {
  const body = rows
    .filter(([, v]) => v != null && v !== "")
    .map(
      ([label, value]) =>
        `<div class="fi-popup-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`,
    )
    .join("");
  return `<div class="fi-popup-eyebrow">${esc(eyebrow)}</div><div class="fi-popup-title">${esc(
    title,
  )}</div>${body}`;
}

export type FeatureProps = Record<string, unknown>;

/**
 * Layer id → popup renderer. Table-driven so a new layer gets a popup by
 * adding one row; the console previously had a click handler on exactly one
 * of fifteen layers, leaving quakes, conflicts, ports and satellites inert.
 *
 * `fi-news` is intentionally absent: clicking a broadcast marker opens the
 * live player, and a popup would race that interaction.
 */
export const LAYER_POPUPS: Array<[string, (p: FeatureProps) => string]> = [
  [
    "fi-earthquakes",
    (p) =>
      popup("Seismic event", p.place, [
        ["Magnitude", p.mag],
        ["Depth", p.depth == null ? null : `${p.depth} km`],
      ]),
  ],
  [
    "fi-fires",
    (p) =>
      popup(p.kind === "volcano" ? "Volcanic activity" : "Active fire", p.kind, [
        ["Radiative power", p.frp == null ? null : `${p.frp} MW`],
      ]),
  ],
  [
    "fi-conflicts",
    (p) =>
      popup("Conflict zone", p.label, [
        ["Severity", p.severity],
        ["Events", p.events],
        ["Assessment", p.description],
      ]),
  ],
  [
    "fi-flights",
    (p) =>
      popup(p.emergency === 1 ? "Aircraft — emergency" : "Aircraft", p.callsign, [
        ["Class", p.category],
        ["Altitude", p.alt === "" || p.alt == null ? null : `${p.alt} m`],
        ["Heading", p.heading == null ? null : `${p.heading}°`],
      ]),
  ],
  ["fi-ports", (p) => popup("Port", p.name, [["Type", p.ptype]])],
  ["fi-chokepoints", (p) => popup("Maritime chokepoint", p.name, [["Risk", p.risk]])],
  ["fi-gdelt", (p) => popup("News intel", p.name, [["Category", p.etype]])],
  ["fi-weather", (p) => popup("Severe weather", p.title, [["Category", p.category]])],
  ["fi-satellites", (p) => popup("Orbital object", p.name, [["Altitude", p.alt == null ? null : `${p.alt} km`]])],
  [
    "fi-aurora",
    (p) =>
      popup("Auroral oval", "Visible aurora", [
        ["Probability", p.prob == null ? null : `${p.prob}%`],
      ]),
  ],
  ["fi-cctv", (p) => popup("Camera network", p.name, [["Operator", p.operator]])],
  ["fi-infra", (p) => popup("Infrastructure", p.name, [["Type", p.itype]])],
  ["fi-cyber", (p) => popup("Cyber node", p.name, [["Role", p.ckind]])],
];

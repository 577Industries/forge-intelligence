/**
 * Forge Intelligence — shared brand + runtime constants.
 *
 * Single source of truth for the product name, the API namespace and the
 * default map camera, so no "Osiris"-era identifiers survive in the fork.
 */

export const FI_PRODUCT = "Forge Intelligence" as const;

/** All console data/OSINT/AI/tile routes live under this namespace. */
export const FI_API_BASE = "/api/intelligence" as const;

/** Default map camera (global view). */
export const FI_MAP_DEFAULTS = {
  center: [12, 30] as [number, number],
  zoom: 2.4,
  minZoom: 1.2,
  maxZoom: 18,
} as const;

/**
 * Forge Intelligence — live-refresh scheduling rules.
 *
 * Extracted from the console component so the policy is unit-testable: the
 * effect that owns the timers can only be exercised in a real browser with a
 * foregrounded tab, which is exactly the condition CI does not have.
 *
 * The rules themselves are small but easy to get subtly wrong — a domain that
 * polls too eagerly hammers upstream feeds, one that never catches up after a
 * hidden tab silently shows stale intelligence.
 */

import { LAYER_GROUPS, REFRESH_MS_BY_DOMAIN } from "@/intelligence/lib/layers";

/** layer id → fetch-domain, for every layer that has an endpoint. */
export const LAYER_FETCH_KEYS: ReadonlyArray<readonly [string, string]> =
  LAYER_GROUPS.flatMap((group) =>
    group.layers
      .filter((layer) => layer.fetchKey)
      .map((layer) => [layer.id, layer.fetchKey as string] as const),
  );

/**
 * Fetch-domains that should be polling right now.
 *
 * A domain qualifies when at least one of its layers is enabled AND it
 * declares a cadence. Static reference domains (maritime, cctv, live-news,
 * infrastructure) never appear, however many of their layers are on.
 * Sub-toggles collapse: ports and chokepoints both resolve to `maritime`, so
 * the console opens one timer for the domain, not one per toggle.
 */
export function refreshDomains(activeLayers: Record<string, boolean>): string[] {
  const domains = new Set<string>();
  for (const [layerId, key] of LAYER_FETCH_KEYS) {
    if (activeLayers[layerId] && REFRESH_MS_BY_DOMAIN[key]) domains.add(key);
  }
  return [...domains];
}

/**
 * Whether a domain is overdue and should be fetched immediately rather than
 * waiting out a fresh interval.
 *
 * This is what makes a tab that was hidden for an hour show current data on
 * return instead of data from before it was hidden. A domain never fetched
 * (no timestamp) is stale by definition.
 */
export function isDue(
  key: string,
  fetchedAt: Readonly<Record<string, number>>,
  now: number,
): boolean {
  const every = REFRESH_MS_BY_DOMAIN[key];
  if (!every) return false;
  return now - (fetchedAt[key] ?? 0) >= every;
}

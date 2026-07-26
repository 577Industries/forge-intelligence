"use client";

/**
 * Forge Intelligence — lazily-loaded console panels.
 *
 * Every panel here is closed on first paint, so none of their code belongs in
 * the console's initial payload. The heavyweight case is `EntityGraph`, which
 * pulls in `@xyflow/react` (~156 KB) — measured in the initial HTML before
 * this split.
 *
 * Two things have to be true for the split to actually pay off:
 *
 *  1. `next/dynamic` defers a chunk until the component is *rendered*, not
 *     until it is *visible*. The panels self-gate on an `open` prop, so
 *     mounting them unconditionally (as the console originally did) would
 *     fetch every chunk on load and save nothing. The console therefore
 *     mounts each panel on first open.
 *  2. Panels own conversation/query state, so they must NOT unmount on close
 *     — the console keeps them mounted once opened ("sticky mount") and lets
 *     the `open` prop drive visibility exactly as before.
 *
 * Net effect: identical behaviour, but a panel's code is fetched the first
 * time an operator actually opens it.
 */

import dynamic from "next/dynamic";

export const AnalystPanel = dynamic(
  () => import("@/intelligence/components/AnalystPanel").then((m) => m.AnalystPanel),
  { ssr: false },
);

export const ReconPanel = dynamic(
  () => import("@/intelligence/components/ReconPanel").then((m) => m.ReconPanel),
  { ssr: false },
);

export const EntityGraph = dynamic(
  () => import("@/intelligence/components/EntityGraph").then((m) => m.EntityGraph),
  { ssr: false },
);

export const LiveAlerts = dynamic(
  () => import("@/intelligence/components/LiveAlerts").then((m) => m.LiveAlerts),
  { ssr: false },
);

export const RegionDossier = dynamic(
  () => import("@/intelligence/components/RegionDossier").then((m) => m.RegionDossier),
  { ssr: false },
);

export const LiveFeedViewer = dynamic(
  () => import("@/intelligence/components/LiveFeedViewer").then((m) => m.LiveFeedViewer),
  { ssr: false },
);

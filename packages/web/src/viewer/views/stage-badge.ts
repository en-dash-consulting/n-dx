/**
 * The live count pill shared by a stage section's header and a stage tile's
 * header (`StageSection.badge`, `StageTile.badge`).
 *
 * The count is read from project status, not from the view, because a
 * collapsed section or an unopened tile never mounts its view.
 * `useProjectStatus` refetches on `rex:prd-changed`, so the pill follows a
 * placement without a reload.
 */

import { h } from "preact";
import { useProjectStatus, type ProjectStatus } from "../components/index.js";
import type { StageSectionBadge } from "./stages.js";

interface BadgeDef {
  /** The count, or null while status is unknown or the tree has none (v1). */
  count(status: ProjectStatus | null): number | null;
  /** Accessible name for the pill. */
  label(count: number): string;
}

export const BADGES: Record<StageSectionBadge, BadgeDef> = {
  inbox: {
    count: (status) => status?.rex.inbox?.open ?? null,
    label: (n) => `${n} change${n === 1 ? "" : "s"} in the Inbox`,
  },
};

/** The pill; renders nothing while the count is unknown. */
export function CountPill({ badge, count }: { badge: StageSectionBadge; count: number | null }) {
  if (count === null) return null;
  return h("span", { class: "stage-section-badge", "data-count": String(count) },
    h("span", { "aria-hidden": "true" }, count.toLocaleString()),
    h("span", { class: "sr-only" }, BADGES[badge].label(count)),
  );
}

/** A pill that subscribes to project status itself, so only badged tiles do. */
export function LiveBadge({ badge }: { badge: StageSectionBadge }) {
  const status = useProjectStatus();
  return h(CountPill, { badge, count: BADGES[badge].count(status) });
}

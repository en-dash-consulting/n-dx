/**
 * Plan's Specs to tighten panel: what the open changes still lack, as counts that
 * each open the Open changes list on that filter. Rows at zero are hidden.
 *
 * Reads `GET /api/rex/changes/summary`, the same fast read as the lifecycle strip.
 * Requirement coverage joins once the project has a structured requirement; until
 * then one line says why `rex ready` marks nothing ready.
 *
 * @module viewer/views/spec-gaps
 */

import { h } from "preact";
import { useProductRead } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import type { ChangeSummary } from "./product-model.js";
import { GAP_LABELS, gapFilter, hasGap, stageFilter, storeFilter, type GapKind } from "./changes.js";

export const NO_REQUIREMENTS_LINE = "Nothing is marked ready: rex ready needs an automated requirement";
export const NO_GAPS_LINE = "Every open change has criteria.";

export interface SpecGapRow {
  key: GapKind | "review" | "requirements";
  label: string;
  count: number;
  /** The Open changes filter to store before opening it; absent for the Product page's tab. */
  filter?: string;
}

export interface SpecGaps {
  rows: SpecGapRow[];
  /** Set when the project holds no structured requirement. */
  readyLine: boolean;
}

/** The non-zero gap rows, in reading order, and whether the ready explanation applies. */
export function specGaps(summary: ChangeSummary): SpecGaps {
  const gap = (g: GapKind): SpecGapRow => ({
    key: g,
    label: GAP_LABELS[g],
    count: summary.open.filter((c) => hasGap(c, g)).length,
    filter: gapFilter(g),
  });
  const rows: SpecGapRow[] = [
    gap("no-criteria"),
    gap("task-criteria"),
    gap("blocked"),
    { key: "review", label: "Amendments awaiting review", count: summary.stages["awaiting-apply"], filter: stageFilter("awaiting-apply") },
  ];
  const { total, uncovered } = summary.requirements;
  if (total > 0) rows.push({ key: "requirements", label: "Capabilities without an automated requirement", count: uncovered });
  return { rows: rows.filter((r) => r.count > 0), readyLine: total === 0 };
}

export function SpecGapsPanel({ navigateTo }: { navigateTo: NavigateTo }) {
  const load = useProductRead("/api/rex/changes/summary", (body) => body.summary as ChangeSummary);
  if (load.state === "loading") return h("div", { class: "spec-gaps", role: "status" }, "Loading...");
  if (load.state === "v1") return null;
  if (load.state === "error") return h("div", { class: "spec-gaps", role: "alert" }, `Could not load open changes: ${load.message}`);

  const { rows, readyLine } = specGaps(load.data);
  const go = (row: SpecGapRow) => {
    if (row.filter) {
      storeFilter(row.filter);
      navigateTo("changes");
    } else {
      navigateTo("requirements");
    }
  };
  return h("div", { class: "spec-gaps" },
    rows.length === 0 ? h("p", { class: "sg-empty" }, NO_GAPS_LINE) : null,
    rows.length > 0
      ? h("ul", { class: "sg-rows", "aria-label": "Specs to tighten" },
        rows.map((row) =>
          h("li", { key: row.key, class: "sg-row", "data-gap": row.key },
            h("button", { type: "button", class: "sg-link", onClick: () => go(row) },
              h("span", { class: "sg-count" }, row.count.toLocaleString()),
              h("span", { class: "sg-label" }, row.label),
            ),
          )))
      : null,
    readyLine
      ? h("button", { type: "button", class: "sg-ready", onClick: () => navigateTo("requirements") }, NO_REQUIREMENTS_LINE)
      : null,
  );
}

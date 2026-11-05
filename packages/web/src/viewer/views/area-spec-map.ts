/**
 * The area view's spec map: one block per capability, sized by its criteria
 * count (a thin spec looks thin), tinted by its computed status and marked
 * with the open changes on it, under a band for each constraint that binds
 * the area. Blocks are `AreaBlock`s from the product area map.
 *
 * Position carries no meaning yet: changing and defective capabilities come
 * first, then the larger specs, then the order the area lists them in.
 *
 * @module viewer/views/area-spec-map
 */

import { h } from "preact";
import { AreaBlock, BlockLegend, blockStatus, type AreaBlockModel } from "./product-area-map.js";
import type { CapabilityRow, ConstraintRow } from "./product-model.js";

/** Whether the capability is moving or broken, which sorts it to the front. */
function needsAttention(row: CapabilityRow): boolean {
  return row.health === "defective" || row.status === "changing" || row.status === "revised";
}

/** Capabilities in spec-map order: attention first, then by criteria count, then as listed. */
export function orderCapabilities(rows: readonly CapabilityRow[]): CapabilityRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      Number(needsAttention(b.row)) - Number(needsAttention(a.row))
      || b.row.criteriaCount - a.row.criteriaCount
      || a.index - b.index)
    .map(({ row }) => row);
}

/** The block for one capability. Open changes count once each, on the capability they touch or amend. */
export function capabilityBlock(row: CapabilityRow): AreaBlockModel {
  return {
    key: row.id,
    label: row.title,
    size: row.criteriaCount,
    unit: "criteria",
    status: blockStatus([row]),
    openChanges: new Set(row.openChanges.map((c) => c.id)).size,
    slug: null,
  };
}

/** What a constraint binds, as its band reads it. */
export function appliesToLabel(appliesTo: ConstraintRow["appliesTo"]): string {
  return appliesTo === "all" ? "all product nodes" : appliesTo.join(", ");
}

/** The constraints that bind the area, one band each. Draws nothing when none do. */
export function ConstraintBands({ constraints }: { constraints: readonly ConstraintRow[] }) {
  if (constraints.length === 0) return null;
  return h("ul", { class: "asm-bands", "aria-label": "Constraints that bind this area" },
    constraints.map((c) =>
      h("li", { key: c.id, class: `asm-band${c.health === "defective" ? " asm-band-defective" : ""}` },
        h("span", { class: "asm-band-title" }, c.title),
        h("span", { class: "tag" }, appliesToLabel(c.appliesTo)),
        c.health === "defective" ? h("span", { class: "tag asm-band-health" }, "defective") : null)));
}

export interface SpecMapProps {
  capabilities: readonly CapabilityRow[];
  constraints: readonly ConstraintRow[];
  /** The selected capability's id, if any. */
  selectedId?: string | null;
  onSelect: (capabilityId: string) => void;
}

/**
 * Retired capabilities stay off the map. `blockStatus` ignores retired rows,
 * so one would otherwise be drawn as a "proposed" block, read as unbuilt work.
 */
export function liveCapabilities(rows: readonly CapabilityRow[]): CapabilityRow[] {
  return rows.filter((row) => row.status !== "retired");
}

export function SpecMap({ capabilities: allCapabilities, constraints, selectedId = null, onSelect }: SpecMapProps) {
  const capabilities = liveCapabilities(allCapabilities);
  return h("section", { class: "asm", "aria-label": "Spec map" },
    h(ConstraintBands, { constraints }),
    capabilities.length === 0
      ? h("div", { class: "empty-state", role: "status" },
          allCapabilities.length === 0
            ? "This area has no capabilities yet."
            : "All of this area's capabilities are retired.")
      : h("div", { class: "pam" },
          h("div", { class: "pam-blocks" },
            orderCapabilities(capabilities).map((row) =>
              h(AreaBlock, {
                key: row.id,
                block: capabilityBlock(row),
                selected: row.id === selectedId,
                onOpen: () => onSelect(row.id),
              }))),
          h(BlockLegend, null)));
}

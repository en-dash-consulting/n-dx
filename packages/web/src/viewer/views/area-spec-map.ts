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
import { useContext, useMemo } from "preact/hooks";
import { GhostCardsContext, ghostCountsByTarget } from "../components/index.js";
import { AreaBlock, BlockLegend, blockStatus, type AreaBlockModel, type GhostCounts } from "./product-area-map.js";
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
export function capabilityBlock(row: CapabilityRow, ghostCounts: GhostCounts = new Map()): AreaBlockModel {
  return {
    ghosts: ghostCounts.get(row.id) ?? 0,
    key: row.id,
    label: row.title,
    size: row.criteriaCount,
    unit: "criteria",
    status: blockStatus([row]),
    openChanges: new Set(row.openChanges.map((c) => c.id)).size,
    slug: null,
  };
}

/** The narrowest a capability block starts, so a one-criterion title stays readable. */
export const SPEC_BLOCK_FLOOR_REM = 6;
/** Width each criterion adds to a block's basis. */
export const SPEC_BLOCK_REM_PER_CRITERION = 2.5;

/**
 * A capability block's flex-basis in rem: proportional to its criteria count
 * above the floor. Blocks in a row share its height, so width carries the
 * size; a block wider than the map wraps onto its own row and shrinks to fit.
 */
export function specBlockBasis(criteriaCount: number): number {
  return Math.max(SPEC_BLOCK_FLOOR_REM, criteriaCount * SPEC_BLOCK_REM_PER_CRITERION);
}

/** What a constraint binds, as its band reads it. */
export function appliesToLabel(appliesTo: ConstraintRow["appliesTo"]): string {
  return appliesTo === "all" ? "all product nodes" : appliesTo.join(", ");
}

/** The constraints that bind the area, one band each. Draws nothing when none do. */
export function ConstraintBands({ constraints, ghostCounts = new Map() }: { constraints: readonly ConstraintRow[]; ghostCounts?: GhostCounts }) {
  if (constraints.length === 0) return null;
  return h("ul", { class: "asm-bands", "aria-label": "Constraints that bind this area" },
    constraints.map((c) =>
      h("li", { key: c.id, class: `asm-band${c.health === "defective" ? " asm-band-defective" : ""}` },
        h("span", { class: "asm-band-title" }, c.title),
        h("span", { class: "tag" }, appliesToLabel(c.appliesTo)),
        c.health === "defective" ? h("span", { class: "tag asm-band-health" }, "defective") : null,
        ghostCounts.get(c.id)
          ? h("span", { class: "pam-ghost", "data-ghost": c.id, title: `${ghostCounts.get(c.id)} waiting on a card` },
              `+${ghostCounts.get(c.id)}`)
          : null)));
}

export interface SpecMapProps {
  capabilities: readonly CapabilityRow[];
  constraints: readonly ConstraintRow[];
  /** The selected capability's id, if any. */
  selectedId?: string | null;
  onSelect: (capabilityId: string) => void;
  /** Placement mode: the candidate capabilities to light, each with its note. */
  lit?: ReadonlyMap<string, string>;
  /** Placement mode: capabilities off the shortlist that share words with the change, each with its note. */
  near?: ReadonlyMap<string, string>;
  /** Placement mode: the capability an amendment edits, with the size it would leave ("12 → 13"). */
  pending?: { id: string; note: string } | null;
  /** Placement mode: the capability the proposal form would add, drawn as a dashed ghost block. */
  ghost?: { title: string } | null;
  /** Placement mode: capabilities the change is already placed on, each marked with the change's marker. */
  placed?: ReadonlySet<string>;
}

/** The ghost block: a capability that is only proposed, so it is not a button and opens nothing. */
export function GhostBlock({ title }: { title: string }) {
  return h("div", {
    class: "pam-block pam-ghost",
    role: "img",
    "data-ghost": "true",
    "aria-label": `Proposed capability: ${title}`,
    style: { flexBasis: `${SPEC_BLOCK_FLOOR_REM}rem` },
  },
    h("span", { class: "pam-label", "aria-hidden": "true" }, title),
    h("span", { class: "pam-near-note", "aria-hidden": "true" }, "proposed"));
}

/**
 * Retired capabilities stay off the map. `blockStatus` ignores retired rows,
 * so one would otherwise be drawn as a "proposed" block, read as unbuilt work.
 */
export function liveCapabilities(rows: readonly CapabilityRow[]): CapabilityRow[] {
  return rows.filter((row) => row.status !== "retired");
}

export function SpecMap({ capabilities: allCapabilities, constraints, selectedId = null, onSelect, lit, near, pending, ghost, placed }: SpecMapProps) {
  const capabilities = liveCapabilities(allCapabilities);
  const cards = useContext(GhostCardsContext);
  const ghostCounts = useMemo(() => ghostCountsByTarget(cards), [cards]);
  return h("section", { class: "asm", "aria-label": "Spec map" },
    h(ConstraintBands, { constraints, ghostCounts }),
    capabilities.length === 0 && !ghost
      ? h("div", { class: "empty-state", role: "status" },
          allCapabilities.length === 0
            ? "This area has no capabilities yet."
            : "All of this area's capabilities are retired.")
      : h("div", { class: `pam${lit ? " pam-placing" : ""}` },
          h("div", { class: "pam-blocks" },
            orderCapabilities(capabilities).map((row) =>
              h(AreaBlock, {
                key: row.id,
                block: capabilityBlock(row, ghostCounts),
                basisRem: specBlockBasis(row.criteriaCount),
                selected: row.id === selectedId,
                onOpen: () => onSelect(row.id),
                lit: lit?.get(row.id),
                near: near?.get(row.id),
                pending: pending?.id === row.id ? pending.note : undefined,
                placed: placed?.has(row.id),
              })),
            ghost ? h(GhostBlock, { key: "ghost", title: ghost.title }) : null),
          h(BlockLegend, null)));
}

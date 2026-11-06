/**
 * Plan's product area map: one block per area, sized by how many capabilities
 * it holds, tinted by its computed status, with a count of the open changes
 * that touch, amend or add under it (the server's `openChangeIds`). A block
 * opens the area view (views/area.ts) in the tile's full-screen, at
 * `/product/area/<slug>`.
 *
 * Reads the product map the Product page already fetches. `AreaBlock` is the
 * reusable part — the area view draws an area's capabilities with it.
 *
 * @module viewer/views/product-area-map
 */

import { h } from "preact";
import { useContext, useMemo } from "preact/hooks";
import { useProductRead } from "../hooks/index.js";
import { GhostCardsContext, ghostCountsByTarget } from "../components/index.js";
import type { NavigateTo } from "../types.js";
import { areaFilter, storeFilter } from "./changes.js";
import type { AreaSection, ProductMap } from "./product-model.js";

/** What tints a block. Defective outranks the status of the capabilities. */
export type BlockStatus = "met" | "changing" | "proposed" | "defective";

export const BLOCK_STATUS_ORDER: readonly BlockStatus[] = ["met", "changing", "proposed", "defective"];

export const BLOCK_STATUS_LABELS: Readonly<Record<BlockStatus, string>> = {
  met: "Met",
  changing: "Changing",
  proposed: "Proposed",
  defective: "Defective",
};

/** Blocks the map draws before the smallest areas fold into one. */
export const MAX_BLOCKS = 12;

/** The slice of a capability a block's status reads. */
interface Counted {
  status: string;
  health: string;
}

/**
 * An area's status from its capabilities: defective if any is broken, else
 * changing (a revised spec counts — it is ahead of the build), else proposed if
 * any is unbuilt, else met. Retired capabilities do not count; an area with
 * none left reads proposed, as it has nothing built.
 */
export function blockStatus(rows: readonly Counted[]): BlockStatus {
  const live = rows.filter((r) => r.status !== "retired");
  if (live.length === 0) return "proposed";
  if (live.some((r) => r.health === "defective")) return "defective";
  if (live.some((r) => r.status === "changing" || r.status === "revised")) return "changing";
  if (live.some((r) => r.status === "proposed")) return "proposed";
  return "met";
}

/** Distinct open changes across areas: one change touching two areas counts once. */
function distinctOpenChanges(areas: readonly Pick<AreaSection, "openChangeIds">[]): number {
  return new Set(areas.flatMap((a) => a.openChangeIds)).size;
}

export interface AreaBlockModel {
  key: string;
  label: string;
  /** What the block's size stands for. */
  size: number;
  /** What `size` counts, for the accessible name. */
  unit: "capabilities" | "criteria";
  status: BlockStatus;
  openChanges: number;
  /** Items a waiting Sidecar card proposes for this block: drawn dashed, never in `openChanges`. */
  ghosts?: number;
  /** The area's slug; null on the block that folds smaller areas. */
  slug: string | null;
}

/** Waiting items by the node they target; see `ghostCountsByTarget`. */
export type GhostCounts = ReadonlyMap<string, number>;

/** Waiting items aimed at an area or at any of its capabilities. */
function areaGhosts(areas: readonly AreaSection[], ghostCounts: GhostCounts): number {
  return areas.reduce(
    (n, area) => n + (ghostCounts.get(area.id) ?? 0) + area.capabilities.reduce((m, c) => m + (ghostCounts.get(c.id) ?? 0), 0),
    0,
  );
}

/** One area's block. */
export function areaBlock(area: AreaSection, ghostCounts: GhostCounts = new Map()): AreaBlockModel {
  return {
    ghosts: areaGhosts([area], ghostCounts),
    key: area.id,
    label: area.title,
    size: area.capabilities.length,
    unit: "capabilities",
    status: blockStatus(area.capabilities),
    openChanges: distinctOpenChanges([area]),
    slug: area.slug,
  };
}

/**
 * One block per area in the map's order. Past `MAX_BLOCKS`, the smallest areas
 * (ties keep the earlier area) fold into a "+N smaller areas" block.
 */
export function areaBlocks(areas: readonly AreaSection[], ghostCounts: GhostCounts = new Map()): AreaBlockModel[] {
  if (areas.length <= MAX_BLOCKS) return areas.map((a) => areaBlock(a, ghostCounts));
  const keep = new Set(
    areas
      .map((area, index) => ({ area, index }))
      .sort((a, b) => b.area.capabilities.length - a.area.capabilities.length || a.index - b.index)
      .slice(0, MAX_BLOCKS - 1)
      .map(({ area }) => area.id),
  );
  const folded = areas.filter((a) => !keep.has(a.id));
  const rows = folded.flatMap((a) => a.capabilities);
  return [
    ...areas.filter((a) => keep.has(a.id)).map((a) => areaBlock(a, ghostCounts)),
    {
      ghosts: areaGhosts(folded, ghostCounts),
      key: "folded",
      label: `+${folded.length} smaller areas`,
      size: rows.length,
      unit: "capabilities",
      status: blockStatus(rows),
      openChanges: distinctOpenChanges(folded),
      slug: null,
    },
  ];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The block's accessible name: what it is, how big, its status, and its open changes. */
export function blockName(block: Pick<AreaBlockModel, "label" | "size" | "unit" | "status" | "openChanges" | "ghosts">): string {
  const unit = block.unit === "capabilities"
    ? plural(block.size, "capability", "capabilities")
    : plural(block.size, "criterion", "criteria");
  const open = block.openChanges === 0 ? "no open changes" : plural(block.openChanges, "open change", "open changes");
  const waiting = block.ghosts ? `, ${block.ghosts} waiting on a card` : "";
  return `${block.label}: ${unit}, ${BLOCK_STATUS_LABELS[block.status].toLowerCase()}, ${open}${waiting}`;
}

/**
 * One block of the map. Reusable: the area view passes a capability's title,
 * size and status. A native button, so Enter and Space open it.
 */
export function AreaBlock({ block, onOpen, onOpenChanges, selected, basisRem, lit, near, pending, placed }: {
  block: AreaBlockModel;
  onOpen: () => void;
  /**
   * Makes the "N open" badge its own button, beside the block (a button cannot
   * hold a button). Without it the badge is plain text on the block.
   */
  onOpenChanges?: () => void;
  selected?: boolean;
  /**
   * The block's flex-basis in rem. Without it every block starts from the
   * stylesheet's fixed basis and only free space in its row tells sizes
   * apart, which a full, wrapping map barely has.
   */
  basisRem?: number;
  /**
   * Placement mode lights a candidate home with a note saying why ("2
   * candidates", "#1 · strong"); the note joins the accessible name.
   */
  lit?: string;
  /**
   * Placement mode marks a block that shares words with the change but is not
   * on the shortlist ("near · refund"); a lit block is never also near.
   */
  near?: string;
  /** Placement mode: the size an amendment would leave the block with ("12 → 13"), shown in place of its size. */
  pending?: string;
  /** Placement mode: the change being placed already touches or amends this block. */
  placed?: boolean;
}) {
  const note = lit ?? near;
  const named = note ? `${blockName(block)}; ${note}` : blockName(block);
  const label = placed ? `${named}; this change is placed here` : named;
  // The badge is a button only when it has somewhere to go.
  const badgeButton = onOpenChanges !== undefined && block.openChanges > 0;
  const sizing = {
    // Bigger blocks grow wider; the stylesheet's basis keeps a one-unit block
    // legible unless the caller sizes the basis itself.
    flexGrow: String(Math.max(1, block.size)),
    ...(basisRem === undefined ? {} : { flexBasis: `${basisRem}rem` }),
  };
  const openText = `${block.openChanges} open`;
  const button = h("button", {
    type: "button",
    class: `pam-block pam-${block.status}${lit ? " pam-lit" : near ? " pam-near" : ""}${placed ? " pam-placed" : ""}`,
    // Only blocks that can be selected carry a pressed state.
    "aria-pressed": selected === undefined ? undefined : String(selected),
    "data-status": block.status,
    "data-block": block.key,
    // With a badge button the wrapper takes the sizing and the block fills it.
    style: badgeButton ? undefined : sizing,
    "aria-label": pending ? `${label}; ${block.unit} ${pending} with this amendment` : label,
    onClick: onOpen,
  },
    h("span", { class: "pam-label", "aria-hidden": "true" }, block.label),
    note ? h("span", { class: lit ? "pam-lit-note" : "pam-near-note", "aria-hidden": "true" }, note) : null,
    h("span", { class: `pam-size${pending ? " pam-pending" : ""}`, "aria-hidden": "true" }, pending ?? String(block.size)),
    placed ? h("span", { class: "pam-placed-mark", "aria-hidden": "true" }, "● this change") : null,
    block.openChanges > 0 && !badgeButton
      ? h("span", { class: "pam-open", "aria-hidden": "true", title: plural(block.openChanges, "open change", "open changes") }, openText)
      : null,
    block.ghosts
      ? h("span", { class: "pam-ghost-mark", "aria-hidden": "true", "data-ghost": block.key, title: `${plural(block.ghosts, "item", "items")} waiting on a card` },
          `+${block.ghosts}`)
      : null,
  );
  if (!badgeButton) return button;
  return h("div", { class: "pam-cell", style: sizing },
    button,
    h("button", {
      type: "button",
      class: "pam-open pam-open-button",
      "data-open-changes": block.key,
      "aria-label": `${plural(block.openChanges, "open change", "open changes")} in ${block.label}: open the list`,
      onClick: onOpenChanges,
    }, openText),
  );
}

/** The status colours and what each means. */
export function BlockLegend() {
  return h("ul", { class: "pam-legend", "aria-label": "Status colours" },
    BLOCK_STATUS_ORDER.map((status) =>
      h("li", { key: status },
        h("span", { class: `pam-swatch pam-${status}`, "aria-hidden": "true" }),
        BLOCK_STATUS_LABELS[status])),
    h("li", null, h("span", { class: "pam-open pam-legend-open", "aria-hidden": "true" }, "n open"), "open changes"),
  );
}

/**
 * Opens an area from its block: its slug and title, or a null slug for the
 * block that folds the smaller areas (which opens the whole map).
 */
export type OpenArea = (slug: string | null, title: string) => void;

/**
 * Opens Open changes from a block's badge: the area's id, or a null id for the
 * block that folds smaller areas (no single area to filter to).
 */
export type OpenAreaChanges = (areaId: string | null, title: string) => void;

/**
 * Opens Open changes on one area's changes, or on every open change for the
 * folded block — never on whatever filter the page last remembered.
 */
export function openAreaChanges(navigateTo: NavigateTo, areaId: string | null): void {
  storeFilter(areaId ? areaFilter(areaId) : "open");
  navigateTo("changes");
}

export function AreaBlocks({ map, onOpenArea, onOpenChanges }: {
  map: ProductMap;
  onOpenArea: OpenArea;
  onOpenChanges?: OpenAreaChanges;
}) {
  const cards = useContext(GhostCardsContext);
  const ghostCounts = useMemo(() => ghostCountsByTarget(cards), [cards]);
  if (map.areas.length === 0) {
    return h("div", { class: "empty-state", role: "status" }, "No areas yet. They appear once the product layer is populated.");
  }
  return h("div", { class: "pam" },
    h("div", { class: "pam-blocks" },
      areaBlocks(map.areas, ghostCounts).map((block) =>
        h(AreaBlock, {
          key: block.key,
          block,
          onOpen: () => onOpenArea(block.slug, block.label),
          onOpenChanges: onOpenChanges
            ? () => onOpenChanges(block.slug === null ? null : block.key, block.label)
            : undefined,
        }))),
    h(BlockLegend, null),
  );
}

/** The Product tile's panel on Plan. */
export function ProductAreaMap({ onOpenArea, onOpenChanges }: { onOpenArea: OpenArea; onOpenChanges?: OpenAreaChanges }) {
  const load = useProductRead("/api/rex/product", (body) => body.map as ProductMap);
  if (load.state === "ready") return h(AreaBlocks, { map: load.data, onOpenArea, onOpenChanges });
  if (load.state === "loading") return h("div", { class: "pam-pending", role: "status" }, "Loading...");
  if (load.state === "v1") return null;
  return h("div", { role: "alert" }, `Could not load the product map: ${load.message}`);
}

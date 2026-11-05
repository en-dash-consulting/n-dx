/**
 * Placement mode: one Inbox change placed on the product map, at
 * `/product/place/<changeId>` (WF1). Every Place opens it: an Inbox tile row,
 * the Inbox page's "Place on the map ↗", the area view's Inbox card and the
 * change detail panel's compact "Where it goes".
 *
 * Where it opens follows rex's shortlist (WF2). A strong, untied top pick
 * zooms straight into its area's spec map with that block lit. Any other
 * shortlist opens at the area level, each area's candidate count lit, and
 * choosing an area zooms in. The breadcrumb names the change and its place in
 * the Inbox ("Placing N of M").
 *
 * The panel beside the map is "Where it goes" (change-placement.ts): every
 * write goes through its `/place` and `/propose` routes, and Next or Place &
 * next opens the next change here, in placement mode.
 *
 * @module viewer/views/placement-mode
 */

import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useProductRead } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import { placementTab } from "../route-state.js";
import { ChangePlacementSection, inboxPosition } from "../components/prd-tree/change-placement.js";
import { useInbox, type InboxRow } from "./inbox.js";
import { AreaBlock, BlockLegend, areaBlock } from "./product-area-map.js";
import { SpecMap } from "./area-spec-map.js";
import { Pending } from "./product-pages.js";
import type { AreaDetail, AreaSection, ChangePlacement, PlacementCandidate, ProductMap } from "./product-model.js";

// ── Model ────────────────────────────────────────────────────────────

/** The area a capability sits in, or null for a constraint or an unknown id. */
export function areaOfTarget(map: ProductMap, target: string): AreaSection | null {
  return map.areas.find((area) => area.capabilities.some((c) => c.id === target)) ?? null;
}

/** One area's candidates, best first, each with its rank on the whole shortlist. */
export interface AreaCandidates {
  area: AreaSection;
  candidates: Array<{ candidate: PlacementCandidate; rank: number }>;
}

/**
 * The shortlist grouped by area, areas in the order their best candidate
 * ranks. Constraints sit under no area, so they light no area block.
 */
export function candidatesByArea(shortlist: readonly PlacementCandidate[], map: ProductMap): AreaCandidates[] {
  const groups = new Map<string, AreaCandidates>();
  shortlist.forEach((candidate, index) => {
    const area = areaOfTarget(map, candidate.target);
    if (!area) return;
    const group = groups.get(area.id) ?? { area, candidates: [] };
    group.candidates.push({ candidate, rank: index + 1 });
    groups.set(area.id, group);
  });
  return [...groups.values()];
}

/** Where placement mode opens: zoomed into an area, or the area level. */
export type PlacementStart =
  | { level: "area"; slug: string; target: string }
  | { level: "map" };

/**
 * WF2: a strong, untied top pick that sits in an area zooms into that area;
 * a possible, weak or tied shortlist (or one with no pick) opens the map.
 */
export function placementStart(placement: ChangePlacement, map: ProductMap): PlacementStart {
  const top = placement.shortlist[0];
  if (!top || placement.tied || top.strength !== "strong") return { level: "map" };
  const area = areaOfTarget(map, top.target);
  return area ? { level: "area", slug: area.slug, target: top.target } : { level: "map" };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** An area block's note at the area level: how many candidates it holds. */
export function areaCandidateNote(count: number): string {
  return plural(count, "candidate", "candidates");
}

/** A capability block's note in the zoomed area: its rank and strength. */
export function candidateNote(rank: number, candidate: Pick<PlacementCandidate, "strength">, tied: boolean): string {
  return `#${rank} · ${rank <= 2 && tied ? "tied" : candidate.strength}`;
}

/** What the area level says about the shortlist that sent it there. */
export function mapLevelNote(placement: ChangePlacement | null): string {
  const top = placement?.shortlist[0];
  if (!placement || !top) return "rex found no candidate. Pick an area, or search in the panel.";
  if (placement.tied) return "The top candidates tie. Pick an area to compare its candidates in place.";
  if (top.strength === "strong") return "The strong pick sits under no area. Pick an area, or place it from the panel.";
  return `None strong: the best is ${top.strength}. Pick an area to compare its candidates in place.`;
}

/** The breadcrumb's placing label: the change's place in the Inbox, then its title. */
export function placingLabel(index: number, total: number, title: string): string {
  return index >= 0 ? `Placing ${index + 1} of ${total} · ${title}` : `Placing · ${title}`;
}

// ── Pieces ───────────────────────────────────────────────────────────

/** Every area as a block, the ones holding candidates lit with their count. Choosing one zooms in. */
function AreaLevel({ map, groups, onZoom }: { map: ProductMap; groups: readonly AreaCandidates[]; onZoom: (slug: string) => void }) {
  const counts = new Map(groups.map((g) => [g.area.id, g.candidates.length]));
  if (map.areas.length === 0) {
    return h("div", { class: "empty-state", role: "status" }, "No areas yet. Place it from the panel, or say nothing fits.");
  }
  return h("div", { class: "pam pam-placing" },
    h("div", { class: "pam-blocks" },
      map.areas.map((area) => {
        const count = counts.get(area.id);
        return h(AreaBlock, {
          key: area.id,
          block: areaBlock(area),
          lit: count ? areaCandidateNote(count) : undefined,
          onOpen: () => onZoom(area.slug),
        });
      })),
    h(BlockLegend, null));
}

/** The zoomed area's spec map, its candidates lit with their rank. */
function ZoomedArea({ slug, group, tied }: { slug: string; group: AreaCandidates | undefined; tied: boolean }) {
  const load = useProductRead(`/api/rex/product/area/${encodeURIComponent(slug)}`, (body) => body.area as AreaDetail);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (load.state === "v1") return null;
  if (load.state !== "ready") return h(Pending, { load });
  const lit = new Map((group?.candidates ?? []).map(({ candidate, rank }) => [candidate.target, candidateNote(rank, candidate, tied)]));
  return h(SpecMap, {
    capabilities: load.data.capabilities,
    constraints: load.data.constraints,
    selectedId,
    onSelect: setSelectedId,
    lit,
  });
}

// ── View ─────────────────────────────────────────────────────────────

export interface PlacementModeProps {
  changeId: string;
  navigateTo?: NavigateTo;
}

/** The change's row in the Inbox, open or applied-but-never-placed. */
function findRow(rows: readonly InboxRow[], applied: readonly InboxRow[], changeId: string): InboxRow | undefined {
  return rows.find((r) => r.change.id === changeId) ?? applied.find((r) => r.change.id === changeId);
}

/**
 * Placement mode for one change. Key it by change id: where it opens is
 * decided once per change, from the first shortlist read.
 */
export function PlacementMode({ changeId, navigateTo }: PlacementModeProps) {
  const inbox = useInbox();
  const product = useProductRead("/api/rex/product", (body) => body.map as ProductMap);
  const map = product.state === "ready" ? product.data : null;
  const row = findRow(inbox.rows, inbox.applied, changeId);
  // A placed change leaves the Inbox; the panel still shows where it went.
  const lastRow = useRef<InboxRow | undefined>(row);
  if (row) lastRow.current = row;
  const shown = row ?? lastRow.current;
  const read = shown?.shortlist;
  const placement = read && "placement" in read ? read.placement : null;

  // undefined: not decided yet; null: the area level; a slug: zoomed into it.
  const [zoom, setZoom] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (zoom !== undefined || !map || !read) return;
    const start = placement ? placementStart(placement, map) : { level: "map" as const };
    setZoom(start.level === "area" ? start.slug : null);
  }, [zoom, map, read, placement]);

  if (inbox.load.state === "v1" || product.state === "v1") {
    return h("div", { class: "empty-state", role: "status" }, "This project's PRD uses the v1 layout, which has no Inbox to place.");
  }
  if (inbox.load.state !== "ready") return h(Pending, { load: inbox.load });
  if (!shown) {
    return h("div", { class: "placing-container" },
      h("div", { class: "empty-state", role: "status" }, "This change is not waiting in the Inbox."),
      navigateTo
        ? h("button", { type: "button", class: "ch-change-link", onClick: () => navigateTo("prd", { taskId: changeId }) }, "Open in Tasks")
        : null);
  }

  const order = inbox.rows.map((r) => r.change.id);
  const position = inboxPosition(order, changeId);
  const groups = map && placement ? candidatesByArea(placement.shortlist, map) : [];
  const zoomedArea = zoom && map ? map.areas.find((a) => a.slug === zoom) : undefined;

  return h("div", { class: "placing-container", "data-placing": changeId, "data-level": zoom ? "area" : zoom === null ? "map" : "pending" },
    h("nav", { class: "placing-crumb", "aria-label": "Breadcrumb" },
      navigateTo ? h("button", { type: "button", class: "ch-change-link", onClick: () => navigateTo("plan") }, "Plan") : "Plan",
      " › ",
      zoom
        ? h("button", { type: "button", class: "ch-change-link placing-crumb-map", onClick: () => setZoom(null) }, "Product map")
        : h("b", null, "Product map"),
      zoomedArea ? [" › ", h("b", { key: "area" }, zoomedArea.title)] : null,
      h("span", { class: "placing-label", role: "status" }, placingLabel(position.index, position.total, shown.change.title)),
    ),
    h("div", { class: "placing-body" },
      h("div", { class: "placing-map" },
        product.state === "error" ? h(Pending, { load: product }) : null,
        zoom === undefined && product.state !== "error"
          ? h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Finding where it goes…")
          : null,
        zoom === null && map
          ? [
              h("p", { key: "note", class: "placing-note", role: "note" }, mapLevelNote(placement)),
              h(AreaLevel, { key: "areas", map, groups, onZoom: setZoom }),
            ]
          : null,
        zoom
          ? h(ZoomedArea, { key: zoom, slug: zoom, group: groups.find((g) => g.area.slug === zoom), tied: !!placement?.tied })
          : null,
      ),
      h("aside", { class: "placing-panel", "aria-label": "Where it goes" },
        h(ChangePlacementSection, {
          key: changeId,
          changeId,
          changeTitle: shown.change.title,
          onOpenChange: (id: string) => navigateTo?.("product", { tab: placementTab(id) }),
        })),
    ),
  );
}

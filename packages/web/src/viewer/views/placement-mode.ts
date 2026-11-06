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
 * The panel beside the map is "Where it goes" (change-placement.ts) in its
 * wide layout: one card per candidate (WF3). Every write goes through its
 * `/place` and `/propose` routes, and Next or Place & next opens the next
 * change here, in placement mode.
 *
 * The map and the panel share one selection. A card lights its block; a
 * block selects its card (or, off the shortlist, becomes the panel's pick).
 * Candidates in other areas show as chips above the zoomed map, and picking
 * one, as chip or card, moves the map there. The panel stays mounted, so its
 * edits survive the move. Blocks off the shortlist dim, except those sharing
 * words with the change, which are marked near. While the panel's card
 * amends a capability, its block shows the criteria count the amendment
 * would leave ("12 → 13"). "Nothing fits" swaps the card for the proposal
 * form and draws a dashed ghost block in the area the form names, titled as
 * the form is; blocks sharing words with that title stay marked near.
 *
 * Place & next opens the next Inbox change here, strongest first, and its
 * own shortlist decides where its map starts (WF2). #896's keys work on the
 * panel: J/K (and S) open another change, 1–5, T/A, N, / and Enter press the
 * panel's controls. Place & add another keeps the panel open (WF8): every home
 * placed in the visit is marked on the map with the change's marker.
 *
 * Leaving (Esc, the breadcrumb, another tab) with a pick or an edit in the
 * panel keeps it as a draft for the browser session (WF10, placement-draft.ts):
 * the Inbox row says "draft · …", and Place resumes it at the step it was left
 * with. Esc with no edits just leaves.
 *
 * @module viewer/views/placement-mode
 */

import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useProductRead } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import { placementTab } from "../route-state.js";
import {
  ChangePlacementSection,
  inboxPosition,
  pendingCriteriaNote,
  strongUntiedPick,
  type AreaPick,
  type PendingCriteria,
  type ProposalGhost,
  type PlacementTarget,
} from "../components/prd-tree/change-placement.js";
import { StrengthChip } from "../components/index.js";
import { useInbox, type InboxRow } from "./inbox.js";
import { isTypingTarget, pressPanelShortcut, useShortcuts } from "./inbox-triage.js";
import { AreaBlock, BlockLegend, areaBlock } from "./product-area-map.js";
import { SpecMap, liveCapabilities } from "./area-spec-map.js";
import { Pending } from "./product-pages.js";
import type { AreaDetail, AreaSection, CapabilityRow, ChangePlacement, PlacementCandidate, ProductMap } from "./product-model.js";

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
  if (!top || !strongUntiedPick(placement)) return { level: "map" };
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
export function mapLevelNote(placement: ChangePlacement | null, failure?: string): string {
  if (failure !== undefined) return `Could not read rex's shortlist: ${failure}. Pick an area, or search in the panel.`;
  const top = placement?.shortlist[0];
  if (!placement || !top) return "rex found no candidate. Pick an area, or search in the panel.";
  if (placement.tied) return "The top candidates tie. Pick an area to compare its candidates in place.";
  if (top.strength === "strong") return "The strong pick sits under no area. Pick an area, or place it from the panel.";
  return `None strong: the best is ${top.strength}. Pick an area to compare its candidates in place.`;
}

/** Words too common to say two texts are about the same thing. */
const COMMON_WORDS = new Set([
  "about", "also", "after", "before", "does", "each", "every", "from", "have", "into", "more", "only", "shall",
  "should", "than", "that", "their", "them", "then", "there", "they", "this", "what", "when", "where", "which",
  "while", "will", "with", "without",
]);

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !COMMON_WORDS.has(w)));
}

/** The words of four letters or more, not common ones, that both texts use; in `a`'s order. */
export function sharedWords(a: string, b: string): string[] {
  const other = words(b);
  return [...words(a)].filter((w) => other.has(w));
}

/**
 * The capabilities off the shortlist that share words with the change, each
 * with its note ("near · refund, card"). Lit blocks are never near.
 */
export function nearNotes(rows: readonly CapabilityRow[], changeText: string, lit: ReadonlySet<string>): Map<string, string> {
  const near = new Map<string, string>();
  for (const row of rows) {
    if (lit.has(row.id)) continue;
    const shared = sharedWords(changeText, `${row.title} ${row.statement ?? ""}`);
    if (shared.length) near.set(row.id, `near · ${shared.join(", ")}`);
  }
  return near;
}

/** A block chosen on the map as the panel's target: its shortlist row, or the capability itself. */
export function targetOfRow(row: CapabilityRow, areaTitle: string, shortlist: readonly PlacementCandidate[]): PlacementTarget {
  return shortlist.find((c) => c.target === row.id) ?? {
    target: row.id, type: "capability", title: row.title, area: areaTitle, ...(row.statement ? { statement: row.statement } : {}),
  };
}

/** The shortlist's candidates outside the zoomed area (constraints included), best first, with their rank. */
export function otherAreaCandidates(shortlist: readonly PlacementCandidate[], map: ProductMap, slug: string): Array<{
  candidate: PlacementCandidate;
  rank: number;
  area: AreaSection | null;
}> {
  return shortlist
    .map((candidate, index) => ({ candidate, rank: index + 1, area: areaOfTarget(map, candidate.target) }))
    .filter(({ area }) => area?.slug !== slug);
}

/**
 * The change `delta` places from `changeId` in the Inbox order, wrapping; null when no other change waits.
 * A placed change has left the order: `lastIndex` is the slot it held, so J lands on the change that took
 * it and K on the one before it.
 */
export function neighbourChange(order: readonly string[], changeId: string, delta: 1 | -1, lastIndex = 0): string | null {
  const others = order.filter((id) => id !== changeId);
  if (!others.length) return null;
  const index = order.indexOf(changeId);
  const from = index >= 0 ? index + delta : delta > 0 ? lastIndex : lastIndex - 1;
  return order[(from + order.length) % order.length];
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

/**
 * The zoomed area's spec map: its candidates lit with their rank, blocks
 * sharing words with the change marked near, and the panel's pick selected.
 */
function ZoomedArea({ slug, group, tied, changeText, selectedId, pending, ghost, placed, onSelect }: {
  slug: string;
  group: AreaCandidates | undefined;
  tied: boolean;
  /** What the change says, for the near marks. */
  changeText: string;
  selectedId: string | null;
  /** The panel's amendment, shown on its block as the criteria count it would leave. */
  pending: PendingCriteria | null;
  /** The proposal form's capability, drawn as a ghost block when it is proposed under this area. */
  ghost: { title: string } | null;
  /** The capabilities this change was already placed on, each marked on the map. */
  placed: ReadonlySet<string>;
  onSelect: (row: CapabilityRow, areaTitle: string) => void;
}) {
  const load = useProductRead(`/api/rex/product/area/${encodeURIComponent(slug)}`, (body) => body.area as AreaDetail);
  if (load.state === "v1") return null;
  if (load.state !== "ready") return h(Pending, { load });
  const { capabilities, constraints, title } = load.data;
  const lit = new Map((group?.candidates ?? []).map(({ candidate, rank }) => [candidate.target, candidateNote(rank, candidate, tied)]));
  const amended = pending ? capabilities.find((c) => c.id === pending.target) : undefined;
  return h(SpecMap, {
    capabilities,
    constraints,
    selectedId,
    ghost,
    placed,
    pending: amended && pending ? { id: amended.id, note: pendingCriteriaNote(amended.criteriaCount, pending.delta) } : null,
    onSelect: (id: string) => {
      const row = capabilities.find((c) => c.id === id);
      if (row) onSelect(row, title);
    },
    lit,
    near: nearNotes(liveCapabilities(capabilities), changeText, new Set(lit.keys())),
  });
}

/** The candidates outside the zoomed area, as chips above its map. Picking one moves the map to it. */
function OtherAreaChips({ others, selectedId, onPick }: {
  others: ReturnType<typeof otherAreaCandidates>;
  selectedId: string | null;
  onPick: (candidate: PlacementCandidate) => void;
}) {
  if (others.length === 0) return null;
  return h("ul", { class: "placing-chips", "aria-label": "Candidates in other areas" },
    others.map(({ candidate, rank, area }) =>
      h("li", { key: candidate.target },
        h("button", {
          type: "button",
          class: "placing-chip",
          "data-target": candidate.target,
          "aria-pressed": String(candidate.target === selectedId),
          onClick: () => onPick(candidate),
        },
          h("span", { class: "placing-chip-rank" }, `#${rank}`),
          h("span", { class: "placing-chip-title" }, candidate.title),
          h("span", { class: "placing-chip-area" }, area?.title ?? (candidate.type === "constraint" ? "constraint" : "no area")),
          h(StrengthChip, { strength: candidate.strength })))));
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
  // Where the change last sat in the Inbox order: once placed it leaves, and J/K step from that slot.
  const lastIndex = useRef(0);
  const orderIndex = inbox.rows.findIndex((r) => r.change.id === changeId);
  if (orderIndex >= 0) lastIndex.current = orderIndex;
  const shown = row ?? lastRow.current;
  const read = shown?.shortlist;
  const placement = read && "placement" in read ? read.placement : null;
  const failure = read && "error" in read ? read.error : undefined;

  // undefined: not decided yet; null: the area level; a slug: zoomed into it.
  const [zoom, setZoom] = useState<string | null | undefined>(undefined);
  // The target the panel and the map share.
  const [selection, setSelection] = useState<PlacementTarget | null>(null);
  // The panel's amendment, for the selected block's pending criteria count.
  const [pending, setPending] = useState<PendingCriteria | null>(null);
  // The capability the proposal form would add, while Nothing fits has it open.
  const [ghost, setGhost] = useState<ProposalGhost | null>(null);
  // The homes the change was placed on in this visit, each marked on the map (WF8).
  const [homes, setHomes] = useState<ReadonlySet<string>>(new Set());
  const panelRef = useRef<HTMLElement>(null);
  const ghostArea = map && ghost ? map.areas.find((a) => a.id === ghost.under) : undefined;
  // The ghost lives in the area the form names: choosing another area moves the map, and the ghost, there.
  useEffect(() => { if (ghostArea) setZoom(ghostArea.slug); }, [ghostArea?.slug]);
  // The map's last pick of an area, which an open proposal form follows (WF6). The opening zoom and the
  // form's own choice move the map without a pick, so neither overrides the form.
  const [areaPick, setAreaPick] = useState<AreaPick | null>(null);
  const pickArea = (slug: string) => {
    setZoom(slug);
    const area = map?.areas.find((a) => a.slug === slug);
    if (area) setAreaPick((p) => ({ under: area.id, n: (p?.n ?? 0) + 1 }));
  };
  /** A pick from the panel, a chip or a block: select it and move the map to its area. */
  const choose = (target: PlacementTarget) => {
    setSelection(target);
    const area = map ? areaOfTarget(map, target.target) : null;
    if (area) pickArea(area.slug);
  };
  // #896's keys, on the panel beside the map: J/K and S open another Inbox change, the rest press its controls.
  useShortcuts((shortcut) => {
    if (shortcut.kind === "move" || shortcut.kind === "skip") {
      const to = neighbourChange(inbox.rows.map((r) => r.change.id), changeId, shortcut.kind === "skip" ? 1 : shortcut.delta, lastIndex.current);
      if (to) navigateTo?.("product", { tab: placementTab(to) });
      return;
    }
    pressPanelShortcut(panelRef.current, shortcut);
  });
  // Esc leaves placement mode. Whatever the form holds is already kept as a draft (WF10), so nothing is asked.
  // Esc in a text field is the field's (a criterion edit cancels on it), so it never leaves from there.
  const leaveRef = useRef<() => void>();
  leaveRef.current = () => navigateTo?.("plan");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target) || document.querySelector('[aria-modal="true"]')) return;
      leaveRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (zoom !== undefined || !map || !read) return;
    // A resumed draft's ghost already names its area. The ghost-follow effect has run in this commit and
    // will not fire again, so the opening zoom must not overwrite it.
    if (ghostArea) { setZoom(ghostArea.slug); return; }
    const start = placement ? placementStart(placement, map) : { level: "map" as const };
    setZoom(start.level === "area" ? start.slug : null);
  }, [zoom, map, read, placement, ghostArea]);

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
  const shortlist = placement?.shortlist ?? [];
  const selectedId = selection?.target ?? null;

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
              h("p", { key: "note", class: "placing-note", role: "note" }, mapLevelNote(placement, failure)),
              h(AreaLevel, { key: "areas", map, groups, onZoom: pickArea }),
            ]
          : null,
        zoom && map
          ? h(OtherAreaChips, { key: "chips", others: otherAreaCandidates(shortlist, map, zoom), selectedId, onPick: choose })
          : null,
        zoom
          ? h(ZoomedArea, {
              key: zoom,
              slug: zoom,
              group: groups.find((g) => g.area.slug === zoom),
              tied: !!placement?.tied,
              // The title the proposal is typing, so near-duplicates stay in view.
              changeText: ghost?.title ?? shown.change.title,
              selectedId,
              pending,
              ghost: ghost && ghostArea?.slug === zoom ? { title: ghost.title } : null,
              placed: homes,
              onSelect: (row: CapabilityRow, areaTitle: string) => choose(targetOfRow(row, areaTitle, shortlist)),
            })
          : null,
      ),
      h("aside", { ref: panelRef, class: "placing-panel", "aria-label": "Where it goes" },
        h(ChangePlacementSection, {
          key: changeId,
          changeId,
          changeTitle: shown.change.title,
          onOpenChange: (id: string) => navigateTo?.("product", { tab: placementTab(id) }),
          layout: "wide",
          selection,
          onChoose: choose,
          onPendingCriteria: setPending,
          onGhost: setGhost,
          onHomes: (targets: string[]) => setHomes(new Set(targets)),
          // Nothing fits proposes under the zoomed area, so the ghost lands where the map is.
          proposeUnder: zoomedArea?.id,
          followPick: areaPick,
        })),
    ),
  );
}

/**
 * Plan's product areas: accepted work grouped by the part of the product it
 * changes. One box per area from the product map, listing the open changes
 * that move it (`AreaSection.openChangeIds`) with their stage, priority and
 * assignee from Plan's change summary, in `compareChangeOrder`'s order. A
 * change no area counts is listed under "Not in an area", so nothing open
 * drops out of sight.
 *
 * Above the boxes, For me / Everyone narrows what they list, and so does the
 * stage How work moves focuses (`plan-flow.ts`, `plan-view-state.ts`): the
 * Inbox stage empties every box, since nothing in the Inbox has an area yet. Boxes in a row are one height; a box opens its area
 * on a click anywhere outside its change titles, or Enter, and its summary
 * shows three lines at most, the third fading when there is more. An Inbox row
 * dragged from the side panel can be dropped on an area to plan it there
 * (`plan-placement.ts`).
 *
 * @module viewer/views/plan-areas
 */

import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { NavigateTo } from "../types.js";
import { displayTitle, personLabel, titleTooltip, usePeople } from "../components/index.js";
import { useProductRead } from "../hooks/index.js";
import { placementTab } from "../route-state.js";
import { useChangesSummary } from "./changes-summary-context.js";
import { isMyChange } from "./plan-glance.js";
import { ScopeToggle } from "./plan-controls.js";
import { usePlanView, type PlanViewState } from "./plan-view-state.js";
import {
  PLAN_DRAG_EVENT, candidateInArea, carriesInboxRow, draggedRow, endPlanDrag, placeTouches, rowCandidates,
} from "./plan-placement.js";
import { useOverflowing } from "./stage-tiles.js";
import { CHANGE_STAGE_LABELS, orderChanges, type GlanceChange, type OpenChangeStage, type ProductMap } from "./product-model.js";

export interface AreaBox {
  /** The area's slug; null for the box of changes no area counts. */
  slug: string | null;
  title: string;
  summary?: string;
  changes: GlanceChange[];
  inProgress: number;
  planned: number;
}

/** The boxes, in the product map's order, then the changes no area counts. */
export function areaBoxes(map: ProductMap, open: readonly GlanceChange[]): AreaBox[] {
  const byId = new Map(open.map((c) => [c.id, c]));
  const counted = new Set<string>();
  const box = (slug: string | null, title: string, changes: GlanceChange[], summary?: string): AreaBox => {
    const inProgress = changes.filter((c) => c.stage === "in-progress" || c.stage === "awaiting-apply").length;
    return { slug, title, ...(summary ? { summary } : {}), changes: orderChanges(changes), inProgress, planned: changes.length - inProgress };
  };
  const boxes = map.areas.map((area) => {
    const changes = area.openChangeIds.flatMap((id) => byId.get(id) ?? []);
    for (const c of changes) counted.add(c.id);
    return box(area.slug, area.title, changes, area.summary);
  });
  const rest = open.filter((c) => !counted.has(c.id));
  return rest.length > 0 ? [...boxes, box(null, "Not in an area", rest, "Open changes placed on a top-level constraint, or on nothing yet.")] : boxes;
}

/** The open changes the view lets through: yours under For me, and only the focused stage (none for the Inbox). */
export function filterForView(open: readonly GlanceChange[], view: Pick<PlanViewState, "scope" | "stage" | "mode">, me: string | null): GlanceChange[] {
  if (view.stage === "inbox") return [];
  return open.filter((c) =>
    (view.mode === "solo" || view.scope !== "me" || isMyChange(c, me))
    && (view.stage === null || c.stage === view.stage));
}

/** How many of `open` sit in each stage, for How work moves. */
export function stageCounts(open: readonly GlanceChange[]): Record<OpenChangeStage, number> {
  const counts: Record<OpenChangeStage, number> = { proposed: 0, ready: 0, "in-progress": 0, "awaiting-apply": 0 };
  for (const c of open) counts[c.stage]++;
  return counts;
}

function ChangeRow({ change, onOpen, solo }: { change: GlanceChange; onOpen: () => void; solo: boolean }) {
  const who = solo ? undefined : change.assignee ?? change.taskAssignees?.[0];
  return h("li", { class: "plan-area-change", "data-change": change.id },
    h("div", { class: "plan-area-change-top" },
      h("button", {
        type: "button",
        class: "plan-area-change-title",
        title: titleTooltip(change),
        onClick: (e: MouseEvent) => { e.stopPropagation(); onOpen(); },
        onKeyDown: (e: KeyboardEvent) => e.stopPropagation(),
      }, displayTitle(change)),
      who ? h("span", { class: "plan-area-who", title: who }, personLabel(who)) : null,
    ),
    h("div", { class: "plan-area-change-meta" },
      change.displayId ? h("span", { class: "plan-glance-id" }, change.displayId) : null,
      change.priority ? h("span", { class: `prd-priority-badge prd-priority-${change.priority}` }, change.priority) : null,
      h("span", { class: `plan-glance-stage plan-glance-stage--${change.stage}` }, CHANGE_STAGE_LABELS[change.stage]),
    ),
  );
}

/** Three lines of the summary at most; the third fades when there is more, and the whole text is the tooltip. */
function AreaSummary({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const clamped = useOverflowing(ref);
  return h("span", { ref, class: clamped ? "plan-area-summary plan-area-summary--clamped" : "plan-area-summary", title: text }, text);
}

interface AreaBoxProps {
  box: AreaBox;
  solo: boolean;
  /** An Inbox row is being dragged: the box shows its drop zone. */
  dragging: boolean;
  onOpenArea: (slug: string) => void;
  onOpenChange: (id: string) => void;
  onDropChange: (box: AreaBox) => void;
}

function AreaBoxView({ box, solo, dragging, onOpenArea, onOpenChange, onDropChange }: AreaBoxProps) {
  const [over, setOver] = useState(false);
  const slug = box.slug;
  const open = slug ? () => onOpenArea(slug) : undefined;
  const classes = ["plan-area", slug ? "plan-area--link" : "plan-area--none", over ? "plan-area--over" : ""].filter(Boolean).join(" ");
  return h("section", {
    class: classes,
    "data-area": slug ?? "",
    "aria-label": slug ? `${box.title}: open the area` : box.title,
    ...(open
      ? {
          tabIndex: 0,
          onClick: open,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
            e.preventDefault();
            open();
          },
          onDragOver: (e: DragEvent) => {
            if (!carriesInboxRow(e)) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
            if (!over) setOver(true);
          },
          onDragLeave: (e: DragEvent) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(false);
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setOver(false);
            onDropChange(box);
          },
        }
      : {}),
  },
    h("div", { class: "plan-area-head" },
      h("span", { class: "plan-area-kicker" }, slug ? "Product area" : "Unplaced"),
      h("h3", { class: "plan-area-title" }, box.title),
      box.summary ? h(AreaSummary, { text: box.summary }) : null,
      h("span", { class: "plan-area-count" }, `${box.inProgress} in progress · ${box.planned} planned`),
    ),
    box.changes.length > 0
      ? h("ul", { class: "plan-area-changes" },
          box.changes.map((c) => h(ChangeRow, { key: c.id, change: c, solo, onOpen: () => onOpenChange(c.id) })))
      : h("p", { class: "plan-area-empty" }, "Nothing here for this view."),
    slug && dragging
      ? h("div", { class: over ? "plan-area-drop plan-area-drop--over" : "plan-area-drop", "aria-hidden": "true" },
          solo ? "Drop an Inbox item here to plan it in this area" : "Drop an Inbox item here to accept it into this area")
      : null,
  );
}

/** Whether an Inbox row is being dragged anywhere on the page. */
function usePlanDragging(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setDragging(!!(e as CustomEvent<{ active: boolean }>).detail?.active);
    window.addEventListener(PLAN_DRAG_EVENT, on);
    return () => window.removeEventListener(PLAN_DRAG_EVENT, on);
  }, []);
  return dragging;
}

export function PlanAreas({ navigateTo }: { navigateTo: NavigateTo }) {
  const summary = useChangesSummary();
  const product = useProductRead("/api/rex/product", (body) => body.map as ProductMap);
  const view = usePlanView();
  const people = usePeople();
  const dragging = usePlanDragging();
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  if (summary.state === "loading" || product.state === "loading") return h("p", { class: "plan-areas-empty", role: "status" }, "Loading…");
  if (summary.state === "error") return h("p", { class: "plan-areas-empty" }, `Could not read the open changes: ${summary.message}`);
  if (product.state === "error") return h("p", { class: "plan-areas-empty" }, `Could not read the product map: ${product.message}`);
  // A v1 tree has no product map; the tile is v2-only, so this is a race with a migration.
  if (summary.state === "v1" || product.state === "v1") return h("p", { class: "plan-areas-empty" }, "Product areas need a v2 PRD.");

  const me = people?.me ?? null;
  const solo = view.mode === "solo";
  const scoped = filterForView(summary.data.open, { ...view, stage: null }, me);
  const shown = filterForView(scoped, view, me);
  const boxes = areaBoxes(product.data, shown);

  const dropOn = async (box: AreaBox) => {
    const row = draggedRow();
    endPlanDrag();
    if (!row || !box.slug) return;
    const candidate = candidateInArea(rowCandidates(row), box.title);
    if (!candidate) {
      // Nothing on its shortlist sits here: pick a home in placement mode instead.
      navigateTo("product", { tab: placementTab(row.change.id) });
      return;
    }
    const answer = await placeTouches(row.change.id, candidate.target);
    setNote(answer.ok
      ? { text: `Planned "${row.change.title}" in ${box.title} (${candidate.title}).`, error: false }
      : { text: `Could not plan "${row.change.title}": ${answer.message}`, error: true });
  };

  return h("div", { class: "plan-areas" },
    h("div", { class: "plan-areas-toolbar" },
      h(ScopeToggle, null),
      h("span", { class: "plan-areas-hint" }, "Drag an Inbox item onto an area to plan it."),
    ),
    h("p", { class: "plan-areas-intro" }, "Accepted work, grouped by the part of the product it changes. Each box shows what is planned and in progress in that area."),
    note ? h("p", { class: note.error ? "plan-areas-note plan-areas-note--error" : "plan-areas-note", role: note.error ? "alert" : "status" }, note.text) : null,
    view.scope === "me" && !solo && scoped.length === 0 && summary.data.open.length > 0
      ? h("p", { class: "plan-areas-empty" }, me ? "Nothing open is assigned to you." : "n-dx could not tell who you are; set your git user to see your work.")
      : null,
    boxes.length === 0
      ? h("p", { class: "plan-areas-empty" }, "The product map has no areas yet.")
      : h("div", { class: "plan-areas-grid" },
          boxes.map((b) => h(AreaBoxView, {
            key: b.slug ?? "none",
            box: b,
            solo,
            dragging,
            onOpenArea: (slug) => navigateTo("product", { tab: `area/${encodeURIComponent(slug)}` }),
            onOpenChange: (id) => navigateTo("prd", { taskId: id }),
            onDropChange: (target) => void dropOn(target),
          })),
        ),
  );
}

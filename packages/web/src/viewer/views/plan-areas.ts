/**
 * Plan's product areas: accepted work grouped by the part of the product it
 * changes. One box per area from the product map, listing the open changes
 * that move it (`AreaSection.openChangeIds`) with their stage, priority and
 * assignee from Plan's change summary, in `compareChangeOrder`'s order. A
 * change no area counts is listed under "Not in an area", so nothing open
 * drops out of sight.
 *
 * The area's name opens its page; a change's title opens it in the Tasks tree.
 *
 * @module viewer/views/plan-areas
 */

import { h } from "preact";
import type { NavigateTo } from "../types.js";
import { displayTitle, personLabel, titleTooltip } from "../components/index.js";
import { useProductRead } from "../hooks/index.js";
import { useChangesSummary } from "./changes-summary-context.js";
import { CHANGE_STAGE_LABELS, orderChanges, type GlanceChange, type ProductMap } from "./product-model.js";

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

function ChangeRow({ change, onOpen }: { change: GlanceChange; onOpen: () => void }) {
  const who = change.assignee ?? change.taskAssignees?.[0];
  return h("li", { class: "plan-area-change", "data-change": change.id },
    h("div", { class: "plan-area-change-top" },
      h("button", { type: "button", class: "plan-area-change-title", title: titleTooltip(change), onClick: onOpen }, displayTitle(change)),
      who ? h("span", { class: "plan-area-who", title: who }, personLabel(who)) : null,
    ),
    h("div", { class: "plan-area-change-meta" },
      change.displayId ? h("span", { class: "plan-glance-id" }, change.displayId) : null,
      change.priority ? h("span", { class: `prd-priority-badge prd-priority-${change.priority}` }, change.priority) : null,
      h("span", { class: `plan-glance-stage plan-glance-stage--${change.stage}` }, CHANGE_STAGE_LABELS[change.stage]),
    ),
  );
}

export function PlanAreas({ navigateTo }: { navigateTo: NavigateTo }) {
  const summary = useChangesSummary();
  const product = useProductRead("/api/rex/product", (body) => body.map as ProductMap);
  if (summary.state === "loading" || product.state === "loading") return h("p", { class: "plan-areas-empty", role: "status" }, "Loading…");
  if (summary.state === "error") return h("p", { class: "plan-areas-empty" }, `Could not read the open changes: ${summary.message}`);
  if (product.state === "error") return h("p", { class: "plan-areas-empty" }, `Could not read the product map: ${product.message}`);
  // A v1 tree has no product map; the tile is v2-only, so this is a race with a migration.
  if (summary.state === "v1" || product.state === "v1") return h("p", { class: "plan-areas-empty" }, "Product areas need a v2 PRD.");
  const boxes = areaBoxes(product.data, summary.data.open);
  if (boxes.length === 0) return h("p", { class: "plan-areas-empty" }, "The product map has no areas yet.");

  return h("div", { class: "plan-areas" },
    h("p", { class: "plan-areas-intro" }, "Accepted work, grouped by the part of the product it changes. Each box shows what is planned and in progress in that area."),
    h("div", { class: "plan-areas-grid" },
      boxes.map((b) => h("section", { key: b.slug ?? "none", class: b.slug ? "plan-area" : "plan-area plan-area--none", "aria-label": b.title },
        h("div", { class: "plan-area-head" },
          h("span", { class: "plan-area-kicker" }, b.slug ? "Product area" : "Unplaced"),
          b.slug
            ? h("button", { type: "button", class: "plan-area-title", onClick: () => navigateTo("product", { tab: `area/${encodeURIComponent(b.slug!)}` }) }, b.title)
            : h("span", { class: "plan-area-title" }, b.title),
          b.summary ? h("span", { class: "plan-area-summary" }, b.summary) : null,
          h("span", { class: "plan-area-count" }, `${b.inProgress} in progress · ${b.planned} planned`),
        ),
        b.changes.length > 0
          ? h("ul", { class: "plan-area-changes" },
              b.changes.map((c) => h(ChangeRow, { key: c.id, change: c, onOpen: () => navigateTo("prd", { taskId: c.id }) })))
          : h("p", { class: "plan-area-empty" }, "Nothing open here."),
      )),
    ),
  );
}

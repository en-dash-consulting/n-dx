/**
 * The area view: one area of the product map, addressed at
 * `/product/area/<slug>` by its frozen v2 slug.
 *
 * It opens two ways. From a block on Plan's product map it fills the Product
 * tile's full-screen in place (`AreaInPlace`): the address bar names the area
 * while it is open and returns to Plan's when it closes, so Plan keeps its
 * scroll and a reload lands on the area. Loaded directly, it is the Product
 * page's own content (`AreaPage`), with a way back to the map.
 *
 * Reads `GET /api/rex/product/area/<slug>`; the server computes every count.
 *
 * @module viewer/views/area
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useProductRead } from "../hooks/index.js";
import { replaceAppHistory } from "../base-path.js";
import type { AreaDetail } from "./product-model.js";
import type { NavigateTo } from "../types.js";
import { SpecMap } from "./area-spec-map.js";
import { AreaCards } from "./area-cards.js";

/** The area's address. */
export function areaPath(slug: string): string {
  return `/product/area/${slug}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The header's counts, in the order the header reads them. */
export function areaCountLabels(counts: AreaDetail["counts"]): string[] {
  return [
    plural(counts.capabilities, "capability", "capabilities"),
    plural(counts.constraints, "constraint", "constraints"),
    `${counts.met} met`,
    `${counts.changing} changing`,
    `${counts.defective} defective`,
    plural(counts.openChanges, "open change", "open changes"),
  ];
}

/** The steward chip's text: who stewards the area, or that nobody does. */
export function stewardLabel(stewards: readonly string[]): string {
  if (stewards.length === 0) return "no steward";
  return `${stewards.length === 1 ? "steward" : "stewards"}: ${stewards.join(", ")}`;
}

/** The marker an in-place address carries in its history state, so only it is undone. */
const IN_PLACE = "ndxInPlaceAddress";

/**
 * Name `path` in the address bar while mounted, keeping the current history
 * entry (and so Back), then put the previous address back on unmount. A
 * navigation made meanwhile writes its own entry, which is left alone.
 */
export function useInPlaceAddress(path: string): void {
  useEffect(() => {
    const locationBefore = `${location.pathname}${location.search}${location.hash}`;
    const stateBefore: unknown = history.state;
    replaceAppHistory({ ...(stateBefore as object | null), [IN_PLACE]: path }, path);
    return () => {
      if ((history.state as Record<string, unknown> | null)?.[IN_PLACE] === path) {
        history.replaceState(stateBefore, "", locationBefore);
      }
    };
  }, [path]);
}

function AreaHeader({ area, onOpenPage }: { area: AreaDetail; onOpenPage?: () => void }) {
  const steward = stewardLabel(area.stewards);
  return h("header", { class: "area-head" },
    area.summary ? h("p", { class: "section-sub area-summary" }, area.summary) : null,
    h("div", { class: "area-head-row" },
      h("ul", { class: "area-counts", "aria-label": "Counts" },
        areaCountLabels(area.counts).map((label) => h("li", { key: label }, label))),
      h("span", { class: `tag area-steward${area.stewards.length === 0 ? " area-steward-none" : ""}` }, steward),
      onOpenPage
        ? h("div", { class: "area-actions" },
            h("button", { type: "button", class: "btn btn-small", onClick: onOpenPage }, "Open on Product page"))
        : null,
    ),
  );
}

export interface AreaViewProps {
  slug: string;
  /** Shown in place on Plan: offers the area's own page. */
  onOpenPage?: () => void;
  /** Shown as the Product page: titles the page and offers the way back to the map. */
  onBack?: () => void;
  /** Opens a change's panel in the Tasks tree; the cards' change links and Place use it. */
  navigateTo?: NavigateTo;
}

/** The area: its header, its spec map, and the column of four cards beside it. */
export function AreaView({ slug, onOpenPage, onBack, navigateTo }: AreaViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openChange = navigateTo ? (id: string) => navigateTo("prd", { taskId: id }) : undefined;
  const load = useProductRead(`/api/rex/product/area/${encodeURIComponent(slug)}`, (body) => body.area as AreaDetail);
  const back = onBack
    ? h("button", { type: "button", class: "cap-back", onClick: onBack }, "Product")
    : null;
  if (load.state === "loading") {
    return h("div", { class: "area-container" }, back, h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading..."));
  }
  if (load.state === "v1") {
    return h("div", { class: "area-container" }, back,
      h("div", { class: "empty-state", role: "status" }, "This project's PRD uses the v1 layout, which has no product areas."));
  }
  if (load.state === "error") {
    return h("div", { class: "area-container" }, back, h("div", { class: "empty-state", role: "alert" }, `Could not load the area: ${load.message}`));
  }
  const area = load.data;
  return h("div", { class: "area-container", "data-area": area.slug },
    back,
    onBack
      ? h("h2", { class: "view-title" },
          area.title,
          area.displayId ? h("span", { class: "pm-display-id" }, area.displayId) : null)
      : null,
    load.refreshError
      ? h("div", { class: "empty-state pm-stale", role: "alert" }, `Could not refresh: ${load.refreshError}. Showing the last loaded data.`)
      : null,
    h(AreaHeader, { area, onOpenPage }),
    h("div", { class: "area-body" },
      h(SpecMap, { capabilities: area.capabilities, constraints: area.constraints, selectedId, onSelect: setSelectedId }),
      // Place opens the change's placement panel until placement mode (S7) lands.
      h(AreaCards, { area, onOpenChange: openChange, onPlace: openChange }),
    ),
  );
}

/** The area in Plan's Product tile: the address names it while it is open. */
export function AreaInPlace({ slug, onOpenPage, navigateTo }: { slug: string; onOpenPage: () => void; navigateTo?: NavigateTo }) {
  useInPlaceAddress(areaPath(slug));
  return h(AreaView, { slug, onOpenPage, navigateTo });
}

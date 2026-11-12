/**
 * The area view: one area of the product map, addressed at
 * `/product/area/<slug>` by its frozen v2 slug.
 *
 * It is the Product page's own content (`AreaPage`), with a way back to the
 * map.
 *
 * Reads `GET /api/rex/product/area/<slug>`; the server computes every count.
 *
 * @module viewer/views/area
 */

import { h } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { PlanInAreaButton, PlanWithSidecarContext } from "../components/index.js";
import { useProductRead } from "../hooks/index.js";
import { replaceAppHistory } from "../base-path.js";
import { placementTab } from "../route-state.js";
import type { AreaDetail } from "./product-model.js";
import type { NavigateTo } from "../types.js";
import { SpecMap, liveCapabilities } from "./area-spec-map.js";
import { AreaCards } from "./area-cards.js";
import { AreaCapability } from "./area-capability.js";
import { SmartAddInput } from "../components/prd-tree/smart-add-input.js";

/** The area's address. */
export function areaPath(slug: string): string {
  return `/product/area/${encodeURIComponent(slug)}`;
}

/** The address of a capability selected in the area. */
export function areaCapabilityPath(slug: string, capabilityId: string): string {
  return `${areaPath(slug)}/capability/${encodeURIComponent(capabilityId)}`;
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
export function useInPlaceAddress(path: string | null, restoreTo?: string): void {
  useEffect(() => {
    if (path === null) return undefined;
    // `restoreTo` is for an address the page was opened at (a reload), which
    // is not the one to go back to. It is app-relative, so it goes back through
    // `replaceAppHistory` to keep the hub's `/p/<id>` or a worktree's `/w/<key>`.
    const url = new URL(location.href);
    const stateBefore: unknown = history.state;
    replaceAppHistory({ ...(stateBefore as object | null), [IN_PLACE]: path }, path);
    return () => {
      // An address nested under this one (a capability selected in the area)
      // is undone with it: preact runs a parent's cleanup before its child's,
      // so the nested one has not given this address back yet.
      const current = (history.state as Record<string, unknown> | null)?.[IN_PLACE];
      if (current === path || (typeof current === "string" && current.startsWith(`${path}/`))) {
        if (restoreTo === undefined) history.replaceState(stateBefore, "", url.toString());
        else replaceAppHistory(stateBefore, restoreTo);
      }
    };
  }, [path, restoreTo]);
}

interface AreaHeaderProps {
  area: AreaDetail;
  onOpenPage?: () => void;
  /** Whether the capture is open; "+ Change in this area" toggles it. */
  capturing: boolean;
  onCapture: () => void;
}

function AreaHeader({ area, onOpenPage, capturing, onCapture }: AreaHeaderProps) {
  const steward = stewardLabel(area.stewards);
  return h("header", { class: "area-head" },
    area.summary ? h("p", { class: "section-sub area-summary" }, area.summary) : null,
    h("div", { class: "area-head-row" },
      h("ul", { class: "area-counts", "aria-label": "Counts" },
        areaCountLabels(area.counts).map((label) => h("li", { key: label }, label))),
      h("span", { class: `tag area-steward${area.stewards.length === 0 ? " area-steward-none" : ""}` }, steward),
      h("div", { class: "area-actions" },
        h("button", { type: "button", class: "btn btn-small area-capture-toggle", "aria-expanded": capturing, onClick: onCapture }, "+ Change in this area"),
        h(PlanInAreaButton, { areaId: area.id }),
        onOpenPage
          ? h("button", { type: "button", class: "btn btn-small area-open-page", onClick: onOpenPage }, "Open on Product page")
          : null),
    ),
  );
}

/**
 * AD6: capture with the placement shortlist and search limited to this area,
 * so Add & place writes the change already placed; with nothing chosen it
 * lands in the Inbox as any capture does.
 */
function AreaCapture({ area, onClose, onOpenChange }: { area: AreaDetail; onClose: () => void; onOpenChange?: (id: string) => void }) {
  // Esc steps back one level: it closes the capture, not the full-screen tile around the area.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  return h("section", { class: "area-capture", "aria-label": `Change in ${area.title}`, onKeyDown },
    h(SmartAddInput, { layout: "v2", area, onPrdChanged: onClose, ...(onOpenChange ? { onOpenChange } : {}) }),
    h("button", { type: "button", class: "btn btn-small area-capture-close", onClick: onClose }, "Close"),
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
  /** The capability the address names (a reload at its URL): selected on open. */
  initialCapabilityId?: string | null;
}

/**
 * The area: its header, its spec map, and the column beside it: four cards,
 * or the selected capability's detail. Esc in the detail steps back to the cards.
 */
export function AreaView({ slug, onOpenPage, onBack, navigateTo, initialCapabilityId = null }: AreaViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(initialCapabilityId);
  // The address names the selection; leaving it returns to the area's. Opened at
  // the capability's URL, the area's is where Esc goes back to as well.
  useInPlaceAddress(selectedId ? areaCapabilityPath(slug, selectedId) : null, areaPath(slug));
  const [capturing, setCapturing] = useState(false);
  const openChange = navigateTo ? (id: string) => navigateTo("prd", { taskId: id }) : undefined;
  const placeChange = navigateTo ? (id: string) => navigateTo("product", { tab: placementTab(id) }) : undefined;
  const load = useProductRead(`/api/rex/product/area/${encodeURIComponent(slug)}`, (body) => body.area as AreaDetail);
  // A selection the loaded area does not list (a display id or alias in the
  // address, or a capability retired since) is no selection: clearing it also
  // gives the address back to the area's.
  const listed = selectedId === null || load.state !== "ready" || liveCapabilities(load.data.capabilities).some((c) => c.id === selectedId);
  useEffect(() => {
    if (!listed) setSelectedId(null);
  }, [listed]);
  // The Sidecar attaches the area, or the capability selected in it, while the view is open.
  const sidecar = useContext(PlanWithSidecarContext);
  const loaded = load.state === "ready" ? load.data : null;
  const areaId = loaded?.id ?? null;
  const areaLabel = loaded?.title ?? "";
  const attachedCapability = listed ? selectedId : null;
  useEffect(() => {
    if (!sidecar || !areaId) return undefined;
    sidecar.reportArea({ id: areaId, label: areaLabel, capabilityId: attachedCapability });
    return () => sidecar.reportArea(null);
  }, [sidecar?.reportArea, areaId, areaLabel, attachedCapability]);
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
  // A selection the area no longer lists (retired since, or a stale address) is no selection.
  const selected = liveCapabilities(area.capabilities).find((c) => c.id === selectedId) ?? null;
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
    h(AreaHeader, { area, onOpenPage, capturing, onCapture: () => setCapturing((open) => !open) }),
    // The area read refreshes itself on the PRD-changed broadcast an Add sends.
    capturing ? h(AreaCapture, { area, onClose: () => setCapturing(false), onOpenChange: openChange }) : null,
    h("div", { class: "area-body" },
      h(SpecMap, { capabilities: area.capabilities, constraints: area.constraints, selectedId, onSelect: setSelectedId }),
      selected
        ? h(AreaCapability, { key: selected.id, capabilityId: selected.id, title: selected.title, onClose: () => setSelectedId(null) })
        : h(AreaCards, {
            area,
            onOpenChange: openChange,
            onPlace: placeChange,
            onOpenAreaChanges: navigateTo ? () => navigateTo("changes", { area: area.slug }) : undefined,
          }),
    ),
  );
}

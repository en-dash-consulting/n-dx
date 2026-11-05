/**
 * The routed Product and Changes pages: fetch the v2 product reads and hand
 * them to the presentational views (`product.ts`, `capability.ts`,
 * `changes.ts`).
 *
 * The data is rex's, computed on the server (`server/routes-rex/product.ts`);
 * nothing here derives a status. On a v1 project the routes answer
 * `{ layout: "v1" }` and both pages say to run `ndx migrate`.
 *
 * The capability page opens inside the Product page, from a row; Back
 * returns to the map. `/product/area/<slug>` shows that area's view
 * (area.ts) as the page; `/product/place/<changeId>` shows placement mode
 * for an Inbox change (placement-mode.ts).
 *
 * @module viewer/views/product-pages
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { failureMessage, useCliName, useProductRead, useRefetchableProductRead } from "../hooks/index.js";
import type { Load } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import { ProductView } from "./product.js";
import { CapabilityPage } from "./capability.js";
import { ChangesView } from "./changes.js";
import { AreaView } from "./area.js";
import { PlacementMode } from "./placement-mode.js";
import { RequirementsView } from "./requirements.js";
import type { CapabilityDetail, ChangeRow, ProductEdit, ProductMap } from "./product-model.js";

/** The v1 empty state: the product layer exists only after migrating. */
export function NoProductLayer({ title }: { title: string }) {
  const cliName = useCliName();
  return h("div", { class: "pm-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, title),
    ),
    h("div", { class: "empty-state pm-no-product-layer", role: "status" },
      "This project's PRD uses the v1 layout, which has no product layer. Run ",
      h("code", null, `${cliName} migrate`),
      " to move it to areas, capabilities and changes.",
    ),
  );
}

export function Pending<T>({ load }: { load: Exclude<Load<T>, { state: "ready" | "v1" }> }) {
  return load.state === "loading"
    ? h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading...")
    : h("div", { class: "empty-state", role: "alert" }, `Could not load: ${load.message}`);
}

/** Shown above a page whose latest refetch failed; the page is the last good read. */
export function StaleNotice({ message }: { message?: string }) {
  return message
    ? h("div", { class: "empty-state pm-stale", role: "alert" }, `Could not refresh: ${message}. Showing the last loaded data.`)
    : null;
}

/** Post a spec edit; resolves on success, rejects with the server's reason. */
async function postProductEdit(edit: ProductEdit): Promise<void> {
  const res = await fetch("/api/rex/product/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(edit),
  });
  if (!res.ok) throw new Error(failureMessage(res.status, await res.json().catch(() => null)));
}

function CapabilityFromRoute({ id, onBack }: { id: string; onBack: () => void }) {
  const { load, refetch } = useRefetchableProductRead(
    `/api/rex/product/capability/${encodeURIComponent(id)}`,
    (body) => body.capability as CapabilityDetail,
  );
  const [editError, setEditError] = useState<string | null>(null);
  const onEdit = useCallback((edit: ProductEdit) => {
    postProductEdit(edit).then(
      () => { setEditError(null); refetch(); },
      (err: unknown) => setEditError(err instanceof Error ? err.message : String(err)),
    );
  }, [refetch]);
  if (load.state === "v1") return h(NoProductLayer, { title: "Product" });
  if (load.state !== "ready") {
    // A failed read (the capability was retired since the map loaded) keeps the
    // way back to the map; without it the page is stuck until a reload.
    return h("div", { class: "cap-container" },
      h("button", { type: "button", class: "cap-back", onClick: onBack }, "Product"),
      h(Pending, { load }),
    );
  }
  return h("div", null,
    h(StaleNotice, { message: load.refreshError }),
    editError
      ? h("div", { class: "empty-state pm-stale", role: "alert" }, `Could not save the edit: ${editError}`)
      : null,
    // Keyed by the whole spec so the form reseeds whenever the statement or a
    // criterion changes (a save here, or an edit made elsewhere): a form left
    // holding the old text would write it back over the newer spec on its next save.
    h(CapabilityPage, {
      key: JSON.stringify([load.data.id, load.data.statement ?? "", load.data.criteria]),
      capability: load.data,
      onBack,
      onEdit,
    }),
  );
}

export type ProductTab = "map" | "requirements";

const PRODUCT_TABS: readonly { id: ProductTab; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "requirements", label: "Requirements" },
];

/** The Map/Requirements tablist and its panel, shared by the v1 and v2 renderings. */
function ProductTabs({ tab, onTab, children }: {
  tab: ProductTab;
  onTab: (tab: ProductTab) => void;
  children?: ComponentChildren;
}) {
  return h("div", null,
    h("div", { class: "stage-section-tablist", role: "tablist", "aria-label": "Product views" },
      PRODUCT_TABS.map((t) =>
        h("button", {
          key: t.id,
          type: "button",
          role: "tab",
          id: `product-tab-${t.id}`,
          "aria-selected": String(tab === t.id),
          "aria-controls": "product-tabpanel",
          class: `stage-section-tab${tab === t.id ? " active" : ""}`,
          onClick: () => onTab(t.id),
        }, t.label)),
    ),
    h("div", { id: "product-tabpanel", role: "tabpanel", "aria-labelledby": `product-tab-${tab}` }, children),
  );
}

/**
 * The Product page: the map and the requirements view as tabs, and a
 * capability's page opened from a map row.
 *
 * `/requirements` renders this page with `initialTab="requirements"`. On a v1
 * project, which has no product layer, the same tabs show: Map says to
 * migrate, Requirements reads v1 data and renders the requirements view.
 */
export function ProductPage({ areaSlug = null, areaCapabilityId = null, placeChangeId = null, onLeaveArea, navigateTo, ...rest }: ProductMapPageProps & {
  /** The capability `/product/area/<slug>/capability/<id>` selects in the area. */
  areaCapabilityId?: string | null;
  /** Opens a change's panel from the area's cards. */
  navigateTo?: NavigateTo;
  /** The area `/product/area/<slug>` names: the page is that area's view. */
  areaSlug?: string | null;
  /** The change `/product/place/<id>` names: the page is placement mode for it. */
  placeChangeId?: string | null;
  /** Leaves the area for the map (`/product`). */
  onLeaveArea?: () => void;
}) {
  // Keyed by change: Place & next starts the next change where its own shortlist says.
  if (placeChangeId) return h(PlacementMode, { key: placeChangeId, changeId: placeChangeId, navigateTo });
  return areaSlug
    ? h(AreaView, { slug: areaSlug, onBack: onLeaveArea, navigateTo, initialCapabilityId: areaCapabilityId })
    : h(ProductMapPage, rest);
}

interface ProductMapPageProps {
  onCapabilityChange?: (id: string | null) => void;
  initialTab?: ProductTab;
}

function ProductMapPage({ onCapabilityChange, initialTab = "map" }: ProductMapPageProps) {
  const [tab, setTab] = useState<ProductTab>(initialTab);
  const [capabilityId, setCapabilityId] = useState<string | null>(null);
  // The open capability is what the page is about; the shell attaches it to Sidecar.
  useEffect(() => {
    onCapabilityChange?.(capabilityId);
    return () => onCapabilityChange?.(null);
  }, [capabilityId, onCapabilityChange]);
  const load = useProductRead("/api/rex/product", (body) => body.map as ProductMap);
  if (load.state === "loading") return h(Pending, { load });
  if (load.state === "v1") {
    return h(ProductTabs, { tab, onTab: setTab },
      tab === "requirements" ? h(RequirementsView, null) : h(NoProductLayer, { title: "Product" }));
  }
  if (load.state !== "ready") {
    // A failed map read must not hide the requirements view, which reads its own data.
    return tab === "requirements" ? h(RequirementsView, null) : h(Pending, { load });
  }
  if (capabilityId && tab === "map") {
    return h(CapabilityFromRoute, { id: capabilityId, onBack: () => setCapabilityId(null) });
  }
  return h(ProductTabs, { tab, onTab: setTab },
    tab === "requirements"
      ? h(RequirementsView, null)
      : h("div", null,
          h(StaleNotice, { message: load.refreshError }),
          h(ProductView, { map: load.data, onSelectCapability: setCapabilityId }),
        ),
  );
}

/** The Changes view; a change opens as its item in the Tasks tree. */
export function ChangesPage({ navigateTo }: { navigateTo?: NavigateTo }) {
  const load = useProductRead("/api/rex/changes", (body) => body.changes as ChangeRow[]);
  if (load.state === "v1") return h(NoProductLayer, { title: "Changes" });
  if (load.state !== "ready") return h(Pending, { load });
  return h("div", null,
    h(StaleNotice, { message: load.refreshError }),
    h(ChangesView, {
      changes: load.data,
      onSelectChange: navigateTo ? (id: string) => navigateTo("prd", { taskId: id }) : undefined,
    }),
  );
}

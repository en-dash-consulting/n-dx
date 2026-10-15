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
 * returns to the map.
 *
 * @module viewer/views/product-pages
 */

import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { useCliName, usePrdChangedRefresh } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import { ProductView } from "./product.js";
import { CapabilityPage } from "./capability.js";
import { ChangesView } from "./changes.js";
import type { CapabilityDetail, ChangeRow, ProductMap } from "./product-model.js";

/** What every product read answers on a v1 tree. */
interface V1Answer { layout: "v1" }

type Load<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "v1" }
  | { state: "ready"; data: T; refreshError?: string };

/** Why a read failed, for the user. */
function failureMessage(status: number, body: unknown): string {
  const error = (body as { error?: unknown } | null)?.error;
  return typeof error === "string" ? error : `HTTP ${status}`;
}

/**
 * A failed read. Data already on screen stays, with the failure alongside it:
 * a refetch that fails (a read mid-write) must not replace a loaded page.
 */
function failed<T>(prev: Load<T>, message: string): Load<T> {
  return prev.state === "ready" ? { ...prev, refreshError: message } : { state: "error", message };
}

/**
 * Fetch one product read; `pick` takes the payload out of a v2 answer. It
 * reads again on each `rex:prd-changed`, keeping the current data on screen
 * until the new answer arrives, so the view follows the Tasks tree. A refetch
 * that fails keeps that data and reports through `refreshError`.
 */
function useProductRead<T>(url: string, pick: (body: Record<string, unknown>) => T): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [revision, setRevision] = useState(0);
  const refetch = useCallback(() => setRevision((n) => n + 1), []);
  const loadedUrl = useRef(url);
  usePrdChangedRefresh(refetch);
  useEffect(() => {
    let live = true;
    // A new url is a new read; a revision bump refreshes the same one in place.
    if (loadedUrl.current !== url) {
      loadedUrl.current = url;
      setLoad({ state: "loading" });
    }
    (async () => {
      const res = await fetch(url);
      const body = await res.json() as Record<string, unknown> | V1Answer;
      if (!live) return;
      if (!res.ok) {
        setLoad((prev) => failed(prev, failureMessage(res.status, body)));
      } else if (body.layout === "v1") {
        setLoad({ state: "v1" });
      } else {
        setLoad({ state: "ready", data: pick(body as Record<string, unknown>) });
      }
    })().catch((err: unknown) => {
      if (live) setLoad((prev) => failed(prev, err instanceof Error ? err.message : String(err)));
    });
    return () => { live = false; };
  }, [url, revision]);
  return load;
}

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

function Pending<T>({ load }: { load: Exclude<Load<T>, { state: "ready" | "v1" }> }) {
  return load.state === "loading"
    ? h("div", { class: "loading", role: "status", "aria-live": "polite" }, "Loading...")
    : h("div", { class: "empty-state", role: "alert" }, `Could not load: ${load.message}`);
}

/** Shown above a page whose latest refetch failed; the page is the last good read. */
function StaleNotice({ message }: { message?: string }) {
  return message
    ? h("div", { class: "empty-state pm-stale", role: "alert" }, `Could not refresh: ${message}. Showing the last loaded data.`)
    : null;
}

function CapabilityFromRoute({ id, onBack }: { id: string; onBack: () => void }) {
  const load = useProductRead(
    `/api/rex/product/capability/${encodeURIComponent(id)}`,
    (body) => body.capability as CapabilityDetail,
  );
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
    h(CapabilityPage, { capability: load.data, onBack }),
  );
}

/** The Product page, and a capability's page opened from one of its rows. */
export function ProductPage() {
  const [capabilityId, setCapabilityId] = useState<string | null>(null);
  const load = useProductRead("/api/rex/product", (body) => body.map as ProductMap);
  if (load.state === "v1") return h(NoProductLayer, { title: "Product" });
  if (load.state !== "ready") return h(Pending, { load });
  if (capabilityId) return h(CapabilityFromRoute, { id: capabilityId, onBack: () => setCapabilityId(null) });
  return h("div", null,
    h(StaleNotice, { message: load.refreshError }),
    h(ProductView, { map: load.data, onSelectCapability: setCapabilityId }),
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

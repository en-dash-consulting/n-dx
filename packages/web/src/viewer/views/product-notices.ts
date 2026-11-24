/**
 * The two states a product read shows before or above its page: still
 * loading or failed (`Pending`), and a refetch that failed over a page still
 * showing its last good read (`StaleNotice`).
 *
 * Here rather than in product-pages.ts because the Inbox, its triage page,
 * placement mode and the detail panel's placement section show them too, and
 * product-pages.ts reaches all of those: importing them from there closed an
 * import cycle through each one.
 *
 * @module viewer/views/product-notices
 */

import { h } from "preact";
import type { Load } from "../hooks/index.js";

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

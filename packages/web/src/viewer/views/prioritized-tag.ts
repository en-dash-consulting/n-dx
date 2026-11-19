/**
 * The Prioritized tag a flagged change's row carries wherever changes are
 * listed in their working order: the Plan Inbox tile, the Inbox triage
 * queue, Plan's Open changes glance and the Changes list. One component, so
 * every list marks the flag the same way.
 *
 * @module viewer/views/prioritized-tag
 */

import { h } from "preact";
import { PRIORITIZED_TITLE } from "./product-model.js";

/** The tag, or nothing when the change is not prioritized. */
export function PrioritizedTag({ prioritized }: { prioritized?: boolean }) {
  return prioritized ? h("span", { class: "tag ch-prioritized", title: PRIORITIZED_TITLE }, "Prioritized") : null;
}

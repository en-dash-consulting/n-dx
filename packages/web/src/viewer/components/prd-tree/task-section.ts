/**
 * A labelled section of the PRD detail panel: the `task-section` block with
 * its `task-section-label` heading over the section's body. `class` adds the
 * section's own class beside `task-section`.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";

export function TaskSection({ label, class: extra, children }: { label: string; class?: string; children?: ComponentChildren }) {
  return h(
    "div",
    { class: extra ? `task-section ${extra}` : "task-section" },
    h("div", { class: "task-section-label" }, label),
    children,
  );
}

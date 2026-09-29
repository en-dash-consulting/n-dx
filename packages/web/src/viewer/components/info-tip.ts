/**
 * InfoTip — a circled ⓘ that shows a glossary definition on hover or focus.
 *
 * The compact twin of `GlossaryLine`: same definitions (from
 * `glossary-terms.ts`, so there is still one place that writes them), shown
 * on demand instead of as a line of text. Use it where a visible line would
 * crowd the layout — a column header, a metric card, a panel heading.
 *
 * Accessibility: the ⓘ is a real button, so it is reachable by keyboard and
 * focus shows the bubble as hover does. Its accessible description is the
 * definition — the bubble itself (role="tooltip"), or, when the page already
 * carries the definition once for assistive technology (`describedBy`), that
 * element, with the bubble then hidden from AT so it is not read twice.
 */

import { h } from "preact";
import { getGlossaryDefinition } from "./glossary-terms.js";

export interface InfoTipProps {
  /** Glossary term key, e.g. "archetype" or "cohesion". */
  term: string;
  /** Name for the button ("About <label>"); defaults to the term. */
  label?: string;
  /**
   * Id of an element that already states the definition for assistive
   * technology (a `GlossaryLine` with `srOnly`). The bubble is then visual only.
   */
  describedBy?: string;
}

function slug(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function InfoTip({ term, label, describedBy }: InfoTipProps) {
  const definition = getGlossaryDefinition(term);
  if (!definition) return null;
  const bubbleId = `info-tip-${slug(term)}`;

  return h("span", { class: "info-tip" },
    h("button", {
      type: "button",
      class: "info-tip-btn",
      "aria-label": `About ${label ?? term}`,
      "aria-describedby": describedBy ?? bubbleId,
      // Inside a sortable header or a clickable card, the ⓘ is not a click on its host.
      onClick: (e: Event) => e.stopPropagation(),
    }, "i"),
    h("span", {
      class: "info-tip-bubble",
      ...(describedBy ? { "aria-hidden": "true" } : { id: bubbleId, role: "tooltip" }),
    }, definition),
  );
}

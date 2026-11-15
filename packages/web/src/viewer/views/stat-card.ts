/**
 * One cell of a `.stat-grid`: a value over its label. The look is the
 * stylesheet's `.stat-card`; a view adds a tone through `valueClass` or
 * `cardClass` rather than restyling the cell.
 *
 * @module web/viewer/views/stat-card
 */

import { h } from "preact";

export function StatCard({ value, label, valueClass, cardClass, title }: {
  value: string;
  label: string;
  /** Extra class on the value, such as `text-red`. */
  valueClass?: string;
  /** Extra class on the card, such as `wf-stat-warn`. */
  cardClass?: string;
  title?: string;
}) {
  return h("div", { class: cardClass ? `stat-card ${cardClass}` : "stat-card", title },
    h("div", { class: valueClass ? `value ${valueClass}` : "value" }, value),
    h("div", { class: "label" }, label),
  );
}

/**
 * A zone's cohesion or coupling as a 0–1 meter, drawn alike by the detail
 * panel and the zone slideout. `invert` reads a high value as bad, as
 * coupling does.
 */

import { h } from "preact";
import { meterClass } from "../visualization/metrics.js";

export function ZoneMeter({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  return h("div", {
    class: "meter",
    role: "meter",
    "aria-label": label,
    "aria-valuemin": 0,
    "aria-valuemax": 1,
    "aria-valuenow": value,
    "aria-valuetext": value.toFixed(2),
  },
    h("div", {
      class: `meter-fill ${meterClass(value, invert)}`,
      style: `width: ${value * 100}%`,
    }),
  );
}

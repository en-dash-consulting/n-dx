/**
 * The placement-strength chip: a dot and a word, so the strength never rests on
 * colour alone. Shared by the Inbox, the PRD tree's placement panel and the
 * Sidecar placement card; it lives here, not in `views/inbox.ts`, so the
 * Sidecar drawer does not import the Inbox view.
 *
 * @module viewer/components/strength-chip
 */

import { h } from "preact";
import type { PlacementStrength } from "../views/product-model.js";

export type GuessStrength = PlacementStrength | "tied";

export function StrengthChip({ strength }: { strength: GuessStrength }) {
  return h("span", { class: `inbox-strength inbox-strength-${strength}`, "data-strength": strength },
    h("span", { class: "inbox-strength-dot", "aria-hidden": "true" }),
    strength,
  );
}

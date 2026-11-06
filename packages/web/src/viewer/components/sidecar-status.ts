/**
 * The status card's body (`propose_status`): the item, its current and
 * proposed status, and rex's own verdict on the move. A move rex refuses is
 * shown refused with rex's wording; approving it writes nothing and the agent
 * is told why.
 */

import { h } from "preact";
import type { SidecarCard } from "../hooks/sidecar.js";

/** A status as a reader says it: `in_progress` is "in progress". */
export const statusLabel = (status: string): string => status.replace(/_/g, " ");

export function StatusBody({ card }: { card: SidecarCard }) {
  const change = card.statusChange!;
  const written = card.carriedOut;
  return h("div", { class: "sidecar-status" },
    h("p", { class: "sidecar-status-item" }, h("strong", null, change.itemId), " ", change.itemTitle),
    h("p", { class: "sidecar-status-move", "aria-label": `Status from ${statusLabel(change.from)} to ${statusLabel(change.to)}` },
      h("del", { class: "sidecar-status-from" }, statusLabel(change.from)),
      h("span", { "aria-hidden": "true" }, " → "),
      h("ins", { class: "sidecar-status-to" }, statusLabel(change.to)),
    ),
    change.reason ? h("p", { class: "sidecar-status-reason" }, `Why: ${change.reason}`) : null,
    change.rule.allowed
      ? h("p", { class: "sidecar-status-rule" }, "Rex allows this move without force.")
      : h("p", { class: "sidecar-status-rule sidecar-status-refused", role: "note" }, `Rex refuses this move: ${change.rule.message}`),
    h("p", { class: "sidecar-status-note" }, written
      ? (written.ok ? "Status written." : "Nothing was written; the agent was told why.")
      : change.rule.allowed
        ? "Approve writes the status through rex; completing an item runs rex's checks. Deny writes nothing."
        : "Approving fails with rex's message and writes nothing; Deny writes nothing."),
  );
}

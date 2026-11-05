/**
 * The area view's right-hand column: four cards beside the spec map.
 *
 * - Moving now: open changes touching or amending the area, with stage chips.
 * - Waiting in the Inbox: Inbox changes whose best guess is in the area, each
 *   with Place. Placement mode (S7) has not landed, so Place opens the change's
 *   placement panel in the Tasks tree, as the Inbox page does.
 * - Recently applied: the last five.
 * - Where it lives in code: the files capabilities list, or an empty state
 *   that points at the analysis.
 *
 * Every card has an empty state. The server computes every list.
 *
 * @module viewer/views/area-cards
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { StrengthChip } from "../components/index.js";
import type {
  AreaAppliedChange,
  AreaDetail,
  AreaInboxGuess,
  OpenChangeOverlay,
} from "./product-model.js";
import { CHANGE_STAGE_LABELS } from "./product-model.js";

/**
 * What names the analysis step. The dashboard has no code-linking action and
 * rex has no linking command: code sites are stamped from git by the changes
 * that build a capability, so the last analysis is the one thing to refresh.
 */
export const LINK_CODE_COMMAND = "ndx analyze .";

/** The empty state's text for the code card. */
export const NO_CODE_MESSAGE = "No capability here lists its code files yet.";

function shortId(change: { id: string; displayId?: string }): string {
  return change.displayId ?? change.id.slice(0, 8);
}

function Card({ id, title, count, children }: { id: string; title: string; count?: number; children?: ComponentChildren }) {
  return h("section", { class: "area-card", "aria-labelledby": `area-card-${id}`, "data-card": id },
    h("h3", { class: "section-header area-card-title", id: `area-card-${id}` },
      title,
      count === undefined ? null : h("span", { class: "area-card-count" }, String(count))),
    children);
}

function Empty({ children }: { children: ComponentChildren }) {
  return h("p", { class: "empty-state area-card-empty", role: "status" }, children);
}

/** Open changes once each, in the order the area read lists them. */
export function distinctChanges(changes: readonly OpenChangeOverlay[]): OpenChangeOverlay[] {
  const seen = new Set<string>();
  return changes.filter((c) => !seen.has(c.id) && seen.add(c.id));
}

/** The day of an ISO timestamp, or the text itself when it is not a date. */
function day(at: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : at;
}

function MovingNow({ changes, onOpenChange }: { changes: readonly OpenChangeOverlay[]; onOpenChange?: (id: string) => void }) {
  const rows = distinctChanges(changes);
  return h(Card, { id: "moving", title: "Moving now", count: rows.length },
    rows.length === 0
      ? h(Empty, null, "Nothing is moving here. No open change touches or amends this area.")
      : h("ul", { class: "area-card-list" },
          rows.map((c) =>
            h("li", { key: c.id, class: "area-card-row", "data-change-id": c.id },
              h("span", { class: "ch-display-id" }, shortId(c)),
              onOpenChange
                ? h("button", { type: "button", class: "ch-change-link", onClick: () => onOpenChange(c.id) }, c.title)
                : h("span", null, c.title),
              h("span", { class: `tag area-stage area-stage-${c.stage}` }, CHANGE_STAGE_LABELS[c.stage]),
              c.delta ? h("span", { class: "tag" }, c.delta) : null))));
}

function WaitingInInbox({ guesses, onPlace }: { guesses: readonly AreaInboxGuess[]; onPlace?: (id: string) => void }) {
  return h(Card, { id: "inbox", title: "Waiting in the Inbox", count: guesses.length },
    guesses.length === 0
      ? h(Empty, null, "Nothing in the Inbox points here.")
      : h("ul", { class: "area-card-list" },
          guesses.map((g) =>
            h("li", { key: g.id, class: "area-card-row", "data-change-id": g.id },
              h("span", { class: "ch-display-id" }, shortId(g)),
              h("span", { class: "area-card-title-text" }, g.title),
              h("span", { class: "inbox-guess" },
                h("span", { class: "inbox-guess-label" }, "Best guess"),
                h("span", { class: "inbox-guess-title" }, g.target.title),
                h(StrengthChip, { strength: g.strength })),
              h("button", {
                type: "button",
                class: "btn btn-sm inbox-place",
                "aria-label": `Place ${g.title}`,
                disabled: !onPlace,
                onClick: () => onPlace?.(g.id),
              }, "Place")))));
}

function RecentlyApplied({ changes }: { changes: readonly AreaAppliedChange[] }) {
  return h(Card, { id: "applied", title: "Recently applied" },
    changes.length === 0
      ? h(Empty, null, "No change has been applied to this area yet.")
      : h("ul", { class: "area-card-list" },
          changes.map((c) =>
            h("li", { key: c.id, class: "area-card-row", "data-change-id": c.id },
              h("span", { class: "ch-display-id" }, shortId(c)),
              h("span", { class: "area-card-title-text" }, c.title),
              c.appliedAt ? h("span", { class: "tag" }, `applied ${day(c.appliedAt)}`) : null,
              c.shippedIn ? h("span", { class: "tag" }, `shipped in ${c.shippedIn}`) : null))));
}

/** The files, grouped under the capability that lists them. */
function CodeList({ area }: { area: AreaDetail }) {
  const titles = new Map(area.capabilities.map((c) => [c.id, c.title]));
  const groups = new Map<string, string[]>();
  for (const { capabilityId, path } of area.code) {
    const files = groups.get(capabilityId) ?? [];
    files.push(path);
    groups.set(capabilityId, files);
  }
  return h("ul", { class: "area-card-list" },
    [...groups].map(([capabilityId, files]) =>
      h("li", { key: capabilityId, class: "area-card-group" },
        h("span", { class: "area-card-group-title" }, titles.get(capabilityId) ?? capabilityId),
        h("ul", { class: "area-card-files" },
          files.map((path) => h("li", { key: path }, h("code", { class: "cap-code-path" }, path)))))));
}

function CodeEmpty() {
  return h(Empty, null,
    NO_CODE_MESSAGE, " ",
    h("details", { class: "area-link-code" },
      h("summary", null, "Link code from the last analysis →"),
      h("p", null, "Refresh the analysis from a terminal: ", h("code", null, LINK_CODE_COMMAND))));
}

function WhereItLives({ area }: { area: AreaDetail }) {
  return h(Card, { id: "code", title: "Where it lives in code" },
    area.code.length === 0 ? h(CodeEmpty, null) : h(CodeList, { area }));
}

export interface AreaCardsProps {
  area: AreaDetail;
  /** Opens a change's detail panel; absent, change titles are plain text. */
  onOpenChange?: (id: string) => void;
  /** Places an Inbox change; absent, Place is disabled. */
  onPlace?: (id: string) => void;
}

/** The four cards, in the order the design reads them. */
export function AreaCards({ area, onOpenChange, onPlace }: AreaCardsProps) {
  return h("aside", { class: "area-cards", "aria-label": "Area activity" },
    h(MovingNow, { changes: area.openChanges, onOpenChange }),
    h(WaitingInInbox, { guesses: area.inbox, onPlace }),
    h(RecentlyApplied, { changes: area.recentlyApplied }),
    h(WhereItLives, { area }));
}

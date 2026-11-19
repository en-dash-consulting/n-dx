/**
 * Inbox view — open changes with no place on the product map yet.
 *
 * `ndx work` skips an Inbox change's tasks until it is placed, so this lists
 * each one with rex's best guess for its home: prioritized changes first, then
 * by priority, and within those the strongest guesses first (IB7), the
 * quickest to confirm. A row opens the change's detail panel in the Tasks
 * tree; its Accept places it on that guess as a touches, and its Place opens
 * the Inbox page on it, where the shortlist and relation are. A row's assignee
 * picker saves who it is for, and the assignee filter (Mine by default when the
 * current user has a row) hides rows.
 *
 * "Place best guesses" reviews every guess at once: each change with its best
 * guess and a checkbox, weak guesses left unticked, then one write
 * (`POST /api/rex/changes/place-best`) records the ticked ones as touches. In
 * the Plan tile it opens the Inbox page with the review open.
 *
 * Applied changes still flagged for placement are history: they stay out of
 * the open count and appear as a collapsed line that expands to a list (IB2).
 * Each opens its detail panel, which offers a touches only. At zero the
 * section says so (IB9). On a v1 project there is no Inbox, and the view renders
 * nothing.
 *
 * Reads `GET /api/rex/changes` (rows with `awaitsPlacement`), each row's
 * shortlist from `GET /api/rex/changes/placements`, and the applied count
 * from project status.
 *
 * @module viewer/views/inbox
 */

import { h, Fragment } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import {
  AssigneeFilter, AssigneeFilterPending, AssigneePicker, PlaceWithSidecarButton, StrengthChip,
  pickerChoices, saveAssignee, useAssigneeFilter, usePeople, useProjectStatus,
} from "../components/index.js";
import type { AssignableRow } from "../components/index.js";
import type { KnownPerson } from "../external.js";
import { placementDraftNote } from "../components/prd-tree/placement-draft.js";
import { resolveCliLabel, useCliName } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import { placementTab } from "../route-state.js";
import { Pending, StaleNotice } from "./product-notices.js";
import type { ChangePlacements, ChangeRow, PlacementCandidate } from "./product-model.js";
import { PRIORITIZED_TITLE, changeAssignees, shortChangeId } from "./product-model.js";
import { bestGuess, guessOf, sortInbox, useInbox, type Guess, type InboxRow } from "./inbox-read.js";
import { errorMessage } from "../utils/format.js";

// The Inbox's data — its read, order and guesses — is in inbox-read.ts, which
// the detail panel's placement section and placement mode read without
// importing this page; re-exported here for the callers that always had it.
export {
  bestGuess,
  isAppliedUnplaced,
  sortInbox,
  useInbox,
  type Guess,
  type InboxRead,
  type InboxRow,
  type ShortlistRead,
} from "./inbox-read.js";

/** Rows the Plan section shows before linking to the full page. */
export const INBOX_SECTION_ROWS = 5;

/**
 * Why a change waiting here matters; the empty state keeps it where the next
 * capture will land. `{cli}` is the project's CLI name (resolveCliLabel).
 */
export const HELD_EXPLANATION =
  "A change held in the Inbox cannot close, and {cli} work skips its tasks until it is placed.";

// ── Best-guess placement ─────────────────────────────────────────────

/** One change and the guess "Place best guesses" would place it on. */
export interface BestGuessPick {
  change: ChangeRow;
  guess: Guess;
  /** An applied change never placed: history, which a touches links to what it built. */
  applied: boolean;
}

/** Every row with a guess, open changes first, each list in its own order. */
export function bestGuessPicks(rows: readonly InboxRow[], applied: readonly InboxRow[] = []): BestGuessPick[] {
  const picks: BestGuessPick[] = [];
  for (const [list, isApplied] of [[rows, false], [applied, true]] as const) {
    for (const row of list) {
      const guess = guessOf(row);
      if (guess) picks.push({ change: row.change, guess, applied: isApplied });
    }
  }
  return picks;
}

/** Ticked to begin with: every guess but a weak one, which is a word match and little more. */
export function tickedByDefault(pick: BestGuessPick): boolean {
  return pick.guess.strength !== "weak";
}

export interface PlaceBestResult {
  placed: Array<{ change: string; changeTitle?: string; target: string; title: string }>;
  refused: Array<{ change: string; target: string; error: string; kind?: string }>;
  /** The server's commit of what it placed: a short sha, or why there was none. */
  commit?: { sha: string } | { skipped: string };
}

/** `POST /api/rex/changes/place-best`: each pair as a touches, in one write. */
export async function placeBestGuesses(pairs: ReadonlyArray<{ change: string; target: string }>): Promise<PlaceBestResult | { error: string }> {
  try {
    const res = await fetch("/api/rex/changes/place-best", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placements: pairs }),
    });
    const body = await res.json() as Partial<PlaceBestResult> & { error?: unknown };
    if (!res.ok || !body.placed || !body.refused) {
      return { error: typeof body.error === "string" ? body.error : `HTTP ${res.status}` };
    }
    return { placed: body.placed, refused: body.refused, ...(body.commit ? { commit: body.commit } : {}) };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

/** What the last write did, said beside the button. */
export function placeBestLine(result: PlaceBestResult | { error: string }): string {
  if ("error" in result) return `Nothing placed: ${result.error}`;
  const placed = `Placed ${result.placed.length} change${result.placed.length === 1 ? "" : "s"}`;
  const refused = result.refused.length ? `; ${result.refused.length} refused` : "";
  const commit = !result.commit ? ""
    : "sha" in result.commit ? ` · committed ${result.commit.sha}`
    : ` · not committed: ${result.commit.skipped}`;
  return `${placed}${refused}${commit}`;
}

/** Set by the Plan tile's button; the Inbox page opens with the review showing. */
let reviewRequested = false;
export function requestBestGuessReview(): void { reviewRequested = true; }
function takeBestGuessReview(): boolean {
  const asked = reviewRequested;
  reviewRequested = false;
  return asked;
}

/** Set by a row's Place; the Inbox page opens with that change selected. */
let selectRequested: string | null = null;
export function requestInboxSelection(id: string): void { selectRequested = id; }
export function takeInboxSelection(): string | null {
  const id = selectRequested;
  selectRequested = null;
  return id;
}

/**
 * "Place best guesses": a button, then the review — each change and its best
 * guess, ticked unless weak — and one write for the ticked ones. With
 * `onOpenReview` (the Plan tile) the button hands off to the Inbox page instead.
 */
export function PlaceBestGuesses({ rows, applied = [], onPlaced, onOpenReview }: {
  rows: readonly InboxRow[];
  applied?: readonly InboxRow[];
  /** After a write: read the Inbox again. */
  onPlaced: () => void;
  /** Open the review elsewhere (the Inbox page); absent, it opens here. */
  onOpenReview?: () => void;
}) {
  const picks = useMemo(() => bestGuessPicks(rows, applied), [rows, applied]);
  const [open, setOpen] = useState(() => !onOpenReview && takeBestGuessReview());
  const [unticked, setUnticked] = useState<ReadonlySet<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlaceBestResult | { error: string } | null>(null);

  // Until the person changes a box the defaults stand, so shortlists that arrive later still get them.
  const isTicked = (pick: BestGuessPick) => unticked ? !unticked.has(pick.change.id) : tickedByDefault(pick);
  const toggle = (pick: BestGuessPick) => {
    const next = new Set(unticked ?? picks.filter((p) => !tickedByDefault(p)).map((p) => p.change.id));
    if (next.has(pick.change.id)) next.delete(pick.change.id);
    else next.add(pick.change.id);
    setUnticked(next);
  };
  const ticked = picks.filter(isTicked);
  const reading = rows.some((r) => !r.shortlist) || applied.some((r) => !r.shortlist);

  const place = async () => {
    setBusy(true);
    const answer = await placeBestGuesses(ticked.map((p) => ({ change: p.change.id, target: p.guess.candidate.target })));
    setBusy(false);
    setResult(answer);
    if (!("error" in answer) && answer.placed.length) {
      setOpen(false);
      setUnticked(null);
      onPlaced();
    }
  };

  if (!picks.length && !result) return null;
  return h("div", { class: "inbox-best", "data-open": String(open) },
    h("div", { class: "inbox-best-bar" },
      open
        ? null
        : h("button", {
            type: "button",
            class: "btn btn-sm inbox-best-open",
            disabled: !picks.length,
            title: "Review each change's best guess, then place the ticked ones as Touches",
            onClick: (e: MouseEvent) => {
              e.stopPropagation();
              setResult(null);
              if (onOpenReview) { requestBestGuessReview(); onOpenReview(); } else setOpen(true);
            },
          }, `Place best guesses (${picks.length})`),
      result
        ? h("span", { class: `inbox-best-result${"error" in result || result.refused.length || (result.commit && "skipped" in result.commit) ? " is-warning" : ""}`, role: "status" }, placeBestLine(result))
        : null,
    ),
    result && !("error" in result) && result.refused.length
      ? h("ul", { class: "inbox-best-refused" },
          result.refused.map((r) => h("li", { key: r.change }, `${titleOf(picks, r.change)}: ${r.error}`)))
      : null,
    open
      ? h(Fragment, null,
          h("p", { class: "section-sub" },
            "Each ticked change goes on its best guess as Touches: it works on that capability without changing its requirements. ",
            "Weak guesses start unticked. Amending a spec stays a choice you make on the change itself."),
          h("ul", { class: "inbox-best-list", "aria-label": "Best guesses to place" },
            picks.map((pick) => {
              const { candidate, strength } = pick.guess;
              const id = `inbox-best-${pick.change.id}`;
              return h("li", { key: pick.change.id, class: "inbox-best-row", "data-change-id": pick.change.id },
                h("input", { type: "checkbox", id, checked: isTicked(pick), onChange: () => toggle(pick) }),
                h("label", { for: id, class: "inbox-best-label" },
                  h("span", { class: "inbox-best-change" }, pick.change.title),
                  pick.applied ? h("span", { class: "tag inbox-applied-at" }, "applied") : null,
                  h("span", { class: "inbox-best-arrow", "aria-hidden": "true" }, " → "),
                  candidate.area ? h("span", { class: "inbox-guess-area" }, `${candidate.area} › `) : null,
                  h("span", { class: "inbox-best-target" }, candidate.title),
                  h(StrengthChip, { strength }),
                ),
              );
            }),
          ),
          h("div", { class: "inbox-best-actions" },
            h("button", {
              type: "button",
              class: "btn btn-sm btn-primary inbox-best-place",
              disabled: busy || ticked.length === 0,
              onClick: place,
            }, busy ? "Placing…" : `Place ${ticked.length}`),
            h("button", { type: "button", class: "btn btn-sm inbox-best-cancel", disabled: busy, onClick: () => setOpen(false) }, "Cancel"),
            reading ? h("span", { class: "section-sub" }, "Still reading some shortlists…") : null,
          ),
        )
      : null,
  );
}

function titleOf(picks: readonly BestGuessPick[], id: string): string {
  return picks.find((p) => p.change.id === id)?.change.title ?? id;
}

// ── Rows ─────────────────────────────────────────────────────────────

function GuessLine({ row }: { row: InboxRow }) {
  if (!row.shortlist) return h("span", { class: "inbox-guess inbox-guess-pending" }, "Finding a place…");
  if ("error" in row.shortlist) {
    return h("span", { class: "inbox-guess inbox-guess-error" }, `No guess: ${row.shortlist.error}`);
  }
  const guess = bestGuess(row.shortlist.placement);
  if (!guess) return h("span", { class: "inbox-guess inbox-guess-none" }, "No guess yet");
  const { candidate, strength } = guess;
  return h("span", { class: "inbox-guess" },
    h("span", { class: "inbox-guess-label" }, "Best guess"),
    candidate.area ? h("span", { class: "inbox-guess-area" }, `${candidate.area} › `) : null,
    h("span", { class: "inbox-guess-title" }, candidate.title),
    h(StrengthChip, { strength }),
    h("span", { class: "inbox-guess-score", title: "Placement score" }, String(candidate.score)),
  );
}

/** "today", "1 day" or "N days" from a whole-day age; null while the shortlist has not said. */
export function ageLabel(ageDays: number | undefined): string | null {
  if (ageDays === undefined) return null;
  return ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"}`;
}

function ageOf(row: InboxRow): string | null {
  return row.shortlist && "placement" in row.shortlist ? ageLabel(row.shortlist.placement.change.ageDays) : null;
}

function Row({ row, onOpen, onPlace, people, me, onAssigned, onAccepted }: {
  row: InboxRow;
  onOpen: (id: string) => void;
  onPlace?: (id: string) => void;
  people: readonly KnownPerson[];
  me: string | null;
  onAssigned?: () => void;
  /** After Accept wrote: read the Inbox again. Absent, no Accept. */
  onAccepted?: () => void;
}) {
  const { change } = row;
  const guess = guessOf(row);
  const [accepting, setAccepting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const accept = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!guess || !onAccepted) return;
    setAccepting(true);
    setRefusal(null);
    const answer = await placeBestGuesses([{ change: change.id, target: guess.candidate.target }]);
    setAccepting(false);
    if ("error" in answer) setRefusal(answer.error);
    else if (answer.refused.length) setRefusal(answer.refused[0].error);
    else onAccepted();
  };
  const tags = row.shortlist && "placement" in row.shortlist ? row.shortlist.placement.change.tags ?? [] : [];
  // An unsaved placement left in placement mode (WF10).
  const draftNote = placementDraftNote(change.id);
  const age = ageOf(row);
  // The row is the target; the title button gives it keyboard reach, and its
  // click bubbles here. Place opens placement mode when the page can, and
  // otherwise bubbles to the row too.
  return h("li", { class: "inbox-row", "data-change-id": change.id, onClick: () => onOpen(change.id) },
    h("div", { class: "inbox-row-head" },
      h("span", { class: "ch-display-id" }, shortChangeId(change)),
      h("button", { type: "button", class: "ch-change-link inbox-row-title" }, change.title),
      change.prioritized ? h("span", { class: "tag ch-prioritized", title: PRIORITIZED_TITLE }, "Prioritized") : null,
      change.priority ? h("span", { class: "tag ch-priority" }, change.priority) : null,
      tags.map((tag) => h("span", { key: tag, class: "tag inbox-tag" }, tag)),
      age ? h("span", { class: "inbox-age", title: "Time in the Inbox" }, age) : null,
      h(AssigneePicker, {
        itemId: change.id,
        assignee: change.assignee,
        people,
        me,
        onSave: async (assignee: string) => { await saveAssignee(change.id, assignee); onAssigned?.(); },
      }),
    ),
    h("div", { class: "inbox-row-foot" },
      h(GuessLine, { row }),
      draftNote ? h("span", { class: "tag inbox-draft", "data-draft": "placement" }, draftNote) : null,
      guess && onAccepted
        ? h("button", {
            type: "button",
            class: "btn btn-sm btn-primary inbox-accept",
            "aria-label": `Place ${change.title} on ${guess.candidate.title}`,
            title: `Place on ${guess.candidate.title} as Touches`,
            disabled: accepting,
            onClick: accept,
          }, accepting ? "Placing…" : "Accept")
        : null,
      h("button", {
        type: "button",
        class: "btn btn-sm inbox-place",
        "aria-label": `Place ${change.title}`,
        onClick: onPlace
          ? (e: MouseEvent) => { e.stopPropagation(); onPlace(change.id); }
          : undefined,
      }, "Place"),
      // Present only while web.sidecar is on; its click must not open the row.
      h("span", { class: "inbox-place-sidecar", onClick: (e: MouseEvent) => e.stopPropagation() },
        h(PlaceWithSidecarButton, { changeId: change.id })),
    ),
    refusal ? h("div", { class: "inbox-row-refusal", role: "alert" }, `Not placed: ${refusal}`) : null,
  );
}

// ── View ─────────────────────────────────────────────────────────────

export interface InboxViewProps {
  /** Open changes awaiting placement, with each one's shortlist read so far. */
  rows: readonly InboxRow[];
  /** Applied changes still flagged for placement; null while unknown. */
  appliedUnplaced: number | null;
  /** Those applied changes, with their shortlists; empty until read. */
  appliedRows?: readonly InboxRow[];
  /** Show at most this many rows, then a link to the rest. Absent, show all. */
  limit?: number;
  onOpenChange: (id: string) => void;
  /** Opens placement mode for a row's change (WF1); absent, Place opens the change like the row. */
  onPlace?: (id: string) => void;
  /** Opens the Inbox on its own page; required for the "more" link. */
  onOpenAll?: () => void;
  /** After a row's Accept or "Place best guesses" wrote: read again. Absent, neither is offered. */
  onPlaced?: () => void;
  /** Reads the Inbox again after a row's assignee is saved. */
  onAssigned?: () => void;
}

/** The filter's view of Inbox rows: every one is open work, assigned by the change or its open tasks. */
export function assignableInboxRows(rows: readonly InboxRow[]): AssignableRow[] {
  return rows.map((r) => ({ assignees: changeAssignees(r.change), open: true }));
}

export function InboxView({ rows, appliedUnplaced, appliedRows, limit, onOpenChange, onPlace, onOpenAll, onPlaced, onAssigned }: InboxViewProps) {
  const cliName = useCliName();
  const peopleRead = usePeople();
  const assignable = useMemo(() => assignableInboxRows(rows), [rows]);
  const filter = useAssigneeFilter(assignable, peopleRead);
  const people = useMemo(
    () => pickerChoices(peopleRead?.people ?? [], rows.map((r) => r.change.assignee)),
    [peopleRead, rows],
  );
  const sorted = sortInbox(rows);
  // The filter hides rows only; All shows every one.
  const visible = sorted.filter((row) => filter.shows(changeAssignees(row.change)));
  const shown = limit === undefined ? visible : visible.slice(0, limit);
  const hidden = visible.length - shown.length;

  return h("div", { class: "inbox-container" },
    onPlaced
      ? h(PlaceBestGuesses, { rows: sorted, applied: appliedRows, onPlaced, onOpenReview: onOpenAll })
      : null,
    sorted.length > 0 && !filter.pending ? h("div", { class: "inbox-filters" }, h(AssigneeFilter, { state: filter })) : null,
    sorted.length === 0
      ? h("div", { class: "empty-state inbox-empty", role: "status" },
          h("p", null, "Inbox is empty"),
          h("p", { class: "section-sub" }, resolveCliLabel(HELD_EXPLANATION, cliName)))
      // Held until the people list is read: the default (Mine or All) depends on it.
      : filter.pending
        ? h(AssigneeFilterPending, null)
      : visible.length === 0
        ? h("div", { class: "empty-state inbox-empty inbox-filtered-empty", role: "status" },
            h("p", null, "No Inbox changes match this filter."))
        : h("ul", { class: "inbox-list" },
            shown.map((row) => h(Row, { key: row.change.id, row, onOpen: onOpenChange, onPlace, people, me: peopleRead?.me ?? null, onAssigned, onAccepted: onPlaced })),
          ),
    hidden > 0 && onOpenAll
      ? h("button", { type: "button", class: "ch-change-link inbox-more", onClick: onOpenAll },
          `${hidden} more · Open ↗`)
      : null,
    h(AppliedHistory, { count: appliedUnplaced, rows: appliedRows, onOpen: onOpenChange }),
  );
}

/** The day of an ISO timestamp, or the text itself when it is not a date. */
function appliedDay(at: string | undefined): string {
  return at && /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : at ?? "";
}

function AppliedRow({ row, onOpen }: { row: InboxRow; onOpen: (id: string) => void }) {
  const { change } = row;
  return h("li", { class: "inbox-row inbox-applied-row", "data-change-id": change.id, onClick: () => onOpen(change.id) },
    h("div", { class: "inbox-row-head" },
      h("span", { class: "ch-display-id" }, shortChangeId(change)),
      h("button", { type: "button", class: "ch-change-link inbox-row-title" }, change.title),
      change.appliedAt ? h("span", { class: "tag inbox-applied-at" }, `applied ${appliedDay(change.appliedAt)}`) : null,
    ),
    h("div", { class: "inbox-row-foot" }, h(GuessLine, { row })),
  );
}

/**
 * IB2: applied changes never placed, collapsed to a count; nothing at zero.
 * Expanded, each opens its detail panel, where a touches links it to what it
 * built. `rows` is the strongest-guess-first list; the count is the status
 * poll's, so it shows before the list has loaded.
 */
export function AppliedHistory({ count, rows = [], onOpen }: {
  count: number | null;
  rows?: readonly InboxRow[];
  onOpen?: (id: string) => void;
}) {
  const total = rows.length || count || 0;
  return total
    ? h("details", { class: "inbox-applied" },
        h("summary", null,
          `${total} applied change${total === 1 ? " was" : "s were"} never placed`),
        h("p", { class: "section-sub" },
          "They were applied before they were placed. Placing one links it to what it built; its tasks are done."),
        rows.length && onOpen
          ? h("ul", { class: "inbox-list inbox-applied-list" },
              rows.map((row) => h(AppliedRow, { key: row.change.id, row, onOpen })))
          : null,
      )
    : null;
}

// ── Page ─────────────────────────────────────────────────────────────

/**
 * The Inbox in its Plan section: `limit` rows, each opening its change in
 * the Tasks tree. Its own page is `InboxTriagePage` (inbox-triage.ts).
 */
export function InboxPage({ navigateTo, limit }: { navigateTo?: NavigateTo; limit?: number }) {
  const { load, rows, applied, refetch } = useInbox();
  const status = useProjectStatus();
  if (load.state === "v1") return null;
  if (load.state !== "ready") return h(Pending, { load });
  return h("div", null,
    h(StaleNotice, { message: load.refreshError }),
    h(InboxView, {
      rows,
      appliedUnplaced: status?.rex.inbox?.appliedUnplaced ?? null,
      appliedRows: applied,
      limit,
      onOpenChange: (id) => navigateTo?.("prd", { taskId: id }),
      // Place opens the Inbox page on the change: its shortlist, relation and Place & next.
      onPlace: navigateTo ? (id) => { requestInboxSelection(id); navigateTo("inbox"); } : undefined,
      onOpenAll: navigateTo ? () => navigateTo("inbox") : undefined,
      onPlaced: refetch,
      onAssigned: refetch,
    }),
  );
}

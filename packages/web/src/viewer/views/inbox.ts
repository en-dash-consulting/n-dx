/**
 * Inbox view — open changes with no place on the product map yet.
 *
 * `ndx work` skips an Inbox change's tasks until it is placed, so this lists
 * each one with rex's best guess for its home, strongest guesses first (IB7):
 * those are the quickest to confirm. A row opens the change's detail panel in
 * the Tasks tree, where placement happens; nothing here writes.
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

import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useProjectStatus } from "../components/index.js";
import type { NavigateTo } from "../types.js";
import { Pending, StaleNotice, useRefetchableProductRead, type Load } from "./product-pages.js";
import type { ChangePlacement, ChangePlacements, ChangeRow, PlacementCandidate, PlacementStrength } from "./product-model.js";

/** Rows the Plan section shows before linking to the full page. */
export const INBOX_SECTION_ROWS = 5;

/** A guess's strength; `tied` when the top two candidates share a score. */
export type GuessStrength = PlacementStrength | "tied";

/** IB7: strongest first, then possible, tied, weak. */
const STRENGTH_RANK: Record<GuessStrength, number> = { strong: 0, possible: 1, tied: 2, weak: 3 };
/** A row with no guess yet (loading, failed, or an empty shortlist) sorts last. */
const NO_GUESS_RANK = 4;

/**
 * A shortlist read: the answer, or why it failed. Absent from the map while
 * the read is in flight.
 */
export type ShortlistRead = { placement: ChangePlacement } | { error: string };

export interface InboxRow {
  change: ChangeRow;
  shortlist?: ShortlistRead;
}

export interface Guess {
  candidate: PlacementCandidate;
  strength: GuessStrength;
}

/** The best guess on a shortlist, or null when it has none. */
export function bestGuess(placement: ChangePlacement): Guess | null {
  const candidate = placement.shortlist[0];
  if (!candidate) return null;
  return { candidate, strength: placement.tied ? "tied" : candidate.strength };
}

function guessOf(row: InboxRow): Guess | null {
  return row.shortlist && "placement" in row.shortlist ? bestGuess(row.shortlist.placement) : null;
}

/** Strongest guess first; within a strength the higher score, then the read's order. */
export function sortInbox(rows: readonly InboxRow[]): InboxRow[] {
  const keyed = rows.map((row, index) => {
    const guess = guessOf(row);
    return { row, index, rank: guess ? STRENGTH_RANK[guess.strength] : NO_GUESS_RANK, score: guess?.candidate.score ?? 0 };
  });
  keyed.sort((a, b) => a.rank - b.rank || b.score - a.score || a.index - b.index);
  return keyed.map((k) => k.row);
}

// ── Rows ─────────────────────────────────────────────────────────────

/** Dot and word together: the strength never rests on colour alone. */
export function StrengthChip({ strength }: { strength: GuessStrength }) {
  return h("span", { class: `inbox-strength inbox-strength-${strength}`, "data-strength": strength },
    h("span", { class: "inbox-strength-dot", "aria-hidden": "true" }),
    strength,
  );
}

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
  );
}

function shortId(change: ChangeRow): string {
  return change.displayId ?? change.id.slice(0, 8);
}

function Row({ row, onOpen }: { row: InboxRow; onOpen: (id: string) => void }) {
  const { change } = row;
  const tags = row.shortlist && "placement" in row.shortlist ? row.shortlist.placement.change.tags ?? [] : [];
  // The row is the target; the title and Place buttons give it keyboard
  // reach, and their clicks bubble here.
  return h("li", { class: "inbox-row", "data-change-id": change.id, onClick: () => onOpen(change.id) },
    h("div", { class: "inbox-row-head" },
      h("span", { class: "ch-display-id" }, shortId(change)),
      h("button", { type: "button", class: "ch-change-link inbox-row-title" }, change.title),
      change.priority ? h("span", { class: "tag ch-priority" }, change.priority) : null,
      tags.map((tag) => h("span", { key: tag, class: "tag inbox-tag" }, tag)),
    ),
    h("div", { class: "inbox-row-foot" },
      h(GuessLine, { row }),
      h("button", {
        type: "button",
        class: "btn btn-sm inbox-place",
        "aria-label": `Place ${change.title}`,
      }, "Place"),
    ),
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
  /** Opens the Inbox on its own page; required for the "more" link. */
  onOpenAll?: () => void;
}

export function InboxView({ rows, appliedUnplaced, appliedRows, limit, onOpenChange, onOpenAll }: InboxViewProps) {
  const sorted = sortInbox(rows);
  const shown = limit === undefined ? sorted : sorted.slice(0, limit);
  const hidden = sorted.length - shown.length;

  return h("div", { class: "inbox-container" },
    sorted.length === 0
      ? h("div", { class: "empty-state inbox-empty", role: "status" }, "Inbox is empty")
      : h("ul", { class: "inbox-list" },
          shown.map((row) => h(Row, { key: row.change.id, row, onOpen: onOpenChange })),
        ),
    hidden > 0 && onOpenAll
      ? h("button", { type: "button", class: "ch-change-link inbox-more", onClick: onOpenAll },
          `${hidden} more · Open ↗`)
      : null,
    h(AppliedHistory, { count: appliedUnplaced, rows: appliedRows, onOpen: onOpenChange }),
  );
}

/** An applied change still flagged for placement: history that can take a touches. */
export function isAppliedUnplaced(change: Pick<ChangeRow, "appliedAt" | "needsPlacement">): boolean {
  return !!change.appliedAt && !!change.needsPlacement;
}

/** The day of an ISO timestamp, or the text itself when it is not a date. */
function appliedDay(at: string | undefined): string {
  return at && /^\d{4}-\d{2}-\d{2}/.test(at) ? at.slice(0, 10) : at ?? "";
}

function AppliedRow({ row, onOpen }: { row: InboxRow; onOpen: (id: string) => void }) {
  const { change } = row;
  return h("li", { class: "inbox-row inbox-applied-row", "data-change-id": change.id, onClick: () => onOpen(change.id) },
    h("div", { class: "inbox-row-head" },
      h("span", { class: "ch-display-id" }, shortId(change)),
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

export interface InboxRead {
  /** Every change, as `GET /api/rex/changes` answers. */
  load: Load<ChangeRow[]>;
  /** Open changes awaiting placement, with their shortlists, in the section's order. */
  rows: InboxRow[];
  /** Applied changes never placed, with their shortlists, strongest guess first. */
  applied: InboxRow[];
  /** Read again now, rather than on the next `rex:prd-changed`. */
  refetch: () => void;
}

/**
 * The Inbox as the Plan section orders it. The detail panel's placement
 * reads it too, so "N of M" and "Place & next" follow the same order.
 */
export function useInbox(): InboxRead {
  const { load, refetch } = useRefetchableProductRead("/api/rex/changes", (body) => body.changes as ChangeRow[]);
  const waiting = useMemo(
    () => (load.state === "ready" ? load.data.filter((c) => c.awaitsPlacement || isAppliedUnplaced(c)) : null),
    [load],
  );
  const shortlists = useShortlists(waiting);
  const { rows, applied } = useMemo(() => {
    const all = (waiting ?? []).map((change) => ({ change, shortlist: shortlists.get(change.id) }));
    return {
      rows: sortInbox(all.filter((r) => !isAppliedUnplaced(r.change))),
      applied: sortInbox(all.filter((r) => isAppliedUnplaced(r.change))),
    };
  }, [waiting, shortlists]);
  return { load, rows, applied, refetch };
}

/** Read every row's shortlist in one request, each time the change list is read. */
function useShortlists(changes: readonly ChangeRow[] | null): ReadonlyMap<string, ShortlistRead> {
  const [reads, setReads] = useState<ReadonlyMap<string, ShortlistRead>>(new Map());
  useEffect(() => {
    if (!changes) return;
    let live = true;
    readShortlists(changes.map((c) => c.id)).then((next) => {
      if (live) setReads(next);
    });
    return () => { live = false; };
  }, [changes]);
  return reads;
}

/** `GET /api/rex/changes/placements`: one model load on the server, however many rows. */
async function readShortlists(ids: readonly string[]): Promise<ReadonlyMap<string, ShortlistRead>> {
  const reads = new Map<string, ShortlistRead>();
  const failAll = (error: string) => ids.forEach((id) => reads.set(id, { error }));
  try {
    const res = await fetch("/api/rex/changes/placements");
    const body = await res.json() as Partial<ChangePlacements> & { error?: unknown };
    if (!res.ok || !body.placements) {
      failAll(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
      return reads;
    }
    for (const id of ids) {
      const read = body.placements[id];
      if (!read) reads.set(id, { error: "No shortlist for this change" });
      else if ("error" in read) reads.set(id, { error: read.error });
      else reads.set(id, { placement: read });
    }
  } catch (err) {
    failAll(err instanceof Error ? err.message : String(err));
  }
  return reads;
}

/**
 * The Inbox in its Plan section: `limit` rows, each opening its change in
 * the Tasks tree. Its own page is `InboxTriagePage` (inbox-triage.ts).
 */
export function InboxPage({ navigateTo, limit }: { navigateTo?: NavigateTo; limit?: number }) {
  const { load, rows, applied } = useInbox();
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
      onOpenAll: navigateTo ? () => navigateTo("inbox") : undefined,
    }),
  );
}

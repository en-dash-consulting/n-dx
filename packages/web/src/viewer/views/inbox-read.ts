/**
 * The Inbox's data: every change awaiting placement with its shortlist read,
 * in the order the Inbox shows it (strongest guess first, IB7), and the
 * applied changes never placed (IB2).
 *
 * Here rather than in inbox.ts, the page, because the detail panel's
 * placement section (a component), placement mode and the triage page read
 * it too, and the page imports components that reach that section: reading
 * it from the page closed an import cycle through each one.
 *
 * Reads `GET /api/rex/changes` and every row's shortlist from
 * `GET /api/rex/changes/placements`; prunes the placement drafts of changes
 * no longer waiting (WF10). Writes nothing else.
 *
 * @module viewer/views/inbox-read
 */

import { useEffect, useMemo, useState } from "preact/hooks";
import { prunePlacementDrafts } from "../components/prd-tree/placement-draft.js";
import { useRefetchableProductRead } from "../hooks/index.js";
import type { Load } from "../hooks/index.js";
import type { ChangePlacement, ChangePlacements, ChangeRow, GuessStrength, PlacementCandidate } from "./product-model.js";
import { errorMessage } from "../utils/format.js";

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

/** A row's best guess, or null while its shortlist is loading, failed or empty. */
export function guessOf(row: InboxRow): Guess | null {
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

/** An applied change still flagged for placement: history that can take a touches. */
export function isAppliedUnplaced(change: Pick<ChangeRow, "appliedAt" | "needsPlacement">): boolean {
  return !!change.appliedAt && !!change.needsPlacement;
}

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
    () => (load.state === "ready" ? load.data.filter((c) => c.inbox || isAppliedUnplaced(c)) : null),
    [load],
  );
  // A change placed by any route (here, the CLI, another session) no longer waits: its draft goes (WF10).
  useEffect(() => {
    if (waiting) prunePlacementDrafts(new Set(waiting.map((c) => c.id)));
  }, [waiting]);
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
    failAll(errorMessage(err));
  }
  return reads;
}

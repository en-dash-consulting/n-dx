/**
 * The Inbox as a read: every open change held for placement (`needsPlacement`),
 * with its age and the placement rules' shortlist. `rex change inbox` prints it.
 * Counts the same changes as `get_prd_status` (`isOpenChange && needsPlacement`).
 */

import { indexTree, isOpenChange, type V2Tree } from "../schema/v2-rules.js";
import { PLACEMENT_SHORTLIST_SIZE } from "./placement.js";
import { suggestPlacements, type PlacementSuggestion } from "./change-place.js";

/** One shortlisted target, as the inbox read carries it. */
export interface InboxCandidate {
  target: string;
  relation: string;
  score: number;
  strength: string;
  reasons: string[];
}

export interface InboxRow {
  id: string;
  displayId?: string;
  title: string;
  intent?: string;
  /** When the change was first recorded: `createdAt`, else `lastModified` for a change older than that field. Absent when neither is set. */
  createdAt?: string;
  /** Whole days from `createdAt` to now, never negative. */
  ageDays?: number;
  relation: string;
  relationRule: string;
  tied: boolean;
  shortlist: InboxCandidate[];
}

export interface InboxListing {
  /** Open changes with `needsPlacement`, oldest first; a change with no recorded time last. */
  rows: InboxRow[];
}

/** Every open change awaiting placement on `tree`, with its top {@link PLACEMENT_SHORTLIST_SIZE} candidates. */
export function listInbox(tree: V2Tree, now: Date): InboxListing {
  const index = indexTree(tree);
  const held = index.entries.map((e) => e.node).filter((n) => n.type === "change" && isOpenChange(n) && n.needsPlacement === true);
  const suggested = suggestPlacements(tree, held.map((n) => n.id), PLACEMENT_SHORTLIST_SIZE, { now });
  const rows = held.map((node): InboxRow => {
    const result = suggested.get(node.id)!;
    // An open change always resolves; a refusal here would be a rex defect, so surface it.
    if ("error" in result) throw result.error;
    const s: PlacementSuggestion = result.suggestion;
    return {
      id: node.id,
      ...(node.displayId ? { displayId: node.displayId } : {}),
      title: node.title,
      ...(node.type === "change" && node.intent ? { intent: node.intent } : {}),
      ...(s.createdAt !== undefined ? { createdAt: s.createdAt, ageDays: s.ageDays } : {}),
      relation: s.relation,
      relationRule: s.relationRule,
      tied: s.tied,
      shortlist: s.shortlist.map((c) => ({ target: c.target, relation: c.relation, score: c.score, strength: c.strength, reasons: c.reasons })),
    };
  });
  rows.sort((a, b) => (a.createdAt ?? "￿").localeCompare(b.createdAt ?? "￿") || a.id.localeCompare(b.id));
  return { rows };
}

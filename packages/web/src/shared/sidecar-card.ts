/**
 * The Sidecar card contract the server and the drawer both read.
 *
 * Ending a session withdraws its waiting cards with this reason (UX8). The
 * drawer draws such a card as denied with the note "session ended", unlike a
 * card withdrawn because a turn stopped, so the reason is the shared signal.
 */
export const SIDECAR_SESSION_ENDED_REASON = "session ended";

/**
 * One item of a change-set card, as the server read it from the proposal:
 * its type resolved, its parent named, and any existing item it matches.
 */
export interface SidecarChangeSetItem {
  title: string;
  /** The item type it is added as (`epic`, `task`, … on v1; `change` or `task` on v2). */
  type: string;
  description?: string;
  /** Done-when: the item's acceptance criteria. */
  acceptanceCriteria?: string[];
  priority?: string;
  /** An existing item it goes under. */
  parentId?: string;
  /** An earlier item of the same card it goes under, by index. */
  parent?: number;
  /** The existing item it matches, by the rule smart add flags duplicates by. */
  duplicate?: { id: string; title: string; type: string; status: string };
}

/** Where a v2 change-set's change lands: on a capability or constraint, or in the Inbox. */
export type SidecarChangeSetPlacement =
  | { target: string; title: string }
  | { inbox: true };

/** A change-set card's items as approval writes them. */
export interface SidecarChangeSet {
  layout: "v1" | "v2";
  items: SidecarChangeSetItem[];
  /** v2 only. */
  placement?: SidecarChangeSetPlacement;
}

/** The operator's edit of one item, sent with the approval. */
export interface SidecarChangeSetEdit {
  index: number;
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
}

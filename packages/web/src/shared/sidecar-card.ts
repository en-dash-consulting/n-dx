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

/** A capability criterion as a placement adds or replaces it. A type alias, so it fits rex's indexable `Criterion`. */
export type SidecarCriterion = { id: string; text: string };

/**
 * What a placement card writes: the change on an existing capability or
 * constraint (`place`, the body `POST …/place` takes), or a new one proposed
 * under an area (`propose`, the body `POST …/propose` takes).
 */
export type SidecarPlacementRequest =
  | {
      action: "place";
      target: string;
      relation?: "touches" | "amends";
      summary?: string;
      proposed?: string;
      criteria?: { add?: SidecarCriterion[]; replace?: SidecarCriterion[]; remove?: string[] };
    }
  | {
      action: "propose";
      type: "capability" | "constraint";
      under: string;
      title: string;
      summary?: string;
      proposed?: string;
      criteria?: { add: SidecarCriterion[] };
    };

/**
 * Rex's dry run of a placement on the PRD as loaded, which wrote nothing.
 * `base` is the target's spec hash an amends placement pins: apply refuses it
 * once that spec moves. `warnings` name the open changes in the way of apply.
 * A refusal carries rex's kind (`ChangePlacementErrorKind`) and message.
 */
export type SidecarPlacementCheck =
  | { ok: true; action: "place"; target: string; title: string; relation: "touches" | "amends"; base?: string; warnings: string[] }
  | { ok: true; action: "propose"; type: "capability" | "constraint"; under: string; title: string; warnings: string[] }
  | { ok: false; kind: string; error: string };

/** A placement card: the change, what approval writes, the agent's reasons and rex's dry run when it was raised. */
export interface SidecarPlacement {
  change: string;
  request: SidecarPlacementRequest;
  reasons: string[];
  check: SidecarPlacementCheck;
}

/** The operator's edit of one item, sent with the approval. */
export interface SidecarChangeSetEdit {
  index: number;
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
}

/** One choice of a picker an external-call card draws for a property. */
export interface SidecarFieldOption {
  value: string | number | boolean;
  label: string;
}

/**
 * What an external-call card shows beside the agent's arguments: where the
 * call goes, the tool's input schema the form is drawn from, and the choices
 * a field hint read from the connection's own read tools.
 */
export interface SidecarExternalCall {
  /** The connection's label. */
  label: string;
  /** The host of an http connection's url; unset for a stdio server. */
  host?: string;
  /** The tool's JSON input schema, as its server lists it. */
  inputSchema: Record<string, unknown>;
  /** Picker choices by top-level property name; a property with none is a plain field. */
  options?: Record<string, SidecarFieldOption[]>;
}

/** One problem a server's validation error lists. */
export interface SidecarCallProblem {
  /** The property or path it concerns, when the server names one. */
  field?: string;
  message: string;
}

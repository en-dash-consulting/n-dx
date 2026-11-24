/**
 * The sidecar's shapes, as the server sends them — mirrors
 * server/routes-sidecar.ts and server/sidecar/session-registry.ts.
 *
 * Types only, so use-sidecar.ts and use-sidecar-sessions.ts can both read
 * them without importing each other; use-sidecar.ts re-exports every one.
 */

import type { QueuePlan, SidecarChangeSet, SidecarChangeSetEdit } from "../external.js";

export interface SidecarSession {
  id: string;
  name: string;
  vendor: string;
  model?: string;
  lens?: string;
  /** What the lens is pointed at; absent or `{}` means no target. */
  target?: { ref?: string };
  cursor: number;
  turns: number;
  createdAt: string;
  lastActivityAt: string;
  endedAt?: string;
  /** How the last finished turn ended; absent before one ends and once the next starts. */
  lastTurn?: SidecarTurnEnd;
}
export interface SidecarSessionEntry {
  session: SidecarSession;
  running: boolean;
  /** What the session's tokens cost at its model's rates; `total` is formatted. */
  estimatedCost?: { total: string };
}
/** The parts of a vendor runtime event the transcript draws. */
export interface SidecarRuntimeEvent {
  type: "assistant" | "tool_use" | "tool_result" | "completion" | "failure" | "token_usage";
  /** Originating parser; optional for frames without recorded provenance. */
  vendor?: string;
  text?: string;
  toolCall?: { tool: string; input: Record<string, unknown>; id?: string };
  /** `isError` is the vendor's verdict when it gave one; absent on older frames and when unknown. */
  toolResult?: { tool: string; output: string; durationMs: number; id?: string; isError?: boolean };
  failure?: { message?: string };
  /** On `token_usage`: what the call sent in and got back. */
  tokenUsage?: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
}
export type SidecarFrame =
  | { seq: number; at: string; type: "user"; text: string }
  | { seq: number; at: string; type: "event"; event: SidecarRuntimeEvent; checkpoint?: true }
  | { seq: number; at: string; type: "context-refreshed"; notes: number; contextTokens: number };
/** Mirrors `SidecarCardKind` in server/sidecar/broker-policy.ts. */
export type SidecarCardKind =
  | "command"
  | "work"
  | "change-set"
  | "run-plan"
  | "placement"
  | "edit"
  | "link"
  | "item-edit"
  | "status"
  | "choice"
  | "network-read"
  | "draft-post"
  | "draft-file"
  | "migration-decision"
  | "external-call";
/** A capability criterion in a placement; mirrors `SidecarCriterion` in shared/sidecar-card.ts. */
export interface PlacementCriterion { id: string; text: string }
/** What a placement card writes; mirrors `SidecarPlacementRequest` in shared/sidecar-card.ts. */
export type SidecarPlacementRequest =
  | {
      action: "place";
      target: string;
      relation?: "touches" | "amends";
      summary?: string;
      proposed?: string;
      criteria?: { add?: PlacementCriterion[]; replace?: PlacementCriterion[]; remove?: string[] };
    }
  | {
      action: "propose";
      type: "capability" | "constraint";
      under: string;
      title: string;
      summary?: string;
      proposed?: string;
      criteria?: { add: PlacementCriterion[] };
    };
/** Rex's dry run of a placement; mirrors `SidecarPlacementCheck` in shared/sidecar-card.ts. */
export type SidecarPlacementCheck =
  | { ok: true; action: "place"; target: string; title: string; relation: "touches" | "amends"; base?: string; warnings: string[] }
  | { ok: true; action: "propose"; type: "capability" | "constraint"; under: string; title: string; warnings: string[] }
  | { ok: false; kind: string; error: string };
/** A placement card's placement; mirrors `SidecarPlacement` in shared/sidecar-card.ts. */
export interface SidecarPlacement {
  change: string;
  request: SidecarPlacementRequest;
  reasons: string[];
  check: SidecarPlacementCheck;
}
/** A link card's item, tracker ref and the tracker's label; mirrors `SidecarLink` in shared/sidecar-card.ts. */
export interface SidecarLink { itemId: string; title: string; ref: string; label: string | null }
/** The fields an item-edit card changes; mirrors `SidecarItemEditFields` in shared/sidecar-card.ts. */
export interface SidecarItemEditFields {
  title?: string;
  description?: string;
  acceptanceCriteria?: string[];
  tags?: string[];
  priority?: "critical" | "high" | "medium" | "low";
}
/** A status card's item, its status and the proposed one, and rex's verdict on the move; mirrors `SidecarStatusChange` in shared/sidecar-card.ts. */
export interface SidecarStatusChange {
  itemId: string;
  itemTitle: string;
  from: string;
  to: string;
  completionPolicy?: "v2";
  reason?: string;
  rule: { allowed: true } | { allowed: false; message: string };
}
/** A choice card's question, options and (once sent) the operator's answer; mirrors `SidecarChoice` in shared/sidecar-card.ts. */
export interface SidecarChoice {
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect: boolean;
  answer?: SidecarChoiceAnswer;
}
/** The labels the operator picked and any text from the Other row. */
export interface SidecarChoiceAnswer {
  selected: string[];
  other?: string;
}
/** An item-edit card's item and each changed field before and after; mirrors `SidecarItemEdit` in shared/sidecar-card.ts. */
export interface SidecarItemEdit {
  itemId: string;
  itemTitle: string;
  before: SidecarItemEditFields;
  after: SidecarItemEditFields;
}
/** One choice of an external-call card's picker; mirrors `SidecarFieldOption` in shared/sidecar-card.ts. */
export interface SidecarFieldOption { value: string | number | boolean; label: string }
/** An external-call card's connection, host, input schema and picker choices; mirrors `SidecarExternalCall` in shared/sidecar-card.ts. */
export interface SidecarExternalCall {
  label: string;
  host?: string;
  inputSchema: Record<string, unknown>;
  options?: Record<string, SidecarFieldOption[]>;
}
/** One problem of a server's validation error; mirrors `SidecarCallProblem` in shared/sidecar-card.ts. */
export interface SidecarCallProblem { field?: string; message: string }
/** Active work holding an item a PRD card writes to; mirrors `SidecarHeldBy` in shared/sidecar-card.ts. */
export interface SidecarHeldBy {
  itemId: string;
  taskId: string;
  taskTitle?: string;
  worktree: string;
  worktreePath: string;
  runId?: string;
  source: "run" | "claim";
}
/** A permission card; mirrors `SidecarCard` in server/sidecar/broker.ts. */
export interface SidecarCard {
  id: string;
  sessionId: string;
  tool: string;
  kind: SidecarCardKind;
  input: Record<string, unknown>;
  /** Set when "always allow" may be offered. */
  allowListKey: string | null;
  /** What the call would do, read before the card was raised: a work card's `ndx work --resolve`. */
  preview?: string;
  /** A work card's run options as the server will start them, defaults applied. */
  runOptions?: Record<string, unknown>;
  /** A work card's row: the task and the change it sits in. */
  rowText?: string;
  /** A change-set card's items as approval writes them. */
  changeSet?: SidecarChangeSet;
  /** A run-plan card's plan, as the planner printed it when the card was raised. */
  runPlan?: QueuePlan;
  /** A placement card's placement as approval writes it, with rex's dry run from when the card was raised. */
  placement?: SidecarPlacement;
  /** A link card's item and tracker ref as approval writes them. */
  link?: SidecarLink;
  /** An item-edit card's fields as read when it was raised and as approval writes them. */
  itemEdit?: SidecarItemEdit;
  /** A status card's change as read when it was raised. */
  statusChange?: SidecarStatusChange;
  /** A choice card's question and options, and the answer once sent. */
  choice?: SidecarChoice;
  /** An external-call card's connection, workspace host, input schema and picker choices. */
  externalCall?: SidecarExternalCall;
  /** The lane (0-based) the operator started from a run-plan card. */
  lane?: number;
  /** Active work (a run or a claim in some worktree) holds an item the card writes to; Approve asks twice. */
  heldBy?: SidecarHeldBy;
  /** Approved over that warning. */
  heldAcknowledged?: true;
  status: "pending" | "approved" | "denied" | "withdrawn";
  raisedAt: string;
  decidedAt?: string;
  reason?: string;
  /** Approved with "always allow". */
  remembered?: true;
  /** The operator edited the change set, placement, path or call arguments before approving it. */
  edited?: true;
  /** How the approved call's effect ended; `ids` are the PRD items a change-set card wrote, `problems` an external server's validation errors. */
  carriedOut?: { ok: boolean; ids?: string[]; held?: boolean; problems?: SidecarCallProblem[] };
}
/** A placement as one body: the shape `POST /api/rex/changes/:id/placement/check` takes, and a placement approval's edits. */
export type PlacementEditBody = Record<string, unknown>;
/** The operator's answer to the first waiting card. */
export interface SidecarCardDecision {
  approve: boolean;
  /** A deny's note, sent to the agent as the reason. */
  reason?: string;
  /** "Always allow": only when the card has an allowListKey. */
  remember?: boolean;
  /** A change-set approval's item edits, or an item-edit approval's field values; the approval writes the edited values. */
  edits?: SidecarChangeSetEdit[] | PlacementEditBody | SidecarItemEditFields;
  /** A placement edit's dry run as the operator reviewed it; the server refuses the approval when its re-check moved from it. */
  reviewed?: SidecarPlacementCheck;
  /** A run-plan card's Start lane: the 0-based lane whose first task to start. */
  lane?: number;
  /** A draft-file approval's path as edited on the card; the draft is saved there. */
  path?: string;
  /** An external-call approval's arguments as edited on the card; the tool is called with these. */
  arguments?: Record<string, unknown>;
  /** A choice card's answer: the option labels picked and the Other text; Send approves with it. */
  answer?: SidecarChoiceAnswer;
  /** The operator confirmed approving although active work holds the card's item (`heldBy`). */
  acknowledgeHeld?: boolean;
}
/**
 * The parts of a command's effects declaration a command card draws; core
 * owns the full shape (`packages/core/command-effects.js`), served by
 * GET /api/commands/manifest.
 */
export interface SidecarCommandEffects {
  reads: string[];
  writes: Array<{ path: string }>;
  llm: unknown[];
  duration: string;
}
/**
 * Each ndx command's declared effects, by command name (null where the CLI
 * declared none), and the CLI names an argv may start with.
 */
export interface SidecarCommandManifest {
  cliNames: string[];
  effects: Record<string, SidecarCommandEffects | null>;
  /** This project's path for each `{token}` the declarations use. */
  layoutPaths: Record<string, string>;
}
/** How the last turn ended, from the announcement that closed it. */
export interface SidecarTurnEnd {
  status: string;
  error?: string;
  /** The failure was the vendor CLI's sign-in error (the server classifies it). */
  signedOut?: true;
}
/** Drawer state A: the session's vendor CLI cannot run until the operator does `command`. */
export interface SidecarSetupNeed {
  reason: "missing-cli" | "signed-out";
  cli: string;
  command: string;
}
/**
 * Where a drawer's sessions live and how it hears about them. The worktree's
 * by default; the hub drawer's are reached through the hub at `/hub/session/`.
 */
export interface SidecarEndpoint {
  /** The session routes' collection path. */
  sessions: string;
  /** The socket that announces the sessions' frames and cards. */
  socketUrl: () => string;
  /**
   * A vendor and lens the session is created with and keeps: there is no
   * picker to read a catalog for and no page item to attach.
   */
  fixed?: { vendor: string; lens: string };
}
/** The vendor and model a session runs on, or will run on once created. */
export interface SidecarAgent {
  vendor: string;
  model: string;
}
/** What the picker offers: each resumable vendor's models, from GET /api/llm/catalog. */
export type SidecarCatalog = Record<string, { models: string[]; defaultModel: string; cliFound?: boolean }>;

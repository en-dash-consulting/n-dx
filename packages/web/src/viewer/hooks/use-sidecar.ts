/**
 * The Sidecar drawer's data: the open session, its transcript, the running
 * turn and the count of permission cards waiting on the operator.
 *
 * The transcript follows the server's announce-then-fetch pattern
 * (server/routes-sidecar.ts): a `sidecar:frames` message carries only the
 * session's new cursor, and the drawer fetches `…/frames?after=<cursor>` for
 * the frames it has not drawn. Frames merge by `seq`, so a fetch that overlaps
 * another, or a reload that starts again from 0, never draws a frame twice.
 *
 * A `sidecar:card` message refetches the cards: the open session's draw in the
 * drawer, and the waiting ones, summed across every open session in this
 * worktree, are the badge count. `decide` answers the first waiting card.
 *
 * One socket serves both; the hook lives in `main.ts` so the top-nav badge
 * counts while the drawer is closed. The transcript is only read while open.
 *
 * {@link useSidecarDrawerState} holds whether the drawer is open and binds
 * ⌘J (Ctrl+J elsewhere). Opening it is UI state: it adds no view and leaves
 * the route alone.
 *
 * {@link useSidecarShell} is what main.ts calls with `web.sidecar`: every
 * entry point — the button, ⌘J, the drawer — hangs off that one value.
 */

import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { openWebSocket } from "../session.js";
import { createWSPipeline } from "./use-gateway.js";
import { useSidecarSessions } from "./use-sidecar-sessions.js";
import type { SidecarSessionsState } from "./use-sidecar-sessions.js";
import { GENERAL_LENS, useSidecarAttachment } from "./use-sidecar-attachment.js";
import type { SidecarAttachment, SidecarPageSelection } from "./use-sidecar-attachment.js";
import type { QueuePlan, SidecarChangeSet, SidecarChangeSetEdit } from "../external.js";

// ---------------------------------------------------------------------------
// Shape — mirrors server/routes-sidecar.ts and server/sidecar/session-registry.ts
// ---------------------------------------------------------------------------

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
  text?: string;
  toolCall?: { tool: string; input: Record<string, unknown>; id?: string };
  toolResult?: { tool: string; output: string; durationMs: number; id?: string };
  failure?: { message?: string };
  /** On `token_usage`: what the call sent in and got back. */
  tokenUsage?: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
}

/**
 * The context the session's next turn resumes with: what the last call of its
 * last turn sent in, the measure the server holds against the ceiling
 * (`contextTokens` in server/sidecar/context-refresh.ts). A refresh starts the
 * next turn cold, so nothing carries over it; the checkpoint turn's own calls
 * are not the conversation's.
 */
export function latestContextTokens(frames: readonly SidecarFrame[]): number {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (frame.type === "context-refreshed") return 0;
    if (frame.type !== "event" || frame.checkpoint) continue;
    const usage = frame.event.type === "token_usage" ? frame.event.tokenUsage : undefined;
    if (usage) return usage.input + (usage.cacheCreationInput ?? 0) + (usage.cacheReadInput ?? 0);
  }
  return 0;
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
  reason?: string;
  rule: { allowed: true } | { allowed: false; message: string };
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
  /** An external-call card's connection, workspace host, input schema and picker choices. */
  externalCall?: SidecarExternalCall;
  /** The lane (0-based) the operator started from a run-plan card. */
  lane?: number;
  status: "pending" | "approved" | "denied" | "withdrawn";
  raisedAt: string;
  decidedAt?: string;
  reason?: string;
  /** Approved with "always allow". */
  remembered?: true;
  /** The operator edited the change set, placement, path or call arguments before approving it. */
  edited?: true;
  /** How the approved call's effect ended; `ids` are the PRD items a change-set card wrote, `problems` an external server's validation errors. */
  carriedOut?: { ok: boolean; ids?: string[]; problems?: SidecarCallProblem[] };
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

/** What the operator runs to get a vendor CLI working; the CLI is the binary's name. */
const VENDOR_SETUP: Record<string, { cli: string; install: string; login: string }> = {
  claude: { cli: "claude", install: "npm install -g @anthropic-ai/claude-code", login: "claude /login" },
  codex: { cli: "codex", install: "npm install -g @openai/codex", login: "codex login" },
};

/** Drawer state A: the session's vendor CLI cannot run until the operator does `command`. */
export interface SidecarSetupNeed {
  reason: "missing-cli" | "signed-out";
  cli: string;
  command: string;
}

/**
 * Whether `agent` cannot run yet: its CLI is not installed (`/api/llm/catalog`
 * probed it), or the last turn failed on the vendor's sign-in error. A missing
 * CLI wins, since it cannot be signed in.
 */
export function sidecarSetupNeed(
  agent: SidecarAgent | null,
  catalog: SidecarCatalog | null,
  lastTurn: SidecarTurnEnd | null,
): SidecarSetupNeed | null {
  const setup = agent ? VENDOR_SETUP[agent.vendor] : undefined;
  if (!agent || !setup) return null;
  if (catalog?.[agent.vendor]?.cliFound === false) return { reason: "missing-cli", cli: setup.cli, command: setup.install };
  if (lastTurn?.signedOut) return { reason: "signed-out", cli: setup.cli, command: setup.login };
  return null;
}

const SESSIONS = "/api/sidecar/sessions";

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

/** This worktree's sessions on this viewer's own server. */
export const WORKTREE_SIDECAR: SidecarEndpoint = { sessions: SESSIONS, socketUrl: getWebSocketUrl };

/**
 * Vendors with a resumable CLI session, in picker order. A resume id belongs
 * to one vendor CLI, so these are the only vendors Sidecar can offer.
 */
export const SIDECAR_VENDORS = ["claude", "codex"] as const;
const SESSION_VENDORS = new Set<string>(SIDECAR_VENDORS);
const DEFAULT_VENDOR = "claude";

/** The vendor and model a session runs on, or will run on once created. */
export interface SidecarAgent {
  vendor: string;
  model: string;
}

/** What the picker offers: each resumable vendor's models, from GET /api/llm/catalog. */
export type SidecarCatalog = Record<string, { models: string[]; defaultModel: string; cliFound?: boolean }>;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `existing` plus the frames of `incoming` it does not hold, in `seq` order. */
export function mergeFrames(existing: readonly SidecarFrame[], incoming: readonly SidecarFrame[]): SidecarFrame[] {
  if (incoming.length === 0) return existing as SidecarFrame[];
  const seen = new Set(existing.map((f) => f.seq));
  const added = incoming.filter((f) => !seen.has(f.seq));
  if (added.length === 0) return existing as SidecarFrame[];
  return [...existing, ...added].sort((a, b) => a.seq - b.seq);
}

/** The session the drawer opens: the most recently active one that has not ended. */
export function pickOpenSession(entries: readonly SidecarSessionEntry[]): SidecarSessionEntry | null {
  let best: SidecarSessionEntry | null = null;
  for (const entry of entries) {
    if (entry.session.endedAt) continue;
    if (!best || entry.session.lastActivityAt > best.session.lastActivityAt) best = entry;
  }
  return best;
}

/** Cards still waiting on the operator. */
export function waitingCards(cards: readonly SidecarCard[]): number {
  return cards.filter((c) => c.status === "pending").length;
}

/** Cards oldest first, the order the agent waits on them. */
export function orderCards(cards: readonly SidecarCard[]): SidecarCard[] {
  return [...cards].sort((a, b) => (a.raisedAt < b.raisedAt ? -1 : a.raisedAt > b.raisedAt ? 1 : 0));
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? (await res.json()) as T : null;
  } catch {
    return null;
  }
}

const postJson = <T>(url: string, body: unknown) => sendJson<T>("POST", url, body);
const patchJson = <T>(url: string, body: unknown) => sendJson<T>("PATCH", url, body);

/** Send a JSON body; the parsed answer, or the server's error text. */
async function sendJson<T>(
  method: "POST" | "PATCH",
  url: string,
  body: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as T & { error?: string };
    return res.ok ? { ok: true, data } : { ok: false, error: data.error ?? `Request failed (${res.status})` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The picker's catalog from GET /api/llm/catalog; null when the route does not answer. */
async function loadCatalog(refresh = false): Promise<SidecarCatalog | null> {
  const body = await getJson<Record<string, { models?: string[]; defaultModel?: string; cli?: { found?: boolean } } | undefined>>(
    refresh ? "/api/llm/catalog?refresh=true" : "/api/llm/catalog",
  );
  if (!body) return null;
  const catalog: SidecarCatalog = {};
  for (const vendor of SIDECAR_VENDORS) {
    const entry = body[vendor];
    if (entry?.models) {
      catalog[vendor] = {
        models: entry.models,
        defaultModel: entry.defaultModel ?? entry.models[0] ?? "",
        ...(typeof entry.cli?.found === "boolean" && { cliFound: entry.cli.found }),
      };
    }
  }
  return catalog;
}

/** Command effects from GET /api/commands/manifest; null when the route does not answer. */
async function loadCommandManifest(): Promise<SidecarCommandManifest | null> {
  const body = await getJson<{
    cliName?: string;
    layoutPaths?: Record<string, string>;
    groups?: Array<{ commands?: Array<{ name: string; effects?: SidecarCommandEffects | null }> }>;
  }>("/api/commands/manifest");
  if (!body) return null;
  const effects: SidecarCommandManifest["effects"] = {};
  for (const group of body.groups ?? []) {
    for (const cmd of group.commands ?? []) effects[cmd.name] = cmd.effects ?? null;
  }
  const cliNames = [...new Set(["ndx", "n-dx", ...(body.cliName ? [body.cliName] : [])])];
  return { cliNames, effects, layoutPaths: body.layoutPaths ?? {} };
}

/** The configured vendor when it has a resumable session, else Claude. */
async function defaultVendor(): Promise<string> {
  const config = await getJson<{ vendor?: string | null }>("/api/llm/config");
  const vendor = config?.vendor ?? null;
  return vendor && SESSION_VENDORS.has(vendor) ? vendor : DEFAULT_VENDOR;
}

// ---------------------------------------------------------------------------
// Drawer open state and ⌘J
// ---------------------------------------------------------------------------

/** Whether a keydown is the Sidecar toggle: ⌘J, or Ctrl+J. */
export function isSidecarShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "j";
}

export interface SidecarDrawerState {
  open: boolean;
  toggle: () => void;
  /** Open it, as a page's "Ask Sidecar" control does after attaching its item. */
  show: () => void;
  close: () => void;
}

/** Open/closed state; ⌘J toggles it on every page while `enabled`. Closed whenever disabled. */
export function useSidecarDrawerState(enabled: boolean): SidecarDrawerState {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      if (!isSidecarShortcut(e)) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [enabled, toggle]);

  return { open: enabled && open, toggle, show, close };
}

// ---------------------------------------------------------------------------
// Sessions, transcript, badge
// ---------------------------------------------------------------------------

export interface SidecarState {
  /** The open session; null before the first prompt creates one. */
  session: SidecarSession | null;
  frames: SidecarFrame[];
  /** A turn is running in the open session. */
  running: boolean;
  /** A prompt is on its way to the server. */
  sending: boolean;
  /** Cards waiting across this worktree's sessions. */
  waiting: number;
  /** The open session has ended: its transcript reads, nothing more. */
  readOnly: boolean;
  /** The sessions list. */
  sessions: SidecarSessionsState;
  /** Open one of this worktree's sessions, ended or not; false, with the error set, when it is gone. */
  openSession: (id: string) => Promise<boolean>;
  /** Cards waiting in the open session. */
  sessionWaiting: number;
  /** The open session's cards, oldest first. */
  cards: SidecarCard[];
  /**
   * Command effects for command cards: null until the open session has one;
   * `unavailable` when the manifest could not be read (read once per page load).
   */
  commandManifest: SidecarCommandManifest | "loading" | "unavailable" | null;
  /** Decide the open session's first waiting card; false when the server refused the decision. */
  decide: (cardId: string, decision: SidecarCardDecision) => Promise<boolean>;
  lastTurn: SidecarTurnEnd | null;
  error: string | null;
  /** The agent the picker shows: the open session's, else the one the first prompt will create. */
  agent: SidecarAgent | null;
  catalog: SidecarCatalog | null;
  /**
   * Pick a vendor and model. With a session open and a different agent this
   * starts a new session on it; the old one is left as it was, resumable.
   */
  chooseAgent: (vendor: string, model?: string) => Promise<void>;
  send: (prompt: string) => Promise<boolean>;
  /** Start a new session on the current agent and attachment and follow it; false, with the error set, when the server refuses. */
  newSession: () => Promise<boolean>;
  /** Put a message on the drawer's error line. */
  reportError: (message: string) => void;
  stop: () => Promise<void>;
  /**
   * The page item attached as the session's target, and the lens it asks
   * with. The open session follows it through PATCH /api/sidecar/sessions/:id.
   */
  attachment: SidecarAttachment;
  /** Why the PATCH making the open session follow the attachment failed; null while it follows or the PATCH is pending. */
  followError: string | null;
}

interface Tail {
  sessionId: string | null;
  cursor: number;
  inFlight: boolean;
  /**
   * An announcement came in while a read was in flight: read again when it
   * lands. This is also what keeps a read taken before a turn ended from
   * having the last word on `running` — the closing announcement's re-read does.
   */
  again: boolean;
}

/** The socket's reconnect delay doubles from the first to the cap, and resets once it opens (as use-live.ts). */
const RECONNECT_FIRST_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const newTail = (sessionId: string | null): Tail => ({ sessionId, cursor: 0, inFlight: false, again: false });

export function useSidecar(
  enabled: boolean,
  open: boolean,
  page: SidecarPageSelection,
  endpoint: SidecarEndpoint = WORKTREE_SIDECAR,
): SidecarState {
  // Read through a ref: a caller passing a fresh object each render must not re-run every effect.
  const endpointRef = useRef(endpoint);
  endpointRef.current = endpoint;
  const sessionsPath = useCallback(() => endpointRef.current.sessions, []);
  const fixed = endpoint.fixed ?? null;
  const attachment = useSidecarAttachment(enabled && !fixed, open, page);
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;
  const [session, setSession] = useState<SidecarSession | null>(null);
  const [frames, setFrames] = useState<SidecarFrame[]>([]);
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const [cardsBySession, setCardsBySession] = useState<Record<string, SidecarCard[]>>({});
  const [commandManifest, setCommandManifest] = useState<SidecarState["commandManifest"]>(null);
  const [lastTurn, setLastTurn] = useState<SidecarTurnEnd | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<SidecarCatalog | null>(null);
  const [picked, setPicked] = useState<SidecarAgent | null>(null);

  const mountedRef = useRef(true);
  const sessionRef = useRef<SidecarSession | null>(null);
  sessionRef.current = session;
  const pickedRef = useRef<SidecarAgent | null>(null);
  pickedRef.current = picked;
  const catalogRef = useRef<SidecarCatalog | null>(null);
  catalogRef.current = catalog;
  const openRef = useRef(open);
  openRef.current = open;
  const tailRef = useRef<Tail>(newTail(null));
  /** Card reads: the number of the last one started, and of the last one applied. */
  const cardReadsRef = useRef({ started: 0, applied: 0 });
  const manifestRequestedRef = useRef(false);
  /** A session the operator opened by hand stays open after it ends, so its transcript can be read. */
  const pinnedRef = useRef<string | null>(null);

  const fetchFrames = useCallback(async () => {
    const tail = tailRef.current;
    if (!tail.sessionId || !openRef.current) return;
    if (tail.inFlight) { tail.again = true; return; }
    tail.inFlight = true;
    const sessionId = tail.sessionId;
    const body = await getJson<{ frames: SidecarFrame[]; cursor: number; running: boolean }>(
      `${sessionsPath()}/${encodeURIComponent(sessionId)}/frames?after=${tail.cursor}`,
    );
    // A switch of session while this was in flight started a new tail.
    if (tailRef.current !== tail) return;
    tail.inFlight = false;
    if (!mountedRef.current) return;
    if (body) {
      tail.cursor = Math.max(tail.cursor, body.cursor);
      setFrames((prev) => mergeFrames(prev, body.frames));
      setRunning(body.running);
    }
    if (tail.again) {
      tail.again = false;
      void fetchFrames();
    }
  }, []);

  const follow = useCallback((next: SidecarSession | null, isRunning: boolean) => {
    setSession(next);
    setRunning(isRunning);
    if (tailRef.current.sessionId === (next?.id ?? null)) return;
    tailRef.current = newTail(next?.id ?? null);
    setFrames([]);
    // The server keeps how the last turn ended, so a reload or second tab sees it.
    setLastTurn(next?.lastTurn ?? null);
    void fetchFrames();
  }, [fetchFrames]);

  /**
   * Read the cards of every live session, and of the open one even if it has
   * ended. Reads overlap when cards settle quickly; a read that lands after a
   * later-started read has already applied is dropped, so the badge never
   * goes back to a stale count.
   */
  const fetchWaiting = useCallback(async () => {
    const reads = cardReadsRef.current;
    const read = ++reads.started;
    const list = await getJson<{ sessions: SidecarSessionEntry[] }>(sessionsPath());
    if (!list || !mountedRef.current) return;
    const open = tailRef.current.sessionId;
    const ids = list.sessions.filter((e) => !e.session.endedAt || e.session.id === open).map((e) => e.session.id);
    const cards = await Promise.all(ids.map(async (id) => {
      const body = await getJson<{ cards: SidecarCard[] }>(`${sessionsPath()}/${encodeURIComponent(id)}/cards`);
      return [id, body ? orderCards(body.cards) : []] as const;
    }));
    if (!mountedRef.current || read < reads.applied) return;
    reads.applied = read;
    setCardsBySession(Object.fromEntries(cards));
  }, []);

  const loadSessions = useCallback(async () => {
    const list = await getJson<{ sessions: SidecarSessionEntry[] }>(sessionsPath());
    if (!list || !mountedRef.current) return;
    // Keep the open session while it is still open; otherwise take the latest.
    const current = tailRef.current.sessionId;
    const kept = current
      ? list.sessions.find((e) => e.session.id === current && (!e.session.endedAt || pinnedRef.current === current))
      : undefined;
    const entry = kept ?? pickOpenSession(list.sessions);
    follow(entry?.session ?? null, entry?.running ?? false);
    void fetchWaiting();
  }, [follow, fetchWaiting]);

  // The socket: badge on cards, tail on frames.
  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return () => { mountedRef.current = false; };
    void fetchWaiting();

    let ws: WebSocket | null = null;
    const pipeline = createWSPipeline({
      workspace: getWorkspaceKey(),
      onFlush: (batch) => {
        if (!mountedRef.current) return;
        if (batch.types.has("sidecar:card")) void fetchWaiting();
        const current = tailRef.current.sessionId;
        let fetchDue = false;
        for (const msg of batch.messages) {
          if (msg.type !== "sidecar:frames" || msg.sessionId !== current) continue;
          if (typeof msg.cursor === "number" && msg.cursor > tailRef.current.cursor) fetchDue = true;
          setRunning(msg.running === true);
          if (msg.running === false) {
            setLastTurn({
              status: typeof msg.status === "string" ? msg.status : "completed",
              ...(typeof msg.error === "string" && { error: msg.error }),
              ...(msg.signedOut === true && { signedOut: true as const }),
            });
          }
        }
        if (fetchDue) void fetchFrames();
      },
      // Nothing throttled (undefined would throttle every type): the
      // coalescer's short window is the only delay before a fetch.
      throttledTypes: [],
      coalescerWindowMs: 100,
    });
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = RECONNECT_FIRST_MS;

    const connect = (isReconnect: boolean): void => {
      if (typeof WebSocket === "undefined") return; // no socket: the drawer still reads when it opens
      try {
        ws = openWebSocket(endpointRef.current.socketUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      ws.onopen = () => {
        reconnectDelay = RECONNECT_FIRST_MS;
        // Announcements sent while the socket was down are gone: catch up now.
        if (isReconnect && mountedRef.current) {
          void fetchWaiting();
          void fetchFrames();
        }
      };
      ws.onclose = () => {
        ws = null;
        if (!stopped) scheduleReconnect();
      };
      ws.onmessage = (event) => {
        try {
          pipeline.push(JSON.parse(event.data));
        } catch {
          // A malformed frame: the next announcement carries the cursor again.
        }
      };
    };

    const scheduleReconnect = (): void => {
      if (stopped || reconnectTimer !== null) return;
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect(true);
      }, delay);
    };

    connect(false);
    return () => {
      stopped = true;
      mountedRef.current = false;
      pipeline.dispose();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
    };
  }, [enabled, fetchWaiting, fetchFrames]);

  // Opening the drawer picks the session and reads the frames it has not drawn.
  useEffect(() => {
    if (!enabled || !open) return;
    if (tailRef.current.sessionId) void fetchFrames();
    void loadSessions();
    const pinned = endpointRef.current.fixed;
    if (pinned) {
      // No picker: the server's default model for the one vendor the session runs on.
      setPicked((prev) => prev ?? { vendor: pinned.vendor, model: "" });
      return;
    }
    void (async () => {
      // The server caches the CLI probe for minutes; a CLI last seen missing is
      // probed again, so installing it and reopening the drawer clears state A.
      const cliMissing = Object.values(catalogRef.current ?? {}).some((entry) => entry.cliFound === false);
      const [loaded, vendor] = await Promise.all([loadCatalog(cliMissing), defaultVendor()]);
      if (!mountedRef.current) return;
      if (loaded) setCatalog(loaded);
      setPicked((prev) => prev ?? { vendor, model: loaded?.[vendor]?.defaultModel ?? "" });
    })();
  }, [enabled, open, loadSessions, fetchFrames]);

  /** Create a session on `agent` and follow it; null, with the error set, when the server refuses. */
  const createSession = useCallback(async (agent: SidecarAgent): Promise<SidecarSession | null> => {
    const { lens, item } = attachmentRef.current;
    const fixedLens = endpointRef.current.fixed?.lens;
    const created = await postJson<SidecarSessionEntry>(sessionsPath(), {
      vendor: agent.vendor,
      ...(agent.model && { model: agent.model }),
      ...(fixedLens
        ? { lens: fixedLens }
        : {
            ...(lens.running !== GENERAL_LENS && { lens: lens.running }),
            ...(item?.ref && { target: { ref: item.ref } }),
          }),
    });
    if (!created.ok) { setError(created.error); return null; }
    follow(created.data.session, created.data.running);
    return created.data.session;
  }, [follow]);

  const chooseAgent = useCallback(async (vendor: string, model?: string) => {
    const next: SidecarAgent = { vendor, model: model ?? catalog?.[vendor]?.defaultModel ?? "" };
    setPicked(next);
    setError(null);
    const open = sessionRef.current;
    if (!open || (open.vendor === next.vendor && (open.model ?? "") === next.model)) return;
    await createSession(next);
  }, [catalog, createSession]);

  const send = useCallback(async (prompt: string): Promise<boolean> => {
    const text = prompt.trim();
    if (!text) return false;
    setSending(true);
    setError(null);
    try {
      let id = tailRef.current.sessionId;
      if (!id) {
        const vendor = endpointRef.current.fixed?.vendor ?? await defaultVendor();
        const created = await createSession(pickedRef.current ?? { vendor, model: "" });
        if (!created) return false;
        id = created.id;
      }
      const started = await postJson<SidecarSessionEntry>(`${sessionsPath()}/${encodeURIComponent(id)}/turns`, { prompt: text });
      if (!started.ok) { setError(started.error); return false; }
      setSession(started.data.session);
      setRunning(true);
      setLastTurn(null);
      void fetchFrames();
      return true;
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [createSession, fetchFrames]);

  const newSession = useCallback(async (): Promise<boolean> => {
    setSending(true);
    setError(null);
    try {
      const vendor = endpointRef.current.fixed?.vendor ?? await defaultVendor();
      return (await createSession(pickedRef.current ?? { vendor, model: "" })) !== null;
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [createSession]);

  const reportError = useCallback((message: string) => setError(message), []);

  const stop = useCallback(async () => {
    const id = tailRef.current.sessionId;
    if (!id) return;
    const res = await postJson<{ interrupted: boolean }>(`${sessionsPath()}/${encodeURIComponent(id)}/interrupt`, {});
    if (!res.ok) setError(res.error);
  }, []);

  // The open session follows the attachment: the page item is its target and
  // the lens it runs is the one the chip shows (General while that lens is not
  // available yet). One PATCH per change; an ended session is left alone.
  // Not before the registry answers: until then every lens reads as
  // unavailable, and the session would be re-lensed to General and back.
  // A fixed lens is the session's for good: nothing on the page re-lenses it.
  const asks = !fixed && attachment.asks && attachment.ready;
  const wantLens = attachment.lens.running;
  const wantRef = attachment.item?.ref ?? "";
  const heldLens = session?.lens ?? GENERAL_LENS;
  const heldRef = session?.target?.ref ?? "";
  const openId = session && !session.endedAt ? session.id : null;
  const syncKey = `${openId}|${wantLens}|${wantRef}`;
  const syncedRef = useRef("");
  // Why the open session last refused to follow the attachment; cleared when the attachment or session moves on.
  const [followError, setFollowError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !open || !openId || !asks || syncedRef.current === syncKey) return;
    syncedRef.current = syncKey;
    const fields: { lens?: string; target?: { ref?: string } } = {};
    if (wantLens !== heldLens) fields.lens = wantLens;
    if (wantRef !== heldRef) fields.target = wantRef ? { ref: wantRef } : {};
    setFollowError(null);
    if (Object.keys(fields).length === 0) return;
    void patchJson<SidecarSessionEntry>(`${sessionsPath()}/${encodeURIComponent(openId)}`, fields).then((res) => {
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(res.error);
        if (syncedRef.current === syncKey) setFollowError(res.error);
        return;
      }
      if (res.data.session.id === tailRef.current.sessionId) setSession(res.data.session);
    });
  }, [enabled, open, asks, syncKey, openId, wantLens, wantRef, heldLens, heldRef]);

  const decide = useCallback(async (cardId: string, decision: SidecarCardDecision): Promise<boolean> => {
    const id = tailRef.current.sessionId;
    if (!id) return false;
    const reason = decision.reason?.trim();
    const res = await postJson<{ card: SidecarCard }>(
      `${sessionsPath()}/${encodeURIComponent(id)}/cards/${encodeURIComponent(cardId)}`,
      {
        decision: decision.approve ? "approve" : "deny",
        ...(reason && { reason }),
        ...(decision.remember && { remember: true }),
        // An empty list of change-set edits is no edit; a placement's edit is one object.
        ...(decision.approve && decision.edits && (!Array.isArray(decision.edits) || decision.edits.length > 0) && { edits: decision.edits }),
        ...(decision.approve && decision.reviewed && { reviewed: decision.reviewed }),
        ...(decision.approve && decision.lane !== undefined && { lane: decision.lane }),
        ...(decision.approve && decision.path !== undefined && { path: decision.path }),
        ...(decision.approve && decision.arguments !== undefined && { arguments: decision.arguments }),
      },
    );
    if (!mountedRef.current) return res.ok;
    setError(res.ok ? null : res.error);
    // The settle is also announced on the socket; reading before returning
    // keeps the card from looking undecided until that arrives, so a second
    // ⌘↵ in the meantime cannot answer the same card again.
    await fetchWaiting();
    return res.ok;
  }, [fetchWaiting]);

  const openSession = useCallback(async (id: string): Promise<boolean> => {
    const list = await getJson<{ sessions: SidecarSessionEntry[] }>(sessionsPath());
    if (!mountedRef.current) return false;
    const entry = list?.sessions.find((e) => e.session.id === id);
    if (!entry) { setError(`Session ${id} is no longer available`); return false; }
    setError(null);
    pinnedRef.current = id;
    follow(entry.session, entry.running);
    void fetchWaiting();
    return true;
  }, [follow, fetchWaiting]);

  /** A rename or end answered: the drawer's own copy of the session follows. */
  const sessionChanged = useCallback((entry: SidecarSessionEntry) => {
    if (entry.session.id === tailRef.current.sessionId) setSession(entry.session);
  }, []);

  const sessions = useSidecarSessions({
    waitingBySession: Object.fromEntries(Object.entries(cardsBySession).map(([id, list]) => [id, waitingCards(list)])),
    onChanged: sessionChanged,
  });

  const waiting = Object.values(cardsBySession).reduce((sum, list) => sum + waitingCards(list), 0);
  const cards = session ? cardsBySession[session.id] ?? [] : [];
  const sessionWaiting = waitingCards(cards);

  // A command card draws the effects its ndx command declares; read the
  // manifest once, the first time the open session shows one.
  const hasCommandCard = open && cards.some((c) => c.kind === "command");
  useEffect(() => {
    if (!hasCommandCard || manifestRequestedRef.current) return;
    manifestRequestedRef.current = true;
    setCommandManifest("loading");
    void loadCommandManifest().then((loaded) => {
      if (mountedRef.current) setCommandManifest(loaded ?? "unavailable");
    });
  }, [hasCommandCard]);

  const agent: SidecarAgent | null = session
    ? { vendor: session.vendor, model: session.model ?? catalog?.[session.vendor]?.defaultModel ?? "" }
    : picked;

  return {
    session, frames, running, sending, waiting, sessionWaiting, cards, commandManifest, decide,
    readOnly: session?.endedAt !== undefined, sessions, openSession,
    lastTurn, error, agent, catalog, chooseAgent, send, newSession, reportError, stop, attachment, followError,
  };
}

// ---------------------------------------------------------------------------
// The shell's one entry point
// ---------------------------------------------------------------------------

const NO_PAGE: SidecarPageSelection = { view: "home", zone: null, taskId: null };

export interface SidecarShell {
  drawer: SidecarDrawerState;
  sidecar: SidecarState;
  /** Props for the top-nav button; null while disabled, so it does not render. */
  button: { open: boolean; waiting: number; onToggle: () => void } | null;
}

/**
 * The session `?sidecar=<id>` names: the hub's "Open in worktree sidecar"
 * sends the operator to this dashboard with the session it handed off to.
 */
export function handedOffSessionParam(search: string): string | null {
  const id = new URLSearchParams(search).get("sidecar");
  return id && /^[\w-]+$/.test(id) ? id : null;
}

/**
 * `enabled`: `web.sidecar`, read by main.ts through `useFeatureToggle`, and a
 * server to hold a session (not a static export). A page loaded with
 * `?sidecar=<id>` opens the drawer on that session once enabled.
 */
export function useSidecarShell(enabled: boolean, page: SidecarPageSelection = NO_PAGE): SidecarShell {
  const drawer = useSidecarDrawerState(enabled);
  const sidecar = useSidecar(enabled, drawer.open, page);
  const handedOffRef = useRef(typeof location === "undefined" ? null : handedOffSessionParam(location.search));
  const { show } = drawer;
  const { openSession } = sidecar;
  useEffect(() => {
    const id = handedOffRef.current;
    if (!enabled || !id) return;
    handedOffRef.current = null;
    show();
    void openSession(id);
  }, [enabled, show, openSession]);
  const button = enabled ? { open: drawer.open, waiting: sidecar.waiting, onToggle: drawer.toggle } : null;
  return { drawer, sidecar, button };
}

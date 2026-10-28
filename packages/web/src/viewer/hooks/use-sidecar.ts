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
import { createWSPipeline } from "./use-gateway.js";

// ---------------------------------------------------------------------------
// Shape — mirrors server/routes-sidecar.ts and server/sidecar/session-registry.ts
// ---------------------------------------------------------------------------

export interface SidecarSession {
  id: string;
  name: string;
  vendor: string;
  model?: string;
  lens?: string;
  cursor: number;
  turns: number;
  createdAt: string;
  lastActivityAt: string;
  endedAt?: string;
}

export interface SidecarSessionEntry {
  session: SidecarSession;
  running: boolean;
}

/** The parts of a vendor runtime event the transcript draws. */
export interface SidecarRuntimeEvent {
  type: "assistant" | "tool_use" | "tool_result" | "completion" | "failure" | "token_usage";
  text?: string;
  toolCall?: { tool: string; input: Record<string, unknown> };
  toolResult?: { tool: string; output: string; durationMs: number };
  failure?: { message?: string };
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
  | "placement"
  | "edit"
  | "network-read"
  | "draft-post"
  | "migration-decision";

/** A permission card; mirrors `SidecarCard` in server/sidecar/broker.ts. */
export interface SidecarCard {
  id: string;
  sessionId: string;
  tool: string;
  kind: SidecarCardKind;
  input: Record<string, unknown>;
  /** Set when "always allow" may be offered. */
  allowListKey: string | null;
  status: "pending" | "approved" | "denied" | "withdrawn";
  raisedAt: string;
  decidedAt?: string;
  reason?: string;
  /** Approved with "always allow". */
  remembered?: true;
}

/** The operator's answer to the first waiting card. */
export interface SidecarCardDecision {
  approve: boolean;
  /** A deny's note, sent to the agent as the reason. */
  reason?: string;
  /** "Always allow": only when the card has an allowListKey. */
  remember?: boolean;
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
}

/** How the last turn ended, from the announcement that closed it. */
export interface SidecarTurnEnd {
  status: string;
  error?: string;
}

const SESSIONS = "/api/sidecar/sessions";
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
export type SidecarCatalog = Record<string, { models: string[]; defaultModel: string }>;

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

/** POST a JSON body; the parsed answer, or the server's error text. */
async function postJson<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
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
async function loadCatalog(): Promise<SidecarCatalog | null> {
  const body = await getJson<Record<string, { models?: string[]; defaultModel?: string } | undefined>>("/api/llm/catalog");
  if (!body) return null;
  const catalog: SidecarCatalog = {};
  for (const vendor of SIDECAR_VENDORS) {
    const entry = body[vendor];
    if (entry?.models) catalog[vendor] = { models: entry.models, defaultModel: entry.defaultModel ?? entry.models[0] ?? "" };
  }
  return catalog;
}

/** Command effects from GET /api/commands/manifest; null when the route does not answer. */
async function loadCommandManifest(): Promise<SidecarCommandManifest | null> {
  const body = await getJson<{
    cliName?: string;
    groups?: Array<{ commands?: Array<{ name: string; effects?: SidecarCommandEffects | null }> }>;
  }>("/api/commands/manifest");
  if (!body) return null;
  const effects: SidecarCommandManifest["effects"] = {};
  for (const group of body.groups ?? []) {
    for (const cmd of group.commands ?? []) effects[cmd.name] = cmd.effects ?? null;
  }
  const cliNames = [...new Set(["ndx", "n-dx", ...(body.cliName ? [body.cliName] : [])])];
  return { cliNames, effects };
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
  close: () => void;
}

/** Open/closed state; ⌘J toggles it on every page while `enabled`. Closed whenever disabled. */
export function useSidecarDrawerState(enabled: boolean): SidecarDrawerState {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
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

  return { open: enabled && open, toggle, close };
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
  /** Cards waiting in the open session. */
  sessionWaiting: number;
  /** The open session's cards, oldest first. */
  cards: SidecarCard[];
  /**
   * Command effects for command cards: null until the open session has one;
   * `unavailable` when the manifest could not be read (read once per page load).
   */
  commandManifest: SidecarCommandManifest | "loading" | "unavailable" | null;
  /** Decide the open session's first waiting card. */
  decide: (cardId: string, decision: SidecarCardDecision) => Promise<void>;
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
  stop: () => Promise<void>;
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

const newTail = (sessionId: string | null): Tail => ({ sessionId, cursor: 0, inFlight: false, again: false });

export function useSidecar(enabled: boolean, open: boolean): SidecarState {
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
  const openRef = useRef(open);
  openRef.current = open;
  const tailRef = useRef<Tail>(newTail(null));
  /** Card reads: the number of the last one started, and of the last one applied. */
  const cardReadsRef = useRef({ started: 0, applied: 0 });
  const manifestRequestedRef = useRef(false);

  const fetchFrames = useCallback(async () => {
    const tail = tailRef.current;
    if (!tail.sessionId || !openRef.current) return;
    if (tail.inFlight) { tail.again = true; return; }
    tail.inFlight = true;
    const sessionId = tail.sessionId;
    const body = await getJson<{ frames: SidecarFrame[]; cursor: number; running: boolean }>(
      `${SESSIONS}/${encodeURIComponent(sessionId)}/frames?after=${tail.cursor}`,
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
    setLastTurn(null);
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
    const list = await getJson<{ sessions: SidecarSessionEntry[] }>(SESSIONS);
    if (!list || !mountedRef.current) return;
    const open = tailRef.current.sessionId;
    const ids = list.sessions.filter((e) => !e.session.endedAt || e.session.id === open).map((e) => e.session.id);
    const cards = await Promise.all(ids.map(async (id) => {
      const body = await getJson<{ cards: SidecarCard[] }>(`${SESSIONS}/${encodeURIComponent(id)}/cards`);
      return [id, body ? orderCards(body.cards) : []] as const;
    }));
    if (!mountedRef.current || read < reads.applied) return;
    reads.applied = read;
    setCardsBySession(Object.fromEntries(cards));
  }, []);

  const loadSessions = useCallback(async () => {
    const list = await getJson<{ sessions: SidecarSessionEntry[] }>(SESSIONS);
    if (!list || !mountedRef.current) return;
    // Keep the open session while it is still open; otherwise take the latest.
    const current = tailRef.current.sessionId;
    const kept = current ? list.sessions.find((e) => e.session.id === current && !e.session.endedAt) : undefined;
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
    try {
      ws = new WebSocket(getWebSocketUrl());
      ws.onmessage = (event) => {
        try {
          pipeline.push(JSON.parse(event.data));
        } catch {
          // A malformed frame: the next announcement carries the cursor again.
        }
      };
    } catch {
      // No socket: the drawer still reads the transcript when it opens.
    }
    return () => {
      mountedRef.current = false;
      pipeline.dispose();
      ws?.close();
    };
  }, [enabled, fetchWaiting, fetchFrames]);

  // Opening the drawer picks the session and reads the frames it has not drawn.
  useEffect(() => {
    if (!enabled || !open) return;
    if (tailRef.current.sessionId) void fetchFrames();
    void loadSessions();
    void (async () => {
      const [loaded, vendor] = await Promise.all([loadCatalog(), defaultVendor()]);
      if (!mountedRef.current) return;
      if (loaded) setCatalog(loaded);
      setPicked((prev) => prev ?? { vendor, model: loaded?.[vendor]?.defaultModel ?? "" });
    })();
  }, [enabled, open, loadSessions, fetchFrames]);

  /** Create a session on `agent` and follow it; null, with the error set, when the server refuses. */
  const createSession = useCallback(async (agent: SidecarAgent): Promise<SidecarSession | null> => {
    const created = await postJson<SidecarSessionEntry>(SESSIONS, {
      vendor: agent.vendor,
      ...(agent.model && { model: agent.model }),
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
        const created = await createSession(pickedRef.current ?? { vendor: await defaultVendor(), model: "" });
        if (!created) return false;
        id = created.id;
      }
      const started = await postJson<SidecarSessionEntry>(`${SESSIONS}/${encodeURIComponent(id)}/turns`, { prompt: text });
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

  const stop = useCallback(async () => {
    const id = tailRef.current.sessionId;
    if (!id) return;
    const res = await postJson<{ interrupted: boolean }>(`${SESSIONS}/${encodeURIComponent(id)}/interrupt`, {});
    if (!res.ok) setError(res.error);
  }, []);

  const decide = useCallback(async (cardId: string, decision: SidecarCardDecision) => {
    const id = tailRef.current.sessionId;
    if (!id) return;
    const reason = decision.reason?.trim();
    const res = await postJson<{ card: SidecarCard }>(
      `${SESSIONS}/${encodeURIComponent(id)}/cards/${encodeURIComponent(cardId)}`,
      {
        decision: decision.approve ? "approve" : "deny",
        ...(reason && { reason }),
        ...(decision.remember && { remember: true }),
      },
    );
    if (!mountedRef.current) return;
    setError(res.ok ? null : res.error);
    // The settle is also announced on the socket; reading before returning
    // keeps the card from looking undecided until that arrives, so a second
    // ⌘↵ in the meantime cannot answer the same card again.
    await fetchWaiting();
  }, [fetchWaiting]);

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
    lastTurn, error, agent, catalog, chooseAgent, send, stop,
  };
}

// ---------------------------------------------------------------------------
// The shell's one entry point
// ---------------------------------------------------------------------------

export interface SidecarShell {
  drawer: SidecarDrawerState;
  sidecar: SidecarState;
  /** Props for the top-nav button; null while disabled, so it does not render. */
  button: { open: boolean; waiting: number; onToggle: () => void } | null;
}

/**
 * `enabled`: `web.sidecar`, read by main.ts through `useFeatureToggle`, and a
 * server to hold a session (not a static export).
 */
export function useSidecarShell(enabled: boolean): SidecarShell {
  const drawer = useSidecarDrawerState(enabled);
  const sidecar = useSidecar(enabled, drawer.open);
  const button = enabled ? { open: drawer.open, waiting: sidecar.waiting, onToggle: drawer.toggle } : null;
  return { drawer, sidecar, button };
}

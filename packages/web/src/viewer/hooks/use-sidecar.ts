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
 * A `sidecar:card` message refetches the waiting-card count, which is summed
 * across every open session in this worktree.
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

export interface SidecarCard {
  id: string;
  sessionId: string;
  status: "pending" | "approved" | "denied" | "withdrawn";
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
  const [waitingBySession, setWaitingBySession] = useState<Record<string, number>>({});
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

  const fetchWaiting = useCallback(async () => {
    const list = await getJson<{ sessions: SidecarSessionEntry[] }>(SESSIONS);
    if (!list || !mountedRef.current) return;
    const live = list.sessions.filter((e) => !e.session.endedAt);
    const counts = await Promise.all(live.map(async (e) => {
      const body = await getJson<{ cards: SidecarCard[] }>(`${SESSIONS}/${encodeURIComponent(e.session.id)}/cards`);
      return [e.session.id, body ? waitingCards(body.cards) : 0] as const;
    }));
    if (mountedRef.current) setWaitingBySession(Object.fromEntries(counts));
  }, []);

  const loadSessions = useCallback(async () => {
    const list = await getJson<{ sessions: SidecarSessionEntry[] }>(SESSIONS);
    if (!list || !mountedRef.current) return;
    // Keep the open session while it is still open; otherwise take the latest.
    const current = tailRef.current.sessionId;
    const kept = current ? list.sessions.find((e) => e.session.id === current && !e.session.endedAt) : undefined;
    const entry = kept ?? pickOpenSession(list.sessions);
    follow(entry?.session ?? null, entry?.running ?? false);
  }, [follow]);

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

  const waiting = Object.values(waitingBySession).reduce((sum, n) => sum + n, 0);
  const sessionWaiting = session ? waitingBySession[session.id] ?? 0 : 0;

  const agent: SidecarAgent | null = session
    ? { vendor: session.vendor, model: session.model ?? catalog?.[session.vendor]?.defaultModel ?? "" }
    : picked;

  return { session, frames, running, sending, waiting, sessionWaiting, lastTurn, error, agent, catalog, chooseAgent, send, stop };
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

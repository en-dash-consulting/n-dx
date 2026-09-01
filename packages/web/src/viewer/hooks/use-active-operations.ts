/**
 * Aggregates every long-running dashboard action into one list, for the
 * persistent "active operations" tray (components/active-operations-tray.ts).
 *
 * Two different underlying patterns get normalized here:
 *
 *  - Six actions (sourcevision full analysis, self-heal, ndx ci, rex
 *    reshape, refresh, Project Scan) are server-side singletons that flip
 *    `running: true/false` and persist their last result until the next
 *    run — plain polling is reliable since they never disappear between
 *    ticks.
 *  - Hench task execution is a *map* of concurrently-active runs, and the
 *    server deletes an entry from that map right after broadcasting its
 *    terminal state — a poll tick can miss a fast completion entirely
 *    between two polls. This one is tracked primarily via the
 *    `hench:task-execution-progress` WebSocket broadcast (mirrors
 *    use-hench-runs-live-refresh.ts), with a one-time status fetch on
 *    mount to catch a run already in flight before the page loaded.
 *
 * No numeric percentage: none of the underlying status shapes expose a
 * computable fraction. `detail` carries the best available progress text
 * instead (elapsed time, last output line, phase, iteration count).
 */

import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import { usePolling } from "../views/use-polling.js";
import { createWSPipeline } from "./use-gateway.js";
import { useCliName, resolveCliLabel } from "./use-project-metadata.js";

export type ActiveOperationKind =
  | "hench" | "sv-analyze" | "self-heal" | "ci" | "reshape" | "refresh" | "analyze";

export interface ActiveOperation {
  /** Stable key: `${kind}:${taskId ?? "singleton"}`. */
  id: string;
  kind: ActiveOperationKind;
  label: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  detail?: string;
  error?: string | null;
}

/** How long a done/failed entry stays visible after finishing. */
const FINISHED_RETENTION_MS = 10_000;
const POLL_INTERVAL_MS = 3_000;

// ── Poll-based singleton parsers ───────────────────────────────────────

interface SingletonWire {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error?: string | null;
  [key: string]: unknown;
}

interface SingletonSource {
  kind: ActiveOperationKind;
  url: string;
  label: string;
  detail: (wire: SingletonWire) => string | undefined;
}

const SINGLETON_SOURCES: SingletonSource[] = [
  {
    kind: "sv-analyze",
    url: "/api/commands/sv-analyze/status",
    label: "Full codebase analysis",
    detail: (w) => lastLine(w.recentOutput as string | undefined),
  },
  {
    kind: "self-heal",
    url: "/api/commands/self-heal/status",
    label: "Self-heal",
    detail: (w) => lastLine(w.output as string | undefined) ?? `${w.iterations ?? "?"} iteration(s)`,
  },
  {
    kind: "ci",
    url: "/api/commands/ci/status",
    label: "{cli} ci",
    detail: (w) => lastLine(w.output as string | undefined),
  },
  {
    kind: "reshape",
    url: "/api/commands/reshape/status",
    label: "Reshape PRD",
    detail: (w) => lastLine(w.output as string | undefined),
  },
  {
    kind: "refresh",
    url: "/api/commands/refresh/status",
    label: "Refresh",
    detail: (w) => (Array.isArray(w.phases) && w.phases.length > 0 ? String(w.phases[w.phases.length - 1]) : undefined),
  },
  {
    kind: "analyze",
    url: "/api/rex/analyze/status",
    label: "Project Scan",
    detail: (w) => lastLine(w.output as string | undefined),
  },
];

function lastLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text.trim().split("\n").filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

function parseSingleton(source: SingletonSource, wire: SingletonWire, cliName: string): ActiveOperation | null {
  if (!wire.running && !wire.finishedAt) return null;
  return {
    id: `${source.kind}:singleton`,
    kind: source.kind,
    label: resolveCliLabel(source.label, cliName),
    status: wire.running ? "running" : wire.error ? "failed" : "done",
    startedAt: wire.startedAt ?? new Date().toISOString(),
    finishedAt: wire.finishedAt,
    detail: source.detail(wire),
    error: wire.error ?? null,
  };
}

// ── Hench execution (WebSocket-driven) ─────────────────────────────────

interface HenchExecutionWire {
  taskId: string;
  taskTitle: string;
  status: "starting" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  lastOutput?: string;
  error?: string;
}

function parseHenchExecution(wire: HenchExecutionWire): ActiveOperation {
  return {
    id: `hench:${wire.taskId}`,
    kind: "hench",
    label: wire.taskTitle,
    status: wire.status === "failed" ? "failed" : wire.status === "completed" ? "done" : "running",
    startedAt: wire.startedAt,
    finishedAt: wire.finishedAt ?? null,
    detail: wire.status === "starting" ? "Starting…" : wire.lastOutput,
    error: wire.error ?? null,
  };
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useActiveOperations(): ActiveOperation[] {
  const [bySingleton, setBySingleton] = useState<Map<string, ActiveOperation>>(new Map());
  const [byHench, setByHench] = useState<Map<string, ActiveOperation>>(new Map());
  // Remembers (kind → startedAt) pairs already shown to completion, so a
  // stale finished status served by a later poll doesn't reappear.
  const dismissedRef = useRef<Map<string, string>>(new Map());
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // pollSingletons is memoized with stable [] deps (registered once with
  // usePolling), so the current cliName reaches it via a ref rather than a
  // dependency.
  const cliName = useCliName();
  const cliNameRef = useRef(cliName);
  cliNameRef.current = cliName;

  const pollSingletons = useCallback(async () => {
    const results = await Promise.all(
      SINGLETON_SOURCES.map(async (source) => {
        try {
          const res = await fetch(source.url);
          if (!res.ok) return null;
          const wire = await res.json() as SingletonWire;
          return parseSingleton(source, wire, cliNameRef.current);
        } catch {
          return null;
        }
      }),
    );
    if (!mountedRef.current) return;

    setBySingleton((prev) => {
      const next = new Map(prev);
      for (const source of SINGLETON_SOURCES) {
        next.delete(`${source.kind}:singleton`);
      }
      for (const op of results) {
        if (!op) continue;
        if (dismissedRef.current.get(op.kind) === op.startedAt) continue;
        next.set(op.id, op);
      }
      return next;
    });
  }, []);

  usePolling("active-operations", pollSingletons, POLL_INTERVAL_MS);

  // Hench: one-time catch-up fetch on mount, then live via WebSocket.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/hench/execute/status");
        if (!res.ok || !mountedRef.current) return;
        const data = await res.json() as { executions: HenchExecutionWire[] };
        setByHench((prev) => {
          const next = new Map(prev);
          for (const wire of data.executions) {
            const op = parseHenchExecution(wire);
            next.set(op.id, op);
          }
          return next;
        });
      } catch {
        // Live updates still work if this fails.
      }
    })();

    let ws: WebSocket | null = null;
    const pipeline = createWSPipeline({
      onMessage: (msg) => {
        if (!mountedRef.current) return;
        if (msg.type !== "hench:task-execution-progress" || !msg.state) return;
        const op = parseHenchExecution(msg.state as HenchExecutionWire);
        setByHench((prev) => {
          const next = new Map(prev);
          next.set(op.id, op);
          return next;
        });
      },
      onFlush: () => { /* no batched refetch needed — messages are applied directly */ },
      defaultDelayMs: 0,
      throttledTypes: [],
    });

    try {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${location.host}`);
      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        try {
          pipeline.push(JSON.parse(event.data));
        } catch {
          // ignore malformed messages
        }
      };
    } catch {
      // Polling-based sources still work if WebSocket is unavailable.
    }

    return () => {
      pipeline.dispose();
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  // Sweep finished entries out after the retention window, and remember
  // them as dismissed so a later poll/broadcast can't resurrect the same
  // (kind, startedAt) run.
  useEffect(() => {
    const all = [...bySingleton.values(), ...byHench.values()];
    const timers = all
      .filter((op) => op.status !== "running" && op.finishedAt)
      .map((op) => {
        const elapsed = Date.now() - new Date(op.finishedAt!).getTime();
        const remaining = Math.max(0, FINISHED_RETENTION_MS - elapsed);
        return setTimeout(() => {
          dismissedRef.current.set(op.kind, op.startedAt);
          if (op.kind === "hench") {
            setByHench((prev) => {
              const next = new Map(prev);
              next.delete(op.id);
              return next;
            });
          } else {
            setBySingleton((prev) => {
              const next = new Map(prev);
              next.delete(op.id);
              return next;
            });
          }
        }, remaining);
      });
    return () => timers.forEach(clearTimeout);
  }, [bySingleton, byHench]);

  return [...bySingleton.values(), ...byHench.values()].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
}

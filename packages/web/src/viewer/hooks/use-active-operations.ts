/**
 * Aggregates every long-running dashboard action into one list, for the
 * persistent job tray (components/active-operations-tray.ts).
 *
 * This is the dashboard's *only* tracker for these jobs. Commands, Overview
 * and Suggestions used to each run their own `setInterval` against the same
 * status endpoints, which meant a job was only visible from the view that
 * started it, offered Stop in one case out of seven, and vanished from the UI
 * the moment you navigated away while still running server-side. Those views
 * now read this list — passed down from `main.ts` through `ViewRenderContext`
 * rather than by calling this hook a second time, since a second caller would
 * mean a second poller and a second WebSocket.
 *
 * Two different underlying patterns get normalized here:
 *
 *  - Seven actions (sourcevision full analysis, self-heal, ndx ci, rex
 *    reshape, refresh, recommend, Project Scan) are server-side singletons
 *    that flip `running: true/false` and persist their last result until the
 *    next run — plain polling is reliable since they never disappear between
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

import { getWebSocketUrl, getWorkspaceKey } from "../base-path.js";
import { useEffect, useRef, useState, useCallback, useMemo } from "preact/hooks";
import { usePolling } from "../views/use-polling.js";
import { createWSPipeline } from "./use-gateway.js";
import { useCliName, resolveCliLabel } from "./use-project-metadata.js";
import type { ViewId } from "../types.js";

export type ActiveOperationKind =
  | "hench" | "sv-analyze" | "self-heal" | "ci" | "reshape" | "refresh" | "analyze" | "recommend";

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
  /** True when the run ended because an operator pressed Stop. */
  stopped?: boolean;
  /** POST target that interrupts this run. */
  stopUrl: string;
  /** Where a finished run's output can be seen, and what to call the link. */
  result: { view: ViewId; label: string };
}

/** What the tray and the views that start jobs both read. */
export interface JobTray {
  operations: ActiveOperation[];
  /**
   * Re-read every status endpoint now.
   *
   * Called by a view straight after its start request returns, so a job
   * appears in the tray immediately rather than up to one poll interval
   * later. Deliberately a real fetch rather than an optimistic local entry:
   * the server has already flipped `running` by the time it answers 202, so
   * there is nothing to guess at, and nothing to reconcile if the start was
   * refused.
   */
  refresh: () => Promise<void>;
  /** Interrupt a running job. */
  stop: (op: ActiveOperation) => Promise<void>;
}

/** How long a done/failed entry stays visible after finishing. */
const FINISHED_RETENTION_MS = 10_000;
const POLL_INTERVAL_MS = 3_000;

/** The tracked job of `kind`, when there is one. */
export function findOperation(
  operations: ActiveOperation[],
  kind: ActiveOperationKind,
): ActiveOperation | undefined {
  return operations.find((op) => op.kind === kind);
}

// ── Poll-based singleton parsers ───────────────────────────────────────

interface SingletonWire {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error?: string | null;
  stopped?: boolean;
  [key: string]: unknown;
}

interface SingletonSource {
  kind: ActiveOperationKind;
  url: string;
  stopUrl: string;
  label: string;
  /** Where this job's output lands — the tray's result-card link target. */
  result: { view: ViewId; label: string };
  detail: (wire: SingletonWire) => string | undefined;
}

const SINGLETON_SOURCES: SingletonSource[] = [
  {
    kind: "sv-analyze",
    url: "/api/commands/sv-analyze/status",
    stopUrl: "/api/commands/sv-analyze/stop",
    label: "Full codebase analysis",
    result: { view: "analysis", label: "View analysis" },
    detail: (w) => lastLine(w.recentOutput as string | undefined),
  },
  {
    kind: "self-heal",
    url: "/api/commands/self-heal/status",
    stopUrl: "/api/commands/self-heal/stop",
    label: "Self-heal",
    result: { view: "prd", label: "View PRD" },
    detail: selfHealDetail,
  },
  {
    kind: "ci",
    url: "/api/commands/ci/status",
    stopUrl: "/api/commands/ci/stop",
    label: "{cli} ci",
    result: { view: "validation", label: "View report" },
    detail: (w) => lastLine(w.output as string | undefined),
  },
  {
    kind: "reshape",
    url: "/api/commands/reshape/status",
    stopUrl: "/api/commands/reshape/stop",
    label: "Reshape PRD",
    result: { view: "prd", label: "View PRD" },
    detail: (w) => lastLine(w.output as string | undefined),
  },
  {
    kind: "refresh",
    url: "/api/commands/refresh/status",
    stopUrl: "/api/commands/refresh/stop",
    label: "Refresh",
    result: { view: "analysis", label: "View analysis" },
    detail: (w) => (Array.isArray(w.phases) && w.phases.length > 0 ? String(w.phases[w.phases.length - 1]) : undefined),
  },
  {
    kind: "recommend",
    url: "/api/commands/recommend/status",
    stopUrl: "/api/commands/recommend/stop",
    label: "Refresh recommendations",
    result: { view: "suggestions", label: "View suggestions" },
    detail: recommendDetail,
  },
  {
    kind: "analyze",
    url: "/api/rex/analyze/status",
    stopUrl: "/api/rex/analyze/stop",
    label: "Project Scan",
    result: { view: "prd", label: "View PRD" },
    detail: (w) => lastLine(w.output as string | undefined),
  },
];

function lastLine(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const lines = text.trim().split("\n").filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : undefined;
}

/**
 * Where the self-heal loop currently is, from the tail of its output.
 *
 * `ndx self-heal` prints progress as it goes and the status endpoint returns
 * the tail, so the freshest matching lines describe the current position.
 * Lives here rather than in the Commands view (where it started) because the
 * tray is now the only thing watching that output — the view polled for it
 * once, and one reader of a stream should own its parser.
 */
function selfHealDetail(wire: SingletonWire): string | undefined {
  const output = wire.output as string | undefined;
  let iteration: string | null = null;
  let phase: string | null = null;
  for (const line of (output ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const iter = /iteration\s+(\d+\s*(?:\/|of)\s*\d+)/i.exec(line);
    if (iter) iteration = `iteration ${iter[1].replace(/\s*of\s*/i, "/")}`;
    const ph = /\b(analyz\w*|recommend\w*|execut\w*)\b/i.exec(line);
    if (ph) phase = ph[1].toLowerCase();
  }
  if (iteration || phase) {
    return [iteration, phase ? `phase: ${phase}` : null].filter(Boolean).join(" · ");
  }
  return lastLine(output) ?? `${wire.iterations ?? "?"} iteration(s)`;
}

/**
 * `rex recommend --format=json` reports an array, so the useful finished
 * detail is how many it found — not the last line of a JSON blob.
 */
function recommendDetail(wire: SingletonWire): string | undefined {
  const report = wire.report;
  if (Array.isArray(report)) {
    return report.length === 0
      ? "No new recommendations"
      : `${report.length} recommendation${report.length === 1 ? "" : "s"} found`;
  }
  return lastLine(wire.output as string | undefined);
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
    detail: wire.stopped ? "Stopped" : source.detail(wire),
    error: wire.error ?? null,
    stopped: wire.stopped === true,
    stopUrl: source.stopUrl,
    result: source.result,
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
    stopUrl: `/api/hench/execute/${encodeURIComponent(wire.taskId)}/terminate`,
    result: { view: "hench-runs", label: "View run" },
  };
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useActiveOperations(): JobTray {
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
      workspace: getWorkspaceKey(),
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
      ws = new WebSocket(getWebSocketUrl());
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

  /**
   * Interrupt a job, then re-read its status.
   *
   * The refresh is what turns Stop into visible feedback: the server answers
   * the stop request as soon as it has signalled the child, which is before
   * the child has actually exited, so only a re-read shows the run as
   * finished. A 409 means it finished on its own between render and click —
   * the refresh below reports that honestly, so it is not an error path.
   */
  const stop = useCallback(async (op: ActiveOperation) => {
    try {
      await fetch(op.stopUrl, { method: "POST" });
    } catch {
      // Nothing to report beyond what the refreshed status will show.
    }
    await pollSingletons();
  }, [pollSingletons]);

  const operations = useMemo(
    () => [...bySingleton.values(), ...byHench.values()].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    ),
    [bySingleton, byHench],
  );

  return { operations, refresh: pollSingletons, stop };
}

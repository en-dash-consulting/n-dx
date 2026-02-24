/**
 * Active Tasks Panel — shows currently executing tasks prominently at the
 * top of the Hench UI.
 *
 * Combines data from two sources:
 * 1. Hench runs with status "running" (from /api/hench/runs)
 * 2. Active task executions triggered via the dashboard (from /api/hench/execute/status)
 *
 * Updates in real-time via WebSocket ("hench:task-execution-progress" events)
 * and periodic polling as a fallback.
 *
 * Displays task title, start time, elapsed duration (live-ticking), and
 * health status (stale detection).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { RexTaskLink } from "./rex-task-link.js";
import type { NavigateTo } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ActiveRun {
  id: string;
  taskId: string;
  taskTitle: string;
  taskStatus?: string;
  startedAt: string;
  lastActivityAt?: string;
  status: string;
  turns: number;
  model: string;
}

interface ExecutionState {
  taskId: string;
  taskTitle: string;
  runId: string;
  status: "starting" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  lastOutput?: string;
  error?: string;
}

export interface ActiveTasksPanelProps {
  /** Running runs from the parent (from /api/hench/runs with status=running). */
  runs: ActiveRun[];
  navigateTo?: NavigateTo;
}

// ── Helpers ──────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function isStale(run: ActiveRun): boolean {
  if (!run.lastActivityAt) return true; // Legacy run
  return Date.now() - new Date(run.lastActivityAt).getTime() > STALE_THRESHOLD_MS;
}

function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 0) return "0s";
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function formatStartTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ── Active task card ─────────────────────────────────────────────────

function ActiveTaskCard({ run, navigateTo }: { run: ActiveRun; navigateTo?: NavigateTo }) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(run.startedAt));
  const stale = isStale(run);

  // Live-tick the elapsed duration every second
  useEffect(() => {
    setElapsed(formatElapsed(run.startedAt));
    const timer = setInterval(() => {
      setElapsed(formatElapsed(run.startedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [run.startedAt]);

  return h("div", {
    class: `active-task-card${stale ? " active-task-card-stale" : ""}`,
  },
    // Pulsing status indicator
    h("div", { class: "active-task-pulse-wrapper", "aria-hidden": "true" },
      h("span", { class: `active-task-pulse${stale ? " active-task-pulse-stale" : ""}` }),
    ),

    // Main content
    h("div", { class: "active-task-content" },
      // Title row
      h("div", { class: "active-task-title-row" },
        navigateTo && run.taskId
          ? h(RexTaskLink, {
              task: {
                id: run.taskId,
                title: run.taskTitle,
                status: run.taskStatus ?? "in_progress",
              },
              navigateTo,
              compact: true,
              showStatus: false,
              class: "active-task-link",
            })
          : h("span", { class: "active-task-title" }, run.taskTitle),
        stale
          ? h("span", { class: "active-task-stale-badge" }, "Possibly stuck")
          : null,
      ),

      // Metadata row
      h("div", { class: "active-task-meta" },
        h("span", { class: "active-task-elapsed", title: "Elapsed time" },
          h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "⏱"),
          elapsed,
        ),
        h("span", { class: "active-task-started", title: `Started at ${formatStartTime(run.startedAt)}` },
          h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "▶"),
          formatStartTime(run.startedAt),
        ),
        run.turns > 0
          ? h("span", { class: "active-task-turns", title: `${run.turns} turns completed` },
              h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "↻"),
              `${run.turns} turns`,
            )
          : null,
        h("span", { class: `active-task-model active-task-model-${run.model}` }, run.model),
      ),
    ),
  );
}

// ── Execution state card (for dashboard-triggered executions) ────────

function ExecutionCard({ exec }: { exec: ExecutionState }) {
  const [elapsed, setElapsed] = useState(() => formatElapsed(exec.startedAt));

  useEffect(() => {
    setElapsed(formatElapsed(exec.startedAt));
    const timer = setInterval(() => {
      setElapsed(formatElapsed(exec.startedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [exec.startedAt]);

  const isStarting = exec.status === "starting";

  return h("div", {
    class: `active-task-card${isStarting ? " active-task-card-starting" : ""}`,
  },
    h("div", { class: "active-task-pulse-wrapper", "aria-hidden": "true" },
      h("span", { class: `active-task-pulse${isStarting ? " active-task-pulse-starting" : ""}` }),
    ),
    h("div", { class: "active-task-content" },
      h("div", { class: "active-task-title-row" },
        h("span", { class: "active-task-title" }, exec.taskTitle),
        isStarting
          ? h("span", { class: "active-task-starting-badge" }, "Starting…")
          : null,
      ),
      h("div", { class: "active-task-meta" },
        h("span", { class: "active-task-elapsed", title: "Elapsed time" },
          h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "⏱"),
          elapsed,
        ),
        h("span", { class: "active-task-started", title: `Started at ${formatStartTime(exec.startedAt)}` },
          h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "▶"),
          formatStartTime(exec.startedAt),
        ),
      ),
    ),
  );
}

// ── Main panel ───────────────────────────────────────────────────────

export function ActiveTasksPanel({ runs, navigateTo }: ActiveTasksPanelProps) {
  const [executions, setExecutions] = useState<ExecutionState[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch active dashboard-triggered executions
  const fetchExecutions = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/execute/status");
      if (res.ok) {
        const data = await res.json();
        const active = (data.executions ?? []).filter(
          (e: ExecutionState) => e.status === "running" || e.status === "starting",
        );
        setExecutions(active);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // WebSocket + polling
  useEffect(() => {
    let mounted = true;
    fetchExecutions();

    // Connect to WebSocket for real-time updates
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    let ws: WebSocket | null = null;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "hench:task-execution-progress" && msg.state) {
            const state = msg.state as ExecutionState;
            setExecutions((prev) => {
              // If completed/failed, remove from the list
              if (state.status === "completed" || state.status === "failed") {
                return prev.filter((e) => e.taskId !== state.taskId);
              }
              // Update or add
              const idx = prev.findIndex((e) => e.taskId === state.taskId);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = state;
                return updated;
              }
              return [...prev, state];
            });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => { wsRef.current = null; };
    } catch {
      // WebSocket not available
    }

    // Poll as fallback every 5 seconds
    const interval = setInterval(fetchExecutions, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
      // Close WS using local reference (wsRef.current may already be null from onclose)
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
  }, [fetchExecutions]);

  // Merge: running hench runs + dashboard-triggered executions.
  // Deduplicate by taskId (hench runs take priority since they have more data).
  const runTaskIds = new Set(runs.map((r) => r.taskId));
  const uniqueExecutions = executions.filter((e) => !runTaskIds.has(e.taskId));

  const totalActive = runs.length + uniqueExecutions.length;

  // Nothing active → don't render
  if (totalActive === 0) return null;

  return h("div", {
    class: "active-tasks-panel",
    role: "region",
    "aria-label": `${totalActive} active task${totalActive === 1 ? "" : "s"}`,
  },
    h("div", { class: "active-tasks-header" },
      h("div", { class: "active-tasks-header-left" },
        h("span", { class: "active-tasks-icon", "aria-hidden": "true" }, "◐"),
        h("h3", { class: "active-tasks-title" },
          `Active Task${totalActive === 1 ? "" : "s"}`,
        ),
        h("span", { class: "active-tasks-count" }, String(totalActive)),
      ),
    ),

    h("div", { class: "active-tasks-list" },
      // Hench runs first
      ...runs.map((run) =>
        h(ActiveTaskCard, { key: run.id, run, navigateTo }),
      ),
      // Then dashboard-triggered executions that aren't already in runs
      ...uniqueExecutions.map((exec) =>
        h(ExecutionCard, { key: exec.runId, exec }),
      ),
    ),
  );
}

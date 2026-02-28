/**
 * Execution panel — epic-by-epic execution controls and progress display.
 *
 * Provides a start button, live progress bars, pause/resume controls,
 * and per-epic status indicators. Polls execution status and listens
 * for WebSocket updates.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { usePolling } from "../../hooks/use-polling.js";
import { createRequestDedup } from "../../request-dedup.js";
import { isFeatureDisabled, onDegradationChange } from "../../graceful-degradation.js";

// ── Types ────────────────────────────────────────────────────────────

interface EpicProgress {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  tasksTotal: number;
  tasksCompleted: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

interface ExecutionStatus {
  status: "idle" | "running" | "paused" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  currentEpicId?: string;
  currentEpicIndex: number;
  totalEpics: number;
  completedEpics: number;
  totalTasks: number;
  completedTasks: number;
  percentComplete: number;
  epics: EpicProgress[];
  error?: string;
}

export interface ExecutionPanelProps {
  /** Callback when execution changes PRD state (triggers dashboard refresh). */
  onPrdChanged?: () => void;
}

// ── Status config ────────────────────────────────────────────────────

const EPIC_STATUS_ICONS: Record<string, string> = {
  pending: "○",
  running: "◐",
  completed: "●",
  skipped: "◌",
  failed: "✕",
};

const EPIC_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  running: "Running",
  completed: "Completed",
  skipped: "Skipped",
  failed: "Failed",
};

// ── Component ────────────────────────────────────────────────────────

export function ExecutionPanel({ onPrdChanged }: ExecutionPanelProps) {
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Track memory-pressure state reactively so usePolling's `enabled`
  // parameter updates when the degradation tier changes.
  const [autoRefreshDisabled, setAutoRefreshDisabled] = useState(
    () => isFeatureDisabled("autoRefresh")
  );

  useEffect(() => {
    const unsubscribe = onDegradationChange((state) => {
      setAutoRefreshDisabled(state.disabledFeatures.has("autoRefresh"));
    });
    return unsubscribe;
  }, []);

  // ── Fetch execution status (deduplicated) ──────────────────────────
  //
  // Wrapped with request deduplication: concurrent callers (e.g. a
  // WebSocket-triggered reconciliation arriving while a polling fetch is
  // in-flight) share a single underlying request. This guarantees at
  // most one /api/rex/execute/status request is active at any time.

  const statusDedup = useRef(
    createRequestDedup(async () => {
      const res = await fetch("/api/rex/execute/status");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setError(null);
      }
    }),
  );

  const fetchStatus = useCallback(async () => {
    try {
      await statusDedup.current.execute();
    } catch {
      // Silently fail — will retry on next poll
    }
  }, []);

  // ── WebSocket for real-time updates ────────────────────────────────

  useEffect(() => {
    fetchStatus();

    // Connect to WebSocket for live updates
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;
    let ws: WebSocket;

    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "rex:execution-progress" && msg.state) {
            // Optimistic update — instant UI feedback from the WS payload.
            setStatus(msg.state);
            // Also notify parent to refresh dashboard data
            if (onPrdChanged) onPrdChanged();
            // Reconciliation fetch — the API handler reads fresh task
            // counts from disk (refreshEpicProgress), which the WS
            // broadcast may not include. Goes through the dedup so it
            // shares any in-flight polling request rather than starting
            // a second one.
            fetchStatus();
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch {
      // WebSocket not available — fall back to polling
    }

    return () => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
    };
  }, [fetchStatus, onPrdChanged]);

  // Dispose dedup on unmount to clear in-flight tracking state.
  useEffect(() => {
    const dedup = statusDedup.current;
    return () => dedup.dispose();
  }, []);

  // Poll as fallback (every 3s) — visibility-aware via polling manager.
  // Automatically paused when memory pressure disables autoRefresh.
  usePolling("execution-panel", fetchStatus, 3000, !autoRefreshDisabled);

  // ── Handlers ───────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/execute/epic-by-epic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start execution");
      } else {
        // Immediately fetch updated status
        await fetchStatus();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setStarting(false);
    }
  }, [fetchStatus]);

  const handlePause = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rex/execute/pause", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to pause");
      } else {
        await fetchStatus();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  const handleResume = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rex/execute/resume", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to resume");
      } else {
        await fetchStatus();
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [fetchStatus]);

  // ── Render: idle state ─────────────────────────────────────────────

  const isIdle = !status || status.status === "idle";
  const isActive = status && (status.status === "running" || status.status === "paused");
  const isDone = status && (status.status === "completed" || status.status === "failed");

  return h("div", { class: "exec-panel" },
    h("div", { class: "exec-panel-header" },
      h("h3", { class: "exec-panel-title" }, "Epic-by-Epic Execution"),
      isActive
        ? h("span", {
            class: `exec-panel-status-badge exec-panel-status-${status!.status}`,
          }, status!.status === "running" ? "Running" : "Paused")
        : isDone
          ? h("span", {
              class: `exec-panel-status-badge exec-panel-status-${status!.status}`,
            }, status!.status === "completed" ? "Complete" : "Failed")
          : null,
    ),

    // Error display
    error
      ? h("div", { class: "exec-panel-error", role: "alert" }, error)
      : null,

    // Idle — show start button
    isIdle
      ? h("div", { class: "exec-panel-idle" },
          h("p", { class: "exec-panel-desc" },
            "Execute all epics sequentially. Each epic's tasks will be processed by the hench agent before moving to the next.",
          ),
          h("button", {
            class: "exec-panel-start-btn",
            onClick: handleStart,
            disabled: starting,
            "aria-label": "Start epic-by-epic execution",
          }, starting ? "Starting…" : "Start Epic-by-Epic Execution"),
        )
      : null,

    // Active execution — show progress
    isActive
      ? h("div", { class: "exec-panel-active" },
          // Overall progress
          h("div", { class: "exec-panel-progress" },
            h("div", { class: "exec-panel-progress-header" },
              h("span", { class: "exec-panel-progress-label" },
                `Epic ${Math.min(status!.currentEpicIndex + 1, status!.totalEpics)} of ${status!.totalEpics}`,
              ),
              h("span", { class: "exec-panel-progress-pct" }, `${status!.percentComplete}%`),
            ),
            h("div", {
              class: "exec-panel-progress-bar",
              role: "progressbar",
              "aria-valuenow": String(status!.percentComplete),
              "aria-valuemin": "0",
              "aria-valuemax": "100",
              "aria-label": `Execution progress: ${status!.percentComplete}%`,
            },
              h("div", {
                class: "exec-panel-progress-fill",
                style: `width: ${status!.percentComplete}%`,
              }),
            ),
            h("span", { class: "exec-panel-progress-detail" },
              `${status!.completedTasks}/${status!.totalTasks} tasks completed`,
            ),
          ),

          // Controls
          h("div", { class: "exec-panel-controls" },
            status!.status === "running"
              ? h("button", {
                  class: "exec-panel-pause-btn",
                  onClick: handlePause,
                  disabled: loading,
                  "aria-label": "Pause execution",
                }, loading ? "Pausing…" : "⏸ Pause")
              : h("button", {
                  class: "exec-panel-resume-btn",
                  onClick: handleResume,
                  disabled: loading,
                  "aria-label": "Resume execution",
                }, loading ? "Resuming…" : "▶ Resume"),
          ),

          // Epic list
          h("div", { class: "exec-panel-epic-list" },
            ...status!.epics.map((epic) =>
              h("div", {
                key: epic.id,
                class: [
                  "exec-panel-epic",
                  epic.status === "running" ? "exec-panel-epic-running" : "",
                  epic.status === "completed" ? "exec-panel-epic-done" : "",
                  epic.status === "skipped" ? "exec-panel-epic-skipped" : "",
                  epic.status === "failed" ? "exec-panel-epic-failed" : "",
                ].filter(Boolean).join(" "),
              },
                h("div", { class: "exec-panel-epic-row" },
                  h("span", {
                    class: `exec-panel-epic-icon exec-panel-epic-icon-${epic.status}`,
                    "aria-label": EPIC_STATUS_LABELS[epic.status] ?? epic.status,
                  }, EPIC_STATUS_ICONS[epic.status] ?? "○"),
                  h("span", { class: "exec-panel-epic-title" }, epic.title),
                  h("span", { class: "exec-panel-epic-count" },
                    `${epic.tasksCompleted}/${epic.tasksTotal}`,
                  ),
                ),
                epic.tasksTotal > 0
                  ? h("div", { class: "exec-panel-epic-bar" },
                      h("div", {
                        class: `exec-panel-epic-fill${epic.status === "completed" ? " done" : epic.tasksCompleted > 0 ? " mid" : ""}`,
                        style: `width: ${epic.tasksTotal > 0 ? Math.round((epic.tasksCompleted / epic.tasksTotal) * 100) : 0}%`,
                      }),
                    )
                  : null,
              ),
            ),
          ),
        )
      : null,

    // Completed/failed — show summary with restart option
    isDone
      ? h("div", { class: "exec-panel-done" },
          h("div", { class: "exec-panel-summary" },
            status!.status === "completed"
              ? h("span", { class: "exec-panel-summary-icon exec-panel-summary-success" }, "✓")
              : h("span", { class: "exec-panel-summary-icon exec-panel-summary-fail" }, "✕"),
            h("span", null,
              status!.status === "completed"
                ? `Completed: ${status!.completedEpics}/${status!.totalEpics} epics processed, ${status!.completedTasks}/${status!.totalTasks} tasks done`
                : `Failed: ${status!.error || "Unknown error"}`,
            ),
          ),

          // Show epic results
          status!.epics.length > 0
            ? h("div", { class: "exec-panel-epic-list" },
                ...status!.epics.map((epic) =>
                  h("div", {
                    key: epic.id,
                    class: [
                      "exec-panel-epic",
                      epic.status === "completed" ? "exec-panel-epic-done" : "",
                      epic.status === "skipped" ? "exec-panel-epic-skipped" : "",
                      epic.status === "failed" ? "exec-panel-epic-failed" : "",
                    ].filter(Boolean).join(" "),
                  },
                    h("div", { class: "exec-panel-epic-row" },
                      h("span", {
                        class: `exec-panel-epic-icon exec-panel-epic-icon-${epic.status}`,
                      }, EPIC_STATUS_ICONS[epic.status] ?? "○"),
                      h("span", { class: "exec-panel-epic-title" }, epic.title),
                      h("span", { class: "exec-panel-epic-count" },
                        `${epic.tasksCompleted}/${epic.tasksTotal}`,
                      ),
                    ),
                  ),
                ),
              )
            : null,

          // Restart button
          h("button", {
            class: "exec-panel-start-btn exec-panel-restart-btn",
            onClick: handleStart,
            disabled: starting,
          }, starting ? "Starting…" : "Run Again"),
        )
      : null,
  );
}

/**
 * Active Tasks Panel — shows currently executing tasks prominently at the
 * top of the Hench UI.
 *
 * Combines data from three sources:
 * 1. Hench runs with status "running" (from /api/hench/runs)
 * 2. Active task executions triggered via the dashboard (from /api/hench/execute/status)
 * 3. Liveness verdicts for those runs (from /api/hench/audit)
 *
 * Updates in real-time via WebSocket ("hench:task-execution-progress" events)
 * and periodic polling as a fallback.
 *
 * A run file says "running" until its process writes a terminal status, so a
 * crash or a reboot strands it there permanently and the list fills with tasks
 * nothing is executing. Source 3 says which of them a process is actually
 * running — see `server/run-liveness.ts` for how the verdict is reached — and
 * this panel surfaces that per card plus a one-click sweep for the dead ones.
 *
 * Displays task title, start time, elapsed duration (live-ticking), the
 * liveness verdict, and controls to end a run.
 */

import { appUrl, getWebSocketUrl, acceptsFrame } from "../base-path.js";
import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { RexTaskLink } from "./rex-task-link.js";
import { ElapsedTime } from "./elapsed-time.js";
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
  /** Live tokens/sec from the most recent LLM turn (API-mode vendors: local, google). */
  tokensPerSecond?: number;
  error?: string;
}

/** Evidence-based verdict from the server — mirrors `RunLiveness`. */
type RunLiveness = "live" | "foreign" | "unknown" | "orphaned";

/** One entry of `GET /api/hench/audit`, narrowed to what this panel reads. */
interface AuditEntry {
  runId: string;
  taskId: string;
  liveness?: RunLiveness;
  livenessReason?: string;
  canEnd?: boolean;
}

/** What the audit says about one run, keyed by run id. */
type LivenessMap = Map<string, { liveness: RunLiveness; reason: string; canEnd: boolean }>;

export interface ActiveTasksPanelProps {
  /** Running runs from the parent (from /api/hench/runs with status=running). */
  runs: ActiveRun[];
  navigateTo?: NavigateTo;
  /**
   * Called after a run is ended here, so the parent can re-fetch. Without it
   * an ended run lingers in `runs` until the parent's own poll comes round.
   */
  onRunsChanged?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

function isStale(run: ActiveRun): boolean {
  if (!run.lastActivityAt) return true; // Legacy run
  return Date.now() - new Date(run.lastActivityAt).getTime() > STALE_THRESHOLD_MS;
}

/** Badge label and modifier class for a liveness verdict. */
const LIVENESS_BADGE: Record<Exclude<RunLiveness, "live">, { label: string; mod: string }> = {
  orphaned: { label: "Not running", mod: "orphaned" },
  unknown: { label: "Unverified", mod: "unknown" },
  foreign: { label: "Other machine", mod: "foreign" },
};

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

interface ActiveTaskCardProps {
  run: ActiveRun;
  navigateTo?: NavigateTo;
  /** Audit verdict for this run, absent until the first audit fetch resolves. */
  verdict?: { liveness: RunLiveness; reason: string; canEnd: boolean };
  /** Ends this run. Resolves once the server has answered. */
  onEnd: (run: ActiveRun, verdict?: { liveness: RunLiveness }) => void | Promise<void>;
  /** True while this card's end request is in flight. */
  ending: boolean;
}

function ActiveTaskCard({ run, navigateTo, verdict, onEnd, ending }: ActiveTaskCardProps) {
  // Before the audit resolves, fall back to the time-based suspicion so the
  // card never silently downgrades from "possibly stuck" to "fine".
  const stale = isStale(run);
  const dead = verdict?.liveness === "orphaned";
  const badge = verdict && verdict.liveness !== "live" ? LIVENESS_BADGE[verdict.liveness] : null;

  return h("div", {
    class: `active-task-card${dead ? " active-task-card-dead" : stale ? " active-task-card-stale" : ""}`,
  },
    // Pulsing status indicator — a dead run gets a static dot, not a pulse:
    // animating it would keep asserting activity the audit has disproved.
    h("div", { class: "active-task-pulse-wrapper", "aria-hidden": "true" },
      h("span", {
        class: `active-task-pulse${dead ? " active-task-pulse-dead" : stale ? " active-task-pulse-stale" : ""}`,
      }),
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
        badge
          ? h("span", {
              class: `active-task-liveness-badge active-task-liveness-${badge.mod}`,
              title: verdict!.reason,
            }, badge.label)
          : !verdict && stale
            ? h("span", { class: "active-task-stale-badge" }, "Possibly stuck")
            : null,
        h("button", {
          class: `active-task-end-btn${dead ? " active-task-end-btn-dead" : ""}`,
          disabled: ending,
          title: dead
            ? "Close out this run — no process is executing it"
            : "Stop this run and mark it failed",
          "aria-label": `End run: ${run.taskTitle}`,
          onClick: () => { void onEnd(run, verdict); },
        }, ending ? "Ending…" : "End"),
      ),

      // Metadata row — elapsed time is isolated in its own component to
      // prevent the entire card from re-rendering on every 1-second tick.
      h("div", { class: "active-task-meta" },
        h("span", { class: "active-task-elapsed", title: "Elapsed time" },
          h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "⏱"),
          h(ElapsedTime, { startedAt: run.startedAt, formatter: formatElapsed }),
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

      // The audit's justification, so the verdict is auditable rather than
      // something the user has to take on trust before ending a run.
      verdict && verdict.liveness !== "live"
        ? h("div", { class: "active-task-liveness-reason" }, verdict.reason)
        : null,
    ),
  );
}

// ── Execution state card (for dashboard-triggered executions) ────────

interface ExecutionCardProps {
  exec: ExecutionState;
  /** Stops the managed child process behind this execution. */
  onEnd: (exec: ExecutionState) => void | Promise<void>;
  ending: boolean;
}

function ExecutionCard({ exec, onEnd, ending }: ExecutionCardProps) {
  const isStarting = exec.status === "starting";
  // Show last non-blank line from stdout as a live status hint
  const lastLine = exec.lastOutput
    ?.split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1);

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
        // Always a live child process — no liveness check needed, and no
        // ambiguity about what ending it does.
        h("button", {
          class: "active-task-end-btn",
          disabled: ending,
          title: "Stop this run",
          "aria-label": `End run: ${exec.taskTitle}`,
          onClick: () => { void onEnd(exec); },
        }, ending ? "Ending…" : "End"),
      ),
      h("div", { class: "active-task-meta" },
        h("span", { class: "active-task-elapsed", title: "Elapsed time" },
          h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "⏱"),
          h(ElapsedTime, { startedAt: exec.startedAt, formatter: formatElapsed }),
        ),
        h("span", { class: "active-task-started", title: `Started at ${formatStartTime(exec.startedAt)}` },
          h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "▶"),
          formatStartTime(exec.startedAt),
        ),
        exec.tokensPerSecond !== undefined
          ? h("span", {
              class: "active-task-toks",
              title: "Tokens per second (most recent LLM turn)",
            },
              h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "⚡"),
              `${exec.tokensPerSecond} tok/s`,
            )
          : null,
      ),
      // Live output hint — last line of stdout, updated via WebSocket
      lastLine
        ? h("div", { class: "active-task-last-output", title: "Last output from hench" },
            h("span", { class: "active-task-meta-icon", "aria-hidden": "true" }, "›"),
            h("span", { class: "active-task-last-output-text" }, lastLine),
          )
        : null,
    ),
  );
}

// ── Browser notification helper ───────────────────────────────────

/** Request notification permission once, silently. */
function requestNotificationPermission() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => { /* ignore */ });
  }
}

function fireNotification(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: appUrl("/n-dx.png"), silent: false });
  } catch {
    // Notifications blocked or unavailable in this context
  }
}

// ── Main panel ───────────────────────────────────────────────────────

export function ActiveTasksPanel({ runs, navigateTo, onRunsChanged }: ActiveTasksPanelProps) {
  const [executions, setExecutions] = useState<ExecutionState[]>([]);
  const [liveness, setLiveness] = useState<LivenessMap>(() => new Map());
  const [ending, setEnding] = useState<Set<string>>(() => new Set());
  const [sweeping, setSweeping] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Tracks task IDs that have ever been seen as active (running/starting), so that
  // a "completed" WS event can fire a notification even if it races ahead of the
  // initial fetchExecutions response.
  const knownActiveTaskIds = useRef<Set<string>>(new Set());

  // Track whether notification permission has been asked this session.
  // We do NOT call requestPermission() on mount — Chrome 80+ auto-denies without
  // a user gesture, which locks out notifications permanently for the session.
  const [notifState, setNotifState] = useState<"default" | "granted" | "denied">(() =>
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  const handleEnableNotifications = useCallback(() => {
    if (typeof Notification === "undefined") return;
    Notification.requestPermission().then((result) => {
      setNotifState(result);
    }).catch(() => {});
  }, []);

  // Fetch active dashboard-triggered executions
  const fetchExecutions = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/execute/status");
      if (res.ok) {
        const data = await res.json();
        const active = (data.executions ?? []).filter(
          (e: ExecutionState) => e.status === "running" || e.status === "starting",
        );
        // Seed knownActiveTaskIds so WS "completed" events that race ahead of this
        // fetch can still fire a notification.
        for (const e of active) knownActiveTaskIds.current.add(e.taskId);
        setExecutions(active);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Fetch liveness verdicts for the runs on screen.
  const fetchLiveness = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/audit");
      if (!res.ok) return;
      const data = await res.json();
      const next: LivenessMap = new Map();
      for (const e of (data.entries ?? []) as AuditEntry[]) {
        if (!e.runId || !e.liveness) continue;
        next.set(e.runId, {
          liveness: e.liveness,
          reason: e.livenessReason ?? "",
          canEnd: e.canEnd === true,
        });
      }
      setLiveness(next);
    } catch {
      // Audit unavailable — cards fall back to the time-based stale badge.
    }
  }, []);

  // WebSocket + polling with exponential-backoff reconnect
  useEffect(() => {
    let mounted = true;
    fetchExecutions();
    fetchLiveness();

    const wsUrl = getWebSocketUrl();

    let reconnectDelay = 1000; // ms; doubles on each failure, capped at 30 s
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function handleMessage(event: MessageEvent) {
      if (!mounted) return;
      try {
        const msg = JSON.parse(event.data as string);
        // Another worktree's frame on the shared socket — not ours to react to.
        if (!acceptsFrame(msg)) return;
        if (msg.type === "hench:task-execution-progress" && msg.state) {
          const state = msg.state as ExecutionState;
          // Track any active task so that fast-completing tasks are still
          // recognized even if the initial fetchExecutions hasn't resolved yet.
          if (state.status === "running" || state.status === "starting") {
            knownActiveTaskIds.current.add(state.taskId);
          }
          setExecutions((prev) => {
            // If completed/failed, remove from the list and notify
            if (state.status === "completed" || state.status === "failed") {
              const wasActive =
                prev.some((e) => e.taskId === state.taskId) ||
                knownActiveTaskIds.current.has(state.taskId);
              if (wasActive) {
                knownActiveTaskIds.current.delete(state.taskId);
                if (state.status === "completed") {
                  fireNotification("Task complete", state.taskTitle);
                } else {
                  fireNotification("Task failed", `${state.taskTitle}${state.error ? ` — ${state.error}` : ""}`);
                }
              }
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
    }

    function connect() {
      if (!mounted) return;
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = handleMessage;

        ws.onopen = () => {
          reconnectDelay = 1000; // reset backoff on successful connect
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (!mounted) return;
          // Schedule reconnect with exponential backoff (max 30 s)
          reconnectTimer = setTimeout(() => {
            reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
            connect();
          }, reconnectDelay);
        };

        ws.onerror = () => {
          // onclose fires after onerror — reconnect is handled there
        };
      } catch {
        // WebSocket not supported; fall back to polling only
      }
    }

    connect();

    // Poll as fallback every 5 seconds (covers WS gaps during reconnect)
    const interval = setInterval(fetchExecutions, 5000);
    // Liveness changes only when a process starts or dies, and each sweep
    // stats every lock file, so it polls far less often than the WS fallback.
    const livenessInterval = setInterval(fetchLiveness, 30_000);

    return () => {
      mounted = false;
      clearInterval(interval);
      clearInterval(livenessInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
      }
      wsRef.current = null;
    };
  }, [fetchExecutions, fetchLiveness]);

  // ── End controls ───────────────────────────────────────────────────

  /**
   * End one run.
   *
   * `POST /api/hench/execute/:taskId/terminate` kills the child when this
   * dashboard owns it and otherwise marks the run file failed, which covers
   * both kinds of card here. Anything the audit has not proved dead asks first,
   * because for those a real process may still be mid-edit.
   */
  const terminate = useCallback(async (
    taskId: string,
    taskTitle: string,
    /** Key tracking the in-flight state — a run id or an execution's run id. */
    busyKey: string,
  ) => {
    setActionError(null);
    setEnding((prev) => new Set(prev).add(busyKey));
    try {
      const res = await fetch(
        `/api/hench/execute/${encodeURIComponent(taskId)}/terminate`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Could not end "${taskTitle}" (HTTP ${res.status}).`);
        return;
      }
      await Promise.all([fetchLiveness(), fetchExecutions()]);
      onRunsChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setEnding((prev) => {
        const next = new Set(prev);
        next.delete(busyKey);
        return next;
      });
    }
  }, [fetchLiveness, fetchExecutions, onRunsChanged]);

  const endRun = useCallback(async (
    run: ActiveRun,
    verdict?: { liveness: RunLiveness },
  ) => {
    if (verdict?.liveness !== "orphaned") {
      const detail = verdict?.liveness === "live"
        ? "A process is still running this task; it will be killed."
        : "This run has not been confirmed dead; a process may still be working.";
      if (!confirm(`End "${run.taskTitle}"?\n\n${detail}`)) return;
    }
    await terminate(run.taskId, run.taskTitle, run.id);
  }, [terminate]);

  const endExecution = useCallback(async (exec: ExecutionState) => {
    if (!confirm(`End "${exec.taskTitle}"?\n\nThe running process will be killed.`)) return;
    await terminate(exec.taskId, exec.taskTitle, exec.runId);
  }, [terminate]);

  /** End every run the audit proved no process is executing. */
  const sweepOrphaned = useCallback(async (count: number) => {
    if (!confirm(
      `End ${count} run${count === 1 ? "" : "s"} that no process is executing?\n\n` +
      "Each is marked failed in its run file. No running process is signalled.",
    )) return;

    setActionError(null);
    setSweeping(true);
    try {
      const res = await fetch("/api/hench/runs/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setActionError(body.error ?? `Reconcile failed (HTTP ${res.status}).`);
        return;
      }
      await fetchLiveness();
      onRunsChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not reach the server.");
    } finally {
      setSweeping(false);
    }
  }, [fetchLiveness, onRunsChanged]);

  // Merge: running hench runs + dashboard-triggered executions.
  // Deduplicate by taskId (hench runs take priority since they have more data).
  const runTaskIds = new Set(runs.map((r) => r.taskId));
  const uniqueExecutions = executions.filter((e) => !runTaskIds.has(e.taskId));

  const totalActive = runs.length + uniqueExecutions.length;

  // Runs the audit proved nothing is executing — the ones that make this count
  // misleading, and the only ones the bulk sweep touches.
  const orphanedCount = runs.filter((r) => liveness.get(r.id)?.liveness === "orphaned").length;

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
      notifState === "default"
        ? h("button", {
            class: "active-tasks-notif-btn",
            title: "Enable browser notifications for task completion",
            onClick: handleEnableNotifications,
          }, "🔔 Notify me")
        : null,
    ),

    // Audit banner — the count above is only trustworthy once these are gone.
    orphanedCount > 0
      ? h("div", { class: "active-tasks-audit-banner", role: "status" },
          h("span", { class: "active-tasks-audit-icon", "aria-hidden": "true" }, "⚠"),
          h("span", { class: "active-tasks-audit-text" },
            `${orphanedCount} of these ${orphanedCount === 1 ? "is" : "are"} not running — ` +
            `no hench process holds ${orphanedCount === 1 ? "it" : "them"}.`,
          ),
          h("button", {
            class: "active-tasks-audit-sweep",
            disabled: sweeping,
            onClick: () => { void sweepOrphaned(orphanedCount); },
          }, sweeping ? "Ending…" : `End ${orphanedCount}`),
        )
      : null,

    actionError
      ? h("div", { class: "active-tasks-audit-error", role: "alert" },
          h("span", null, actionError),
          h("button", {
            class: "active-tasks-audit-error-dismiss",
            onClick: () => setActionError(null),
            "aria-label": "Dismiss",
          }, "×"),
        )
      : null,

    h("div", { class: "active-tasks-list" },
      // Hench runs first
      ...runs.map((run) =>
        h(ActiveTaskCard, {
          key: run.id,
          run,
          navigateTo,
          verdict: liveness.get(run.id),
          onEnd: endRun,
          ending: ending.has(run.id),
        }),
      ),
      // Then dashboard-triggered executions that aren't already in runs
      ...uniqueExecutions.map((exec) =>
        h(ExecutionCard, {
          key: exec.runId,
          exec,
          onEnd: endExecution,
          ending: ending.has(exec.runId),
        }),
      ),
    ),
  );
}

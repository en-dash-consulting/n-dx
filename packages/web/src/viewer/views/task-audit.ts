/**
 * Task Audit view — detailed execution information and administrative controls.
 *
 * Shows process IDs, system resource usage, execution logs, and
 * termination controls for active tasks.
 *
 * Data comes from:
 *   GET  /api/hench/audit           — active tasks with PIDs, resource usage
 *   GET  /api/hench/runs/:id        — full run detail (for log viewing)
 *   POST /api/hench/execute/:taskId/terminate — task termination
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { BrandedHeader, RexTaskLink, ElapsedTime } from "../components/index.js";
import type { NavigateTo } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

type HeartbeatStatus = "healthy" | "warning" | "unresponsive" | "unknown";

interface AuditEntry {
  taskId: string;
  taskTitle: string;
  runId: string;
  pid: number | null;
  status: string;
  startedAt: string;
  lastActivityAt?: string;
  elapsedMs: number;
  stale: boolean;
  source: "dashboard" | "disk";
  lastOutput?: string;
  turns?: number;
  model?: string;
  tokenUsage?: { input: number; output: number };
  heartbeatStatus?: HeartbeatStatus;
  missedHeartbeats?: number;
}

interface SystemInfo {
  serverPid: number;
  serverUptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
    external: number;
  };
  activeExecutions: number;
}

interface AuditData {
  entries: AuditEntry[];
  systemInfo: SystemInfo;
  timestamp: string;
}

interface RunLog {
  id: string;
  toolCalls?: Array<{
    turn: number;
    tool: string;
    input?: unknown;
    output?: string;
    durationMs?: number;
  }>;
  summary?: string;
  error?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtElapsed(ms: number): string {
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

function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hours < 24) return `${hours}h ${remainMins}m`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days}d ${remainHours}h`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtTimeSince(isoString: string): string {
  const elapsed = Date.now() - new Date(isoString).getTime();
  if (elapsed < 0) return "just now";
  const secs = Math.floor(elapsed / 1000);
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

/** Formatter for useTick: computes elapsed time from an ISO start timestamp. */
function formatElapsedFromStart(startedAt: string): string {
  return fmtElapsed(Date.now() - new Date(startedAt).getTime());
}

function heartbeatLabel(status?: HeartbeatStatus): string {
  switch (status) {
    case "healthy": return "Healthy";
    case "warning": return "Delayed";
    case "unresponsive": return "Unresponsive";
    case "unknown": return "Unknown";
    default: return "";
  }
}

// ── Sub-components ───────────────────────────────────────────────────

/** System resource usage panel. */
function SystemResourcePanel({ info }: { info: SystemInfo }) {
  const heapPct = info.memoryUsage.heapTotal > 0
    ? Math.round((info.memoryUsage.heapUsed / info.memoryUsage.heapTotal) * 100)
    : 0;

  return h("div", { class: "audit-system-panel" },
    h("h3", null, "Server Resources"),
    h("div", { class: "audit-system-grid" },
      h("div", { class: "audit-system-item" },
        h("span", { class: "audit-system-label" }, "Server PID"),
        h("span", { class: "audit-system-value audit-mono" }, String(info.serverPid)),
      ),
      h("div", { class: "audit-system-item" },
        h("span", { class: "audit-system-label" }, "Uptime"),
        h("span", { class: "audit-system-value" }, fmtUptime(info.serverUptime)),
      ),
      h("div", { class: "audit-system-item" },
        h("span", { class: "audit-system-label" }, "Heap Used"),
        h("span", { class: "audit-system-value" },
          fmtBytes(info.memoryUsage.heapUsed),
          h("span", { class: "audit-system-pct" }, ` (${heapPct}%)`),
        ),
      ),
      h("div", { class: "audit-system-item" },
        h("span", { class: "audit-system-label" }, "RSS"),
        h("span", { class: "audit-system-value" }, fmtBytes(info.memoryUsage.rss)),
      ),
      h("div", { class: "audit-system-item" },
        h("span", { class: "audit-system-label" }, "Active Processes"),
        h("span", { class: "audit-system-value" }, String(info.activeExecutions)),
      ),
    ),
  );
}

/** Individual audit task card. */
function AuditTaskCard({
  entry,
  navigateTo,
  onTerminate,
  onViewLogs,
  terminating,
  expanded,
  onToggle,
}: {
  entry: AuditEntry;
  navigateTo?: NavigateTo;
  onTerminate: (taskId: string) => void;
  onViewLogs: (runId: string) => void;
  terminating: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cardClass = entry.heartbeatStatus === "unresponsive"
    ? "audit-task-card audit-task-unresponsive"
    : entry.stale
      ? "audit-task-card audit-task-stale"
      : entry.heartbeatStatus === "warning"
        ? "audit-task-card audit-task-heartbeat-warning"
        : "audit-task-card";

  return h("div", { class: cardClass },
    // Header row: status + title + actions
    h("div", { class: "audit-task-header" },
      // Pulsing indicator
      h("div", { class: "audit-task-pulse-wrapper", "aria-hidden": "true" },
        h("span", {
          class: `audit-task-pulse${entry.stale ? " audit-task-pulse-stale" : ""}`,
        }),
      ),

      // Task info
      h("div", { class: "audit-task-info" },
        h("div", { class: "audit-task-title-row" },
          navigateTo && entry.taskId
            ? h(RexTaskLink, {
                task: {
                  id: entry.taskId,
                  title: entry.taskTitle,
                  status: "in_progress",
                },
                navigateTo,
                compact: true,
                showStatus: false,
                class: "audit-task-link",
              })
            : h("span", { class: "audit-task-title" }, entry.taskTitle),
          entry.heartbeatStatus === "unresponsive"
            ? h("span", { class: "audit-task-unresponsive-badge" }, "Unresponsive")
            : entry.stale
              ? h("span", { class: "audit-task-stale-badge" }, "Possibly stuck")
              : entry.heartbeatStatus === "warning"
                ? h("span", { class: "audit-task-warning-badge" }, "Heartbeat delayed")
                : null,
        ),

        // Metadata chips
        h("div", { class: "audit-task-meta" },
          entry.pid
            ? h("span", { class: "audit-chip audit-chip-pid", title: "Process ID" },
                h("span", { class: "audit-chip-icon" }, "⚙"),
                `PID ${entry.pid}`,
              )
            : h("span", { class: "audit-chip audit-chip-nopid", title: "No PID (CLI-triggered run)" },
                h("span", { class: "audit-chip-icon" }, "⚙"),
                "No PID",
              ),
          h("span", { class: "audit-chip", title: "Elapsed time" },
            h("span", { class: "audit-chip-icon" }, "⏱"),
            h(ElapsedTime, { startedAt: entry.startedAt, formatter: formatElapsedFromStart }),
          ),
          h("span", { class: "audit-chip", title: "Run ID" },
            h("span", { class: "audit-chip-icon" }, "▶"),
            entry.runId.length > 16 ? entry.runId.slice(0, 16) + "…" : entry.runId,
          ),
          h("span", { class: `audit-chip audit-chip-source audit-chip-source-${entry.source}` },
            entry.source === "dashboard" ? "Dashboard" : "CLI",
          ),
          entry.model
            ? h("span", { class: `audit-chip audit-chip-model audit-chip-model-${entry.model}` }, entry.model)
            : null,
          entry.turns != null
            ? h("span", { class: "audit-chip" }, `${entry.turns} turns`)
            : null,
          entry.tokenUsage
            ? h("span", { class: "audit-chip" },
                fmtTokens((entry.tokenUsage.input ?? 0) + (entry.tokenUsage.output ?? 0)),
                " tokens",
              )
            : null,
          // Heartbeat status chip
          entry.heartbeatStatus && entry.heartbeatStatus !== "healthy"
            ? h("span", {
                class: `audit-chip audit-chip-heartbeat audit-chip-heartbeat-${entry.heartbeatStatus}`,
                title: entry.missedHeartbeats
                  ? `${entry.missedHeartbeats} missed heartbeat${entry.missedHeartbeats === 1 ? "" : "s"}`
                  : "Heartbeat status",
              },
                h("span", { class: "audit-chip-icon" }, "\u2665"),
                heartbeatLabel(entry.heartbeatStatus),
              )
            : null,
          // Last heartbeat timestamp
          entry.lastActivityAt
            ? h("span", {
                class: "audit-chip audit-chip-heartbeat-time",
                title: `Last heartbeat: ${new Date(entry.lastActivityAt).toLocaleString()}`,
              },
                h("span", { class: "audit-chip-icon" }, "\u2665"),
                fmtTimeSince(entry.lastActivityAt),
              )
            : null,
        ),
      ),

      // Action buttons
      h("div", { class: "audit-task-actions" },
        h("button", {
          class: "audit-btn audit-btn-logs",
          onClick: (e: Event) => { e.stopPropagation(); onToggle(); },
          title: expanded ? "Hide logs" : "View logs",
          "aria-expanded": String(expanded),
        }, expanded ? "Hide Logs" : "View Logs"),
        h("button", {
          class: "audit-btn audit-btn-terminate",
          onClick: (e: Event) => { e.stopPropagation(); onTerminate(entry.taskId); },
          disabled: terminating,
          title: "Terminate this task",
        }, terminating ? "Terminating…" : "Terminate"),
      ),
    ),

    // Last output snippet
    entry.lastOutput
      ? h("div", { class: "audit-task-last-output" },
          h("span", { class: "audit-last-output-label" }, "Last output:"),
          h("code", null, entry.lastOutput),
        )
      : null,
  );
}

/** Log viewer for a specific run. */
function RunLogViewer({ runId }: { runId: string }) {
  const [log, setLog] = useState<RunLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`/api/hench/runs/${runId}`);
      if (!res.ok) {
        setError(`Failed to load run (${res.status})`);
        return;
      }
      const json = await res.json();
      setLog(json as RunLog);
      setError(null);
    } catch {
      setError("Failed to fetch run logs");
    } finally {
      setLoading(false);
    }
  }, [runId]);

  // Initial fetch + polling
  useEffect(() => {
    fetchLog();
    const interval = setInterval(fetchLog, 5000);
    return () => clearInterval(interval);
  }, [fetchLog]);

  // Auto-scroll to bottom on new data
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [log, autoScroll]);

  if (loading) return h("div", { class: "audit-log-loading" }, "Loading logs…");
  if (error) return h("div", { class: "audit-log-error" }, error);
  if (!log) return null;

  const toolCalls = log.toolCalls ?? [];

  return h("div", { class: "audit-log-viewer" },
    h("div", { class: "audit-log-header" },
      h("span", { class: "audit-log-count" }, `${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}`),
      h("label", { class: "audit-log-autoscroll" },
        h("input", {
          type: "checkbox",
          checked: autoScroll,
          onChange: () => setAutoScroll(!autoScroll),
        }),
        " Auto-scroll",
      ),
    ),
    h("div", { class: "audit-log-entries" },
      toolCalls.length === 0
        ? h("div", { class: "audit-log-empty" }, "No tool calls recorded yet.")
        : toolCalls.map((tc, i) =>
            h("div", { key: i, class: "audit-log-entry" },
              h("div", { class: "audit-log-entry-header" },
                h("span", { class: "audit-log-turn" }, `Turn ${tc.turn}`),
                h("span", { class: "audit-log-tool" }, tc.tool),
                tc.durationMs != null
                  ? h("span", { class: "audit-log-duration" }, `${tc.durationMs}ms`)
                  : null,
              ),
              tc.output
                ? h("pre", { class: "audit-log-output" },
                    typeof tc.output === "string"
                      ? tc.output.length > 500 ? tc.output.slice(0, 500) + "…" : tc.output
                      : JSON.stringify(tc.output, null, 2).slice(0, 500),
                  )
                : null,
            ),
          ),
      h("div", { ref: logEndRef }),
    ),
    // Error display
    log.error
      ? h("div", { class: "audit-log-error-box" },
          h("strong", null, "Error: "),
          log.error,
        )
      : null,
    // Summary display
    log.summary
      ? h("div", { class: "audit-log-summary" },
          h("strong", null, "Summary: "),
          h("pre", null, log.summary),
        )
      : null,
  );
}

// ── Main view ────────────────────────────────────────────────────────

export interface TaskAuditViewProps {
  navigateTo?: NavigateTo;
}

export function TaskAuditView({ navigateTo }: TaskAuditViewProps = {}) {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [terminatingTasks, setTerminatingTasks] = useState<Set<string>>(new Set());
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch audit data
  const fetchAudit = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/audit");
      if (!res.ok) {
        setError(`Failed to load audit data (${res.status})`);
        return;
      }
      const json = await res.json();
      setData(json as AuditData);
      setError(null);
    } catch {
      setError("Could not fetch audit data. Is the server running?");
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll + WebSocket
  useEffect(() => {
    fetchAudit();

    // Poll every 3 seconds for near-real-time updates
    const interval = setInterval(fetchAudit, 3000);

    // WebSocket for execution events
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "hench:task-execution-progress") {
            // Refresh audit data on any execution event
            fetchAudit();
          } else if (msg.type === "hench:heartbeat-alert") {
            // Show toast for heartbeat alerts
            const status = msg.heartbeatStatus as string;
            const title = msg.taskTitle as string || "Unknown task";
            const missed = msg.missedHeartbeats as number || 0;
            if (status === "unresponsive") {
              setToast(`Task "${title}" is unresponsive (${missed} missed heartbeats)`);
            } else if (status === "warning") {
              setToast(`Task "${title}" heartbeat delayed (${missed} missed)`);
            }
            fetchAudit();
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => { wsRef.current = null; };
    } catch {
      // WebSocket not available, polling is sufficient
    }

    return () => {
      clearInterval(interval);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch { /* ignore */ }
        wsRef.current = null;
      }
    };
  }, [fetchAudit]);

  // Terminate handler
  const handleTerminate = useCallback(async (taskId: string) => {
    setTerminatingTasks((prev) => new Set(prev).add(taskId));
    try {
      const res = await fetch(`/api/hench/execute/${taskId}/terminate`, {
        method: "POST",
      });
      if (res.ok) {
        const result = await res.json();
        setToast(`Task terminated${result.pid ? ` (PID ${result.pid})` : ""}`);
        // Refresh immediately
        fetchAudit();
      } else {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        setToast(`Failed: ${err.error}`);
      }
    } catch {
      setToast("Failed to terminate task");
    } finally {
      setTerminatingTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }, [fetchAudit]);

  // Toggle log expansion
  const toggleLogs = useCallback((runId: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }, []);

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  // ── Loading state ──
  if (loading) {
    return h("div", { class: "loading" }, "Loading audit data…");
  }

  // ── Error state ──
  if (error) {
    return h("div", { class: "audit-container" },
      h(BrandedHeader, { product: "hench", title: "Hench", class: "branded-header-hench" }),
      h("h2", null, "Task Audit"),
      h("div", { class: "audit-error" },
        h("p", null, error),
        h("button", { class: "btn", onClick: fetchAudit }, "Retry"),
      ),
    );
  }

  const entries = data?.entries ?? [];
  const systemInfo = data?.systemInfo;

  // ── Main render ──
  return h("div", { class: "audit-container" },
    h("div", { class: "audit-header" },
      h(BrandedHeader, { product: "hench", title: "Hench", class: "branded-header-hench" }),
      h("div", { class: "audit-title-row" },
        h("h2", null, "Task Audit"),
        entries.length > 0
          ? h("span", { class: "audit-count-badge" }, String(entries.length))
          : null,
        data?.timestamp
          ? h("span", { class: "audit-timestamp" },
              "Updated ",
              new Date(data.timestamp).toLocaleTimeString(),
            )
          : null,
      ),
    ),

    // System resource panel
    systemInfo
      ? h(SystemResourcePanel, { info: systemInfo })
      : null,

    // Active tasks section
    h("div", { class: "audit-section" },
      h("h3", null, "Active Tasks"),
      entries.length === 0
        ? h("div", { class: "audit-empty" },
            h("div", { class: "audit-empty-icon" }, "✓"),
            h("p", null, "No active tasks."),
            h("p", { class: "audit-empty-hint" },
              "Tasks will appear here when running via ",
              h("code", null, "ndx work"),
              " or the dashboard.",
            ),
          )
        : h("div", { class: "audit-tasks-list" },
            entries.map((entry) => {
              const isExpanded = expandedRuns.has(entry.runId);
              return h("div", { key: entry.runId, class: "audit-task-wrapper" },
                h(AuditTaskCard, {
                  entry,
                  navigateTo,
                  onTerminate: handleTerminate,
                  onViewLogs: (runId) => toggleLogs(runId),
                  terminating: terminatingTasks.has(entry.taskId),
                  expanded: isExpanded,
                  onToggle: () => toggleLogs(entry.runId),
                }),
                // Collapsible log viewer
                isExpanded
                  ? h(RunLogViewer, { runId: entry.runId })
                  : null,
              );
            }),
          ),
    ),

    // Toast notification
    toast
      ? h("div", { class: "audit-toast", role: "status", "aria-live": "polite" }, toast)
      : null,
  );
}

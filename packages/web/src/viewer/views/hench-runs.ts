/**
 * Hench Runs view — execution history showing past agent runs.
 *
 * Displays a list of runs with task name, status, duration, turns,
 * and token usage. Clicking a run shows the full summary/detail.
 * Each run links back to its Rex task.
 *
 * Data comes from GET /api/hench/runs (list) and
 * GET /api/hench/runs/:id (detail).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { MetricCard } from "../components/data-display/health-gauge.js";
import { BrandedHeader } from "../components/logos.js";
import { RexTaskLink } from "../components/rex-task-link.js";
import type { NavigateTo } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

interface RunSummary {
  id: string;
  taskId: string;
  taskTitle: string;
  taskStatus?: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  turns: number;
  summary?: string;
  error?: string;
  model: string;
  tokenUsage: {
    input: number;
    output: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
  };
  structuredSummary?: {
    counts?: {
      filesRead: number;
      filesChanged: number;
      commandsExecuted: number;
      testsRun: number;
      toolCallsTotal: number;
    };
  };
}

interface RunDetail extends RunSummary {
  toolCalls?: Array<{ tool: string; input?: unknown; output?: unknown }>;
  turnTokenUsage?: Array<{
    turn: number;
    input: number;
    output: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(start: string, end?: string): string {
  if (!end) return "running…";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function fmtTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  // If within last 24 hours, show relative time
  if (diffHours < 1) {
    const mins = Math.floor(diffMs / (1000 * 60));
    return mins <= 0 ? "just now" : `${mins}m ago`;
  }
  if (diffHours < 24) {
    return `${Math.floor(diffHours)}h ago`;
  }
  // If within last 7 days, show day + time
  if (diffHours < 168) {
    return d.toLocaleDateString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  // Otherwise full date
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const STATUS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  completed: { icon: "●", label: "Completed", color: "var(--green)" },
  failed: { icon: "✕", label: "Failed", color: "var(--red)" },
  running: { icon: "◐", label: "Running", color: "var(--accent)" },
  in_progress: { icon: "◐", label: "Running", color: "var(--accent)" },
  error: { icon: "✕", label: "Error", color: "var(--red)" },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { icon: "○", label: status, color: "var(--text-dim)" };
}

// ── Sub-components ───────────────────────────────────────────────────

/** Aggregate metrics shown above the runs list. */
function RunMetrics({ runs }: { runs: RunSummary[] }) {
  const totalRuns = runs.length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed" || r.status === "error").length;

  const totalTokens = runs.reduce((sum, r) => {
    const t = r.tokenUsage;
    return sum + (t.input ?? 0) + (t.output ?? 0) + (t.cacheCreationInput ?? 0) + (t.cacheReadInput ?? 0);
  }, 0);

  const totalTurns = runs.reduce((sum, r) => sum + (r.turns ?? 0), 0);

  return h("div", { class: "overview-metrics hench-metrics" },
    h(MetricCard, { value: totalRuns, label: "Total Runs" }),
    h(MetricCard, {
      value: completed,
      label: "Succeeded",
      color: "var(--green)",
    }),
    failed > 0
      ? h(MetricCard, {
          value: failed,
          label: "Failed",
          color: "var(--red)",
        })
      : null,
    h(MetricCard, {
      value: totalTurns,
      label: "Total Turns",
      color: "var(--brand-purple)",
    }),
    h(MetricCard, {
      value: fmtTokens(totalTokens),
      label: "Total Tokens",
      color: "var(--brand-teal)",
    }),
  );
}

/** Individual run card in the list. */
function RunCard({ run, isSelected, onClick, navigateTo }: {
  run: RunSummary;
  isSelected: boolean;
  onClick: () => void;
  navigateTo?: NavigateTo;
}) {
  const status = getStatusConfig(run.status);
  const totalTokens = (run.tokenUsage.input ?? 0)
    + (run.tokenUsage.output ?? 0)
    + (run.tokenUsage.cacheCreationInput ?? 0)
    + (run.tokenUsage.cacheReadInput ?? 0);

  const counts = run.structuredSummary?.counts;

  return h("div", {
    class: `hench-run-card${isSelected ? " selected" : ""}${run.status === "failed" || run.status === "error" ? " failed" : ""}`,
    onClick,
    role: "button",
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
  },
    // Top row: status + task link + timestamp
    h("div", { class: "hench-run-header" },
      h("span", {
        class: "hench-run-status",
        style: `color: ${status.color}`,
        title: status.label,
      }, status.icon),
      navigateTo && run.taskId
        ? h(RexTaskLink, {
            task: {
              id: run.taskId,
              title: run.taskTitle,
              status: run.taskStatus ?? "pending",
            },
            navigateTo,
            compact: true,
            showStatus: false,
            class: "hench-run-task-link",
          })
        : h("span", { class: "hench-run-title" }, run.taskTitle),
      h("span", { class: "hench-run-time" }, fmtTimestamp(run.startedAt)),
    ),

    // Bottom row: metadata chips
    h("div", { class: "hench-run-meta" },
      h("span", { class: "hench-run-chip" }, fmtDuration(run.startedAt, run.finishedAt)),
      h("span", { class: "hench-run-chip" }, `${run.turns} turns`),
      h("span", { class: "hench-run-chip" }, fmtTokens(totalTokens) + " tokens"),
      h("span", { class: `hench-run-model hench-run-model-${run.model}` }, run.model),
      counts && counts.filesChanged > 0
        ? h("span", { class: "hench-run-chip" },
            `${counts.filesChanged} file${counts.filesChanged === 1 ? "" : "s"} changed`,
          )
        : null,
    ),
  );
}

/** Detail panel for the selected run. */
function RunDetailView({ run, onBack, navigateTo }: { run: RunDetail; onBack: () => void; navigateTo?: NavigateTo }) {
  const status = getStatusConfig(run.status);
  const totalTokens = (run.tokenUsage.input ?? 0)
    + (run.tokenUsage.output ?? 0)
    + (run.tokenUsage.cacheCreationInput ?? 0)
    + (run.tokenUsage.cacheReadInput ?? 0);
  const counts = run.structuredSummary?.counts;

  return h("div", { class: "hench-run-detail" },
    // Back button + header
    h("div", { class: "hench-detail-header" },
      h("button", {
        class: "hench-back-btn",
        onClick: onBack,
        "aria-label": "Back to runs list",
      }, "← Back"),
      h("div", { class: "hench-detail-title-row" },
        h("span", {
          class: "hench-run-status",
          style: `color: ${status.color}; font-size: 18px`,
        }, status.icon),
        h("h2", null, run.taskTitle),
      ),
    ),

    // Rex Task link — bidirectional navigation
    run.taskId
      ? h("div", { class: "hench-detail-section hench-detail-task-section" },
          h("h3", null, "Rex Task"),
          h("div", { class: "hench-detail-task-card" },
            h(RexTaskLink, {
              task: {
                id: run.taskId,
                title: run.taskTitle,
                status: run.taskStatus ?? "pending",
              },
              navigateTo,
              showStatus: true,
              showLevel: false,
            }),
            h("div", { class: "hench-detail-task-id" }, run.taskId),
          ),
        )
      : null,

    // Info grid
    h("div", { class: "hench-detail-info" },
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Status"),
        h("span", { class: "hench-info-value", style: `color: ${status.color}` }, status.label),
      ),
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Started"),
        h("span", { class: "hench-info-value" }, new Date(run.startedAt).toLocaleString()),
      ),
      run.finishedAt
        ? h("div", { class: "hench-info-row" },
            h("span", { class: "hench-info-label" }, "Duration"),
            h("span", { class: "hench-info-value" }, fmtDuration(run.startedAt, run.finishedAt)),
          )
        : null,
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Model"),
        h("span", { class: "hench-info-value" }, run.model),
      ),
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Turns"),
        h("span", { class: "hench-info-value" }, String(run.turns)),
      ),
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Tokens"),
        h("span", { class: "hench-info-value" }, fmtTokens(totalTokens)),
      ),
      h("div", { class: "hench-info-row" },
        h("span", { class: "hench-info-label" }, "Run ID"),
        h("span", { class: "hench-info-value hench-info-mono" }, run.id),
      ),
    ),

    // Activity counts
    counts
      ? h("div", { class: "hench-detail-section" },
          h("h3", null, "Activity"),
          h("div", { class: "hench-activity-grid" },
            counts.filesRead > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.filesRead)),
                  h("span", { class: "hench-activity-label" }, "Files Read"),
                )
              : null,
            counts.filesChanged > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.filesChanged)),
                  h("span", { class: "hench-activity-label" }, "Files Changed"),
                )
              : null,
            counts.commandsExecuted > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.commandsExecuted)),
                  h("span", { class: "hench-activity-label" }, "Commands"),
                )
              : null,
            counts.testsRun > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.testsRun)),
                  h("span", { class: "hench-activity-label" }, "Tests Run"),
                )
              : null,
            counts.toolCallsTotal > 0
              ? h("div", { class: "hench-activity-item" },
                  h("span", { class: "hench-activity-val" }, String(counts.toolCallsTotal)),
                  h("span", { class: "hench-activity-label" }, "Tool Calls"),
                )
              : null,
          ),
        )
      : null,

    // Token breakdown
    h("div", { class: "hench-detail-section" },
      h("h3", null, "Token Breakdown"),
      h("div", { class: "hench-token-grid" },
        h("div", { class: "hench-token-item" },
          h("span", { class: "hench-token-val" }, fmtTokens(run.tokenUsage.input ?? 0)),
          h("span", { class: "hench-token-label" }, "Input"),
        ),
        h("div", { class: "hench-token-item" },
          h("span", { class: "hench-token-val" }, fmtTokens(run.tokenUsage.output ?? 0)),
          h("span", { class: "hench-token-label" }, "Output"),
        ),
        run.tokenUsage.cacheCreationInput
          ? h("div", { class: "hench-token-item" },
              h("span", { class: "hench-token-val" }, fmtTokens(run.tokenUsage.cacheCreationInput)),
              h("span", { class: "hench-token-label" }, "Cache Write"),
            )
          : null,
        run.tokenUsage.cacheReadInput
          ? h("div", { class: "hench-token-item" },
              h("span", { class: "hench-token-val" }, fmtTokens(run.tokenUsage.cacheReadInput)),
              h("span", { class: "hench-token-label" }, "Cache Read"),
            )
          : null,
      ),
    ),

    // Error message
    run.error
      ? h("div", { class: "hench-detail-section" },
          h("h3", null, "Error"),
          h("pre", { class: "hench-error-box" }, run.error),
        )
      : null,

    // Summary (markdown text rendered as plain text for now)
    run.summary
      ? h("div", { class: "hench-detail-section" },
          h("h3", null, "Summary"),
          h("pre", { class: "hench-summary-box" }, run.summary),
        )
      : null,
  );
}

// ── Main view ────────────────────────────────────────────────────────

export interface HenchRunsViewProps {
  navigateTo?: NavigateTo;
}

export function HenchRunsView({ navigateTo }: HenchRunsViewProps = {}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch the runs list
  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/runs");
      if (!res.ok) {
        setError(`Failed to load runs (${res.status})`);
        return;
      }
      const json = await res.json();
      setRuns(json.runs ?? []);
      setError(null);
    } catch {
      setError("Could not fetch runs. Is the server running?");
    }
  }, []);

  useEffect(() => {
    fetchRuns().then(() => setLoading(false));
    const interval = setInterval(fetchRuns, 10_000);
    return () => clearInterval(interval);
  }, [fetchRuns]);

  // Fetch detail for a specific run
  const fetchDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/hench/runs/${id}`);
      if (!res.ok) {
        setRunDetail(null);
        return;
      }
      const json = await res.json();
      setRunDetail(json);
    } catch {
      setRunDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleSelectRun = useCallback((id: string) => {
    if (selectedRunId === id) {
      // Toggle off
      setSelectedRunId(null);
      setRunDetail(null);
    } else {
      setSelectedRunId(id);
      fetchDetail(id);
    }
  }, [selectedRunId, fetchDetail]);

  const handleBack = useCallback(() => {
    setSelectedRunId(null);
    setRunDetail(null);
  }, []);

  // Filter runs by status
  const filteredRuns = useMemo(() => {
    if (statusFilter === "all") return runs;
    if (statusFilter === "failed") {
      return runs.filter((r) => r.status === "failed" || r.status === "error");
    }
    return runs.filter((r) => r.status === statusFilter);
  }, [runs, statusFilter]);

  // Status counts for the filter buttons
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: runs.length, completed: 0, failed: 0, running: 0 };
    for (const r of runs) {
      if (r.status === "completed") counts.completed++;
      else if (r.status === "failed" || r.status === "error") counts.failed++;
      else if (r.status === "running" || r.status === "in_progress") counts.running++;
    }
    return counts;
  }, [runs]);

  // ── Loading state ──
  if (loading) {
    return h("div", { class: "loading" }, "Loading execution history...");
  }

  // ── Error state ──
  if (error) {
    return h("div", { class: "prd-empty" },
      h("p", null, error),
      h("button", { class: "btn", onClick: fetchRuns }, "Retry"),
    );
  }

  // ── Empty state ──
  if (runs.length === 0) {
    return h("div", { class: "hench-runs-container" },
      h("div", { class: "hench-runs-header" },
        h(BrandedHeader, { product: "hench", title: "Hench", class: "branded-header-hench" }),
        h("h2", null, "Execution History"),
      ),
      h("div", { class: "hench-empty" },
        h("div", { class: "hench-empty-icon" }, "▶"),
        h("p", null, "No runs yet."),
        h("p", { class: "hench-empty-hint" }, "Run ", h("code", null, "ndx work"), " to start executing tasks."),
      ),
    );
  }

  // ── Detail view ──
  if (selectedRunId && !detailLoading && runDetail) {
    return h("div", { class: "hench-runs-container" },
      h(RunDetailView, { run: runDetail, onBack: handleBack, navigateTo }),
    );
  }

  if (selectedRunId && detailLoading) {
    return h("div", { class: "hench-runs-container" },
      h("div", { class: "loading" }, "Loading run detail..."),
    );
  }

  // ── List view ──
  return h("div", { class: "hench-runs-container" },
    h("div", { class: "hench-runs-header" },
      h(BrandedHeader, { product: "hench", title: "Hench", class: "branded-header-hench" }),
      h("div", { class: "hench-runs-title-row" },
        h("h2", null, "Execution History"),
        h("div", { class: "hench-runs-count" }, `${runs.length} run${runs.length === 1 ? "" : "s"}`),
      ),
    ),

    // Aggregate metrics
    h(RunMetrics, { runs }),

    // Filter bar
    h("div", { class: "hench-filter-bar" },
      (["all", "completed", "failed", "running"] as const).map((key) =>
        h("button", {
          key,
          class: `toggle-btn${statusFilter === key ? " active" : ""}`,
          onClick: () => setStatusFilter(key),
        },
          key === "all" ? "All" : key.charAt(0).toUpperCase() + key.slice(1),
          statusCounts[key] > 0
            ? h("span", { class: "hench-filter-count" }, ` (${statusCounts[key]})`)
            : null,
        ),
      ),
    ),

    // Runs list
    h("div", { class: "hench-runs-list" },
      filteredRuns.map((run) =>
        h(RunCard, {
          key: run.id,
          run,
          isSelected: selectedRunId === run.id,
          onClick: () => handleSelectRun(run.id),
          navigateTo,
        }),
      ),
      filteredRuns.length === 0
        ? h("div", { class: "hench-no-results" }, "No runs match the selected filter.")
        : null,
    ),
  );
}

/**
 * Workflow Optimization view — displays analysis of run history with
 * actionable suggestions that users can preview, accept, reject, or defer.
 *
 * Data comes from:
 *   GET  /api/hench/workflow/analysis   (full analysis + suggestions)
 *   POST /api/hench/workflow/apply      (apply config changes, with preview)
 *   POST /api/hench/workflow/suggestions/:id (record decision)
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

// ── Types ────────────────────────────────────────────────────────────

type SuggestionCategory =
  | "token-efficiency"
  | "failure-prevention"
  | "turn-optimization"
  | "config-tuning"
  | "task-health";

type SuggestionPriority = "high" | "medium" | "low";

interface WorkflowSuggestion {
  id: string;
  category: SuggestionCategory;
  priority: SuggestionPriority;
  title: string;
  description: string;
  rationale: string;
  impact: string;
  configChanges?: Record<string, unknown>;
  affectedTaskIds?: string[];
  autoApplicable: boolean;
}

interface WorkflowStats {
  successRate: number;
  avgTurns: number;
  avgTokensPerRun: number;
  avgDurationMs: number;
  failuresByStatus: Record<string, number>;
  troubleTaskIds: string[];
  turnLimitHits: number;
  budgetExceededCount: number;
}

interface AnalysisResponse {
  totalRuns: number;
  timeRange: { earliest: string; latest: string } | null;
  stats: WorkflowStats;
  suggestions: WorkflowSuggestion[];
  decisionHistory: { total: number; accepted: number; rejected: number; deferred: number };
}

interface PreviewDiff {
  path: string;
  oldValue: unknown;
  newValue: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  "token-efficiency": "Token Efficiency",
  "failure-prevention": "Failure Prevention",
  "turn-optimization": "Turn Optimization",
  "config-tuning": "Config Tuning",
  "task-health": "Task Health",
};

const CATEGORY_ICONS: Record<string, string> = {
  "token-efficiency": "\u229A",
  "failure-prevention": "\u26A0",
  "turn-optimization": "\u21BB",
  "config-tuning": "\u2699",
  "task-health": "\u2764",
};

const PRIORITY_CLASSES: Record<string, string> = {
  high: "wf-priority-high",
  medium: "wf-priority-medium",
  low: "wf-priority-low",
};

function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

// ── Stats section ────────────────────────────────────────────────────

function StatsOverview({ stats, totalRuns, timeRange }: {
  stats: WorkflowStats;
  totalRuns: number;
  timeRange: { earliest: string; latest: string } | null;
}) {
  return h("div", { class: "wf-stats" },
    h("div", { class: "wf-stats-grid" },
      h("div", { class: "wf-stat-card" },
        h("div", { class: "wf-stat-value" }, String(totalRuns)),
        h("div", { class: "wf-stat-label" }, "Total Runs"),
      ),
      h("div", { class: `wf-stat-card${stats.successRate < 0.5 ? " wf-stat-warn" : ""}` },
        h("div", { class: "wf-stat-value" }, formatPercent(stats.successRate)),
        h("div", { class: "wf-stat-label" }, "Success Rate"),
      ),
      h("div", { class: "wf-stat-card" },
        h("div", { class: "wf-stat-value" }, stats.avgTurns.toFixed(1)),
        h("div", { class: "wf-stat-label" }, "Avg Turns"),
      ),
      h("div", { class: "wf-stat-card" },
        h("div", { class: "wf-stat-value" }, formatNumber(stats.avgTokensPerRun)),
        h("div", { class: "wf-stat-label" }, "Avg Tokens/Run"),
      ),
      h("div", { class: "wf-stat-card" },
        h("div", { class: "wf-stat-value" }, formatDuration(stats.avgDurationMs)),
        h("div", { class: "wf-stat-label" }, "Avg Duration"),
      ),
      stats.turnLimitHits > 0
        ? h("div", { class: "wf-stat-card wf-stat-warn" },
            h("div", { class: "wf-stat-value" }, String(stats.turnLimitHits)),
            h("div", { class: "wf-stat-label" }, "Turn Limit Hits"),
          )
        : null,
    ),
    timeRange
      ? h("div", { class: "wf-stats-time-range" },
          "Analysis covers: ",
          h("strong", null, new Date(timeRange.earliest).toLocaleDateString()),
          " \u2014 ",
          h("strong", null, new Date(timeRange.latest).toLocaleDateString()),
        )
      : null,

    // Failure breakdown
    Object.keys(stats.failuresByStatus).length > 0
      ? h("div", { class: "wf-failure-breakdown" },
          h("h4", null, "Failure Breakdown"),
          h("div", { class: "wf-failure-chips" },
            ...Object.entries(stats.failuresByStatus).map(([status, count]) =>
              h("span", { key: status, class: "wf-failure-chip" },
                h("span", { class: "wf-failure-chip-count" }, String(count)),
                h("span", { class: "wf-failure-chip-label" }, status),
              ),
            ),
          ),
        )
      : null,
  );
}

// ── Preview diff ─────────────────────────────────────────────────────

function PreviewPanel({ diff, onApply, onCancel, applying }: {
  diff: PreviewDiff[];
  onApply: () => void;
  onCancel: () => void;
  applying: boolean;
}) {
  return h("div", { class: "wf-preview-panel" },
    h("h4", null, "Preview Changes"),
    h("table", { class: "wf-preview-table" },
      h("thead", null,
        h("tr", null,
          h("th", null, "Setting"),
          h("th", null, "Current"),
          h("th", null, "New"),
        ),
      ),
      h("tbody", null,
        ...diff.map((d) =>
          h("tr", { key: d.path },
            h("td", { class: "wf-preview-path" }, d.path),
            h("td", { class: "wf-preview-old" }, formatValue(d.oldValue)),
            h("td", { class: "wf-preview-new" }, formatValue(d.newValue)),
          ),
        ),
      ),
    ),
    h("div", { class: "wf-preview-actions" },
      h("button", {
        class: "wf-btn wf-btn-primary",
        onClick: onApply,
        disabled: applying,
      }, applying ? "Applying..." : "Apply Changes"),
      h("button", {
        class: "wf-btn wf-btn-secondary",
        onClick: onCancel,
        disabled: applying,
      }, "Cancel"),
    ),
  );
}

// ── Suggestion card ──────────────────────────────────────────────────

function SuggestionCard({ suggestion, onPreview, onDecision, decidingId }: {
  suggestion: WorkflowSuggestion;
  onPreview: (s: WorkflowSuggestion) => void;
  onDecision: (id: string, decision: "rejected" | "deferred", s: WorkflowSuggestion) => Promise<void>;
  decidingId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isDeciding = decidingId === suggestion.id;

  return h("div", { class: `wf-suggestion-card ${PRIORITY_CLASSES[suggestion.priority] ?? ""}` },
    h("div", { class: "wf-suggestion-header", onClick: () => setExpanded(!expanded) },
      h("div", { class: "wf-suggestion-title-row" },
        h("span", { class: "wf-suggestion-icon" },
          CATEGORY_ICONS[suggestion.category] ?? "\u2022",
        ),
        h("h3", { class: "wf-suggestion-title" }, suggestion.title),
        h("span", { class: `wf-suggestion-priority-badge ${PRIORITY_CLASSES[suggestion.priority] ?? ""}` },
          suggestion.priority,
        ),
      ),
      h("span", { class: "wf-suggestion-category" },
        CATEGORY_LABELS[suggestion.category] ?? suggestion.category,
      ),
    ),

    h("div", { class: "wf-suggestion-body" },
      h("p", { class: "wf-suggestion-description" }, suggestion.description),
    ),

    expanded
      ? h("div", { class: "wf-suggestion-detail" },
          h("div", { class: "wf-suggestion-detail-section" },
            h("h4", null, "Rationale"),
            h("p", null, suggestion.rationale),
          ),
          h("div", { class: "wf-suggestion-detail-section" },
            h("h4", null, "Expected Impact"),
            h("p", null, suggestion.impact),
          ),
          suggestion.configChanges && Object.keys(suggestion.configChanges).length > 0
            ? h("div", { class: "wf-suggestion-detail-section" },
                h("h4", null, "Config Changes"),
                h("div", { class: "wf-config-changes" },
                  ...Object.entries(suggestion.configChanges).map(([key, value]) =>
                    h("div", { key, class: "wf-config-change-row" },
                      h("code", null, key),
                      h("span", null, " \u2192 "),
                      h("code", { class: "wf-config-new-value" }, formatValue(value)),
                    ),
                  ),
                ),
              )
            : null,
          suggestion.affectedTaskIds && suggestion.affectedTaskIds.length > 0
            ? h("div", { class: "wf-suggestion-detail-section" },
                h("h4", null, `Affected Tasks (${suggestion.affectedTaskIds.length})`),
                h("div", { class: "wf-affected-tasks" },
                  ...suggestion.affectedTaskIds.map((id) =>
                    h("code", { key: id, class: "wf-task-id" }, id.slice(0, 8)),
                  ),
                ),
              )
            : null,
        )
      : null,

    h("div", { class: "wf-suggestion-actions" },
      h("button", {
        class: "wf-btn wf-btn-expand",
        onClick: () => setExpanded(!expanded),
      }, expanded ? "Less" : "Details"),
      suggestion.autoApplicable
        ? h("button", {
            class: "wf-btn wf-btn-primary",
            onClick: () => onPreview(suggestion),
            disabled: isDeciding,
          }, "Preview & Apply")
        : null,
      h("button", {
        class: "wf-btn wf-btn-secondary",
        onClick: () => onDecision(suggestion.id, "deferred", suggestion),
        disabled: isDeciding,
      }, "Defer"),
      h("button", {
        class: "wf-btn wf-btn-reject",
        onClick: () => onDecision(suggestion.id, "rejected", suggestion),
        disabled: isDeciding,
      }, "Dismiss"),
    ),
  );
}

// ── Decision history bar ─────────────────────────────────────────────

function DecisionHistoryBar({ history }: {
  history: { total: number; accepted: number; rejected: number; deferred: number };
}) {
  if (history.total === 0) return null;

  return h("div", { class: "wf-history-bar" },
    h("span", { class: "wf-history-label" }, "Past decisions: "),
    h("span", { class: "wf-history-stat wf-history-accepted" },
      `${history.accepted} accepted`,
    ),
    h("span", { class: "wf-history-stat wf-history-rejected" },
      `${history.rejected} dismissed`,
    ),
    h("span", { class: "wf-history-stat wf-history-deferred" },
      `${history.deferred} deferred`,
    ),
  );
}

// ── Main view ────────────────────────────────────────────────────────

export function WorkflowOptimizationView() {
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [previewSuggestion, setPreviewSuggestion] = useState<WorkflowSuggestion | null>(null);
  const [previewDiff, setPreviewDiff] = useState<PreviewDiff[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchAnalysis = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/workflow/analysis");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load analysis");
        return;
      }
      const json = await res.json() as AnalysisResponse;
      setAnalysis(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow analysis");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnalysis();
  }, [fetchAnalysis]);

  // Filter suggestions by category
  const filteredSuggestions = useMemo(() => {
    if (!analysis) return [];
    if (filterCategory === "all") return analysis.suggestions;
    return analysis.suggestions.filter((s) => s.category === filterCategory);
  }, [analysis, filterCategory]);

  // Unique categories for filter dropdown
  const categories = useMemo(() => {
    if (!analysis) return [];
    const cats = new Set(analysis.suggestions.map((s) => s.category));
    return [...cats];
  }, [analysis]);

  // Preview a suggestion's config changes
  const handlePreview = useCallback(async (suggestion: WorkflowSuggestion) => {
    if (!suggestion.configChanges) return;
    setPreviewSuggestion(suggestion);

    try {
      const res = await fetch("/api/hench/workflow/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: suggestion.configChanges,
          preview: true,
        }),
      });
      if (!res.ok) {
        showToast("Failed to preview changes");
        return;
      }
      const json = await res.json() as { diff: PreviewDiff[] };
      setPreviewDiff(json.diff);
    } catch {
      showToast("Error previewing changes");
    }
  }, [showToast]);

  // Apply config changes
  const handleApply = useCallback(async () => {
    if (!previewSuggestion?.configChanges) return;
    setApplying(true);

    try {
      const res = await fetch("/api/hench/workflow/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changes: previewSuggestion.configChanges,
          suggestionId: previewSuggestion.id,
          title: previewSuggestion.title,
          category: previewSuggestion.category,
        }),
      });
      if (!res.ok) {
        showToast("Failed to apply changes");
        return;
      }
      showToast("Changes applied successfully");
      setPreviewSuggestion(null);
      setPreviewDiff(null);
      // Refresh analysis after applying
      await fetchAnalysis();
    } catch {
      showToast("Error applying changes");
    } finally {
      setApplying(false);
    }
  }, [previewSuggestion, showToast, fetchAnalysis]);

  // Record a decision (reject/defer)
  const handleDecision = useCallback(async (
    id: string,
    decision: "rejected" | "deferred",
    suggestion: WorkflowSuggestion,
  ) => {
    setDecidingId(id);
    try {
      const res = await fetch(`/api/hench/workflow/suggestions/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          title: suggestion.title,
          category: suggestion.category,
        }),
      });
      if (!res.ok) {
        showToast("Failed to record decision");
        return;
      }
      showToast(`Suggestion ${decision === "rejected" ? "dismissed" : "deferred"}`);
      // Remove from suggestions list optimistically
      setAnalysis((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          suggestions: prev.suggestions.filter((s) => s.id !== id),
          decisionHistory: {
            ...prev.decisionHistory,
            total: prev.decisionHistory.total + 1,
            [decision]: (prev.decisionHistory as Record<string, number>)[decision] + 1,
          },
        };
      });
    } catch {
      showToast("Error recording decision");
    } finally {
      setDecidingId(null);
    }
  }, [showToast]);

  // ── Render ──

  if (loading) {
    return h("div", { class: "wf-container" },
      h("div", { class: "loading" }, "Analyzing workflow..."),
    );
  }

  if (error) {
    return h("div", { class: "wf-container" },
      h(BrandedHeader, { product: "hench", title: "Workflow Optimization" }),
      h("div", { class: "wf-error" },
        h("p", null, error),
        h("p", { class: "wf-error-hint" },
          "Make sure ",
          h("code", null, ".hench/runs/"),
          " exists with run data. Run ",
          h("code", null, "hench run"),
          " to generate data.",
        ),
      ),
    );
  }

  if (!analysis || analysis.totalRuns === 0) {
    return h("div", { class: "wf-container" },
      h(BrandedHeader, { product: "hench", title: "Workflow Optimization" }),
      h("div", { class: "wf-empty" },
        h("p", null, "No run data available for analysis."),
        h("p", { class: "wf-empty-hint" },
          "Execute some tasks with ",
          h("code", null, "ndx work"),
          " to generate workflow data.",
        ),
      ),
    );
  }

  return h("div", { class: "wf-container" },
    h("div", { class: "wf-header" },
      h(BrandedHeader, { product: "hench", title: "Workflow Optimization" }),
      h("p", { class: "wf-subtitle" },
        "Analyzes your agent execution history to identify bottlenecks and suggest optimizations.",
      ),
    ),

    // Stats overview
    h(StatsOverview, {
      stats: analysis.stats,
      totalRuns: analysis.totalRuns,
      timeRange: analysis.timeRange,
    }),

    // Decision history
    h(DecisionHistoryBar, { history: analysis.decisionHistory }),

    // Suggestions section
    h("div", { class: "wf-suggestions-section" },
      h("div", { class: "wf-suggestions-header" },
        h("h2", null,
          `Suggestions (${filteredSuggestions.length})`,
        ),
        categories.length > 1
          ? h("select", {
              class: "wf-category-filter",
              value: filterCategory,
              onChange: (e: Event) => setFilterCategory((e.target as HTMLSelectElement).value),
            },
              h("option", { value: "all" }, "All Categories"),
              ...categories.map((cat) =>
                h("option", { key: cat, value: cat },
                  `${CATEGORY_ICONS[cat] ?? ""} ${CATEGORY_LABELS[cat] ?? cat}`,
                ),
              ),
            )
          : null,
      ),

      filteredSuggestions.length === 0
        ? h("div", { class: "wf-no-suggestions" },
            h("p", null, "\u2713 No optimization suggestions at this time. Your workflow is looking good!"),
          )
        : h("div", { class: "wf-suggestions-list" },
            ...filteredSuggestions.map((s) =>
              h(SuggestionCard, {
                key: s.id,
                suggestion: s,
                onPreview: handlePreview,
                onDecision: handleDecision,
                decidingId,
              }),
            ),
          ),
    ),

    // Preview panel (overlay)
    previewSuggestion && previewDiff
      ? h("div", { class: "wf-preview-overlay" },
          h("div", { class: "wf-preview-container" },
            h("h3", null, `Applying: ${previewSuggestion.title}`),
            h(PreviewPanel, {
              diff: previewDiff,
              onApply: handleApply,
              onCancel: () => { setPreviewSuggestion(null); setPreviewDiff(null); },
              applying,
            }),
          ),
        )
      : null,

    // Toast
    toast
      ? h("div", { class: "wf-toast" },
          h("span", null, toast),
        )
      : null,
  );
}

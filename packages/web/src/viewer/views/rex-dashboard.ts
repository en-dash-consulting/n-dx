/**
 * Rex Dashboard view — PRD status overview with completion stats,
 * per-epic progress bars, priority distribution, and next task highlight.
 *
 * Fetches data from /api/rex/dashboard which combines stats, epic-level
 * progress, priority distribution, and the next actionable task.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import type { ViewId, NavigateTo } from "../types.js";
import { BrandedHeader } from "../components/logos.js";
import { RexTaskLink } from "../components/rex-task-link.js";
import { ExecutionPanel } from "../components/prd-tree/execution-panel.js";
import { SmartAddInput } from "../components/prd-tree/index.js";
import { HealthGauge } from "../visualization/index.js";
import { ReorganizePanel } from "../components/prd-tree/reorganize-panel.js";
import { usePolling } from "../hooks/index.js";

// ── Types ────────────────────────────────────────────────────────────

interface TreeStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  deferred: number;
  blocked: number;
}

interface EpicStats {
  id: string;
  title: string;
  status: string;
  priority?: string;
  stats: TreeStats;
  percentComplete: number;
}

interface PriorityDistribution {
  critical: number;
  high: number;
  medium: number;
  low: number;
  unset: number;
}

interface NextTask {
  id: string;
  title: string;
  level: string;
  status: string;
  priority?: string;
  description?: string;
  tags?: string[];
}

interface HealthDimensions {
  depth: number;
  balance: number;
  granularity: number;
  completeness: number;
  staleness: number;
}

interface HealthData {
  overall: number;
  dimensions: HealthDimensions;
  suggestions: string[];
}

interface DashboardData {
  title: string;
  stats: TreeStats;
  percentComplete: number;
  epics: EpicStats[];
  nextTask: NextTask | null;
  priorities: PriorityDistribution;
}

// ── Status config ────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  completed: "●",
  in_progress: "◐",
  pending: "○",
  deferred: "◌",
  blocked: "⊘",
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  in_progress: "In Progress",
  pending: "Pending",
  deferred: "Deferred",
  blocked: "Blocked",
};

// ── Props ────────────────────────────────────────────────────────────

export interface RexDashboardProps {
  navigateTo?: NavigateTo;
}

// ── Sub-components ───────────────────────────────────────────────────

/** Segmented progress bar showing status distribution */
function StatusProgressBar({ stats, percentComplete }: { stats: TreeStats; percentComplete: number }) {
  if (stats.total === 0) return null;

  const segments = [
    { key: "completed", count: stats.completed, cls: "prd-status-bg-completed" },
    { key: "in_progress", count: stats.inProgress, cls: "prd-status-bg-in_progress" },
    { key: "pending", count: stats.pending, cls: "prd-status-bg-pending" },
    { key: "blocked", count: stats.blocked, cls: "prd-status-bg-blocked" },
    { key: "deferred", count: stats.deferred, cls: "prd-status-bg-deferred" },
  ].filter((s) => s.count > 0);

  return h("div", { class: "rex-dash-progress" },
    h("div", { class: "rex-dash-progress-header" },
      h("span", { class: "rex-dash-progress-label" }, "Overall Progress"),
      h("span", { class: "rex-dash-progress-pct" }, `${percentComplete}%`),
    ),
    h("div", {
      class: "rex-dash-progress-bar",
      role: "progressbar",
      "aria-valuenow": String(percentComplete),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-label": `Overall completion: ${percentComplete}%`,
    },
      ...segments.map((seg) =>
        h("div", {
          key: seg.key,
          class: `rex-dash-progress-seg ${seg.cls}`,
          style: `width: ${(seg.count / stats.total) * 100}%`,
          title: `${STATUS_LABELS[seg.key] ?? seg.key}: ${seg.count}`,
        }),
      ),
    ),
    h("div", { class: "rex-dash-progress-legend" },
      ...segments.map((seg) =>
        h("span", { key: seg.key, class: "rex-dash-legend-item" },
          h("span", { class: `prd-status-dot prd-status-${seg.key.replace("_", "-")}` }),
          h("span", { class: "rex-dash-legend-label" }, STATUS_LABELS[seg.key] ?? seg.key),
          h("span", { class: "rex-dash-legend-count" }, String(seg.count)),
        ),
      ),
    ),
  );
}

/** Metric stat inline chip */
function StatChip({ value, label, color, accent }: {
  value: number;
  label: string;
  color?: string;
  accent?: boolean;
}) {
  return h("div", { class: `rex-dash-stat${accent ? " rex-dash-stat-accent" : ""}` },
    h("span", { class: "rex-dash-stat-value", style: color ? `color: ${color}` : "" }, String(value)),
    h("span", { class: "rex-dash-stat-label" }, label),
  );
}

/** Quick action button for starting the next task */
function StartButton({ taskId, onStarted }: { taskId: string; onStarted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = useCallback(async (e: Event) => {
    e.stopPropagation();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/rex/items/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start task");
      setTimeout(() => setError(null), 4000);
    } finally {
      setLoading(false);
    }
  }, [taskId, onStarted]);

  return h("div", { class: "rex-dash-start-wrapper" },
    h("button", {
      class: "rex-dash-start-btn",
      onClick: handleStart,
      disabled: loading,
      "aria-label": "Start this task",
    }, loading ? "Starting…" : "Start Task"),
    error
      ? h("div", { class: "rex-dash-start-error", role: "alert" }, error)
      : null,
  );
}

/** Epic card with enhanced progress and status display */
function EpicCard({ epic, navigateTo }: { epic: EpicStats; navigateTo?: NavigateTo }) {
  const { stats } = epic;
  const isComplete = epic.percentComplete >= 100;
  const isActive = epic.status === "in_progress";

  // Progress bar color based on completion
  const fillClass = isComplete ? "done" : epic.percentComplete >= 50 ? "mid" : "";

  return h("div", {
    class: [
      "rex-dash-epic",
      isComplete ? "rex-dash-epic-done" : "",
      isActive ? "rex-dash-epic-active" : "",
    ].filter(Boolean).join(" "),
  },
    h("div", { class: "rex-dash-epic-top" },
      h("div", { class: "rex-dash-epic-info" },
        h(RexTaskLink, {
          task: { id: epic.id, title: epic.title, status: epic.status, level: "epic", priority: epic.priority },
          navigateTo,
          compact: true,
          showStatus: true,
          class: "rex-dash-epic-link",
        }),
        stats.inProgress > 0
          ? h("span", { class: "status-badge status-badge--in_progress" },
              `${stats.inProgress} active`,
            )
          : null,
        stats.blocked > 0
          ? h("span", { class: "status-badge status-badge--blocked" },
              `${stats.blocked} blocked`,
            )
          : null,
      ),
      h("span", {
        class: `rex-dash-epic-pct${isComplete ? " done" : ""}`,
      }, `${epic.percentComplete}%`),
    ),
    h("div", { class: "rex-dash-epic-bar" },
      h("div", { class: "rex-dash-epic-track" },
        stats.total > 0
          ? h("div", {
              class: `rex-dash-epic-fill${fillClass ? ` ${fillClass}` : ""}`,
              style: `width: ${epic.percentComplete}%`,
            })
          : null,
      ),
      h("span", { class: "rex-dash-epic-count" },
        `${stats.completed}/${stats.total}`,
      ),
    ),
  );
}

// ── Component ────────────────────────────────────────────────────────

export function RexDashboard({ navigateTo }: RexDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [reorgOpen, setReorgOpen] = useState(false);
  const [reorgCount, setReorgCount] = useState(0);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/rex/dashboard");
      if (!res.ok) {
        if (res.status === 404) {
          setError("No PRD data found. Run 'rex init' then 'rex analyze' to create one.");
        } else {
          setError(`Failed to load dashboard data (${res.status})`);
        }
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (_err) {
      setError("Could not fetch dashboard data. Is the server running?");
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/rex/health");
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch {
      // Non-critical — silently skip
    }
  }, []);

  const fetchReorgCount = useCallback(async () => {
    try {
      const res = await fetch("/api/rex/reorganize?mode=fast");
      if (res.ok) {
        const data = await res.json();
        setReorgCount(data.proposals?.length ?? 0);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchDashboard(), fetchHealth()])
      .then(() => setLoading(false));
    // Reorg count is non-critical and can be slow — don't block initial render
    fetchReorgCount();
  }, [fetchDashboard, fetchHealth, fetchReorgCount]);

  // Visibility-aware polling via polling manager
  usePolling("rex-dashboard", fetchDashboard, 10_000);

  if (loading) {
    return h("div", { class: "loading" }, "Loading PRD dashboard...");
  }

  if (error) {
    return h("div", { class: "prd-empty" },
      h("p", null, error),
    );
  }

  if (!data) {
    return h("div", { class: "prd-empty" },
      h("p", null, "No PRD data available."),
    );
  }

  const { stats, percentComplete, epics, nextTask, priorities } = data;

  // Sort epics: in_progress first, then pending, then by completion
  const sortedEpics = useMemo(() => {
    return [...epics].sort((a, b) => {
      const statusOrder: Record<string, number> = {
        in_progress: 0,
        pending: 1,
        blocked: 2,
        deferred: 3,
        completed: 4,
      };
      const aOrder = statusOrder[a.status] ?? 1;
      const bOrder = statusOrder[b.status] ?? 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Within same status, sort by completion descending
      return b.percentComplete - a.percentComplete;
    });
  }, [epics]);

  // Priority data for the distribution chart
  const priorityEntries = useMemo(() => {
    return [
      { label: "Critical", count: priorities.critical, color: "var(--red)", cls: "critical" },
      { label: "High", count: priorities.high, color: "var(--orange)", cls: "high" },
      { label: "Medium", count: priorities.medium, color: "var(--text-dim)", cls: "medium" },
      { label: "Low", count: priorities.low, color: "var(--text-dim)", cls: "low" },
    ].filter((p) => p.count > 0);
  }, [priorities]);

  const totalPrioritized = priorityEntries.reduce((s, p) => s + p.count, 0) + priorities.unset;

  // Active epics count for summary
  const activeEpics = epics.filter((e) => e.status === "in_progress").length;

  return h("div", { class: "rex-dash" },
    // ── Header ──────────────────────────────────────────────────────
    h("div", { class: "rex-dash-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("div", { class: "rex-dash-title-row" },
        h("h2", { class: "rex-dash-title" }, data.title),
        h("div", { class: "rex-dash-header-actions" },
          navigateTo
            ? h("button", {
                class: "rex-dash-view-tasks-btn",
                onClick: () => navigateTo("prd" as ViewId),
                "aria-label": "View all tasks in PRD tree",
              }, "View All Tasks →")
            : null,
        ),
      ),
    ),

    // ── Stats row ───────────────────────────────────────────────────
    h("div", { class: "rex-dash-stats" },
      h(StatChip, { value: stats.total, label: "Total" }),
      h(StatChip, { value: stats.completed, label: "Done", color: "var(--green)", accent: true }),
      h(StatChip, { value: stats.inProgress, label: "Active", color: "var(--accent)" }),
      h(StatChip, { value: stats.pending, label: "Pending" }),
      stats.blocked > 0
        ? h(StatChip, { value: stats.blocked, label: "Blocked", color: "var(--red)" })
        : null,
      stats.deferred > 0
        ? h(StatChip, { value: stats.deferred, label: "Deferred", color: "var(--orange)" })
        : null,
    ),

    // ── Progress bar ────────────────────────────────────────────────
    h(StatusProgressBar, { stats, percentComplete }),

    // ── Main content grid ───────────────────────────────────────────
    h("div", { class: "rex-dash-grid" },

      // ── Left column: Next task + Epics ──────────────────────────
      h("div", { class: "rex-dash-main" },

        // Next task highlight — prominent card
        h("div", { class: "rex-dash-next" },
          h("div", { class: "rex-dash-section-header" },
            h("h3", null, "Up Next"),
            activeEpics > 0
              ? h("span", { class: "rex-dash-section-meta" },
                  `${activeEpics} epic${activeEpics !== 1 ? "s" : ""} in progress`,
                )
              : null,
          ),
          nextTask
            ? h("div", { class: `rex-dash-next-card${nextTask.priority === "critical" ? " rex-dash-next-critical" : nextTask.priority === "high" ? " rex-dash-next-high" : ""}` },
                h("div", { class: "rex-dash-next-top" },
                  h("div", { class: "rex-dash-next-badges" },
                    h("span", {
                      class: `prd-status-icon prd-status-${nextTask.status.replace("_", "-")}`,
                    }, STATUS_ICONS[nextTask.status] ?? "○"),
                    h("span", { class: `prd-level-badge prd-level-${nextTask.level}` },
                      nextTask.level.charAt(0).toUpperCase() + nextTask.level.slice(1),
                    ),
                    nextTask.priority
                      ? h("span", { class: `prd-priority-badge prd-priority-${nextTask.priority}` },
                          nextTask.priority,
                        )
                      : null,
                  ),
                  nextTask.status === "pending"
                    ? h(StartButton, { taskId: nextTask.id, onStarted: fetchDashboard })
                    : nextTask.status === "in_progress"
                      ? h("span", { class: "status-badge status-badge--in_progress" }, "In Progress")
                      : null,
                ),
                h(RexTaskLink, {
                  task: { id: nextTask.id, title: nextTask.title, status: nextTask.status, level: nextTask.level, priority: nextTask.priority },
                  navigateTo,
                  showStatus: false,
                  class: "rex-dash-next-link",
                }),
                nextTask.description
                  ? h("div", { class: "rex-dash-next-desc" },
                      nextTask.description.length > 160
                        ? nextTask.description.slice(0, 160) + "…"
                        : nextTask.description,
                    )
                  : null,
                nextTask.tags && nextTask.tags.length > 0
                  ? h("div", { class: "rex-dash-next-tags" },
                      nextTask.tags.map((tag) =>
                        h("span", { key: tag, class: "prd-tag" }, tag),
                      ),
                    )
                  : null,
              )
            : h("div", { class: "rex-dash-next-empty" },
                h("span", { class: "rex-dash-next-empty-icon" }, "✓"),
                h("span", null, "All tasks completed or blocked"),
              ),
        ),

        // Smart Add — prominent section for adding new items
        h("div", { class: "rex-dash-smart-add" },
          h("div", { class: "rex-dash-section-header" },
            h("h3", null, "Quick Add"),
          ),
          h(SmartAddInput, { onPrdChanged: fetchDashboard, compact: true }),
        ),

        // Epic progress list
        h("div", { class: "rex-dash-epics" },
          h("div", { class: "rex-dash-section-header" },
            h("h3", null, "Epic Progress"),
            h("span", { class: "rex-dash-section-meta" },
              `${epics.length} epic${epics.length !== 1 ? "s" : ""}`,
            ),
          ),
          sortedEpics.length > 0
            ? h("div", { class: "rex-dash-epic-list" },
                sortedEpics.map((epic) =>
                  h(EpicCard, { key: epic.id, epic, navigateTo }),
                ),
              )
            : h("div", { class: "rex-dash-empty-hint" }, "No epics defined yet."),
        ),

        // Execution controls
        epics.length > 0
          ? h(ExecutionPanel, { onPrdChanged: fetchDashboard })
          : null,
      ),

      // ── Right sidebar ─────────────────────────────────────────────
      h("div", { class: "rex-dash-sidebar" },

        // Priority distribution
        priorityEntries.length > 0
          ? h("div", { class: "rex-dash-panel" },
              h("h3", { class: "rex-dash-panel-title" }, "Priority Distribution"),
              h("div", { class: "rex-dash-priority-bars" },
                priorityEntries.map((p) =>
                  h("div", { key: p.label, class: "rex-dash-priority-row" },
                    h("span", { class: `rex-dash-priority-label rex-dash-priority-${p.cls}` }, p.label),
                    h("div", { class: "rex-dash-priority-track" },
                      h("div", {
                        class: `rex-dash-priority-fill rex-dash-priority-fill-${p.cls}`,
                        style: `width: ${totalPrioritized > 0 ? (p.count / totalPrioritized) * 100 : 0}%`,
                      }),
                    ),
                    h("span", { class: "rex-dash-priority-count" }, String(p.count)),
                  ),
                ),
              ),
            )
          : null,

        // Structure health card
        health
          ? h("div", { class: "rex-dash-panel" },
              h("h3", { class: "rex-dash-panel-title" }, "Structure Health"),
              h("div", { class: "rex-dash-health" },
                h("div", { class: "rex-dash-health-gauge" },
                  h(HealthGauge, { value: health.overall / 100, label: "Overall", size: 80 }),
                ),
                h("div", { class: "rex-dash-health-dims" },
                  ...(["depth", "balance", "granularity", "completeness", "staleness"] as const).map((dim) =>
                    h("div", { key: dim, class: "rex-dash-health-dim" },
                      h("span", { class: "rex-dash-health-dim-label" },
                        dim.charAt(0).toUpperCase() + dim.slice(1),
                      ),
                      h("div", { class: "rex-dash-health-dim-track" },
                        h("div", {
                          class: `rex-dash-health-dim-fill${health.dimensions[dim] >= 70 ? " good" : health.dimensions[dim] >= 40 ? " mid" : " low"}`,
                          style: `width: ${health.dimensions[dim]}%`,
                        }),
                      ),
                      h("span", { class: "rex-dash-health-dim-val" }, String(Math.round(health.dimensions[dim]))),
                    ),
                  ),
                ),
                health.suggestions.length > 0
                  ? h("ul", { class: "rex-dash-health-suggestions" },
                      health.suggestions.slice(0, 3).map((s, i) =>
                        h("li", { key: i }, s),
                      ),
                    )
                  : null,
              ),
            )
          : null,

        // Status breakdown (small summary)
        h("div", { class: "rex-dash-panel" },
          h("h3", { class: "rex-dash-panel-title" }, "Status Breakdown"),
          h("div", { class: "rex-dash-status-grid" },
            h("div", { class: "rex-dash-status-item" },
              h("span", { class: "prd-status-dot prd-status-completed" }),
              h("span", { class: "rex-dash-status-label" }, "Completed"),
              h("span", { class: "rex-dash-status-count" }, String(stats.completed)),
            ),
            h("div", { class: "rex-dash-status-item" },
              h("span", { class: "prd-status-dot prd-status-in-progress" }),
              h("span", { class: "rex-dash-status-label" }, "In Progress"),
              h("span", { class: "rex-dash-status-count" }, String(stats.inProgress)),
            ),
            h("div", { class: "rex-dash-status-item" },
              h("span", { class: "prd-status-dot prd-status-pending" }),
              h("span", { class: "rex-dash-status-label" }, "Pending"),
              h("span", { class: "rex-dash-status-count" }, String(stats.pending)),
            ),
            stats.blocked > 0
              ? h("div", { class: "rex-dash-status-item" },
                  h("span", { class: "prd-status-dot prd-status-blocked" }),
                  h("span", { class: "rex-dash-status-label" }, "Blocked"),
                  h("span", { class: "rex-dash-status-count" }, String(stats.blocked)),
                )
              : null,
            stats.deferred > 0
              ? h("div", { class: "rex-dash-status-item" },
                  h("span", { class: "prd-status-dot prd-status-deferred" }),
                  h("span", { class: "rex-dash-status-label" }, "Deferred"),
                  h("span", { class: "rex-dash-status-count" }, String(stats.deferred)),
                )
              : null,
          ),
        ),

        // Quick nav to PRD tree
        navigateTo
          ? h("div", { class: "rex-dash-panel rex-dash-panel-actions" },
              h("h3", { class: "rex-dash-panel-title" }, "Quick Actions"),
              h("div", { class: "rex-dash-actions" },
                h("button", {
                  class: "rex-dash-action-btn",
                  onClick: () => navigateTo("prd" as ViewId),
                }, "Browse Tasks"),
                h("button", {
                  class: "rex-dash-action-btn",
                  onClick: () => navigateTo("validation" as ViewId),
                }, "Validate PRD"),
                h("button", {
                  class: `rex-dash-action-btn${reorgCount > 0 ? " rex-dash-action-btn-accent" : ""}`,
                  onClick: () => setReorgOpen(true),
                }, reorgCount > 0 ? `Reorganize (${reorgCount})` : "Reorganize"),
              ),
            )
          : null,
      ),
    ),

    // Reorganize slide-out panel
    h(ReorganizePanel, {
      open: reorgOpen,
      onClose: () => setReorgOpen(false),
      onApplied: () => {
        fetchDashboard();
        fetchHealth();
        fetchReorgCount();
      },
    }),
  );
}

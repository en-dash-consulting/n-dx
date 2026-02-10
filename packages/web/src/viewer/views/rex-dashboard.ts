/**
 * Rex Dashboard view — PRD status overview with completion stats,
 * per-epic progress bars, priority distribution, and next task highlight.
 *
 * Fetches data from /api/rex/dashboard which combines stats, epic-level
 * progress, priority distribution, and the next actionable task.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { MetricCard } from "../components/data-display/health-gauge.js";
import type { ViewId, NavigateTo } from "../types.js";
import { BrandedHeader } from "../components/logos.js";
import { RexTaskLink } from "../components/rex-task-link.js";

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

// ── Component ────────────────────────────────────────────────────────

export function RexDashboard({ navigateTo }: RexDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    fetchDashboard().then(() => setLoading(false));

    // Poll for updates every 10 seconds
    const interval = setInterval(fetchDashboard, 10_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

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
      { label: "Critical", count: priorities.critical, color: "var(--red)" },
      { label: "High", count: priorities.high, color: "var(--orange)" },
      { label: "Medium", count: priorities.medium, color: "var(--text-dim)" },
      { label: "Low", count: priorities.low, color: "var(--text-dim)" },
    ].filter((p) => p.count > 0);
  }, [priorities]);

  const totalPrioritized = priorityEntries.reduce((s, p) => s + p.count, 0) + priorities.unset;

  return h("div", { class: "rex-dashboard" },
    // Header
    h("div", { class: "rex-dashboard-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("div", { class: "rex-dashboard-title-row" },
        h("h2", null, data.title),
        h("div", { class: "rex-dashboard-meta" },
          `${percentComplete}% complete`,
        ),
      ),
    ),

    // Overall completion bar
    h("div", { class: "rex-dashboard-completion" },
      h("div", { class: "rex-dashboard-completion-bar" },
        h("div", {
          class: "rex-dashboard-completion-fill",
          style: `width: ${percentComplete}%`,
          role: "progressbar",
          "aria-valuenow": String(percentComplete),
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-label": `Overall completion: ${percentComplete}%`,
        }),
      ),
    ),

    // Metric cards row
    h("div", { class: "overview-metrics" },
      h(MetricCard, {
        value: stats.total,
        label: "Total Tasks",
      }),
      h(MetricCard, {
        value: stats.completed,
        label: "Completed",
        color: "var(--green)",
      }),
      h(MetricCard, {
        value: stats.inProgress,
        label: "In Progress",
        color: "var(--accent)",
      }),
      h(MetricCard, {
        value: stats.pending,
        label: "Pending",
      }),
      stats.blocked > 0
        ? h(MetricCard, {
            value: stats.blocked,
            label: "Blocked",
            color: "var(--red)",
          })
        : null,
      stats.deferred > 0
        ? h(MetricCard, {
            value: stats.deferred,
            label: "Deferred",
            color: "var(--orange)",
          })
        : null,
    ),

    // Two-column layout: Epics + sidebar
    h("div", { class: "rex-dashboard-columns" },

      // Left: Per-epic progress
      h("div", { class: "rex-dashboard-epics" },
        h("h3", null, "Epic Progress"),
        sortedEpics.length > 0
          ? h("div", { class: "rex-dashboard-epic-list" },
              sortedEpics.map((epic) =>
                h("div", {
                  key: epic.id,
                  class: `rex-dashboard-epic-item${epic.status === "completed" ? " completed" : ""}`,
                },
                  h("div", { class: "rex-dashboard-epic-header" },
                    h(RexTaskLink, {
                      task: { id: epic.id, title: epic.title, status: epic.status, level: "epic", priority: epic.priority },
                      navigateTo,
                      compact: true,
                      showStatus: true,
                      class: "rex-dashboard-epic-link",
                    }),
                    h("span", { class: "rex-dashboard-epic-pct" }, `${epic.percentComplete}%`),
                  ),
                  h("div", { class: "rex-dashboard-epic-bar" },
                    h("div", { class: "rex-dashboard-epic-track" },
                      epic.stats.total > 0
                        ? h("div", {
                            class: `rex-dashboard-epic-fill${epic.percentComplete >= 100 ? " done" : epic.percentComplete >= 50 ? " mid" : ""}`,
                            style: `width: ${epic.percentComplete}%`,
                          })
                        : null,
                    ),
                    h("span", { class: "rex-dashboard-epic-count" },
                      `${epic.stats.completed}/${epic.stats.total}`,
                    ),
                  ),
                ),
              ),
            )
          : h("div", { class: "rex-dashboard-empty-hint" }, "No epics defined yet."),
      ),

      // Right: Next task + Priority distribution
      h("div", { class: "rex-dashboard-sidebar" },

        // Next task highlight
        h("div", { class: "rex-dashboard-next" },
          h("h3", null, "Up Next"),
          nextTask
            ? h("div", { class: "rex-dashboard-next-card" },
                h("div", { class: "rex-dashboard-next-header" },
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
                h(RexTaskLink, {
                  task: { id: nextTask.id, title: nextTask.title, status: nextTask.status, level: nextTask.level, priority: nextTask.priority },
                  navigateTo,
                  showStatus: false,
                  class: "rex-dashboard-next-link",
                }),
                nextTask.description
                  ? h("div", { class: "rex-dashboard-next-desc" },
                      nextTask.description.length > 120
                        ? nextTask.description.slice(0, 120) + "…"
                        : nextTask.description,
                    )
                  : null,
                nextTask.tags && nextTask.tags.length > 0
                  ? h("div", { class: "rex-dashboard-next-tags" },
                      nextTask.tags.map((tag) =>
                        h("span", { key: tag, class: "prd-tag" }, tag),
                      ),
                    )
                  : null,
              )
            : h("div", { class: "rex-dashboard-next-empty" },
                "All tasks completed or blocked",
              ),
        ),

        // Priority distribution
        priorityEntries.length > 0
          ? h("div", { class: "rex-dashboard-priorities" },
              h("h3", null, "Priority Distribution"),
              h("div", { class: "rex-dashboard-priority-bars" },
                priorityEntries.map((p) =>
                  h("div", { key: p.label, class: "rex-dashboard-priority-row" },
                    h("span", { class: "rex-dashboard-priority-label" }, p.label),
                    h("div", { class: "rex-dashboard-priority-track" },
                      h("div", {
                        class: "rex-dashboard-priority-fill",
                        style: `width: ${(p.count / totalPrioritized) * 100}%; background: ${p.color}`,
                      }),
                    ),
                    h("span", { class: "rex-dashboard-priority-count" }, String(p.count)),
                  ),
                ),
              ),
            )
          : null,

        // Status breakdown (small summary)
        h("div", { class: "rex-dashboard-status-summary" },
          h("h3", null, "Status Breakdown"),
          h("div", { class: "prd-summary-bar" },
            stats.completed > 0
              ? h("div", {
                  class: "prd-summary-segment prd-status-bg-completed",
                  style: `width: ${(stats.completed / stats.total) * 100}%`,
                  title: `Completed: ${stats.completed}`,
                })
              : null,
            stats.inProgress > 0
              ? h("div", {
                  class: "prd-summary-segment prd-status-bg-in_progress",
                  style: `width: ${(stats.inProgress / stats.total) * 100}%`,
                  title: `In Progress: ${stats.inProgress}`,
                })
              : null,
            stats.pending > 0
              ? h("div", {
                  class: "prd-summary-segment prd-status-bg-pending",
                  style: `width: ${(stats.pending / stats.total) * 100}%`,
                  title: `Pending: ${stats.pending}`,
                })
              : null,
            stats.blocked > 0
              ? h("div", {
                  class: "prd-summary-segment prd-status-bg-blocked",
                  style: `width: ${(stats.blocked / stats.total) * 100}%`,
                  title: `Blocked: ${stats.blocked}`,
                })
              : null,
            stats.deferred > 0
              ? h("div", {
                  class: "prd-summary-segment prd-status-bg-deferred",
                  style: `width: ${(stats.deferred / stats.total) * 100}%`,
                  title: `Deferred: ${stats.deferred}`,
                })
              : null,
          ),
          h("div", { class: "prd-summary-stats" },
            stats.completed > 0
              ? h("span", { class: "prd-summary-stat" },
                  h("span", { class: "prd-status-dot prd-status-completed" }),
                  `${stats.completed} Completed`,
                )
              : null,
            stats.inProgress > 0
              ? h("span", { class: "prd-summary-stat" },
                  h("span", { class: "prd-status-dot prd-status-in-progress" }),
                  `${stats.inProgress} In Progress`,
                )
              : null,
            stats.pending > 0
              ? h("span", { class: "prd-summary-stat" },
                  h("span", { class: "prd-status-dot prd-status-pending" }),
                  `${stats.pending} Pending`,
                )
              : null,
            stats.blocked > 0
              ? h("span", { class: "prd-summary-stat" },
                  h("span", { class: "prd-status-dot prd-status-blocked" }),
                  `${stats.blocked} Blocked`,
                )
              : null,
            stats.deferred > 0
              ? h("span", { class: "prd-summary-stat" },
                  h("span", { class: "prd-status-dot prd-status-deferred" }),
                  `${stats.deferred} Deferred`,
                )
              : null,
          ),
        ),
      ),
    ),
  );
}

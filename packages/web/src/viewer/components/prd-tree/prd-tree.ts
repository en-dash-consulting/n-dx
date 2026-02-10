/**
 * PRD hierarchy tree view component.
 *
 * Renders a collapsible/expandable tree of epics → features → tasks → subtasks
 * with status indicators, progress bars, and completion percentages.
 */

import { h, Fragment, VNode } from "preact";
import { useState, useMemo, useCallback } from "preact/hooks";
import type { PRDItemData, PRDDocumentData, ItemStatus, ItemLevel, Priority } from "./types.js";
import { computeBranchStats, completionRatio, formatTimestamp, itemMatchesFilter } from "./compute.js";
import { StatusFilter, defaultStatusFilter } from "./status-filter.js";

// ── Status rendering ────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ItemStatus,
  { icon: string; cssClass: string; label: string }
> = {
  completed: { icon: "●", cssClass: "prd-status-completed", label: "Completed" },
  in_progress: { icon: "◐", cssClass: "prd-status-in-progress", label: "In Progress" },
  pending: { icon: "○", cssClass: "prd-status-pending", label: "Pending" },
  deferred: { icon: "◌", cssClass: "prd-status-deferred", label: "Deferred" },
  blocked: { icon: "⊘", cssClass: "prd-status-blocked", label: "Blocked" },
  deleted: { icon: "✕", cssClass: "prd-status-deleted", label: "Deleted" },
};

const PRIORITY_CONFIG: Record<Priority, { cssClass: string }> = {
  critical: { cssClass: "prd-priority-critical" },
  high: { cssClass: "prd-priority-high" },
  medium: { cssClass: "prd-priority-medium" },
  low: { cssClass: "prd-priority-low" },
};

const LEVEL_LABELS: Record<ItemLevel, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

// ── Helper: collect all node IDs up to a depth ──────────────────────

function collectIdsToDepth(
  items: PRDItemData[],
  maxDepth: number,
  currentDepth: number = 0,
): Set<string> {
  const ids = new Set<string>();
  if (currentDepth >= maxDepth) return ids;
  for (const item of items) {
    ids.add(item.id);
    if (item.children && item.children.length > 0) {
      for (const id of collectIdsToDepth(item.children, maxDepth, currentDepth + 1)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

// ── Sub-components ──────────────────────────────────────────────────

function StatusIndicator({ status }: { status: ItemStatus }) {
  const config = STATUS_CONFIG[status];
  return h(
    "span",
    {
      class: `prd-status-icon ${config.cssClass}`,
      title: config.label,
      "aria-label": config.label,
    },
    config.icon,
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  const config = PRIORITY_CONFIG[priority];
  return h(
    "span",
    { class: `prd-priority-badge ${config.cssClass}` },
    priority,
  );
}

function ProgressBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  const barClass =
    pct >= 100 ? "prd-bar-done" : pct >= 50 ? "prd-bar-mid" : "prd-bar-low";

  return h(
    "div",
    {
      class: "prd-progress-wrapper",
      title: `${pct}% complete`,
      role: "progressbar",
      "aria-valuenow": String(pct),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-label": `${pct}% complete`,
    },
    h(
      "div",
      { class: "prd-progress-track", "aria-hidden": "true" },
      h("div", {
        class: `prd-progress-fill ${barClass}`,
        style: `width: ${pct}%`,
      }),
    ),
    h("span", { class: "prd-progress-pct", "aria-hidden": "true" }, `${pct}%`),
  );
}

function TagList({ tags }: { tags: string[] }) {
  return h(
    "span",
    { class: "prd-tag-list" },
    tags.map((tag) => h("span", { key: tag, class: "prd-tag" }, tag)),
  );
}

function TimestampSuffix({ item }: { item: PRDItemData }) {
  if (item.status === "completed" && item.completedAt) {
    const ts = formatTimestamp(item.completedAt);
    if (ts) return h("span", { class: "prd-timestamp" }, `done ${ts}`);
  }
  if (item.status === "in_progress" && item.startedAt) {
    const ts = formatTimestamp(item.startedAt);
    if (ts) return h("span", { class: "prd-timestamp" }, `started ${ts}`);
  }
  return null;
}

// ── Single tree node ────────────────────────────────────────────────

interface NodeRowProps {
  item: PRDItemData;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect?: (item: PRDItemData) => void;
}

function NodeRow({ item, depth, isExpanded, hasChildren, isSelected, onToggle, onSelect }: NodeRowProps) {
  const children = item.children ?? [];
  const stats = hasChildren ? computeBranchStats(children) : null;
  const ratio = stats ? completionRatio(stats) : 0;

  const indent = depth * 24;

  const handleClick = (e: MouseEvent) => {
    // If clicking the chevron area, toggle expand
    const target = e.target as HTMLElement;
    if (target.classList.contains("prd-chevron")) {
      if (hasChildren) onToggle();
      return;
    }
    // Otherwise, select the item (and toggle expand if it has children)
    if (onSelect) {
      onSelect(item);
    } else if (hasChildren) {
      onToggle();
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (onSelect) {
        onSelect(item);
      } else if (hasChildren) {
        onToggle();
      }
    }
    // Arrow right to expand, left to collapse
    if (hasChildren && e.key === "ArrowRight" && !isExpanded) {
      e.preventDefault();
      onToggle();
    }
    if (hasChildren && e.key === "ArrowLeft" && isExpanded) {
      e.preventDefault();
      onToggle();
    }
    // Arrow up/down to navigate between visible tree items
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const target = e.currentTarget as HTMLElement;
      const tree = target.closest('[role="tree"]');
      if (!tree) return;
      const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
      const idx = items.indexOf(target);
      if (idx < 0) return;
      const next = e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (next >= 0 && next < items.length) {
        items[next].focus();
      }
    }
  };

  return h(
    "div",
    {
      class: `prd-node-row${hasChildren ? " prd-node-expandable" : ""}${isSelected ? " prd-node-selected" : ""} prd-level-${item.level}`,
      style: `padding-left: ${indent + 8}px`,
      onClick: handleClick,
      role: "treeitem",
      "aria-expanded": hasChildren ? String(isExpanded) : undefined,
      "aria-selected": String(isSelected),
      tabIndex: 0,
      onKeyDown: handleKeyDown,
    },
    // Chevron
    h(
      "span",
      {
        class: `prd-chevron${hasChildren && isExpanded ? " prd-chevron-open" : ""}`,
        "aria-hidden": "true",
      },
      hasChildren ? "\u25B6" : "",
    ),
    // Status icon
    h(StatusIndicator, { status: item.status }),
    // Level badge
    h("span", { class: `prd-level-badge prd-level-${item.level}` }, LEVEL_LABELS[item.level]),
    // Title
    h("span", { class: "prd-node-title" }, item.title),
    // Priority
    item.priority
      ? h(PriorityBadge, { priority: item.priority })
      : null,
    // Progress bar (for nodes with children)
    stats && stats.total > 0
      ? h(Fragment, null,
          h(ProgressBar, { ratio }),
          h(
            "span",
            { class: "prd-count" },
            `${stats.completed}/${stats.total}`,
          ),
        )
      : null,
    // Tags
    item.tags && item.tags.length > 0
      ? h(TagList, { tags: item.tags })
      : null,
    // Timestamp
    h(TimestampSuffix, { item }),
  );
}

// ── Recursive tree renderer ─────────────────────────────────────────

interface TreeNodesProps {
  items: PRDItemData[];
  depth: number;
  expanded: Set<string>;
  selectedItemId?: string | null;
  activeStatuses: Set<ItemStatus>;
  onToggle: (id: string) => void;
  onSelectItem?: (item: PRDItemData) => void;
}

function TreeNodes({ items, depth, expanded, selectedItemId, activeStatuses, onToggle, onSelectItem }: TreeNodesProps) {
  return h(
    Fragment,
    null,
    items
      .filter((item) => itemMatchesFilter(item, activeStatuses))
      .map((item) => {
        const children = item.children ?? [];
        const hasChildren = children.length > 0;
        const isOpen = expanded.has(item.id);

        return h(
          "div",
          { key: item.id, class: "prd-node" },
          h(NodeRow, {
            item,
            depth,
            isExpanded: isOpen,
            hasChildren,
            isSelected: selectedItemId === item.id,
            onToggle: () => onToggle(item.id),
            onSelect: onSelectItem,
          }),
          hasChildren && isOpen
            ? h(
                "div",
                { class: "prd-children", role: "group" },
                h(TreeNodes, {
                  items: children,
                  depth: depth + 1,
                  expanded,
                  selectedItemId,
                  activeStatuses,
                  onToggle,
                  onSelectItem,
                }),
              )
            : null,
        );
      }),
  );
}

// ── Summary bar ─────────────────────────────────────────────────────

function SummaryBar({ items }: { items: PRDItemData[] }) {
  const stats = computeBranchStats(items);
  const pct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  const allSegments: Array<{ status: ItemStatus; count: number; label: string }> = [
    { status: "completed", count: stats.completed, label: "Completed" },
    { status: "in_progress", count: stats.inProgress, label: "In Progress" },
    { status: "pending", count: stats.pending, label: "Pending" },
    { status: "blocked", count: stats.blocked, label: "Blocked" },
    { status: "deferred", count: stats.deferred, label: "Deferred" },
    { status: "deleted", count: stats.deleted, label: "Deleted" },
  ];
  const segments = allSegments.filter((s) => s.count > 0);

  return h(
    "div",
    { class: "prd-summary" },
    h(
      "div",
      { class: "prd-summary-bar" },
      segments.map((seg) =>
        h("div", {
          key: seg.status,
          class: `prd-summary-segment prd-status-bg-${seg.status}`,
          style: `width: ${(seg.count / stats.total) * 100}%`,
          title: `${seg.label}: ${seg.count}`,
        }),
      ),
    ),
    h(
      "div",
      { class: "prd-summary-stats" },
      segments.map((seg) =>
        h(
          "span",
          { key: seg.status, class: "prd-summary-stat" },
          h("span", { class: `prd-status-dot ${STATUS_CONFIG[seg.status].cssClass}` }),
          `${seg.count} ${seg.label}`,
        ),
      ),
      h("span", { class: "prd-summary-pct" }, `${pct}% complete (${stats.completed}/${stats.total})`),
    ),
  );
}

// ── Toolbar ─────────────────────────────────────────────────────────

interface ToolbarProps {
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

function Toolbar({ onExpandAll, onCollapseAll }: ToolbarProps) {
  return h(
    "div",
    { class: "prd-toolbar" },
    h(
      "button",
      {
        class: "prd-toolbar-btn",
        onClick: onExpandAll,
        title: "Expand all nodes",
      },
      "Expand All",
    ),
    h(
      "button",
      {
        class: "prd-toolbar-btn",
        onClick: onCollapseAll,
        title: "Collapse all nodes",
      },
      "Collapse All",
    ),
  );
}

// ── Main component ──────────────────────────────────────────────────

export interface PRDTreeProps {
  /** PRD document data (items array + title). */
  document: PRDDocumentData;
  /** How many levels to expand by default (0 = all collapsed). */
  defaultExpandDepth?: number;
  /** Called when an item is clicked for detail view. */
  onSelectItem?: (item: PRDItemData) => void;
  /** Currently selected item ID (highlights the row). */
  selectedItemId?: string | null;
}

export function PRDTree({ document: doc, defaultExpandDepth = 2, onSelectItem, selectedItemId }: PRDTreeProps) {
  // Collect all IDs for expand-all
  const allIds = useMemo(() => {
    const ids = new Set<string>();
    function walk(items: PRDItemData[]) {
      for (const item of items) {
        ids.add(item.id);
        if (item.children) walk(item.children);
      }
    }
    walk(doc.items);
    return ids;
  }, [doc.items]);

  const [expanded, setExpanded] = useState<Set<string>>(() =>
    collectIdsToDepth(doc.items, defaultExpandDepth),
  );

  const [activeStatuses, setActiveStatuses] = useState<Set<ItemStatus>>(() =>
    defaultStatusFilter(),
  );

  const toggle = useCallback(
    (id: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  const expandAll = useCallback(() => setExpanded(new Set(allIds)), [allIds]);
  const collapseAll = useCallback(() => setExpanded(new Set<string>()), []);

  if (doc.items.length === 0) {
    return h(
      "div",
      { class: "prd-empty" },
      h("p", null, "No PRD items yet."),
      h("p", { class: "prd-empty-hint" }, "Run ", h("code", null, "rex add epic --title=\"...\""), " to get started."),
    );
  }

  return h(
    "div",
    { class: "prd-tree-container" },
    // Header
    h(
      "div",
      { class: "prd-header" },
      h("h2", { class: "prd-title" }, doc.title),
      h(Toolbar, { onExpandAll: expandAll, onCollapseAll: collapseAll }),
    ),
    // Status filter
    h(StatusFilter, { activeStatuses, onChange: setActiveStatuses }),
    // Summary
    h(SummaryBar, { items: doc.items }),
    // Tree
    h(
      "div",
      { class: "prd-tree", role: "tree", "aria-label": "PRD hierarchy" },
      h(TreeNodes, {
        items: doc.items,
        depth: 0,
        expanded,
        selectedItemId,
        activeStatuses,
        onToggle: toggle,
        onSelectItem,
      }),
    ),
  );
}

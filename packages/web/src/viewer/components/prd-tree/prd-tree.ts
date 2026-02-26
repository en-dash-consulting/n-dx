/**
 * PRD hierarchy tree view component.
 *
 * Renders a collapsible/expandable tree of epics → features → tasks → subtasks
 * with status indicators, progress bars, completion percentages, and optional
 * multi-select checkboxes for bulk operations (status update, merge).
 *
 * Off-screen nodes are automatically culled via IntersectionObserver to prevent
 * DOM bloat and memory leaks during extended scrolling. Culled nodes are replaced
 * with height-preserving placeholders and re-created when scrolled back into view.
 * Event listeners are cleaned up when nodes are culled (Preact removes them when
 * the children unmount) and re-attached when nodes become visible again.
 *
 * @see ./node-culler.ts — IntersectionObserver-based culling engine
 */

import { h, Fragment, VNode } from "preact";
import { useState, useMemo, useCallback, useEffect, useRef } from "preact/hooks";
import type { PRDItemData, PRDDocumentData, ItemStatus, ItemLevel, Priority, TaskUsageSummary, WeeklyBudgetResolution } from "./types.js";
import { computeBranchStats, completionRatio, formatTimestamp, itemMatchesFilter } from "./compute.js";
import { StatusFilter, defaultStatusFilter } from "./status-filter.js";
import { InlineAddForm } from "./inline-add-form.js";
import type { InlineAddInput } from "./inline-add-form.js";
import { resolveTaskUtilization } from "./task-utilization.js";
import { NodeCuller } from "./node-culler.js";

/** Levels that can have children added via inline form. */
const ADDABLE_LEVELS = new Set<ItemLevel>(["epic", "feature", "task"]);

// ── Status rendering ────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ItemStatus,
  { icon: string; cssClass: string; label: string }
> = {
  completed: { icon: "●", cssClass: "prd-status-completed", label: "Completed" },
  in_progress: { icon: "◐", cssClass: "prd-status-in-progress", label: "In Progress" },
  pending: { icon: "○", cssClass: "prd-status-pending", label: "Pending" },
  failing: { icon: "⚠", cssClass: "prd-status-failing", label: "Failing" },
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

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
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
  if (item.status === "failing" && item.failureReason) {
    return h("span", { class: "prd-timestamp prd-failure-reason" }, item.failureReason);
  }
  return null;
}

// ── Node context menu ───────────────────────────────────────────────

interface NodeContextMenuProps {
  item: PRDItemData;
  x: number;
  y: number;
  onClose: () => void;
  onRemove?: (item: PRDItemData) => void;
}

function NodeContextMenu({ item, x, y, onClose, onRemove }: NodeContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Clamp position so menu doesn't overflow viewport
  const style: Record<string, string> = {
    position: "fixed",
    left: `${Math.min(x, window.innerWidth - 180)}px`,
    top: `${Math.min(y, window.innerHeight - 120)}px`,
    zIndex: "9999",
  };

  return h("div", { ref, class: "prd-context-menu", style, role: "menu" },
    // Header
    h("div", { class: "prd-context-menu-header" },
      h("span", { class: `prd-level-badge prd-level-${item.level}` }, LEVEL_LABELS[item.level]),
      h("span", { class: "prd-context-menu-title" }, item.title),
    ),
    h("div", { class: "prd-context-menu-divider" }),
    // Delete action
    onRemove
      ? h("button", {
          class: "prd-context-menu-item prd-context-menu-danger",
          role: "menuitem",
          onClick: () => {
            onRemove(item);
            onClose();
          },
        },
          h("span", { class: "prd-context-menu-item-icon" }, "\u2717"),
          `Delete ${LEVEL_LABELS[item.level]}`,
        )
      : null,
  );
}

// ── Single tree node ────────────────────────────────────────────────

interface NodeRowProps {
  item: PRDItemData;
  taskUsage?: TaskUsageSummary;
  weeklyBudget?: WeeklyBudgetResolution | null;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect?: (item: PRDItemData) => void;
  /** Whether the checkbox for bulk selection is checked. */
  isBulkSelected?: boolean;
  /** Called when the checkbox is toggled. */
  onToggleBulkSelect?: (item: PRDItemData) => void;
  /** Called when the inline add button is clicked. */
  onInlineAdd?: (item: PRDItemData) => void;
  /** Whether the inline add form is currently open for this node. */
  isInlineAddActive?: boolean;
  /** Whether this node is highlighted by a deep-link animation. */
  isHighlighted?: boolean;
  /** Ref callback for scroll-into-view on deep-link highlight. */
  nodeRef?: (el: HTMLDivElement | null) => void;
  /** Called to remove/delete this item. */
  onRemove?: (item: PRDItemData) => void;
  /** Whether this item is currently being deleted (API in-flight). */
  isDeleting?: boolean;
}

function NodeRow({ item, taskUsage, weeklyBudget, depth, isExpanded, hasChildren, isSelected, onToggle, onSelect, isBulkSelected, onToggleBulkSelect, onInlineAdd, isInlineAddActive, isHighlighted, nodeRef, onRemove, isDeleting }: NodeRowProps) {
  const children = item.children ?? [];
  const stats = hasChildren ? computeBranchStats(children) : null;
  const ratio = stats ? completionRatio(stats) : 0;
  const canAddChild = ADDABLE_LEVELS.has(item.level);
  const usage = taskUsage ?? {
    totalTokens: 0,
    runCount: 0,
    utilization: resolveTaskUtilization(0, weeklyBudget),
  };
  const utilization = usage.utilization ?? resolveTaskUtilization(usage.totalTokens, weeklyBudget);

  const indent = depth * 24;
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // If clicking the checkbox or its container, don't process as row click
    if (target.classList.contains("prd-bulk-checkbox") || target.closest(".prd-bulk-checkbox-wrapper")) {
      return;
    }
    // If clicking the inline add button or delete button, don't process as row click
    if (target.closest(".prd-inline-add-btn") || target.closest(".prd-inline-delete-btn")) {
      return;
    }
    // If clicking the chevron area, toggle expand
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

  const handleCheckboxChange = (e: Event) => {
    e.stopPropagation();
    if (onToggleBulkSelect) {
      onToggleBulkSelect(item);
    }
  };

  const handleContextMenu = (e: MouseEvent) => {
    // Only show context menu when there are actions available (delete)
    if (!onRemove) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return h(
    "div",
    {
      class: `prd-node-row${hasChildren ? " prd-node-expandable" : ""}${isSelected ? " prd-node-selected" : ""}${isBulkSelected ? " prd-node-bulk-selected" : ""}${isHighlighted ? " prd-node-highlighted" : ""}${isDeleting ? " prd-node-deleting" : ""} prd-level-${item.level}`,
      style: `padding-left: ${indent + 8}px`,
      onClick: handleClick,
      onContextMenu: handleContextMenu,
      role: "treeitem",
      "aria-expanded": hasChildren ? String(isExpanded) : undefined,
      "aria-selected": String(isSelected),
      tabIndex: 0,
      onKeyDown: handleKeyDown,
      ref: nodeRef,
    },
    // Bulk selection checkbox
    onToggleBulkSelect
      ? h("span", { class: "prd-bulk-checkbox-wrapper" },
          h("input", {
            type: "checkbox",
            class: "prd-bulk-checkbox",
            checked: isBulkSelected,
            onChange: handleCheckboxChange,
            "aria-label": `Select ${item.title} for bulk action`,
            onClick: (e: MouseEvent) => e.stopPropagation(),
          }),
        )
      : null,
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
    // Aggregated task token usage
    item.level === "task" || item.level === "subtask"
      ? h(
          "span",
          {
            class: "prd-usage-chip",
            "data-utilization-reason": utilization.reason,
            title: `${usage.runCount} associated run${usage.runCount === 1 ? "" : "s"} | ${utilization.label} weekly utilization`,
          },
          `${formatTokenCount(usage.totalTokens)} tokens | ${utilization.label}`,
        )
      : null,
    // Timestamp
    h(TimestampSuffix, { item }),
    // Inline add child button (appears on hover, only for addable levels)
    canAddChild && onInlineAdd
      ? h("button", {
          class: `prd-inline-add-btn${isInlineAddActive ? " active" : ""}`,
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            onInlineAdd(item);
          },
          title: `Add child to ${item.title}`,
          "aria-label": `Add child item to ${item.title}`,
        }, "+")
      : null,
    // Inline delete button (appears on hover)
    onRemove
      ? h("button", {
          class: "prd-inline-delete-btn",
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            onRemove(item);
          },
          title: `Delete ${LEVEL_LABELS[item.level]} "${item.title}"`,
          "aria-label": `Delete ${item.title}`,
        }, "\u2717")
      : null,
    // Context menu (right-click)
    contextMenu
      ? h(NodeContextMenu, {
          item,
          x: contextMenu.x,
          y: contextMenu.y,
          onClose: () => setContextMenu(null),
          onRemove,
        })
      : null,
  );
}

// ── Off-screen node culling ──────────────────────────────────────────

/** Default height for placeholder nodes before actual height is recorded. */
const CULLED_PLACEHOLDER_HEIGHT = 40;

/**
 * Wrapper component that culls off-screen tree nodes.
 *
 * Uses a shared NodeCuller (IntersectionObserver) to detect when this node
 * leaves the viewport buffer. When culled:
 * - Children are not rendered (freeing DOM nodes and event listeners)
 * - A height-preserving placeholder div maintains scroll position
 *
 * When the node scrolls back into view, full content is re-rendered.
 * The wrapper div always stays in the DOM so the observer can track it.
 *
 * Highlighted nodes (deep-link targets) are never culled to ensure
 * scrollIntoView works correctly.
 */
interface CulledNodeProps {
  /** Shared culler instance, or null to disable culling. */
  culler: NodeCuller | null;
  /** Whether this node should never be culled (e.g. deep-link target). */
  neverCull?: boolean;
  /** Child VNodes to render when visible. */
  children: (VNode | null)[];
}

function CulledNode({ culler, neverCull, children }: CulledNodeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const heightRef = useRef(CULLED_PLACEHOLDER_HEIGHT);

  useEffect(() => {
    const el = ref.current;
    if (!el || !culler || neverCull) return;

    return culler.observe(el, (isVisible) => {
      if (!isVisible) {
        // Record height before culling so the placeholder preserves scroll position.
        const recordedHeight = culler.getLastHeight(el);
        if (recordedHeight > 0) heightRef.current = recordedHeight;
      }
      setVisible(isVisible);
    });
  }, [culler, neverCull]);

  if (!visible && !neverCull) {
    return h("div", {
      ref,
      class: "prd-node prd-node-culled",
      style: `height: ${heightRef.current}px`,
      "aria-hidden": "true",
    });
  }

  return h("div", { ref, class: "prd-node" }, ...children);
}

// ── Recursive tree renderer ─────────────────────────────────────────

interface TreeNodesProps {
  items: PRDItemData[];
  taskUsageById?: Record<string, TaskUsageSummary>;
  weeklyBudget?: WeeklyBudgetResolution | null;
  depth: number;
  expanded: Set<string>;
  selectedItemId?: string | null;
  activeStatuses: Set<ItemStatus>;
  onToggle: (id: string) => void;
  onSelectItem?: (item: PRDItemData) => void;
  bulkSelectedIds?: Set<string>;
  onToggleBulkSelect?: (item: PRDItemData) => void;
  /** ID of the parent node whose inline add form is currently open. */
  inlineAddParentId?: string | null;
  /** Called when the inline add button is clicked on a node. */
  onInlineAdd?: (item: PRDItemData) => void;
  /** Called when the inline add form is submitted. */
  onInlineAddSubmit?: (data: InlineAddInput) => Promise<void>;
  /** Called when the inline add form is cancelled. */
  onInlineAddCancel?: () => void;
  /** ID of the item highlighted by a deep-link. */
  highlightedItemId?: string | null;
  /** Ref callback for the highlighted node (scroll-into-view). */
  highlightedNodeRef?: (el: HTMLDivElement | null) => void;
  /** Called to remove/delete an item. */
  onRemoveItem?: (item: PRDItemData) => void;
  /** ID of item currently being deleted (shows loading state). */
  deletingItemId?: string | null;
  /** Shared NodeCuller instance for off-screen node culling. */
  culler?: NodeCuller | null;
}

function TreeNodes({ items, taskUsageById, weeklyBudget, depth, expanded, selectedItemId, activeStatuses, onToggle, onSelectItem, bulkSelectedIds, onToggleBulkSelect, inlineAddParentId, onInlineAdd, onInlineAddSubmit, onInlineAddCancel, highlightedItemId, highlightedNodeRef, onRemoveItem, deletingItemId, culler }: TreeNodesProps) {
  return h(
    Fragment,
    null,
    items
      .filter((item) => itemMatchesFilter(item, activeStatuses))
      .map((item) => {
        const children = item.children ?? [];
        const hasChildren = children.length > 0;
        const isOpen = expanded.has(item.id);
        const isInlineAddActive = inlineAddParentId === item.id;
        const isHL = highlightedItemId === item.id;

        return h(
          CulledNode,
          {
            key: item.id,
            culler: culler ?? null,
            neverCull: isHL || isInlineAddActive,
          },
          h(NodeRow, {
            item,
            taskUsage: taskUsageById?.[item.id],
            weeklyBudget,
            depth,
            isExpanded: isOpen,
            hasChildren,
            isSelected: selectedItemId === item.id,
            onToggle: () => onToggle(item.id),
            onSelect: onSelectItem,
            isBulkSelected: bulkSelectedIds?.has(item.id),
            onToggleBulkSelect,
            onInlineAdd,
            isInlineAddActive,
            isHighlighted: isHL,
            nodeRef: isHL ? highlightedNodeRef : undefined,
            onRemove: onRemoveItem,
            isDeleting: deletingItemId === item.id,
          }),
          // Inline add form — rendered below the parent node, above its children
          isInlineAddActive && onInlineAddSubmit && onInlineAddCancel
            ? h(InlineAddForm, {
                parentLevel: item.level,
                parentId: item.id,
                depth,
                onSubmit: onInlineAddSubmit,
                onCancel: onInlineAddCancel,
              })
            : null,
          hasChildren && isOpen
            ? h(
                "div",
                { class: "prd-children", role: "group" },
                h(TreeNodes, {
                  items: children,
                  taskUsageById,
                  weeklyBudget,
                  depth: depth + 1,
                  expanded,
                  selectedItemId,
                  activeStatuses,
                  onToggle,
                  onSelectItem,
                  bulkSelectedIds,
                  onToggleBulkSelect,
                  inlineAddParentId,
                  onInlineAdd,
                  onInlineAddSubmit,
                  onInlineAddCancel,
                  highlightedItemId,
                  highlightedNodeRef,
                  onRemoveItem,
                  deletingItemId,
                  culler,
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
    { status: "failing", count: stats.failing, label: "Failing" },
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
  /** Aggregated task token usage keyed by task ID. */
  taskUsageById?: Record<string, TaskUsageSummary>;
  /** Shared resolved weekly budget used for deterministic utilization display. */
  weeklyBudget?: WeeklyBudgetResolution | null;
  /** How many levels to expand by default (0 = all collapsed). */
  defaultExpandDepth?: number;
  /** Called when an item is clicked for detail view. */
  onSelectItem?: (item: PRDItemData) => void;
  /** Currently selected item ID (highlights the row). */
  selectedItemId?: string | null;
  /** IDs of items selected for bulk operations (shows checkboxes). */
  bulkSelectedIds?: Set<string>;
  /** Called when a bulk-select checkbox is toggled. */
  onToggleBulkSelect?: (item: PRDItemData) => void;
  /** Called when inline add form is submitted. */
  onInlineAddSubmit?: (data: InlineAddInput) => Promise<void>;
  /** ID of the item highlighted by a deep-link animation. */
  highlightedItemId?: string | null;
  /** IDs of ancestor nodes to force-expand for deep-link visibility. */
  deepLinkExpandIds?: Set<string> | null;
  /** Called to remove/delete an item from the tree. */
  onRemoveItem?: (item: PRDItemData) => void;
  /** ID of item currently being deleted (shows loading state). */
  deletingItemId?: string | null;
}

export function PRDTree({ document: doc, taskUsageById, weeklyBudget, defaultExpandDepth = 2, onSelectItem, selectedItemId, bulkSelectedIds, onToggleBulkSelect, onInlineAddSubmit, highlightedItemId, deepLinkExpandIds, onRemoveItem, deletingItemId }: PRDTreeProps) {
  // ── Node culler lifecycle ─────────────────────────────────────────
  // Create a shared NodeCuller on mount and dispose on unmount.
  // The culler uses IntersectionObserver to track which nodes are within
  // the viewport buffer and notifies CulledNode wrappers to swap between
  // full content and lightweight placeholders.
  const cullerRef = useRef<NodeCuller | null>(null);
  if (!cullerRef.current && typeof IntersectionObserver !== "undefined") {
    cullerRef.current = new NodeCuller({ bufferPx: 200 });
  }
  useEffect(() => {
    return () => {
      cullerRef.current?.dispose();
      cullerRef.current = null;
    };
  }, []);

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

  // Deep-link: force-expand ancestor nodes so the target item is visible
  useEffect(() => {
    if (!deepLinkExpandIds || deepLinkExpandIds.size === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of deepLinkExpandIds) {
        next.add(id);
      }
      return next;
    });
  }, [deepLinkExpandIds]);

  // Scroll the deep-linked node into view when it renders
  const scrolledRef = useRef(false);
  const deepLinkNodeRef = useCallback((el: HTMLDivElement | null) => {
    if (el && !scrolledRef.current) {
      scrolledRef.current = true;
      // Defer so the DOM has settled after ancestor expansion
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  }, []);

  const [activeStatuses, setActiveStatuses] = useState<Set<ItemStatus>>(() =>
    defaultStatusFilter(),
  );

  // Inline add form state — tracks which parent node has its form open
  const [inlineAddParentId, setInlineAddParentId] = useState<string | null>(null);

  const handleInlineAdd = useCallback(
    (item: PRDItemData) => {
      // Toggle: if already open for this item, close it; otherwise open it
      setInlineAddParentId((prev) => (prev === item.id ? null : item.id));
      // Auto-expand the node so the form is visible in context
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
    },
    [],
  );

  const handleInlineAddCancel = useCallback(() => {
    setInlineAddParentId(null);
  }, []);

  const handleInlineAddSubmit = useCallback(
    async (data: InlineAddInput) => {
      if (!onInlineAddSubmit) return;
      await onInlineAddSubmit(data);
      setInlineAddParentId(null);
    },
    [onInlineAddSubmit],
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
        taskUsageById,
        weeklyBudget,
        depth: 0,
        expanded,
        selectedItemId,
        activeStatuses,
        onToggle: toggle,
        onSelectItem,
        bulkSelectedIds,
        onToggleBulkSelect,
        inlineAddParentId: onInlineAddSubmit ? inlineAddParentId : null,
        onInlineAdd: onInlineAddSubmit ? handleInlineAdd : undefined,
        onInlineAddSubmit: onInlineAddSubmit ? handleInlineAddSubmit : undefined,
        onInlineAddCancel: onInlineAddSubmit ? handleInlineAddCancel : undefined,
        highlightedItemId,
        highlightedNodeRef: deepLinkNodeRef,
        onRemoveItem,
        deletingItemId,
        culler: cullerRef.current,
      }),
    ),
  );
}

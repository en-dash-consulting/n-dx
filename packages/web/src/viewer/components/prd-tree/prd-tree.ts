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
 *
 * Event handling uses delegation: a single set of click / contextmenu / keydown
 * listeners on the `[role="tree"]` container replaces per-node handlers, reducing
 * total listener count from O(N × 6) to O(1) + O(N_checkboxes).
 *
 * @see ./node-culler.ts  — IntersectionObserver-based culling engine
 * @see ./tree-event-delegate.ts — delegated event handling hook
 */

import { h, Fragment, Component } from "preact";
import type { VNode, ComponentChildren } from "preact";
import { useState, useMemo, useCallback, useEffect, useRef } from "preact/hooks";
import type { PRDItemData, PRDDocumentData, ItemStatus, ItemLevel, Priority, TaskUsageSummary, WeeklyBudgetResolution } from "./types.js";
import { computeBranchStats, completionRatio, formatTimestamp, itemMatchesFilter } from "./compute.js";
import { StatusFilter, defaultStatusFilter } from "./status-filter.js";
import { InlineAddForm } from "./inline-add-form.js";
import type { InlineAddInput } from "./inline-add-form.js";
import { resolveTaskUtilization } from "./task-utilization.js";
import { NodeCuller } from "./node-culler.js";
import { ListenerLifecycleManager } from "./listener-lifecycle.js";
import { LazyChildren } from "./lazy-children.js";
import { useTreeEventDelegation } from "./tree-event-delegate.js";
import { countVisibleNodes, sliceVisibleTree, useProgressiveLoader, LoadMoreIndicator, DEFAULT_CHUNK_SIZE } from "./progressive-loader.js";

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
//
// NodeRow is a pure display component. It carries **no** event handlers of
// its own for click / contextmenu / keydown — those are delegated to the
// tree container via useTreeEventDelegation (see tree-event-delegate.ts).
//
// The only per-node listener that remains is the checkbox `onChange`, which
// must stay on the <input> itself so Preact's controlled-input model keeps
// the visual checked state in sync.
//
// Each row adds `data-node-id` and (optionally) `data-has-children` data
// attributes so the delegated handler can identify the target node and its
// capabilities from the bubbled event.

interface NodeRowProps {
  item: PRDItemData;
  taskUsage?: TaskUsageSummary;
  weeklyBudget?: WeeklyBudgetResolution | null;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  isSelected: boolean;
  /** Whether the checkbox for bulk selection is checked. */
  isBulkSelected?: boolean;
  /** Called when the checkbox is toggled. Presence also enables the checkbox. */
  onToggleBulkSelect?: (item: PRDItemData) => void;
  /** Whether to show the inline add child button. */
  canInlineAdd?: boolean;
  /** Whether the inline add form is currently open for this node. */
  isInlineAddActive?: boolean;
  /** Whether this node is highlighted by a deep-link animation. */
  isHighlighted?: boolean;
  /** Ref callback for scroll-into-view on deep-link highlight. */
  nodeRef?: (el: HTMLDivElement | null) => void;
  /** Whether to show the inline delete button. */
  canDelete?: boolean;
  /** Whether this item is currently being deleted (API in-flight). */
  isDeleting?: boolean;
}

/**
 * Memoized single tree node.
 *
 * Structural sharing (tree-differ.ts) ensures unchanged items keep their
 * object reference across data updates. The `shouldComponentUpdate` check
 * leverages this: when `item` is the same reference AND all UI-state props
 * match, the node skips its entire render cycle — no VDOM diffing, no
 * `computeBranchStats`, no string concatenation.
 *
 * Uses Preact's native class component `shouldComponentUpdate` (no
 * preact/compat dependency) for maximum compatibility with the existing
 * test infrastructure and esbuild configuration.
 */
class NodeRow extends Component<NodeRowProps> {
  shouldComponentUpdate(nextProps: NodeRowProps): boolean {
    const p = this.props;
    // Reference equality for the item object — structural sharing makes
    // this cheap and sufficient when items haven't changed.
    if (p.item !== nextProps.item) return true;
    // UI state props — these are primitives so === works.
    if (p.isExpanded !== nextProps.isExpanded) return true;
    if (p.isSelected !== nextProps.isSelected) return true;
    if (p.isBulkSelected !== nextProps.isBulkSelected) return true;
    if (p.isInlineAddActive !== nextProps.isInlineAddActive) return true;
    if (p.isHighlighted !== nextProps.isHighlighted) return true;
    if (p.isDeleting !== nextProps.isDeleting) return true;
    if (p.depth !== nextProps.depth) return true;
    if (p.hasChildren !== nextProps.hasChildren) return true;
    if (p.canInlineAdd !== nextProps.canInlineAdd) return true;
    if (p.canDelete !== nextProps.canDelete) return true;
    // taskUsage is an object — reference check (new object ⇒ re-render)
    if (p.taskUsage !== nextProps.taskUsage) return true;
    if (p.weeklyBudget !== nextProps.weeklyBudget) return true;
    // All props match — skip render
    return false;
  }

  render() {
    const { item, taskUsage, weeklyBudget, depth, isExpanded, hasChildren, isSelected, isBulkSelected, onToggleBulkSelect, canInlineAdd, isInlineAddActive, isHighlighted, nodeRef, canDelete, isDeleting } = this.props;
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

    // Checkbox change is the only per-node listener. It must stay on the
    // <input> for Preact's controlled-input diffing to work correctly.
    const handleCheckboxChange = (e: Event) => {
      e.stopPropagation();
      if (onToggleBulkSelect) {
        onToggleBulkSelect(item);
      }
    };

    return h(
      "div",
      {
        class: `prd-node-row${hasChildren ? " prd-node-expandable" : ""}${isSelected ? " prd-node-selected" : ""}${isBulkSelected ? " prd-node-bulk-selected" : ""}${isHighlighted ? " prd-node-highlighted" : ""}${isDeleting ? " prd-node-deleting" : ""} prd-level-${item.level}`,
        style: `padding-left: ${indent + 8}px`,
        // Data attributes for delegated event handling
        "data-node-id": item.id,
        ...(hasChildren ? { "data-has-children": "" } : {}),
        role: "treeitem",
        "aria-expanded": hasChildren ? String(isExpanded) : undefined,
        "aria-selected": String(isSelected),
        tabIndex: 0,
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
      // No onClick — handled by delegated click on tree container.
      canAddChild && canInlineAdd
        ? h("button", {
            class: `prd-inline-add-btn${isInlineAddActive ? " active" : ""}`,
            title: `Add child to ${item.title}`,
            "aria-label": `Add child item to ${item.title}`,
          }, "+")
        : null,
      // Inline delete button (appears on hover)
      // No onClick — handled by delegated click on tree container.
      canDelete
        ? h("button", {
            class: "prd-inline-delete-btn",
            title: `Delete ${LEVEL_LABELS[item.level]} "${item.title}"`,
            "aria-label": `Delete ${item.title}`,
          }, "\u2717")
        : null,
      // Context menu rendering moved to PRDTree (tree-level state)
    );
  }
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
  /** Node ID for listener lifecycle scope (cleanup on cull/unmount). */
  nodeId?: string;
  /** Shared listener lifecycle manager, or null to skip tracking. */
  listenerManager?: ListenerLifecycleManager | null;
  /** Child VNodes to render when visible. */
  children?: ComponentChildren;
}

function CulledNode({ culler, neverCull, nodeId, listenerManager, children }: CulledNodeProps) {
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
        // Clean up event listeners for this node scope when culled.
        if (nodeId && listenerManager) {
          listenerManager.cleanupScope(nodeId);
        }
      }
      setVisible(isVisible);
    });
  }, [culler, neverCull, nodeId, listenerManager]);

  // Ensure listener cleanup on unmount (covers data changes and filter removals).
  useEffect(() => {
    return () => {
      if (nodeId && listenerManager) {
        listenerManager.cleanupScope(nodeId);
      }
    };
  }, [nodeId, listenerManager]);

  if (!visible && !neverCull) {
    return h("div", {
      ref,
      class: "prd-node prd-node-culled",
      style: `height: ${heightRef.current}px`,
      "aria-hidden": "true",
    });
  }

  return h("div", { ref, class: "prd-node" }, children);
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
  // Event callbacks removed — click / contextmenu / keydown are delegated
  // to the tree container via useTreeEventDelegation.
  bulkSelectedIds?: Set<string>;
  /** Still per-node: checkbox onChange requires it on the <input>. */
  onToggleBulkSelect?: (item: PRDItemData) => void;
  /** ID of the parent node whose inline add form is currently open. */
  inlineAddParentId?: string | null;
  /** Whether to show inline add buttons (rendering flag). */
  canInlineAdd?: boolean;
  /** Called when the inline add form is submitted. */
  onInlineAddSubmit?: (data: InlineAddInput) => Promise<void>;
  /** Called when the inline add form is cancelled. */
  onInlineAddCancel?: () => void;
  /** ID of the item highlighted by a deep-link. */
  highlightedItemId?: string | null;
  /** Ref callback for the highlighted node (scroll-into-view). */
  highlightedNodeRef?: (el: HTMLDivElement | null) => void;
  /** Whether to show inline delete buttons (rendering flag). */
  canDelete?: boolean;
  /** ID of item currently being deleted (shows loading state). */
  deletingItemId?: string | null;
  /** Shared NodeCuller instance for off-screen node culling. */
  culler?: NodeCuller | null;
  /** Shared listener lifecycle manager for scope-based cleanup. */
  listenerManager?: ListenerLifecycleManager | null;
}

function TreeNodes({ items, taskUsageById, weeklyBudget, depth, expanded, selectedItemId, activeStatuses, bulkSelectedIds, onToggleBulkSelect, inlineAddParentId, canInlineAdd, onInlineAddSubmit, onInlineAddCancel, highlightedItemId, highlightedNodeRef, canDelete, deletingItemId, culler, listenerManager }: TreeNodesProps) {
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
            nodeId: item.id,
            listenerManager: listenerManager ?? null,
          },
          h(NodeRow, {
            item,
            taskUsage: taskUsageById?.[item.id],
            weeklyBudget,
            depth,
            isExpanded: isOpen,
            hasChildren,
            isSelected: selectedItemId === item.id,
            isBulkSelected: bulkSelectedIds?.has(item.id),
            onToggleBulkSelect,
            canInlineAdd,
            isInlineAddActive,
            isHighlighted: isHL,
            nodeRef: isHL ? highlightedNodeRef : undefined,
            canDelete,
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
          hasChildren
            ? h(LazyChildren, {
                isOpen,
                renderChildren: () =>
                  h(TreeNodes, {
                    items: children,
                    taskUsageById,
                    weeklyBudget,
                    depth: depth + 1,
                    expanded,
                    selectedItemId,
                    activeStatuses,
                    bulkSelectedIds,
                    onToggleBulkSelect,
                    inlineAddParentId,
                    canInlineAdd,
                    onInlineAddSubmit,
                    onInlineAddCancel,
                    highlightedItemId,
                    highlightedNodeRef,
                    canDelete,
                    deletingItemId,
                    culler,
                    listenerManager,
                  }),
              })
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
  /**
   * Number of nodes per progressive loading chunk.
   * When the visible node count exceeds this value, the tree renders
   * incrementally with a "Load More" indicator.
   * Defaults to DEFAULT_CHUNK_SIZE (50).
   */
  chunkSize?: number;
}

// ── Item lookup helper ──────────────────────────────────────────────

/** Build a flat Map of id → PRDItemData for O(1) lookup by the delegation hook. */
function buildItemMap(items: PRDItemData[]): Map<string, PRDItemData> {
  const map = new Map<string, PRDItemData>();
  function walk(nodes: PRDItemData[]) {
    for (const node of nodes) {
      map.set(node.id, node);
      if (node.children) walk(node.children);
    }
  }
  walk(items);
  return map;
}

export function PRDTree({ document: doc, taskUsageById, weeklyBudget, defaultExpandDepth = 2, onSelectItem, selectedItemId, bulkSelectedIds, onToggleBulkSelect, onInlineAddSubmit, highlightedItemId, deepLinkExpandIds, onRemoveItem, deletingItemId, chunkSize = DEFAULT_CHUNK_SIZE }: PRDTreeProps) {
  // ── Node culler lifecycle ─────────────────────────────────────────
  // Create a shared NodeCuller on mount and dispose on unmount.
  // The culler uses IntersectionObserver to track which nodes are within
  // the viewport buffer and notifies CulledNode wrappers to swap between
  // full content and lightweight placeholders.
  const cullerRef = useRef<NodeCuller | null>(null);
  if (!cullerRef.current && typeof IntersectionObserver !== "undefined") {
    cullerRef.current = new NodeCuller({ bufferPx: 200 });
  }

  // ── Listener lifecycle manager ──────────────────────────────────────
  // Tracks per-node event listeners by scope (node ID). When nodes are
  // culled or unmounted, their listeners are batch-removed via
  // cleanupScope(). Provides diagnostic state for memory profiling.
  const listenerManagerRef = useRef<ListenerLifecycleManager | null>(null);
  if (!listenerManagerRef.current) {
    listenerManagerRef.current = new ListenerLifecycleManager();
  }

  useEffect(() => {
    return () => {
      cullerRef.current?.dispose();
      cullerRef.current = null;
      listenerManagerRef.current?.dispose();
      listenerManagerRef.current = null;
    };
  }, []);

  // ── Flat item map for delegated event handlers ────────────────────
  const itemMap = useMemo(() => buildItemMap(doc.items), [doc.items]);
  const getItem = useCallback((id: string) => itemMap.get(id) ?? null, [itemMap]);

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

  // ── Progressive tree loading ────────────────────────────────────────
  // Count visible nodes and manage chunk-based rendering for large trees.
  // The full tree is always available for filtering/searching — progressive
  // loading only limits how many nodes are rendered at once.
  const totalVisibleNodes = useMemo(
    () => countVisibleNodes(doc.items, activeStatuses),
    [doc.items, activeStatuses],
  );
  const progressive = useProgressiveLoader(totalVisibleNodes, chunkSize);

  // Slice the tree to the current progressive limit.
  // When progressive loading is not active (small tree), sliceVisibleTree
  // returns the original items reference unchanged (structural sharing).
  const progressiveSlice = useMemo(
    () => sliceVisibleTree(doc.items, activeStatuses, progressive.limit),
    [doc.items, activeStatuses, progressive.limit],
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

  // ── Context menu state (lifted from NodeRow) ──────────────────────
  const [contextMenu, setContextMenu] = useState<{ item: PRDItemData; x: number; y: number } | null>(null);
  const handleContextMenu = useCallback((item: PRDItemData, x: number, y: number) => {
    setContextMenu({ item, x, y });
  }, []);
  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  // ── Delegated event handlers ──────────────────────────────────────
  // A single set of click / contextmenu / keydown listeners on the tree
  // container replaces the per-node handlers that were previously on every
  // NodeRow. See tree-event-delegate.ts for routing logic.
  const treeHandlers = useTreeEventDelegation({
    getItem,
    onToggle: toggle,
    onSelectItem,
    onInlineAdd: onInlineAddSubmit ? handleInlineAdd : undefined,
    onRemoveItem,
    onContextMenu: onRemoveItem ? handleContextMenu : undefined,
    expanded,
  });

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
    // Tree — delegated event handlers replace per-node listeners
    h(
      "div",
      {
        class: "prd-tree",
        role: "tree",
        "aria-label": "PRD hierarchy",
        onClick: treeHandlers.onClick,
        onContextMenu: treeHandlers.onContextMenu,
        onKeyDown: treeHandlers.onKeyDown,
      },
      h(TreeNodes, {
        items: progressiveSlice.items,
        taskUsageById,
        weeklyBudget,
        depth: 0,
        expanded,
        selectedItemId,
        activeStatuses,
        bulkSelectedIds,
        onToggleBulkSelect,
        inlineAddParentId: onInlineAddSubmit ? inlineAddParentId : null,
        canInlineAdd: !!onInlineAddSubmit,
        onInlineAddSubmit: onInlineAddSubmit ? handleInlineAddSubmit : undefined,
        onInlineAddCancel: onInlineAddSubmit ? handleInlineAddCancel : undefined,
        highlightedItemId,
        highlightedNodeRef: deepLinkNodeRef,
        canDelete: !!onRemoveItem,
        deletingItemId,
        culler: cullerRef.current,
        listenerManager: listenerManagerRef.current,
      }),
      // Context menu (tree-level, lifted from NodeRow)
      contextMenu
        ? h(NodeContextMenu, {
            item: contextMenu.item,
            x: contextMenu.x,
            y: contextMenu.y,
            onClose: handleContextMenuClose,
            onRemove: onRemoveItem,
          })
        : null,
    ),
    // Progressive loading indicator — shown below the tree when there are
    // more nodes beyond the current rendering limit.
    progressive.hasMore
      ? h(LoadMoreIndicator, {
          renderedCount: progressiveSlice.renderedCount,
          totalCount: progressiveSlice.totalCount,
          chunkSize,
          isLoading: progressive.isLoading,
          onLoadMore: progressive.loadMore,
          onLoadAll: progressive.loadAll,
        })
      : null,
  );
}

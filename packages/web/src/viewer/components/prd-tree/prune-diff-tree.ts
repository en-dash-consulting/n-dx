/**
 * Visual diff tree for pruning operations.
 *
 * Renders the full PRD tree with prunable items highlighted in red with
 * strikethrough styling, and shows before/after completion stats per epic.
 * Supports expand/collapse to let users drill into affected subtrees.
 *
 * Data flow:
 * 1. Parent provides `prunableIds` (Set<string>) from the prune preview endpoint
 * 2. Parent provides `epicImpact` with before/after stats per affected epic
 * 3. This component fetches the full PRD tree from /data/prd.json
 * 4. Each node is annotated as "prunable" or "affected-parent" based on the IDs
 */

import { h, Fragment } from "preact";
import { useState, useMemo, useCallback, useEffect } from "preact/hooks";
import type { PRDItemData, PRDDocumentData, ItemStatus, ItemLevel } from "./types.js";
import { computeBranchStats, completionRatio } from "./compute.js";

// ── Types ────────────────────────────────────────────────────────────

export interface EpicImpact {
  id: string;
  title: string;
  before: { total: number; completed: number; pct: number };
  after: { total: number; completed: number; pct: number };
  removedCount: number;
}

export interface PruneDiffTreeProps {
  /** Set of all item IDs that will be pruned (includes descendants). */
  prunableIds: Set<string>;
  /** Per-epic before/after completion impact. */
  epicImpact: EpicImpact[];
  /** Callback when the tree data loads. */
  onLoad?: () => void;
}

// ── Constants ────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  completed: "\u25CF",    // ●
  in_progress: "\u25D0",  // ◐
  pending: "\u25CB",      // ○
  deferred: "\u25CC",     // ◌
  blocked: "\u2298",      // ⊘
  deleted: "\u2715",      // ✕
};

const LEVEL_LABELS: Record<ItemLevel, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

// ── Helpers ──────────────────────────────────────────────────────────

/** Check if any descendant of an item is in the prunable set. */
function hasAffectedDescendant(item: PRDItemData, prunableIds: Set<string>): boolean {
  if (prunableIds.has(item.id)) return true;
  if (item.children) {
    return item.children.some((child) => hasAffectedDescendant(child, prunableIds));
  }
  return false;
}

/** Collect all IDs in a tree for expand-all. */
function collectAllIds(items: PRDItemData[]): Set<string> {
  const ids = new Set<string>();
  function walk(nodes: PRDItemData[]): void {
    for (const item of nodes) {
      ids.add(item.id);
      if (item.children) walk(item.children);
    }
  }
  walk(items);
  return ids;
}

/** Collect IDs of items that should be expanded by default (affected paths only). */
function collectAffectedPaths(items: PRDItemData[], prunableIds: Set<string>): Set<string> {
  const ids = new Set<string>();
  function walk(nodes: PRDItemData[]): boolean {
    let anyAffected = false;
    for (const item of nodes) {
      if (prunableIds.has(item.id)) {
        ids.add(item.id);
        anyAffected = true;
        // Also expand children of prunable items
        if (item.children) {
          for (const child of item.children) ids.add(child.id);
        }
      } else if (item.children && item.children.some((c) => hasAffectedDescendant(c, prunableIds))) {
        ids.add(item.id);
        anyAffected = true;
        walk(item.children);
      }
    }
    return anyAffected;
  }
  walk(items);
  return ids;
}

// ── Sub-components ───────────────────────────────────────────────────

/** Epic impact badge showing before → after completion stats. */
function EpicImpactBadge({ impact }: { impact: EpicImpact }) {
  const pctChange = impact.after.pct - impact.before.pct;
  const pctLabel = pctChange > 0
    ? `+${pctChange}%`
    : pctChange < 0
      ? `${pctChange}%`
      : "0%";

  return h("span", { class: "prune-diff-epic-impact" },
    h("span", { class: "prune-diff-impact-before" },
      `${impact.before.completed}/${impact.before.total}`,
    ),
    h("span", { class: "prune-diff-impact-arrow" }, "\u2192"),
    h("span", { class: "prune-diff-impact-after" },
      `${impact.after.completed}/${impact.after.total}`,
    ),
    h("span", {
      class: `prune-diff-impact-pct${pctChange >= 0 ? " prune-diff-impact-positive" : " prune-diff-impact-negative"}`,
    }, pctLabel),
    h("span", { class: "prune-diff-impact-removed" },
      `-${impact.removedCount} item${impact.removedCount !== 1 ? "s" : ""}`,
    ),
  );
}

/** Single tree node in the diff view. */
function DiffNodeRow({
  item,
  depth,
  isExpanded,
  hasChildren,
  isPrunable,
  isAffectedParent,
  epicImpact,
  onToggle,
}: {
  item: PRDItemData;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  isPrunable: boolean;
  isAffectedParent: boolean;
  epicImpact?: EpicImpact;
  onToggle: () => void;
}) {
  const indent = depth * 24;
  const children = item.children ?? [];
  const stats = hasChildren ? computeBranchStats(children) : null;
  const ratio = stats ? completionRatio(stats) : 0;

  const rowClasses = [
    "prune-diff-node-row",
    hasChildren ? "prune-diff-node-expandable" : "",
    isPrunable ? "prune-diff-node-prunable" : "",
    isAffectedParent ? "prune-diff-node-affected" : "",
    `prd-level-${item.level}`,
  ].filter(Boolean).join(" ");

  const handleClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("prune-diff-chevron")) {
      if (hasChildren) onToggle();
      return;
    }
    if (hasChildren) onToggle();
  };

  return h("div", {
    class: rowClasses,
    style: `padding-left: ${indent + 8}px`,
    onClick: handleClick,
    role: "treeitem",
    "aria-expanded": hasChildren ? String(isExpanded) : undefined,
  },
    // Chevron
    h("span", {
      class: `prune-diff-chevron${hasChildren && isExpanded ? " prune-diff-chevron-open" : ""}`,
      "aria-hidden": "true",
    }, hasChildren ? "\u25B6" : ""),

    // Diff indicator
    isPrunable
      ? h("span", { class: "prune-diff-indicator prune-diff-indicator-remove", title: "Will be removed" }, "\u2212")
      : isAffectedParent
        ? h("span", { class: "prune-diff-indicator prune-diff-indicator-modified", title: "Children affected" }, "\u2022")
        : h("span", { class: "prune-diff-indicator" }),

    // Status icon
    h("span", {
      class: `prune-diff-status prd-status-${item.status}${isPrunable ? " prune-diff-status-prunable" : ""}`,
    }, STATUS_ICONS[item.status] ?? "\u25CF"),

    // Level badge
    h("span", {
      class: `prd-level-badge prd-level-${item.level}`,
    }, LEVEL_LABELS[item.level]),

    // Title
    h("span", {
      class: `prune-diff-title${isPrunable ? " prune-diff-title-prunable" : ""}`,
    }, item.title),

    // Progress for parent nodes
    stats && stats.total > 0
      ? h("span", { class: "prune-diff-progress" },
          `${stats.completed}/${stats.total}`,
          h("span", { class: "prune-diff-pct" }, ` ${Math.round(ratio * 100)}%`),
        )
      : null,

    // Epic impact badge
    epicImpact
      ? h(EpicImpactBadge, { impact: epicImpact })
      : null,
  );
}

/** Recursive diff tree renderer. */
function DiffTreeNodes({
  items,
  depth,
  expanded,
  prunableIds,
  epicImpactMap,
  onToggle,
}: {
  items: PRDItemData[];
  depth: number;
  expanded: Set<string>;
  prunableIds: Set<string>;
  epicImpactMap: Map<string, EpicImpact>;
  onToggle: (id: string) => void;
}) {
  return h(Fragment, null,
    items.map((item) => {
      const children = item.children ?? [];
      const hasChildren = children.length > 0;
      const isOpen = expanded.has(item.id);
      const isPrunable = prunableIds.has(item.id);
      const isAffectedParent = !isPrunable && hasAffectedDescendant(item, prunableIds);

      return h("div", { key: item.id, class: "prune-diff-node" },
        h(DiffNodeRow, {
          item,
          depth,
          isExpanded: isOpen,
          hasChildren,
          isPrunable,
          isAffectedParent,
          epicImpact: epicImpactMap.get(item.id),
          onToggle: () => onToggle(item.id),
        }),
        hasChildren && isOpen
          ? h("div", { class: "prune-diff-children", role: "group" },
              h(DiffTreeNodes, {
                items: children,
                depth: depth + 1,
                expanded,
                prunableIds,
                epicImpactMap,
                onToggle,
              }),
            )
          : null,
      );
    }),
  );
}

// ── Main Component ───────────────────────────────────────────────────

export function PruneDiffTree({ prunableIds, epicImpact, onLoad }: PruneDiffTreeProps) {
  const [doc, setDoc] = useState<PRDDocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filterMode, setFilterMode] = useState<"affected" | "all">("affected");

  // Fetch the full PRD tree
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/data/prd.json");
        if (!res.ok) {
          setError("Could not load PRD tree");
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setDoc(data);
          // Default expand: affected paths only
          const affectedPaths = collectAffectedPaths(data.items, prunableIds);
          setExpanded(affectedPaths);
          onLoad?.();
        }
      } catch {
        if (!cancelled) setError("Could not load PRD tree");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [prunableIds, onLoad]);

  // Build epic impact lookup map
  const epicImpactMap = useMemo(() => {
    const map = new Map<string, EpicImpact>();
    for (const entry of epicImpact) map.set(entry.id, entry);
    return map;
  }, [epicImpact]);

  // Filter tree to only show affected branches
  const filteredItems = useMemo(() => {
    if (!doc || filterMode === "all") return doc?.items ?? [];

    function filterAffected(items: PRDItemData[]): PRDItemData[] {
      const result: PRDItemData[] = [];
      for (const item of items) {
        if (hasAffectedDescendant(item, prunableIds)) {
          result.push({
            ...item,
            children: item.children ? filterAffected(item.children) : undefined,
          });
        }
      }
      return result;
    }

    return filterAffected(doc.items);
  }, [doc, filterMode, prunableIds]);

  const allIds = useMemo(() => doc ? collectAllIds(doc.items) : new Set<string>(), [doc]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setExpanded(new Set(allIds)), [allIds]);
  const collapseAll = useCallback(() => setExpanded(new Set<string>()), []);

  // Loading state
  if (loading) {
    return h("div", { class: "prune-diff-loading" },
      h("div", { class: "rex-analyze-spinner" }),
      h("span", null, "Loading tree diff..."),
    );
  }

  // Error state
  if (error) {
    return h("div", { class: "prune-diff-error" }, error);
  }

  if (!doc || filteredItems.length === 0) {
    return h("div", { class: "prune-diff-empty" }, "No affected items to display.");
  }

  // Overall before/after stats
  const totalBefore = epicImpact.reduce((s, e) => s + e.before.total, 0);
  const totalCompletedBefore = epicImpact.reduce((s, e) => s + e.before.completed, 0);
  const totalAfter = epicImpact.reduce((s, e) => s + e.after.total, 0);
  const totalCompletedAfter = epicImpact.reduce((s, e) => s + e.after.completed, 0);
  const pctBefore = totalBefore > 0 ? Math.round((totalCompletedBefore / totalBefore) * 100) : 0;
  const pctAfter = totalAfter > 0 ? Math.round((totalCompletedAfter / totalAfter) * 100) : 0;

  return h("div", { class: "prune-diff-container" },
    // Header with controls
    h("div", { class: "prune-diff-header" },
      h("h4", null, "Tree Diff"),
      h("div", { class: "prune-diff-controls" },
        // Filter toggle
        h("button", {
          class: `prune-diff-filter-btn${filterMode === "affected" ? " active" : ""}`,
          onClick: () => setFilterMode("affected"),
          title: "Show only affected branches",
        }, "Affected"),
        h("button", {
          class: `prune-diff-filter-btn${filterMode === "all" ? " active" : ""}`,
          onClick: () => setFilterMode("all"),
          title: "Show full tree",
        }, "Full Tree"),
        h("span", { class: "prune-diff-separator" }),
        h("button", {
          class: "prune-diff-toolbar-btn",
          onClick: expandAll,
          title: "Expand all",
        }, "Expand"),
        h("button", {
          class: "prune-diff-toolbar-btn",
          onClick: collapseAll,
          title: "Collapse all",
        }, "Collapse"),
      ),
    ),

    // Legend
    h("div", { class: "prune-diff-legend" },
      h("span", { class: "prune-diff-legend-item prune-diff-legend-remove" },
        h("span", { class: "prune-diff-indicator prune-diff-indicator-remove" }, "\u2212"),
        "Will be removed",
      ),
      h("span", { class: "prune-diff-legend-item prune-diff-legend-affected" },
        h("span", { class: "prune-diff-indicator prune-diff-indicator-modified" }, "\u2022"),
        "Children affected",
      ),
    ),

    // Overall completion impact
    epicImpact.length > 0
      ? h("div", { class: "prune-diff-overall-impact" },
          h("span", { class: "prune-diff-overall-label" }, "Overall Completion:"),
          h("span", { class: "prune-diff-impact-before" }, `${pctBefore}%`),
          h("span", { class: "prune-diff-impact-arrow" }, "\u2192"),
          h("span", {
            class: `prune-diff-impact-after${pctAfter !== pctBefore ? " prune-diff-impact-changed" : ""}`,
          }, `${pctAfter}%`),
          pctAfter !== pctBefore
            ? h("span", { class: "prune-diff-impact-delta" },
                `(${pctAfter > pctBefore ? "+" : ""}${pctAfter - pctBefore}pp)`,
              )
            : null,
        )
      : null,

    // Tree
    h("div", { class: "prune-diff-tree", role: "tree", "aria-label": "Prune diff tree" },
      h(DiffTreeNodes, {
        items: filteredItems,
        depth: 0,
        expanded,
        prunableIds,
        epicImpactMap,
        onToggle: toggle,
      }),
    ),
  );
}

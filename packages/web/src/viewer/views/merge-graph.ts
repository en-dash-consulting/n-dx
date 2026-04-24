/**
 * MergeGraphView — PRD/merge context graph.
 *
 * Renders PRD items and git merge commits as a connected graph so users can
 * see which code changes were shipped against which planned work. PRD items
 * form a hierarchical tree (left side). Merge nodes cluster on the right side,
 * linked to the PRD items they implemented.
 *
 * Interactions:
 * - Pan: mouse drag or two-finger drag on the canvas
 * - Zoom: Ctrl+scroll or pinch
 * - Click a merge node: show file-change list in the detail panel
 * - Click a PRD node: highlight all merge nodes linked to it
 * - Toolbar: zoom in/out/fit, filter by status and date range
 *
 * @module web/viewer/views/merge-graph
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useMemo, useCallback, useRef } from "preact/hooks";
import { usePanZoom } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";

// ── API types (mirrors packages/web/src/server/merge-history.ts) ─────────────

type FileChangeStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "typechange"
  | "unmerged"
  | "unknown";

interface FileChange {
  status: FileChangeStatus;
  path: string;
  oldPath?: string;
}

type EdgeAttribution = "commit-message" | "branch-name" | "hench-run";

interface MergeGraphEdge {
  from: string;
  to: string;
  attribution: EdgeAttribution;
}

interface PrdNode {
  kind: "prd";
  id: string;
  title: string;
  level: string;
  status: string;
  parentId?: string;
  priority?: string;
}

interface MergeNode {
  kind: "merge";
  id: string;
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  mergedAt: string;
  author: string;
  parents: string[];
  sourceBranch?: string;
  filesSummary: {
    added: number;
    modified: number;
    deleted: number;
    renamed: number;
    copied: number;
    other: number;
    total: number;
  };
  files: FileChange[];
}

interface MergeGraph {
  generatedAt: string;
  nodes: Array<PrdNode | MergeNode>;
  edges: MergeGraphEdge[];
  stats: {
    merges: number;
    mergesWithPrdLinkage: number;
    mergesWithoutPrdLinkage: number;
    prdItemsLinked: number;
  };
}

// ── Layout constants ─────────────────────────────────────────────────────────

const COL_W = 200;   // horizontal spacing per PRD level
const ROW_H = 44;    // vertical spacing between nodes
const MERGE_X_GAP = COL_W * 1.5; // gap between last PRD column and merge column

// ── Status and level config ──────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  pending:     "var(--text-muted)",
  in_progress: "var(--accent)",
  completed:   "var(--green)",
  failing:     "var(--brand-rose)",
  blocked:     "var(--brand-orange)",
  deferred:    "var(--brand-purple)",
};

const LEVEL_DEPTH: Record<string, number> = {
  epic: 0, feature: 1, task: 2, subtask: 3,
};

const LEVEL_RADIUS: Record<string, number> = {
  epic: 13, feature: 10, task: 7, subtask: 5,
};

// ── Layout computation ────────────────────────────────────────────────────────

interface LayoutPrdNode {
  kind: "prd";
  id: string;
  x: number;
  y: number;
  node: PrdNode;
}

interface LayoutMergeNode {
  kind: "merge";
  id: string;
  x: number;
  y: number;
  node: MergeNode;
  linked: boolean;
}

type LayoutNode = LayoutPrdNode | LayoutMergeNode;

interface LayoutEdge {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: "tree" | "merge-link";
  attribution?: EdgeAttribution;
}

interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  fitVB: { x: number; y: number; w: number; h: number };
}

function computeLayout(
  graph: MergeGraph,
  visiblePrdIds: Set<string>,
  visibleMergeIds: Set<string>,
): Layout {
  const prdNodes = graph.nodes.filter(
    (n): n is PrdNode => n.kind === "prd" && visiblePrdIds.has(n.id),
  );
  const mergeNodes = graph.nodes.filter(
    (n): n is MergeNode => n.kind === "merge" && visibleMergeIds.has(n.id),
  );

  // ── Build parent→children map ────────────────────────────────────────────
  const childrenMap = new Map<string | null, PrdNode[]>();
  childrenMap.set(null, []);

  for (const n of prdNodes) {
    const parentKey = n.parentId && visiblePrdIds.has(n.parentId) ? n.parentId : null;
    const arr = childrenMap.get(parentKey) ?? [];
    arr.push(n);
    childrenMap.set(parentKey, arr);
  }

  // ── DFS traversal to assign y positions ─────────────────────────────────
  const positions = new Map<string, { x: number; y: number }>();
  let yCounter = 0;

  function traverse(nodeId: string): void {
    const node = prdNodes.find((p) => p.id === nodeId);
    if (!node) return;
    const kids = childrenMap.get(nodeId) ?? [];

    if (kids.length === 0) {
      positions.set(nodeId, {
        x: (LEVEL_DEPTH[node.level] ?? 3) * COL_W + COL_W / 2,
        y: yCounter * ROW_H,
      });
      yCounter++;
      return;
    }

    const startY = yCounter;
    for (const kid of kids) traverse(kid.id);
    const endY = yCounter - 1;

    positions.set(nodeId, {
      x: (LEVEL_DEPTH[node.level] ?? 3) * COL_W + COL_W / 2,
      y: ((startY + endY) / 2) * ROW_H,
    });
  }

  for (const root of childrenMap.get(null) ?? []) {
    traverse(root.id);
  }

  // ── Build PRD layout nodes ───────────────────────────────────────────────
  const layoutNodes: LayoutNode[] = [];
  for (const n of prdNodes) {
    const pos = positions.get(n.id);
    if (pos) {
      layoutNodes.push({ kind: "prd", id: n.id, x: pos.x, y: pos.y, node: n });
    }
  }

  // ── Build tree edges ─────────────────────────────────────────────────────
  const layoutEdges: LayoutEdge[] = [];
  for (const n of prdNodes) {
    if (n.parentId && visiblePrdIds.has(n.parentId)) {
      const from = positions.get(n.parentId);
      const to = positions.get(n.id);
      if (from && to) {
        layoutEdges.push({
          id: `tree-${n.parentId}-${n.id}`,
          x1: from.x, y1: from.y, x2: to.x, y2: to.y,
          kind: "tree",
        });
      }
    }
  }

  // ── Position merge nodes ─────────────────────────────────────────────────
  // x = one column to the right of the deepest PRD level
  const maxLevelDepth = prdNodes.length > 0
    ? Math.max(...prdNodes.map((n) => LEVEL_DEPTH[n.level] ?? 3))
    : 3;
  const mergeX = (maxLevelDepth + 1) * COL_W + COL_W / 2 + MERGE_X_GAP;

  // Edges from this view (filtered)
  const visibleEdges = graph.edges.filter(
    (e) => visibleMergeIds.has(e.from) && visiblePrdIds.has(e.to),
  );
  const linkedMergeSet = new Set(visibleEdges.map((e) => e.from));

  // For each merge, compute ideal y = average y of its linked PRD nodes
  const mergeIdealY = new Map<string, number>();
  for (const mn of mergeNodes) {
    const linked = visibleEdges.filter((e) => e.from === mn.id);
    if (linked.length > 0) {
      const ys = linked.map((e) => positions.get(e.to)?.y ?? 0);
      mergeIdealY.set(mn.id, ys.reduce((a, b) => a + b, 0) / ys.length);
    }
  }

  // Sort linked merges by ideal y, then by date; unlinked by date desc
  const linkedMerges = mergeNodes
    .filter((n) => linkedMergeSet.has(n.id))
    .sort((a, b) => (mergeIdealY.get(a.id) ?? 0) - (mergeIdealY.get(b.id) ?? 0));
  const unlinkedMerges = mergeNodes
    .filter((n) => !linkedMergeSet.has(n.id))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));

  // Spread merge nodes vertically so they don't overlap
  const mergePositions = new Map<string, { x: number; y: number }>();
  let lastY = -Infinity;
  for (const mn of linkedMerges) {
    let y = mergeIdealY.get(mn.id) ?? lastY + ROW_H;
    if (y < lastY + ROW_H) y = lastY + ROW_H;
    lastY = y;
    mergePositions.set(mn.id, { x: mergeX, y });
  }

  // Unlinked merges cluster below linked ones
  let unlinkedY = lastY === -Infinity ? 0 : lastY + ROW_H * 2;
  for (const mn of unlinkedMerges) {
    mergePositions.set(mn.id, { x: mergeX, y: unlinkedY });
    unlinkedY += ROW_H;
  }

  for (const mn of mergeNodes) {
    const pos = mergePositions.get(mn.id);
    if (pos) {
      layoutNodes.push({
        kind: "merge", id: mn.id, x: pos.x, y: pos.y,
        node: mn, linked: linkedMergeSet.has(mn.id),
      });
    }
  }

  // ── Build merge-to-PRD edges ─────────────────────────────────────────────
  for (const edge of visibleEdges) {
    const from = mergePositions.get(edge.from);
    const to = positions.get(edge.to);
    if (from && to) {
      layoutEdges.push({
        id: `ml-${edge.from}-${edge.to}`,
        x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        kind: "merge-link", attribution: edge.attribution,
      });
    }
  }

  // ── Compute fit viewBox ──────────────────────────────────────────────────
  if (layoutNodes.length === 0) {
    return {
      nodes: layoutNodes,
      edges: layoutEdges,
      fitVB: { x: -50, y: -50, w: 900, h: 600 },
    };
  }
  const xs = layoutNodes.map((n) => n.x);
  const ys = layoutNodes.map((n) => n.y);
  const pad = COL_W * 0.7;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    fitVB: { x: minX, y: minY, w: Math.max(maxX - minX, 400), h: Math.max(maxY - minY, 300) },
  };
}

// ── Attribution stroke ────────────────────────────────────────────────────────

function attributionStroke(attr?: EdgeAttribution): string {
  if (attr === "commit-message") return "var(--accent)";
  if (attr === "branch-name") return "var(--brand-purple)";
  if (attr === "hench-run") return "var(--brand-orange)";
  return "var(--border-strong)";
}

// ── Status short label ────────────────────────────────────────────────────────

function shortStatus(s: string): string {
  if (s === "in_progress") return "▶";
  if (s === "completed") return "✓";
  if (s === "failing") return "✗";
  if (s === "blocked") return "⊘";
  if (s === "deferred") return "⇥";
  return "○";
}

// ── File change summary ───────────────────────────────────────────────────────

function statusIcon(s: FileChangeStatus): string {
  if (s === "added") return "+";
  if (s === "deleted") return "-";
  if (s === "renamed") return "→";
  if (s === "modified") return "~";
  return "?";
}

function statusClass(s: FileChangeStatus): string {
  if (s === "added") return "mg-file-added";
  if (s === "deleted") return "mg-file-deleted";
  if (s === "renamed") return "mg-file-renamed";
  return "";
}

// ── Detail panel ─────────────────────────────────────────────────────────────

type SelectedNode =
  | { kind: "prd"; node: PrdNode; linkedMergeIds: string[] }
  | { kind: "merge"; node: MergeNode };

function DetailPanel({ selection, onClose }: {
  selection: SelectedNode;
  onClose: () => void;
}) {
  if (selection.kind === "merge") {
    const mn = selection.node;
    const { added, modified, deleted, renamed, total } = mn.filesSummary;
    return h("div", { class: "mg-detail" },
      h("div", { class: "mg-detail-header" },
        h("span", { class: "mg-detail-title" }, mn.shortSha),
        h("button", {
          class: "mg-detail-close",
          onClick: onClose,
          "aria-label": "Close",
        }, "×"),
      ),
      h("p", { class: "mg-detail-subject" }, mn.subject),
      h("div", { class: "mg-detail-meta" },
        h("span", null, mn.author),
        h("span", null, " · "),
        h("span", null, new Date(mn.mergedAt).toLocaleDateString()),
      ),
      mn.sourceBranch
        ? h("div", { class: "mg-detail-branch" }, "Branch: ", mn.sourceBranch)
        : null,
      h("div", { class: "mg-detail-summary" },
        added > 0 ? h("span", { class: "mg-file-added" }, `+${added}`) : null,
        modified > 0 ? h("span", null, ` ~${modified}`) : null,
        deleted > 0 ? h("span", { class: "mg-file-deleted" }, ` -${deleted}`) : null,
        renamed > 0 ? h("span", null, ` →${renamed}`) : null,
        h("span", { class: "mg-detail-total" }, ` ${total} file${total !== 1 ? "s" : ""}`),
      ),
      mn.files.length > 0
        ? h("ul", { class: "mg-file-list" },
            mn.files.map((f) =>
              h("li", { key: f.path, class: `mg-file-item ${statusClass(f.status)}` },
                h("span", { class: "mg-file-icon" }, statusIcon(f.status)),
                h("span", { class: "mg-file-path", title: f.path }, f.path),
              ),
            ),
          )
        : h("p", { class: "mg-detail-empty" }, "No file changes recorded."),
    );
  }

  const pn = selection.node;
  return h("div", { class: "mg-detail" },
    h("div", { class: "mg-detail-header" },
      h("span", { class: "mg-detail-title" }, pn.level.toUpperCase()),
      h("button", {
        class: "mg-detail-close",
        onClick: onClose,
        "aria-label": "Close",
      }, "×"),
    ),
    h("p", { class: "mg-detail-subject" }, pn.title),
    h("div", { class: "mg-detail-meta" },
      h("span", { style: { color: STATUS_COLOR[pn.status] ?? "inherit" } }, pn.status.replace("_", " ")),
      pn.priority ? h("span", null, ` · ${pn.priority}`) : null,
    ),
    selection.linkedMergeIds.length > 0
      ? h("div", { class: "mg-detail-links" },
          h("p", { class: "mg-detail-links-label" }, `${selection.linkedMergeIds.length} linked merge${selection.linkedMergeIds.length !== 1 ? "s" : ""}`),
        )
      : h("p", { class: "mg-detail-empty" }, "No linked merges."),
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

const ALL_PRD_STATUSES = ["pending", "in_progress", "completed", "failing", "blocked", "deferred"];

interface FilterState {
  /** IDs of epics to include (empty = all) */
  epicIds: Set<string>;
  /** PRD statuses to include */
  statuses: Set<string>;
  /** Date range for merge commits */
  dateFrom: string;
  dateTo: string;
}

function defaultFilters(): FilterState {
  return {
    epicIds: new Set(),
    statuses: new Set(ALL_PRD_STATUSES),
    dateFrom: "",
    dateTo: "",
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export interface MergeGraphViewProps {
  navigateTo?: NavigateTo;
}

export function MergeGraphView({ navigateTo }: MergeGraphViewProps) {
  const [graph, setGraph] = useState<MergeGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // ── Fetch graph ────────────────────────────────────────────────────────────
  useEffect(() => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);

    fetch("/api/merge-graph?max=500", { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<MergeGraph>;
      })
      .then((data) => {
        setGraph(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err.message);
        setLoading(false);
      });

    return () => ctrl.abort();
  }, []);

  // ── Compute visible sets based on filters ──────────────────────────────────
  const epics = useMemo(() => {
    if (!graph) return [] as PrdNode[];
    return graph.nodes.filter((n): n is PrdNode => n.kind === "prd" && n.level === "epic");
  }, [graph]);

  const { visiblePrdIds, visibleMergeIds } = useMemo(() => {
    if (!graph) return { visiblePrdIds: new Set<string>(), visibleMergeIds: new Set<string>() };

    const prdNodes = graph.nodes.filter((n): n is PrdNode => n.kind === "prd");
    const mergeNodes = graph.nodes.filter((n): n is MergeNode => n.kind === "merge");

    // Build ancestor map (id -> set of ancestor ids including self)
    const parentMap = new Map<string, string | undefined>();
    for (const n of prdNodes) parentMap.set(n.id, n.parentId);

    function getAncestors(id: string): Set<string> {
      const result = new Set<string>();
      let cur: string | undefined = id;
      while (cur) {
        result.add(cur);
        cur = parentMap.get(cur);
      }
      return result;
    }

    // Build subtree sets for each epic
    const epicSubtrees = new Map<string, Set<string>>();
    for (const epic of epics) {
      const subtree = new Set<string>();
      // BFS from epic
      const queue = [epic.id];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        subtree.add(cur);
        for (const n of prdNodes) {
          if (n.parentId === cur) queue.push(n.id);
        }
      }
      epicSubtrees.set(epic.id, subtree);
    }

    // Determine which PRD nodes pass epic filter
    const epicFilter = filters.epicIds.size === 0
      ? (_id: string) => true
      : (id: string) => {
          for (const epicId of filters.epicIds) {
            const subtree = epicSubtrees.get(epicId);
            if (subtree?.has(id)) return true;
          }
          return false;
        };

    const prdSet = new Set<string>();
    for (const n of prdNodes) {
      if (!epicFilter(n.id)) continue;
      if (!filters.statuses.has(n.status)) continue;
      prdSet.add(n.id);
    }

    // Merge date filter
    const fromMs = filters.dateFrom ? new Date(filters.dateFrom).getTime() : -Infinity;
    const toMs = filters.dateTo ? new Date(filters.dateTo + "T23:59:59Z").getTime() : Infinity;

    const mergeSet = new Set<string>();
    for (const mn of mergeNodes) {
      const ts = new Date(mn.mergedAt).getTime();
      if (ts < fromMs || ts > toMs) continue;
      mergeSet.add(mn.id);
    }

    return { visiblePrdIds: prdSet, visibleMergeIds: mergeSet };
  }, [graph, epics, filters]);

  // ── Compute layout ─────────────────────────────────────────────────────────
  const layout = useMemo(() => {
    if (!graph) return null;
    return computeLayout(graph, visiblePrdIds, visibleMergeIds);
  }, [graph, visiblePrdIds, visibleMergeIds]);

  // ── usePanZoom ─────────────────────────────────────────────────────────────
  const fitVB = layout?.fitVB ?? { x: -50, y: -50, w: 900, h: 600 };
  const {
    viewBox, panning, svgRef,
    handleWheel, startPan, movePan, endPan,
    handleZoomIn, handleZoomOut, handleFit,
  } = usePanZoom(fitVB);

  // ── Node click handlers ────────────────────────────────────────────────────
  const handlePrdClick = useCallback((node: PrdNode) => {
    if (!graph) return;
    const linkedEdges = graph.edges.filter((e) => e.to === node.id && visibleMergeIds.has(e.from));
    const linkedMergeIds = linkedEdges.map((e) => e.from);
    setSelected({ kind: "prd", node, linkedMergeIds });
    setHighlightIds(new Set([node.id, ...linkedMergeIds]));
  }, [graph, visibleMergeIds]);

  const handleMergeClick = useCallback((node: MergeNode) => {
    if (!graph) return;
    const linkedEdges = graph.edges.filter((e) => e.from === node.id && visiblePrdIds.has(e.to));
    const linkedPrdIds = linkedEdges.map((e) => e.to);
    setSelected({ kind: "merge", node });
    setHighlightIds(new Set([node.id, ...linkedPrdIds]));
  }, [graph, visiblePrdIds]);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setHighlightIds(new Set());
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return h("div", { class: "mg-loading" }, "Loading merge graph…");
  }

  if (error) {
    return h("div", { class: "mg-error" },
      h("p", null, `Failed to load merge graph: ${error}`),
      h("button", {
        class: "mg-retry",
        onClick: () => { setLoading(true); setError(null); },
      }, "Retry"),
    );
  }

  if (!graph || !layout) return null;

  const hasHighlight = highlightIds.size > 0;
  const noMerges = graph.stats.merges === 0;
  const noLinks = graph.stats.mergesWithPrdLinkage === 0 && !noMerges;

  const vbStr = `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`;

  return h(Fragment, null,
    // ── Header ───────────────────────────────────────────────────────────────
    h("div", { class: "mg-header" },
      h("div", { class: "mg-header-left" },
        h("h2", { class: "mg-title" }, "Context Graph"),
        graph.stats.merges > 0
          ? h("span", { class: "mg-stats" },
              `${graph.stats.mergesWithPrdLinkage}/${graph.stats.merges} merges linked`,
            )
          : null,
      ),
      h("div", { class: "mg-header-right" },
        navigateTo
          ? h("button", {
              class: "mg-nav-btn",
              onClick: () => navigateTo("prd"),
              title: "Back to Tasks",
            }, "☑ Tasks")
          : null,
        h("button", {
          class: `mg-filter-btn${showFilters ? " active" : ""}`,
          onClick: () => setShowFilters((v) => !v),
          title: "Toggle filters",
        }, "⋮ Filters"),
      ),
    ),

    // ── Filter bar ───────────────────────────────────────────────────────────
    showFilters
      ? h("div", { class: "mg-filter-bar" },
          // Epic selector
          epics.length > 0
            ? h("div", { class: "mg-filter-group" },
                h("span", { class: "mg-filter-label" }, "Epics"),
                h("div", { class: "mg-filter-chips" },
                  epics.map((epic) =>
                    h("button", {
                      key: epic.id,
                      class: `mg-chip${filters.epicIds.has(epic.id) ? " active" : ""}`,
                      onClick: () => setFilters((f) => {
                        const next = new Set(f.epicIds);
                        if (next.has(epic.id)) next.delete(epic.id);
                        else next.add(epic.id);
                        return { ...f, epicIds: next };
                      }),
                      title: epic.title,
                    }, epic.title.length > 22 ? epic.title.slice(0, 20) + "…" : epic.title),
                  ),
                ),
              )
            : null,

          // Status filter
          h("div", { class: "mg-filter-group" },
            h("span", { class: "mg-filter-label" }, "Status"),
            h("div", { class: "mg-filter-chips" },
              ALL_PRD_STATUSES.map((s) =>
                h("button", {
                  key: s,
                  class: `mg-chip${filters.statuses.has(s) ? " active" : ""}`,
                  style: filters.statuses.has(s) ? { borderColor: STATUS_COLOR[s] } : {},
                  onClick: () => setFilters((f) => {
                    const next = new Set(f.statuses);
                    if (next.has(s)) {
                      if (next.size === 1) return f; // keep at least one
                      next.delete(s);
                    } else {
                      next.add(s);
                    }
                    return { ...f, statuses: next };
                  }),
                }, s.replace("_", " ")),
              ),
            ),
          ),

          // Date range
          h("div", { class: "mg-filter-group" },
            h("span", { class: "mg-filter-label" }, "Merge date"),
            h("input", {
              class: "mg-date-input",
              type: "date",
              value: filters.dateFrom,
              "aria-label": "From date",
              onInput: (e: Event) => setFilters((f) => ({
                ...f, dateFrom: (e.target as HTMLInputElement).value,
              })),
            }),
            h("span", { class: "mg-date-sep" }, "–"),
            h("input", {
              class: "mg-date-input",
              type: "date",
              value: filters.dateTo,
              "aria-label": "To date",
              onInput: (e: Event) => setFilters((f) => ({
                ...f, dateTo: (e.target as HTMLInputElement).value,
              })),
            }),
          ),

          filters.epicIds.size > 0 || filters.statuses.size < ALL_PRD_STATUSES.length || filters.dateFrom || filters.dateTo
            ? h("button", {
                class: "mg-clear-btn",
                onClick: () => setFilters(defaultFilters()),
              }, "Clear filters")
            : null,
        )
      : null,

    // ── Empty state banners ──────────────────────────────────────────────────
    noMerges
      ? h("div", { class: "mg-notice" }, "No merge commit history found. PRD items are shown without merge linkage.")
      : noLinks
        ? h("div", { class: "mg-notice" }, "No merge commits could be linked to PRD items yet. Merges are shown separately on the right.")
        : null,

    // ── Main canvas ──────────────────────────────────────────────────────────
    h("div", { class: "mg-canvas" },
      // Zoom controls
      h("div", { class: "mg-zoom-controls", "aria-label": "Zoom controls" },
        h("button", { onClick: handleZoomIn, title: "Zoom in", "aria-label": "Zoom in" }, "+"),
        h("button", { onClick: handleZoomOut, title: "Zoom out", "aria-label": "Zoom out" }, "−"),
        h("button", { onClick: handleFit, title: "Fit to content", "aria-label": "Fit" }, "⊡"),
      ),

      // Legend
      h("div", { class: "mg-legend" },
        h("span", { class: "mg-legend-item" },
          h("svg", { width: 12, height: 12, viewBox: "0 0 12 12" },
            h("circle", { cx: 6, cy: 6, r: 5, fill: "var(--accent)", "fill-opacity": "0.25", stroke: "var(--accent)", "stroke-width": 1.5 }),
          ),
          " PRD item",
        ),
        h("span", { class: "mg-legend-item" },
          h("svg", { width: 12, height: 12, viewBox: "0 0 12 12" },
            h("rect", { x: 2, y: 2, width: 8, height: 8, transform: "rotate(45 6 6)", fill: "var(--brand-purple)", "fill-opacity": "0.25", stroke: "var(--brand-purple)", "stroke-width": 1.5 }),
          ),
          " Merge",
        ),
      ),

      // SVG graph
      h("svg", {
        ref: svgRef,
        class: `mg-svg${panning ? " grabbing" : ""}`,
        viewBox: vbStr,
        onWheel: handleWheel,
        onMouseDown: (e: MouseEvent) => {
          // Only start pan on background click
          const target = e.target as SVGElement;
          if (target === svgRef.current || target.classList.contains("mg-bg")) {
            startPan(e);
          }
        },
        onMouseMove: movePan,
        onMouseUp: endPan,
        onMouseLeave: endPan,
        onClick: (e: MouseEvent) => {
          const target = e.target as SVGElement;
          if (target === svgRef.current || target.classList.contains("mg-bg")) {
            clearSelection();
          }
        },
        "aria-label": "PRD and merge context graph",
        role: "img",
      },
        // Background rect for click-to-deselect
        h("rect", {
          class: "mg-bg",
          x: viewBox.x, y: viewBox.y,
          width: viewBox.w, height: viewBox.h,
          fill: "transparent",
        }),

        // ── Edges ────────────────────────────────────────────────────────────
        h("g", { class: "mg-edges" },
          layout.edges.map((edge) => {
            const isHighlighted = hasHighlight
              ? highlightIds.has(edge.id.replace(/^(tree|ml)-/, "").split("-")[0])
              : false;

            if (edge.kind === "tree") {
              // Elbow connector: horizontal then vertical
              const midX = (edge.x1 + edge.x2) / 2;
              return h("path", {
                key: edge.id,
                class: `mg-edge-tree${isHighlighted ? " highlighted" : ""}`,
                d: `M${edge.x1},${edge.y1} C${midX},${edge.y1} ${midX},${edge.y2} ${edge.x2},${edge.y2}`,
                fill: "none",
              });
            }

            // Merge link: straight line
            const stroke = attributionStroke(edge.attribution);
            const midX = (edge.x1 + edge.x2) / 2;
            return h("path", {
              key: edge.id,
              class: `mg-edge-link${isHighlighted ? " highlighted" : ""}`,
              d: `M${edge.x1},${edge.y1} C${midX},${edge.y1} ${midX},${edge.y2} ${edge.x2},${edge.y2}`,
              fill: "none",
              stroke,
              "stroke-opacity": isHighlighted || !hasHighlight ? 0.7 : 0.15,
            });
          }),
        ),

        // ── PRD nodes ────────────────────────────────────────────────────────
        h("g", { class: "mg-prd-nodes" },
          layout.nodes
            .filter((n): n is LayoutPrdNode => n.kind === "prd")
            .map((ln) => {
              const n = ln.node;
              const r = LEVEL_RADIUS[n.level] ?? 6;
              const fill = STATUS_COLOR[n.status] ?? "var(--text-muted)";
              const isHighlighted = hasHighlight ? highlightIds.has(n.id) : true;
              const isSelected = selected?.kind === "prd" && selected.node.id === n.id;
              return h("g", {
                key: n.id,
                class: `mg-node mg-prd-node${isSelected ? " selected" : ""}`,
                transform: `translate(${ln.x},${ln.y})`,
                onClick: (e: MouseEvent) => { e.stopPropagation(); handlePrdClick(n); },
                role: "button",
                tabIndex: 0,
                "aria-label": `PRD ${n.level}: ${n.title} (${n.status})`,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePrdClick(n); }
                },
                style: { opacity: isHighlighted ? 1 : 0.2 },
              },
                h("circle", {
                  r: r + 6,
                  fill: "transparent",
                  class: "mg-hit",
                }),
                h("circle", {
                  r,
                  fill,
                  "fill-opacity": 0.25,
                  stroke: fill,
                  "stroke-width": isSelected ? 2.5 : 1.5,
                  class: "mg-circle",
                }),
                h("text", {
                  x: r + 6,
                  y: 4,
                  class: "mg-label",
                  "font-size": n.level === "epic" ? 11 : 9,
                  "font-weight": n.level === "epic" ? 600 : 400,
                }, shortStatus(n.status) + " " + (n.title.length > 28 ? n.title.slice(0, 26) + "…" : n.title)),
              );
            }),
        ),

        // ── Merge nodes ──────────────────────────────────────────────────────
        h("g", { class: "mg-merge-nodes" },
          layout.nodes
            .filter((n): n is LayoutMergeNode => n.kind === "merge")
            .map((ln) => {
              const n = ln.node;
              const isHighlighted = hasHighlight ? highlightIds.has(n.id) : true;
              const isSelected = selected?.kind === "merge" && selected.node.id === n.id;
              const fill = ln.linked ? "var(--brand-purple)" : "var(--text-muted)";
              const sz = 8; // half-size of diamond
              return h("g", {
                key: n.id,
                class: `mg-node mg-merge-node${isSelected ? " selected" : ""}`,
                transform: `translate(${ln.x},${ln.y})`,
                onClick: (e: MouseEvent) => { e.stopPropagation(); handleMergeClick(n); },
                role: "button",
                tabIndex: 0,
                "aria-label": `Merge: ${n.subject}`,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleMergeClick(n); }
                },
                style: { opacity: isHighlighted ? 1 : 0.2 },
              },
                // Hit target
                h("rect", {
                  x: -sz - 6, y: -sz - 6,
                  width: (sz + 6) * 2, height: (sz + 6) * 2,
                  fill: "transparent",
                  class: "mg-hit",
                }),
                // Diamond shape
                h("polygon", {
                  points: `0,${-sz} ${sz},0 0,${sz} ${-sz},0`,
                  fill,
                  "fill-opacity": 0.25,
                  stroke: fill,
                  "stroke-width": isSelected ? 2.5 : 1.5,
                  class: "mg-diamond",
                }),
                h("text", {
                  x: sz + 6,
                  y: 4,
                  class: "mg-label mg-merge-label",
                  "font-size": 9,
                }, n.shortSha + " " + (n.subject.length > 24 ? n.subject.slice(0, 22) + "…" : n.subject)),
              );
            }),
        ),

        // ── Column labels ────────────────────────────────────────────────────
        visiblePrdIds.size > 0
          ? h("g", { class: "mg-col-labels", "pointer-events": "none" },
              Object.entries(LEVEL_DEPTH).map(([level, depth]) => {
                const x = depth * COL_W + COL_W / 2;
                const y = viewBox.y + 16;
                return h("text", {
                  key: level,
                  x, y,
                  class: "mg-col-label",
                  "font-size": 10,
                  "text-anchor": "middle",
                }, level.toUpperCase());
              }),
              mergesColX(layout) !== null
                ? h("text", {
                    x: mergesColX(layout)!,
                    y: viewBox.y + 16,
                    class: "mg-col-label",
                    "font-size": 10,
                    "text-anchor": "middle",
                  }, "MERGES")
                : null,
            )
          : null,
      ),

      // ── Detail panel ───────────────────────────────────────────────────────
      selected
        ? h(DetailPanel, { selection: selected, onClose: clearSelection })
        : null,
    ),
  );
}

/** Helper: get the x of the merges column from the layout (for column label) */
function mergesColX(layout: Layout): number | null {
  const first = layout.nodes.find((n) => n.kind === "merge");
  return first ? first.x : null;
}

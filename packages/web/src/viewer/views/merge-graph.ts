/**
 * MergeGraphView — PRD/merge context graph.
 *
 * Renders PRD items and git merge commits as a connected graph so users can
 * see which code changes were shipped against which planned work. PRD items
 * use a compact, indented folder-tree layout — each visible node sits on its
 * own row, horizontally indented by depth — visually echoing the on-disk
 * `.rex/prd_tree/` hierarchy. Merge commits cluster in a column to the right
 * of the deepest visible PRD indent.
 *
 * View mode: defaults to "Full tree" (every PRD item from every depth is
 * rendered) so the graph is representative of the whole `.rex/prd_tree/`
 * folder. An "Epics only" mode in the header trims the tree to just the
 * top-level rows for a high-level overview.
 *
 * Interactions:
 * - Pan: mouse drag or two-finger drag on the canvas
 * - Zoom: Ctrl+scroll or pinch
 * - Click a PRD node: select it (highlight subtree, recenter the canvas on
 *   the node, open detail panel with front-matter + introducing-commit info)
 * - Click a merge node: show file-change list in the detail panel
 * - Toolbar: zoom in/out/fit, view-mode toggle, filter by status and date range
 *
 * @module web/viewer/views/merge-graph
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useMemo, useCallback, useRef } from "preact/hooks";
import { usePanZoom } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import type { PRDItemData } from "../components/prd-tree/types.js";
import { findItemById } from "../components/prd-tree/tree-utils.js";

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
  shape?: string;
  /**
   * Folder-tree slug chain for this item (`<epic>/<feature>/<task>`).
   *
   * Mirrors the on-disk path under `.rex/prd_tree/`. The graph hierarchy and
   * sibling order are driven by this path, so the context graph echoes the
   * dashboard's folder-tree view by construction. Click-through still uses
   * `id` — `treePath` is purely a positional/identity hint.
   */
  treePath?: string;
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

/**
 * Introducing-commit metadata for a PRD item. Mirrors the server-side
 * `PrdOrigin` type from `merge-history.ts`. Resolved lazily on click via
 * `/api/prd-origin?path=<treePath>`.
 */
interface PrdOrigin {
  sha: string;
  shortSha: string;
  createdAt: string;
  author: string;
  authorEmail: string;
  coAuthors: Array<{ name: string; email: string }>;
  subject: string;
}

/**
 * Per-item origin lookup state. `"none"` means git knows the file but has no
 * commit history (shouldn't normally happen — kept for completeness). `null`
 * inside the success branch means git returned no introducing commit (item
 * isn't tracked yet).
 */
type OriginEntry =
  | { kind: "loading" }
  | { kind: "ready"; origin: PrdOrigin | null }
  | { kind: "error"; message: string };

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
//
// Compact folder-tree layout:
//   y = sequential row index × ROW_H (DFS pre-order; each visible node owns a
//       single row so the rhythm matches the dashboard's PRD tree view)
//   x = depth × INDENT_W (each level indents by a fixed amount, just like a
//       file tree)
//
// Merge nodes cluster in a column to the right of the deepest visible PRD x.

const ROW_H = 22;        // vertical rhythm: tight, one row per visible PRD node
const INDENT_W = 22;     // horizontal indent per depth level (folder-tree style)
const MERGE_ROW_H = 22;  // matches PRD row height so adjacent rails align
const MERGE_X_GAP = 80;  // gap between rightmost PRD x and merge column

// ── Status and level config ──────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  pending:     "var(--text-muted)",
  in_progress: "var(--accent)",
  completed:   "var(--green)",
  failing:     "var(--brand-rose)",
  blocked:     "var(--brand-orange)",
  deferred:    "var(--brand-purple)",
};

// Node fill is encoded by the folder-tree shape, not status. Each shape gets a
// distinct hue so the on-disk layout class (leaf vs leaf-children vs
// folder-children) reads at a glance. Status is conveyed by the glyph prefix
// in the label (see `shortStatus`) and by the front-matter summary panel.
const SHAPE_COLOR: Record<string, string> = {
  circle:    "var(--text-muted)",
  diamond:   "var(--accent)",
  square:    "var(--green)",
  trapezoid: "var(--brand-orange)",
  triangle:  "var(--brand-rose)",
};

const LEVEL_DEPTH: Record<string, number> = {
  epic: 0, feature: 1, task: 2, subtask: 3,
};

// Reduced node radii so the compact layout doesn't crowd. Values are tuned so
// each node fits comfortably inside the ROW_H rhythm with room for stroke.
const LEVEL_RADIUS: Record<string, number> = {
  epic: 7, feature: 6, task: 5, subtask: 4,
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
  /** Depth in tree levels of the deepest visible PRD node (0 if none). */
  maxDepth: number;
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

  // ── Build parent→children map (preserve graph order within each parent) ──
  const childrenMap = new Map<string | null, PrdNode[]>();
  childrenMap.set(null, []);

  for (const n of prdNodes) {
    const parentKey = n.parentId && visiblePrdIds.has(n.parentId) ? n.parentId : null;
    const arr = childrenMap.get(parentKey) ?? [];
    arr.push(n);
    childrenMap.set(parentKey, arr);
  }

  // ── DFS pre-order traversal: each visible node claims one row ────────────
  // Compact folder-tree layout — y advances monotonically as we walk the tree
  // depth-first, so parents always sit above their children and siblings
  // stack vertically. x is the indent depth for the node's level (epic=0,
  // feature=1, …). This mirrors the on-disk `.rex/prd_tree/` rendering used
  // elsewhere in the dashboard.
  const positions = new Map<string, { x: number; y: number; depth: number }>();
  let yCounter = 0;
  let maxDepth = 0;

  function traverse(nodeId: string): void {
    const node = prdNodes.find((p) => p.id === nodeId);
    if (!node) return;
    const depth = LEVEL_DEPTH[node.level] ?? 3;
    if (depth > maxDepth) maxDepth = depth;
    positions.set(nodeId, {
      x: depth * INDENT_W,
      y: yCounter * ROW_H,
      depth,
    });
    yCounter++;
    for (const kid of childrenMap.get(nodeId) ?? []) traverse(kid.id);
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

  // ── Build tree edges (parent rail → child elbow) ─────────────────────────
  // Folder-tree connector: a vertical rail drops from the parent's column
  // (`parentX`) down to the child's row, then a short horizontal elbow
  // reaches across the child's indent into the child's node. The path is
  // emitted as straight `M..L..L..` segments by the renderer so the rails
  // stay crisp at small sizes.
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
  // Merges sit in a column to the right of the rightmost PRD x. Each merge's
  // y is anchored to the average y of its linked PRD targets (which sink to
  // the deepest visible level), with collision avoidance to keep them from
  // stacking on top of one another.
  const maxPrdX = prdNodes.length > 0
    ? Math.max(...prdNodes.map((n) => positions.get(n.id)?.x ?? 0))
    : 0;
  const mergeX = maxPrdX + MERGE_X_GAP;

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
    let y = mergeIdealY.get(mn.id) ?? lastY + MERGE_ROW_H;
    if (y < lastY + MERGE_ROW_H) y = lastY + MERGE_ROW_H;
    lastY = y;
    mergePositions.set(mn.id, { x: mergeX, y });
  }

  // Unlinked merges cluster below linked ones
  let unlinkedY = lastY === -Infinity ? 0 : lastY + MERGE_ROW_H * 2;
  for (const mn of unlinkedMerges) {
    mergePositions.set(mn.id, { x: mergeX, y: unlinkedY });
    unlinkedY += MERGE_ROW_H;
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
      maxDepth,
    };
  }
  const xs = layoutNodes.map((n) => n.x);
  const ys = layoutNodes.map((n) => n.y);
  // Generous right padding leaves room for the inline labels that sit to the
  // right of each shape. Top/bottom padding scales with the tighter rhythm.
  const padLeft = INDENT_W * 1.2;
  const padRight = INDENT_W * 12;
  const padY = ROW_H * 1.2;
  const minX = Math.min(...xs) - padLeft;
  const minY = Math.min(...ys) - padY;
  const maxX = Math.max(...xs) + padRight;
  const maxY = Math.max(...ys) + padY;
  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    fitVB: { x: minX, y: minY, w: Math.max(maxX - minX, 400), h: Math.max(maxY - minY, 200) },
    maxDepth,
  };
}

// ── Shape rendering helpers ───────────────────────────────────────────────────

/**
 * Render a shape element for a PRD node based on its shape field.
 * All shapes use a hit target and a visible shape element.
 */
function renderNodeShape(shape: string | undefined, r: number, fill: string, isSelected: boolean) {
  const hitR = r + 6;
  const strokeWidth = isSelected ? 2.5 : 1.5;
  const baseAttrs = {
    fill,
    "fill-opacity": 0.25,
    stroke: fill,
    "stroke-width": strokeWidth,
  };

  switch (shape) {
    case "diamond":
      // Diamond: 45-degree rotated square
      return [
        h("rect", {
          x: -hitR, y: -hitR,
          width: hitR * 2, height: hitR * 2,
          fill: "transparent",
          class: "mg-hit",
        }),
        h("polygon", {
          points: `0,${-r} ${r},0 0,${r} ${-r},0`,
          ...baseAttrs,
          class: "mg-shape mg-diamond",
        }),
      ];
    case "square":
      // Square: aligned with axes
      return [
        h("rect", {
          x: -hitR, y: -hitR,
          width: hitR * 2, height: hitR * 2,
          fill: "transparent",
          class: "mg-hit",
        }),
        h("rect", {
          x: -r, y: -r,
          width: r * 2, height: r * 2,
          ...baseAttrs,
          class: "mg-shape mg-square",
        }),
      ];
    case "trapezoid":
      // Trapezoid: wider at bottom
      return [
        h("rect", {
          x: -hitR, y: -hitR,
          width: hitR * 2, height: hitR * 2,
          fill: "transparent",
          class: "mg-hit",
        }),
        h("polygon", {
          points: `${-r * 0.7},${-r} ${r * 0.7},${-r} ${r},${r} ${-r},${r}`,
          ...baseAttrs,
          class: "mg-shape mg-trapezoid",
        }),
      ];
    case "triangle":
      // Triangle: pointing up
      return [
        h("circle", {
          cx: 0, cy: 0, r: hitR,
          fill: "transparent",
          class: "mg-hit",
        }),
        h("polygon", {
          points: `0,${-r} ${r * 0.866},${r * 0.5} ${-r * 0.866},${r * 0.5}`,
          ...baseAttrs,
          class: "mg-shape mg-triangle",
        }),
      ];
    case "circle":
    default:
      // Circle: default
      return [
        h("circle", {
          r: hitR,
          fill: "transparent",
          class: "mg-hit",
        }),
        h("circle", {
          r,
          ...baseAttrs,
          class: "mg-shape mg-circle",
        }),
      ];
  }
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

// ── Subtree helpers ──────────────────────────────────────────────────────────

/**
 * Collect a PRD node's id plus the ids of every transitive descendant.
 *
 * Walks the parent->child relationship encoded in `graph.nodes` (each PRD
 * node carries its `parentId`), returning a set that includes the root.
 * Used to highlight an entire subtree on click.
 */
export function collectPrdSubtreeIds(graph: MergeGraph, rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (n.kind !== "prd" || !n.parentId) continue;
    const arr = childrenByParent.get(n.parentId) ?? [];
    arr.push(n.id);
    childrenByParent.set(n.parentId, arr);
  }

  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const child of childrenByParent.get(cur) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return result;
}

// ── Detail panel ─────────────────────────────────────────────────────────────

type SelectedNode =
  | { kind: "prd"; node: PrdNode; linkedMergeIds: string[] }
  | { kind: "merge"; node: MergeNode };

const EMPTY_FIELD = "—"; // em dash

/**
 * Concise PRD front-matter summary card.
 *
 * Surfaces only the front-matter fields already present on a PRD item
 * (title, status, priority, tags, level, branch). Missing/empty fields
 * render as an em dash instead of being silently omitted, so users can
 * tell "no value" apart from "field unsupported". Keeps to existing
 * dashboard styling — no new schema is introduced.
 *
 * The origin section beneath the front-matter dl reports the introducing
 * git commit for the PRD item — surfaces the SHA (with copy affordance),
 * timestamp, author, and any `Co-Authored-By:` trailers. Loaded lazily by
 * the parent view on click; this component renders the loading / ready /
 * error / "no commit history" states uniformly.
 */
function PrdFrontMatterSummary({ item, fallback, level, origin, onClose }: {
  item: PRDItemData | null;
  fallback: { title: string; status: string; priority?: string };
  level: string;
  origin: OriginEntry | undefined;
  onClose: () => void;
}) {
  const title = (item?.title ?? fallback.title).trim() || EMPTY_FIELD;
  const status = item?.status ?? fallback.status;
  const priority = item?.priority ?? fallback.priority;
  const tags = item?.tags ?? [];

  return h("div", { class: "mg-detail mg-detail-prd" },
    h("div", { class: "mg-detail-header" },
      h("span", { class: "mg-detail-title" }, level.toUpperCase()),
      h("button", {
        class: "mg-detail-close",
        onClick: onClose,
        "aria-label": "Close",
      }, "×"),
    ),
    h("p", { class: "mg-detail-subject" }, title),
    h("dl", { class: "mg-frontmatter" },
      h("dt", null, "Status"),
      h("dd", null,
        h("span", {
          class: "mg-frontmatter-status",
          style: { color: STATUS_COLOR[status] ?? "inherit" },
        }, status ? status.replace(/_/g, " ") : EMPTY_FIELD),
      ),
      h("dt", null, "Priority"),
      h("dd", null, priority ? priority : EMPTY_FIELD),
      h("dt", null, "Tags"),
      h("dd", null,
        tags.length === 0
          ? h("span", { class: "mg-frontmatter-empty" }, EMPTY_FIELD)
          : h("span", { class: "mg-frontmatter-tags" },
              tags.map((t) =>
                h("span", { key: t, class: "mg-frontmatter-tag" }, t),
              ),
            ),
      ),
    ),
    h(PrdOriginSection, { origin }),
  );
}

/**
 * Origin (introducing-commit) section of the PRD detail panel.
 *
 * Renders four exclusive states keyed off the lazy lookup result:
 *   - undefined / loading : single "Loading…" line
 *   - ready, origin null  : "No commit history" (item not yet tracked in git)
 *   - ready, origin set   : SHA (with copy button), timestamp, author + co-authors, subject
 *   - error               : inline error message; never blocks the rest of the card
 */
function PrdOriginSection({ origin }: { origin: OriginEntry | undefined }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  if (!origin || origin.kind === "loading") {
    return h("div", { class: "mg-origin mg-origin-loading" },
      h("span", { class: "mg-origin-label" }, "Origin"),
      h("span", { class: "mg-origin-status" }, "Loading…"),
    );
  }
  if (origin.kind === "error") {
    return h("div", { class: "mg-origin mg-origin-error" },
      h("span", { class: "mg-origin-label" }, "Origin"),
      h("span", { class: "mg-origin-status" }, "Lookup failed"),
      h("span", { class: "mg-origin-error-detail", title: origin.message }, origin.message),
    );
  }
  if (origin.origin === null) {
    return h("div", { class: "mg-origin mg-origin-none" },
      h("span", { class: "mg-origin-label" }, "Origin"),
      h("span", { class: "mg-origin-status" }, "No commit history"),
    );
  }

  const o = origin.origin;
  const handleCopy = async () => {
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clip || typeof clip.writeText !== "function") {
      console.warn("Clipboard API unavailable; cannot copy commit hash.");
      return;
    }
    try {
      await clip.writeText(o.sha);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("Failed to copy commit hash:", err);
    }
  };

  const coNames = o.coAuthors.map((c) => c.name).filter(Boolean).join(", ");
  return h("div", { class: "mg-origin" },
    h("span", { class: "mg-origin-label" }, "Origin"),
    h("div", { class: "mg-origin-row" },
      h("code", {
        class: "mg-origin-sha",
        title: o.sha,
      }, o.shortSha),
      h("button", {
        type: "button",
        class: `mg-origin-copy${copied ? " copied" : ""}`,
        title: copied ? "Copied!" : "Copy full commit hash",
        "aria-label": "Copy full commit hash",
        "data-full-sha": o.sha,
        onClick: handleCopy,
      }, copied ? "✓" : "⧉"),
      h("time", {
        class: "mg-origin-time",
        dateTime: o.createdAt,
        title: o.createdAt,
      }, formatMergeTimestamp(o.createdAt)),
    ),
    h("div", { class: "mg-origin-authors" },
      h("span", { class: "mg-origin-author", title: o.authorEmail || EMPTY_FIELD },
        o.author || EMPTY_FIELD),
      coNames
        ? h("span", { class: "mg-origin-coauthors", title: "Co-authors" },
            ` · co-authored: ${coNames}`)
        : null,
    ),
    o.subject
      ? h("p", { class: "mg-origin-subject" }, o.subject)
      : null,
  );
}

/**
 * Custom detail panel for merge graph.
 * For PRD nodes, renders a concise front-matter summary card.
 * For merge nodes, renders a custom file-change summary.
 */
function DetailPanelContent({ selection, prdData, origin, onClose }: {
  selection: SelectedNode;
  prdData?: PRDItemData[] | null;
  origin: OriginEntry | undefined;
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

  // PRD node: concise front-matter summary, sourced from PRD item when available.
  const pn = selection.node;
  const item = prdData ? findItemById(prdData, pn.id) : null;
  return h(PrdFrontMatterSummary, {
    item,
    fallback: { title: pn.title, status: pn.status, priority: pn.priority },
    level: pn.level,
    origin,
    onClose,
  });
}

// ── Merge metadata panel ──────────────────────────────────────────────────────

/**
 * Format an ISO timestamp for display in the metadata panel.
 *
 * Falls back to the raw string if the date is unparseable so the panel still
 * surfaces something useful for diagnostics rather than rendering "Invalid Date".
 */
function formatMergeTimestamp(iso: string): string {
  if (!iso) return EMPTY_FIELD;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * Resolve the merge nodes whose metadata should appear in the metadata panel
 * for the current selection. PRD selections fan out to every linked merge
 * (most-recent-first); merge selections show a single row.
 *
 * Pulls exclusively from `graph.nodes` — the same merge-history pipeline that
 * powers the graph itself. No additional fetches are introduced.
 */
export function resolveMergeMetaForSelection(
  graph: MergeGraph | null,
  selection: SelectedNode | null,
): MergeNode[] {
  if (!graph || !selection) return [];
  if (selection.kind === "merge") return [selection.node];
  if (selection.linkedMergeIds.length === 0) return [];
  const wanted = new Set(selection.linkedMergeIds);
  return graph.nodes
    .filter((n): n is MergeNode => n.kind === "merge" && wanted.has(n.id))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
}

/**
 * One row of merge metadata: timestamp, short SHA with copy affordance, author.
 *
 * The copy button writes the *full* SHA to the clipboard while the rendered
 * label stays in short form. Failure (no clipboard API, permission denied) is
 * logged and ignored — the panel itself stays usable.
 */
function MergeMetaRow({ merge }: { merge: MergeNode }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clip || typeof clip.writeText !== "function") {
      console.warn("Clipboard API unavailable; cannot copy commit hash.");
      return;
    }
    try {
      await clip.writeText(merge.sha);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("Failed to copy commit hash:", err);
    }
  }, [merge.sha]);

  return h("div", { class: "mg-meta-row" },
    h("time", {
      class: "mg-meta-time",
      dateTime: merge.mergedAt,
      title: merge.mergedAt,
    }, formatMergeTimestamp(merge.mergedAt)),
    h("span", { class: "mg-meta-sha" },
      h("code", { class: "mg-meta-sha-text", title: merge.sha }, merge.shortSha),
      h("button", {
        type: "button",
        class: `mg-meta-copy${copied ? " copied" : ""}`,
        title: copied ? "Copied!" : "Copy full commit hash",
        "aria-label": "Copy full commit hash",
        "data-full-sha": merge.sha,
        onClick: handleCopy,
      }, copied ? "✓" : "⧉"),
    ),
    h("span", { class: "mg-meta-author", title: merge.author || EMPTY_FIELD },
      merge.author || EMPTY_FIELD),
  );
}

/**
 * Panel above the graph surfacing git merge metadata for the current selection.
 *
 * States:
 *   • no selection           → instructional empty state
 *   • PRD with no merges     → "No merge recorded" state
 *   • PRD with linked merges → one row per merge (most recent first)
 *   • merge node selected    → single row for that merge
 */
function MergeMetaPanel({ graph, selection }: {
  graph: MergeGraph | null;
  selection: SelectedNode | null;
}) {
  const merges = resolveMergeMetaForSelection(graph, selection);

  if (!selection) {
    return h("div", {
      class: "mg-meta-panel mg-meta-empty",
      role: "status",
      "aria-live": "polite",
    },
      h("span", { class: "mg-meta-label" }, "Merge metadata"),
      h("span", { class: "mg-meta-instruction" },
        "Select a node to view its merge timestamp, commit hash, and author.",
      ),
    );
  }

  if (merges.length === 0) {
    const ctx = selection.kind === "prd"
      ? `${selection.node.level}: ${selection.node.title}`
      : "";
    return h("div", {
      class: "mg-meta-panel mg-meta-no-merge",
      role: "status",
      "aria-live": "polite",
    },
      h("span", { class: "mg-meta-label" }, "Merge metadata"),
      h("span", { class: "mg-meta-status" }, "No merge recorded"),
      ctx ? h("span", { class: "mg-meta-context", title: ctx }, ctx) : null,
    );
  }

  return h("div", {
    class: "mg-meta-panel",
    role: "region",
    "aria-label": "Git merge metadata for selected node",
  },
    h("span", { class: "mg-meta-label" },
      merges.length > 1 ? `Merge metadata (${merges.length})` : "Merge metadata",
    ),
    h("div", { class: "mg-meta-rows" },
      merges.map((m) => h(MergeMetaRow, { key: m.id, merge: m })),
    ),
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
  const [prdData, setPrdData] = useState<PRDItemData[] | null>(null);
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  // "full-tree" renders every PRD item from .rex/prd_tree/ at every depth —
  // the default so the graph mirrors the on-disk layout. "epics-only" trims
  // to the top-level epic rows for a higher-level overview.
  const [viewMode, setViewMode] = useState<"full-tree" | "epics-only">("full-tree");
  // Per-item PRD origin lookup cache. Populated lazily on PRD click via
  // `/api/prd-origin`; keyed by PRD item id.
  const [originByItemId, setOriginByItemId] = useState<Map<string, OriginEntry>>(
    () => new Map(),
  );
  const abortRef = useRef<AbortController | null>(null);
  const originAbortRef = useRef<AbortController | null>(null);

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

  // ── Fetch PRD data (used for detail panel) ─────────────────────────────────
  useEffect(() => {
    const abortCtrl = new AbortController();

    fetch("/data/prd.json", { signal: abortCtrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<{ items: PRDItemData[] }>;
      })
      .then((data) => {
        setPrdData(data.items);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          console.warn("Failed to fetch PRD data for detail panel:", err.message);
        }
      });

    return () => abortCtrl.abort();
  }, []);

  // ── Compute visible sets based on filters ──────────────────────────────────
  const epics = useMemo(() => {
    if (!graph) return [] as PrdNode[];
    return graph.nodes.filter((n): n is PrdNode => n.kind === "prd" && n.level === "epic");
  }, [graph]);

  // Filter pass: which PRD/merge ids survive epic+status+date filters and the
  // view-mode toggle. Full-tree mode renders every depth; epics-only restricts
  // to top-level rows. There is no further expansion gate downstream — the
  // result of this memo is what the layout sees.
  const { visiblePrdIds, visibleMergeIds } = useMemo(() => {
    if (!graph) return { visiblePrdIds: new Set<string>(), visibleMergeIds: new Set<string>() };

    const prdNodes = graph.nodes.filter((n): n is PrdNode => n.kind === "prd");
    const mergeNodes = graph.nodes.filter((n): n is MergeNode => n.kind === "merge");

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
      if (viewMode === "epics-only" && n.level !== "epic") continue;
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
  }, [graph, epics, filters, viewMode]);

  // ── Compute layout ─────────────────────────────────────────────────────────
  const layout = useMemo(() => {
    if (!graph) return null;
    return computeLayout(graph, visiblePrdIds, visibleMergeIds);
  }, [graph, visiblePrdIds, visibleMergeIds]);

  const clearSelection = useCallback(() => {
    setSelected(null);
    setHighlightIds(new Set());
  }, []);

  // ── Escape key to close detail panel ────────────────────────────────────────
  useEffect(() => {
    if (!selected) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selected, clearSelection]);

  // ── usePanZoom ─────────────────────────────────────────────────────────────
  const fitVB = layout?.fitVB ?? { x: -50, y: -50, w: 900, h: 600 };
  const {
    viewBox, panning, svgRef,
    handleWheel, startPan, movePan, endPan,
    handleZoomIn, handleZoomOut, handleFit, recenter,
  } = usePanZoom(fitVB);

  // ── Position lookup for recenter on click ──────────────────────────────────
  // The layout already places every visible node at a known (x,y); pulling
  // those into a map gives O(1) lookup from the click handler so we can pan
  // the viewport to follow the user's selection.
  const positionByNodeId = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    if (!layout) return map;
    for (const ln of layout.nodes) {
      map.set(ln.id, { x: ln.x, y: ln.y });
    }
    return map;
  }, [layout]);

  // ── Origin lookup ──────────────────────────────────────────────────────────
  // Per-item lazy fetch of `/api/prd-origin?path=<treePath>`. The request is
  // skipped when we already hold a non-loading entry for that id; the result
  // (a `PrdOrigin` or null for "not yet committed") is written into
  // `originByItemId` and surfaced through `DetailPanelContent`.
  const ensureOrigin = useCallback((node: PrdNode) => {
    if (!node.treePath) {
      setOriginByItemId((prev) => {
        if (prev.get(node.id)?.kind === "ready") return prev;
        const next = new Map(prev);
        next.set(node.id, { kind: "ready", origin: null });
        return next;
      });
      return;
    }

    const existing = originByItemId.get(node.id);
    if (existing && existing.kind !== "error") return;

    originAbortRef.current?.abort();
    const ctrl = new AbortController();
    originAbortRef.current = ctrl;

    setOriginByItemId((prev) => {
      const next = new Map(prev);
      next.set(node.id, { kind: "loading" });
      return next;
    });

    fetch(`/api/prd-origin?path=${encodeURIComponent(node.treePath)}`, { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json() as Promise<{ origin: PrdOrigin | null }>;
      })
      .then((data) => {
        setOriginByItemId((prev) => {
          const next = new Map(prev);
          next.set(node.id, { kind: "ready", origin: data.origin });
          return next;
        });
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setOriginByItemId((prev) => {
          const next = new Map(prev);
          next.set(node.id, { kind: "error", message: err.message });
          return next;
        });
      });
  }, [originByItemId]);

  // ── Node click handlers ────────────────────────────────────────────────────
  const handlePrdClick = useCallback((node: PrdNode) => {
    if (!graph) return;
    // Highlight the selected node's full subtree (direct + transitive
    // descendants) plus every merge linked to anything in that subtree.
    // Selecting a different node always builds a fresh highlight set,
    // so the previous selection is implicitly cleared.
    const subtreeIds = collectPrdSubtreeIds(graph, node.id);
    const subtreeMergeIds = graph.edges
      .filter((e) => subtreeIds.has(e.to) && visibleMergeIds.has(e.from))
      .map((e) => e.from);
    const linkedMergeIds = graph.edges
      .filter((e) => e.to === node.id && visibleMergeIds.has(e.from))
      .map((e) => e.from);
    setSelected({ kind: "prd", node, linkedMergeIds });
    setHighlightIds(new Set([...subtreeIds, ...subtreeMergeIds]));

    // Recenter the canvas on the clicked node so the user's focus follows
    // the selection — the merge-metadata and detail panels grow above /
    // below the SVG, which would otherwise push the clicked node out of
    // view.
    const pos = positionByNodeId.get(node.id);
    if (pos) recenter(pos);

    // Kick off (or reuse) the lazy origin lookup for this item. The detail
    // panel reads `originByItemId.get(node.id)` to render loading / ready /
    // error / "no commit history" states.
    ensureOrigin(node);
  }, [graph, visibleMergeIds, positionByNodeId, recenter, ensureOrigin]);

  const handleMergeClick = useCallback((node: MergeNode) => {
    if (!graph) return;
    const linkedEdges = graph.edges.filter((e) => e.from === node.id && visiblePrdIds.has(e.to));
    const linkedPrdIds = linkedEdges.map((e) => e.to);
    setSelected({ kind: "merge", node });
    setHighlightIds(new Set([node.id, ...linkedPrdIds]));
    const pos = positionByNodeId.get(node.id);
    if (pos) recenter(pos);
  }, [graph, visiblePrdIds, positionByNodeId, recenter]);

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
        // View-mode toggle: full PRD tree (default) vs epic-only summary.
        // Two segmented buttons styled with the existing filter chip pattern
        // so the visual language stays consistent with the filter bar below.
        h("div", {
          class: "mg-view-toggle",
          role: "group",
          "aria-label": "View mode",
        },
          h("button", {
            class: `mg-chip${viewMode === "full-tree" ? " active" : ""}`,
            "aria-pressed": viewMode === "full-tree" ? "true" : "false",
            title: "Show every PRD item (epic → feature → task → subtask)",
            onClick: () => setViewMode("full-tree"),
          }, "Full tree"),
          h("button", {
            class: `mg-chip${viewMode === "epics-only" ? " active" : ""}`,
            "aria-pressed": viewMode === "epics-only" ? "true" : "false",
            title: "Show only top-level epics",
            onClick: () => setViewMode("epics-only"),
          }, "Epics only"),
        ),
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

    // ── Merge metadata panel (above the graph) ───────────────────────────────
    h(MergeMetaPanel, { graph, selection: selected }),

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
        h("span", { class: "mg-legend-title" }, "Node Shapes:"),
        h("span", { class: "mg-legend-item", title: "Circle: parent node with no specific structure pattern" },
          h("svg", { width: 12, height: 12, viewBox: "0 0 12 12" },
            h("circle", { cx: 6, cy: 6, r: 4, fill: "var(--text-muted)", "fill-opacity": "0.25", stroke: "var(--text-muted)", "stroke-width": 1 }),
          ),
          " Circle (default)",
        ),
        h("span", { class: "mg-legend-item", title: "Diamond: parent with index.md + leaf subtask files" },
          h("svg", { width: 12, height: 12, viewBox: "0 0 12 12" },
            h("polygon", { points: "6,2 10,6 6,10 2,6", fill: "var(--accent)", "fill-opacity": "0.25", stroke: "var(--accent)", "stroke-width": 1 }),
          ),
          " Diamond (leaf children)",
        ),
        h("span", { class: "mg-legend-item", title: "Square: parent with only .md files, no subdirectories" },
          h("svg", { width: 12, height: 12, viewBox: "0 0 12 12" },
            h("rect", { x: 2, y: 2, width: 8, height: 8, fill: "var(--green)", "fill-opacity": "0.25", stroke: "var(--green)", "stroke-width": 1 }),
          ),
          " Square (files only)",
        ),
        h("span", { class: "mg-legend-item", title: "Trapezoid: parent with only subdirectories, no other files" },
          h("svg", { width: 12, height: 12, viewBox: "0 0 12 12" },
            h("polygon", { points: "2.5,2 9.5,2 10,10 2,10", fill: "var(--brand-orange)", "fill-opacity": "0.25", stroke: "var(--brand-orange)", "stroke-width": 1 }),
          ),
          " Trapezoid (folders only)",
        ),
        h("span", { class: "mg-legend-item", title: "Triangle: leaf node with no children" },
          h("svg", { width: 12, height: 12, viewBox: "0 0 12 12" },
            h("polygon", { points: "6,2 10,9 2,9", fill: "var(--brand-rose)", "fill-opacity": "0.25", stroke: "var(--brand-rose)", "stroke-width": 1 }),
          ),
          " Triangle (leaf)",
        ),
        h("span", { class: "mg-legend-item" },
          h("svg", { width: 12, height: 12, viewBox: "0 0 12 12" },
            h("polygon", { points: "6,2 10,6 6,10 2,6", fill: "var(--brand-purple)", "fill-opacity": "0.25", stroke: "var(--brand-purple)", "stroke-width": 1 }),
          ),
          " Merge commit",
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
              // Folder-tree connector: vertical rail aligned with the parent's
              // x, dropping past the child's row, then a horizontal elbow
              // reaching into the child. Mirrors the indent rail used by the
              // dashboard's PRD tree view.
              return h("path", {
                key: edge.id,
                class: `mg-edge-tree${isHighlighted ? " highlighted" : ""}`,
                d: `M${edge.x1},${edge.y1} L${edge.x1},${edge.y2} L${edge.x2},${edge.y2}`,
                fill: "none",
              });
            }

            // Merge link: horizontal-leaning bezier from the merge column to
            // its linked PRD node.
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
              const fill = SHAPE_COLOR[n.shape ?? "circle"] ?? "var(--text-muted)";
              const isHighlighted = hasHighlight ? highlightIds.has(n.id) : true;
              const isSelected = selected?.kind === "prd" && selected.node.id === n.id;
              return h("g", {
                key: n.id,
                class: `mg-node mg-prd-node${isSelected ? " selected" : ""}`,
                transform: `translate(${ln.x},${ln.y})`,
                "data-prd-id": n.id,
                onClick: (e: MouseEvent) => { e.stopPropagation(); handlePrdClick(n); },
                role: "button",
                tabIndex: 0,
                "aria-label": `PRD ${n.level}: ${n.title} (${n.status}) - ${n.shape || "circle"}`,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePrdClick(n); }
                },
                style: { opacity: isHighlighted ? 1 : 0.2 },
              },
                ...renderNodeShape(n.shape, r, fill, isSelected),
                // Label sits to the right of the shape on the same row — the
                // compact folder-tree rhythm renders one indented line per
                // node. Status is encoded by the glyph prefix
                // (`shortStatus(n.status)`); shape encodes structural class.
                h("text", {
                  x: r + 6,
                  y: 0,
                  class: "mg-label mg-prd-label",
                  "text-anchor": "start",
                  "dominant-baseline": "middle",
                  "font-size": n.level === "epic" ? 11 : 10,
                  "font-weight": n.level === "epic" ? 600 : 400,
                }, shortStatus(n.status) + " " + (n.title.length > 48 ? n.title.slice(0, 46) + "…" : n.title)),
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
              const sz = 6; // half-size of diamond — sized to match PRD radii
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
                  y: 0,
                  class: "mg-label mg-merge-label",
                  "text-anchor": "start",
                  "dominant-baseline": "middle",
                  "font-size": 9,
                }, n.shortSha + " " + (n.subject.length > 32 ? n.subject.slice(0, 30) + "…" : n.subject)),
              );
            }),
        ),

        // ── Column header for the merges column ──────────────────────────────
        // In the compact folder-tree layout level identity is encoded by the
        // node's shape and indent depth, so per-row level labels are
        // redundant. We keep a single "MERGES" header above the merge column
        // to anchor the right-hand stack visually.
        visiblePrdIds.size > 0 && mergesColX(layout) !== null
          ? h("g", { class: "mg-col-labels", "pointer-events": "none" },
              h("text", {
                x: mergesColX(layout)!,
                y: viewBox.y + 14,
                class: "mg-col-label",
                "font-size": 10,
                "text-anchor": "middle",
              }, "MERGES"),
            )
          : null,
      ),

      // ── Detail panel ───────────────────────────────────────────────────────
      selected
        ? h(DetailPanelContent, {
            selection: selected,
            prdData,
            origin: selected.kind === "prd" ? originByItemId.get(selected.node.id) : undefined,
            onClose: clearSelection,
          })
        : null,
    ),
  );
}

/** Helper: get the x of the merges column from the layout (for column label) */
function mergesColX(layout: Layout): number | null {
  const first = layout.nodes.find((n) => n.kind === "merge");
  return first ? first.x : null;
}

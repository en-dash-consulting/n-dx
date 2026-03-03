/**
 * Validation & Dependency Graph view.
 *
 * Provides a "Validate" button to run rex validate from the web UI and
 * displays results inline. Renders blockedBy relationships as a visual
 * dependency graph showing blocking chains and circular dependencies.
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback, useRef, useMemo } from "preact/hooks";
import { BrandedHeader } from "../components/logos.js";
import type { NavigateTo } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

interface CheckError {
  message: string;
  itemId?: string;
  itemTitle?: string;
}

interface CheckResult {
  name: string;
  pass: boolean;
  severity?: "error" | "warn";
  errors: CheckError[];
}

interface ValidationReport {
  ok: boolean;
  checks: CheckResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

interface GraphNode {
  id: string;
  title: string;
  level: string;
  status: string;
  blockedBy: string[];
}

interface GraphEdge {
  source: string;
  target: string;
  resolved: boolean;
}

interface BlockingChain {
  itemId: string;
  path: string[];
}

interface DependencyGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  cycleNodeIds: string[];
  blockingChains: BlockingChain[];
  criticalBlockers: Array<{ id: string; title: string; blockingCount: number }>;
}

// ── Helpers ──────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  completed: "\u25CF",
  in_progress: "\u25D0",
  pending: "\u25CB",
  blocked: "\u2298",
  deferred: "\u25CC",
};

const LEVEL_LABELS: Record<string, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "\u2026" : s;
}

// ── Sub-components: Validation Results ──────────────────────────────

function ValidationSummary({ report }: { report: ValidationReport }) {
  return h("div", { class: "val-summary" },
    h("div", {
      class: `val-summary-badge ${report.ok ? "val-pass" : "val-fail"}`,
    },
      report.ok ? "\u2713 All Checks Passed" : "\u2717 Validation Failed",
    ),
    h("div", { class: "val-summary-stats" },
      h("span", { class: "val-stat" },
        h("span", { class: "val-stat-num val-stat-passed" }, String(report.summary.passed)),
        " passed",
      ),
      report.summary.failed > 0
        ? h("span", { class: "val-stat" },
            h("span", { class: "val-stat-num val-stat-failed" }, String(report.summary.failed)),
            " failed",
          )
        : null,
      report.summary.warnings > 0
        ? h("span", { class: "val-stat" },
            h("span", { class: "val-stat-num val-stat-warnings" }, String(report.summary.warnings)),
            " warnings",
          )
        : null,
    ),
  );
}

function CheckResultCard({
  check,
  onNavigate,
}: {
  check: CheckResult;
  onNavigate: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(!check.pass);
  const isWarn = !check.pass && check.severity === "warn";
  const icon = check.pass ? "\u2713" : isWarn ? "\u26A0" : "\u2717";
  const cls = check.pass ? "val-check-pass" : isWarn ? "val-check-warn" : "val-check-fail";

  return h("div", { class: `val-check ${cls}` },
    h("div", {
      class: "val-check-header",
      onClick: () => check.errors.length > 0 && setExpanded(!expanded),
      role: check.errors.length > 0 ? "button" : undefined,
      tabIndex: check.errors.length > 0 ? 0 : undefined,
    },
      h("span", { class: "val-check-icon" }, icon),
      h("span", { class: "val-check-name" }, check.name),
      check.errors.length > 0
        ? h("span", { class: "val-check-count" }, `${check.errors.length} issue${check.errors.length !== 1 ? "s" : ""}`)
        : null,
      check.errors.length > 0
        ? h("span", { class: "val-check-chevron" }, expanded ? "\u25BC" : "\u25B6")
        : null,
    ),
    expanded && check.errors.length > 0
      ? h("div", { class: "val-check-errors" },
          check.errors.map((err, i) =>
            h("div", {
              key: i,
              class: `val-error-item${err.itemId ? " val-error-clickable" : ""}`,
              onClick: err.itemId ? () => onNavigate(err.itemId!) : undefined,
              role: err.itemId ? "button" : undefined,
              tabIndex: err.itemId ? 0 : undefined,
            },
              h("span", { class: "val-error-msg" }, err.message),
              err.itemTitle
                ? h("span", { class: "val-error-item-title" }, err.itemTitle)
                : null,
              err.itemId
                ? h("span", { class: "val-error-item-id" }, err.itemId.slice(0, 8))
                : null,
            ),
          ),
        )
      : null,
  );
}

// ── Sub-components: Dependency Graph ────────────────────────────────

interface LayoutNode {
  id: string;
  title: string;
  level: string;
  status: string;
  x: number;
  y: number;
  inCycle: boolean;
  /** Number of dependencies (in-degree in the blocker graph). */
  blockedByCount: number;
  /** Number of items this blocks (out-degree). */
  blocksCount: number;
}

interface LayoutEdge {
  source: LayoutNode;
  target: LayoutNode;
  resolved: boolean;
}

/** Simple layered graph layout (Sugiyama-style). */
function layoutGraph(
  data: DependencyGraphData,
  width: number,
  height: number,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  if (data.nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const cycleSet = new Set(data.cycleNodeIds);

  // Build adjacency: node -> nodes it blocks (outgoing in blocker direction)
  const blocksMap = new Map<string, string[]>();
  const blockedByMap = new Map<string, string[]>();

  for (const edge of data.edges) {
    if (!blocksMap.has(edge.source)) blocksMap.set(edge.source, []);
    blocksMap.get(edge.source)!.push(edge.target);

    if (!blockedByMap.has(edge.target)) blockedByMap.set(edge.target, []);
    blockedByMap.get(edge.target)!.push(edge.source);
  }

  // Assign layers using topological ordering (nodes with no blockedBy = layer 0)
  const layers = new Map<string, number>();
  const queue: string[] = [];

  // Find root nodes (no dependencies / blockedBy)
  for (const node of data.nodes) {
    if (!node.blockedBy || node.blockedBy.length === 0) {
      layers.set(node.id, 0);
      queue.push(node.id);
    }
  }

  // For cycle nodes that weren't assigned, assign layer 0
  for (const nodeId of cycleSet) {
    if (!layers.has(nodeId)) {
      layers.set(nodeId, 0);
      queue.push(nodeId);
    }
  }

  // BFS to assign layers
  let idx = 0;
  while (idx < queue.length) {
    const current = queue[idx++];
    const currentLayer = layers.get(current) ?? 0;
    const targets = blocksMap.get(current) ?? [];

    for (const target of targets) {
      const existing = layers.get(target) ?? -1;
      const newLayer = currentLayer + 1;
      if (newLayer > existing) {
        layers.set(target, newLayer);
      }
      if (!queue.includes(target)) {
        queue.push(target);
      }
    }
  }

  // Any unassigned nodes get layer 0
  for (const node of data.nodes) {
    if (!layers.has(node.id)) {
      layers.set(node.id, 0);
    }
  }

  // Group nodes by layer
  const layerGroups = new Map<number, string[]>();
  for (const [nodeId, layer] of layers) {
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(nodeId);
  }

  const maxLayer = Math.max(...Array.from(layerGroups.keys()), 0);
  const nodeMap = new Map(data.nodes.map((n) => [n.id, n]));

  // Calculate positions
  const padding = 60;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const layerSpacing = maxLayer > 0 ? usableHeight / maxLayer : 0;

  const layoutNodes = new Map<string, LayoutNode>();

  for (const [layer, nodeIds] of layerGroups) {
    const colSpacing = nodeIds.length > 1 ? usableWidth / (nodeIds.length - 1) : 0;
    const startX = nodeIds.length > 1 ? padding : width / 2;

    nodeIds.forEach((nodeId, i) => {
      const src = nodeMap.get(nodeId);
      if (!src) return;

      layoutNodes.set(nodeId, {
        id: nodeId,
        title: src.title,
        level: src.level,
        status: src.status,
        x: startX + i * colSpacing,
        y: padding + layer * layerSpacing,
        inCycle: cycleSet.has(nodeId),
        blockedByCount: (blockedByMap.get(nodeId) ?? []).length,
        blocksCount: (blocksMap.get(nodeId) ?? []).length,
      });
    });
  }

  // Build layout edges
  const layoutEdges: LayoutEdge[] = [];
  for (const edge of data.edges) {
    const s = layoutNodes.get(edge.source);
    const t = layoutNodes.get(edge.target);
    if (s && t) {
      layoutEdges.push({ source: s, target: t, resolved: edge.resolved });
    }
  }

  return {
    nodes: Array.from(layoutNodes.values()),
    edges: layoutEdges,
  };
}

/** SVG arrow marker definition. */
function ArrowDefs() {
  return h("defs", null,
    h("marker", {
      id: "dep-arrow",
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      markerWidth: "6",
      markerHeight: "6",
      orient: "auto-start-reverse",
    },
      h("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--text-dim)" }),
    ),
    h("marker", {
      id: "dep-arrow-resolved",
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      markerWidth: "6",
      markerHeight: "6",
      orient: "auto-start-reverse",
    },
      h("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--brand-teal)" }),
    ),
    h("marker", {
      id: "dep-arrow-cycle",
      viewBox: "0 0 10 10",
      refX: "9",
      refY: "5",
      markerWidth: "6",
      markerHeight: "6",
      orient: "auto-start-reverse",
    },
      h("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "var(--brand-orange)" }),
    ),
  );
}

/** Render edge path with curve. */
function EdgePath({ edge, cycleSet }: { edge: LayoutEdge; cycleSet: Set<string> }) {
  const isCycleEdge = cycleSet.has(edge.source.id) && cycleSet.has(edge.target.id);
  const cls = isCycleEdge
    ? "dep-edge dep-edge-cycle"
    : edge.resolved
    ? "dep-edge dep-edge-resolved"
    : "dep-edge";

  const marker = isCycleEdge
    ? "url(#dep-arrow-cycle)"
    : edge.resolved
    ? "url(#dep-arrow-resolved)"
    : "url(#dep-arrow)";

  // Compute cubic bezier for a smooth curve
  const dx = edge.target.x - edge.source.x;
  const dy = edge.target.y - edge.source.y;
  const cx1 = edge.source.x + dx * 0.1;
  const cy1 = edge.source.y + dy * 0.5;
  const cx2 = edge.target.x - dx * 0.1;
  const cy2 = edge.target.y - dy * 0.5;

  return h("path", {
    class: cls,
    d: `M ${edge.source.x} ${edge.source.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${edge.target.x} ${edge.target.y}`,
    "marker-end": marker,
  });
}

/** Render a graph node. */
function NodeCircle({
  node,
  selected,
  onSelect,
}: {
  node: LayoutNode;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const radius = node.blocksCount > 2 ? 24 : node.blocksCount > 0 ? 20 : 16;

  return h("g", {
    class: `dep-node dep-node-${node.status}${node.inCycle ? " dep-node-cycle" : ""}${selected ? " dep-node-selected" : ""}`,
    transform: `translate(${node.x}, ${node.y})`,
    onClick: () => onSelect(node.id),
    role: "button",
    tabIndex: 0,
  },
    h("circle", {
      r: radius,
      class: "dep-node-circle",
    }),
    node.inCycle
      ? h("circle", {
          r: radius + 4,
          class: "dep-node-cycle-ring",
          fill: "none",
        })
      : null,
    h("text", {
      class: "dep-node-label",
      dy: radius + 14,
      textAnchor: "middle",
    }, truncate(node.title, 20)),
    h("text", {
      class: "dep-node-status-icon",
      textAnchor: "middle",
      dy: "4",
    }, STATUS_ICONS[node.status] || "\u25CB"),
  );
}

function DependencyGraphSVG({
  data,
  onNavigate,
}: {
  data: DependencyGraphData;
  onNavigate: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDimensions({
      width: Math.max(rect.width, 400),
      height: Math.max(data.nodes.length * 60, 300),
    });
  }, [data.nodes.length]);

  const layout = useMemo(
    () => layoutGraph(data, dimensions.width, dimensions.height),
    [data, dimensions.width, dimensions.height],
  );

  const cycleSet = useMemo(() => new Set(data.cycleNodeIds), [data.cycleNodeIds]);

  const handleNodeSelect = useCallback(
    (id: string) => {
      setSelectedNode(id === selectedNode ? null : id);
    },
    [selectedNode],
  );

  if (data.nodes.length === 0) {
    return h("div", { class: "dep-empty" },
      h("div", { class: "dep-empty-icon" }, "\u2713"),
      h("p", null, "No dependency relationships found."),
      h("p", { class: "dep-empty-hint" }, "Add blockedBy relationships to tasks to see the dependency graph."),
    );
  }

  const selectedNodeData = selectedNode
    ? data.nodes.find((n) => n.id === selectedNode)
    : null;

  return h("div", { class: "dep-graph-container", ref: containerRef },
    h("svg", {
      class: "dep-graph-svg",
      viewBox: `0 0 ${dimensions.width} ${dimensions.height}`,
      width: "100%",
      height: dimensions.height,
      "aria-label": "Dependency graph",
    },
      h(ArrowDefs, null),
      // Edges first (behind nodes)
      h("g", { class: "dep-edges" },
        layout.edges.map((edge, i) =>
          h(EdgePath, { key: i, edge, cycleSet }),
        ),
      ),
      // Nodes on top
      h("g", { class: "dep-nodes" },
        layout.nodes.map((node) =>
          h(NodeCircle, {
            key: node.id,
            node,
            selected: node.id === selectedNode,
            onSelect: handleNodeSelect,
          }),
        ),
      ),
    ),

    // Selected node detail
    selectedNodeData
      ? h("div", { class: "dep-node-detail" },
          h("div", { class: "dep-detail-header" },
            h("span", { class: `prd-level-badge prd-level-${selectedNodeData.level}` },
              LEVEL_LABELS[selectedNodeData.level] || selectedNodeData.level,
            ),
            h("span", { class: `prd-status-icon prd-status-${selectedNodeData.status}` },
              STATUS_ICONS[selectedNodeData.status] || "\u25CB",
            ),
            h("span", { class: "dep-detail-title" }, selectedNodeData.title),
          ),
          h("div", { class: "dep-detail-id" }, selectedNodeData.id.slice(0, 8)),
          selectedNodeData.blockedBy.length > 0
            ? h("div", { class: "dep-detail-deps" },
                h("span", { class: "dep-detail-label" }, "Blocked by: "),
                selectedNodeData.blockedBy.map((depId) => {
                  const dep = data.nodes.find((n) => n.id === depId);
                  return h("span", {
                    key: depId,
                    class: "dep-detail-dep-link",
                    onClick: () => onNavigate(depId),
                    role: "button",
                    tabIndex: 0,
                  }, dep ? truncate(dep.title, 30) : depId.slice(0, 8));
                }),
              )
            : null,
          h("button", {
            class: "dep-detail-nav-btn",
            onClick: () => onNavigate(selectedNodeData.id),
          }, "View in Tasks \u2192"),
        )
      : null,

    // Legend
    h("div", { class: "dep-legend" },
      h("div", { class: "dep-legend-item" },
        h("span", { class: "dep-legend-line dep-legend-resolved" }),
        "Resolved dependency",
      ),
      h("div", { class: "dep-legend-item" },
        h("span", { class: "dep-legend-line dep-legend-unresolved" }),
        "Unresolved dependency",
      ),
      data.cycleNodeIds.length > 0
        ? h("div", { class: "dep-legend-item" },
            h("span", { class: "dep-legend-line dep-legend-cycle" }),
            "Circular dependency",
          )
        : null,
    ),
  );
}

function CriticalBlockers({
  blockers,
  onNavigate,
}: {
  blockers: Array<{ id: string; title: string; blockingCount: number }>;
  onNavigate: (id: string) => void;
}) {
  if (blockers.length === 0) return null;

  return h("div", { class: "dep-blockers" },
    h("h3", { class: "dep-section-title" }, "Critical Blockers"),
    h("p", { class: "dep-section-desc" }, "Items blocking the most other items. Prioritize these for maximum unblocking."),
    h("div", { class: "dep-blocker-list" },
      blockers.map((b) =>
        h("div", {
          key: b.id,
          class: "dep-blocker-item",
          onClick: () => onNavigate(b.id),
          role: "button",
          tabIndex: 0,
        },
          h("span", { class: "dep-blocker-count" }, String(b.blockingCount)),
          h("span", { class: "dep-blocker-title" }, b.title),
          h("span", { class: "dep-blocker-id" }, b.id.slice(0, 8)),
        ),
      ),
    ),
  );
}

function BlockingChains({
  chains,
  nodes,
  onNavigate,
}: {
  chains: BlockingChain[];
  nodes: GraphNode[];
  onNavigate: (id: string) => void;
}) {
  if (chains.length === 0) return null;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  return h("div", { class: "dep-chains" },
    h("h3", { class: "dep-section-title" }, "Longest Blocking Chains"),
    h("p", { class: "dep-section-desc" }, "These dependency chains create the longest wait paths. Consider parallelizing or breaking them."),
    h("div", { class: "dep-chain-list" },
      chains.slice(0, 5).map((chain, i) =>
        h("div", { key: i, class: "dep-chain" },
          h("span", { class: "dep-chain-length" }, `${chain.path.length} steps`),
          h("div", { class: "dep-chain-path" },
            chain.path.map((nodeId, j) => {
              const node = nodeMap.get(nodeId);
              return h(Fragment, { key: nodeId },
                j > 0 ? h("span", { class: "dep-chain-arrow" }, "\u2192") : null,
                h("span", {
                  class: `dep-chain-node dep-chain-node-${node?.status ?? "pending"}`,
                  onClick: () => onNavigate(nodeId),
                  role: "button",
                  tabIndex: 0,
                  title: node?.title ?? nodeId,
                }, truncate(node?.title ?? nodeId.slice(0, 8), 20)),
              );
            }),
          ),
        ),
      ),
    ),
  );
}

// ── Main View Component ──────────────────────────────────────────────

export function ValidationView({ navigateTo }: { navigateTo?: NavigateTo }) {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [graphData, setGraphData] = useState<DependencyGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [graphLoading, setGraphLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"validation" | "dependencies">("validation");

  // Fetch dependency graph on mount
  const fetchGraph = useCallback(async () => {
    setGraphLoading(true);
    try {
      const res = await fetch("/api/rex/dependency-graph");
      if (!res.ok) {
        if (res.status === 404) {
          setGraphData(null);
        } else {
          console.error("Failed to fetch dependency graph");
        }
        return;
      }
      const data = await res.json();
      setGraphData(data);
    } catch {
      console.error("Failed to fetch dependency graph");
    } finally {
      setGraphLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  // Run validation
  const runValidation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/rex/validate");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Validation failed" }));
        setError(err.error || `HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError("Could not run validation. Is the server running?");
    } finally {
      setLoading(false);
    }
  }, []);

  // Navigate to item in PRD view
  const navigateToItem = useCallback((id: string) => {
    if (navigateTo) {
      navigateTo("prd", { taskId: id });
    } else {
      history.pushState({ view: "prd", file: null, zone: null }, "", `/prd/${id}`);
    }
    // Also dispatch custom event as a fallback for cases where the PRD view
    // is already mounted and needs to react to the navigation.
    window.dispatchEvent(
      new CustomEvent("prd-navigate", { detail: { itemId: id } }),
    );
  }, [navigateTo]);

  return h(Fragment, null,
    h("div", { class: "val-container" },
      // Header
      h("div", { class: "val-header" },
        h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
        h("h2", { class: "val-title" }, "Validation & Dependencies"),
        h("div", { class: "val-tabs" },
          h("button", {
            class: `val-tab${activeTab === "validation" ? " active" : ""}`,
            onClick: () => setActiveTab("validation"),
          }, "\u2713 Validation"),
          h("button", {
            class: `val-tab${activeTab === "dependencies" ? " active" : ""}`,
            onClick: () => setActiveTab("dependencies"),
          }, "\u2B95 Dependencies"),
        ),
      ),

      // Validation tab
      activeTab === "validation"
        ? h("div", { class: "val-panel" },
            // Run button
            h("div", { class: "val-actions" },
              h("button", {
                class: "val-run-btn",
                onClick: runValidation,
                disabled: loading,
              }, loading ? "Running\u2026" : "Run Validation"),
              h("p", { class: "val-actions-hint" },
                "Check for orphaned items, circular dependencies, stuck tasks, and hierarchy issues.",
              ),
            ),

            // Error
            error
              ? h("div", { class: "val-error" }, error)
              : null,

            // Results
            report
              ? h("div", { class: "val-results" },
                  h(ValidationSummary, { report }),
                  h("div", { class: "val-checks" },
                    report.checks.map((check, i) =>
                      h(CheckResultCard, {
                        key: i,
                        check,
                        onNavigate: navigateToItem,
                      }),
                    ),
                  ),
                )
              : !loading && !error
              ? h("div", { class: "val-placeholder" },
                  h("p", null, 'Click "Run Validation" to check your PRD for issues.'),
                )
              : null,
          )
        : null,

      // Dependencies tab
      activeTab === "dependencies"
        ? h("div", { class: "dep-panel" },
            graphLoading
              ? h("div", { class: "loading" }, "Loading dependency graph\u2026")
              : graphData
              ? h(Fragment, null,
                  // Graph stats row
                  h("div", { class: "dep-stats" },
                    h("div", { class: "dep-stat" },
                      h("span", { class: "dep-stat-num" }, String(graphData.nodes.length)),
                      h("span", { class: "dep-stat-label" }, "nodes"),
                    ),
                    h("div", { class: "dep-stat" },
                      h("span", { class: "dep-stat-num" }, String(graphData.edges.length)),
                      h("span", { class: "dep-stat-label" }, "edges"),
                    ),
                    graphData.cycleNodeIds.length > 0
                      ? h("div", { class: "dep-stat dep-stat-warn" },
                          h("span", { class: "dep-stat-num" }, String(graphData.cycleNodeIds.length)),
                          h("span", { class: "dep-stat-label" }, "in cycles"),
                        )
                      : null,
                    h("button", {
                      class: "dep-refresh-btn",
                      onClick: fetchGraph,
                      title: "Refresh graph",
                    }, "\u21BB Refresh"),
                  ),

                  // SVG graph
                  h(DependencyGraphSVG, {
                    data: graphData,
                    onNavigate: navigateToItem,
                  }),

                  // Two-column layout for blockers & chains
                  h("div", { class: "dep-details-grid" },
                    h(CriticalBlockers, {
                      blockers: graphData.criticalBlockers,
                      onNavigate: navigateToItem,
                    }),
                    h(BlockingChains, {
                      chains: graphData.blockingChains,
                      nodes: graphData.nodes,
                      onNavigate: navigateToItem,
                    }),
                  ),
                )
              : h("div", { class: "dep-empty" },
                  h("div", { class: "dep-empty-icon" }, "\u2713"),
                  h("p", null, "No PRD data found."),
                  h("p", { class: "dep-empty-hint" }, "Run 'rex init' and 'rex analyze' to create a PRD."),
                ),
          )
        : null,
    ),
  );
}

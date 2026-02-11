/**
 * Call Graph visualization view.
 *
 * Displays functions as nodes and call relationships as directed edges.
 * Reuses the import graph's GraphRenderer for zoom, pan, physics, and
 * zone hull rendering — the data is simply mapped from call graph format
 * to the generic GraphNode/GraphLink types.
 */

import { h } from "preact";
import { useEffect, useRef, useState, useMemo, useCallback } from "preact/hooks";
import type { LoadedData, DetailItem, NavigateTo } from "../types.js";
import type { CallGraph, CallEdge } from "../../schema/v1.js";
import { buildZoneColorMap, getZoneColorByIndex } from "../utils.js";
import { GraphRenderer, type GraphNode, type GraphLink, type ZoneInfo } from "../graph/renderer.js";
import { BrandedHeader } from "../components/logos.js";

interface CallGraphViewProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  selectedFile?: string | null;
  selectedZone?: string | null;
  navigateTo?: NavigateTo;
}

type ViewMode = "file" | "function";

/**
 * Build file-level graph from call edges: each file is a node,
 * cross-file calls become directed edges between files.
 */
function buildFileGraph(
  callGraph: CallGraph,
  fileToZoneMap: Map<string, string>,
  zoneColorMap: Map<string, string>,
): { nodes: GraphNode[]; links: GraphLink[] } {
  // Count cross-file call edges per file pair
  const edgeCounts = new Map<string, number>();
  const filesWithCalls = new Set<string>();

  for (const edge of callGraph.edges) {
    if (!edge.calleeFile || edge.callerFile === edge.calleeFile) continue;
    filesWithCalls.add(edge.callerFile);
    filesWithCalls.add(edge.calleeFile);
    const key = `${edge.callerFile}\0${edge.calleeFile}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  // Also add files that only have internal calls
  for (const edge of callGraph.edges) {
    filesWithCalls.add(edge.callerFile);
    if (edge.calleeFile) filesWithCalls.add(edge.calleeFile);
  }

  // Count incoming calls per file (for node sizing)
  const incomingCalls = new Map<string, number>();
  for (const edge of callGraph.edges) {
    if (edge.calleeFile) {
      incomingCalls.set(edge.calleeFile, (incomingCalls.get(edge.calleeFile) ?? 0) + 1);
    }
  }

  const nodes: GraphNode[] = Array.from(filesWithCalls).map((file) => ({
    id: file,
    zone: fileToZoneMap.get(file),
    zoneColor: fileToZoneMap.has(file) ? zoneColorMap.get(fileToZoneMap.get(file)!) : "var(--text-dim)",
    importCount: incomingCalls.get(file) ?? 0,
  }));

  const links: GraphLink[] = [];
  for (const [key, _count] of edgeCounts) {
    const [source, target] = key.split("\0");
    const sourceZone = fileToZoneMap.get(source);
    const targetZone = fileToZoneMap.get(target);
    const crossZone = !!(sourceZone && targetZone && sourceZone !== targetZone);
    links.push({ source, target, crossZone });
  }

  return { nodes, links };
}

/**
 * Build function-level graph: each function is a node,
 * call edges become directed edges between functions.
 * Filtered to a specific file or zone.
 */
function buildFunctionGraph(
  callGraph: CallGraph,
  filter: { type: "file"; file: string } | { type: "zone"; zone: string; zoneFiles: Set<string> } | null,
  fileToZoneMap: Map<string, string>,
  zoneColorMap: Map<string, string>,
): { nodes: GraphNode[]; links: GraphLink[] } {
  // Determine which files are in scope
  let inScopeFiles: Set<string> | null = null;
  if (filter) {
    if (filter.type === "file") {
      inScopeFiles = new Set([filter.file]);
    } else {
      inScopeFiles = filter.zoneFiles;
    }
  }

  // Filter functions to scope
  const scopedFunctions = callGraph.functions.filter((fn) =>
    !inScopeFiles || inScopeFiles.has(fn.file),
  );

  // Build function lookup for quick access
  const funcSet = new Set(scopedFunctions.map((fn) => `${fn.file}:${fn.qualifiedName}`));

  // Filter edges to scope
  const scopedEdges = callGraph.edges.filter((edge) => {
    const callerKey = `${edge.callerFile}:${edge.caller}`;
    const calleeKey = edge.calleeFile ? `${edge.calleeFile}:${edge.callee}` : null;
    // At least one end must be in scope
    return funcSet.has(callerKey) || (calleeKey && funcSet.has(calleeKey));
  });

  // Count incoming calls per function for sizing
  const incomingCalls = new Map<string, number>();
  for (const edge of scopedEdges) {
    if (edge.calleeFile) {
      const key = `${edge.calleeFile}:${edge.callee}`;
      incomingCalls.set(key, (incomingCalls.get(key) ?? 0) + 1);
    }
  }

  // Collect all function nodes that appear in edges
  const nodeSet = new Set<string>();
  for (const edge of scopedEdges) {
    nodeSet.add(`${edge.callerFile}:${edge.caller}`);
    if (edge.calleeFile) {
      nodeSet.add(`${edge.calleeFile}:${edge.callee}`);
    }
  }

  const nodes: GraphNode[] = Array.from(nodeSet).map((key) => {
    const [file] = key.split(":");
    const zone = fileToZoneMap.get(file);
    return {
      id: key,
      zone,
      zoneColor: zone ? zoneColorMap.get(zone) : "var(--text-dim)",
      importCount: incomingCalls.get(key) ?? 0,
    };
  });

  // Deduplicate links
  const linkSet = new Set<string>();
  const links: GraphLink[] = [];
  for (const edge of scopedEdges) {
    const source = `${edge.callerFile}:${edge.caller}`;
    const target = edge.calleeFile ? `${edge.calleeFile}:${edge.callee}` : null;
    if (!target) continue;
    const linkKey = `${source}\0${target}`;
    if (linkSet.has(linkKey)) continue;
    linkSet.add(linkKey);
    const sourceZone = fileToZoneMap.get(edge.callerFile);
    const targetZone = edge.calleeFile ? fileToZoneMap.get(edge.calleeFile) : undefined;
    const crossZone = !!(sourceZone && targetZone && sourceZone !== targetZone);
    links.push({ source, target, crossZone });
  }

  return { nodes, links };
}

export function CallGraphView({ data, onSelect, selectedFile, selectedZone, navigateTo }: CallGraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const graphRef = useRef<GraphRenderer | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [graphSearch, setGraphSearch] = useState("");
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [zonesVisible, setZonesVisible] = useState(true);
  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("file");
  const [filterFile, setFilterFile] = useState<string | null>(null);
  const [filterZone, setFilterZone] = useState<string | null>(null);

  const { callGraph, zones, inventory } = data;

  // Build zone lookups
  const fileToZoneMap = useMemo(() => {
    const map = new Map<string, string>();
    if (zones) {
      zones.zones.forEach((z) => {
        for (const f of z.files) map.set(f, z.id);
      });
    }
    return map;
  }, [zones]);

  const zoneColorMap = useMemo(() => buildZoneColorMap(zones), [zones]);

  // Build inventory lookup for detail enrichment
  const inventoryMap = useMemo(() => {
    const map = new Map<string, { language: string; size: number; lines: number; role: string; category: string }>();
    if (inventory) {
      for (const f of inventory.files) {
        map.set(f.path, {
          language: f.language,
          size: f.size,
          lines: f.lineCount,
          role: f.role,
          category: f.category,
        });
      }
    }
    return map;
  }, [inventory]);

  // Build ZoneInfo for renderer
  const zoneInfos = useMemo<ZoneInfo[]>(() => {
    if (!zones) return [];
    return zones.zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: getZoneColorByIndex(i),
      files: z.files,
    }));
  }, [zones]);

  // Cross-zone call stats for display
  const crossZoneCallStats = useMemo(() => {
    if (!callGraph || !zones) return null;
    const crossZoneCalls = callGraph.edges.filter((e) => {
      if (!e.calleeFile) return false;
      const callerZone = fileToZoneMap.get(e.callerFile);
      const calleeZone = fileToZoneMap.get(e.calleeFile);
      return callerZone && calleeZone && callerZone !== calleeZone;
    });
    return {
      total: callGraph.edges.length,
      crossZone: crossZoneCalls.length,
      percentage: callGraph.edges.length > 0
        ? Math.round((crossZoneCalls.length / callGraph.edges.length) * 100)
        : 0,
    };
  }, [callGraph, zones, fileToZoneMap]);

  // Available files and zones for filtering
  const filterableFiles = useMemo(() => {
    if (!callGraph) return [];
    const files = new Set<string>();
    for (const fn of callGraph.functions) files.add(fn.file);
    return Array.from(files).sort();
  }, [callGraph]);

  const filterableZones = useMemo(() => {
    if (!zones) return [];
    return zones.zones.map((z) => ({ id: z.id, name: z.name }));
  }, [zones]);

  // Build graph data based on view mode and filters
  const graphData = useMemo(() => {
    if (!callGraph) return null;

    if (viewMode === "file") {
      return buildFileGraph(callGraph, fileToZoneMap, zoneColorMap);
    }

    // Function mode: apply filter
    let filter: Parameters<typeof buildFunctionGraph>[1] = null;
    if (filterFile) {
      filter = { type: "file", file: filterFile };
    } else if (filterZone && zones) {
      const zone = zones.zones.find((z) => z.id === filterZone);
      if (zone) {
        filter = { type: "zone", zone: filterZone, zoneFiles: new Set(zone.files) };
      }
    }
    return buildFunctionGraph(callGraph, filter, fileToZoneMap, zoneColorMap);
  }, [callGraph, viewMode, filterFile, filterZone, zones, fileToZoneMap, zoneColorMap]);

  // Double-click navigates to file in Files view
  const handleNodeDblClick = useCallback((nodeId: string) => {
    if (navigateTo) {
      // In function mode, extract the file path from "file:funcName"
      const file = viewMode === "function" ? nodeId.split(":")[0] : nodeId;
      navigateTo("files", { file });
    }
  }, [navigateTo, viewMode]);

  // Node select callback
  const handleNodeSelect = useCallback((detail: { path: string; incomingImports: number }) => {
    if (viewMode === "function") {
      // Function node: show function detail
      const [file, ...funcParts] = detail.path.split(":");
      const funcName = funcParts.join(":");
      const fn = callGraph?.functions.find(
        (f) => f.file === file && f.qualifiedName === funcName,
      );
      onSelect({
        type: "generic",
        title: funcName || detail.path,
        file,
        funcName: funcName || "<module>",
        line: fn?.line,
        isExported: fn?.isExported,
        incomingCalls: detail.incomingImports,
      } as DetailItem);
    } else {
      // File node: enrich with inventory metadata
      const inv = inventoryMap.get(detail.path);
      onSelect({
        type: "file",
        title: detail.path.split("/").pop() ?? detail.path,
        path: detail.path,
        ...(inv ? {
          language: inv.language,
          size: formatSize(inv.size),
          lines: inv.lines,
          role: inv.role,
          category: inv.category,
        } : {}),
        zone: fileToZoneMap.get(detail.path),
        incomingImports: detail.incomingImports,
      });
    }
  }, [callGraph, viewMode, inventoryMap, fileToZoneMap, onSelect]);

  // Zone select callback
  const handleZoneSelect = useCallback((zoneId: string) => {
    if (!zones) return;
    const zone = zones.zones.find((z) => z.id === zoneId);
    if (!zone) return;
    onSelect({
      type: "zone",
      title: zone.name,
      id: zone.id,
      zoneId: zone.id,
      description: zone.description,
      files: zone.files.length,
      entryPoints: zone.entryPoints,
      cohesion: zone.cohesion.toFixed(2),
      coupling: zone.coupling.toFixed(2),
    });
  }, [zones, onSelect]);

  // Toggle controls
  const handleToggleLabels = useCallback(() => {
    if (graphRef.current) {
      const visible = graphRef.current.toggleLabels();
      setLabelsVisible(visible);
    }
  }, []);

  const handleToggleZones = useCallback(() => {
    if (graphRef.current) {
      const visible = graphRef.current.toggleZones();
      setZonesVisible(visible);
    }
  }, []);

  const handleZoomIn = useCallback(() => { graphRef.current?.zoomIn(); }, []);
  const handleZoomOut = useCallback(() => { graphRef.current?.zoomOut(); }, []);
  const handleResetView = useCallback(() => { graphRef.current?.resetView(); }, []);

  const handleZoneLegendClick = useCallback((zoneId: string) => {
    if (!graphRef.current) return;
    const nowCollapsed = graphRef.current.toggleZoneCollapse(zoneId);
    setCollapsedZones((prev) => {
      const next = new Set(prev);
      if (nowCollapsed) next.add(zoneId);
      else next.delete(zoneId);
      return next;
    });
  }, []);

  // Reset initialization when view mode or filter changes
  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.destroy();
      graphRef.current = null;
    }
    setInitialized(false);
  }, [viewMode, filterFile, filterZone]);

  // Initialize graph renderer
  useEffect(() => {
    if (!svgRef.current || !graphData || initialized) return;
    if (graphData.nodes.length === 0) return;

    const svg = svgRef.current;
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    const renderer = new GraphRenderer({
      svg,
      nodes: graphData.nodes,
      links: graphData.links,
      width,
      height,
      onNodeSelect: handleNodeSelect,
      onNodeDblClick: handleNodeDblClick,
      onZoneSelect: handleZoneSelect,
      zoneInfos: viewMode === "file" ? zoneInfos : [],
    });
    graphRef.current = renderer;
    setInitialized(true);

    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [graphData, initialized]);

  // Handle selectedFile highlight
  useEffect(() => {
    if (graphRef.current && selectedFile) {
      graphRef.current.highlightNode(selectedFile);
      graphRef.current.centerOnNode(selectedFile);
    }
  }, [selectedFile]);

  // Handle search
  useEffect(() => {
    if (!graphRef.current || !graphSearch) {
      if (graphRef.current) graphRef.current.highlightNode(null);
      return;
    }
    const q = graphSearch.toLowerCase();
    const match = graphRef.current.nodes.find((n) =>
      n.id.toLowerCase().includes(q),
    );
    if (match) {
      graphRef.current.highlightNode(match.id);
      graphRef.current.centerOnNode(match.id);
    }
  }, [graphSearch]);

  // Legend data
  const legendItems = useMemo(() => {
    if (!zones) return [];
    return zones.zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: getZoneColorByIndex(i),
    }));
  }, [zones]);

  if (!callGraph) {
    return h("div", { class: "loading" }, "No call graph data available. Run 'sourcevision analyze' to generate it.");
  }

  const summary = callGraph.summary;

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Call Graph"),
    ),
    h("p", { class: "section-sub" },
      `${summary.totalFunctions} functions, ${summary.totalCalls} call edges across ${summary.filesWithCalls} files`,
      crossZoneCallStats ? ` · ${crossZoneCallStats.crossZone} cross-zone calls (${crossZoneCallStats.percentage}%)` : "",
      summary.cycleCount > 0 ? ` · ${summary.cycleCount} cycles` : "",
    ),

    // Controls bar
    h("div", { class: "graph-search-bar", style: "display: flex; gap: 8px; align-items: center; flex-wrap: wrap;" },
      // View mode toggle
      h("div", { class: "call-graph-mode-toggle", style: "display: flex; gap: 2px; background: var(--bg-alt); border-radius: 6px; padding: 2px;" },
        h("button", {
          class: `call-graph-mode-btn${viewMode === "file" ? " active" : ""}`,
          onClick: () => { setViewMode("file"); setFilterFile(null); setFilterZone(null); },
          style: `padding: 4px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; background: ${viewMode === "file" ? "var(--accent)" : "transparent"}; color: ${viewMode === "file" ? "white" : "var(--text)"}`,
        }, "Files"),
        h("button", {
          class: `call-graph-mode-btn${viewMode === "function" ? " active" : ""}`,
          onClick: () => setViewMode("function"),
          style: `padding: 4px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; background: ${viewMode === "function" ? "var(--accent)" : "transparent"}; color: ${viewMode === "function" ? "white" : "var(--text)"}`,
        }, "Functions"),
      ),

      // Filter controls (function mode)
      viewMode === "function" ? h("select", {
        class: "filter-input",
        style: "max-width: 250px; font-size: 12px;",
        value: filterFile || filterZone || "",
        onChange: (e: Event) => {
          const val = (e.target as HTMLSelectElement).value;
          if (val.startsWith("zone:")) {
            setFilterZone(val.slice(5));
            setFilterFile(null);
          } else if (val) {
            setFilterFile(val);
            setFilterZone(null);
          } else {
            setFilterFile(null);
            setFilterZone(null);
          }
        },
      },
        h("option", { value: "" }, "All functions"),
        filterableZones.length > 0
          ? h("optgroup", { label: "By zone" },
              filterableZones.map((z) =>
                h("option", { key: `zone:${z.id}`, value: `zone:${z.id}` }, z.name),
              ),
            )
          : null,
        h("optgroup", { label: "By file" },
          filterableFiles.map((f) =>
            h("option", { key: f, value: f }, f.split("/").pop()),
          ),
        ),
      ) : null,

      // Search
      h("input", {
        type: "text",
        class: "filter-input",
        placeholder: viewMode === "function" ? "Search functions..." : "Search files...",
        value: graphSearch,
        onInput: (e: Event) => setGraphSearch((e.target as HTMLInputElement).value),
        style: "flex: 1; min-width: 150px;",
      }),
    ),

    // Summary stats cards
    h("div", { style: "display: flex; gap: 16px; margin: 12px 0; flex-wrap: wrap;" },
      h("div", { class: "stat-card", style: "padding: 8px 16px; background: var(--bg-alt); border-radius: 8px; font-size: 12px;" },
        h("div", { style: "font-weight: 600; color: var(--text);" }, String(summary.totalFunctions)),
        h("div", { style: "color: var(--text-dim);" }, "Functions"),
      ),
      h("div", { class: "stat-card", style: "padding: 8px 16px; background: var(--bg-alt); border-radius: 8px; font-size: 12px;" },
        h("div", { style: "font-weight: 600; color: var(--text);" }, String(summary.totalCalls)),
        h("div", { style: "color: var(--text-dim);" }, "Call Edges"),
      ),
      summary.cycleCount > 0
        ? h("div", { class: "stat-card", style: "padding: 8px 16px; background: var(--bg-alt); border-radius: 8px; font-size: 12px;" },
            h("div", { style: "font-weight: 600; color: var(--warning);" }, String(summary.cycleCount)),
            h("div", { style: "color: var(--text-dim);" }, "Cycles"),
          )
        : null,
      // Most called function
      summary.mostCalled.length > 0
        ? h("div", { class: "stat-card", style: "padding: 8px 16px; background: var(--bg-alt); border-radius: 8px; font-size: 12px;" },
            h("div", { style: "font-weight: 600; color: var(--text);" }, summary.mostCalled[0].qualifiedName),
            h("div", { style: "color: var(--text-dim);" }, `Most called (${summary.mostCalled[0].callerCount} callers)`),
          )
        : null,
    ),

    // Graph container
    graphData && graphData.nodes.length > 0
      ? h("div", { class: "graph-container", style: "position: relative;" },
          h("svg", { ref: svgRef }),
          // Label toggle
          h("button", {
            class: "graph-label-toggle",
            onClick: handleToggleLabels,
            title: labelsVisible ? "Hide labels" : "Show labels",
          }, labelsVisible ? "Labels" : "Labels off"),
          // Zone toggle (file mode only)
          viewMode === "file"
            ? h("button", {
                class: "graph-zone-toggle",
                onClick: handleToggleZones,
                title: zonesVisible ? "Hide zone groups" : "Show zone groups",
              }, zonesVisible ? "Zones" : "Zones off")
            : null,
          // Zoom controls
          h("div", { class: "graph-zoom-controls" },
            h("button", {
              class: "graph-zoom-btn",
              onClick: handleZoomIn,
              title: "Zoom in",
              "aria-label": "Zoom in",
            }, "+"),
            h("button", {
              class: "graph-zoom-btn",
              onClick: handleZoomOut,
              title: "Zoom out",
              "aria-label": "Zoom out",
            }, "\u2212"),
            h("button", {
              class: "graph-zoom-btn graph-zoom-fit",
              onClick: handleResetView,
              title: "Fit to content",
              "aria-label": "Fit to content",
            }, "\u2922"),
          ),
          // Legend overlay (file mode only)
          viewMode === "file" && legendItems.length > 0
            ? h("div", { class: "graph-legend" },
                h("div", { class: "graph-legend-title", style: "font-size: 10px; color: var(--text-dim); margin-bottom: 4px; opacity: 0.7;" }, "Click to toggle zone"),
                legendItems.map((item) =>
                  h("div", {
                    key: item.name,
                    class: `graph-legend-item${collapsedZones.has(item.id) ? " collapsed" : ""}`,
                    onClick: () => handleZoneLegendClick(item.id),
                  },
                    h("span", { class: "graph-legend-dot", style: `background: ${item.color};` }),
                    item.name,
                  ),
                ),
              )
            : null,
        )
      : h("div", { class: "loading", style: "padding: 40px; text-align: center;" },
          viewMode === "function" && (filterFile || filterZone)
            ? "No call relationships found for this filter. Try a different file or zone."
            : "No call relationships found.",
        ),

    // Most called / most calling tables
    h("div", { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px;" },
      // Most called
      summary.mostCalled.length > 0
        ? h("div", null,
            h("h3", { style: "font-size: 14px; margin-bottom: 8px; color: var(--text);" }, "Most Called Functions"),
            h("table", { class: "data-table", style: "width: 100%; font-size: 12px;" },
              h("thead", null,
                h("tr", null,
                  h("th", { style: "text-align: left; padding: 4px 8px;" }, "Function"),
                  h("th", { style: "text-align: left; padding: 4px 8px;" }, "File"),
                  h("th", { style: "text-align: right; padding: 4px 8px;" }, "Callers"),
                ),
              ),
              h("tbody", null,
                summary.mostCalled.slice(0, 10).map((item, i) =>
                  h("tr", { key: i, style: "border-top: 1px solid var(--border);" },
                    h("td", { style: "padding: 4px 8px; font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" }, item.qualifiedName),
                    h("td", { style: "padding: 4px 8px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" }, item.file.split("/").pop()),
                    h("td", { style: "padding: 4px 8px; text-align: right; font-weight: 600;" }, String(item.callerCount)),
                  ),
                ),
              ),
            ),
          )
        : null,

      // Most calling
      summary.mostCalling.length > 0
        ? h("div", null,
            h("h3", { style: "font-size: 14px; margin-bottom: 8px; color: var(--text);" }, "Most Complex Functions"),
            h("table", { class: "data-table", style: "width: 100%; font-size: 12px;" },
              h("thead", null,
                h("tr", null,
                  h("th", { style: "text-align: left; padding: 4px 8px;" }, "Function"),
                  h("th", { style: "text-align: left; padding: 4px 8px;" }, "File"),
                  h("th", { style: "text-align: right; padding: 4px 8px;" }, "Callees"),
                ),
              ),
              h("tbody", null,
                summary.mostCalling.slice(0, 10).map((item, i) =>
                  h("tr", { key: i, style: "border-top: 1px solid var(--border);" },
                    h("td", { style: "padding: 4px 8px; font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" }, item.qualifiedName),
                    h("td", { style: "padding: 4px 8px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" }, item.file.split("/").pop()),
                    h("td", { style: "padding: 4px 8px; text-align: right; font-weight: 600;" }, String(item.calleeCount)),
                  ),
                ),
              ),
            ),
          )
        : null,
    ),
  );
}

/** Format bytes to a human-readable string. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

import { h } from "preact";
import { useEffect, useRef, useState, useMemo, useCallback } from "preact/hooks";
import type { LoadedData, DetailItem, NavigateTo } from "../types.js";
import { buildZoneColorMap, getZoneColorByIndex } from "../visualization/index.js";
import { GraphRenderer, type GraphNode, type GraphLink, type ZoneInfo } from "../graph/renderer.js";
import { BrandedHeader } from "../components/logos.js";

interface GraphProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  selectedFile?: string | null;
  selectedZone?: string | null;
  navigateTo?: NavigateTo;
}

const GRAPH_VISIBLE_KEY = "import-graph-visible";

/** Read persisted graph visibility preference (hidden by default). */
function getInitialGraphVisible(): boolean {
  try {
    return localStorage.getItem(GRAPH_VISIBLE_KEY) === "true";
  } catch {
    return false;
  }
}

export function Graph({ data, onSelect, selectedFile, selectedZone, navigateTo }: GraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const graphRef = useRef<GraphRenderer | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [graphSearch, setGraphSearch] = useState("");
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [zonesVisible, setZonesVisible] = useState(true);
  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());
  const [graphVisible, setGraphVisible] = useState(getInitialGraphVisible);

  const { imports, zones, inventory } = data;

  // Build zone lookups using shared utilities
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

  // Build cross-zone set
  const crossZoneSet = useMemo(() => {
    const set = new Set<string>();
    if (zones) {
      for (const c of zones.crossings) {
        set.add(`${c.from}\0${c.to}`);
      }
    }
    return set;
  }, [zones]);

  // Build inventory lookup for file metadata enrichment
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

  // Build ZoneInfo array for renderer
  const zoneInfos = useMemo<ZoneInfo[]>(() => {
    if (!zones) return [];
    return zones.zones.map((z, i) => ({
      id: z.id,
      name: z.name,
      color: getZoneColorByIndex(i),
      files: z.files,
    }));
  }, [zones]);

  // Double-click navigates to file in Files view
  const handleNodeDblClick = useCallback((path: string) => {
    if (navigateTo) {
      navigateTo("files", { file: path });
    }
  }, [navigateTo]);

  // Toggle label visibility
  const handleToggleLabels = useCallback(() => {
    if (graphRef.current) {
      const visible = graphRef.current.toggleLabels();
      setLabelsVisible(visible);
    }
  }, []);

  // Toggle zone hull visibility
  const handleToggleZones = useCallback(() => {
    if (graphRef.current) {
      const visible = graphRef.current.toggleZones();
      setZonesVisible(visible);
    }
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => { graphRef.current?.zoomIn(); }, []);
  const handleZoomOut = useCallback(() => { graphRef.current?.zoomOut(); }, []);
  const handleResetView = useCallback(() => { graphRef.current?.resetView(); }, []);

  // Toggle collapse on a specific zone (from legend click)
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

  // Toggle graph visibility (persisted to localStorage)
  const handleToggleGraph = useCallback(() => {
    setGraphVisible((prev) => {
      const next = !prev;
      try { localStorage.setItem(GRAPH_VISIBLE_KEY, String(next)); } catch { /* noop */ }
      if (!next) {
        // Destroy renderer when hiding to free resources
        graphRef.current?.destroy();
        graphRef.current = null;
        setInitialized(false);
      }
      return next;
    });
  }, []);

  // Zone select callback (click on hull)
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

  if (!imports) {
    return h("div", { class: "loading" }, "No import data available.");
  }

  useEffect(() => {
    if (!svgRef.current || !imports || initialized) return;

    const svg = svgRef.current;
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    // Collect unique nodes
    const nodeSet = new Set<string>();
    for (const e of imports.edges) {
      nodeSet.add(e.from);
      nodeSet.add(e.to);
    }

    // Count imports per file
    const importCounts = new Map<string, number>();
    for (const e of imports.edges) {
      importCounts.set(e.to, (importCounts.get(e.to) || 0) + 1);
    }

    const nodes: GraphNode[] = Array.from(nodeSet).map((id) => ({
      id,
      zone: fileToZoneMap.get(id),
      zoneColor: fileToZoneMap.has(id) ? zoneColorMap.get(fileToZoneMap.get(id)!) : "var(--text-dim)",
      importCount: importCounts.get(id) || 0,
    }));

    const links: GraphLink[] = imports.edges.map((e) => ({
      source: e.from,
      target: e.to,
      crossZone: crossZoneSet.has(`${e.from}\0${e.to}`),
    }));

    const renderer = new GraphRenderer({
      svg, nodes, links, width, height,
      onNodeSelect: (detail) => {
        // Enrich with inventory metadata if available
        const inv = inventoryMap.get(detail.path);
        const enriched: DetailItem = {
          type: "file",
          ...detail,
          ...(inv ? {
            language: inv.language,
            size: formatSize(inv.size),
            lines: inv.lines,
            role: inv.role,
            category: inv.category,
          } : {}),
        };
        onSelect(enriched);
      },
      onNodeDblClick: handleNodeDblClick,
      onZoneSelect: handleZoneSelect,
      zoneInfos,
    });
    graphRef.current = renderer;
    setInitialized(true);

    // Cleanup: destroy renderer when unmounting (fixes leaked event listeners)
    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [imports, initialized, graphVisible]);

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
      n.id.toLowerCase().includes(q)
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
      name: z.name,
      color: getZoneColorByIndex(i),
    }));
  }, [zones]);

  const nodeCount = new Set([...imports.edges.map(e => e.from), ...imports.edges.map(e => e.to)]).size;

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Import Graph"),
    ),
    h("p", { class: "section-sub" },
      `${imports.edges.length} edges between ${nodeCount} files`,
      zones ? ` across ${zones.zones.length} zones` : ""
    ),
    // Graph visibility toggle
    h("div", { class: "graph-visibility-bar" },
      h("button", {
        class: `filter-toggle-btn${graphVisible ? " active" : ""}`,
        onClick: handleToggleGraph,
        "aria-pressed": String(graphVisible),
        title: graphVisible ? "Hide graph visualization" : "Show graph visualization",
      }, graphVisible ? "\u2713 Graph Visible" : "Show Graph"),
      !graphVisible
        ? h("span", { class: "graph-visibility-hint" },
            "The force-directed graph is hidden to improve performance. Click to enable."
          )
        : null,
    ),
    // Graph content: shown only when toggle is on
    graphVisible
      ? h("div", null,
          // Search bar
          h("div", { class: "graph-search-bar" },
            h("input", {
              type: "text",
              class: "filter-input",
              placeholder: "Search nodes...",
              value: graphSearch,
              onInput: (e: Event) => setGraphSearch((e.target as HTMLInputElement).value),
            })
          ),
          h("div", { class: "graph-container", style: "position: relative;" },
            h("svg", { ref: svgRef }),
            // Label toggle button
            h("button", {
              class: "graph-label-toggle",
              onClick: handleToggleLabels,
              title: labelsVisible ? "Hide labels" : "Show labels",
            }, labelsVisible ? "Labels" : "Labels off"),
            // Zone toggle button
            h("button", {
              class: "graph-zone-toggle",
              onClick: handleToggleZones,
              title: zonesVisible ? "Hide zone groups" : "Show zone groups",
            }, zonesVisible ? "Zones" : "Zones off"),
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
            // Legend overlay — click items to collapse/expand zones
            legendItems.length > 0
              ? h("div", { class: "graph-legend" },
                  h("div", { class: "graph-legend-title", style: "font-size: 10px; color: var(--text-dim); margin-bottom: 4px; opacity: 0.7;" }, "Click to toggle zone"),
                  legendItems.map((item) =>
                    h("div", {
                      key: item.name,
                      class: `graph-legend-item${collapsedZones.has(zones?.zones.find(z => z.name === item.name)?.id ?? "") ? " collapsed" : ""}`,
                      onClick: () => {
                        const zone = zones?.zones.find(z => z.name === item.name);
                        if (zone) handleZoneLegendClick(zone.id);
                      },
                    },
                      h("span", { class: "graph-legend-dot", style: `background: ${item.color};` }),
                      item.name
                    )
                  )
                )
              : null
          ),
        )
      : // Collapsed placeholder with summary stats
        h("div", { class: "graph-hidden-placeholder" },
          h("div", { class: "graph-hidden-icon" }, "\u2B95"),
          h("div", { class: "graph-hidden-stats" },
            h("span", { class: "stat-card" },
              h("span", { class: "value" }, String(nodeCount)),
              h("span", { class: "label" }, "Files"),
            ),
            h("span", { class: "stat-card" },
              h("span", { class: "value" }, String(imports.edges.length)),
              h("span", { class: "label" }, "Edges"),
            ),
            zones
              ? h("span", { class: "stat-card" },
                  h("span", { class: "value" }, String(zones.zones.length)),
                  h("span", { class: "label" }, "Zones"),
                )
              : null,
          ),
        ),
  );
}

/** Format bytes to a human-readable string. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

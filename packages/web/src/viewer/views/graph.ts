import { h } from "preact";
import { useEffect, useRef, useState, useMemo } from "preact/hooks";
import type { LoadedData, DetailItem } from "../types.js";
import { ZONE_COLORS } from "../components/constants.js";
import { GraphRenderer, type GraphNode, type GraphLink } from "../graph/renderer.js";
import { BrandedHeader } from "../components/logos.js";

interface GraphProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  selectedFile?: string | null;
  selectedZone?: string | null;
}

export function Graph({ data, onSelect, selectedFile, selectedZone }: GraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const graphRef = useRef<GraphRenderer | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [graphSearch, setGraphSearch] = useState("");

  const { imports, zones } = data;

  // Build zone lookup
  const fileToZone = useMemo(() => {
    const map = new Map<string, string>();
    if (zones) {
      zones.zones.forEach((z) => {
        for (const f of z.files) map.set(f, z.id);
      });
    }
    return map;
  }, [zones]);

  const zoneColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (zones) {
      zones.zones.forEach((z, i) => {
        map.set(z.id, ZONE_COLORS[i % ZONE_COLORS.length]);
      });
    }
    return map;
  }, [zones]);

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
      zone: fileToZone.get(id),
      zoneColor: fileToZone.has(id) ? zoneColorMap.get(fileToZone.get(id)!) : "var(--text-dim)",
      importCount: importCounts.get(id) || 0,
    }));

    const links: GraphLink[] = imports.edges.map((e) => ({
      source: e.from,
      target: e.to,
      crossZone: crossZoneSet.has(`${e.from}\0${e.to}`),
    }));

    const renderer = new GraphRenderer({
      svg, nodes, links, width, height,
      onNodeSelect: (detail) => onSelect({ type: "file", ...detail }),
      zones,
    });
    graphRef.current = renderer;
    setInitialized(true);

    // Cleanup: destroy renderer when unmounting (fixes leaked event listeners)
    return () => {
      graphRef.current?.destroy();
      graphRef.current = null;
    };
  }, [imports, initialized]);

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
      color: ZONE_COLORS[i % ZONE_COLORS.length],
    }));
  }, [zones]);

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Import Graph"),
    ),
    h("p", { class: "section-sub" },
      `${imports.edges.length} edges between ${new Set([...imports.edges.map(e => e.from), ...imports.edges.map(e => e.to)]).size} files`,
      zones ? ` across ${zones.zones.length} zones` : ""
    ),
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
      // Legend overlay
      legendItems.length > 0
        ? h("div", { class: "graph-legend" },
            legendItems.map((item) =>
              h("div", { key: item.name, class: "graph-legend-item" },
                h("span", { class: "graph-legend-dot", style: `background: ${item.color};` }),
                item.name
              )
            )
          )
        : null
    )
  );
}

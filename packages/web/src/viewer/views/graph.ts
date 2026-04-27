/**
 * Import Graph — hybrid focused dependency view (replaces legacy force graph).
 */

import { h } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { LoadedData, DetailItem, NavigateTo } from "../types.js";
import type { ImportType } from "../external.js";
import { BrandedHeader, SearchFilter } from "../components/index.js";
import { basename } from "../utils.js";
import {
  aggregateDirectedZoneFlows,
  allImportTypes,
  buildFileDegrees,
  collectFilePaths,
  defaultFocusPath,
  defaultFocusPathInZone,
  expandNeighborhood,
  fileToZoneId,
  filesInCycles,
  filterEdgesInBall,
  findExternal,
  isCrossZoneEdge,
  partitionNeighbors,
  restrictBallToZone,
  zoneDisplayName,
} from "./import-graph/model.js";
import {
  elbowPath,
  layoutFocusedGraph,
  layoutPackageGraph,
  nodeBox,
  nodeHalfWidth,
  type NodeKind,
} from "./import-graph/layout.js";

interface GraphProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  selectedFile?: string | null;
  selectedZone?: string | null;
  navigateTo?: NavigateTo;
}

const DEPTH_OPTIONS = [1, 2, 3, 4] as const;
const EXPLORE_ROW_CAP = 400;
const ZONE_FLOW_CAP = 24;

type PageTab = "explore" | "graph";
type ExploreSort = "path" | "in" | "out" | "total";

/** Readable basename / package label inside SVG boxes (avoid tiny monospace overflow). */
function truncateNodeLabel(label: string, kind: NodeKind): string {
  const max = kind === "package" ? 26 : 22;
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Graph({ data, onSelect, selectedFile, selectedZone, navigateTo }: GraphProps) {
  const { imports, zones, inventory } = data;

  const [pageTab, setPageTab] = useState<PageTab>("explore");
  const [exploreSort, setExploreSort] = useState<ExploreSort>("total");
  const [mode, setMode] = useState<"file" | "package">("file");
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [focusPackage, setFocusPackage] = useState<string | null>(null);
  const [depth, setDepth] = useState<number>(2);
  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [crossZoneOnly, setCrossZoneOnly] = useState(false);
  const [cyclesOnly, setCyclesOnly] = useState(false);
  const [importTypes, setImportTypes] = useState<Set<ImportType>>(() => new Set(allImportTypes()));

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

  const allFiles = useMemo(
    () => (imports ? collectFilePaths(imports, inventory) : []),
    [imports, inventory],
  );

  useEffect(() => {
    if (!imports || focusFile !== null) return;
    const p = defaultFocusPath(imports);
    setFocusFile(p);
  }, [imports, focusFile]);

  useEffect(() => {
    if (!imports || mode !== "package" || focusPackage || !imports.external.length) return;
    setFocusPackage(imports.external[0].package);
  }, [mode, focusPackage, imports]);

  useEffect(() => {
    if (selectedFile) {
      setMode("file");
      setFocusFile(selectedFile);
      setPageTab("graph");
    }
  }, [selectedFile]);

  useEffect(() => {
    if (selectedZone && zones?.zones.some((z) => z.id === selectedZone)) {
      setZoneFilter(selectedZone);
    }
  }, [selectedZone, zones]);

  const typeFilterSet = useMemo(() => {
    const all = allImportTypes();
    if (importTypes.size === all.length) return null;
    return importTypes;
  }, [importTypes]);

  const subgraph = useMemo(() => {
    if (!imports || !focusFile || mode !== "file") return null;
    let ball = expandNeighborhood(focusFile, imports, depth);
    ball = restrictBallToZone(ball, focusFile, zoneFilter || null, zones);
    const edges = filterEdgesInBall(ball, imports, {
      importTypes: typeFilterSet,
      crossZoneOnly,
      cyclesOnly,
      zones,
    });
    const { predecessors, successors } = partitionNeighbors(focusFile, ball, edges);
    const layout = layoutFocusedGraph({
      centerPath: focusFile,
      predecessors,
      successors,
    });
    return { ball, edges, layout };
  }, [imports, focusFile, mode, depth, typeFilterSet, crossZoneOnly, cyclesOnly, zoneFilter, zones]);

  const packageSubgraph = useMemo(() => {
    if (!imports || mode !== "package" || !focusPackage) return null;
    const ext = findExternal(imports, focusPackage);
    const files = ext?.importedBy ?? [];
    const layout = layoutPackageGraph(focusPackage, files);
    return { layout, files };
  }, [imports, mode, focusPackage]);

  const posMap = useMemo(() => {
    const layout = mode === "package" ? packageSubgraph?.layout : subgraph?.layout;
    if (!layout) return new Map<string, { x: number; y: number }>();
    const m = new Map<string, { x: number; y: number }>();
    for (const n of layout.nodes) m.set(n.id, { x: n.x, y: n.y });
    return m;
  }, [mode, subgraph, packageSubgraph]);

  const layoutNodes = useMemo(
    () => (mode === "package" ? packageSubgraph?.layout.nodes : subgraph?.layout.nodes) ?? null,
    [mode, packageSubgraph, subgraph],
  );

  const nodeKindById = useMemo(() => {
    const m = new Map<string, NodeKind>();
    if (layoutNodes) for (const n of layoutNodes) m.set(n.id, n.kind);
    return m;
  }, [layoutNodes]);

  const svgDims = useMemo(
    () => ({
      w: mode === "package" ? packageSubgraph?.layout.width ?? 680 : subgraph?.layout.width ?? 760,
      h: mode === "package" ? packageSubgraph?.layout.height ?? 400 : subgraph?.layout.height ?? 460,
    }),
    [mode, packageSubgraph, subgraph],
  );

  const selectFileDetail = useCallback(
    (path: string) => {
      const inv = inventoryMap.get(path);
      const zid = fileToZoneId(path, zones);
      const zoneName = zid && zones ? zones.zones.find((z) => z.id === zid)?.name : undefined;
      const detail: DetailItem = {
        type: "file",
        title: basename(path),
        path,
        zone: zoneName,
        ...(inv
          ? {
              language: inv.language,
              size: formatSize(inv.size),
              lines: inv.lines,
              role: inv.role,
              category: inv.category,
            }
          : {}),
      };
      onSelect(detail);
    },
    [inventoryMap, onSelect, zones],
  );

  const handleFileClick = useCallback(
    (path: string) => {
      setMode("file");
      setFocusFile(path);
      selectFileDetail(path);
    },
    [selectFileDetail],
  );

  const handleFileDblClick = useCallback(
    (path: string) => {
      navigateTo?.("files", { file: path });
    },
    [navigateTo],
  );

  const { inDegree, outDegree } = useMemo(() => {
    if (!imports) return { inDegree: new Map<string, number>(), outDegree: new Map<string, number>() };
    return buildFileDegrees(imports);
  }, [imports]);

  const zoneFlows = useMemo(
    () => (imports && zones ? aggregateDirectedZoneFlows(imports, zones).slice(0, ZONE_FLOW_CAP) : []),
    [imports, zones],
  );

  const cycleSet = useMemo(() => (imports ? filesInCycles(imports) : new Set<string>()), [imports]);

  const exploreRows = useMemo(() => {
    if (!imports) return [];
    const q = search.trim().toLowerCase();
    let rows = allFiles.map((path) => ({
      path,
      zoneId: fileToZoneId(path, zones),
      inD: inDegree.get(path) ?? 0,
      outD: outDegree.get(path) ?? 0,
      inCycle: cycleSet.has(path),
    }));
    if (zoneFilter) rows = rows.filter((r) => r.zoneId === zoneFilter);
    if (q) rows = rows.filter((r) => r.path.toLowerCase().includes(q));
    const cmp = (a: (typeof rows)[0], b: (typeof rows)[0]) => {
      if (exploreSort === "path") return a.path.localeCompare(b.path);
      if (exploreSort === "in") return b.inD - a.inD || a.path.localeCompare(b.path);
      if (exploreSort === "out") return b.outD - a.outD || a.path.localeCompare(b.path);
      return b.inD + b.outD - (a.inD + a.outD) || a.path.localeCompare(b.path);
    };
    rows.sort(cmp);
    return rows;
  }, [imports, allFiles, zones, zoneFilter, search, exploreSort, inDegree, outDegree, cycleSet]);

  const zoneCards = useMemo(() => {
    if (!zones) return [];
    return [...zones.zones]
      .map((z) => ({ id: z.id, name: z.name, n: z.files.length }))
      .sort((a, b) => b.n - a.n);
  }, [zones]);

  const openZoneInGraph = useCallback(
    (zoneId: string) => {
      if (!imports || !zones) return;
      const p = defaultFocusPathInZone(imports, zoneId, zones);
      if (!p) return;
      setZoneFilter(zoneId);
      setPageTab("graph");
      setMode("file");
      setFocusFile(p);
      selectFileDetail(p);
    },
    [imports, zones, selectFileDetail],
  );

  const drillFileToGraph = useCallback(
    (path: string) => {
      setPageTab("graph");
      handleFileClick(path);
    },
    [handleFileClick],
  );

  const filteredFileList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allFiles;
    return allFiles.filter((p) => p.toLowerCase().includes(q));
  }, [allFiles, search]);

  const toggleImportType = useCallback((t: ImportType) => {
    setImportTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      if (next.size === 0) return new Set(allImportTypes());
      return next;
    });
  }, []);

  if (!imports) {
    return h("div", { class: "ig-page ig-page--empty" },
      h("div", { class: "view-header" },
        h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      ),
      h("div", { class: "ig-empty", role: "status" },
        h("div", { class: "ig-empty-visual", "aria-hidden": "true" }),
        h("h2", { class: "ig-empty-title" }, "Waiting for imports"),
        h("p", { class: "ig-empty-body" },
          "No import data is available yet. Run ",
          h("code", { class: "ig-empty-code" }, "sourcevision analyze"),
          ", or keep this tab open while deferred artifacts finish loading.",
        ),
      ),
    );
  }

  const summary = imports.summary;
  const fileCount = allFiles.length;
  const extList = [...imports.external].sort((a, b) => a.package.localeCompare(b.package));

  const edgePaths: { d: string; cross: boolean; key: string }[] = [];
  const kindOf = (id: string): NodeKind => nodeKindById.get(id) ?? "file";

  const svgW = svgDims.w;
  const svgH = svgDims.h;

  if (mode === "file" && subgraph) {
    const { edges } = subgraph;
    for (const e of edges) {
      const a = posMap.get(e.from);
      const b = posMap.get(e.to);
      if (!a || !b) continue;
      const wFrom = nodeHalfWidth(kindOf(e.from));
      const wTo = nodeHalfWidth(kindOf(e.to));
      edgePaths.push({
        key: `${e.from}->${e.to}:${e.type}`,
        d: elbowPath(a.x + wFrom, a.y, b.x - wTo, b.y),
        cross: isCrossZoneEdge(e.from, e.to, zones),
      });
    }
  } else if (mode === "package" && packageSubgraph && focusPackage) {
    const pkgId = `pkg:${focusPackage}`;
    const pkgPos = posMap.get(pkgId);
    if (pkgPos) {
      const wPkg = nodeHalfWidth("package");
      const wFile = nodeHalfWidth("file");
      for (const f of packageSubgraph.files.slice(0, 48)) {
        const fp = posMap.get(f);
        if (!fp) continue;
        edgePaths.push({
          key: `${f}->${pkgId}`,
          d: elbowPath(fp.x + wFile, fp.y, pkgPos.x - wPkg, pkgPos.y),
          cross: false,
        });
      }
    }
  }

  const hubList = (summary.mostImported ?? []).slice(0, 12);
  const cycleList = (summary.circulars ?? []).slice(0, 8);

  const shownExplore = exploreRows.length > EXPLORE_ROW_CAP ? EXPLORE_ROW_CAP : exploreRows.length;

  return h("div", { class: "ig-page" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
    ),

    h("header", { class: "ig-topbar" },
      h("div", { class: "ig-topbar-row" },
        h("div", { class: "ig-topbar-lead" },
          h("h2", { class: "ig-page-title" }, "Import Graph"),
          h("p", { class: "ig-topbar-metrics" },
            `${fileCount.toLocaleString()} files · ${summary.totalEdges.toLocaleString()} edges · `,
            `${summary.totalExternal.toLocaleString()} package${summary.totalExternal === 1 ? "" : "s"} · `,
            `${summary.circularCount} cycle${summary.circularCount === 1 ? "" : "s"}`,
            zones ? ` · ${zones.zones.length} zones` : "",
          ),
        ),
        h("div", { class: "ig-segments", role: "tablist", "aria-label": "Import graph mode" },
          h("button", {
            type: "button",
            role: "tab",
            id: "ig-tab-explore",
            "aria-selected": pageTab === "explore",
            "aria-controls": "ig-explore-panel",
            class: `ig-segment${pageTab === "explore" ? " ig-segment-active" : ""}`,
            onClick: () => setPageTab("explore"),
          }, "Explore codebase"),
          h("button", {
            type: "button",
            role: "tab",
            id: "ig-tab-graph",
            "aria-selected": pageTab === "graph",
            "aria-controls": "ig-graph-panel",
            class: `ig-segment${pageTab === "graph" ? " ig-segment-active" : ""}`,
            onClick: () => {
              setPageTab("graph");
              if (!focusFile) setFocusFile(defaultFocusPath(imports));
            },
          }, "File graph"),
        ),
      ),
      h("p", { class: "ig-topbar-hint" },
        pageTab === "explore"
          ? "Scan every file, sort by traffic, filter by zone, then open the local graph when you are ready."
          : "Neighborhood view around one file or package — tune depth and edge types to match what you need.",
      ),
    ),

    pageTab === "explore"
      ? h("div", { class: "ig-explore", id: "ig-explore-panel", role: "tabpanel", "aria-labelledby": "ig-tab-explore" },
          h("div", { class: "ig-explore-toolbar" },
            h("label", { class: "ig-field" },
              "Sort by",
              h("select", {
                value: exploreSort,
                onChange: (e: Event) => setExploreSort((e.target as HTMLSelectElement).value as ExploreSort),
              },
                h("option", { value: "total" }, "Total degree (in + out)"),
                h("option", { value: "in" }, "Incoming imports"),
                h("option", { value: "out" }, "Outgoing imports"),
                h("option", { value: "path" }, "Path A–Z"),
              ),
            ),
            zoneFilter
              ? h("button", {
                  type: "button",
                  class: "ig-btn-secondary",
                  onClick: () => setZoneFilter(""),
                }, "Clear zone filter")
              : null,
            h("span", { class: "ig-explore-count" },
              `${shownExplore.toLocaleString()} shown`,
              exploreRows.length !== allFiles.length || exploreRows.length > EXPLORE_ROW_CAP
                ? ` · ${exploreRows.length.toLocaleString()} match${exploreRows.length === 1 ? "" : "es"}`
                : "",
              exploreRows.length > EXPLORE_ROW_CAP ? ` (cap ${EXPLORE_ROW_CAP})` : "",
            ),
          ),
          h("div", { class: "ig-search-wrap ig-search-wrap--explore" },
            h(SearchFilter, {
              placeholder: "Filter by path substring…",
              value: search,
              onInput: setSearch,
              resultCount: exploreRows.length,
              totalCount: allFiles.length,
            }),
          ),
          zoneCards.length
            ? h("section", { class: "ig-explore-zones" },
                h("h3", { class: "ig-explore-section-title" }, "Zones"),
                h("p", { class: "ig-explore-section-desc" },
                  "Filter the table to one zone, or jump straight into the graph at a hub inside that zone.",
                ),
                h("div", { class: "ig-zone-cards" },
                  ...zoneCards.map((z) =>
                    h("div", { key: z.id, class: `ig-zone-card${zoneFilter === z.id ? " ig-zone-card-active" : ""}` },
                      h("div", { class: "ig-zone-card-head" },
                        h("span", { class: "ig-zone-card-name" }, z.name),
                        h("span", { class: "ig-zone-card-count" }, `${z.n} files`),
                      ),
                      h("div", { class: "ig-zone-card-actions" },
                        h("button", {
                          type: "button",
                          class: "ig-btn-secondary",
                          onClick: () => setZoneFilter(zoneFilter === z.id ? "" : z.id),
                        }, zoneFilter === z.id ? "Clear table filter" : "Filter table"),
                        h("button", {
                          type: "button",
                          class: "ig-btn-primary",
                          onClick: () => openZoneInGraph(z.id),
                        }, "Open in graph"),
                        navigateTo
                          ? h("button", {
                              type: "button",
                              class: "ig-btn-ghost",
                              onClick: () => navigateTo("zones", { zone: z.id }),
                            }, "Zones view")
                          : null,
                      ),
                    ),
                  ),
                ),
              )
            : null,
          zoneFlows.length
            ? h("section", { class: "ig-cross-zone" },
                h("h3", { class: "ig-explore-section-title" }, "Cross-zone imports"),
                h("p", { class: "ig-explore-section-desc" },
                  "Directed counts of internal edges that cross zone boundaries (importer zone → imported zone).",
                ),
                h("div", { class: "ig-table-scroll" },
                  h("table", { class: "ig-table" },
                    h("thead", null,
                      h("tr", null,
                        h("th", null, "From"),
                        h("th", null, "To"),
                        h("th", { class: "ig-th-num" }, "Edges"),
                      ),
                    ),
                    h("tbody", null,
                      ...zoneFlows.map((f) =>
                        h("tr", { key: `${f.fromZone}->${f.toZone}` },
                          h("td", null, zones ? zoneDisplayName(zones, f.fromZone) : f.fromZone),
                          h("td", null, zones ? zoneDisplayName(zones, f.toZone) : f.toZone),
                          h("td", { class: "ig-td-num" }, String(f.count)),
                        ),
                      ),
                    ),
                  ),
                ),
              )
            : null,
          h("section", { class: "ig-explore-files" },
            h("h3", { class: "ig-explore-section-title" }, "All files"),
            h("p", { class: "ig-explore-section-desc" },
              "Click a row to open the file graph centered on that file. Double-click is not needed here.",
            ),
            h("div", { class: "ig-table-scroll ig-table-scroll--tall" },
              h("table", { class: "ig-table" },
                h("thead", null,
                  h("tr", null,
                    h("th", null, "Path"),
                    h("th", null, "Zone"),
                    h("th", { class: "ig-th-num" }, "In"),
                    h("th", { class: "ig-th-num" }, "Out"),
                    h("th", { class: "ig-th-center" }, "Cycle"),
                  ),
                ),
                h("tbody", null,
                  ...exploreRows.slice(0, EXPLORE_ROW_CAP).map((row) =>
                    h("tr", {
                      key: row.path,
                      class: "ig-table-row-click",
                      onClick: () => drillFileToGraph(row.path),
                    },
                      h("td", { class: "ig-td-path", title: row.path }, row.path),
                      h("td", { class: "ig-td-zone" },
                        row.zoneId && zones ? zoneDisplayName(zones, row.zoneId) : "—",
                      ),
                      h("td", { class: "ig-td-num" }, String(row.inD)),
                      h("td", { class: "ig-td-num" }, String(row.outD)),
                      h("td", { class: "ig-td-center" }, row.inCycle ? "Yes" : ""),
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,

    pageTab === "graph"
      ? h("div", { class: "ig-graph-shell", id: "ig-graph-panel", role: "tabpanel", "aria-labelledby": "ig-tab-graph" },
    h("div", { class: "ig-controls" },
    h("div", { class: "ig-toolbar" },
      h("label", null, "Focus",
        h("select", {
          value: mode,
          onChange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value as "file" | "package";
            setMode(v);
            if (v === "file" && !focusFile) setFocusFile(defaultFocusPath(imports));
          },
        },
          h("option", { value: "file" }, "File"),
          h("option", { value: "package" }, "External package"),
        ),
      ),
      mode === "file"
        ? h("label", null, "Depth",
            h("select", {
              value: String(depth),
              onChange: (e: Event) => setDepth(parseInt((e.target as HTMLSelectElement).value, 10) || 2),
            },
              ...DEPTH_OPTIONS.map((d) => h("option", { value: String(d), key: d }, String(d))),
            ),
          )
        : null,
      h("label", null, "Zone",
        h("select", {
          value: zoneFilter,
          onChange: (e: Event) => setZoneFilter((e.target as HTMLSelectElement).value),
        },
          h("option", { value: "" }, "All zones"),
          ...(zones?.zones.map((z) =>
            h("option", { key: z.id, value: z.id }, z.name),
          ) ?? []),
        ),
      ),
      h("label", null,
        h("input", {
          type: "checkbox",
          checked: crossZoneOnly,
          onChange: (e: Event) => setCrossZoneOnly((e.target as HTMLInputElement).checked),
        }),
        "Cross-zone only",
      ),
      h("label", null,
        h("input", {
          type: "checkbox",
          checked: cyclesOnly,
          onChange: (e: Event) => setCyclesOnly((e.target as HTMLInputElement).checked),
        }),
        "Cycle files only",
      ),
    ),

    h("div", { class: "ig-type-toggles" },
      h("span", { class: "ig-type-toggles-label" }, "Edge types"),
      ...allImportTypes().map((t) =>
        h("label", { key: t },
          h("input", {
            type: "checkbox",
            checked: importTypes.has(t),
            onChange: () => toggleImportType(t),
          }),
          t,
        ),
      ),
    ),
    ),

    h("div", { class: "ig-search-wrap" },
      h(SearchFilter, {
        placeholder: "Filter files by path…",
        value: search,
        onInput: setSearch,
        resultCount: filteredFileList.length,
        totalCount: allFiles.length,
      }),
    ),

    h("div", { class: "ig-main" },
      h("div", { class: "ig-graph-column" },
        h("div", { class: "ig-graph-head" },
          h("span", { class: "ig-graph-head-label" },
            mode === "package" ? "Package importers" : "Focused subgraph",
          ),
          mode === "file" && focusFile
            ? h("span", { class: "ig-focus-chip", title: focusFile }, basename(focusFile))
            : mode === "package" && focusPackage
              ? h("span", { class: "ig-focus-chip ig-focus-chip-pkg", title: focusPackage }, focusPackage)
              : null,
        ),
        h("div", { class: "ig-svg-wrap" },
          h("svg", {
            viewBox: `0 0 ${svgW} ${svgH}`,
            preserveAspectRatio: "xMidYMid meet",
            "aria-label": "Focused import graph",
          },
            h("rect", {
              class: "ig-svg-bg",
              x: 0,
              y: 0,
              width: svgW,
              height: svgH,
            }),
            h("defs", null,
              h("marker", {
                id: "ig-arrow",
                viewBox: "0 0 10 8",
                refX: 9,
                refY: 4,
                markerWidth: 8,
                markerHeight: 6,
                orient: "auto",
              }, h("path", { d: "M 0 0 L 10 4 L 0 8 z", fill: "var(--text-muted, #888)" })),
            ),
            h("g", { class: "ig-edges" },
              ...edgePaths.map((ep) =>
                h("path", {
                  key: ep.key,
                  class: `ig-edge${ep.cross ? " ig-edge-cross" : ""}`,
                  d: ep.d,
                  "marker-end": "url(#ig-arrow)",
                }),
              ),
            ),
            h("g", { class: "ig-nodes" },
              ...(layoutNodes ?? []).map((n) => {
                const isCenter = mode === "file" && n.kind === "file" && n.id === focusFile;
                const isSel = n.kind === "file" && selectedFile === n.id;
                const { w, h: hgt } = nodeBox(n.kind);
                const tip =
                  n.kind === "file"
                    ? n.id
                    : n.id.startsWith("pkg:")
                      ? n.id.slice(4)
                      : n.label;
                const labelText = truncateNodeLabel(n.label, n.kind);
                return h("g", {
                  key: n.id,
                  class: `ig-node ig-node-${n.kind}${isCenter ? " ig-node-center" : ""}${isSel ? " ig-node-selected" : ""}`,
                  transform: `translate(${n.x - w / 2},${n.y - hgt / 2})`,
                  title: tip,
                  onClick: (ev: MouseEvent) => {
                    ev.stopPropagation();
                    if (n.kind === "file") handleFileClick(n.id);
                  },
                  onDblClick: (ev: MouseEvent) => {
                    ev.stopPropagation();
                    if (n.kind === "file") handleFileDblClick(n.id);
                  },
                },
                  h("rect", { width: w, height: hgt, rx: 8, ry: 8 }),
                  h(
                    "text",
                    {
                      class: "ig-node-label",
                      x: 12,
                      y: hgt / 2,
                      "dominant-baseline": "middle",
                    },
                    labelText,
                  ),
                );
              }),
            ),
          ),
          packageSubgraph && packageSubgraph.files.length > 48
            ? h("p", { class: "ig-footnote" },
                `Showing 48 of ${packageSubgraph.files.length} importers. Narrow the file list or choose another package.`,
              )
            : null,
        ),
      ),

      h("div", { class: "ig-side" },
        mode === "file"
          ? h("div", { class: "ig-side-section" },
              h("h3", { class: "ig-panel-title" }, "Files"),
              h("p", { class: "ig-panel-desc" }, "Search, then click a path to refocus the graph."),
              h("div", { class: "ig-list" },
                ...filteredFileList.slice(0, 80).map((p) =>
                  h("button", {
                    key: p,
                    type: "button",
                    class: "ig-list-row",
                    title: p,
                    onClick: () => handleFileClick(p),
                  }, p),
                ),
              ),
            )
          : h("div", { class: "ig-side-section" },
              h("h3", { class: "ig-panel-title" }, "External packages"),
              h("p", { class: "ig-panel-desc" }, "Open a package to see who imports it."),
              h("div", { class: "ig-list" },
                ...extList.slice(0, 60).map((ex) =>
                  h("button", {
                    key: ex.package,
                    type: "button",
                    class: "ig-list-row ig-list-row-split",
                    title: `${ex.package} — ${ex.importedBy.length} importer(s)`,
                    onClick: () => {
                      setMode("package");
                      setFocusPackage(ex.package);
                      onSelect({
                        type: "generic",
                        title: ex.package,
                        package: ex.package,
                        importers: ex.importedBy.length,
                      });
                    },
                  },
                    h("span", { class: "ig-list-primary" }, ex.package),
                    h("span", { class: "ig-list-badge" }, String(ex.importedBy.length)),
                  ),
                ),
              ),
            ),

        h("div", { class: "ig-side-section" },
          h("h3", { class: "ig-panel-title" }, "Most imported"),
          h("p", { class: "ig-panel-desc" }, "Hot spots in your module graph."),
          h("div", { class: "ig-list" },
            ...hubList.map((hub) =>
              h("button", {
                key: hub.path,
                type: "button",
                class: "ig-list-row ig-list-row-split",
                title: hub.path,
                onClick: () => handleFileClick(hub.path),
              },
                h("span", { class: "ig-list-primary" }, hub.path),
                h("span", { class: "ig-list-badge" }, String(hub.count)),
              ),
            ),
          ),
        ),

        h("div", { class: "ig-side-section" },
          h("h3", { class: "ig-panel-title" }, "Circular dependencies"),
          h("p", { class: "ig-panel-desc" }, "Jump into a cycle to inspect its files."),
          h("div", { class: "ig-list" },
            ...cycleList.map((c, i) =>
              h("button", {
                key: `c${i}`,
                type: "button",
                class: "ig-list-row",
                onClick: () => {
                  const first = c.cycle[0];
                  if (first) handleFileClick(first);
                },
              }, c.cycle.slice(0, 5).map(basename).join(" → ")),
            ),
          ),
        ),

        h("div", { class: "ig-callout" },
          h("div", { class: "ig-callout-title" }, "Shortcuts"),
          h("p", { class: "ig-callout-body" },
            "Double-click a file node to open it in ",
            h("strong", null, "Files"),
            ". Adjust depth and filters to widen or narrow what you see.",
          ),
        ),
      ),
    ),
    )
      : null,
  );
}

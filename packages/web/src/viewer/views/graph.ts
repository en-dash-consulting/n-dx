/**
 * Import Graph — hybrid focused dependency view (replaces legacy force graph).
 */

import { h } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { LoadedData, DetailItem, NavigateTo } from "../types.js";
import { BrandedHeader } from "../components/index.js";
import { basename } from "../utils.js";
import {
  aggregateDirectedZoneFlows,
  buildFileDegrees,
  collectFilePaths,
  defaultFocusPath,
  defaultFocusPathInZone,
  expandNeighborhood,
  fileToZoneId,
  filterEdgesInBall,
  findExternal,
  isCrossZoneEdge,
  partitionNeighbors,
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

const ZONE_FLOW_CAP = 24;
const DEFAULT_DEPTH = 2;
const CODEBASE_MAP_EXPAND_TOP_PX = 24;
const ACTIVE_ZONE_FILE_CAP = 20;
const ZONE_FILE_NODE_W = 158;
const ZONE_FILE_NODE_H = 58;
const ZONE_EXTERNAL_NODE_W = 124;
const ZONE_EXTERNAL_NODE_H = 48;
const ZONE_DIR_NODE_W = 148;
const ZONE_DIR_NODE_H = 42;
const ZONE_MAP_NODE_W = 150;
const ZONE_MAP_NODE_H = 60;

type FocusSource =
  | { kind: "default" }
  | { kind: "zone"; zoneId: string }
  | { kind: "file"; path: string }
  | { kind: "hub"; path: string }
  | { kind: "package"; packageName: string }
  | { kind: "cycle"; path: string };

/** Readable basename / package label inside SVG boxes (avoid tiny monospace overflow). */
function truncateNodeLabel(label: string, kind: NodeKind, maxOverride?: number): string {
  const max = maxOverride ?? (kind === "package" ? 26 : 22);
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

/**
 * Approx rendered width of an SVG label, em-based. Biased slightly high so we
 * err toward condensing rather than letting a glyph spill past the box edge.
 */
function estTextWidth(text: string, fontPx: number, mono = false): number {
  return text.length * fontPx * (mono ? 0.6 : 0.62);
}

/**
 * SVG attrs that guarantee `text` fits within `maxWidth`. When the natural
 * width already fits, returns {} (render at natural size, no distortion).
 * Otherwise clamps via `textLength` + `spacingAndGlyphs` so the glyphs
 * condense to fit the box exactly — never overflows, never truncates.
 */
function fitToBox(
  text: string,
  fontPx: number,
  maxWidth: number,
  mono = false,
): { textLength?: number; lengthAdjust?: "spacingAndGlyphs" } {
  if (!text || estTextWidth(text, fontPx, mono) <= maxWidth) return {};
  return { textLength: Math.max(8, Math.round(maxWidth)), lengthAdjust: "spacingAndGlyphs" };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function parentContext(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(Math.max(0, parts.length - 3), -1).join("/");
}

function workingDirectory(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 1) return "(root)";
  return parts.slice(0, -1).join("/");
}

/**
 * Coarse clustering key for a path: the package name under `packages/`, else
 * the first one or two leading directory segments. Used to group zones/files
 * into labelled clusters on the maps.
 */
function pathGroupKey(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return "(root)";
  const pkgIdx = parts.indexOf("packages");
  if (pkgIdx >= 0 && parts.length > pkgIdx + 1) return parts[pkgIdx + 1];
  if (parts.length === 1) return "(root)";
  return parts.slice(0, Math.min(2, parts.length - 1)).join("/");
}

/** Dominant {@link pathGroupKey} across a set of files (most frequent wins). */
function dominantGroup(files: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    const k = pathGroupKey(f);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = "";
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN || (n === bestN && k.localeCompare(best) < 0)) { best = k; bestN = n; }
  }
  return best || "(root)";
}

function wrapFileLabel(fileName: string): string[] {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const extension = fileName.startsWith(stem) ? fileName.slice(stem.length) : "";
  const words = stem.split(/[-_]/).filter(Boolean);
  if (fileName.length <= 22 || words.length <= 1) return [fileName];
  const lines: string[] = [""];
  for (const word of words) {
    const current = lines[lines.length - 1];
    if (!current) lines[lines.length - 1] = word;
    else if (`${current}-${word}`.length <= 18) lines[lines.length - 1] = `${current}-${word}`;
    else if (lines.length < 2) lines.push(word);
    else lines[1] = `${lines[1]}-${word}`;
  }
  if (lines.length === 1) return [`${lines[0]}${extension}`];
  lines[1] = `${lines[1]}${extension}`;
  return lines.map((line) => line.length > 34 ? `${line.slice(0, 33)}…` : line);
}

type Viewport = { x: number; y: number; k: number };
type Point = { x: number; y: number };
type SurfaceKind = "codebase" | "zone" | "dep";
type DragState =
  | { kind: "pan"; surface: SurfaceKind; startX: number; startY: number; origin: Viewport }
  | { kind: "zone-node"; id: string; startX: number; startY: number; origin: Point }
  | { kind: "file-node"; path: string; startX: number; startY: number; origin: Point }
  | { kind: "dep-node"; id: string; startX: number; startY: number; origin: Point };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function panViewport(view: Viewport, dx: number, dy: number): Viewport {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

function zoomViewport(view: Viewport, deltaY: number): Viewport {
  return { ...view, k: clamp(view.k * (deltaY < 0 ? 1.12 : 0.88), 0.55, 2.6) };
}

function wheelViewport(view: Viewport, event: WheelEvent): Viewport {
  if (event.ctrlKey || event.metaKey) return zoomViewport(view, event.deltaY);
  return panViewport(view, -event.deltaX, -event.deltaY);
}

// Bounded zoom for the Codebase/Zone maps — not an infinite canvas.
const MAP_ZOOM_MIN = 0.8;
const MAP_ZOOM_MAX = 4;

/** Clamp zoom and keep the content from drifting fully off the canvas. */
function clampMapView(view: Viewport, vbW: number, vbH: number): Viewport {
  const k = clamp(view.k, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  const x = clamp(view.x, vbW * 0.2 - k * vbW, vbW * 0.8);
  const y = clamp(view.y, vbH * 0.2 - k * vbH, vbH * 0.8);
  return { x, y, k };
}

/**
 * Zoom `view` to absolute scale `kTarget` while keeping the point under the
 * cursor/pinch focus fixed on screen. `cx,cy` are client coords; the SVG's
 * screen CTM maps them into user space (handles viewBox + preserveAspectRatio).
 */
function zoomMapToFocal(
  view: Viewport,
  kTarget: number,
  cx: number,
  cy: number,
  svg: SVGSVGElement,
): Viewport {
  const vb = svg.viewBox.baseVal;
  const kNew = clamp(kTarget, MAP_ZOOM_MIN, MAP_ZOOM_MAX);
  const ctm = svg.getScreenCTM();
  if (!ctm) return clampMapView({ ...view, k: kNew }, vb.width, vb.height);
  const loc = new DOMPoint(cx, cy).matrixTransform(ctm.inverse());
  const scale = kNew / view.k;
  return clampMapView(
    { x: loc.x - scale * (loc.x - view.x), y: loc.y - scale * (loc.y - view.y), k: kNew },
    vb.width,
    vb.height,
  );
}

function offsetFromDrag(dx: number, dy: number, view: Viewport): Point {
  return { x: dx / view.k, y: dy / view.k };
}

/**
 * Deterministic grouped grid/shelf pack for the Codebase Map.
 *
 * Zones are grouped by package/area, each group laid out as a compact grid
 * block, and the blocks shelf-packed left→right (wrapping to new rows). Cells
 * are fixed-size so nodes **cannot** overlap — no force simulation. Returns
 * the content size so the caller can size the SVG viewBox to fit.
 */
function layoutZoneMapNodes<T extends { id: string; n: number; group?: string }>(
  zones: T[],
  flows: { fromZone: string; toZone: string; count: number }[],
  statsFor: (id: string) => { in: number; out: number },
  w: number,
): {
  nodes: Array<T & { x: number; y: number; r: number; stats: { in: number; out: number } }>;
  width: number;
  height: number;
} {
  if (!zones.length) return { nodes: [], width: w, height: 220 };

  // Importance = file count + cross-zone traffic; orders groups and members.
  const strength = new Map<string, number>();
  for (const z of zones) strength.set(z.id, z.n);
  for (const f of flows) {
    strength.set(f.fromZone, (strength.get(f.fromZone) ?? 0) + f.count * 2);
    strength.set(f.toZone, (strength.get(f.toZone) ?? 0) + f.count * 2);
  }
  const groupOf = (z: T): string => z.group ?? z.id;

  const groups = new Map<string, T[]>();
  for (const z of zones) {
    const g = groupOf(z);
    const arr = groups.get(g);
    if (arr) arr.push(z);
    else groups.set(g, [z]);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => (strength.get(b.id) ?? 0) - (strength.get(a.id) ?? 0) || a.id.localeCompare(b.id));
  }
  const groupSum = (k: string) => groups.get(k)!.reduce((s, z) => s + (strength.get(z.id) ?? 0), 0);
  const groupKeys = [...groups.keys()].sort((a, b) => groupSum(b) - groupSum(a) || a.localeCompare(b));

  const W = ZONE_MAP_NODE_W;
  const H = ZONE_MAP_NODE_H;
  const CELL_GX = 22; // gap between zones inside a group
  const CELL_GY = 24;
  const GROUP_GX = 56; // gap between group blocks on a shelf
  const GROUP_GY = 72; // gap between shelf rows
  const MARGIN = 30;
  const avail = Math.max(W, w - 2 * MARGIN);
  const maxCols = Math.max(1, Math.floor((avail + CELL_GX) / (W + CELL_GX)));

  interface Block { key: string; zones: T[]; cols: number; bw: number; bh: number }
  const blocks: Block[] = groupKeys.map((key) => {
    const zs = groups.get(key)!;
    const count = zs.length;
    const cols = Math.min(count, maxCols, Math.max(1, Math.round(Math.sqrt(count * 1.6))));
    const rows = Math.ceil(count / cols);
    return {
      key,
      zones: zs,
      cols,
      bw: cols * W + (cols - 1) * CELL_GX,
      bh: rows * H + (rows - 1) * CELL_GY,
    };
  });

  interface Shelf { items: Block[]; width: number; height: number }
  const shelves: Shelf[] = [];
  let cur: Shelf = { items: [], width: 0, height: 0 };
  for (const b of blocks) {
    const addW = (cur.items.length ? GROUP_GX : 0) + b.bw;
    if (cur.items.length && cur.width + addW > avail) {
      shelves.push(cur);
      cur = { items: [], width: 0, height: 0 };
    }
    cur.width += (cur.items.length ? GROUP_GX : 0) + b.bw;
    cur.height = Math.max(cur.height, b.bh);
    cur.items.push(b);
  }
  if (cur.items.length) shelves.push(cur);

  const contentW = Math.max(W, ...shelves.map((s) => s.width));
  const contentH = shelves.reduce((s, sh) => s + sh.height, 0) + Math.max(0, shelves.length - 1) * GROUP_GY;
  const width = Math.max(w, contentW + 2 * MARGIN);
  const height = Math.max(220, contentH + 2 * MARGIN);

  const nodes: Array<T & { x: number; y: number; r: number; stats: { in: number; out: number } }> = [];
  let y0 = MARGIN;
  for (const sh of shelves) {
    let x0 = (width - sh.width) / 2; // center the shelf
    for (const b of sh.items) {
      const by = y0 + (sh.height - b.bh) / 2; // center block within shelf
      b.zones.forEach((z, idx) => {
        const c = idx % b.cols;
        const r = Math.floor(idx / b.cols);
        const inRow = Math.min(b.cols, b.zones.length - r * b.cols);
        const rowW = inRow * W + (inRow - 1) * CELL_GX;
        const rx0 = x0 + (b.bw - rowW) / 2; // center a partial last row
        nodes.push({
          ...z,
          x: rx0 + c * (W + CELL_GX) + W / 2,
          y: by + r * (H + CELL_GY) + H / 2,
          r: Math.max(18, Math.min(44, 16 + Math.sqrt(z.n) * 5)),
          stats: statsFor(z.id),
        });
      });
      x0 += b.bw + GROUP_GX;
    }
    y0 += sh.height + GROUP_GY;
  }
  return { nodes, width, height };
}

export function Graph({ data, selectedFile, selectedZone, navigateTo }: GraphProps) {
  const { imports, zones, inventory } = data;
  const pageRef = useRef<HTMLDivElement | null>(null);
  const graphPanelRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNodeClickRef = useRef(false);

  const [mode, setMode] = useState<"file" | "package">("file");
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [focusPackage, setFocusPackage] = useState<string | null>(null);
  const [focusSource, setFocusSource] = useState<FocusSource>({ kind: "default" });
  const [zoneFilter, setZoneFilter] = useState<string>("");
  const [streetViewMode, setStreetViewMode] = useState<"closed" | "preview" | "dialog">("closed");
  const [codebaseMapExpanded, setCodebaseMapExpanded] = useState(false);
  const [codebaseView, setCodebaseView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [zoneView, setZoneView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [depView, setDepView] = useState<Viewport>({ x: 0, y: 0, k: 1 });
  const [zoneNodeOffsets, setZoneNodeOffsets] = useState<Record<string, Point>>({});
  const [fileNodeOffsets, setFileNodeOffsets] = useState<Record<string, Point>>({});
  const [depNodeOffsets, setDepNodeOffsets] = useState<Record<string, Point>>({});
  const [hoverPreviewFile, setHoverPreviewFile] = useState<string | null>(null);
  const [hoverPreviewSide, setHoverPreviewSide] = useState<"left" | "right">("right");
  const [hoverExternalZoneId, setHoverExternalZoneId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [focusHistory, setFocusHistory] = useState<string[]>([]);
  const [focusHistoryIndex, setFocusHistoryIndex] = useState(-1);

  useEffect(() => () => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
  }, []);

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
      setFocusSource({ kind: "file", path: selectedFile });
    }
  }, [selectedFile]);

  useEffect(() => {
    if (selectedZone && zones?.zones.some((z) => z.id === selectedZone)) {
      setCodebaseMapExpanded(false);
      setZoneFilter(selectedZone);
    }
  }, [selectedZone, zones]);

  // Escape is a hierarchical "back": first close the File Street View modal;
  // if it isn't open, deselect the zone and scroll back up to the map.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (streetViewMode === "dialog") {
        setStreetViewMode("closed");
        setHoverPreviewFile(null);
        return;
      }
      if (zoneFilter) {
        setZoneFilter("");
        setFocusSource({ kind: "default" });
        setCodebaseMapExpanded(false);
        setHoverPreviewFile(null);
        requestAnimationFrame(() => {
          const scroller = pageRef.current?.closest(".main") as HTMLElement | null;
          if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" });
          else heroRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [streetViewMode, zoneFilter]);

  // Click outside the File Street View shell closes it, mirroring the Escape
  // shortcut. The dialog already fills the main content area, so anywhere
  // outside graphPanelRef (sidebar, breadcrumb bar, detail panel) is "outside".
  useEffect(() => {
    if (streetViewMode !== "dialog") return;
    const onDown = (event: MouseEvent) => {
      const panel = graphPanelRef.current;
      if (!panel) return;
      const target = event.target as Node | null;
      if (target && panel.contains(target)) return;
      setStreetViewMode("closed");
      setHoverPreviewFile(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [streetViewMode]);

  const subgraph = useMemo(() => {
    if (!imports || !focusFile || mode !== "file") return null;
    let ball = expandNeighborhood(focusFile, imports, DEFAULT_DEPTH);
    const edges = filterEdgesInBall(ball, imports, {
      importTypes: null,
      crossZoneOnly: false,
      cyclesOnly: false,
      zones,
    });
    const { predecessors, successors } = partitionNeighbors(focusFile, ball, edges);
    const layout = layoutFocusedGraph({
      centerPath: focusFile,
      predecessors,
      successors,
    });
    return { ball, edges, layout };
  }, [imports, focusFile, mode, zones]);

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

  useEffect(() => {
    setDepView({ x: 0, y: 0, k: 1 });
    setDepNodeOffsets({});
  }, [focusFile, focusPackage, mode, streetViewMode]);

  useEffect(() => {
    if (!focusFile || focusHistory.length) return;
    setFocusHistory([focusFile]);
    setFocusHistoryIndex(0);
  }, [focusFile, focusHistory.length]);

  const rememberFocusFile = useCallback((path: string) => {
    setFocusHistory((prev) => {
      const current = focusHistoryIndex >= 0 ? prev[focusHistoryIndex] : null;
      if (current === path) return prev;
      const base = focusHistoryIndex >= 0 ? prev.slice(0, focusHistoryIndex + 1) : [];
      const next = [...base, path].slice(-24);
      setFocusHistoryIndex(next.length - 1);
      return next;
    });
  }, [focusHistoryIndex]);

  const handleFileClick = useCallback(
    (path: string, source: FocusSource = { kind: "file", path }) => {
      setMode("file");
      setFocusFile(path);
      setFocusSource(source);
      setHoverPreviewFile(null);
      setStreetViewMode("dialog");
      rememberFocusFile(path);
      if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    },
    [rememberFocusFile],
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

  const zoneCards = useMemo(() => {
    if (!zones) return [];
    return [...zones.zones]
      .map((z) => ({ id: z.id, name: z.name, n: z.files.length, group: dominantGroup(z.files) }))
      .sort((a, b) => b.n - a.n);
  }, [zones]);

  const openZoneInGraph = useCallback(
    (zoneId: string) => {
      if (!imports || !zones) return;
      const p = defaultFocusPathInZone(imports, zoneId, zones);
      if (!p) return;
      setZoneFilter(zoneId);
      setMode("file");
      setFocusFile(p);
      setFocusSource({ kind: "zone", zoneId });
      setFocusHistory([p]);
      setFocusHistoryIndex(0);
      setHoverPreviewFile(null);
      setCodebaseMapExpanded(false);
      setStreetViewMode("closed");
      requestAnimationFrame(() => {
        const scrollIntoView = heroRef.current?.scrollIntoView;
        if (typeof scrollIntoView === "function") scrollIntoView.call(heroRef.current, { behavior: "smooth", block: "nearest" });
      });
    },
    [imports, zones],
  );

  const drillFileToGraph = useCallback(
    (path: string, source: FocusSource = { kind: "file", path }) => {
      handleFileClick(path, source);
    },
    [handleFileClick],
  );

  const moveFocusHistory = useCallback((direction: -1 | 1) => {
    setFocusHistoryIndex((current) => {
      const next = current + direction;
      if (next < 0 || next >= focusHistory.length) return current;
      const path = focusHistory[next];
      setMode("file");
      setFocusFile(path);
      setFocusSource({ kind: "file", path });
      setHoverPreviewFile(null);
      setStreetViewMode("dialog");
      if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
      return next;
    });
  }, [focusHistory]);

  const updateSurfaceView = useCallback((surface: SurfaceKind, updater: (view: Viewport) => Viewport) => {
    if (surface === "codebase") setCodebaseView(updater);
    else if (surface === "zone") setZoneView(updater);
    else setDepView(updater);
  }, []);

  const viewFor = useCallback((surface: SurfaceKind) => {
    if (surface === "codebase") return codebaseView;
    if (surface === "zone") return zoneView;
    return depView;
  }, [codebaseView, zoneView, depView]);

  const beginPan = useCallback((surface: SurfaceKind, event: PointerEvent) => {
    if (event.button !== 0) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setDragState({ kind: "pan", surface, startX: event.clientX, startY: event.clientY, origin: viewFor(surface) });
  }, [viewFor]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!dragState) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.hypot(dx, dy) > 4) suppressNodeClickRef.current = true;
    if (dragState.kind === "pan") {
      updateSurfaceView(dragState.surface, () => panViewport(dragState.origin, dx, dy));
      return;
    }
    if (dragState.kind === "zone-node") {
      const next = offsetFromDrag(dx, dy, codebaseView);
      setZoneNodeOffsets((prev) => ({ ...prev, [dragState.id]: { x: dragState.origin.x + next.x, y: dragState.origin.y + next.y } }));
      return;
    }
    if (dragState.kind === "file-node") {
      const next = offsetFromDrag(dx, dy, zoneView);
      setFileNodeOffsets((prev) => ({ ...prev, [dragState.path]: { x: dragState.origin.x + next.x, y: dragState.origin.y + next.y } }));
      return;
    }
    const next = offsetFromDrag(dx, dy, depView);
    setDepNodeOffsets((prev) => ({ ...prev, [dragState.id]: { x: dragState.origin.x + next.x, y: dragState.origin.y + next.y } }));
  }, [codebaseView, depView, dragState, updateSurfaceView, zoneView]);

  const endDrag = useCallback(() => setDragState(null), []);

  // ── Canvas zoom: wheel (trackpad pinch === ctrl/meta wheel) + touch pinch ──
  const pinchRef = useRef<{ surface: SurfaceKind; startDist: number; startK: number } | null>(null);

  const touchDistance = (touches: TouchList): number =>
    touches.length < 2
      ? 0
      : Math.hypot(
          touches[0].clientX - touches[1].clientX,
          touches[0].clientY - touches[1].clientY,
        );

  const touchMidpoint = (touches: TouchList): { x: number; y: number } => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
  });

  const handleSurfaceWheel = useCallback((surface: SurfaceKind, event: WheelEvent) => {
    event.preventDefault();
    const svg = event.currentTarget as SVGSVGElement;
    const cx = event.clientX;
    const cy = event.clientY;
    if (event.ctrlKey || event.metaKey) {
      // Trackpad pinch / explicit zoom — anchor at the cursor.
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      updateSurfaceView(surface, (view) => zoomMapToFocal(view, view.k * factor, cx, cy, svg));
    } else {
      const vb = svg.viewBox.baseVal;
      updateSurfaceView(surface, (view) =>
        clampMapView(panViewport(view, -event.deltaX, -event.deltaY), vb.width, vb.height),
      );
    }
  }, [updateSurfaceView]);

  const beginPinch = useCallback((surface: SurfaceKind, event: TouchEvent) => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    pinchRef.current = { surface, startDist: touchDistance(event.touches) || 1, startK: viewFor(surface).k };
  }, [viewFor]);

  const movePinch = useCallback((event: TouchEvent) => {
    const p = pinchRef.current;
    if (!p || event.touches.length !== 2) return;
    event.preventDefault();
    const svg = event.currentTarget as SVGSVGElement;
    const mid = touchMidpoint(event.touches);
    // Dampen the pinch: trackpad finger-spread covers a big distance ratio
    // for a small physical gesture, so applying it raw makes zoom whippy.
    // Math.pow(ratio, 0.6) turns a 2× spread into ~1.52× zoom while keeping
    // the gesture symmetric (1/ratio for pinch-in maps cleanly).
    const rawRatio = touchDistance(event.touches) / p.startDist;
    const dampenedRatio = Math.pow(rawRatio, 0.6);
    updateSurfaceView(p.surface, (view) => zoomMapToFocal(view, p.startK * dampenedRatio, mid.x, mid.y, svg));
  }, [updateSurfaceView]);

  const endPinch = useCallback(() => { pinchRef.current = null; }, []);

  const openHoverPreview = useCallback((path: string, side: "left" | "right" = "right") => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    setHoverPreviewFile(path);
    setHoverPreviewSide(side);
    // When the street view is pinned open (dialog), hovering another node must
    // NOT hijack it. Only highlight the hovered node + show the "click to open"
    // hint; the selected file stays in the street view until the user clicks.
    if (streetViewMode === "dialog") return;
    setMode("file");
    setFocusFile(path);
    setFocusSource({ kind: "file", path });
    setStreetViewMode("preview");
  }, [streetViewMode]);

  const closeHoverPreview = useCallback((path: string) => {
    if (hoverCloseTimerRef.current) clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = setTimeout(() => {
      setHoverPreviewFile((current) => {
        if (current !== path) return current;
        setStreetViewMode((mode) => mode === "preview" ? "closed" : mode);
        return null;
      });
    }, 120);
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
  const focusInv = focusFile ? inventoryMap.get(focusFile) : undefined;
  const focusZoneId = focusFile ? fileToZoneId(focusFile, zones) : null;
  const focusZoneName = focusZoneId && zones ? zones.zones.find((z) => z.id === focusZoneId)?.name : undefined;
  const focusPackageImporters = focusPackage ? findExternal(imports, focusPackage)?.importedBy.length ?? 0 : 0;
  const activeZoneName = zoneFilter && zones ? zoneDisplayName(zones, zoneFilter) : null;
  const activeZone = zoneFilter && zones ? zones.zones.find((z) => z.id === zoneFilter) : null;
  const activeZoneFiles = activeZone ? new Set(activeZone.files) : null;
  const activeZoneNetworkW = 980;
  const activeZoneNetworkH = 640;
  const activeZoneBoundaryByFile = new Map<string, { incoming: string[]; outgoing: string[] }>();
  const activeZoneBoundaryLinks: {
    edge: (typeof imports.edges)[number];
    filePath: string;
    externalZoneId: string;
    externalZoneName: string;
    direction: "incoming" | "outgoing";
  }[] = [];
  if (activeZoneFiles && zones) {
    for (const edge of imports.edges) {
      const fromInside = activeZoneFiles.has(edge.from);
      const toInside = activeZoneFiles.has(edge.to);
      if (fromInside === toInside) continue;
      const path = fromInside ? edge.from : edge.to;
      const entry = activeZoneBoundaryByFile.get(path) ?? { incoming: [], outgoing: [] };
      if (fromInside) {
        const toZone = fileToZoneId(edge.to, zones);
        if (toZone) {
          const name = zoneDisplayName(zones, toZone);
          entry.outgoing.push(name);
          activeZoneBoundaryLinks.push({ edge, filePath: path, externalZoneId: toZone, externalZoneName: name, direction: "outgoing" });
        }
      } else {
        const fromZone = fileToZoneId(edge.from, zones);
        if (fromZone) {
          const name = zoneDisplayName(zones, fromZone);
          entry.incoming.push(name);
          activeZoneBoundaryLinks.push({ edge, filePath: path, externalZoneId: fromZone, externalZoneName: name, direction: "incoming" });
        }
      }
      activeZoneBoundaryByFile.set(path, entry);
    }
  }
  const boundaryLinkCountByFile = new Map<string, number>();
  const boundaryLinkCountByZone = new Map<string, number>();
  for (const link of activeZoneBoundaryLinks) {
    boundaryLinkCountByFile.set(link.filePath, (boundaryLinkCountByFile.get(link.filePath) ?? 0) + 1);
    boundaryLinkCountByZone.set(link.externalZoneId, (boundaryLinkCountByZone.get(link.externalZoneId) ?? 0) + 1);
  }
  const activeZoneFileRank = activeZone
    ? [...activeZone.files].sort((a, b) =>
        (boundaryLinkCountByFile.get(b) ?? 0) - (boundaryLinkCountByFile.get(a) ?? 0) ||
        (inDegree.get(b) ?? 0) + (outDegree.get(b) ?? 0) - ((inDegree.get(a) ?? 0) + (outDegree.get(a) ?? 0)) ||
        a.localeCompare(b),
      )
    : [];
  const activeZoneVisibleFiles: string[] = [];
  const activeZoneVisibleSet = new Set<string>();
  const addActiveZoneFile = (path: string) => {
    if (activeZoneVisibleSet.has(path) || activeZoneVisibleFiles.length >= ACTIVE_ZONE_FILE_CAP) return;
    activeZoneVisibleSet.add(path);
    activeZoneVisibleFiles.push(path);
  };
  const externalZonesByTraffic = [...boundaryLinkCountByZone.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [externalZoneId] of externalZonesByTraffic) {
    const bestLink = activeZoneBoundaryLinks
      .filter((link) => link.externalZoneId === externalZoneId)
      .sort((a, b) =>
        (boundaryLinkCountByFile.get(b.filePath) ?? 0) - (boundaryLinkCountByFile.get(a.filePath) ?? 0) ||
        activeZoneFileRank.indexOf(a.filePath) - activeZoneFileRank.indexOf(b.filePath),
      )[0];
    if (bestLink) addActiveZoneFile(bestLink.filePath);
  }
  for (const path of activeZoneFileRank) addActiveZoneFile(path);
  const visibleBoundaryLinks = activeZoneBoundaryLinks.filter((link) => activeZoneVisibleSet.has(link.filePath));
  const activeZoneConnectionFocus = streetViewMode === "dialog" && focusFile && activeZoneVisibleSet.has(focusFile)
    ? focusFile
    : null;
  const hoveredZoneFile = hoverPreviewFile && activeZoneVisibleSet.has(hoverPreviewFile)
    ? hoverPreviewFile
    : null;
  const activeZoneRouteFocus = hoveredZoneFile ?? activeZoneConnectionFocus;
  const activeZoneLayoutFocus = activeZoneConnectionFocus;
  const routeFocusLinks = activeZoneRouteFocus
    ? visibleBoundaryLinks.filter((link) => link.filePath === activeZoneRouteFocus).slice(0, 8)
    : [];
  const externalFocusLinks = hoverExternalZoneId
    ? visibleBoundaryLinks.filter((link) => link.externalZoneId === hoverExternalZoneId).slice(0, 12)
    : [];
  const layoutFocusLinks = activeZoneLayoutFocus
    ? visibleBoundaryLinks.filter((link) => link.filePath === activeZoneLayoutFocus).slice(0, 8)
    : [];
  const routeFocusFileEdges = activeZoneRouteFocus
    ? imports.edges.filter((e) => activeZoneVisibleSet.has(e.from) && activeZoneVisibleSet.has(e.to) && (e.from === activeZoneRouteFocus || e.to === activeZoneRouteFocus))
    : [];
  const activeZoneRouteFileEdges = routeFocusFileEdges;
  const activeZoneRouteFileSet = new Set(activeZoneRouteFileEdges.flatMap((edge) => [edge.from, edge.to]));
  const activeZoneRouteLinkSet = new Set(routeFocusLinks.map((link) => `${link.edge.from}->${link.edge.to}:${link.edge.type}`));
  const activeZoneExternalRouteLinkSet = new Set(externalFocusLinks.map((link) => `${link.edge.from}->${link.edge.to}:${link.edge.type}`));
  const activeZoneRouteNodeSet = new Set<string>([
    ...(activeZoneRouteFocus ? [activeZoneRouteFocus] : []),
    ...activeZoneRouteFileSet,
    ...routeFocusLinks.map((link) => link.filePath),
    ...externalFocusLinks.map((link) => link.filePath),
  ]);
  const mapHasRouteFocus = activeZoneRouteNodeSet.size > 0 || activeZoneRouteLinkSet.size > 0 || activeZoneExternalRouteLinkSet.size > 0;
  const activeZoneFocusNode = activeZoneRouteFocus ?? (focusFile && activeZoneVisibleSet.has(focusFile)
      ? focusFile
      : null);
  const representativeBoundaryLinks = [...visibleBoundaryLinks]
    .sort((a, b) =>
      (boundaryLinkCountByZone.get(b.externalZoneId) ?? 0) - (boundaryLinkCountByZone.get(a.externalZoneId) ?? 0) ||
      (boundaryLinkCountByFile.get(b.filePath) ?? 0) - (boundaryLinkCountByFile.get(a.filePath) ?? 0) ||
      a.filePath.localeCompare(b.filePath),
    )
    .filter((link, index, links) =>
      links.findIndex((candidate) => candidate.externalZoneId === link.externalZoneId && candidate.direction === link.direction) === index,
    );
  const boundaryLinksForMap = hoverExternalZoneId ? externalFocusLinks : routeFocusLinks;
  const boundaryLinksForLayout = [
    ...representativeBoundaryLinks.slice(0, 8),
    ...layoutFocusLinks,
  ].filter((link, index, links) => links.findIndex((candidate) => candidate.edge === link.edge) === index);
  const activeZoneExternalStats = new Map<string, { name: string; fromExternal: number; toExternal: number }>();
  for (const link of boundaryLinksForLayout) {
    const stat = activeZoneExternalStats.get(link.externalZoneId) ?? { name: link.externalZoneName, fromExternal: 0, toExternal: 0 };
    if (link.direction === "incoming") stat.fromExternal += 1;
    else stat.toExternal += 1;
    activeZoneExternalStats.set(link.externalZoneId, stat);
  }
  const activeZoneOrderedFiles = [...activeZoneVisibleFiles].sort((a, b) =>
    (boundaryLinkCountByFile.get(b) ?? 0) - (boundaryLinkCountByFile.get(a) ?? 0) ||
    (inDegree.get(b) ?? 0) + (outDegree.get(b) ?? 0) - ((inDegree.get(a) ?? 0) + (outDegree.get(a) ?? 0)) ||
    a.localeCompare(b),
  );
  const activeZoneDirectoryGroups = activeZone
    ? [...activeZone.files]
        .filter((path) => !activeZoneVisibleSet.has(path))
        .reduce((groups, path) => {
          const dir = workingDirectory(path);
          const entry = groups.get(dir) ?? { id: `dir:${dir}`, dir, count: 0 };
          entry.count += 1;
          groups.set(dir, entry);
          return groups;
        }, new Map<string, { id: string; dir: string; count: number }>())
    : new Map<string, { id: string; dir: string; count: number }>();
  // Seed files in directory clusters: the highest-signal file anchors the
  // centre as the entry point, and every other file starts near its
  // subdirectory's anchor so the network resolves into readable groups
  // instead of one uniform ring. The existing physics pass below refines it.
  const azFileGroup = (p: string) => workingDirectory(p);
  const azGroupSignal = new Map<string, number>();
  for (const p of activeZoneOrderedFiles) {
    azGroupSignal.set(azFileGroup(p), (azGroupSignal.get(azFileGroup(p)) ?? 0) + 1 + ((inDegree.get(p) ?? 0) + (outDegree.get(p) ?? 0)));
  }
  const azGroupOrder = [...azGroupSignal.keys()].sort(
    (a, b) => (azGroupSignal.get(b) ?? 0) - (azGroupSignal.get(a) ?? 0) || a.localeCompare(b),
  );
  const azGroupAnchor = new Map<string, { x: number; y: number }>();
  azGroupOrder.forEach((g, gi) => {
    const ring = Math.max(1, azGroupOrder.length);
    const angle = -Math.PI / 2 + (gi / ring) * Math.PI * 2;
    const spread = azGroupOrder.length === 1 ? 0 : 0.30;
    azGroupAnchor.set(g, {
      x: activeZoneNetworkW / 2 + Math.cos(angle) * activeZoneNetworkW * spread,
      y: activeZoneNetworkH / 2 + Math.sin(angle) * activeZoneNetworkH * spread * 0.78,
    });
  });
  const azGroupSeed = new Map<string, number>();
  const activeZoneNetworkNodesBase = activeZoneOrderedFiles.map((path, i) => {
    if (i === 0) {
      return {
        path,
        x: activeZoneNetworkW / 2,
        y: activeZoneNetworkH / 2,
        degree: (inDegree.get(path) ?? 0) + (outDegree.get(path) ?? 0),
      };
    }
    const g = azFileGroup(path);
    const anchor = azGroupAnchor.get(g) ?? { x: activeZoneNetworkW / 2, y: activeZoneNetworkH / 2 };
    const k = azGroupSeed.get(g) ?? 0;
    azGroupSeed.set(g, k + 1);
    const a = k * 2.399;
    const rad = 14 + k * 22;
    return {
      path,
      x: anchor.x + Math.cos(a) * rad,
      y: anchor.y + Math.sin(a) * rad * 0.72,
      degree: (inDegree.get(path) ?? 0) + (outDegree.get(path) ?? 0),
    };
  });
  const activeZoneDirectoryNodesBase = [...activeZoneDirectoryGroups.values()]
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir))
    .slice(0, 10)
    .map((group, i, arr) => {
      const angle = Math.PI / 2 + (i / Math.max(1, arr.length)) * Math.PI * 2;
      return {
        ...group,
        x: activeZoneNetworkW / 2 + Math.cos(angle) * activeZoneNetworkW * 0.31,
        y: activeZoneNetworkH / 2 + Math.sin(angle) * activeZoneNetworkH * 0.28,
      };
    });
  const activeZoneNetworkNodeBaseByPath = new Map(activeZoneNetworkNodesBase.map((n) => [n.path, n]));
  const activeZoneExternalNodesBase = [...activeZoneExternalStats.entries()]
    .sort((a, b) => b[1].fromExternal + b[1].toExternal - (a[1].fromExternal + a[1].toExternal) || a[1].name.localeCompare(b[1].name))
    .slice(0, 8)
    .map(([id, stat], i, arr) => {
      const connected = visibleBoundaryLinks
        .filter((link) => link.externalZoneId === id)
        .map((link) => activeZoneNetworkNodeBaseByPath.get(link.filePath))
        .filter((node): node is NonNullable<typeof node> => node !== undefined);
      const centroid = connected.length
        ? {
            x: connected.reduce((sum, node) => sum + node.x, 0) / connected.length,
            y: connected.reduce((sum, node) => sum + node.y, 0) / connected.length,
          }
        : { x: activeZoneNetworkW / 2, y: activeZoneNetworkH / 2 };
      const dx = centroid.x - activeZoneNetworkW / 2;
      const dy = centroid.y - activeZoneNetworkH / 2;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const fallbackAngle = -Math.PI / 2 + (i / Math.max(1, arr.length)) * Math.PI * 2;
      return {
        id,
        name: stat.name,
        fromExternal: stat.fromExternal,
        toExternal: stat.toExternal,
        x: activeZoneNetworkW / 2 + (connected.length ? dx / dist : Math.cos(fallbackAngle)) * activeZoneNetworkW * 0.44,
        y: activeZoneNetworkH / 2 + (connected.length ? dy / dist : Math.sin(fallbackAngle)) * activeZoneNetworkH * 0.40,
      };
    });
  for (let iter = 0; iter < 90; iter += 1) {
    const allNodes = [
      ...activeZoneNetworkNodesBase.map((node) => ({ node, r: Math.hypot(ZONE_FILE_NODE_W, ZONE_FILE_NODE_H) / 2, external: false })),
      ...activeZoneDirectoryNodesBase.map((node) => ({ node, r: Math.hypot(ZONE_DIR_NODE_W, ZONE_DIR_NODE_H) / 2, external: false })),
      ...activeZoneExternalNodesBase.map((node) => ({ node, r: Math.hypot(ZONE_EXTERNAL_NODE_W, ZONE_EXTERNAL_NODE_H) / 2, external: true })),
    ] as Array<{ node: { x: number; y: number }; r: number; external: boolean }>;
    for (let i = 0; i < allNodes.length; i += 1) {
      for (let j = i + 1; j < allNodes.length; j += 1) {
        const a = allNodes[i];
        const b = allNodes[j];
        const dx = b.node.x - a.node.x || 0.1;
        const dy = b.node.y - a.node.y || 0.1;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const minDist = a.r + b.r + (a.external || b.external ? 34 : 24);
        if (dist >= minDist) continue;
        const push = (minDist - dist) / dist / 2;
        a.node.x -= dx * push;
        a.node.y -= dy * push;
        b.node.x += dx * push;
        b.node.y += dy * push;
      }
    }
    for (const edge of imports.edges.filter((e) => activeZoneVisibleSet.has(e.from) && activeZoneVisibleSet.has(e.to))) {
      const from = activeZoneNetworkNodeBaseByPath.get(edge.from);
      const to = activeZoneNetworkNodeBaseByPath.get(edge.to);
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      from.x += dx * 0.004;
      from.y += dy * 0.004;
      to.x -= dx * 0.004;
      to.y -= dy * 0.004;
    }
    const externalById = new Map(activeZoneExternalNodesBase.map((node) => [node.id, node]));
    for (const link of boundaryLinksForLayout) {
      const fileNode = activeZoneNetworkNodeBaseByPath.get(link.filePath);
      const zoneNode = externalById.get(link.externalZoneId);
      if (!fileNode || !zoneNode) continue;
      const dx = zoneNode.x - fileNode.x;
      const dy = zoneNode.y - fileNode.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const target = 190;
      const pull = (dist - target) / dist * 0.01;
      fileNode.x += dx * pull;
      fileNode.y += dy * pull;
      zoneNode.x -= dx * pull;
      zoneNode.y -= dy * pull;
    }
    for (const node of activeZoneNetworkNodesBase) {
      node.x += (activeZoneNetworkW / 2 - node.x) * 0.002;
      node.y += (activeZoneNetworkH / 2 - node.y) * 0.002;
      node.x = clamp(node.x, ZONE_FILE_NODE_W / 2 + 14, activeZoneNetworkW - ZONE_FILE_NODE_W / 2 - 14);
      node.y = clamp(node.y, ZONE_FILE_NODE_H / 2 + 18, activeZoneNetworkH - ZONE_FILE_NODE_H / 2 - 26);
    }
    for (const node of activeZoneDirectoryNodesBase) {
      node.x += (activeZoneNetworkW / 2 - node.x) * 0.0015;
      node.y += (activeZoneNetworkH / 2 - node.y) * 0.0015;
      node.x = clamp(node.x, ZONE_DIR_NODE_W / 2 + 14, activeZoneNetworkW - ZONE_DIR_NODE_W / 2 - 14);
      node.y = clamp(node.y, ZONE_DIR_NODE_H / 2 + 18, activeZoneNetworkH - ZONE_DIR_NODE_H / 2 - 26);
    }
    for (const node of activeZoneExternalNodesBase) {
      const dx = node.x - activeZoneNetworkW / 2 || 0.1;
      const dy = node.y - activeZoneNetworkH / 2 || 0.1;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const targetX = activeZoneNetworkW / 2 + (dx / dist) * activeZoneNetworkW * 0.46;
      const targetY = activeZoneNetworkH / 2 + (dy / dist) * activeZoneNetworkH * 0.41;
      node.x += (targetX - node.x) * 0.018;
      node.y += (targetY - node.y) * 0.018;
      node.x = clamp(node.x, ZONE_EXTERNAL_NODE_W / 2 + 16, activeZoneNetworkW - ZONE_EXTERNAL_NODE_W / 2 - 16);
      node.y = clamp(node.y, ZONE_EXTERNAL_NODE_H / 2 + 16, activeZoneNetworkH - ZONE_EXTERNAL_NODE_H / 2 - 22);
    }
  }
  const activeZoneNetworkNodes = activeZoneNetworkNodesBase.map((node) => {
    const offset = fileNodeOffsets[node.path] ?? { x: 0, y: 0 };
    return { ...node, x: node.x + offset.x, y: node.y + offset.y };
  });
  const activeZoneExternalNodes = activeZoneExternalNodesBase.map((node) => {
    const offset = fileNodeOffsets[`zone:${node.id}`] ?? { x: 0, y: 0 };
    return { ...node, x: node.x + offset.x, y: node.y + offset.y };
  });
  const activeZoneDirectoryNodes = activeZoneDirectoryNodesBase.map((node) => {
    const offset = fileNodeOffsets[node.id] ?? { x: 0, y: 0 };
    return { ...node, x: node.x + offset.x, y: node.y + offset.y };
  });
  const activeZoneNetworkNodeByPath = new Map(activeZoneNetworkNodes.map((n) => [n.path, n]));
  const activeZoneExternalNodeById = new Map(activeZoneExternalNodes.map((n) => [n.id, n]));
  const activeZoneNetworkEdges = activeZone
    ? imports.edges
        .filter((e) => activeZoneVisibleSet.has(e.from) && activeZoneVisibleSet.has(e.to))
        .filter((e) => activeZoneRouteFocus ? e.from === activeZoneRouteFocus || e.to === activeZoneRouteFocus : false)
        .sort((a, b) =>
          (inDegree.get(b.from) ?? 0) + (outDegree.get(b.from) ?? 0) + (inDegree.get(b.to) ?? 0) + (outDegree.get(b.to) ?? 0) -
          ((inDegree.get(a.from) ?? 0) + (outDegree.get(a.from) ?? 0) + (inDegree.get(a.to) ?? 0) + (outDegree.get(a.to) ?? 0)) ||
          a.from.localeCompare(b.from) ||
          a.to.localeCompare(b.to),
        )
        .slice(0, activeZoneRouteFocus ? 10 : 6)
    : [];
  const activeZoneCrossZoneEdges = activeZone && zones
    ? boundaryLinksForMap
        .map((edge) => {
          const fromInside = edge.direction === "outgoing";
          const fileNode = activeZoneNetworkNodeByPath.get(edge.filePath);
          const zoneNode = activeZoneExternalNodeById.get(edge.externalZoneId);
          if (!fileNode || !zoneNode) return null;
          return { ...edge.edge, fromInside, fileNode, zoneNode };
        })
        .filter((edge): edge is NonNullable<typeof edge> => edge !== null)
        .slice(0, 72)
    : [];
  const activeZoneInternalEdges = activeZoneFiles
    ? imports.edges.filter((e) => activeZoneFiles.has(e.from) && activeZoneFiles.has(e.to)).length
    : 0;
  const activeZoneOutbound = zoneFilter
    ? zoneFlows.filter((f) => f.fromZone === zoneFilter).reduce((sum, f) => sum + f.count, 0)
    : 0;
  const activeZoneInbound = zoneFilter
    ? zoneFlows.filter((f) => f.toZone === zoneFilter).reduce((sum, f) => sum + f.count, 0)
    : 0;
  const activeZoneBoundaryFlows = zoneFilter
    ? zoneFlows.filter((f) => f.fromZone === zoneFilter || f.toZone === zoneFilter).slice(0, 8)
    : zoneFlows.slice(0, 8);
  const zoneBoundaryStats = new Map<string, { in: number; out: number }>();
  for (const flow of zoneFlows) {
    const from = zoneBoundaryStats.get(flow.fromZone) ?? { in: 0, out: 0 };
    from.out += flow.count;
    zoneBoundaryStats.set(flow.fromZone, from);
    const to = zoneBoundaryStats.get(flow.toZone) ?? { in: 0, out: 0 };
    to.in += flow.count;
    zoneBoundaryStats.set(flow.toZone, to);
  }
  const zoneMapZones = zoneCards.slice(0, 12);
  const zoneMapLayout = layoutZoneMapNodes(
    zoneMapZones,
    zoneFlows,
    (id) => zoneBoundaryStats.get(id) ?? { in: 0, out: 0 },
    920,
  );
  const zoneMapW = zoneMapLayout.width;
  const zoneMapH = zoneMapLayout.height;
  const zoneMapNodes = zoneMapLayout.nodes.map((zone) => {
    const offset = zoneNodeOffsets[zone.id] ?? { x: 0, y: 0 };
    return { ...zone, x: zone.x + offset.x, y: zone.y + offset.y };
  });
  const zoneMapNodeById = new Map(zoneMapNodes.map((node) => [node.id, node]));
  const zoneMapFlows = zoneFlows
    .filter((flow) => zoneMapNodeById.has(flow.fromZone) && zoneMapNodeById.has(flow.toZone))
    .slice(0, 12)
    .map((flow, i) => {
      const from = zoneMapNodeById.get(flow.fromZone)!;
      const to = zoneMapNodeById.get(flow.toZone)!;
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2 - 30 - (i % 3) * 10;
      return { ...flow, from, to, midX, midY };
    });
  const graphNodeCount = layoutNodes?.length ?? 0;
  const graphScopeLabel = mode === "package"
    ? "external package importers"
    : activeZoneName
      ? `${activeZoneName} neighborhood`
      : "selected file neighborhood";
  const focusReason =
    focusSource.kind === "zone" && zones
      ? `Driven by zone: ${zoneDisplayName(zones, focusSource.zoneId)}`
      : focusSource.kind === "hub"
        ? `Driven by hub: ${basename(focusSource.path)}`
        : focusSource.kind === "file"
          ? `Driven by file: ${basename(focusSource.path)}`
          : focusSource.kind === "package"
            ? `Driven by package: ${focusSource.packageName}`
            : focusSource.kind === "cycle"
              ? `Driven by cycle: ${basename(focusSource.path)}`
              : "Default starting point";
  const canGoBack = focusHistoryIndex > 0;
  const canGoForward = focusHistoryIndex >= 0 && focusHistoryIndex < focusHistory.length - 1;

  const edgePaths: { d: string; cross: boolean; key: string; label?: string; labelX?: number; labelY?: number }[] = [];
  const kindOf = (id: string): NodeKind => nodeKindById.get(id) ?? "file";

  const svgW = svgDims.w;
  const svgH = svgDims.h;
  const visualPosMap = new Map(posMap);
  for (const [id, offset] of Object.entries(depNodeOffsets)) {
    const pos = visualPosMap.get(id);
    if (pos) visualPosMap.set(id, { x: pos.x + offset.x, y: pos.y + offset.y });
  }

  if (mode === "file" && subgraph) {
    const { edges } = subgraph;
    // Stagger each edge's vertical bend so parallel routes between the same
    // columns don't stack on the same x — much clearer "what goes to what".
    // Group by target so siblings ending at the same node fan out cleanly.
    const targetIndex = new Map<string, number[]>();
    for (let i = 0; i < edges.length; i++) {
      const t = edges[i].to;
      const list = targetIndex.get(t) ?? [];
      list.push(i);
      targetIndex.set(t, list);
    }
    const edgeShift = new Map<number, number>();
    for (const [, idxs] of targetIndex) {
      const n = idxs.length;
      idxs.forEach((idx, k) => {
        edgeShift.set(idx, (k - (n - 1) / 2) * 10);
      });
    }

    // Cross-zone label deduplication. Without this, three edges from
    // UI Overlays → App-Core Bridge each carry the identical
    // "UI Overlays -> App-Core Bridge" string and stack on top of each
    // other in the diagram. Group by zone pair, pick one representative
    // edge per group, and emit a single "(×N)" label at the average
    // midpoint of the bundle.
    const crossPairFirstIdx = new Map<string, number>();
    const crossPairCount = new Map<string, number>();
    const crossPairCentroid = new Map<string, { x: number; y: number; n: number }>();
    edges.forEach((e, i) => {
      if (!zones || !isCrossZoneEdge(e.from, e.to, zones)) return;
      const fz = fileToZoneId(e.from, zones);
      const tz = fileToZoneId(e.to, zones);
      if (!fz || !tz) return;
      const a = visualPosMap.get(e.from);
      const b = visualPosMap.get(e.to);
      if (!a || !b) return;
      const key = `${fz}|${tz}`;
      crossPairCount.set(key, (crossPairCount.get(key) ?? 0) + 1);
      if (!crossPairFirstIdx.has(key)) crossPairFirstIdx.set(key, i);
      const cur = crossPairCentroid.get(key) ?? { x: 0, y: 0, n: 0 };
      cur.x += (a.x + b.x) / 2;
      cur.y += (a.y + b.y) / 2;
      cur.n += 1;
      crossPairCentroid.set(key, cur);
    });

    edges.forEach((e, i) => {
      const a = visualPosMap.get(e.from);
      const b = visualPosMap.get(e.to);
      if (!a || !b) return;
      const wFrom = nodeHalfWidth(kindOf(e.from));
      const wTo = nodeHalfWidth(kindOf(e.to));
      const fromZone = fileToZoneId(e.from, zones);
      const toZone = fileToZoneId(e.to, zones);
      const cross = isCrossZoneEdge(e.from, e.to, zones);
      const shift = edgeShift.get(i) ?? 0;
      const pairKey = cross && fromZone && toZone ? `${fromZone}|${toZone}` : null;
      const isRep = pairKey !== null && crossPairFirstIdx.get(pairKey) === i;
      const count = pairKey ? crossPairCount.get(pairKey) ?? 1 : 1;
      const centroid = pairKey ? crossPairCentroid.get(pairKey) : null;
      let labelX: number | undefined = (a.x + b.x) / 2 + shift;
      let labelY: number | undefined = (a.y + b.y) / 2 - 8;
      let label: string | undefined;
      if (isRep && zones && fromZone && toZone) {
        label = `${zoneDisplayName(zones, fromZone)} → ${zoneDisplayName(zones, toZone)}${count > 1 ? ` ×${count}` : ""}`;
        if (centroid && centroid.n > 0) {
          labelX = centroid.x / centroid.n;
          labelY = centroid.y / centroid.n - 8;
        }
      } else if (cross) {
        // Edges in a duplicated cross-zone group still get a position but no
        // label string — keeps the existing structure for any consumer that
        // expects labelX/labelY pairs on every cross edge.
        label = undefined;
      }
      edgePaths.push({
        key: `${e.from}->${e.to}:${e.type}`,
        d: elbowPath(a.x + wFrom, a.y, b.x - wTo, b.y, shift),
        cross,
        label,
        labelX,
        labelY,
      });
    });
  } else if (mode === "package" && packageSubgraph && focusPackage) {
    const pkgId = `pkg:${focusPackage}`;
    const pkgPos = visualPosMap.get(pkgId);
    if (pkgPos) {
      const wPkg = nodeHalfWidth("package");
      const wFile = nodeHalfWidth("file");
      for (const f of packageSubgraph.files.slice(0, 48)) {
        const fp = visualPosMap.get(f);
        if (!fp) continue;
        edgePaths.push({
          key: `${f}->${pkgId}`,
          d: elbowPath(fp.x + wFile, fp.y, pkgPos.x - wPkg, pkgPos.y),
          cross: false,
        });
      }
    }
  }
  const graphEdgeCount = edgePaths.length;
  const graphCrossEdgeCount = edgePaths.filter((edge) => edge.cross).length;

  return h("div", {
    ref: pageRef,
    class: "ig-page",
    onWheelCapture: (event: WheelEvent) => {
      // ctrl/meta wheel is a pinch-zoom gesture on a map — never treat it as a
      // scroll that expands/collapses the codebase map.
      if (event.ctrlKey || event.metaKey) return;
      const scrollParent = pageRef.current?.closest(".main") as HTMLElement | null;
      const scrollTop = scrollParent?.scrollTop ?? window.scrollY;
      if (
        zoneFilter &&
        !codebaseMapExpanded &&
        event.deltaY < -4 &&
        scrollTop <= CODEBASE_MAP_EXPAND_TOP_PX
      ) {
        setCodebaseMapExpanded(true);
      } else if (zoneFilter && codebaseMapExpanded && event.deltaY > 4) {
        setCodebaseMapExpanded(false);
      }
    },
  },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
    ),

    h("section", { class: `ig-explore${activeZone ? " ig-explore-selected" : ""}`, id: "ig-explore-panel", "aria-label": "Choose a zone to inspect" },
      h("div", { class: `ig-codebase-morph${activeZone && !codebaseMapExpanded ? " ig-codebase-morph-mini" : " ig-codebase-morph-full"}` },
        h("div", {
            class: "ig-codebase-mini",
            role: "navigation",
            "aria-label": "Codebase mini selector",
            onWheel: (event: WheelEvent) => {
              const scrollParent = pageRef.current?.closest(".main") as HTMLElement | null;
              const scrollTop = scrollParent?.scrollTop ?? window.scrollY;
              if (event.deltaY < 0 && scrollTop <= CODEBASE_MAP_EXPAND_TOP_PX) setCodebaseMapExpanded(true);
            },
          },
            h("button", {
              type: "button",
              class: "ig-mini-reset",
              onClick: () => {
                setCodebaseMapExpanded(true);
              },
            }, "Codebase map"),
            h("div", { class: "ig-mini-zones" },
              ...zoneMapZones.slice(0, 8).map((zone) => {
                const stats = zoneBoundaryStats.get(zone.id) ?? { in: 0, out: 0 };
                return h("button", {
                  key: zone.id,
                  type: "button",
                  class: `ig-mini-zone${zoneFilter === zone.id ? " ig-mini-zone-active" : ""}`,
                  title: `${zone.name}: ${zone.n} files, ${stats.in} in / ${stats.out} out`,
                  onClick: () => openZoneInGraph(zone.id),
                }, zone.name);
              }),
            ),
            h("span", { class: "ig-mini-current" },
              activeZone ? `${activeZone.name} · ${activeZoneInbound} in / ${activeZoneOutbound} out` : "All zones",
            ),
          ),
        h("div", { class: `ig-scope-card${activeZone ? " ig-scope-card-filtered" : ""}` },
          h("div", { class: "ig-card-head" },
            h("div", null,
              h("h3", { class: "ig-explore-section-title" }, "Codebase map"),
              h("p", { class: "ig-explore-section-desc" }, "Zones are positioned by boundary traffic. Select one to inspect its file-level map."),
            ),
          ),
          h("div", { class: "ig-zone-selector-grid" },
            h("div", { class: "ig-zone-map", "aria-label": "Zone boundary map" },
              h("svg", {
                viewBox: `0 0 ${zoneMapW} ${zoneMapH}`,
                role: "img",
                onPointerDown: (event: PointerEvent) => beginPan("codebase", event),
                onPointerMove: handlePointerMove,
                onPointerUp: endDrag,
                onPointerLeave: endDrag,
                onWheel: (event: WheelEvent) => handleSurfaceWheel("codebase", event),
                onTouchStart: (event: TouchEvent) => beginPinch("codebase", event),
                onTouchMove: movePinch,
                onTouchEnd: endPinch,
              },
                h("defs", null,
                  h("marker", {
                    id: "ig-zone-map-arrow",
                    viewBox: "0 0 10 8",
                    refX: 9,
                    refY: 4,
                    markerWidth: 8,
                    markerHeight: 6,
                    orient: "auto",
                  }, h("path", { d: "M 0 0 L 10 4 L 0 8 z", fill: "var(--orange)" })),
                ),
                h("g", { transform: `translate(${codebaseView.x} ${codebaseView.y}) scale(${codebaseView.k})` },
                  h("g", { class: "ig-zone-map-flows" },
                    ...zoneMapFlows.map((flow) =>
                      h("g", { key: `${flow.fromZone}->${flow.toZone}` },
                        h("path", {
                          d: `M ${flow.from.x} ${flow.from.y} Q ${flow.midX} ${flow.midY} ${flow.to.x} ${flow.to.y}`,
                          markerEnd: "url(#ig-zone-map-arrow)",
                        }),
                        h("text", { x: flow.midX, y: flow.midY - 5, textAnchor: "middle" },
                          `${zones ? zoneDisplayName(zones, flow.fromZone) : flow.fromZone} -> ${zones ? zoneDisplayName(zones, flow.toZone) : flow.toZone}`,
                        ),
                        h("text", { class: "ig-zone-map-flow-count", x: flow.midX, y: flow.midY + 10, textAnchor: "middle" },
                          `${flow.count} import${flow.count === 1 ? "" : "s"}`,
                        ),
                      ),
                    ),
                  ),
                  h("g", { class: "ig-zone-map-nodes" },
                    ...zoneMapNodes.map((zone) =>
                      {
                        return h("g", {
                          key: zone.id,
                          class: `ig-zone-map-node${zoneFilter === zone.id ? " ig-zone-map-node-active" : ""}`,
                          transform: `translate(${zone.x}, ${zone.y})`,
                          onPointerDown: (event: PointerEvent) => {
                            event.stopPropagation();
                            suppressNodeClickRef.current = false;
                            (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
                            setDragState({
                              kind: "zone-node",
                              id: zone.id,
                              startX: event.clientX,
                              startY: event.clientY,
                              origin: zoneNodeOffsets[zone.id] ?? { x: 0, y: 0 },
                            });
                          },
                          onClick: () => {
                            if (suppressNodeClickRef.current) {
                              suppressNodeClickRef.current = false;
                              return;
                            }
                            openZoneInGraph(zone.id);
                          },
                        },
                          h("title", null, zone.name),
                          h("rect", { x: -ZONE_MAP_NODE_W / 2, y: -ZONE_MAP_NODE_H / 2, width: ZONE_MAP_NODE_W, height: ZONE_MAP_NODE_H, rx: 16 }),
                          h("foreignObject", {
                            x: -ZONE_MAP_NODE_W / 2,
                            y: -ZONE_MAP_NODE_H / 2,
                            width: ZONE_MAP_NODE_W,
                            height: ZONE_MAP_NODE_H,
                            "pointer-events": "none",
                          },
                            h("div", { xmlns: "http://www.w3.org/1999/xhtml", class: "ig-zone-map-card" },
                              h("div", { class: "ig-zone-map-card-name" }, zone.name),
                              h("div", { class: "ig-zone-map-card-meta" }, `${zone.n} files`),
                            ),
                          ),
                        );
                      }
                    ),
                  ),
                ),
              ),
            ),
            h("div", { class: "ig-boundary-strip" },
              h("h4", null, activeZone ? "Boundaries in focus" : "Busiest boundaries"),
              activeZoneBoundaryFlows.length
                ? h("div", { class: "ig-boundary-list" },
                    ...activeZoneBoundaryFlows.map((flow) =>
                      h("div", { class: "ig-boundary-row", key: `${flow.fromZone}->${flow.toZone}` },
                        h("span", { class: "ig-boundary-route" },
                          zones ? zoneDisplayName(zones, flow.fromZone) : flow.fromZone,
                          " -> ",
                          zones ? zoneDisplayName(zones, flow.toZone) : flow.toZone,
                        ),
                        h("span", { class: "ig-boundary-count" }, flow.count.toLocaleString()),
                      ),
                    ),
                  )
                : h("p", { class: "ig-boundary-empty" }, "No cross-zone imports for this scope."),
            ),
          ),
        ),
      ),
    ),

    h("header", { ref: heroRef, class: "ig-atlas-hero" },
      h("div", { class: "ig-atlas-copy" },
        h("p", { class: "ig-kicker" }, activeZoneName ? "Map of Zone:" : "Map"),
        h("h2", { class: "ig-page-title" }, activeZoneName ? activeZoneName : "Codebase import map"),
      ),
      h("div", { class: "ig-atlas-metrics", role: "list" },
        h("div", { class: "ig-metric-tile", role: "listitem" },
          h("span", { class: "ig-metric-value" }, fileCount.toLocaleString()),
          h("span", { class: "ig-metric-label" }, "files"),
        ),
        h("div", { class: "ig-metric-tile", role: "listitem" },
          h("span", { class: "ig-metric-value" }, summary.totalEdges.toLocaleString()),
          h("span", { class: "ig-metric-label" }, "imports"),
        ),
        h("div", { class: "ig-metric-tile", role: "listitem" },
          h("span", { class: "ig-metric-value" }, summary.totalExternal.toLocaleString()),
          h("span", { class: "ig-metric-label" }, "packages"),
        ),
        h("div", { class: "ig-metric-tile", role: "listitem" },
          h("span", { class: "ig-metric-value" }, zones ? zones.zones.length.toLocaleString() : "—"),
          h("span", { class: "ig-metric-label" }, "zones"),
        ),
      ),
      activeZoneName
        ? null
        : h("div", { class: "ig-atlas-footer" },
            h("span", { class: "ig-atlas-mode" }, "All zones"),
            h("p", { class: "ig-atlas-summary" },
              `${summary.totalEdges.toLocaleString()} imports · ${summary.circularCount} cycle${summary.circularCount === 1 ? "" : "s"} · ${summary.avgImportsPerFile.toFixed(2)} avg imports/file`,
            ),
        ),
    ),

    h("div", { ref: graphPanelRef, class: `ig-graph-shell${activeZone ? " ig-graph-shell-zone" : ""} ig-street-view-${streetViewMode}`, id: "ig-graph-panel" },
    h("div", { class: "ig-main" },
      h("section", { class: "ig-zone-overview ig-zone-minimap", "aria-label": activeZone ? `${activeZone.name} zone map` : "Zone map" },
        activeZone
          ? [
              h("div", { class: "ig-zone-overview-head", key: "head" },
                h("div", null,
                  h("span", { class: "ig-zone-overview-kicker" }, "Zone map"),
                  h("h3", null, activeZone.name),
                ),
                h("div", { class: "ig-zone-overview-stats" },
                  h("span", null, `${activeZone.files.length} files`),
                  h("span", null, `${activeZoneInternalEdges} internal imports`),
                  h("span", null, `${activeZoneInbound} in / ${activeZoneOutbound} out`),
                ),
              ),
              h("div", { class: "ig-zone-network", key: "network" },
                h("svg", {
                  viewBox: `0 0 ${activeZoneNetworkW} ${activeZoneNetworkH}`,
                  role: "img",
                  "aria-label": `${activeZone.name} dependency zone map`,
                  onPointerDown: (event: PointerEvent) => beginPan("zone", event),
                  onPointerMove: handlePointerMove,
                  onPointerUp: endDrag,
                  onPointerLeave: endDrag,
                  onWheel: (event: WheelEvent) => handleSurfaceWheel("zone", event),
                  onTouchStart: (event: TouchEvent) => beginPinch("zone", event),
                  onTouchMove: movePinch,
                  onTouchEnd: endPinch,
                },
                  h("defs", null,
                    h("marker", {
                      id: "ig-zone-arrow",
                      viewBox: "0 0 10 8",
                      refX: 9,
                      refY: 4,
                      markerWidth: 7,
                      markerHeight: 5,
                      orient: "auto",
                    }, h("path", { d: "M 0 0 L 10 4 L 0 8 z", fill: "var(--text-muted, #888)" })),
                    h("marker", {
                      id: "ig-zone-arrow-external",
                      viewBox: "0 0 10 8",
                      refX: 9,
                      refY: 4,
                      markerWidth: 8,
                      markerHeight: 6,
                      orient: "auto",
                    }, h("path", { d: "M 0 0 L 10 4 L 0 8 z", fill: "var(--orange)" })),
                  ),
                  h("rect", {
                    class: "ig-zone-network-bg",
                    x: 0,
                    y: 0,
                    width: activeZoneNetworkW,
                    height: activeZoneNetworkH,
                    onClick: () => {
                      setHoverPreviewFile(null);
                      setStreetViewMode("closed");
                    },
                  }),
                  h("g", { transform: `translate(${zoneView.x} ${zoneView.y}) scale(${zoneView.k})` },
                    h("g", { class: "ig-zone-network-edges" },
                      ...activeZoneNetworkEdges.map((edge) => {
                        const from = activeZoneNetworkNodeByPath.get(edge.from);
                        const to = activeZoneNetworkNodeByPath.get(edge.to);
                        if (!from || !to) return null;
                        const isRouteEdge = activeZoneRouteFileSet.has(edge.from) && activeZoneRouteFileSet.has(edge.to);
                        return h("g", {
                          key: `${edge.from}->${edge.to}:${edge.type}`,
                          class: mapHasRouteFocus ? isRouteEdge ? "ig-zone-network-edge-active" : "ig-zone-network-edge-muted" : undefined,
                        },
                          h("path", {
                            d: `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - 18} ${to.x} ${to.y}`,
                            markerEnd: "url(#ig-zone-arrow)",
                          }),
                        );
                      }),
                      ...activeZoneCrossZoneEdges.map((edge) => {
                        const from = edge.fromInside ? edge.fileNode : edge.zoneNode;
                        const to = edge.fromInside ? edge.zoneNode : edge.fileNode;
                        const edgeKey = `${edge.from}->${edge.to}:${edge.type}`;
                        const isRouteEdge = activeZoneRouteLinkSet.has(edgeKey) || activeZoneExternalRouteLinkSet.has(edgeKey);
                        const label = edge.fromInside
                          ? `${basename(edge.fileNode.path)} imports from ${edge.zoneNode.name}`
                          : `${edge.zoneNode.name} imports ${basename(edge.fileNode.path)}`;
                        return h("g", {
                          key: `cross-${edge.from}->${edge.to}:${edge.type}`,
                          class: `ig-zone-network-edge-external${mapHasRouteFocus ? isRouteEdge ? " ig-zone-network-edge-active" : " ig-zone-network-edge-muted" : ""}`,
                        },
                          h("title", null, label),
                          h("path", {
                            d: `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - 26} ${to.x} ${to.y}`,
                            markerEnd: "url(#ig-zone-arrow-external)",
                          }),
                        );
                      }),
                    ),
                    h("g", { class: "ig-zone-network-nodes" },
                      ...activeZoneNetworkNodes.map((node) => {
                        const fileLabelLines = wrapFileLabel(basename(node.path));
                        const isRouteNode = activeZoneRouteNodeSet.has(node.path);
                        return h("g", {
                          key: node.path,
                          class: `ig-zone-network-node${activeZoneFocusNode === node.path ? " ig-zone-network-node-active" : ""}${hoverPreviewFile === node.path ? " ig-zone-network-node-preview" : ""}${mapHasRouteFocus && !isRouteNode ? " ig-zone-network-node-muted" : ""}`,
                          transform: `translate(${node.x}, ${node.y})`,
                          onPointerDown: (event: PointerEvent) => {
                            event.stopPropagation();
                            suppressNodeClickRef.current = false;
                            (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
                            setDragState({
                              kind: "file-node",
                              path: node.path,
                              startX: event.clientX,
                              startY: event.clientY,
                              origin: fileNodeOffsets[node.path] ?? { x: 0, y: 0 },
                            });
                          },
                          onPointerEnter: () => openHoverPreview(node.path, node.x > activeZoneNetworkW / 2 ? "left" : "right"),
                          onPointerLeave: () => closeHoverPreview(node.path),
                          onClick: (event: MouseEvent) => {
                            event.stopPropagation();
                            if (suppressNodeClickRef.current) {
                              suppressNodeClickRef.current = false;
                              return;
                            }
                            drillFileToGraph(node.path);
                          },
                        },
                          h("rect", { class: "ig-zone-network-file-box", x: -ZONE_FILE_NODE_W / 2, y: -ZONE_FILE_NODE_H / 2, width: ZONE_FILE_NODE_W, height: ZONE_FILE_NODE_H, rx: 12 }),
                          activeZoneBoundaryByFile.has(node.path)
                            ? h("circle", { class: "ig-zone-network-boundary-pin", cx: -ZONE_FILE_NODE_W / 2 + 10, cy: -ZONE_FILE_NODE_H / 2 + 10, r: 3.5 })
                            : null,
                          h("text", { class: "ig-zone-network-dir", x: -ZONE_FILE_NODE_W / 2 + 16, y: -10, ...fitToBox(parentContext(node.path), 9, ZONE_FILE_NODE_W - 32) }, parentContext(node.path)),
                          h("text", { class: "ig-zone-network-label", x: -ZONE_FILE_NODE_W / 2 + 16, y: fileLabelLines.length === 1 ? 12 : 5 },
                            ...fileLabelLines.map((line, index) =>
                              h("tspan", { key: `${node.path}-line-${index}`, x: -ZONE_FILE_NODE_W / 2 + 16, dy: index === 0 ? 0 : 13, ...fitToBox(line, 11, ZONE_FILE_NODE_W - 32) }, line),
                            ),
                          ),
                          streetViewMode === "dialog" && hoverPreviewFile === node.path && activeZoneFocusNode !== node.path
                            ? h("g", { class: "ig-zone-network-hint", "pointer-events": "none" },
                                h("rect", { class: "ig-zone-network-hint-pill", x: -54, y: -ZONE_FILE_NODE_H / 2 - 24, width: 108, height: 18, rx: 9 }),
                                h("text", { class: "ig-zone-network-hint-text", x: 0, y: -ZONE_FILE_NODE_H / 2 - 15, textAnchor: "middle", "dominant-baseline": "central" }, "Click to open ↗"),
                              )
                            : null,
                        );
                      }),
                    ),
                    h("g", { class: "ig-zone-dir-nodes" },
                      ...activeZoneDirectoryNodes.map((node) =>
                        h("g", {
                          key: node.id,
                          class: "ig-zone-dir-node",
                          transform: `translate(${node.x}, ${node.y})`,
                          onPointerDown: (event: PointerEvent) => {
                            event.stopPropagation();
                            suppressNodeClickRef.current = false;
                            (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
                            setDragState({
                              kind: "file-node",
                              path: node.id,
                              startX: event.clientX,
                              startY: event.clientY,
                              origin: fileNodeOffsets[node.id] ?? { x: 0, y: 0 },
                            });
                          },
                        },
                          h("rect", { x: -ZONE_DIR_NODE_W / 2, y: -ZONE_DIR_NODE_H / 2, width: ZONE_DIR_NODE_W, height: ZONE_DIR_NODE_H, rx: 12 }),
                          h("text", { class: "ig-zone-dir-label", x: -ZONE_DIR_NODE_W / 2 + 12, y: -2, ...fitToBox(truncateNodeLabel(node.dir, "file", 30), 9, ZONE_DIR_NODE_W - 24, true) }, truncateNodeLabel(node.dir, "file", 30)),
                          h("text", { class: "ig-zone-dir-meta", x: -ZONE_DIR_NODE_W / 2 + 12, y: 13, ...fitToBox(`${node.count} more file${node.count === 1 ? "" : "s"}`, 8, ZONE_DIR_NODE_W - 24) }, `${node.count} more file${node.count === 1 ? "" : "s"}`),
                        ),
                      ),
                    ),
                    h("g", { class: "ig-zone-external-nodes" },
                      ...activeZoneExternalNodes.map((node) =>
                        h("g", {
                          key: node.id,
                          class: `ig-zone-external-node${hoverExternalZoneId === node.id ? " ig-zone-external-node-preview" : ""}`,
                          transform: `translate(${node.x}, ${node.y})`,
                          onPointerDown: (event: PointerEvent) => {
                            event.stopPropagation();
                            suppressNodeClickRef.current = false;
                            (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
                            setDragState({
                              kind: "file-node",
                              path: `zone:${node.id}`,
                              startX: event.clientX,
                              startY: event.clientY,
                              origin: fileNodeOffsets[`zone:${node.id}`] ?? { x: 0, y: 0 },
                            });
                          },
                          onPointerEnter: () => {
                            setHoverExternalZoneId(node.id);
                            setHoverPreviewSide(node.x > activeZoneNetworkW / 2 ? "left" : "right");
                            setStreetViewMode((current) => current === "dialog" ? current : "preview");
                          },
                          onPointerLeave: () => {
                            setHoverExternalZoneId((current) => current === node.id ? null : current);
                            setStreetViewMode((current) => current === "preview" ? "closed" : current);
                          },
                        },
                          h("rect", { x: -ZONE_EXTERNAL_NODE_W / 2, y: -ZONE_EXTERNAL_NODE_H / 2, width: ZONE_EXTERNAL_NODE_W, height: ZONE_EXTERNAL_NODE_H, rx: 10 }),
                          h("foreignObject", {
                            x: -ZONE_EXTERNAL_NODE_W / 2,
                            y: -ZONE_EXTERNAL_NODE_H / 2,
                            width: ZONE_EXTERNAL_NODE_W,
                            height: ZONE_EXTERNAL_NODE_H,
                            "pointer-events": "none",
                          },
                            h("div", { xmlns: "http://www.w3.org/1999/xhtml", class: "ig-zone-ext-card" },
                              h("div", { class: "ig-zone-ext-card-name" }, node.name),
                              h("div", { class: "ig-zone-ext-card-meta" }, `${node.fromExternal} from / ${node.toExternal} to`),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                activeZone.files.length > activeZoneVisibleFiles.length
                  ? h("p", { class: "ig-zone-network-note" },
                      `Showing ${activeZoneVisibleFiles.length} high-signal files; directory cards represent the remaining ${activeZone.files.length - activeZoneVisibleFiles.length}.`,
                    )
                  : null,
              ),
            ]
          : h("div", { class: "ig-zone-overview-empty" },
              h("span", { class: "ig-zone-overview-kicker" }, "Zone map"),
              h("h3", null, "Select a zone"),
              h("p", null, "Choose a zone above to open its file relationship map."),
            ),
      ),
      h("div", { class: `ig-graph-column ig-graph-column-${hoverPreviewSide}` },
        hoverExternalZoneId && streetViewMode !== "dialog"
          ? h("div", { class: "ig-external-zone-preview" },
              (() => {
                const external = activeZoneExternalNodes.find((node) => node.id === hoverExternalZoneId);
                const linkedFiles = visibleBoundaryLinks
                  .filter((link) => link.externalZoneId === hoverExternalZoneId)
                  .map((link) => link.filePath)
                  .filter((path, index, arr) => arr.indexOf(path) === index)
                  .slice(0, 6);
                return [
                  h("span", { class: "ig-graph-head-label", key: "label" }, "External zone"),
                  h("h3", { key: "title" }, external?.name ?? hoverExternalZoneId),
                  h("p", { key: "meta" }, `${external?.fromExternal ?? 0} imports from this zone · ${external?.toExternal ?? 0} imports to it`),
                  linkedFiles.length
                    ? h("div", { class: "ig-external-zone-files", key: "files" },
                        ...linkedFiles.map((path) => h("span", { key: path, title: path }, basename(path))),
                      )
                    : null,
                ];
              })(),
            )
          : [
        h("div", { class: "ig-graph-head", key: "head" },
          h("div", { class: "ig-graph-title-block" },
            h("span", { class: "ig-graph-head-label" },
              streetViewMode === "dialog" ? "File street view" : "Dependency preview",
            ),
            h("p", { class: "ig-graph-scope" },
              `${graphNodeCount} nodes · ${graphEdgeCount} imports shown · ${graphCrossEdgeCount} cross-boundary · ${graphScopeLabel}`,
            ),
          ),
          h("div", { class: "ig-preview-history", "aria-label": "Dependency preview history" },
            h("button", {
              type: "button",
              class: "ig-preview-history-btn",
              disabled: !canGoBack,
              onClick: () => moveFocusHistory(-1),
            }, "Back"),
            h("button", {
              type: "button",
              class: "ig-preview-history-btn",
              disabled: !canGoForward,
              onClick: () => moveFocusHistory(1),
            }, "Forward"),
          ),
          streetViewMode === "dialog"
            ? h("button", {
                type: "button",
                class: "ig-btn-ghost",
                onClick: () => setStreetViewMode("closed"),
              }, "Close")
            : null,
          mode === "file" && focusFile
            ? h("span", { class: "ig-focus-chip", title: focusFile }, basename(focusFile))
            : mode === "package" && focusPackage
              ? h("span", { class: "ig-focus-chip ig-focus-chip-pkg", title: focusPackage }, focusPackage)
              : null,
        ),
        h("div", { class: "ig-svg-wrap", key: "svg" },
          h("svg", {
            viewBox: `0 0 ${svgW} ${svgH}`,
            preserveAspectRatio: "xMidYMid meet",
            "aria-label": "Focused import graph",
            onPointerDown: (event: PointerEvent) => beginPan("dep", event),
            onPointerMove: handlePointerMove,
            onPointerUp: endDrag,
            onPointerLeave: endDrag,
            onWheel: (event: WheelEvent) => {
              event.preventDefault();
              setDepView((view) => wheelViewport(view, event));
            },
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
            h("g", { transform: `translate(${depView.x} ${depView.y}) scale(${depView.k})` },
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
              h("g", { class: "ig-edge-labels" },
                ...edgePaths.filter((ep) => ep.label && ep.labelX !== undefined && ep.labelY !== undefined).map((ep) =>
                  h("text", {
                    key: `label-${ep.key}`,
                    x: ep.labelX,
                    y: ep.labelY,
                    textAnchor: "middle",
                  }, ep.label),
                ),
              ),
              h("g", { class: "ig-nodes" },
                ...(layoutNodes ?? []).map((n) => {
                  const isCenter = mode === "file" && n.kind === "file" && n.id === focusFile;
                  const isSel = n.kind === "file" && selectedFile === n.id;
                  const { w, h: hgt } = nodeBox(n.kind);
                  const pos = visualPosMap.get(n.id) ?? { x: n.x, y: n.y };
                  const tip =
                    n.kind === "file"
                      ? n.id
                      : n.id.startsWith("pkg:")
                        ? n.id.slice(4)
                        : n.label;
                  const labelText = truncateNodeLabel(n.label, n.kind);
                  const contextText = n.kind === "file" ? truncateNodeLabel(parentContext(n.id), "file") : "";
                  return h("g", {
                    key: n.id,
                    class: `ig-node ig-node-${n.kind}${isCenter ? " ig-node-center" : ""}${isSel ? " ig-node-selected" : ""}`,
                    transform: `translate(${pos.x - w / 2},${pos.y - hgt / 2})`,
                    title: tip,
                    onPointerDown: (ev: PointerEvent) => {
                      ev.stopPropagation();
                      (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
                      setDragState({
                        kind: "dep-node",
                        id: n.id,
                        startX: ev.clientX,
                        startY: ev.clientY,
                        origin: depNodeOffsets[n.id] ?? { x: 0, y: 0 },
                      });
                    },
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
                    n.kind === "file" && contextText
                      ? h("text", { class: "ig-node-context", x: 12, y: 18, ...fitToBox(contextText, 10, w - 24, true) }, contextText)
                      : null,
                    h("text", {
                      class: "ig-node-label",
                      x: 12,
                      y: n.kind === "file" && contextText ? 37 : hgt / 2,
                      "dominant-baseline": n.kind === "file" && contextText ? undefined : "middle",
                      ...fitToBox(labelText, 14, w - 24),
                    }, labelText),
                  );
                }),
              ),
            ),
          ),
          packageSubgraph && packageSubgraph.files.length > 48
            ? h("p", { class: "ig-footnote" },
                `Showing 48 of ${packageSubgraph.files.length} importers. Narrow the file list or choose another package.`,
              )
            : null,
        ),
        streetViewMode === "dialog" && mode === "file" && focusFile
          ? h("div", { class: "ig-street-detail", key: "detail" },
              h("span", null, focusZoneName ?? "Unzoned"),
              h("strong", { title: focusFile }, focusFile),
              h("span", null, `${inDegree.get(focusFile) ?? 0} importing · ${outDegree.get(focusFile) ?? 0} outgoing`),
              focusInv
                ? h("span", null, `${focusInv.language} · ${formatSize(focusInv.size)} · ${focusInv.lines.toLocaleString()} lines`)
                : null,
            )
          : null,
          ],
      ),

      h("div", { class: "ig-side" },
        h("div", { class: "ig-side-section ig-focus-detail" },
          h("h3", { class: "ig-panel-title" }, "Current selection"),
          h("p", { class: "ig-focus-reason" }, focusReason),
          mode === "file" && focusFile
            ? h("div", { class: "ig-focus-detail-grid" },
                h("span", null, "Path"),
                h("strong", { title: focusFile }, focusFile),
                h("span", null, "Zone"),
                h("strong", null, focusZoneName ?? "Unzoned"),
                h("span", null, "Imports"),
                h("strong", null, `${inDegree.get(focusFile) ?? 0} in · ${outDegree.get(focusFile) ?? 0} out`),
                focusInv
                  ? h("span", null, "File")
                  : null,
                focusInv
                  ? h("strong", null, `${focusInv.language} · ${formatSize(focusInv.size)} · ${focusInv.lines.toLocaleString()} lines`)
                  : null,
              )
            : h("div", { class: "ig-focus-detail-grid" },
                h("span", null, "Package"),
                h("strong", null, focusPackage ?? "No package selected"),
                h("span", null, "Importers"),
                h("strong", null, focusPackageImporters.toLocaleString()),
              ),
        ),
        mode === "package"
          ? h("div", { class: "ig-side-section" },
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
                      setFocusSource({ kind: "package", packageName: ex.package });
                    },
                  },
                    h("span", { class: "ig-list-primary" }, ex.package),
                    h("span", { class: "ig-list-badge" }, String(ex.importedBy.length)),
                  ),
                ),
              ),
            )
          : null,
        h("div", { class: "ig-callout" },
          h("div", { class: "ig-callout-title" }, "Shortcuts"),
          h("p", { class: "ig-callout-body" },
            "Double-click a file node to open it in ",
            h("strong", null, "Files"),
            ". Drag nodes to rearrange the map, scroll to pan, and pinch to zoom.",
          ),
        ),
      ),
    ),
    ),
  );
}

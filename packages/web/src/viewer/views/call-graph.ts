/**
 * Call Graph — SVG box-and-line zone diagram.
 *
 * Zones rendered as rectangular boxes on a topology-aware grid,
 * connected by Bézier edges weighted by call traffic.
 * Zones expand on click to reveal file rows inside.
 * When expanded, file-level edges show which files bridge zones.
 */

import { h } from "preact";
import { useState, useMemo, useCallback, useRef, useEffect } from "preact/hooks";
import type { LoadedData, DetailItem, NavigateTo } from "../types.js";
import type { CallGraph, FunctionNode, ExternalImport } from "../../schema/v1.js";
import { CollapsibleSection } from "../components/data-display/collapsible-section.js";
import { SearchFilter } from "../components/search-filter.js";
import { BrandedHeader } from "../components/logos.js";
import {
  buildFileToZoneMap,
  buildCallFlowEdges,
  buildExternalImportEdges,
  getZoneColorByIndex,
  basename,
} from "../utils.js";

// ── Types ────────────────────────────────────────────────────────────

interface CallGraphViewProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  selectedFile?: string | null;
  selectedZone?: string | null;
  navigateTo?: NavigateTo;
}

interface CallRef {
  funcName: string;
  file: string;
  crossZone: boolean;
}

interface FuncInfo {
  fn: FunctionNode;
  outgoing: CallRef[];
  incoming: CallRef[];
}

interface FileInfo {
  path: string;
  functions: FuncInfo[];
  internalCalls: number;
  crossZoneCalls: number;
}

interface ZoneData {
  id: string;
  name: string;
  color: string;
  description: string;
  cohesion: number;
  coupling: number;
  files: FileInfo[];
  totalFunctions: number;
  internalCalls: number;
  crossZoneCalls: number;
}

interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
  gridCol: number;
  gridRow: number;
}

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FlowEdge {
  from: string;
  to: string;
  weight: number;
}

/** Per-file cross-zone connection: which other zones a file connects to. */
interface FileZoneLink {
  targetZoneId: string;
  weight: number;
}

/** Maps file path → list of cross-zone connections. */
type FileConnectionMap = Map<string, FileZoneLink[]>;

// ── Constants ────────────────────────────────────────────────────────

const BOX_W = 200;
const BOX_H_COLLAPSED = 80;
const FILE_ROW_H = 22;
const FILE_ROWS_MAX = 15;
const GAP_X = 80;
const GAP_Y = 60;
const PADDING = 40;

// ── Data transformation ──────────────────────────────────────────────

function buildExplorerData(
  callGraph: CallGraph,
  fileToZoneMap: Map<string, { id: string; name: string; color: string }>,
  zones: LoadedData["zones"],
): { zoneDataList: ZoneData[]; unzonedFiles: FileInfo[] } {
  const funcsByFile = new Map<string, FunctionNode[]>();
  for (const fn of callGraph.functions) {
    let list = funcsByFile.get(fn.file);
    if (!list) { list = []; funcsByFile.set(fn.file, list); }
    list.push(fn);
  }

  const funcInfoMap = new Map<string, FuncInfo>();
  for (const fn of callGraph.functions) {
    funcInfoMap.set(`${fn.file}:${fn.qualifiedName}`, {
      fn,
      outgoing: [],
      incoming: [],
    });
  }

  const fileInternalCalls = new Map<string, number>();
  const fileCrossZoneCalls = new Map<string, number>();

  for (const edge of callGraph.edges) {
    if (!edge.calleeFile) continue;

    const callerKey = `${edge.callerFile}:${edge.caller}`;
    const calleeKey = `${edge.calleeFile}:${edge.callee}`;
    const callerZone = fileToZoneMap.get(edge.callerFile);
    const calleeZone = fileToZoneMap.get(edge.calleeFile);
    const crossZone = !!(callerZone && calleeZone && callerZone.id !== calleeZone.id);

    const callerInfo = funcInfoMap.get(callerKey);
    if (callerInfo) {
      callerInfo.outgoing.push({ funcName: edge.callee, file: edge.calleeFile, crossZone });
    }

    const calleeInfo = funcInfoMap.get(calleeKey);
    if (calleeInfo) {
      calleeInfo.incoming.push({ funcName: edge.caller, file: edge.callerFile, crossZone });
    }

    if (crossZone) {
      fileCrossZoneCalls.set(edge.callerFile, (fileCrossZoneCalls.get(edge.callerFile) ?? 0) + 1);
      fileCrossZoneCalls.set(edge.calleeFile, (fileCrossZoneCalls.get(edge.calleeFile) ?? 0) + 1);
    } else {
      fileInternalCalls.set(edge.callerFile, (fileInternalCalls.get(edge.callerFile) ?? 0) + 1);
    }
  }

  const zoneFilesMap = new Map<string, FileInfo[]>();
  const unzonedFiles: FileInfo[] = [];

  for (const [filePath, fns] of funcsByFile) {
    const funcInfos = fns.map((fn) => funcInfoMap.get(`${filePath}:${fn.qualifiedName}`)!).filter(Boolean);
    const fileInfo: FileInfo = {
      path: filePath,
      functions: funcInfos,
      internalCalls: fileInternalCalls.get(filePath) ?? 0,
      crossZoneCalls: fileCrossZoneCalls.get(filePath) ?? 0,
    };

    const zone = fileToZoneMap.get(filePath);
    if (zone) {
      let list = zoneFilesMap.get(zone.id);
      if (!list) { list = []; zoneFilesMap.set(zone.id, list); }
      list.push(fileInfo);
    } else {
      unzonedFiles.push(fileInfo);
    }
  }

  const zoneDataList: ZoneData[] = [];
  if (zones) {
    for (let i = 0; i < zones.zones.length; i++) {
      const z = zones.zones[i];
      const files = zoneFilesMap.get(z.id) ?? [];
      files.sort((a, b) => b.crossZoneCalls - a.crossZoneCalls || a.path.localeCompare(b.path));

      const totalFunctions = files.reduce((sum, f) => sum + f.functions.length, 0);
      const internalCalls = files.reduce((sum, f) => sum + f.internalCalls, 0);
      const crossZoneCalls = files.reduce((sum, f) => sum + f.crossZoneCalls, 0);

      zoneDataList.push({
        id: z.id,
        name: z.name,
        color: getZoneColorByIndex(i),
        description: z.description,
        cohesion: z.cohesion,
        coupling: z.coupling,
        files,
        totalFunctions,
        internalCalls,
        crossZoneCalls,
      });
    }
  }

  unzonedFiles.sort((a, b) => a.path.localeCompare(b.path));
  return { zoneDataList, unzonedFiles };
}

/**
 * Build per-file cross-zone connection map.
 * For each file, tracks which other zones it connects to (and weight).
 */
function buildFileConnectionMap(
  callGraph: CallGraph,
  externalImports: ExternalImport[],
  fileToZoneMap: Map<string, { id: string; name: string; color: string }>,
  zones: LoadedData["zones"],
): FileConnectionMap {
  // file → targetZoneId → weight
  const raw = new Map<string, Map<string, number>>();

  const addConn = (file: string, targetZone: string) => {
    let targets = raw.get(file);
    if (!targets) { targets = new Map(); raw.set(file, targets); }
    targets.set(targetZone, (targets.get(targetZone) ?? 0) + 1);
  };

  // From call graph edges
  for (const e of callGraph.edges) {
    if (!e.calleeFile) continue;
    const fromZone = fileToZoneMap.get(e.callerFile);
    const toZone = fileToZoneMap.get(e.calleeFile);
    if (!fromZone || !toZone || fromZone.id === toZone.id) continue;
    addConn(e.callerFile, toZone.id);
    addConn(e.calleeFile, fromZone.id);
  }

  // From external imports: map package names to zones
  if (zones) {
    const dirToZone = new Map<string, { zoneId: string; hasSrc: boolean }>();
    for (const z of zones.zones) {
      for (const f of z.files) {
        const parts = f.split("/");
        if (parts.length >= 2 && parts[0] === "packages") {
          const dir = `packages/${parts[1]}`;
          const isSrc = f.includes("/src/");
          const existing = dirToZone.get(dir);
          if (!existing || (isSrc && !existing.hasSrc)) {
            dirToZone.set(dir, { zoneId: z.id, hasSrc: isSrc });
          }
        }
      }
    }

    const pkgToZone = new Map<string, string>();
    for (const ext of externalImports) {
      const pkg = ext.package;
      if (pkgToZone.has(pkg)) continue;
      if (pkg.startsWith("@n-dx/")) {
        const entry = dirToZone.get(`packages/${pkg.slice(6)}`);
        if (entry) { pkgToZone.set(pkg, entry.zoneId); continue; }
      }
      const entry = dirToZone.get(`packages/${pkg}`);
      if (entry) { pkgToZone.set(pkg, entry.zoneId); }
    }

    for (const ext of externalImports) {
      const targetZone = pkgToZone.get(ext.package);
      if (!targetZone) continue;
      for (const file of ext.importedBy) {
        const fromZone = fileToZoneMap.get(file);
        if (!fromZone || fromZone.id === targetZone) continue;
        addConn(file, targetZone);
      }
    }
  }

  // Convert to result format
  const result: FileConnectionMap = new Map();
  for (const [file, targets] of raw) {
    result.set(file, [...targets.entries()].map(([zoneId, weight]) => ({
      targetZoneId: zoneId,
      weight,
    })));
  }
  return result;
}

// ── Layout pure functions ────────────────────────────────────────────

function boxHeight(zone: ZoneData, expanded: boolean): number {
  if (!expanded) return BOX_H_COLLAPSED;
  const rows = Math.min(zone.files.length, FILE_ROWS_MAX);
  return BOX_H_COLLAPSED + rows * FILE_ROW_H + 16 + (zone.files.length > FILE_ROWS_MAX ? 20 : 0);
}

/** Get the Y center of a file row within an expanded zone box. */
function fileRowY(box: BoxRect, fileIndex: number): number {
  return box.y + BOX_H_COLLAPSED - 4 + fileIndex * FILE_ROW_H + FILE_ROW_H / 2;
}

function computeZoneLayout(
  zones: ZoneData[],
  edges: FlowEdge[],
  expandedZones: Set<string>,
): { boxes: Map<string, BoxRect>; totalW: number; totalH: number } {
  if (zones.length === 0) return { boxes: new Map(), totalW: 0, totalH: 0 };

  // Build adjacency weight map
  const adj = new Map<string, Map<string, number>>();
  for (const z of zones) adj.set(z.id, new Map());
  for (const e of edges) {
    if (!adj.has(e.from) || !adj.has(e.to)) continue;
    const m1 = adj.get(e.from)!;
    m1.set(e.to, (m1.get(e.to) ?? 0) + e.weight);
    const m2 = adj.get(e.to)!;
    m2.set(e.from, (m2.get(e.from) ?? 0) + e.weight);
  }

  const totalWeight = new Map<string, number>();
  for (const [id, neighbors] of adj) {
    let sum = 0;
    for (const w of neighbors.values()) sum += w;
    totalWeight.set(id, sum);
  }

  const sorted = [...zones].sort((a, b) => (totalWeight.get(b.id) ?? 0) - (totalWeight.get(a.id) ?? 0));
  const placed = new Map<string, { col: number; row: number }>();
  const occupied = new Set<string>();
  const gridKey = (c: number, r: number) => `${c},${r}`;

  placed.set(sorted[0].id, { col: 0, row: 0 });
  occupied.add(gridKey(0, 0));

  const queue = [sorted[0].id];
  const visited = new Set([sorted[0].id]);

  const getNeighborsSorted = (id: string) => {
    const neighbors = adj.get(id);
    if (!neighbors) return [];
    return [...neighbors.entries()]
      .filter(([nid]) => !visited.has(nid))
      .sort((a, b) => b[1] - a[1])
      .map(([nid]) => nid);
  };

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentPos = placed.get(current)!;
    const neighbors = getNeighborsSorted(current);

    for (const nid of neighbors) {
      if (visited.has(nid)) continue;
      visited.add(nid);

      let bestCol = currentPos.col + 1;
      let bestRow = currentPos.row;
      let found = false;

      for (let dist = 1; dist <= 10 && !found; dist++) {
        for (let dc = -dist; dc <= dist && !found; dc++) {
          for (let dr = -dist; dr <= dist && !found; dr++) {
            if (Math.abs(dc) !== dist && Math.abs(dr) !== dist) continue;
            const c = currentPos.col + dc;
            const r = currentPos.row + dr;
            if (!occupied.has(gridKey(c, r))) {
              bestCol = c;
              bestRow = r;
              found = true;
            }
          }
        }
      }

      placed.set(nid, { col: bestCol, row: bestRow });
      occupied.add(gridKey(bestCol, bestRow));
      queue.push(nid);
    }
  }

  for (const z of zones) {
    if (placed.has(z.id)) continue;
    for (let r = 0; ; r++) {
      for (let c = 0; c < 4; c++) {
        if (!occupied.has(gridKey(c, r))) {
          placed.set(z.id, { col: c, row: r });
          occupied.add(gridKey(c, r));
          break;
        }
      }
      if (placed.has(z.id)) break;
    }
  }

  let minCol = Infinity, minRow = Infinity;
  for (const pos of placed.values()) {
    minCol = Math.min(minCol, pos.col);
    minRow = Math.min(minRow, pos.row);
  }
  for (const pos of placed.values()) {
    pos.col -= minCol;
    pos.row -= minRow;
  }

  let maxCol = 0;
  let maxRow = 0;
  for (const pos of placed.values()) {
    maxCol = Math.max(maxCol, pos.col);
    maxRow = Math.max(maxRow, pos.row);
  }

  const rowHeights = new Array(maxRow + 1).fill(BOX_H_COLLAPSED);
  const zoneMap = new Map(zones.map((z) => [z.id, z]));
  for (const [id, pos] of placed) {
    const zone = zoneMap.get(id);
    if (!zone) continue;
    const bh = boxHeight(zone, expandedZones.has(id));
    rowHeights[pos.row] = Math.max(rowHeights[pos.row], bh);
  }

  const boxes = new Map<string, BoxRect>();
  for (const [id, pos] of placed) {
    const zone = zoneMap.get(id);
    if (!zone) continue;
    const x = PADDING + pos.col * (BOX_W + GAP_X);
    let y = PADDING;
    for (let r = 0; r < pos.row; r++) {
      y += rowHeights[r] + GAP_Y;
    }
    boxes.set(id, {
      x,
      y,
      w: BOX_W,
      h: boxHeight(zone, expandedZones.has(id)),
      gridCol: pos.col,
      gridRow: pos.row,
    });
  }

  const totalW = PADDING * 2 + (maxCol + 1) * BOX_W + maxCol * GAP_X;
  let totalH = PADDING * 2;
  for (const rh of rowHeights) totalH += rh;
  totalH += maxRow * GAP_Y;

  return { boxes, totalW, totalH };
}

function boxEdgeAnchor(box: BoxRect, tx: number, ty: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const hw = box.w / 2;
  const hh = box.h / 2;

  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);

  return { x: cx + dx * s, y: cy + dy * s };
}

function computeEdgePath(
  fromBox: BoxRect,
  toBox: BoxRect,
  edgeIndex: number,
  totalEdgesBetweenPair: number,
): string {
  const fromCx = fromBox.x + fromBox.w / 2;
  const fromCy = fromBox.y + fromBox.h / 2;
  const toCx = toBox.x + toBox.w / 2;
  const toCy = toBox.y + toBox.h / 2;

  const from = boxEdgeAnchor(fromBox, toCx, toCy);
  const to = boxEdgeAnchor(toBox, fromCx, fromCy);

  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  const px = -dy / len;
  const py = dx / len;

  const offset = totalEdgesBetweenPair > 1
    ? (edgeIndex - (totalEdgesBetweenPair - 1) / 2) * 25
    : (len > 200 ? 20 : 12);

  const cpx = mx + px * offset;
  const cpy = my + py * offset;

  return `M ${from.x} ${from.y} Q ${cpx} ${cpy} ${to.x} ${to.y}`;
}

/** Compute a cubic Bézier from a file row position to a target zone box. */
function computeFileEdgePath(
  fileBox: BoxRect,
  fileCenterY: number,
  targetBox: BoxRect,
): string {
  const targetCx = targetBox.x + targetBox.w / 2;
  const exitRight = targetCx > fileBox.x + fileBox.w / 2;
  const fromX = exitRight ? fileBox.x + fileBox.w : fileBox.x;
  const fromY = Math.max(fileBox.y + 4, Math.min(fileCenterY, fileBox.y + fileBox.h - 4));

  const to = boxEdgeAnchor(targetBox, fromX, fromY);

  const dx = to.x - fromX;
  const cp1x = fromX + dx * 0.4;
  const cp1y = fromY;
  const cp2x = fromX + dx * 0.6;
  const cp2y = to.y;

  return `M ${fromX} ${fromY} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${to.x} ${to.y}`;
}

// ── Sub-components ───────────────────────────────────────────────────

function StatCard({ value, label, color }: { value: string; label: string; color?: string }) {
  return h("div", {
    class: "stat-card",
    style: "padding: 8px 16px; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; font-size: 12px;",
  },
    h("div", { style: `font-weight: 600; color: ${color ?? "var(--text)"};` }, value),
    h("div", { style: "color: var(--text-dim);" }, label),
  );
}

function FileRow({
  file,
  y,
  boxX,
  boxW,
  searchMatch,
  hasCrossZone,
  onClick,
  onDblClick,
}: {
  file: FileInfo;
  y: number;
  boxX: number;
  boxW: number;
  searchMatch: boolean;
  hasCrossZone: boolean;
  onClick: () => void;
  onDblClick: () => void;
}) {
  const totalIn = file.functions.reduce((s, fi) => s + fi.incoming.length, 0);
  const totalOut = file.functions.reduce((s, fi) => s + fi.outgoing.length, 0);
  const name = basename(file.path);
  const stats = `${file.functions.length}fn`;
  const arrows = `${totalIn > 0 ? "\u2190" + totalIn : ""}${totalOut > 0 ? "\u2192" + totalOut : ""}`;

  return h("g", {
    class: `cg-file-row${searchMatch ? " search-match" : ""}${hasCrossZone ? " cross-zone" : ""}`,
    onClick: (e: Event) => { e.stopPropagation(); onClick(); },
    onDblClick: (e: Event) => { e.stopPropagation(); onDblClick(); },
  },
    h("rect", {
      class: "cg-file-bg",
      x: boxX + 8,
      y,
      width: boxW - 16,
      height: FILE_ROW_H - 2,
      rx: 3,
    }),
    // Cross-zone indicator bar
    hasCrossZone
      ? h("rect", {
          class: "cg-file-xzone-bar",
          x: boxX + 8,
          y,
          width: 2,
          height: FILE_ROW_H - 2,
          rx: 1,
        })
      : null,
    h("text", {
      class: "cg-file-name",
      x: boxX + (hasCrossZone ? 16 : 14),
      y: y + 14,
    }, name.length > 20 ? name.slice(0, 18) + "\u2026" : name),
    h("text", {
      class: "cg-file-stats",
      x: boxX + boxW - 14,
      y: y + 14,
      "text-anchor": "end",
    }, `${stats} ${arrows}`),
  );
}

function ZoneEdge({
  edge,
  fromBox,
  toBox,
  maxWeight,
  edgeIndex,
  totalEdgesBetweenPair,
  hovered,
  onHover,
  onLeave,
}: {
  edge: FlowEdge;
  fromBox: BoxRect;
  toBox: BoxRect;
  maxWeight: number;
  edgeIndex: number;
  totalEdgesBetweenPair: number;
  hovered: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  const d = computeEdgePath(fromBox, toBox, edgeIndex, totalEdgesBetweenPair);
  const isHeavy = edge.weight > maxWeight * 0.5;
  const strokeW = Math.max(1.5, Math.min(6, (edge.weight / maxWeight) * 5 + 1));

  return h("g", null,
    h("path", {
      d,
      fill: "none",
      stroke: "transparent",
      "stroke-width": Math.max(12, strokeW + 8),
      onMouseEnter: onHover,
      onMouseLeave: onLeave,
      style: "cursor: pointer;",
    }),
    h("path", {
      class: `cg-edge${isHeavy ? " heavy" : ""}${hovered ? " hovered" : ""}`,
      d,
      fill: "none",
      "stroke-width": hovered ? strokeW + 1 : strokeW,
      "marker-end": "url(#cg-arrow)",
      style: "pointer-events: none;",
    }),
  );
}

function EdgeLabel({
  edge,
  fromBox,
  toBox,
  hovered,
}: {
  edge: FlowEdge;
  fromBox: BoxRect;
  toBox: BoxRect;
  hovered: boolean;
}) {
  const fromCx = fromBox.x + fromBox.w / 2;
  const fromCy = fromBox.y + fromBox.h / 2;
  const toCx = toBox.x + toBox.w / 2;
  const toCy = toBox.y + toBox.h / 2;

  const from = boxEdgeAnchor(fromBox, toCx, toCy);
  const to = boxEdgeAnchor(toBox, fromCx, fromCy);

  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;

  return h("text", {
    class: `cg-edge-label${hovered ? " visible" : ""}`,
    x: mx,
    y: my - 8,
    "text-anchor": "middle",
  }, `${edge.weight} call${edge.weight !== 1 ? "s" : ""}`);
}

function ZoneBox({
  zone,
  box,
  expanded,
  dimmed,
  searchQ,
  matchingFiles,
  fileConnections,
  onToggle,
  onSelectZone,
  onSelectFile,
  onDblClickFile,
}: {
  zone: ZoneData;
  box: BoxRect;
  expanded: boolean;
  dimmed: boolean;
  searchQ: string;
  matchingFiles: Set<string>;
  fileConnections: FileConnectionMap;
  onToggle: () => void;
  onSelectZone: () => void;
  onSelectFile: (path: string) => void;
  onDblClickFile: (path: string) => void;
}) {
  const fileCount = zone.files.length;
  const visibleFiles = zone.files.slice(0, FILE_ROWS_MAX);
  const overflow = fileCount - FILE_ROWS_MAX;

  return h("g", {
    class: `cg-zone-box${expanded ? " expanded" : ""}${dimmed ? " search-dim" : ""}`,
    onClick: (e: Event) => { e.stopPropagation(); onToggle(); onSelectZone(); },
    style: "cursor: pointer;",
  },
    h("rect", {
      class: "cg-zone-rect",
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      rx: 8,
      style: `--zone-color: ${zone.color};`,
    }),
    h("rect", {
      x: box.x,
      y: box.y,
      width: 4,
      height: box.h,
      rx: 2,
      fill: zone.color,
      style: "pointer-events: none;",
    }),
    h("text", {
      class: "cg-zone-name",
      x: box.x + 14,
      y: box.y + 22,
    }, zone.name),
    h("text", {
      class: "cg-zone-stats",
      x: box.x + 14,
      y: box.y + 40,
    }, `${fileCount} file${fileCount !== 1 ? "s" : ""} \u00B7 ${zone.totalFunctions} fn`),
    h("text", {
      class: "cg-zone-stats",
      x: box.x + 14,
      y: box.y + 56,
    },
      `${zone.internalCalls + zone.crossZoneCalls} calls`,
      zone.crossZoneCalls > 0 ? ` \u00B7 ${zone.crossZoneCalls} cross-zone` : "",
    ),
    h("text", {
      class: "cg-zone-expand-icon",
      x: box.x + box.w - 18,
      y: box.y + 22,
      "text-anchor": "end",
    }, expanded ? "\u25B4" : "\u25BE"),

    expanded
      ? h("g", null,
          h("line", {
            x1: box.x + 8,
            y1: box.y + BOX_H_COLLAPSED - 12,
            x2: box.x + box.w - 8,
            y2: box.y + BOX_H_COLLAPSED - 12,
            class: "cg-zone-divider",
          }),
          ...visibleFiles.map((file, i) => {
            const fy = box.y + BOX_H_COLLAPSED - 4 + i * FILE_ROW_H;
            const isMatch = !searchQ || matchingFiles.has(file.path);
            const hasCrossZone = fileConnections.has(file.path);
            return h(FileRow, {
              key: file.path,
              file,
              y: fy,
              boxX: box.x,
              boxW: box.w,
              searchMatch: searchQ ? isMatch : false,
              hasCrossZone,
              onClick: () => onSelectFile(file.path),
              onDblClick: () => onDblClickFile(file.path),
            });
          }),
          overflow > 0
            ? h("text", {
                class: "cg-file-overflow",
                x: box.x + 14,
                y: box.y + BOX_H_COLLAPSED - 4 + FILE_ROWS_MAX * FILE_ROW_H + 14,
              }, `+${overflow} more`)
            : null,
        )
      : null,
  );
}

function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  return h("div", { class: "cg-zoom-controls" },
    h("button", {
      class: "cg-zoom-btn",
      onClick: onZoomIn,
      title: "Zoom in",
      "aria-label": "Zoom in",
    }, "+"),
    h("button", {
      class: "cg-zoom-btn",
      onClick: onZoomOut,
      title: "Zoom out",
      "aria-label": "Zoom out",
    }, "\u2212"),
    h("button", {
      class: "cg-zoom-btn",
      onClick: onFit,
      title: "Fit to content",
      "aria-label": "Fit to content",
    }, "\u2922"),
  );
}

function ZoneDiagram({
  zones,
  edges,
  expandedZones,
  searchQ,
  fileConnections,
  onToggleZone,
  onSelectZone,
  onSelectFile,
  onDblClickFile,
}: {
  zones: ZoneData[];
  edges: FlowEdge[];
  expandedZones: Set<string>;
  searchQ: string;
  fileConnections: FileConnectionMap;
  onToggleZone: (id: string) => void;
  onSelectZone: (zd: ZoneData) => void;
  onSelectFile: (path: string) => void;
  onDblClickFile: (path: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; vbx: number; vby: number } | null>(null);

  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  const { boxes, totalW, totalH } = useMemo(
    () => computeZoneLayout(zones, edges, expandedZones),
    [zones, edges, expandedZones],
  );

  const fitVB = useMemo((): ViewBox => ({
    x: 0,
    y: 0,
    w: Math.max(totalW, 400),
    h: Math.max(totalH, 300),
  }), [totalW, totalH]);

  const [viewBox, setViewBox] = useState<ViewBox>(fitVB);

  useEffect(() => {
    setViewBox(fitVB);
  }, [fitVB]);

  const maxWeight = useMemo(() => {
    let max = 1;
    for (const e of edges) if (e.weight > max) max = e.weight;
    return max;
  }, [edges]);

  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of edges) {
      const key = [e.from, e.to].sort().join("|");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  const pairIndices = useMemo(() => {
    const indices = new Map<string, number>();
    const counters = new Map<string, number>();
    for (const e of edges) {
      const key = [e.from, e.to].sort().join("|");
      const idx = counters.get(key) ?? 0;
      indices.set(`${e.from}->${e.to}`, idx);
      counters.set(key, idx + 1);
    }
    return indices;
  }, [edges]);

  const { dimmedZones, matchingFilesByZone } = useMemo(() => {
    if (!searchQ) return { dimmedZones: new Set<string>(), matchingFilesByZone: new Map<string, Set<string>>() };

    const q = searchQ.toLowerCase();
    const dimmed = new Set<string>();
    const matching = new Map<string, Set<string>>();

    for (const z of zones) {
      const zoneNameMatch = z.name.toLowerCase().includes(q);
      const fileMatches = new Set<string>();
      for (const f of z.files) {
        if (f.path.toLowerCase().includes(q) ||
            f.functions.some((fi) => fi.fn.qualifiedName.toLowerCase().includes(q))) {
          fileMatches.add(f.path);
        }
      }
      matching.set(z.id, fileMatches);
      if (!zoneNameMatch && fileMatches.size === 0) {
        dimmed.add(z.id);
      }
    }

    return { dimmedZones: dimmed, matchingFilesByZone: matching };
  }, [zones, searchQ]);

  // Build file-level edges for expanded zones
  const fileEdgeElements = useMemo(() => {
    const elements: Array<{ key: string; d: string; color: string; weight: number }> = [];

    for (const edge of edges) {
      const fromBox = boxes.get(edge.from);
      const toBox = boxes.get(edge.to);
      if (!fromBox || !toBox) continue;

      const fromExpanded = expandedZones.has(edge.from);
      const toExpanded = expandedZones.has(edge.to);
      if (!fromExpanded && !toExpanded) continue;

      // Source zone is expanded: draw from files to target zone
      if (fromExpanded) {
        const fromZone = zoneById.get(edge.from);
        if (!fromZone) continue;
        const visibleFiles = fromZone.files.slice(0, FILE_ROWS_MAX);
        for (let i = 0; i < visibleFiles.length; i++) {
          const file = visibleFiles[i];
          const conns = fileConnections.get(file.path);
          if (!conns) continue;
          const link = conns.find((c) => c.targetZoneId === edge.to);
          if (!link) continue;

          const fy = fileRowY(fromBox, i);
          const targetZone = zoneById.get(edge.to);
          elements.push({
            key: `fe-${file.path}-${edge.to}`,
            d: computeFileEdgePath(fromBox, fy, toBox),
            color: targetZone?.color ?? "var(--border-strong)",
            weight: link.weight,
          });
        }
      }

      // Target zone is expanded: draw from source zone to files
      if (toExpanded && !fromExpanded) {
        const toZone = zoneById.get(edge.to);
        if (!toZone) continue;
        const visibleFiles = toZone.files.slice(0, FILE_ROWS_MAX);
        for (let i = 0; i < visibleFiles.length; i++) {
          const file = visibleFiles[i];
          const conns = fileConnections.get(file.path);
          if (!conns) continue;
          const link = conns.find((c) => c.targetZoneId === edge.from);
          if (!link) continue;

          const fy = fileRowY(toBox, i);
          const sourceZone = zoneById.get(edge.from);
          elements.push({
            key: `fe-${edge.from}-${file.path}`,
            d: computeFileEdgePath(toBox, fy, fromBox),
            color: sourceZone?.color ?? "var(--border-strong)",
            weight: link.weight,
          });
        }
      }
    }

    return elements;
  }, [edges, boxes, expandedZones, zoneById, fileConnections]);

  // Determine which zone-level edges should be hidden (replaced by file edges)
  const hiddenZoneEdges = useMemo(() => {
    const hidden = new Set<string>();
    for (const edge of edges) {
      const fromExpanded = expandedZones.has(edge.from);
      const toExpanded = expandedZones.has(edge.to);
      if (fromExpanded || toExpanded) {
        // Check if any file edges exist for this zone pair
        const hasFileEdges = fileEdgeElements.some((fe) =>
          fe.key.includes(edge.from) || fe.key.includes(edge.to),
        );
        if (hasFileEdges) hidden.add(`${edge.from}->${edge.to}`);
      }
    }
    return hidden;
  }, [edges, expandedZones, fileEdgeElements]);

  // Pan/zoom handlers
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;

    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;

    setViewBox((vb) => {
      const newW = vb.w * zoomFactor;
      const newH = vb.h * zoomFactor;
      const newX = vb.x + (vb.w - newW) * fx;
      const newY = vb.y + (vb.h - newH) * fy;
      return { x: newX, y: newY, w: newW, h: newH };
    });
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if ((e.target as Element)?.closest(".cg-zone-box")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, vbx: viewBox.x, vby: viewBox.y };
  }, [viewBox]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !dragStart.current || !svgRef.current) return;

    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = viewBox.w / rect.width;
    const scaleY = viewBox.h / rect.height;

    const dx = (e.clientX - dragStart.current.x) * scaleX;
    const dy = (e.clientY - dragStart.current.y) * scaleY;

    setViewBox((vb) => ({
      ...vb,
      x: dragStart.current!.vbx - dx,
      y: dragStart.current!.vby - dy,
    }));
  }, [dragging, viewBox.w, viewBox.h]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    dragStart.current = null;
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onUp = () => { setDragging(false); dragStart.current = null; };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [dragging]);

  const handleZoomIn = useCallback(() => {
    setViewBox((vb) => ({
      x: vb.x + vb.w * 0.1,
      y: vb.y + vb.h * 0.1,
      w: vb.w * 0.8,
      h: vb.h * 0.8,
    }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setViewBox((vb) => ({
      x: vb.x - vb.w * 0.125,
      y: vb.y - vb.h * 0.125,
      w: vb.w * 1.25,
      h: vb.h * 1.25,
    }));
  }, []);

  const handleFit = useCallback(() => {
    setViewBox(fitVB);
  }, [fitVB]);

  if (zones.length === 0) return null;

  const vbStr = `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`;

  return h("div", { class: "cg-diagram-container" },
    h("svg", {
      ref: svgRef,
      class: `cg-diagram${dragging ? " dragging" : ""}`,
      viewBox: vbStr,
      preserveAspectRatio: "xMidYMid meet",
      onWheel: handleWheel,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
    },
      h("defs", null,
        h("marker", {
          id: "cg-arrow",
          viewBox: "0 0 10 8",
          refX: 9,
          refY: 4,
          markerWidth: 8,
          markerHeight: 6,
          orient: "auto-start-reverse",
        },
          h("path", {
            d: "M 0 0 L 10 4 L 0 8 z",
            class: "cg-arrow-marker",
          }),
        ),
      ),

      // Zone-level edges (hidden when expanded zones have file-level edges)
      h("g", { class: "cg-edges" },
        edges.map((edge) => {
          const edgeKey = `${edge.from}->${edge.to}`;
          if (hiddenZoneEdges.has(edgeKey)) return null;

          const fromBox = boxes.get(edge.from);
          const toBox = boxes.get(edge.to);
          if (!fromBox || !toBox) return null;

          const pairKey = [edge.from, edge.to].sort().join("|");
          const total = pairCounts.get(pairKey) ?? 1;
          const idx = pairIndices.get(edgeKey) ?? 0;

          return h(ZoneEdge, {
            key: edgeKey,
            edge,
            fromBox,
            toBox,
            maxWeight,
            edgeIndex: idx,
            totalEdgesBetweenPair: total,
            hovered: hoveredEdge === edgeKey,
            onHover: () => setHoveredEdge(edgeKey),
            onLeave: () => setHoveredEdge(null),
          });
        }),
      ),

      // File-level edges (from expanded zone files to other zones)
      h("g", { class: "cg-file-edges" },
        fileEdgeElements.map((fe) =>
          h("path", {
            key: fe.key,
            class: "cg-file-edge",
            d: fe.d,
            fill: "none",
            stroke: fe.color,
            "stroke-width": Math.max(1, Math.min(2.5, fe.weight * 0.4 + 0.8)),
            opacity: 0.55,
          }),
        ),
      ),

      // Edge labels (only for visible zone-level edges)
      h("g", { class: "cg-edge-labels" },
        edges.map((edge) => {
          const edgeKey = `${edge.from}->${edge.to}`;
          if (hiddenZoneEdges.has(edgeKey)) return null;

          const fromBox = boxes.get(edge.from);
          const toBox = boxes.get(edge.to);
          if (!fromBox || !toBox) return null;

          return h(EdgeLabel, {
            key: `label-${edgeKey}`,
            edge,
            fromBox,
            toBox,
            hovered: hoveredEdge === edgeKey,
          });
        }),
      ),

      // Zone boxes (rendered last so they're on top)
      h("g", { class: "cg-zones" },
        zones.map((zone) => {
          const box = boxes.get(zone.id);
          if (!box) return null;

          return h(ZoneBox, {
            key: zone.id,
            zone,
            box,
            expanded: expandedZones.has(zone.id),
            dimmed: dimmedZones.has(zone.id),
            searchQ,
            matchingFiles: matchingFilesByZone.get(zone.id) ?? new Set(),
            fileConnections,
            onToggle: () => onToggleZone(zone.id),
            onSelectZone: () => onSelectZone(zone),
            onSelectFile,
            onDblClickFile,
          });
        }),
      ),
    ),

    h(ZoomControls, {
      onZoomIn: handleZoomIn,
      onZoomOut: handleZoomOut,
      onFit: handleFit,
    }),
  );
}

// ── Main component ───────────────────────────────────────────────────

export function CallGraphView({ data, onSelect, navigateTo }: CallGraphViewProps) {
  const { callGraph, zones, imports: importsData } = data;
  const [search, setSearch] = useState("");
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());

  const fileToZoneMap = useMemo(() => buildFileToZoneMap(zones), [zones]);

  const { zoneDataList } = useMemo(() => {
    if (!callGraph) return { zoneDataList: [], unzonedFiles: [] };
    return buildExplorerData(callGraph, fileToZoneMap, zones);
  }, [callGraph, fileToZoneMap, zones]);

  const flowEdges = useMemo(() => {
    const callEdges = callGraph ? buildCallFlowEdges(callGraph.edges, fileToZoneMap) : [];
    const importEdges = importsData && zones
      ? buildExternalImportEdges(importsData.external, fileToZoneMap, zones)
      : [];

    const merged = new Map<string, { from: string; to: string; weight: number }>();
    for (const e of [...callEdges, ...importEdges]) {
      const key = `${e.from}->${e.to}`;
      const existing = merged.get(key);
      if (existing) {
        existing.weight += e.weight;
      } else {
        merged.set(key, { ...e });
      }
    }
    return [...merged.values()];
  }, [callGraph, fileToZoneMap, importsData, zones]);

  const fileConnections = useMemo(() => {
    if (!callGraph) return new Map() as FileConnectionMap;
    return buildFileConnectionMap(
      callGraph,
      importsData?.external ?? [],
      fileToZoneMap,
      zones,
    );
  }, [callGraph, importsData, fileToZoneMap, zones]);

  const crossZoneTotal = useMemo(() => {
    return flowEdges.reduce((sum, e) => sum + e.weight, 0);
  }, [flowEdges]);

  const searchQ = search.toLowerCase();
  const totalFiles = zoneDataList.reduce((sum, zd) => sum + zd.files.length, 0);

  const totalFilteredFiles = useMemo(() => {
    if (!searchQ) return totalFiles;
    let count = 0;
    for (const zd of zoneDataList) {
      for (const f of zd.files) {
        if (f.path.toLowerCase().includes(searchQ) ||
            f.functions.some((fi) => fi.fn.qualifiedName.toLowerCase().includes(searchQ))) {
          count++;
        }
      }
    }
    return count;
  }, [zoneDataList, searchQ, totalFiles]);

  const effectiveExpandedZones = useMemo(() => {
    if (!searchQ) return expandedZones;
    const set = new Set(expandedZones);
    for (const zd of zoneDataList) {
      const nameMatch = zd.name.toLowerCase().includes(searchQ);
      const fileMatch = zd.files.some((f) =>
        f.path.toLowerCase().includes(searchQ) ||
        f.functions.some((fi) => fi.fn.qualifiedName.toLowerCase().includes(searchQ)),
      );
      if (nameMatch || fileMatch) set.add(zd.id);
    }
    return set;
  }, [searchQ, zoneDataList, expandedZones]);

  const toggleZone = useCallback((id: string) => {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleZoneSelect = useCallback((zd: ZoneData) => {
    if (!zones) return;
    const zone = zones.zones.find((z) => z.id === zd.id);
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

  const handleFileSelect = useCallback((filePath: string) => {
    onSelect({
      type: "file",
      title: basename(filePath),
      path: filePath,
      zone: fileToZoneMap.get(filePath)?.name,
    });
  }, [fileToZoneMap, onSelect]);

  const handleFileDblClick = useCallback((filePath: string) => {
    if (navigateTo) navigateTo("files", { file: filePath });
  }, [navigateTo]);

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
      crossZoneTotal > 0 ? ` \u00B7 ${crossZoneTotal} cross-zone` : "",
      summary.cycleCount > 0 ? ` \u00B7 ${summary.cycleCount} cycles` : "",
    ),

    h(SearchFilter, {
      placeholder: "Search functions or files\u2026",
      value: search,
      onInput: setSearch,
      resultCount: searchQ ? totalFilteredFiles : undefined,
      totalCount: searchQ ? totalFiles : undefined,
    }),

    h("div", { style: "display: flex; gap: 16px; margin: 12px 0; flex-wrap: wrap;" },
      h(StatCard, { value: String(summary.totalFunctions), label: "Functions" }),
      h(StatCard, { value: String(summary.totalCalls), label: "Calls" }),
      crossZoneTotal > 0
        ? h(StatCard, { value: String(crossZoneTotal), label: "Cross-Zone", color: "var(--orange)" })
        : null,
      summary.cycleCount > 0
        ? h(StatCard, { value: String(summary.cycleCount), label: "Cycles", color: "var(--orange)" })
        : null,
    ),

    zoneDataList.length > 0
      ? h(ZoneDiagram, {
          zones: zoneDataList,
          edges: flowEdges,
          expandedZones: effectiveExpandedZones,
          searchQ,
          fileConnections,
          onToggleZone: toggleZone,
          onSelectZone: handleZoneSelect,
          onSelectFile: handleFileSelect,
          onDblClickFile: handleFileDblClick,
        })
      : null,

    h(CallGraphSummaryTables, { summary }),
  );
}

// ── Summary tables ────────────────────────────────────────────────────

interface SummaryTablesProps {
  summary: CallGraph["summary"];
}

function CallGraphSummaryTables({ summary }: SummaryTablesProps) {
  const hasMostCalled = summary.mostCalled.length > 0;
  const hasMostCalling = summary.mostCalling.length > 0;
  if (!hasMostCalled && !hasMostCalling) return null;

  return h(CollapsibleSection, {
    title: "Top Functions",
    count: undefined,
    defaultOpen: false,
  },
    h("div", { style: "display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 8px;" },
      hasMostCalled
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
                    h("td", { style: "padding: 4px 8px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" }, basename(item.file)),
                    h("td", { style: "padding: 4px 8px; text-align: right; font-weight: 600;" }, String(item.callerCount)),
                  ),
                ),
              ),
            ),
          )
        : null,

      hasMostCalling
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
                    h("td", { style: "padding: 4px 8px; color: var(--text-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;" }, basename(item.file)),
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

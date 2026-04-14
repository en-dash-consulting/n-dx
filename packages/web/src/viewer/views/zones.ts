/**
 * Zones — SVG box-and-line zone diagram with slideout details.
 *
 * Zones rendered as rectangular boxes on a topology-aware grid,
 * connected by Bézier edges weighted by call traffic.
 * Zones expand on click to reveal file rows inside.
 * When expanded, file-level edges show which files bridge zones.
 * Clicking a zone opens a slideout panel with details.
 */

import { h } from "preact";
import { useState, useMemo, useCallback, useEffect } from "preact/hooks";
import type { LoadedData, DetailItem, NavigateTo } from "../types.js";
import type { CallGraph, Zone, ZoneCrossing } from "../external.js";
import {
  CollapsibleSection,
  buildFileToZoneMap,
  buildFlowEdges,
  buildCallFlowEdges,
  buildExternalImportEdges,
  getZoneColorByIndex,
} from "../visualization/index.js";
import { basename } from "../utils.js";
import { SearchFilter } from "../components/index.js";
import { BrandedHeader } from "../components/index.js";
import { ZoneSlideout } from "../components/index.js";
import type {
  ZoneData,
  BoxRect,
  FlowEdge,
  FileConnectionMap,
  FileToFileMap,
  FileInfo,
  ZoneBreadcrumb,
  ExpandedSubZones,
} from "./zone-types.js";
import { usePanZoom, useZoneDrag, useFileEdges, useSubZoneEdges } from "../hooks/index.js";

// ── Re-export types for downstream consumers ─────────────────────────
export type { ZoneData, BoxRect, FlowEdge, FileConnectionMap, FileToFileMap, ZoneBreadcrumb } from "./zone-types.js";

// ── Types ────────────────────────────────────────────────────────────

interface ZonesViewProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  navigateTo?: NavigateTo;
}

// ── Constants ────────────────────────────────────────────────────────

const BOX_W = 200;
const BOX_H_COLLAPSED = 80;
const FILE_ROW_H = 22;
const FILE_ROWS_MAX = 15;
const GAP_X = 80;
const GAP_Y = 60;
const PADDING = 40;
const SUBZONE_ROW_H = 28;
const SUBZONE_ROWS_MAX = 10;
const SUBZONE_FILE_INDENT = 12;

// ── Data transformation ──────────────────────────────────────────────

/**
 * Convert raw Zone sub-zones into ZoneData for drill-down display.
 * Uses zone metadata only (file counts, descriptions) since full call
 * graph enrichment is scoped to the top-level analysis.
 *
 * @internal Exported for testing.
 */
export function convertSubZones(subZones: Zone[]): ZoneData[] {
  return subZones.map((sz, i) => {
    const subData: ZoneData = {
      id: sz.id,
      name: sz.name,
      color: getZoneColorByIndex(i),
      description: sz.description,
      cohesion: sz.cohesion,
      coupling: sz.coupling,
      files: [],
      totalFiles: sz.files.length,
      totalFunctions: 0,
      internalCalls: 0,
      crossZoneCalls: 0,
    };

    // Recurse if deeper levels exist
    if (sz.subZones && sz.subZones.length > 0) {
      subData.subZones = convertSubZones(sz.subZones);
      subData.subCrossings = convertCrossings(sz.subCrossings);
      subData.hasDrillDown = true;
    }

    return subData;
  });
}

/**
 * Convert ZoneCrossing[] to FlowEdge[] (aggregate by zone pair).
 *
 * @internal Exported for testing.
 */
export function convertCrossings(crossings?: ZoneCrossing[]): FlowEdge[] {
  if (!crossings || crossings.length === 0) return [];
  const pairCounts = new Map<string, number>();
  for (const c of crossings) {
    const key = `${c.fromZone}->${c.toZone}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  return [...pairCounts.entries()].map(([key, weight]) => {
    const [from, to] = key.split("->");
    return { from, to, weight };
  });
}

/**
 * Distribute a parent zone's enriched FileInfo[] to each subzone by matching
 * file paths from the raw Zone.files string array.
 */
function enrichSubZoneFiles(
  subZoneData: ZoneData[],
  parentFiles: FileInfo[],
  rawSubZones: Zone[],
): void {
  const fileMap = new Map(parentFiles.map((f) => [f.path, f]));
  for (let i = 0; i < subZoneData.length; i++) {
    const rawSz = rawSubZones[i];
    if (!rawSz) continue;
    const matched: FileInfo[] = [];
    for (const path of rawSz.files) {
      const info = fileMap.get(path);
      if (info) matched.push(info);
    }
    matched.sort((a, b) => b.crossZoneCalls - a.crossZoneCalls || a.path.localeCompare(b.path));
    subZoneData[i].files = matched;
    // Recurse if deeper subzones exist
    if (subZoneData[i].subZones && rawSz.subZones) {
      enrichSubZoneFiles(subZoneData[i].subZones!, matched, rawSz.subZones!);
    }
  }
}

function buildExplorerData(
  callGraph: CallGraph,
  fileToZoneMap: Map<string, { id: string; name: string; color: string }>,
  zones: LoadedData["zones"],
): { zoneDataList: ZoneData[]; unzonedFiles: FileInfo[] } {
  const funcsByFile = new Map<string, import("../../schema/v1.js").FunctionNode[]>();
  for (const fn of callGraph.functions) {
    let list = funcsByFile.get(fn.file);
    if (!list) { list = []; funcsByFile.set(fn.file, list); }
    list.push(fn);
  }

  const funcInfoMap = new Map<string, import("./zone-types.js").FuncInfo>();
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

      const zd: ZoneData = {
        id: z.id,
        name: z.name,
        color: getZoneColorByIndex(i),
        description: z.description,
        cohesion: z.cohesion,
        coupling: z.coupling,
        files,
        totalFiles: z.files.length,
        totalFunctions,
        internalCalls,
        crossZoneCalls,
      };

      // Attach sub-zone data for drill-down when available
      if (z.subZones && z.subZones.length > 0) {
        zd.subZones = convertSubZones(z.subZones);
        enrichSubZoneFiles(zd.subZones, files, z.subZones);
        zd.subCrossings = convertCrossings(z.subCrossings);
        zd.hasDrillDown = true;
      }

      zoneDataList.push(zd);
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
  externalImports: import("../../schema/v1.js").ExternalImport[],
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

/**
 * Build file-to-file cross-zone connection map from call graph edges.
 * Used when both source and target zones are expanded to draw file-level edges.
 */
function buildFileToFileMap(
  callGraph: CallGraph,
  fileToZoneMap: Map<string, { id: string; name: string; color: string }>,
): FileToFileMap {
  const result: FileToFileMap = new Map();

  const addEdge = (from: string, to: string) => {
    let targets = result.get(from);
    if (!targets) { targets = new Map(); result.set(from, targets); }
    targets.set(to, (targets.get(to) ?? 0) + 1);
  };

  for (const e of callGraph.edges) {
    if (!e.calleeFile) continue;
    const fromZone = fileToZoneMap.get(e.callerFile);
    const toZone = fileToZoneMap.get(e.calleeFile);
    if (!fromZone || !toZone || fromZone.id === toZone.id) continue;
    addEdge(e.callerFile, e.calleeFile);
  }

  return result;
}

// ── Layout pure functions ────────────────────────────────────────────

function boxHeight(
  zone: ZoneData,
  expanded: boolean,
  expandedSubZoneIds?: Set<string>,
): number {
  if (!expanded) return BOX_H_COLLAPSED;

  // Zone has subzones → show subzone rows instead of files
  if (zone.subZones && zone.subZones.length > 0) {
    const visibleCount = Math.min(zone.subZones.length, SUBZONE_ROWS_MAX);
    let h = BOX_H_COLLAPSED + visibleCount * SUBZONE_ROW_H + 16;
    // Expanded subzones show nested files
    if (expandedSubZoneIds) {
      for (const sz of zone.subZones.slice(0, SUBZONE_ROWS_MAX)) {
        if (expandedSubZoneIds.has(sz.id)) {
          const fileRows = Math.min(sz.files.length, FILE_ROWS_MAX);
          h += fileRows * FILE_ROW_H + (sz.files.length > FILE_ROWS_MAX ? 20 : 0);
        }
      }
    }
    if (zone.subZones.length > SUBZONE_ROWS_MAX) h += 20;
    return h;
  }

  // No subzones → show files directly
  const rows = Math.min(zone.files.length, FILE_ROWS_MAX);
  return BOX_H_COLLAPSED + rows * FILE_ROW_H + 16 + (zone.files.length > FILE_ROWS_MAX ? 20 : 0);
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

function computeZoneLayout(
  zones: ZoneData[],
  edges: FlowEdge[],
  expandedZones: Set<string>,
  expandedSubZones?: ExpandedSubZones,
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
    const bh = boxHeight(zone, expandedZones.has(id), expandedSubZones?.get(id));
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
      h: boxHeight(zone, expandedZones.has(id), expandedSubZones?.get(id)),
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

/** Chevron separator for zone breadcrumb trail. */
function ZoneBreadcrumbSep() {
  return h("svg", {
    class: "zone-breadcrumb-sep",
    width: 12,
    height: 12,
    viewBox: "0 0 12 12",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.5",
    "stroke-linecap": "round",
    "aria-hidden": "true",
  }, h("path", { d: "M4.5 2.5l3 3.5-3 3.5" }));
}

/**
 * Drill-down breadcrumb trail rendered above the zone diagram.
 *
 * Hidden at root level (drillPath has only the root entry).
 * Clicking a crumb navigates back to that level by truncating the drill path.
 *
 * @internal Exported for testing.
 */
export function ZoneBreadcrumbNav({
  drillPath,
  onNavigate,
}: {
  drillPath: ZoneBreadcrumb[];
  onNavigate: (depth: number) => void;
}) {
  // Hidden at root — no unnecessary UI
  if (drillPath.length <= 1) return null;

  return h("nav", {
    class: "zone-breadcrumb",
    "aria-label": "Zone navigation",
  },
    h("ol", { class: "zone-breadcrumb-list" },
      ...drillPath.map((crumb, i) => {
        const isLast = i === drillPath.length - 1;
        return h("li", {
          key: crumb.zoneId ?? "root",
          class: `zone-breadcrumb-item${isLast ? " zone-breadcrumb-current" : ""}`,
        },
          isLast
            // Current level — plain text, not clickable
            ? h("span", { "aria-current": "location" }, crumb.label)
            // Ancestor level — clickable to pop back
            : [
                h("button", {
                  class: "zone-breadcrumb-link",
                  type: "button",
                  onClick: () => onNavigate(i),
                }, crumb.label),
                ZoneBreadcrumbSep(),
              ],
        );
      }),
    ),
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

function SubZoneRow({
  subZone,
  y,
  boxX,
  boxW,
  expanded,
  onToggle,
}: {
  subZone: ZoneData;
  y: number;
  boxX: number;
  boxW: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const name = subZone.name.length > 14
    ? subZone.name.slice(0, 12) + "\u2026"
    : subZone.name;

  return h("g", {
    class: `cg-subzone-row${expanded ? " expanded" : ""}`,
    style: `--zone-color: ${subZone.color}`,
    onClick: (e: Event) => { e.stopPropagation(); onToggle(); },
  },
    h("rect", {
      class: "cg-subzone-bg",
      x: boxX + 6,
      y,
      width: boxW - 12,
      height: SUBZONE_ROW_H - 2,
      rx: 4,
    }),
    // Color bar
    h("rect", {
      x: boxX + 6,
      y,
      width: 3,
      height: SUBZONE_ROW_H - 2,
      rx: 1.5,
      fill: subZone.color,
      style: "pointer-events: none;",
    }),
    // Name
    h("text", {
      class: "cg-subzone-name",
      x: boxX + 14,
      y: y + 18,
    }, name),
    // File count
    h("text", {
      class: "cg-subzone-stats",
      x: boxX + boxW - 30,
      y: y + 18,
      "text-anchor": "end",
    }, `${subZone.totalFiles}f`),
    // Expand chevron
    h("text", {
      class: "cg-subzone-expand-icon",
      x: boxX + boxW - 16,
      y: y + 18,
      "text-anchor": "end",
    }, expanded ? "\u25B4" : "\u25BE"),
  );
}

function ZoneBox({
  zone,
  box,
  expanded,
  selected,
  dimmed,
  searchQ,
  matchingFiles,
  fileConnections,
  expandedSubZoneIds,
  onToggle,
  onSelectZone,
  onSelectFile,
  onDblClickFile,
  onDrillDown,
  onToggleSubZone,
}: {
  zone: ZoneData;
  box: BoxRect;
  expanded: boolean;
  selected: boolean;
  dimmed: boolean;
  searchQ: string;
  matchingFiles: Set<string>;
  fileConnections: FileConnectionMap;
  expandedSubZoneIds?: Set<string>;
  onToggle: () => void;
  onSelectZone: () => void;
  onSelectFile: (path: string) => void;
  onDblClickFile: (path: string) => void;
  onDrillDown?: () => void;
  onToggleSubZone?: (subZoneId: string) => void;
}) {
  const fileCount = zone.totalFiles;
  const hasSubZones = !!(zone.subZones && zone.subZones.length > 0);

  // Build expanded content elements
  const renderFileContent = () => {
    const visibleFiles = zone.files.slice(0, FILE_ROWS_MAX);
    const overflow = zone.files.length - FILE_ROWS_MAX;
    return [
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
            key: "overflow",
            class: "cg-file-overflow",
            x: box.x + 14,
            y: box.y + BOX_H_COLLAPSED - 4 + FILE_ROWS_MAX * FILE_ROW_H + 14,
          }, `+${overflow} more`)
        : null,
    ];
  };

  const renderSubZoneContent = () => {
    if (!zone.subZones) return [];
    const visible = zone.subZones.slice(0, SUBZONE_ROWS_MAX);
    const overflow = zone.subZones.length - SUBZONE_ROWS_MAX;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elements: any[] = [];
    let curY = box.y + BOX_H_COLLAPSED - 4;

    for (const sz of visible) {
      const szExpanded = expandedSubZoneIds?.has(sz.id) ?? false;
      elements.push(
        h(SubZoneRow, {
          key: sz.id,
          subZone: sz,
          y: curY,
          boxX: box.x,
          boxW: box.w,
          expanded: szExpanded,
          onToggle: () => onToggleSubZone?.(sz.id),
        }),
      );
      curY += SUBZONE_ROW_H;

      // Nested file rows when subzone is expanded
      if (szExpanded) {
        const szFiles = sz.files.slice(0, FILE_ROWS_MAX);
        const szOverflow = sz.files.length - FILE_ROWS_MAX;
        for (let fi = 0; fi < szFiles.length; fi++) {
          const file = szFiles[fi];
          const fy = curY;
          const hasCrossZone = fileConnections.has(file.path);
          elements.push(
            h(FileRow, {
              key: `${sz.id}-${file.path}`,
              file,
              y: fy,
              boxX: box.x + SUBZONE_FILE_INDENT,
              boxW: box.w - SUBZONE_FILE_INDENT,
              searchMatch: searchQ ? matchingFiles.has(file.path) : false,
              hasCrossZone,
              onClick: () => onSelectFile(file.path),
              onDblClick: () => onDblClickFile(file.path),
            }),
          );
          curY += FILE_ROW_H;
        }
        if (szOverflow > 0) {
          elements.push(
            h("text", {
              key: `${sz.id}-overflow`,
              class: "cg-file-overflow",
              x: box.x + SUBZONE_FILE_INDENT + 14,
              y: curY + 14,
            }, `+${szOverflow} more`),
          );
          curY += 20;
        }
      }
    }

    if (overflow > 0) {
      elements.push(
        h("text", {
          key: "sz-overflow",
          class: "cg-file-overflow",
          x: box.x + 14,
          y: curY + 14,
        }, `+${overflow} more sub-zones`),
      );
    }

    return elements;
  };

  return h("g", {
    class: `cg-zone-box${expanded ? " expanded" : ""}${selected ? " selected" : ""}${dimmed ? " search-dim" : ""}`,
    "data-zone-id": zone.id,
    style: "cursor: grab;",
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
    h("g", {
      class: "cg-zone-toggle-btn",
      onMouseDown: (e: Event) => e.stopPropagation(),
      onClick: (e: Event) => { e.stopPropagation(); onToggle(); },
      style: "cursor: pointer;",
    },
      h("rect", {
        x: box.x + box.w - 32,
        y: box.y + 6,
        width: 24,
        height: 22,
        rx: 4,
        fill: "transparent",
        style: "pointer-events: all;",
      }),
      h("text", {
        class: "cg-zone-expand-icon",
        x: box.x + box.w - 18,
        y: box.y + 22,
        "text-anchor": "end",
        style: "pointer-events: none;",
      }, expanded ? "\u25B4" : "\u25BE"),
    ),

    // Drill-down badge — visible only for zones with sub-zones
    zone.hasDrillDown && zone.subZones && onDrillDown
      ? h("g", {
          class: "cg-zone-drill-btn",
          onClick: (e: Event) => { e.stopPropagation(); onDrillDown(); },
        },
          h("rect", {
            x: box.x + box.w - 88,
            y: box.y + 36,
            width: 74,
            height: 20,
            rx: 4,
            class: "cg-drill-btn-bg",
            style: `--zone-color: ${zone.color}`,
          }),
          h("text", {
            x: box.x + box.w - 56,
            y: box.y + 50,
            "text-anchor": "middle",
            class: "cg-drill-btn-label",
          }, `${zone.subZones.length} sub-zones \u203A`),
        )
      : null,

    expanded
      ? h("g", null,
          // Detail button — opens sidebar
          h("g", {
            class: "cg-zone-detail-btn",
            onClick: (e: Event) => { e.stopPropagation(); onSelectZone(); },
          },
            h("title", null, "View zone details"),
            h("rect", {
              x: box.x + box.w - 38,
              y: box.y + 34,
              width: 22,
              height: 22,
              rx: 11,
              class: "cg-detail-btn-bg",
            }),
            h("text", {
              x: box.x + box.w - 27,
              y: box.y + 49,
              "text-anchor": "middle",
              class: "cg-detail-btn-text",
            }, "\u24D8"),
          ),
          h("line", {
            x1: box.x + 8,
            y1: box.y + BOX_H_COLLAPSED - 12,
            x2: box.x + box.w - 8,
            y2: box.y + BOX_H_COLLAPSED - 12,
            class: "cg-zone-divider",
          }),
          ...(hasSubZones ? renderSubZoneContent() : renderFileContent()),
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

// ── ZoneDiagram (decomposed) ─────────────────────────────────────────

function ZoneDiagram({
  zones,
  edges,
  expandedZones,
  expandedSubZones,
  selectedZoneId,
  searchQ,
  fileConnections,
  fileToFileMap,
  onToggleZone,
  onSelectZone,
  onSelectFile,
  onDblClickFile,
  onDblClickZone,
  onDrillDown,
  onToggleSubZone,
}: {
  zones: ZoneData[];
  edges: FlowEdge[];
  expandedZones: Set<string>;
  expandedSubZones: ExpandedSubZones;
  selectedZoneId: string | null;
  searchQ: string;
  fileConnections: FileConnectionMap;
  fileToFileMap: FileToFileMap;
  onToggleZone: (id: string) => void;
  onSelectZone: (zd: ZoneData) => void;
  onSelectFile: (path: string) => void;
  onDblClickFile: (path: string) => void;
  onDblClickZone: (id: string) => void;
  onDrillDown?: (zoneId: string) => void;
  onToggleSubZone: (parentId: string, subZoneId: string) => void;
}) {
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  // Layout computation
  const { boxes: baseBoxes, totalW, totalH } = useMemo(
    () => computeZoneLayout(zones, edges, expandedZones, expandedSubZones),
    [zones, edges, expandedZones, expandedSubZones],
  );

  const fitVB = useMemo(() => ({
    x: 0,
    y: 0,
    w: Math.max(totalW, 400),
    h: Math.max(totalH, 300),
  }), [totalW, totalH]);

  // Extracted hooks for interaction
  const panZoom = usePanZoom(fitVB);
  const zoneDrag = useZoneDrag(panZoom.svgRef, panZoom.viewBox);

  // Apply drag offsets to computed boxes
  const boxes = useMemo(() => {
    if (zoneDrag.dragOffsets.size === 0) return baseBoxes;
    const result = new Map<string, BoxRect>();
    for (const [id, box] of baseBoxes) {
      const off = zoneDrag.dragOffsets.get(id);
      if (off) {
        result.set(id, { ...box, x: box.x + off.dx, y: box.y + off.dy });
      } else {
        result.set(id, box);
      }
    }
    return result;
  }, [baseBoxes, zoneDrag.dragOffsets]);

  // Edge computations (extracted hooks)
  const { fileEdgeElements, hiddenZoneEdges: fileHiddenEdges } = useFileEdges(
    edges, boxes, expandedZones, zoneById, fileConnections, fileToFileMap,
  );
  const { subZoneEdgeElements, hiddenZoneEdges: szHiddenEdges } = useSubZoneEdges(
    edges, boxes, expandedZones, expandedSubZones, zoneById, fileConnections,
  );
  const hiddenZoneEdges = useMemo(() => {
    const merged = new Set(fileHiddenEdges);
    for (const k of szHiddenEdges) merged.add(k);
    return merged;
  }, [fileHiddenEdges, szHiddenEdges]);

  // Edge weight stats
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

  // Search/filter state
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

  // Combined mouse handlers that delegate to zone drag or pan/zoom
  const handleMouseDown = useCallback((e: MouseEvent) => {
    const zoneEl = (e.target as Element)?.closest(".cg-zone-box");
    if (zoneEl) {
      const zoneId = zoneEl.getAttribute("data-zone-id");
      if (zoneId) {
        zoneDrag.startDrag(zoneId, e);
        return;
      }
    }
    panZoom.startPan(e);
  }, [zoneDrag, panZoom]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (zoneDrag.isDragging()) {
      zoneDrag.moveDrag(e);
      return;
    }
    panZoom.movePan(e);
  }, [zoneDrag, panZoom]);

  const handleMouseUp = useCallback((_e: MouseEvent) => {
    const clickedZoneId = zoneDrag.endDrag();
    if (clickedZoneId) {
      const zone = zoneById.get(clickedZoneId);
      if (zone) onSelectZone(zone);
      return;
    }
    panZoom.endPan();
  }, [zoneDrag, panZoom, zoneById, onSelectZone]);

  // Global mouseup listener for edge cases (mouse released outside SVG)
  useEffect(() => {
    const onUp = () => {
      const clickedZoneId = zoneDrag.endDrag();
      if (clickedZoneId) {
        const zone = zoneById.get(clickedZoneId);
        if (zone) onSelectZone(zone);
      }
      panZoom.endPan();
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [zoneDrag, panZoom, zoneById, onSelectZone]);

  if (zones.length === 0) return null;

  const vbStr = `${panZoom.viewBox.x} ${panZoom.viewBox.y} ${panZoom.viewBox.w} ${panZoom.viewBox.h}`;

  return h("div", { class: "cg-diagram-container" },
    h("svg", {
      ref: panZoom.svgRef,
      class: `cg-diagram${panZoom.panning ? " dragging" : ""}`,
      viewBox: vbStr,
      preserveAspectRatio: "xMidYMid meet",
      onWheel: panZoom.handleWheel,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onDblClick: (e: MouseEvent) => {
        const zoneEl = (e.target as Element)?.closest?.(".cg-zone-box[data-zone-id]");
        if (zoneEl) {
          const zoneId = zoneEl.getAttribute("data-zone-id");
          if (zoneId) onDblClickZone(zoneId);
        }
      },
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

      // Subzone-level edges (between subzone rows and external zones)
      h("g", { class: "cg-subzone-edges" },
        subZoneEdgeElements.map((se) =>
          h("path", {
            key: se.key,
            class: se.dashed ? "cg-subzone-edge" : "cg-file-edge",
            d: se.d,
            fill: "none",
            stroke: se.color,
            "stroke-width": Math.max(1, Math.min(2.5, se.weight * 0.4 + 0.8)),
            opacity: se.dashed ? 0.4 : 0.55,
            "stroke-dasharray": se.dashed ? "4 3" : undefined,
          }),
        ),
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
            selected: selectedZoneId === zone.id,
            dimmed: dimmedZones.has(zone.id),
            searchQ,
            matchingFiles: matchingFilesByZone.get(zone.id) ?? new Set(),
            fileConnections,
            expandedSubZoneIds: expandedSubZones.get(zone.id),
            onToggle: () => onToggleZone(zone.id),
            onSelectZone: () => onSelectZone(zone),
            onSelectFile,
            onDblClickFile,
            onDrillDown: zone.hasDrillDown && onDrillDown
              ? () => onDrillDown(zone.id)
              : undefined,
            onToggleSubZone: (szId: string) => onToggleSubZone(zone.id, szId),
          });
        }),
      ),
    ),

    h(ZoomControls, {
      onZoomIn: panZoom.handleZoomIn,
      onZoomOut: panZoom.handleZoomOut,
      onFit: panZoom.handleFit,
    }),
  );
}

// ── Top functions tables ──────────────────────────────────────────────

interface TopFunctionsTablesProps {
  summary: CallGraph["summary"];
}

function TopFunctionsTables({ summary }: TopFunctionsTablesProps) {
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

// ── Main component ───────────────────────────────────────────────────

export function ZonesView({ data, onSelect, navigateTo }: ZonesViewProps) {
  const { zones, callGraph, imports: importsData } = data;
  const [search, setSearch] = useState("");
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [expandedSubZones, setExpandedSubZones] = useState<ExpandedSubZones>(new Map());
  const [slideoutZone, setSlideoutZone] = useState<Zone | null>(null);

  // Zone pins from .n-dx.json (augmented by server onto zones response)
  const pinnedFiles = useMemo(() => {
    const pins = (zones as Record<string, unknown> | null)?.zonePins;
    return pins && typeof pins === "object" && !Array.isArray(pins)
      ? new Set(Object.keys(pins as Record<string, string>))
      : new Set<string>();
  }, [zones]);

  // ── Drill-down navigation state ─────────────────────────────────────
  const ROOT_BREADCRUMB: ZoneBreadcrumb = { zoneId: null, label: "All Zones" };
  const [drillPath, setDrillPath] = useState<ZoneBreadcrumb[]>([ROOT_BREADCRUMB]);

  if (!zones) {
    return h("div", { class: "loading" }, "No zone data available.");
  }

  // Diagram data
  const fileToZoneMap = useMemo(() => buildFileToZoneMap(zones), [zones]);

  const { zoneDataList } = useMemo(() => {
    if (callGraph) {
      return buildExplorerData(callGraph, fileToZoneMap, zones);
    }
    // Fallback: build zone data from zones.json alone (no call graph enrichment)
    if (!zones) return { zoneDataList: [], unzonedFiles: [] };
    const list: ZoneData[] = zones.zones.map((z, i) => {
      const zd: ZoneData = {
        id: z.id,
        name: z.name,
        color: getZoneColorByIndex(i),
        description: z.description,
        cohesion: z.cohesion,
        coupling: z.coupling,
        files: z.files.map((path) => ({ path, functions: [], internalCalls: 0, crossZoneCalls: 0 })),
        totalFiles: z.files.length,
        totalFunctions: 0,
        internalCalls: 0,
        crossZoneCalls: 0,
      };
      if (z.subZones && z.subZones.length > 0) {
        zd.subZones = convertSubZones(z.subZones);
        zd.subCrossings = convertCrossings(z.subCrossings);
        zd.hasDrillDown = true;
      }
      return zd;
    });
    return { zoneDataList: list, unzonedFiles: [] };
  }, [callGraph, fileToZoneMap, zones]);

  const flowEdges = useMemo(() => {
    const crossingEdges = zones ? buildFlowEdges(zones.crossings) : [];
    const callEdges = callGraph ? buildCallFlowEdges(callGraph.edges, fileToZoneMap) : [];
    const importEdges = importsData && zones
      ? buildExternalImportEdges(importsData.external, fileToZoneMap, zones)
      : [];

    const merged = new Map<string, { from: string; to: string; weight: number }>();
    for (const e of [...crossingEdges, ...callEdges, ...importEdges]) {
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

  // ── Drill-down derived data ─────────────────────────────────────────
  // Walk the drill path to resolve the current zone level. At root (depth 0),
  // show top-level zones. When drilled into a zone, show its subZones.
  const { visibleZones, visibleCrossings } = useMemo(() => {
    // Root level — show all top-level zones and top-level flow edges
    if (drillPath.length <= 1) {
      return { visibleZones: zoneDataList, visibleCrossings: flowEdges };
    }

    // Walk the drill path starting from the top-level zone data
    let currentZones: ZoneData[] = zoneDataList;
    let currentCrossings: FlowEdge[] = flowEdges;

    for (let i = 1; i < drillPath.length; i++) {
      const crumb = drillPath[i];
      const parent = currentZones.find((z) => z.id === crumb.zoneId);
      if (!parent?.subZones) {
        // Drill path points to a zone without sub-zones — fall back to parent level
        return { visibleZones: currentZones, visibleCrossings: currentCrossings };
      }
      currentZones = parent.subZones;
      currentCrossings = parent.subCrossings ?? [];
    }

    return { visibleZones: currentZones, visibleCrossings: currentCrossings };
  }, [drillPath, zoneDataList, flowEdges]);

  const fileConnections = useMemo(() => {
    if (!callGraph) return new Map() as FileConnectionMap;
    return buildFileConnectionMap(
      callGraph,
      importsData?.external ?? [],
      fileToZoneMap,
      zones,
    );
  }, [callGraph, importsData, fileToZoneMap, zones]);

  const fileToFileMap = useMemo(() => {
    if (!callGraph) return new Map() as FileToFileMap;
    return buildFileToFileMap(callGraph, fileToZoneMap);
  }, [callGraph, fileToZoneMap]);

  const crossZoneTotal = useMemo(() => {
    return flowEdges.reduce((sum, e) => sum + e.weight, 0);
  }, [flowEdges]);

  // Search
  const searchQ = search.toLowerCase();

  const filteredZones = useMemo(() => {
    if (!search) return zones.zones;
    const q = search.toLowerCase();
    return zones.zones.filter(
      (z) =>
        z.name.toLowerCase().includes(q) ||
        z.description.toLowerCase().includes(q) ||
        z.files.some((f) => f.toLowerCase().includes(q))
    );
  }, [zones.zones, search]);

  const effectiveExpandedZones = useMemo(() => {
    if (!searchQ) return expandedZones;
    const set = new Set(expandedZones);
    for (const zd of visibleZones) {
      const nameMatch = zd.name.toLowerCase().includes(searchQ);
      const fileMatch = zd.files.some((f) =>
        f.path.toLowerCase().includes(searchQ) ||
        f.functions.some((fi) => fi.fn.qualifiedName.toLowerCase().includes(searchQ)),
      );
      if (nameMatch || fileMatch) set.add(zd.id);
    }
    return set;
  }, [searchQ, visibleZones, expandedZones]);

  // Handlers
  const toggleZone = useCallback((id: string) => {
    setExpandedZones((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Clean up subzone expansion state when collapsing
        setExpandedSubZones((prevSz) => {
          if (!prevSz.has(id)) return prevSz;
          const nextSz = new Map(prevSz);
          nextSz.delete(id);
          return nextSz;
        });
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSubZone = useCallback((parentId: string, subZoneId: string) => {
    setExpandedSubZones((prev) => {
      const next = new Map(prev);
      const set = new Set(prev.get(parentId) ?? []);
      if (set.has(subZoneId)) set.delete(subZoneId); else set.add(subZoneId);
      if (set.size === 0) next.delete(parentId); else next.set(parentId, set);
      return next;
    });
  }, []);

  const handleZoneDblClick = useCallback((id: string) => {
    if (!zones) return;
    const zone = zones.zones.find((z) => z.id === id);
    if (zone) setSlideoutZone(zone);
  }, [zones]);

  const handleDiagramZoneSelect = useCallback((zd: ZoneData) => {
    if (!zones) return;
    const zone = zones.zones.find((z) => z.id === zd.id);
    if (!zone) return;
    setSlideoutZone(zone);
  }, [zones]);

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

  const handleSlideoutClose = useCallback(() => {
    setSlideoutZone(null);
  }, []);

  /** Navigate the drill-down breadcrumb: truncate path to the given depth. */
  const handleBreadcrumbNavigate = useCallback((depth: number) => {
    setDrillPath((prev) => prev.slice(0, depth + 1));
    setExpandedZones(new Set());
  }, []);

  /** Drill into a zone: push a new breadcrumb and reset expanded state. */
  const handleDrillDown = useCallback((zoneId: string) => {
    const zone = visibleZones.find((z) => z.id === zoneId);
    if (!zone?.hasDrillDown) return;
    setDrillPath((prev) => [...prev, { zoneId, label: zone.name }]);
    setExpandedZones(new Set());
  }, [visibleZones]);

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Zones"),
    ),
    h("p", { class: "section-sub" },
      drillPath.length <= 1
        ? `${zones.zones.length} zones, ${zones.crossings.length} cross-zone dependencies, ${zones.unzoned.length} unzoned files`
        : `${visibleZones.length} sub-zones in ${drillPath[drillPath.length - 1].label}`,
    ),

    // Search
    h(SearchFilter, {
      placeholder: "Search zones, files...",
      value: search,
      onInput: setSearch,
      resultCount: filteredZones.length,
      totalCount: zones.zones.length,
    }),

    // Stat cards (only when call graph data available)
    callGraph
      ? h("div", { style: "display: flex; gap: 16px; margin: 12px 0; flex-wrap: wrap;" },
          h(StatCard, { value: String(callGraph.summary.totalFunctions), label: "Functions" }),
          h(StatCard, { value: String(callGraph.summary.totalCalls), label: "Calls" }),
          crossZoneTotal > 0
            ? h(StatCard, { value: String(crossZoneTotal), label: "Cross-Zone", color: "var(--orange)" })
            : null,
          callGraph.summary.cycleCount > 0
            ? h(StatCard, { value: String(callGraph.summary.cycleCount), label: "Cycles", color: "var(--orange)" })
            : null,
        )
      : null,

    // Drill-down breadcrumb (hidden at root level)
    h(ZoneBreadcrumbNav, { drillPath, onNavigate: handleBreadcrumbNavigate }),

    // Zone Diagram
    visibleZones.length > 0
      ? h(ZoneDiagram, {
          zones: visibleZones,
          edges: visibleCrossings,
          expandedZones: effectiveExpandedZones,
          expandedSubZones,
          selectedZoneId: slideoutZone?.id ?? null,
          searchQ,
          fileConnections,
          fileToFileMap,
          onToggleZone: toggleZone,
          onSelectZone: handleDiagramZoneSelect,
          onSelectFile: handleFileSelect,
          onDblClickFile: handleFileDblClick,
          onDblClickZone: handleZoneDblClick,
          onDrillDown: handleDrillDown,
          onToggleSubZone: toggleSubZone,
        })
      : null,

    // Unzoned files
    zones.unzoned.length
      ? h(CollapsibleSection, {
          title: "Unzoned Files",
          count: zones.unzoned.length,
          defaultOpen: false,
          threshold: 10,
        },
          ...zones.unzoned.map((f) =>
            h("div", {
              key: f,
              class: "mono-sm text-dim",
              style: "line-height: 1.8",
            }, f)
          )
        )
      : null,

    // Top functions (only when call graph data available)
    callGraph ? h(TopFunctionsTables, { summary: callGraph.summary }) : null,

    // Zone slideout panel
    h(ZoneSlideout, {
      zone: slideoutZone,
      crossings: zones.crossings,
      allZones: zones.zones,
      pinnedFiles,
      onClose: handleSlideoutClose,
      onFileClick: handleFileSelect,
      navigateTo,
    }),
  );
}

/**
 * The Zones diagram's model: turning analysis data into zone boxes, file rows
 * and cross-zone connections, and laying the boxes out. Pure functions, kept
 * apart from the components in `zones.ts` so they are testable without a DOM.
 *
 * @module web/viewer/views/zones-model
 */

import type { LoadedData } from "../types.js";
import type { CallGraph, ExternalImport, Zone, ZoneCrossing } from "../external.js";
import { getZoneColorByIndex, mapPackagesToZones } from "../visualization/index.js";
import type {
  ZoneData,
  BoxRect,
  FlowEdge,
  FileConnectionMap,
  FileToFileMap,
  FileInfo,
  FileZoneLink,
  FuncInfo,
  ExpandedSubZones,
} from "./zone-types.js";
import { BOX_H_COLLAPSED, FILE_ROW_H, FILE_ROWS_MAX, boxEdgeAnchor } from "./zone-edge-geometry.js";

// ── Constants ────────────────────────────────────────────────────────

const BOX_W = 200;
const GAP_X = 80;
const GAP_Y = 60;
const PADDING = 40;
export const SUBZONE_ROW_H = 28;
export const SUBZONE_ROWS_MAX = 10;
export const SUBZONE_FILE_INDENT = 12;

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
 * Stable-partition a zone's files so cross-zone-connecting files (present in
 * fileConnections with at least one link) render before internal-only files.
 * When connectingOnly is true, internal-only files are dropped entirely.
 *
 * @internal Exported for testing.
 */
export function prioritizeConnectingFiles(
  files: FileInfo[],
  fileConnections: FileConnectionMap,
  connectingOnly: boolean,
): FileInfo[] {
  const connecting: FileInfo[] = [];
  const internal: FileInfo[] = [];
  for (const f of files) {
    const links = fileConnections.get(f.path);
    (links && links.length > 0 ? connecting : internal).push(f);
  }
  return connectingOnly ? connecting : [...connecting, ...internal];
}

/**
 * Apply connecting-file ordering (and per-zone connecting-only filtering) to
 * zone data before layout and rendering. Downstream consumers (boxHeight,
 * useFileEdges, useSubZoneEdges, ZoneBox) all index into zone.files, so the
 * transform must happen once, upstream, to keep row positions, overflow
 * counts, and edge anchors in sync.
 *
 * @internal Exported for testing.
 */
export function applyConnectingFilesOrdering(
  zones: ZoneData[],
  fileConnections: FileConnectionMap,
  connectingOnlyZones: Set<string>,
): ZoneData[] {
  const transform = (zone: ZoneData, connectingOnly: boolean): ZoneData => ({
    ...zone,
    files: prioritizeConnectingFiles(zone.files, fileConnections, connectingOnly),
    subZones: zone.subZones?.map((sz) => transform(sz, connectingOnly)),
  });
  return zones.map((z) => transform(z, connectingOnlyZones.has(z.id)));
}

/**
 * Build the tooltip text for a connecting file row: one line per target zone
 * ("→ <name> · <weight> call(s)"), sorted by weight descending. Links whose
 * target zone is not in the rendered zone list are omitted so the tooltip
 * never shows unknown-zone labels. Returns null when nothing resolves.
 *
 * @internal Exported for testing.
 */
export function buildConnectionsTooltip(
  links: FileZoneLink[] | undefined,
  zoneNameById: Map<string, string>,
): string | null {
  if (!links || links.length === 0) return null;
  const lines = links
    .filter((l) => zoneNameById.has(l.targetZoneId))
    .sort((a, b) => b.weight - a.weight)
    .map((l) => `→ ${zoneNameById.get(l.targetZoneId)} · ${l.weight} call${l.weight === 1 ? "" : "s"}`);
  return lines.length > 0 ? lines.join("\n") : null;
}

/** One vertical segment of a file row's cross-zone indicator bar. */
export interface XZoneBarSegment {
  /** Offset from the top of the bar. */
  y: number;
  h: number;
  color: string;
  /** Accessible label: "Cross-zone: <zone name>, N call(s)". Undefined when no name map supplied. */
  label?: string;
}

/**
 * Split the cross-zone indicator bar into stacked segments, one per target
 * zone, with heights proportional to link weight. Sorted by weight descending
 * to match the tooltip line order. Links whose target zone is not in the
 * rendered zone list are omitted; returns empty when nothing resolves (the
 * caller falls back to the single accent-colored bar).
 *
 * @internal Exported for testing.
 */
export function buildXZoneBarSegments(
  links: FileZoneLink[] | undefined,
  zoneColorById: Map<string, string>,
  barHeight: number,
  zoneNameById?: Map<string, string>,
): XZoneBarSegment[] {
  if (!links || links.length === 0) return [];
  const resolved = links
    .filter((l) => zoneColorById.has(l.targetZoneId))
    .sort((a, b) => b.weight - a.weight);
  const total = resolved.reduce((sum, l) => sum + l.weight, 0);
  if (total <= 0) return [];

  const segments: XZoneBarSegment[] = [];
  let cum = 0;
  for (const link of resolved) {
    const y = (cum / total) * barHeight;
    cum += link.weight;
    const yEnd = (cum / total) * barHeight;
    const zoneName = zoneNameById?.get(link.targetZoneId);
    const label = zoneName
      ? `Cross-zone: ${zoneName}, ${link.weight} call${link.weight === 1 ? "" : "s"}`
      : undefined;
    segments.push({ y, h: yEnd - y, color: zoneColorById.get(link.targetZoneId)!, label });
  }
  return segments;
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

export function buildExplorerData(
  callGraph: CallGraph,
  fileToZoneMap: Map<string, { id: string; name: string; color: string }>,
  zones: LoadedData["zones"],
): { zoneDataList: ZoneData[]; unzonedFiles: FileInfo[] } {
  const funcsByFile = new Map<string, CallGraph["functions"]>();
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
export function buildFileConnectionMap(
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
    const pkgToZone = mapPackagesToZones(externalImports, zones);
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
export function buildFileToFileMap(
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

export function computeZoneLayout(
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

/** Where an edge leaves `fromBox` and enters `toBox`: each border, on the line between the two centres. */
export function edgeEndpoints(fromBox: BoxRect, toBox: BoxRect): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const fromCx = fromBox.x + fromBox.w / 2;
  const fromCy = fromBox.y + fromBox.h / 2;
  const toCx = toBox.x + toBox.w / 2;
  const toCy = toBox.y + toBox.h / 2;
  return {
    from: boxEdgeAnchor(fromBox, toCx, toCy),
    to: boxEdgeAnchor(toBox, fromCx, fromCy),
  };
}

export function computeEdgePath(
  fromBox: BoxRect,
  toBox: BoxRect,
  edgeIndex: number,
  totalEdgesBetweenPair: number,
): string {
  const { from, to } = edgeEndpoints(fromBox, toBox);

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

// ── File highlight edges (hover/select) ──────────────────────────────

/** Reference to the file row currently hovered or pin-selected in the diagram. */
export interface ActiveFileRef {
  path: string;
  zoneId: string;
}

/** One highlight edge from an active file row to a target zone box. */
export interface FileHighlightEdge {
  key: string;
  d: string;
  color: string;
  weight: number;
}

/**
 * Compute the on-screen rect of a file row inside an expanded zone box, or
 * null when the file is not currently visible (zone collapsed upstream, file
 * beyond the row cap, or its subzone not expanded). Mirrors the layout math
 * of renderFileContent / renderSubZoneContent in zones.ts's ZoneBox — keep in sync.
 *
 * @internal Exported for testing.
 */
export function computeFileRowRect(
  zone: ZoneData,
  box: BoxRect,
  filePath: string,
  expandedSubZoneIds?: Set<string>,
): BoxRect | null {
  const rowRect = (x: number, y: number, w: number): BoxRect => ({
    x, y, w, h: FILE_ROW_H - 2, gridCol: box.gridCol, gridRow: box.gridRow,
  });

  // Zone with subzones — walk subzone rows accumulating y like renderSubZoneContent
  if (zone.subZones && zone.subZones.length > 0) {
    let curY = box.y + BOX_H_COLLAPSED - 4;
    for (const sz of zone.subZones.slice(0, SUBZONE_ROWS_MAX)) {
      curY += SUBZONE_ROW_H;
      if (!expandedSubZoneIds?.has(sz.id)) continue;
      const szFiles = sz.files.slice(0, FILE_ROWS_MAX);
      for (const file of szFiles) {
        if (file.path === filePath) {
          return rowRect(box.x + SUBZONE_FILE_INDENT + 8, curY, box.w - SUBZONE_FILE_INDENT - 16);
        }
        curY += FILE_ROW_H;
      }
      if (sz.files.length > FILE_ROWS_MAX) curY += 20;
    }
    return null;
  }

  // Flat file list
  const idx = zone.files.slice(0, FILE_ROWS_MAX).findIndex((f) => f.path === filePath);
  if (idx === -1) return null;
  return rowRect(box.x + 8, box.y + BOX_H_COLLAPSED - 4 + idx * FILE_ROW_H, box.w - 16);
}

/**
 * Build highlight edges from the active (hovered/selected) file row to each
 * cross-zone target's box, plus the set of target zone ids to highlight.
 * Returns null when nothing should be drawn (source zone not expanded, file
 * row not visible, or no on-screen targets). Target zones need not be
 * expanded — edges anchor on the zone box rect either way.
 *
 * @internal Exported for testing.
 */
export function buildFileHighlightEdges(
  active: ActiveFileRef,
  zoneById: Map<string, ZoneData>,
  boxes: Map<string, BoxRect>,
  expandedZones: Set<string>,
  expandedSubZones: ExpandedSubZones,
  fileConnections: FileConnectionMap,
): { targetZoneIds: Set<string>; edges: FileHighlightEdge[] } | null {
  if (!expandedZones.has(active.zoneId)) return null;
  const zone = zoneById.get(active.zoneId);
  const box = boxes.get(active.zoneId);
  if (!zone || !box) return null;

  const rowRect = computeFileRowRect(zone, box, active.path, expandedSubZones.get(active.zoneId));
  if (!rowRect) return null;

  const targetZoneIds = new Set<string>();
  const edges: FileHighlightEdge[] = [];
  for (const link of fileConnections.get(active.path) ?? []) {
    if (link.targetZoneId === active.zoneId) continue;
    const targetBox = boxes.get(link.targetZoneId);
    if (!targetBox) continue;
    targetZoneIds.add(link.targetZoneId);
    edges.push({
      key: `hl-${active.path}-${link.targetZoneId}`,
      d: computeEdgePath(rowRect, targetBox, 0, 1),
      color: zoneById.get(link.targetZoneId)?.color ?? "var(--border-strong)",
      weight: link.weight,
    });
  }

  return edges.length > 0 ? { targetZoneIds, edges } : null;
}

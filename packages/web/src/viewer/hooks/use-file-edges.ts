/**
 * useFileEdges — Compute file-level cross-zone edges for the zone diagram.
 *
 * When zone boxes are expanded, this hook computes the SVG paths connecting
 * individual files across zones, replacing the coarser zone-to-zone edges.
 */

import { useMemo } from "preact/hooks";
import type { FileConnectionMap, FileToFileMap, ZoneData, FlowEdge, BoxRect } from "../views/zone-types.js";

const FILE_ROW_H = 22;
const BOX_H_COLLAPSED = 80;
const FILE_ROWS_MAX = 15;

interface FileEdgeElement {
  key: string;
  d: string;
  color: string;
  weight: number;
}

/** Get the Y center of a file row within an expanded zone box. */
function fileRowY(box: BoxRect, fileIndex: number): number {
  return box.y + BOX_H_COLLAPSED - 4 + fileIndex * FILE_ROW_H + FILE_ROW_H / 2;
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

/** Compute a cubic Bézier between two file rows in different expanded zone boxes. */
function computeFileToFileEdgePath(
  fromBox: BoxRect,
  fromFileY: number,
  toBox: BoxRect,
  toFileY: number,
): string {
  const goRight = toBox.x > fromBox.x;
  const fromX = goRight ? fromBox.x + fromBox.w : fromBox.x;
  const toX = goRight ? toBox.x : toBox.x + toBox.w;
  const fromY = Math.max(fromBox.y + 4, Math.min(fromFileY, fromBox.y + fromBox.h - 4));
  const toY = Math.max(toBox.y + 4, Math.min(toFileY, toBox.y + toBox.h - 4));

  const dx = toX - fromX;
  const cp1x = fromX + dx * 0.4;
  const cp1y = fromY;
  const cp2x = fromX + dx * 0.6;
  const cp2y = toY;

  return `M ${fromX} ${fromY} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${toX} ${toY}`;
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

export interface FileEdgesResult {
  fileEdgeElements: FileEdgeElement[];
  hiddenZoneEdges: Set<string>;
}

/**
 * Compute file-level edges for expanded zones and determine which zone-level
 * edges should be hidden (replaced by file-level detail).
 */
export function useFileEdges(
  edges: FlowEdge[],
  boxes: Map<string, BoxRect>,
  expandedZones: Set<string>,
  zoneById: Map<string, ZoneData>,
  fileConnections: FileConnectionMap,
  fileToFileMap: FileToFileMap,
): FileEdgesResult {
  const fileEdgeElements = useMemo(() => {
    const elements: FileEdgeElement[] = [];

    for (const edge of edges) {
      const fromBox = boxes.get(edge.from);
      const toBox = boxes.get(edge.to);
      if (!fromBox || !toBox) continue;

      const fromExpanded = expandedZones.has(edge.from);
      const toExpanded = expandedZones.has(edge.to);
      if (!fromExpanded && !toExpanded) continue;

      const fromZone = zoneById.get(edge.from);
      const toZone = zoneById.get(edge.to);

      // Skip edges for zones expanded with subzones — handled by useSubZoneEdges
      if (fromExpanded && fromZone?.subZones?.length) continue;
      if (toExpanded && toZone?.subZones?.length) continue;

      // Both zones expanded: try file-to-file edges, fall back to file-to-zone
      if (fromExpanded && toExpanded) {
        if (!fromZone || !toZone) continue;
        buildBothExpandedEdges(elements, fromZone, toZone, fromBox, toBox, edge, fileToFileMap, fileConnections);
        continue;
      }

      // Only source zone expanded: draw from files to target zone box
      if (fromExpanded) {
        if (!fromZone) continue;
        buildOneExpandedEdges(elements, fromZone, fromBox, toBox, edge.to, toZone?.color ?? "var(--border-strong)", fileConnections);
        continue;
      }

      // Only target zone expanded: draw from source zone box to files
      if (!toZone) continue;
      buildOneExpandedEdges(elements, toZone, toBox, fromBox, edge.from, fromZone?.color ?? "var(--border-strong)", fileConnections);
    }

    return elements;
  }, [edges, boxes, expandedZones, zoneById, fileConnections, fileToFileMap]);

  const hiddenZoneEdges = useMemo(() => {
    const hidden = new Set<string>();
    for (const edge of edges) {
      const fromExpanded = expandedZones.has(edge.from);
      const toExpanded = expandedZones.has(edge.to);
      if (fromExpanded || toExpanded) {
        const hasFileEdges = fileEdgeElements.some((fe) =>
          fe.key.includes(edge.from) || fe.key.includes(edge.to),
        );
        if (hasFileEdges) hidden.add(`${edge.from}->${edge.to}`);
      }
    }
    return hidden;
  }, [edges, expandedZones, fileEdgeElements]);

  return { fileEdgeElements, hiddenZoneEdges };
}

// ── Internal helpers ──────────────────────────────────────────────────

function buildBothExpandedEdges(
  elements: FileEdgeElement[],
  fromZone: ZoneData,
  toZone: ZoneData,
  fromBox: BoxRect,
  toBox: BoxRect,
  edge: FlowEdge,
  fileToFileMap: FileToFileMap,
  fileConnections: FileConnectionMap,
): void {
  const fromFiles = fromZone.files.slice(0, FILE_ROWS_MAX);
  const toFiles = toZone.files.slice(0, FILE_ROWS_MAX);
  const toFileIndex = new Map(toFiles.map((f, i) => [f.path, i]));

  let hasF2F = false;

  // Try file-to-file edges (from call graph data)
  for (let fi = 0; fi < fromFiles.length; fi++) {
    const srcFile = fromFiles[fi];
    const targets = fileToFileMap.get(srcFile.path);
    if (!targets) continue;

    for (const [tgtPath, weight] of targets) {
      const ti = toFileIndex.get(tgtPath);
      if (ti === undefined) continue;
      hasF2F = true;

      const fromY = fileRowY(fromBox, fi);
      const toY = fileRowY(toBox, ti);
      elements.push({
        key: `ff-${srcFile.path}-${tgtPath}`,
        d: computeFileToFileEdgePath(fromBox, fromY, toBox, toY),
        color: toZone.color,
        weight,
      });
    }
  }

  // Also check reverse direction for file-to-file
  const fromFileIndex = new Map(fromFiles.map((f, i) => [f.path, i]));
  for (let ti = 0; ti < toFiles.length; ti++) {
    const srcFile = toFiles[ti];
    const targets = fileToFileMap.get(srcFile.path);
    if (!targets) continue;

    for (const [tgtPath, weight] of targets) {
      const fi = fromFileIndex.get(tgtPath);
      if (fi === undefined) continue;
      const dupeKey = `ff-${tgtPath}-${srcFile.path}`;
      if (elements.some((el) => el.key === dupeKey)) continue;
      hasF2F = true;

      const fromY = fileRowY(toBox, ti);
      const toY = fileRowY(fromBox, fi);
      elements.push({
        key: `ff-${srcFile.path}-${tgtPath}`,
        d: computeFileToFileEdgePath(toBox, fromY, fromBox, toY),
        color: fromZone.color,
        weight,
      });
    }
  }

  // Fallback: no file-to-file data → draw file-to-zone from both sides
  if (!hasF2F) {
    for (let i = 0; i < fromFiles.length; i++) {
      const file = fromFiles[i];
      const conns = fileConnections.get(file.path);
      if (!conns) continue;
      const link = conns.find((c) => c.targetZoneId === edge.to);
      if (!link) continue;
      elements.push({
        key: `fe-${file.path}-${edge.to}`,
        d: computeFileEdgePath(fromBox, fileRowY(fromBox, i), toBox),
        color: toZone.color,
        weight: link.weight,
      });
    }
    for (let i = 0; i < toFiles.length; i++) {
      const file = toFiles[i];
      const conns = fileConnections.get(file.path);
      if (!conns) continue;
      const link = conns.find((c) => c.targetZoneId === edge.from);
      if (!link) continue;
      elements.push({
        key: `fe-${edge.from}-${file.path}`,
        d: computeFileEdgePath(toBox, fileRowY(toBox, i), fromBox),
        color: fromZone.color,
        weight: link.weight,
      });
    }
  }
}

function buildOneExpandedEdges(
  elements: FileEdgeElement[],
  expandedZone: ZoneData,
  expandedBox: BoxRect,
  otherBox: BoxRect,
  otherZoneId: string,
  edgeColor: string,
  fileConnections: FileConnectionMap,
): void {
  const visibleFiles = expandedZone.files.slice(0, FILE_ROWS_MAX);
  for (let i = 0; i < visibleFiles.length; i++) {
    const file = visibleFiles[i];
    const conns = fileConnections.get(file.path);
    if (!conns) continue;
    const link = conns.find((c) => c.targetZoneId === otherZoneId);
    if (!link) continue;

    const fy = fileRowY(expandedBox, i);
    elements.push({
      key: `fe-${file.path}-${otherZoneId}`,
      d: computeFileEdgePath(expandedBox, fy, otherBox),
      color: edgeColor,
      weight: link.weight,
    });
  }
}

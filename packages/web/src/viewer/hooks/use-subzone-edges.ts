/**
 * useSubZoneEdges — Compute subzone-level edges for the zone diagram.
 *
 * When a zone with subzones is expanded inline, this hook produces:
 * 1. Internal subCrossing edges (dashed arcs between subzone rows)
 * 2. External-to-subzone edges (from external zone boxes to specific subzone rows)
 */

import { useMemo } from "preact/hooks";
import type { ZoneData, FlowEdge, BoxRect, FileConnectionMap, ExpandedSubZones } from "../views/zone-types.js";
import {
  BOX_H_COLLAPSED,
  FILE_ROW_H,
  FILE_ROWS_MAX,
  boxEdgeAnchor,
  clampToBox,
  edgeCurve,
} from "../views/zone-edge-geometry.js";

const SUBZONE_ROW_H = 28;
const SUBZONE_ROWS_MAX = 10;

interface SubZoneEdgeElement {
  key: string;
  d: string;
  color: string;
  weight: number;
  dashed?: boolean;
}

export interface SubZoneEdgesResult {
  subZoneEdgeElements: SubZoneEdgeElement[];
  hiddenZoneEdges: Set<string>;
}

/**
 * Get the Y center of a subzone row within an expanded zone box,
 * accounting for any expanded subzones above it that show nested files.
 */
function subZoneRowY(
  box: BoxRect,
  subZones: ZoneData[],
  targetIndex: number,
  expandedSubZoneIds?: Set<string>,
): number {
  let y = box.y + BOX_H_COLLAPSED - 4;
  const limit = Math.min(targetIndex, SUBZONE_ROWS_MAX);
  for (let i = 0; i < limit; i++) {
    y += SUBZONE_ROW_H;
    if (expandedSubZoneIds?.has(subZones[i].id)) {
      const fileRows = Math.min(subZones[i].files.length, FILE_ROWS_MAX);
      y += fileRows * FILE_ROW_H + (subZones[i].files.length > FILE_ROWS_MAX ? 20 : 0);
    }
  }
  return y + SUBZONE_ROW_H / 2;
}

export function useSubZoneEdges(
  edges: FlowEdge[],
  boxes: Map<string, BoxRect>,
  expandedZones: Set<string>,
  expandedSubZones: ExpandedSubZones,
  zoneById: Map<string, ZoneData>,
  fileConnections: FileConnectionMap,
): SubZoneEdgesResult {
  const subZoneEdgeElements = useMemo(() => {
    const elements: SubZoneEdgeElement[] = [];

    for (const [zoneId, zone] of zoneById) {
      if (!expandedZones.has(zoneId)) continue;
      if (!zone.subZones || zone.subZones.length === 0) continue;

      const box = boxes.get(zoneId);
      if (!box) continue;

      const szIds = expandedSubZones.get(zoneId);
      const visibleSz = zone.subZones.slice(0, SUBZONE_ROWS_MAX);
      const szIndexMap = new Map(visibleSz.map((sz, i) => [sz.id, i]));

      // 1. Internal subCrossing edges (dashed arcs between subzone rows)
      if (zone.subCrossings) {
        for (const crossing of zone.subCrossings) {
          const fromIdx = szIndexMap.get(crossing.from);
          const toIdx = szIndexMap.get(crossing.to);
          if (fromIdx === undefined || toIdx === undefined) continue;

          const fromY = subZoneRowY(box, visibleSz, fromIdx, szIds);
          const toY = subZoneRowY(box, visibleSz, toIdx, szIds);

          // Arc looping to the right of the parent box
          const arcX = box.x + box.w + 30;
          const d = `M ${box.x + box.w} ${fromY} C ${arcX} ${fromY} ${arcX} ${toY} ${box.x + box.w} ${toY}`;

          const fromSz = visibleSz[fromIdx];
          elements.push({
            key: `szc-${zoneId}-${crossing.from}-${crossing.to}`,
            d,
            color: fromSz.color,
            weight: crossing.weight,
            dashed: true,
          });
        }
      }

      // 2. External-to-subzone edges
      // Build file→subzone index map
      const fileToSzIdx = new Map<string, number>();
      for (let i = 0; i < visibleSz.length; i++) {
        for (const file of visibleSz[i].files) {
          fileToSzIdx.set(file.path, i);
        }
      }

      for (const edge of edges) {
        const isFrom = edge.from === zoneId;
        const isTo = edge.to === zoneId;
        if (!isFrom && !isTo) continue;

        const otherZoneId = isFrom ? edge.to : edge.from;
        const otherBox = boxes.get(otherZoneId);
        if (!otherBox) continue;

        // Aggregate weights per subzone
        const szWeights = new Map<number, number>();
        for (const [filePath, conns] of fileConnections) {
          const szIdx = fileToSzIdx.get(filePath);
          if (szIdx === undefined) continue;
          for (const conn of conns) {
            if (conn.targetZoneId === otherZoneId) {
              szWeights.set(szIdx, (szWeights.get(szIdx) ?? 0) + conn.weight);
            }
          }
        }

        for (const [szIdx, weight] of szWeights) {
          const szY = subZoneRowY(box, visibleSz, szIdx, szIds);
          const fromX = otherBox.x > box.x ? box.x + box.w : box.x;
          const clampedY = clampToBox(box, szY);
          const to = boxEdgeAnchor(otherBox, fromX, clampedY);

          const sz = visibleSz[szIdx];
          elements.push({
            key: `sze-${zoneId}-${sz.id}-${otherZoneId}`,
            d: edgeCurve(fromX, clampedY, to.x, to.y),
            color: sz.color,
            weight,
          });
        }
      }
    }

    return elements;
  }, [edges, boxes, expandedZones, expandedSubZones, zoneById, fileConnections]);

  const hiddenZoneEdges = useMemo(() => {
    const hidden = new Set<string>();
    for (const edge of edges) {
      const fromZone = zoneById.get(edge.from);
      const toZone = zoneById.get(edge.to);
      const fromHasSubZones = expandedZones.has(edge.from) && fromZone?.subZones?.length;
      const toHasSubZones = expandedZones.has(edge.to) && toZone?.subZones?.length;
      if (fromHasSubZones || toHasSubZones) {
        const hasSubEdges = subZoneEdgeElements.some((se) =>
          se.key.includes(edge.from) || se.key.includes(edge.to),
        );
        if (hasSubEdges) hidden.add(`${edge.from}->${edge.to}`);
      }
    }
    return hidden;
  }, [edges, expandedZones, zoneById, subZoneEdgeElements]);

  return { subZoneEdgeElements, hiddenZoneEdges };
}

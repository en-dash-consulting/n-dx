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
import { useState, useMemo, useCallback, useEffect, useRef } from "preact/hooks";
import type { LoadedData, DetailItem, NavigateTo } from "../types.js";
import type { CallGraph, Finding, Zone } from "../external.js";
import {
  CollapsibleSection,
  buildFileToZoneMap,
  buildFlowEdges,
  buildCallFlowEdges,
  buildExternalImportEdges,
  getZoneColorByIndex,
} from "../visualization/index.js";
import { basename } from "../utils.js";
import { SearchFilter, BrandedHeader, ZoneSlideout, GlossaryLine } from "../components/index.js";
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
import { BOX_H_COLLAPSED, FILE_ROW_H, FILE_ROWS_MAX } from "./zone-edge-geometry.js";
import {
  SUBZONE_ROW_H,
  SUBZONE_ROWS_MAX,
  SUBZONE_FILE_INDENT,
  applyConnectingFilesOrdering,
  buildConnectionsTooltip,
  buildExplorerData,
  buildFileConnectionMap,
  buildFileHighlightEdges,
  buildFileToFileMap,
  buildXZoneBarSegments,
  computeEdgePath,
  computeZoneLayout,
  convertCrossings,
  convertSubZones,
  edgeEndpoints,
  type ActiveFileRef,
  type XZoneBarSegment,
} from "./zones-model.js";
import { usePanZoom, useZoneDrag, useFileEdges, useSubZoneEdges, useGraphArrowNav } from "../hooks/index.js";

// ── Re-export types for downstream consumers ─────────────────────────
export type { ZoneData, BoxRect, FlowEdge, FileConnectionMap, FileToFileMap, ZoneBreadcrumb } from "./zone-types.js";

// ── Types ────────────────────────────────────────────────────────────

interface ZonesViewProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  /** Reports the zone open in the slideout (null when none), so Sidecar can attach it. */
  onOpenZoneChange?: (id: string | null) => void;
  navigateTo?: NavigateTo;
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
  active,
  xzoneSegments,
  tooltip,
  onClick,
  onDblClick,
  onHover,
}: {
  file: FileInfo;
  y: number;
  boxX: number;
  boxW: number;
  searchMatch: boolean;
  hasCrossZone: boolean;
  active?: boolean;
  /** Per-target-zone indicator bar segments; empty → single accent bar. */
  xzoneSegments?: XZoneBarSegment[];
  tooltip?: string | null;
  onClick: () => void;
  onDblClick: () => void;
  onHover?: (hovering: boolean) => void;
}) {
  const totalIn = file.functions.reduce((s, fi) => s + fi.incoming.length, 0);
  const totalOut = file.functions.reduce((s, fi) => s + fi.outgoing.length, 0);
  const name = basename(file.path);
  const stats = `${file.functions.length}fn`;
  const arrows = `${totalIn > 0 ? "\u2190" + totalIn : ""}${totalOut > 0 ? "\u2192" + totalOut : ""}`;

  return h("g", {
    class: `cg-file-row${searchMatch ? " search-match" : ""}${hasCrossZone ? " cross-zone" : ""}${active ? " active" : ""}`,
    role: "button",
    "aria-label": `Select file ${file.path}${hasCrossZone ? " (cross-zone connections)" : ""}`,
    onClick: (e: Event) => { e.stopPropagation(); onClick(); },
    onDblClick: (e: Event) => { e.stopPropagation(); onDblClick(); },
    onMouseEnter: onHover ? () => onHover(true) : undefined,
    onMouseLeave: onHover ? () => onHover(false) : undefined,
  },
    tooltip ? h("title", null, tooltip) : null,
    h("rect", {
      class: "cg-file-bg",
      x: boxX + 8,
      y,
      width: boxW - 16,
      height: FILE_ROW_H - 2,
      rx: 3,
    }),
    // Cross-zone indicator bar — one segment per target zone, colored to
    // match the target's zone box; single accent bar when none resolve
    hasCrossZone
      ? (xzoneSegments && xzoneSegments.length > 0
          ? h("g", { class: "cg-file-xzone-segments" },
              xzoneSegments.map((seg, si) =>
                h("rect", {
                  key: si,
                  class: "cg-file-xzone-bar",
                  x: boxX + 8,
                  y: y + seg.y,
                  width: 2,
                  height: seg.h,
                  style: `fill: ${seg.color};`,
                  role: "img",
                  "aria-label": seg.label ?? "Cross-zone connection",
                }),
              ),
            )
          : h("rect", {
              class: "cg-file-xzone-bar",
              x: boxX + 8,
              y,
              width: 2,
              height: FILE_ROW_H - 2,
              rx: 1,
              "aria-label": "Cross-zone file",
              role: "img",
            }))
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
  const { from, to } = edgeEndpoints(fromBox, toBox);

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
    role: "button",
    "aria-expanded": expanded,
    "aria-label": `${expanded ? "Collapse" : "Expand"} sub-zone: ${subZone.name}`,
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
  connHighlighted,
  activeFilePath,
  searchQ,
  matchingFiles,
  fileConnections,
  zoneNameById,
  zoneColorById,
  expandedSubZoneIds,
  connectingOnly,
  onToggle,
  onSelectZone,
  onSelectFile,
  onDblClickFile,
  onFileHover,
  onDrillDown,
  onToggleSubZone,
  onToggleConnectingOnly,
  nodeRef,
  onNodeKeyDown,
  connectedZonesLabel,
}: {
  zone: ZoneData;
  box: BoxRect;
  expanded: boolean;
  selected: boolean;
  dimmed: boolean;
  /** True while an active file in another zone connects to this zone. */
  connHighlighted?: boolean;
  /** Path of the hovered/selected file when it belongs to this zone. */
  activeFilePath?: string | null;
  searchQ: string;
  matchingFiles: Set<string>;
  fileConnections: FileConnectionMap;
  zoneNameById: Map<string, string>;
  zoneColorById: Map<string, string>;
  expandedSubZoneIds?: Set<string>;
  connectingOnly: boolean;
  onToggle: () => void;
  onSelectZone: () => void;
  onSelectFile: (path: string) => void;
  onDblClickFile: (path: string) => void;
  onFileHover?: (path: string | null) => void;
  onDrillDown?: () => void;
  onToggleSubZone?: (subZoneId: string) => void;
  onToggleConnectingOnly?: () => void;
  /** Callback ref attached to the root SVG <g> for programmatic focus. */
  nodeRef?: (el: Element | null) => void;
  /** Arrow-key navigation handler delegated from ZoneDiagram. */
  onNodeKeyDown?: (e: KeyboardEvent) => void;
  /** Screen-reader description of connected zones for aria-describedby. */
  connectedZonesLabel?: string;
}) {
  const fileCount = zone.totalFiles;
  const hasSubZones = !!(zone.subZones && zone.subZones.length > 0);
  const hasConnecting = (files: FileInfo[]) =>
    files.some((f) => (fileConnections.get(f.path)?.length ?? 0) > 0);
  const showConnectingToggle = !!onToggleConnectingOnly &&
    (connectingOnly || hasConnecting(zone.files) || !!zone.subZones?.some((sz) => hasConnecting(sz.files)));

  /** One file row: the flat list and an expanded subzone differ only in key, position and width. */
  const fileRow = (file: FileInfo, key: string, y: number, boxX: number, boxW: number) =>
    h(FileRow, {
      key,
      file,
      y,
      boxX,
      boxW,
      searchMatch: searchQ ? matchingFiles.has(file.path) : false,
      hasCrossZone: fileConnections.has(file.path),
      active: activeFilePath === file.path,
      xzoneSegments: buildXZoneBarSegments(fileConnections.get(file.path), zoneColorById, FILE_ROW_H - 2, zoneNameById),
      tooltip: buildConnectionsTooltip(fileConnections.get(file.path), zoneNameById),
      onClick: () => onSelectFile(file.path),
      onDblClick: () => onDblClickFile(file.path),
      onHover: onFileHover ? (hov: boolean) => onFileHover(hov ? file.path : null) : undefined,
    });

  // Build expanded content elements
  const renderFileContent = () => {
    const visibleFiles = zone.files.slice(0, FILE_ROWS_MAX);
    const overflow = zone.files.length - FILE_ROWS_MAX;
    return [
      ...visibleFiles.map((file, i) =>
        fileRow(file, file.path, box.y + BOX_H_COLLAPSED - 4 + i * FILE_ROW_H, box.x, box.w)),
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
        for (const file of szFiles) {
          elements.push(fileRow(file, `${sz.id}-${file.path}`, curY, box.x + SUBZONE_FILE_INDENT, box.w - SUBZONE_FILE_INDENT));
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

  const ariaLabel = `${zone.name} zone, cohesion ${zone.cohesion.toFixed(2)}, coupling ${zone.coupling.toFixed(2)}, ${zone.totalFiles} file${zone.totalFiles !== 1 ? "s" : ""}`;

  return h("g", {
    class: `cg-zone-box${expanded ? " expanded" : ""}${selected ? " selected" : ""}${dimmed ? " search-dim" : ""}${connHighlighted ? " conn-highlight" : ""}`,
    "data-zone-id": zone.id,
    // Use lowercase "tabindex" for SVG — browsers and jsdom treat SVG attrs case-sensitively
    "tabindex": 0,
    role: "button",
    "aria-label": ariaLabel,
    "aria-describedby": `zone-desc-${zone.id}`,
    style: "cursor: grab;",
    ref: nodeRef,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        onSelectZone();
      } else {
        onNodeKeyDown?.(e);
      }
    },
  },
    // SVG description element for aria-describedby (connected zones)
    h("desc", { id: `zone-desc-${zone.id}` }, connectedZonesLabel ?? "No direct connections"),
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
      role: "button",
      "aria-expanded": expanded,
      "aria-label": expanded ? "Collapse zone" : "Expand zone",
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
          role: "button",
          "aria-label": `Drill into ${zone.subZones.length} sub-zones of ${zone.name}`,
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
          // Connecting-only filter toggle
          showConnectingToggle
            ? h("g", {
                class: `cg-zone-connfilter-btn${connectingOnly ? " active" : ""}`,
                role: "button",
                "aria-pressed": connectingOnly,
                "aria-label": connectingOnly ? "Show all files" : "Show only cross-zone connecting files",
                onMouseDown: (e: Event) => e.stopPropagation(),
                onClick: (e: Event) => { e.stopPropagation(); onToggleConnectingOnly?.(); },
              },
                h("title", null, connectingOnly ? "Show all files" : "Show only cross-zone connecting files"),
                h("rect", {
                  x: box.x + box.w - 58,
                  y: box.y + 6,
                  width: 22,
                  height: 22,
                  rx: 11,
                  class: "cg-connfilter-btn-bg",
                }),
                h("text", {
                  x: box.x + box.w - 47,
                  y: box.y + 21,
                  "text-anchor": "middle",
                  class: "cg-connfilter-btn-text",
                }, "⇄"),
              )
            : null,
          // Detail button — opens sidebar
          h("g", {
            class: "cg-zone-detail-btn",
            role: "button",
            "aria-label": `View ${zone.name} zone details`,
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
    // Focus ring: invisible by default, appears on :focus-visible via CSS
    h("rect", {
      class: "cg-zone-focus-ring",
      x: box.x - 3,
      y: box.y - 3,
      width: box.w + 6,
      height: box.h + 6,
      rx: 10,
      fill: "none",
      style: "pointer-events: none;",
    }),
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
  connectingOnlyZones,
  onToggleZone,
  onSelectZone,
  onSelectFile,
  onDblClickFile,
  onDblClickZone,
  onDrillDown,
  onToggleSubZone,
  onToggleConnectingOnly,
}: {
  zones: ZoneData[];
  edges: FlowEdge[];
  expandedZones: Set<string>;
  expandedSubZones: ExpandedSubZones;
  selectedZoneId: string | null;
  searchQ: string;
  fileConnections: FileConnectionMap;
  fileToFileMap: FileToFileMap;
  connectingOnlyZones: Set<string>;
  onToggleZone: (id: string) => void;
  onSelectZone: (zd: ZoneData) => void;
  onSelectFile: (path: string) => void;
  onDblClickFile: (path: string) => void;
  onDblClickZone: (id: string) => void;
  onDrillDown?: (zoneId: string) => void;
  onToggleSubZone: (parentId: string, subZoneId: string) => void;
  onToggleConnectingOnly: (zoneId: string) => void;
}) {
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  // File highlight state: hover is transient, selection pins until re-click.
  const [hoveredFile, setHoveredFile] = useState<ActiveFileRef | null>(null);
  const [selectedFile, setSelectedFile] = useState<ActiveFileRef | null>(null);
  const activeFile = hoveredFile ?? selectedFile;

  // Keyboard navigation: refs to zone <g> elements for programmatic focus
  const zoneRefs = useRef(new Map<string, Element>());

  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const zoneNameById = useMemo(() => new Map(zones.map((z) => [z.id, z.name])), [zones]);
  const zoneColorById = useMemo(() => new Map(zones.map((z) => [z.id, z.color])), [zones]);

  // Undirected adjacency list built from visible edges (deduped per pair)
  const adjacency = useMemo(() => {
    const adj = new Map<string, string[]>();
    for (const z of zones) adj.set(z.id, []);
    for (const e of edges) {
      if (!adj.has(e.from) || !adj.has(e.to)) continue;
      const fromList = adj.get(e.from)!;
      if (!fromList.includes(e.to)) fromList.push(e.to);
      const toList = adj.get(e.to)!;
      if (!toList.includes(e.from)) toList.push(e.from);
    }
    return adj;
  }, [zones, edges]);

  // Screen-reader description for each zone: lists connected zone names
  const connectionLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const z of zones) {
      const connIds = adjacency.get(z.id) ?? [];
      labels.set(
        z.id,
        connIds.length === 0
          ? "No direct connections"
          : `Connected to: ${connIds.map((id) => zoneById.get(id)?.name ?? id).join(", ")}`,
      );
    }
    return labels;
  }, [zones, adjacency, zoneById]);

  // Arrow-key navigation: cycles through the focused zone's edge-connected neighbours
  const handleNodeKeyDown = useGraphArrowNav(
    useCallback((zoneId: string) => adjacency.get(zoneId) ?? [], [adjacency]),
    useCallback((targetId: string) => {
      (zoneRefs.current.get(targetId) as HTMLElement | null)?.focus();
    }, []),
  );

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

  // Active-file highlight: edges to target zone boxes + zones to highlight
  const fileHighlight = useMemo(() => {
    if (!activeFile) return null;
    return buildFileHighlightEdges(
      activeFile, zoneById, boxes, expandedZones, expandedSubZones, fileConnections,
    );
  }, [activeFile, zoneById, boxes, expandedZones, expandedSubZones, fileConnections]);

  const handleFileHover = useCallback((zoneId: string, path: string | null) => {
    setHoveredFile(path ? { path, zoneId } : null);
  }, []);

  const handleFileClick = useCallback((zoneId: string, path: string) => {
    setSelectedFile((prev) => (prev?.path === path && prev.zoneId === zoneId ? null : { path, zoneId }));
    onSelectFile(path);
  }, [onSelectFile]);

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

  // The zone-level edges this render draws, each with its path and its label:
  // not replaced by file- or subzone-level edges, and with both boxes laid out.
  const drawnEdges = edges.flatMap((edge) => {
    const edgeKey = `${edge.from}->${edge.to}`;
    const fromBox = boxes.get(edge.from);
    const toBox = boxes.get(edge.to);
    return hiddenZoneEdges.has(edgeKey) || !fromBox || !toBox ? [] : [{ edge, edgeKey, fromBox, toBox }];
  });

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
        drawnEdges.map(({ edge, edgeKey, fromBox, toBox }) => {
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
        drawnEdges.map(({ edge, edgeKey, fromBox, toBox }) =>
          h(EdgeLabel, {
            key: `label-${edgeKey}`,
            edge,
            fromBox,
            toBox,
            hovered: hoveredEdge === edgeKey,
          })),
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
            connHighlighted: fileHighlight?.targetZoneIds.has(zone.id) ?? false,
            activeFilePath: activeFile?.zoneId === zone.id ? activeFile.path : null,
            searchQ,
            matchingFiles: matchingFilesByZone.get(zone.id) ?? new Set(),
            fileConnections,
            zoneNameById,
            zoneColorById,
            expandedSubZoneIds: expandedSubZones.get(zone.id),
            connectingOnly: connectingOnlyZones.has(zone.id),
            onToggle: () => onToggleZone(zone.id),
            onSelectZone: () => onSelectZone(zone),
            onSelectFile: (path: string) => handleFileClick(zone.id, path),
            onDblClickFile,
            onFileHover: (path: string | null) => handleFileHover(zone.id, path),
            onDrillDown: zone.hasDrillDown && onDrillDown
              ? () => onDrillDown(zone.id)
              : undefined,
            onToggleSubZone: (szId: string) => onToggleSubZone(zone.id, szId),
            onToggleConnectingOnly: () => onToggleConnectingOnly(zone.id),
            nodeRef: (el: Element | null) => {
              if (el) zoneRefs.current.set(zone.id, el);
              else zoneRefs.current.delete(zone.id);
            },
            onNodeKeyDown: (e: KeyboardEvent) => handleNodeKeyDown(zone.id, e),
            connectedZonesLabel: connectionLabels.get(zone.id),
          });
        }),
      ),

      // Active-file highlight edges (on top of zone boxes so collapsed
      // targets stay clearly connected; non-interactive)
      fileHighlight
        ? h("g", { class: "cg-file-highlight-edges", style: "pointer-events: none;" },
            fileHighlight.edges.map((e) =>
              h("path", {
                key: e.key,
                class: "cg-file-highlight-edge",
                d: e.d,
                fill: "none",
                stroke: e.color,
                "stroke-width": Math.max(1.5, Math.min(3.5, e.weight * 0.4 + 1.2)),
                "marker-end": "url(#cg-arrow)",
              }),
            ),
          )
        : null,
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

// ── Persistence helper ───────────────────────────────────────────────

function useLocalStorageState<T>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setAndPersist = useCallback((v: T) => {
    setValue(v);
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
  }, [key]);

  return [value, setAndPersist];
}

// ── View toggle ──────────────────────────────────────────────────────

function ViewToggle({
  mode,
  onChange,
}: {
  mode: "graph" | "table";
  onChange: (m: "graph" | "table") => void;
}) {
  return h("div", { class: "zone-view-toggle" },
    h("button", {
      type: "button",
      class: `zone-view-btn${mode === "graph" ? " active" : ""}`,
      onClick: () => onChange("graph"),
      "aria-pressed": mode === "graph",
      "aria-label": "Switch to graph view",
    }, "Graph"),
    h("button", {
      type: "button",
      class: `zone-view-btn${mode === "table" ? " active" : ""}`,
      onClick: () => onChange("table"),
      "aria-pressed": mode === "table",
      "aria-label": "Switch to table view",
    }, "Table"),
  );
}

// ── Zone table view ──────────────────────────────────────────────────

function ZoneTableView({
  zones,
  findings,
  edges,
  searchQ,
  selectedZoneId,
  onSelectZone,
}: {
  zones: ZoneData[];
  findings: Finding[];
  edges: FlowEdge[];
  searchQ: string;
  selectedZoneId: string | null;
  onSelectZone: (zd: ZoneData) => void;
}) {
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  // Count per-zone findings (scope !== "global")
  const findingsCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of findings) {
      if (f.scope !== "global") {
        counts.set(f.scope, (counts.get(f.scope) ?? 0) + 1);
      }
    }
    return counts;
  }, [findings]);

  // Build undirected adjacency (zone name list) from flow edges
  const connectionsByZone = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const z of zones) map.set(z.id, []);
    for (const e of edges) {
      const toZone = zoneById.get(e.to);
      const fromZone = zoneById.get(e.from);
      if (map.has(e.from) && toZone && !map.get(e.from)!.includes(toZone.name)) {
        map.get(e.from)!.push(toZone.name);
      }
      if (map.has(e.to) && fromZone && !map.get(e.to)!.includes(fromZone.name)) {
        map.get(e.to)!.push(fromZone.name);
      }
    }
    return map;
  }, [zones, edges, zoneById]);

  const visibleZones = useMemo(() => {
    if (!searchQ) return zones;
    return zones.filter((z) =>
      z.name.toLowerCase().includes(searchQ) ||
      z.description.toLowerCase().includes(searchQ) ||
      z.files.some((f) => f.path.toLowerCase().includes(searchQ)),
    );
  }, [zones, searchQ]);

  const captionId = "zone-table-caption";

  return h("div", { class: "data-table-wrapper zone-table-wrapper" },
    h("table", {
      class: "data-table zone-table",
      "aria-labelledby": captionId,
    },
      h("caption", { id: captionId, class: "zone-table-caption" },
        `${visibleZones.length} zone${visibleZones.length !== 1 ? "s" : ""}`,
      ),
      h("thead", null,
        h("tr", null,
          h("th", { scope: "col" }, "Zone Name"),
          h("th", { scope: "col" }, "Files"),
          h("th", { scope: "col" }, "Cohesion"),
          h("th", { scope: "col" }, "Coupling"),
          h("th", { scope: "col" }, "Top Connections"),
          h("th", { scope: "col" }, "Findings"),
        ),
      ),
      h("tbody", null,
        visibleZones.length === 0
          ? h("tr", null,
              h("td", { colSpan: 6, class: "zone-table-empty" }, "No zones match the current filter."),
            )
          : visibleZones.map((zone) => {
              const conns = connectionsByZone.get(zone.id) ?? [];
              const fCount = findingsCount.get(zone.id) ?? 0;
              const isSelected = selectedZoneId === zone.id;

              return h("tr", {
                key: zone.id,
                class: `zone-table-row${isSelected ? " selected" : ""}`,
                tabIndex: 0,
                "aria-selected": isSelected,
                onClick: () => onSelectZone(zone),
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelectZone(zone);
                  }
                },
              },
                h("td", null,
                  h("span", { class: "zone-table-name" },
                    h("span", {
                      class: "zone-table-dot",
                      style: `background: ${zone.color}`,
                      "aria-hidden": "true",
                    }),
                    zone.name,
                  ),
                ),
                h("td", null, String(zone.totalFiles)),
                h("td", null,
                  h("span", { class: `zone-metric-val${zone.cohesion < 0.5 ? " zone-metric-warn" : ""}` },
                    zone.cohesion.toFixed(2),
                  ),
                ),
                h("td", null,
                  h("span", { class: `zone-metric-val${zone.coupling > 0.5 ? " zone-metric-warn" : ""}` },
                    zone.coupling.toFixed(2),
                  ),
                ),
                h("td", null,
                  conns.length === 0
                    ? h("span", { class: "text-dim" }, "—")
                    : h("span", { title: conns.join(", ") },
                        conns.slice(0, 3).join(", "),
                        conns.length > 3
                          ? h("span", { class: "text-dim" }, ` +${conns.length - 3} more`)
                          : null,
                      ),
                ),
                h("td", null,
                  fCount > 0
                    ? h("span", { class: "zone-findings-count" }, String(fCount))
                    : h("span", { class: "text-dim" }, "—"),
                ),
              );
            }),
      ),
    ),
  );
}

// ── Main component ───────────────────────────────────────────────────

export function ZonesView({ data, onSelect, onOpenZoneChange, navigateTo }: ZonesViewProps) {
  const { zones, callGraph, imports: importsData } = data;
  const [search, setSearch] = useState("");
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [expandedSubZones, setExpandedSubZones] = useState<ExpandedSubZones>(new Map());
  const [connectingOnlyZones, setConnectingOnlyZones] = useState<Set<string>>(new Set());
  const [slideoutZone, setSlideoutZone] = useState<Zone | null>(null);
  const openZoneId = slideoutZone?.id ?? null;
  useEffect(() => {
    onOpenZoneChange?.(openZoneId);
  }, [openZoneId, onOpenZoneChange]);
  useEffect(() => () => onOpenZoneChange?.(null), [onOpenZoneChange]);
  const [viewMode, setViewMode] = useLocalStorageState<"graph" | "table">("ndx-zones-view-mode", "graph");

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

  // Connecting files first (and per-zone connecting-only filter), applied
  // upstream of layout/edge hooks so row indices stay consistent everywhere.
  const displayZones = useMemo(
    () => applyConnectingFilesOrdering(visibleZones, fileConnections, connectingOnlyZones),
    [visibleZones, fileConnections, connectingOnlyZones],
  );

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
        // Clean up subzone expansion and filter state when collapsing
        setExpandedSubZones((prevSz) => {
          if (!prevSz.has(id)) return prevSz;
          const nextSz = new Map(prevSz);
          nextSz.delete(id);
          return nextSz;
        });
        setConnectingOnlyZones((prevCo) => {
          if (!prevCo.has(id)) return prevCo;
          const nextCo = new Set(prevCo);
          nextCo.delete(id);
          return nextCo;
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

  const toggleConnectingOnly = useCallback((zoneId: string) => {
    setConnectingOnlyZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId); else next.add(zoneId);
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
    h(GlossaryLine, { term: "zone" }),

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

    // View toggle (graph ↔ table)
    h("div", { class: "zone-view-controls" },
      h(ViewToggle, { mode: viewMode, onChange: setViewMode }),
      // Drill-down breadcrumb (hidden at root level, only relevant in graph mode)
      viewMode === "graph" ? h(ZoneBreadcrumbNav, { drillPath, onNavigate: handleBreadcrumbNavigate }) : null,
    ),

    // Zone Diagram or Table View
    visibleZones.length > 0
      ? (viewMode === "table"
          ? h(ZoneTableView, {
              zones: displayZones,
              findings: zones.findings ?? [],
              edges: visibleCrossings,
              searchQ,
              selectedZoneId: slideoutZone?.id ?? null,
              onSelectZone: handleDiagramZoneSelect,
            })
          : h(ZoneDiagram, {
              zones: displayZones,
              edges: visibleCrossings,
              expandedZones: effectiveExpandedZones,
              expandedSubZones,
              selectedZoneId: slideoutZone?.id ?? null,
              searchQ,
              fileConnections,
              fileToFileMap,
              connectingOnlyZones,
              onToggleZone: toggleZone,
              onSelectZone: handleDiagramZoneSelect,
              onSelectFile: handleFileSelect,
              onDblClickFile: handleFileDblClick,
              onDblClickZone: handleZoneDblClick,
              onDrillDown: handleDrillDown,
              onToggleSubZone: toggleSubZone,
              onToggleConnectingOnly: toggleConnectingOnly,
            })
        )
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

/**
 * GraphRenderer — imperative SVG rendering for the force-directed import graph.
 *
 * Extracted from viewer/views/graph.ts. Owns all DOM manipulation, event
 * handlers, LOD, and physics integration. Uses AbortController for clean
 * teardown of all event listeners.
 *
 * @remarks Class methods (highlightNode, centerOnNode, selectNode, etc.) are
 * exported as part of the GraphRenderer class. Static analysis may flag these
 * as unused because they are called via class instances, not via static imports.
 */

import {
  type SimState,
  type TickCallbacks,
  initZoneClusteredPositions,
  tick,
} from "./physics.js";
import { basename, truncateFilename } from "../utils.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// ── Public types ─────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  zone?: string;
  zoneColor?: string;
  importCount: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  crossZone: boolean;
}

/** Minimal zone info the renderer needs for grouping. */
export interface ZoneInfo {
  id: string;
  name: string;
  color: string;
  files: string[];
}

export interface GraphRendererOptions {
  svg: SVGSVGElement;
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
  onNodeSelect: (detail: { title: string; path: string; zone: string; incomingImports: number }) => void;
  onNodeDblClick?: (path: string) => void;
  onZoneSelect?: (zoneId: string) => void;
  zoneInfos: ZoneInfo[];
}

// ── Label positioning types ─────────────────────────────────────────────────

/** Bounding box for label overlap detection (in SVG viewBox coordinates). */
interface LabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── GraphRenderer class ──────────────────────────────────────────────────────

export class GraphRenderer {
  readonly nodes: GraphNode[];
  readonly nodeGroups: SVGGElement[];

  private readonly svg: SVGSVGElement;
  private readonly g: SVGGElement;
  private readonly linkElements: SVGLineElement[];
  private readonly nodeRadii: number[];
  private readonly resolvedLinks: { source: GraphNode; target: GraphNode; crossZone: boolean }[];
  private readonly nodeEdgeMap: Map<string, Set<number>>;
  private readonly ac: AbortController;
  private readonly sim: SimState;
  private readonly width: number;
  private readonly height: number;

  // ViewBox state for zoom/pan
  private viewX = 0;
  private viewY = 0;
  private viewW: number;
  private viewH: number;
  private scale = 1;

  // Lifecycle flag — prevents scheduling new animation frames after destroy
  private destroyed = false;

  // Selection state — persists until explicitly cleared
  private selectedNodeId: string | null = null;

  // Pan gesture flag — set true when a pan actually moved the view;
  // zone hull click handlers check this to suppress clicks after panning.
  private wasPanning = false;

  // Label management state
  private labelsHidden = false;       // user toggle
  private labelRects: LabelRect[];    // reused per frame to avoid GC
  private tooltip: SVGGElement;       // shared tooltip element

  // Zone grouping state
  private readonly zoneInfos: ZoneInfo[];
  private readonly zoneHullGroup: SVGGElement;            // container for zone hulls
  private readonly zoneHullElements: Map<string, SVGPathElement> = new Map();
  private readonly zoneLabelElements: Map<string, SVGGElement> = new Map();  // zone label groups (bg + text)
  private readonly collapsedZones: Set<string> = new Set();
  private readonly zoneNodeIndices: Map<string, number[]> = new Map();
  private zonesVisible = true;
  private readonly onZoneSelect?: (zoneId: string) => void;
  private readonly zoneLabelLayer: SVGGElement;           // separate layer above nodes for zone labels

  constructor(opts: GraphRendererOptions) {
    const { svg, nodes, links, width, height, onNodeSelect, onNodeDblClick, onZoneSelect, zoneInfos } = opts;

    this.svg = svg;
    this.nodes = nodes;
    this.width = width;
    this.height = height;
    this.viewW = width;
    this.viewH = height;
    this.nodeGroups = [];
    this.linkElements = [];
    this.nodeRadii = [];
    this.ac = new AbortController();
    this.zoneInfos = zoneInfos;
    this.onZoneSelect = onZoneSelect;

    // Clear existing SVG content and set up root structure
    svg.innerHTML = "";
    this.updateViewBox();
    this.createSvgDefs(svg);
    this.g = document.createElementNS(SVG_NS, "g");
    svg.appendChild(this.g);

    // Build zone → node index map and zone hull/label layers
    this.buildZoneNodeMap();
    this.zoneHullGroup = this.createSvgLayer("zone-hulls");
    this.zoneLabelLayer = document.createElementNS(SVG_NS, "g");
    this.zoneLabelLayer.setAttribute("class", "zone-label-layer");
    this.createZoneHulls();

    // Resolve link references and build adjacency map
    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);
    initZoneClusteredPositions(nodes, width, height);
    this.resolvedLinks = this.resolveGraphLinks(links, nodeMap);
    this.nodeEdgeMap = this.buildAdjacencyMap();

    // Create SVG elements for links and nodes
    this.createLinkElements();
    const nodeLayer = this.createSvgLayer("graph-node-layer");
    this.createNodeElements(nodeLayer);
    this.labelRects = this.allocateLabelRects();

    // Tooltip and top layers
    this.tooltip = this.createTooltipElement();
    this.g.appendChild(this.zoneLabelLayer);
    this.g.appendChild(this.tooltip);

    // Initialize physics simulation
    this.sim = {
      nodes,
      resolvedLinks: this.resolvedLinks,
      width,
      height,
      alpha: { value: 1 },
      frameCount: 0,
      hasFitted: false,
      scale: this.scale,
      nodeRadii: this.nodeRadii,
    };

    // Set up event listeners and start simulation
    this.setupZoom();
    this.setupPanAndDrag(onNodeSelect, onNodeDblClick);
    this.setupHoverHighlighting();
    this.setupLabelTooltips();
    this.setupTouchInteraction(onNodeSelect, onNodeDblClick);
    this.startSimulation();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  highlightNode(id: string | null): void {
    // Clear previous highlights
    const existing = this.g.querySelectorAll(".graph-search-ring");
    existing.forEach((el) => el.remove());

    if (!id) return;

    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx < 0) return;

    const ns = SVG_NS;
    const ring = document.createElementNS(ns, "circle");
    ring.setAttribute("class", "graph-search-ring");
    ring.setAttribute("r", String(this.nodeRadii[idx] + 4));
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "var(--accent)");
    ring.setAttribute("stroke-width", "2");
    this.nodeGroups[idx].appendChild(ring);
  }

  centerOnNode(id: string): void {
    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx < 0) return;
    const n = this.nodes[idx];
    if (n.x == null || n.y == null) return;

    this.viewX = n.x - this.viewW / 2;
    this.viewY = n.y - this.viewH / 2;
    this.updateViewBox();
  }

  /** Select a node and apply persistent highlighting to its connections. */
  selectNode(id: string | null): void {
    this.clearSelection();
    if (!id) return;

    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx < 0) return;

    this.selectedNodeId = id;
    this.applySelectionHighlight(id);
    this.nodeGroups[idx].classList.add("selected");
  }

  /** Clear the current persistent selection. */
  clearSelection(): void {
    if (!this.selectedNodeId) return;

    // Remove selected class from previously selected node
    const prevIdx = this.nodes.findIndex((n) => n.id === this.selectedNodeId);
    if (prevIdx >= 0) {
      this.nodeGroups[prevIdx].classList.remove("selected");
    }

    this.selectedNodeId = null;

    // Reset all opacities
    for (let j = 0; j < this.nodes.length; j++) {
      this.nodeGroups[j].style.opacity = "";
    }
    for (let j = 0; j < this.linkElements.length; j++) {
      this.linkElements[j].style.strokeOpacity = "";
      this.linkElements[j].style.stroke = "";
    }
  }

  /** Toggle label visibility on/off. Returns the new state. */
  toggleLabels(): boolean {
    this.labelsHidden = !this.labelsHidden;
    this.updateLOD();
    return !this.labelsHidden; // true = labels visible
  }

  /** Get current label visibility state. */
  get labelsVisible(): boolean {
    return !this.labelsHidden;
  }

  /** Toggle zone hull visibility on/off. Returns the new state. */
  toggleZones(): boolean {
    this.zonesVisible = !this.zonesVisible;
    this.zoneHullGroup.style.display = this.zonesVisible ? "" : "none";
    this.zoneLabelLayer.style.display = this.zonesVisible ? "" : "none";
    return this.zonesVisible;
  }

  /** Get current zone visibility state. */
  get zonesGroupsVisible(): boolean {
    return this.zonesVisible;
  }

  /** Collapse a zone group — hides member nodes/edges and shows a summary node. */
  collapseZone(zoneId: string): void {
    if (this.collapsedZones.has(zoneId)) return;
    this.collapsedZones.add(zoneId);
    this.applyZoneCollapse(zoneId);
  }

  /** Expand a previously collapsed zone group. */
  expandZone(zoneId: string): void {
    if (!this.collapsedZones.has(zoneId)) return;
    this.collapsedZones.delete(zoneId);
    this.applyZoneExpand(zoneId);
  }

  /** Toggle a zone between collapsed and expanded. Returns true if now collapsed. */
  toggleZoneCollapse(zoneId: string): boolean {
    if (this.collapsedZones.has(zoneId)) {
      this.expandZone(zoneId);
      return false;
    } else {
      this.collapseZone(zoneId);
      return true;
    }
  }

  /** Check if a zone is currently collapsed. */
  isZoneCollapsed(zoneId: string): boolean {
    return this.collapsedZones.has(zoneId);
  }

  /** Zoom in by the given factor (default 1.25 = 25% closer). Zooms toward center. */
  zoomIn(factor = 1.25): void {
    this.applyZoomFromCenter(1 / factor);
  }

  /** Zoom out by the given factor (default 1.25 = 25% further). Zooms from center. */
  zoomOut(factor = 1.25): void {
    this.applyZoomFromCenter(factor);
  }

  /** Reset the viewport to fit all content. */
  resetView(): void {
    this.fitToContent();
    this.updateLOD();
  }

  destroy(): void {
    this.destroyed = true;
    this.ac.abort();

    // Stop the physics simulation so no more ticks are scheduled
    this.sim.alpha.value = 0;

    // Release large data structures for GC
    this.nodeEdgeMap.clear();
    this.zoneHullElements.clear();
    this.zoneLabelElements.clear();
    this.collapsedZones.clear();
    this.zoneNodeIndices.clear();
    this.resolvedLinks.length = 0;
    this.linkElements.length = 0;
    this.nodeGroups.length = 0;
    this.nodes.length = 0;
    this.labelRects.length = 0;
  }

  // ── Private: Constructor helpers ──────────────────────────────────────────

  /** Create SVG <defs> with the arrowhead marker. */
  private createSvgDefs(svg: SVGSVGElement): void {
    const ns = SVG_NS;
    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.setAttribute("id", "arrowhead");
    marker.setAttribute("viewBox", "0 0 10 7");
    marker.setAttribute("refX", "10");
    marker.setAttribute("refY", "3.5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto");
    const polygon = document.createElementNS(ns, "polygon");
    polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
    polygon.setAttribute("fill", "var(--border)");
    marker.appendChild(polygon);
    defs.appendChild(marker);
    svg.appendChild(defs);
  }

  /** Build the zone → node-index map used for hull rendering and collapse. */
  private buildZoneNodeMap(): void {
    for (let i = 0; i < this.nodes.length; i++) {
      const z = this.nodes[i].zone;
      if (!z) continue;
      let indices = this.zoneNodeIndices.get(z);
      if (!indices) { indices = []; this.zoneNodeIndices.set(z, indices); }
      indices.push(i);
    }
  }

  /** Create an SVG <g> layer, append it to the root group, and return it. */
  private createSvgLayer(className: string): SVGGElement {
    const layer = document.createElementNS(SVG_NS, "g");
    layer.setAttribute("class", className);
    this.g.appendChild(layer);
    return layer;
  }

  /** Resolve string-based link endpoints to GraphNode references. */
  private resolveGraphLinks(
    links: GraphLink[],
    nodeMap: Map<string, GraphNode>,
  ): { source: GraphNode; target: GraphNode; crossZone: boolean }[] {
    return links.map((l) => ({
      ...l,
      source: nodeMap.get(typeof l.source === "string" ? l.source : l.source.id)!,
      target: nodeMap.get(typeof l.target === "string" ? l.target : l.target.id)!,
    })).filter((l) => l.source && l.target);
  }

  /** Build a node-id → edge-index adjacency map for hover/select highlighting. */
  private buildAdjacencyMap(): Map<string, Set<number>> {
    const map = new Map<string, Set<number>>();
    for (let i = 0; i < this.resolvedLinks.length; i++) {
      const l = this.resolvedLinks[i];
      const sId = l.source.id;
      const tId = l.target.id;
      if (!map.has(sId)) map.set(sId, new Set());
      if (!map.has(tId)) map.set(tId, new Set());
      map.get(sId)!.add(i);
      map.get(tId)!.add(i);
    }
    return map;
  }

  /** Create SVG line elements for all resolved links. */
  private createLinkElements(): void {
    for (const l of this.resolvedLinks) {
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("class", `graph-link${l.crossZone ? " cross-zone" : ""}`);
      line.setAttribute("marker-end", "url(#arrowhead)");
      this.g.appendChild(line);
      this.linkElements.push(line);
    }
  }

  /** Create SVG groups for all nodes (hit target, circle, label). */
  private createNodeElements(nodeLayer: SVGGElement): void {
    for (const n of this.nodes) {
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", "graph-node");

      const radius = Math.min(3 + Math.sqrt(n.importCount) * 2, 16);
      this.nodeRadii.push(radius);

      // Invisible hit target — larger than the visible circle for easy clicking
      const hitTarget = document.createElementNS(SVG_NS, "circle");
      hitTarget.setAttribute("r", String(Math.max(radius + 4, 10)));
      hitTarget.setAttribute("fill", "transparent");
      hitTarget.setAttribute("class", "graph-node-hit");
      group.appendChild(hitTarget);

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", n.zoneColor || "#555");
      group.appendChild(circle);

      // Always create labels — LOD + overlap detection controls visibility
      const fullName = basename(n.id);
      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("class", "graph-label");
      label.setAttribute("dy", String(-radius - 3));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("data-full", fullName);
      label.textContent = truncateFilename(fullName);
      group.appendChild(label);

      nodeLayer.appendChild(group);
      this.nodeGroups.push(group);
    }
  }

  /** Pre-allocate label rect objects reused each frame to avoid GC pressure. */
  private allocateLabelRects(): LabelRect[] {
    const rects = new Array<LabelRect>(this.nodes.length);
    for (let i = 0; i < this.nodes.length; i++) {
      rects[i] = { x: 0, y: 0, w: 0, h: 0 };
    }
    return rects;
  }

  /** Create the shared tooltip SVG group (hidden by default). */
  private createTooltipElement(): SVGGElement {
    const tooltip = document.createElementNS(SVG_NS, "g");
    tooltip.setAttribute("class", "graph-tooltip");
    tooltip.style.display = "none";
    tooltip.style.pointerEvents = "none";
    const tooltipBg = document.createElementNS(SVG_NS, "rect");
    tooltipBg.setAttribute("class", "graph-tooltip-bg");
    tooltipBg.setAttribute("rx", "3");
    tooltipBg.setAttribute("ry", "3");
    tooltip.appendChild(tooltipBg);
    const tooltipText = document.createElementNS(SVG_NS, "text");
    tooltipText.setAttribute("class", "graph-tooltip-text");
    tooltipText.setAttribute("dy", "0.35em");
    tooltip.appendChild(tooltipText);
    return tooltip;
  }

  // ── Private: Selection highlighting ───────────────────────────────────────

  private applySelectionHighlight(nodeId: string): void {
    const connectedEdges = this.nodeEdgeMap.get(nodeId) ?? new Set();
    const connectedNodes = new Set<string>([nodeId]);

    for (const ei of connectedEdges) {
      const l = this.resolvedLinks[ei];
      connectedNodes.add(l.source.id);
      connectedNodes.add(l.target.id);
    }

    // Dim non-connected nodes
    for (let j = 0; j < this.nodes.length; j++) {
      const ng = this.nodeGroups[j];
      if (connectedNodes.has(this.nodes[j].id)) {
        ng.style.opacity = "1";
      } else {
        ng.style.opacity = "0.2";
      }
    }

    // Highlight connected edges
    for (let j = 0; j < this.linkElements.length; j++) {
      if (connectedEdges.has(j)) {
        this.linkElements[j].style.strokeOpacity = "0.9";
        this.linkElements[j].style.stroke = "var(--accent)";
      } else {
        this.linkElements[j].style.strokeOpacity = "0.05";
      }
    }
  }

  // ── Private: Zone hull management ─────────────────────────────────────────

  /** Create SVG elements for each zone hull (background + label). */
  private createZoneHulls(): void {
    const ns = SVG_NS;
    const signal = this.ac.signal;

    for (const zi of this.zoneInfos) {
      const indices = this.zoneNodeIndices.get(zi.id);
      if (!indices || indices.length < 2) continue;

      // Zone hull group
      const zoneG = document.createElementNS(ns, "g");
      zoneG.setAttribute("class", "zone-hull-group");
      zoneG.setAttribute("data-zone", zi.id);

      // Hull path (filled background)
      const path = document.createElementNS(ns, "path") as SVGPathElement;
      path.setAttribute("class", "zone-hull");
      path.setAttribute("fill", zi.color);
      path.setAttribute("stroke", zi.color);
      zoneG.appendChild(path);
      this.zoneHullElements.set(zi.id, path);

      // Zone label group — rendered in a separate layer above nodes for readability
      const labelGroup = document.createElementNS(ns, "g") as SVGGElement;
      labelGroup.setAttribute("class", "zone-hull-label-group");
      labelGroup.setAttribute("data-zone", zi.id);
      const labelBg = document.createElementNS(ns, "rect");
      labelBg.setAttribute("class", "zone-hull-label-bg");
      labelBg.setAttribute("rx", "4");
      labelBg.setAttribute("ry", "4");
      labelGroup.appendChild(labelBg);
      const labelText = document.createElementNS(ns, "text") as SVGTextElement;
      labelText.setAttribute("class", "zone-hull-label");
      labelText.setAttribute("text-anchor", "middle");
      labelText.setAttribute("dy", "0.35em");
      labelText.textContent = zi.name;
      labelGroup.appendChild(labelText);
      this.zoneLabelLayer.appendChild(labelGroup);
      this.zoneLabelElements.set(zi.id, labelGroup);

      this.zoneHullGroup.appendChild(zoneG);

      // Click on zone hull to select/toggle collapse
      (zoneG as unknown as HTMLElement).addEventListener("click", (e: MouseEvent) => {
        // Don't trigger if clicking a node inside the hull
        const target = e.target as Element;
        if (target.tagName === "circle") return;

        // Suppress zone select if this click completed a pan gesture
        if (this.wasPanning) {
          this.wasPanning = false;
          return;
        }

        e.stopPropagation();
        if (this.onZoneSelect) {
          this.onZoneSelect(zi.id);
        }
      }, { signal });

      // Double-click to toggle collapse
      (zoneG as unknown as HTMLElement).addEventListener("dblclick", (e: MouseEvent) => {
        const target = e.target as Element;
        if (target.tagName === "circle") return;
        e.preventDefault();
        e.stopPropagation();
        this.toggleZoneCollapse(zi.id);
      }, { signal });
    }
  }

  /** Update hull paths and labels to match current node positions. */
  private updateZoneHulls(): void {
    if (!this.zonesVisible) return;

    // Zone label font size scales with zoom (stays readable at all levels)
    const zoneFontSize = Math.max(10, Math.min(14, 12 / Math.sqrt(this.scale)));

    for (const zi of this.zoneInfos) {
      const indices = this.zoneNodeIndices.get(zi.id);
      if (!indices || indices.length < 2) continue;

      const path = this.zoneHullElements.get(zi.id);
      const labelGroup = this.zoneLabelElements.get(zi.id);
      if (!path || !labelGroup) continue;

      // Skip collapsed zones — hull and label are hidden
      if (this.collapsedZones.has(zi.id)) {
        path.parentElement?.style.setProperty("display", "none");
        labelGroup.style.display = "none";
        continue;
      }
      path.parentElement?.style.removeProperty("display");
      labelGroup.style.display = "";

      // Collect visible node positions with padding
      const points: [number, number][] = [];
      let cx = 0, cy = 0;
      for (const idx of indices) {
        const n = this.nodes[idx];
        if (n.x != null && n.y != null) {
          points.push([n.x, n.y]);
          cx += n.x;
          cy += n.y;
        }
      }
      if (points.length < 2) continue;
      cx /= points.length;
      cy /= points.length;

      // Compute convex hull with padding
      const padding = 25;
      const hull = convexHull(points);
      const paddedHull = padHull(hull, padding);
      const d = hullToSmoothPath(paddedHull);
      path.setAttribute("d", d);

      // Position zone label above the zone cluster
      const labelY = cy - this.getZoneRadius(indices) - 15;
      const labelText = labelGroup.querySelector("text") as SVGTextElement | null;
      const labelBg = labelGroup.querySelector("rect") as SVGRectElement | null;
      if (labelText && labelBg) {
        labelText.style.fontSize = `${zoneFontSize}px`;
        // Position the group at the label center
        labelGroup.setAttribute("transform", `translate(${cx},${labelY})`);
        // Size the background pill around the text
        const textLen = (labelText.textContent || "").length;
        const charWidth = zoneFontSize * 0.55;
        const pillW = textLen * charWidth + 12; // 6px padding each side
        const pillH = zoneFontSize + 8;         // 4px padding top/bottom
        labelBg.setAttribute("x", String(-pillW / 2));
        labelBg.setAttribute("y", String(-pillH / 2));
        labelBg.setAttribute("width", String(pillW));
        labelBg.setAttribute("height", String(pillH));
      }
    }
  }

  /** Get approximate radius of a zone cluster for label positioning. */
  private getZoneRadius(indices: number[]): number {
    if (indices.length === 0) return 0;
    let cx = 0, cy = 0;
    for (const i of indices) { cx += this.nodes[i].x ?? 0; cy += this.nodes[i].y ?? 0; }
    cx /= indices.length;
    cy /= indices.length;
    let maxDist = 0;
    for (const i of indices) {
      const dx = (this.nodes[i].x ?? 0) - cx;
      const dy = (this.nodes[i].y ?? 0) - cy;
      maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
    }
    return maxDist;
  }

  /** Hide member nodes/edges when a zone is collapsed, show summary. */
  private applyZoneCollapse(zoneId: string): void {
    const indices = this.zoneNodeIndices.get(zoneId);
    if (!indices) return;

    // Compute centroid for summary position
    let cx = 0, cy = 0;
    for (const i of indices) { cx += this.nodes[i].x ?? 0; cy += this.nodes[i].y ?? 0; }
    cx /= indices.length;
    cy /= indices.length;

    // Hide individual nodes
    for (const i of indices) {
      this.nodeGroups[i].style.display = "none";
    }

    // Dim edges connected only to hidden nodes
    const hiddenIds = new Set(indices.map(i => this.nodes[i].id));
    for (let i = 0; i < this.resolvedLinks.length; i++) {
      const l = this.resolvedLinks[i];
      const srcHidden = hiddenIds.has(l.source.id);
      const tgtHidden = hiddenIds.has(l.target.id);
      if (srcHidden && tgtHidden) {
        this.linkElements[i].style.display = "none";
      } else if (srcHidden || tgtHidden) {
        this.linkElements[i].style.opacity = "0.3";
      }
    }

    // Show collapsed summary hull
    const hullGroup = this.zoneHullGroup.querySelector(`[data-zone="${zoneId}"]`);
    if (hullGroup) {
      hullGroup.classList.add("collapsed");
      // Position a summary badge at the centroid
      const ns = SVG_NS;
      let badge = hullGroup.querySelector(".zone-collapse-badge") as SVGGElement | null;
      if (!badge) {
        badge = document.createElementNS(ns, "g");
        badge.setAttribute("class", "zone-collapse-badge");
        const circle = document.createElementNS(ns, "circle");
        circle.setAttribute("r", "18");
        circle.setAttribute("class", "zone-collapse-circle");
        const info = this.zoneInfos.find(z => z.id === zoneId);
        if (info) circle.setAttribute("fill", info.color);
        badge.appendChild(circle);
        const text = document.createElementNS(ns, "text");
        text.setAttribute("class", "zone-collapse-count");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dy", "0.35em");
        text.textContent = String(indices.length);
        badge.appendChild(text);
        hullGroup.appendChild(badge);
      }
      badge.setAttribute("transform", `translate(${cx},${cy})`);
      badge.style.display = "";
    }
  }

  /** Show member nodes/edges when a zone is expanded. */
  private applyZoneExpand(zoneId: string): void {
    const indices = this.zoneNodeIndices.get(zoneId);
    if (!indices) return;

    // Show individual nodes
    for (const i of indices) {
      this.nodeGroups[i].style.display = "";
    }

    // Restore edges
    const hiddenIds = new Set(indices.map(i => this.nodes[i].id));
    for (let i = 0; i < this.resolvedLinks.length; i++) {
      const l = this.resolvedLinks[i];
      const srcWas = hiddenIds.has(l.source.id);
      const tgtWas = hiddenIds.has(l.target.id);
      if (srcWas || tgtWas) {
        this.linkElements[i].style.display = "";
        this.linkElements[i].style.opacity = "";
      }
    }

    // Hide collapsed summary
    const hullGroup = this.zoneHullGroup.querySelector(`[data-zone="${zoneId}"]`);
    if (hullGroup) {
      hullGroup.classList.remove("collapsed");
      const badge = hullGroup.querySelector(".zone-collapse-badge") as SVGGElement | null;
      if (badge) badge.style.display = "none";
    }
  }

  // ── Private: ViewBox ───────────────────────────────────────────────────────

  private updateViewBox(): void {
    this.svg.setAttribute("viewBox", `${this.viewX} ${this.viewY} ${this.viewW} ${this.viewH}`);
    this.scale = this.viewW / this.width;
  }

  private fitToContent(): void {
    if (this.nodes.length === 0) return;
    const xs = this.nodes.map((n) => n.x!).sort((a, b) => a - b);
    const ys = this.nodes.map((n) => n.y!).sort((a, b) => a - b);
    const lo = Math.floor(this.nodes.length * 0.02);
    const hi = Math.min(Math.ceil(this.nodes.length * 0.98), this.nodes.length - 1);
    const minX = xs[lo];
    const maxX = xs[hi];
    const minY = ys[lo];
    const maxY = ys[hi];
    const padding = 60;
    let fitW = (maxX - minX) + padding * 2;
    let fitH = (maxY - minY) + padding * 2;
    let fitX = minX - padding;
    let fitY = minY - padding;
    // Maintain aspect ratio of container
    const aspect = this.width / this.height;
    const contentAspect = fitW / fitH;
    if (contentAspect > aspect) {
      const newH = fitW / aspect;
      fitY -= (newH - fitH) / 2;
      fitH = newH;
    } else {
      const newW = fitH * aspect;
      fitX -= (newW - fitW) / 2;
      fitW = newW;
    }
    this.viewX = fitX;
    this.viewY = fitY;
    this.viewW = fitW;
    this.viewH = fitH;
    this.scale = this.viewW / this.width;
    this.updateViewBox();
  }

  // ── Private: LOD + Label overlap detection ─────────────────────────────────

  /**
   * Update level-of-detail: circle sizing, label visibility, and overlap hiding.
   *
   * Strategy:
   *  1. Zoom-based LOD: hide labels when nodes are too small to read.
   *  2. Density-aware priority: in crowded areas, only show labels for high-import
   *     nodes (they are the most useful landmarks).
   *  3. Greedy overlap removal: iterate nodes by importance (import count desc),
   *     place labels greedily, hide labels that would overlap already-placed ones.
   *  4. User toggle: labelsHidden overrides everything.
   */
  private updateLOD(): void {
    const n = this.nodes.length;

    // Phase 1: circle sizing + compute which labels *could* show (zoom-based)
    const fontSize = Math.max(7, Math.min(11, 9 / Math.sqrt(this.scale)));
    // Approximate label dimensions in SVG units
    const charWidth = fontSize * 0.55;
    const labelHeight = fontSize * 1.3;

    // Track which labels pass zoom test (before overlap)
    const zoomVisible: boolean[] = new Array(n);

    for (let i = 0; i < n; i++) {
      const visualRadius = this.nodeRadii[i] / this.scale;
      // Select visible circle (skip the hit target which has class .graph-node-hit)
      const circle = this.nodeGroups[i].querySelector("circle:not(.graph-node-hit)");

      this.nodeGroups[i].style.display = "";
      if (circle && visualRadius < 1) {
        circle.setAttribute("r", String(this.scale));
      } else if (circle) {
        circle.setAttribute("r", String(this.nodeRadii[i]));
      }

      // Also update hit target radius to stay proportional
      const hitTarget = this.nodeGroups[i].querySelector(".graph-node-hit");
      if (hitTarget) {
        const hitRadius = Math.max(this.nodeRadii[i] + 4, 10);
        hitTarget.setAttribute("r", String(visualRadius < 1 ? this.scale + 4 : hitRadius));
      }

      zoomVisible[i] = !this.labelsHidden && visualRadius >= 3;
    }

    // Phase 2: sort by importance for greedy placement (descending import count)
    // Use a lightweight index array to avoid allocations on hot path
    const order = this.getSortedLabelOrder();

    // Phase 3: greedy overlap removal
    // We track placed label bounding boxes and skip labels that overlap.
    // Zone labels are pre-seeded as reserved regions so file labels never cover them.
    const placed: LabelRect[] = [];
    const showLabel: boolean[] = new Array(n).fill(false);

    // Pre-seed zone label bounding boxes as reserved regions
    if (this.zonesVisible) {
      const zoneFontSize = Math.max(10, Math.min(14, 12 / Math.sqrt(this.scale)));
      const zoneCharWidth = zoneFontSize * 0.55;
      for (const zi of this.zoneInfos) {
        const indices = this.zoneNodeIndices.get(zi.id);
        if (!indices || indices.length < 2) continue;
        if (this.collapsedZones.has(zi.id)) continue;
        const labelGroup = this.zoneLabelElements.get(zi.id);
        if (!labelGroup || labelGroup.style.display === "none") continue;
        const labelText = labelGroup.querySelector("text");
        if (!labelText) continue;
        const textLen = (labelText.textContent || "").length;
        const pillW = textLen * zoneCharWidth + 12;
        const pillH = zoneFontSize + 8;
        // Extract position from transform attribute
        const transform = labelGroup.getAttribute("transform");
        const match = transform?.match(/translate\(([-\d.]+),([-\d.]+)\)/);
        if (match) {
          const zx = parseFloat(match[1]);
          const zy = parseFloat(match[2]);
          placed.push({ x: zx - pillW / 2, y: zy - pillH / 2, w: pillW, h: pillH });
        }
      }
    }

    for (let oi = 0; oi < n; oi++) {
      const i = order[oi];
      if (!zoomVisible[i]) continue;

      const node = this.nodes[i];
      const label = this.nodeGroups[i].querySelector("text") as SVGTextElement | null;
      if (!label) continue;

      const textLen = (label.textContent || "").length;
      const lw = textLen * charWidth;
      const lh = labelHeight;
      const lx = (node.x ?? 0) - lw / 2;
      const ly = (node.y ?? 0) - this.nodeRadii[i] - 3 - lh;

      // Check overlap against already-placed labels and reserved zone labels
      let overlaps = false;
      for (let j = 0; j < placed.length; j++) {
        const p = placed[j];
        if (lx < p.x + p.w && lx + lw > p.x && ly < p.y + p.h && ly + lh > p.y) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        showLabel[i] = true;
        // Reuse pre-allocated rect
        const rect = this.labelRects[i];
        rect.x = lx;
        rect.y = ly;
        rect.w = lw;
        rect.h = lh;
        placed.push(rect);
      }
    }

    // Phase 4: apply visibility + font size
    for (let i = 0; i < n; i++) {
      const label = this.nodeGroups[i].querySelector("text") as SVGTextElement | null;
      if (!label) continue;

      if (showLabel[i]) {
        label.style.display = "";
        label.style.fontSize = `${fontSize}px`;
        label.classList.remove("graph-label-hidden");
      } else {
        label.style.display = "none";
        label.classList.add("graph-label-hidden");
      }
    }
  }

  /** Cached sort order — recomputed only when node count changes. */
  private _sortedOrder: number[] | null = null;
  private _sortedOrderLen = -1;

  /** Get indices sorted by import count (descending). Cached per node-count. */
  private getSortedLabelOrder(): number[] {
    const n = this.nodes.length;
    if (this._sortedOrder && this._sortedOrderLen === n) return this._sortedOrder;

    const order = new Array<number>(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const nodes = this.nodes;
    order.sort((a, b) => nodes[b].importCount - nodes[a].importCount);

    this._sortedOrder = order;
    this._sortedOrderLen = n;
    return order;
  }

  // ── Private: DOM update (called by physics tick) ───────────────────────────

  private updateDOM(): void {
    // Update link positions
    for (let i = 0; i < this.resolvedLinks.length; i++) {
      const l = this.resolvedLinks[i];
      this.linkElements[i].setAttribute("x1", String(l.source.x));
      this.linkElements[i].setAttribute("y1", String(l.source.y));
      this.linkElements[i].setAttribute("x2", String(l.target.x));
      this.linkElements[i].setAttribute("y2", String(l.target.y));
    }

    // Update node positions and LOD
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodeGroups[i].setAttribute("transform", `translate(${this.nodes[i].x},${this.nodes[i].y})`);
    }
    this.updateLOD();

    // Update zone hull boundaries
    this.updateZoneHulls();
  }

  // ── Private: Simulation ────────────────────────────────────────────────────

  private tickCallbacks(): TickCallbacks {
    return {
      updateDOM: () => this.updateDOM(),
      fitToContent: () => this.fitToContent(),
      scheduleNextTick: (fn: () => void) => { if (!this.destroyed) requestAnimationFrame(fn); },
    };
  }

  private startSimulation(): void {
    if (this.destroyed) return;
    const runTick = () => { if (!this.destroyed) tick(this.sim, this.tickCallbacks()); };
    requestAnimationFrame(runTick);
  }

  /** Re-heat the simulation to adapt to moved nodes. */
  private reheat(): void {
    if (this.destroyed) return;
    if (this.sim.alpha.value < 0.01) {
      this.sim.alpha.value = 0.3;
      requestAnimationFrame(() => { if (!this.destroyed) tick(this.sim, this.tickCallbacks()); });
    } else {
      this.sim.alpha.value = Math.max(this.sim.alpha.value, 0.3);
    }
  }

  // ── Private: Coordinate helpers ──────────────────────────────────────────

  /** Convert client (screen) coordinates to SVG viewBox coordinates. */
  private clientToViewBox(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: this.viewX + ((clientX - rect.left) / rect.width) * this.viewW,
      y: this.viewY + ((clientY - rect.top) / rect.height) * this.viewH,
    };
  }

  /** Find the node index under a given SVG element by walking up the DOM tree. */
  private findNodeIndex(target: Element): number {
    let el: Element | null = target;
    // Walk up until we find a .graph-node group or leave the SVG
    while (el && el !== this.svg) {
      if (el.classList?.contains("graph-node")) {
        return this.nodeGroups.indexOf(el as unknown as SVGGElement);
      }
      // Direct circle/text child of a node group (fast path)
      if ((el.tagName === "circle" || el.tagName === "text") && el.parentElement?.classList?.contains("graph-node")) {
        return this.nodeGroups.indexOf(el.parentElement as unknown as SVGGElement);
      }
      el = el.parentElement;
    }
    return -1;
  }

  // ── Private: Zoom ──────────────────────────────────────────────────────────

  /** Apply a zoom factor centered on the current viewport center. */
  private applyZoomFromCenter(factor: number): void {
    const cx = this.viewX + this.viewW / 2;
    const cy = this.viewY + this.viewH / 2;
    const newW = this.viewW * factor;
    const newH = this.viewH * factor;
    this.viewX = cx - newW / 2;
    this.viewY = cy - newH / 2;
    this.viewW = newW;
    this.viewH = newH;
    this.scale = this.viewW / this.width;
    this.updateViewBox();
    this.updateLOD();
  }

  private setupZoom(): void {
    this.svg.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();

      const mouseVB = this.clientToViewBox(e.clientX, e.clientY);

      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      const newW = this.viewW * zoomFactor;
      const newH = this.viewH * zoomFactor;

      this.viewX = mouseVB.x - (mouseVB.x - this.viewX) * (newW / this.viewW);
      this.viewY = mouseVB.y - (mouseVB.y - this.viewY) * (newH / this.viewH);
      this.viewW = newW;
      this.viewH = newH;
      this.scale = this.viewW / this.width;
      this.updateViewBox();

      this.updateLOD();
    }, { passive: false, signal: this.ac.signal });
  }

  // ── Private: Pan + Node drag (mouse) ───────────────────────────────────────

  private setupPanAndDrag(
    onNodeSelect: GraphRendererOptions["onNodeSelect"],
    onNodeDblClick?: (path: string) => void,
  ): void {
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    let panStartVX = 0, panStartVY = 0;

    let dragNode: GraphNode | null = null;
    let dragNodeIdx = -1;
    let mouseDownPos: { x: number; y: number } | null = null;
    let isDragging = false;
    const DRAG_THRESHOLD = 3;

    const signal = this.ac.signal;

    // Double-click handler
    this.svg.addEventListener("dblclick", (e: MouseEvent) => {
      const target = e.target as Element;
      const idx = this.findNodeIndex(target);
      if (idx >= 0 && onNodeDblClick) {
        e.preventDefault();
        onNodeDblClick(this.nodes[idx].id);
      }
    }, { signal });

    this.svg.addEventListener("mousedown", (e: MouseEvent) => {
      // Only handle primary (left) button
      if (e.button !== 0) return;

      // Reset pan gesture flag at the start of each interaction
      this.wasPanning = false;

      const target = e.target as Element;
      const idx = this.findNodeIndex(target);

      if (idx >= 0) {
        // Prevent browser text selection / native drag during node drag
        e.preventDefault();
        dragNode = this.nodes[idx];
        dragNodeIdx = idx;
        mouseDownPos = { x: e.clientX, y: e.clientY };
        isDragging = false;
        return;
      }

      // Background click clears selection
      if (target === this.svg || target === this.g) {
        this.clearSelection();
      }

      // Prevent browser text selection / native drag during pan
      e.preventDefault();

      // Background pan
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartVX = this.viewX;
      panStartVY = this.viewY;
      this.svg.classList.add("grabbing");
    }, { signal });

    // mousemove and mouseup are attached to window so dragging/panning
    // continues even when the pointer leaves the SVG boundary.
    const onMouseMove = (e: MouseEvent) => {
      // Node drag
      if (dragNode && mouseDownPos) {
        const dx = e.clientX - mouseDownPos.x;
        const dy = e.clientY - mouseDownPos.y;

        if (!isDragging) {
          if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
            isDragging = true;
            dragNode.fx = dragNode.x;
            dragNode.fy = dragNode.y;
            // Visual feedback for dragging
            this.svg.classList.add("node-dragging");
            if (dragNodeIdx >= 0) this.nodeGroups[dragNodeIdx].classList.add("dragging");
            this.reheat();
          }
          return;
        }

        // Convert client coords to viewBox coords
        const vb = this.clientToViewBox(e.clientX, e.clientY);
        dragNode.fx = vb.x;
        dragNode.fy = vb.y;
        return;
      }

      // Background pan
      if (isPanning) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          this.wasPanning = true;
        }
        const rect = this.svg.getBoundingClientRect();
        this.viewX = panStartVX - (dx / rect.width) * this.viewW;
        this.viewY = panStartVY - (dy / rect.height) * this.viewH;
        this.updateViewBox();
      }
    };

    const onMouseUp = () => {
      if (dragNode) {
        if (!isDragging && dragNodeIdx >= 0) {
          // Click (no drag) — select node and show details
          const n = this.nodes[dragNodeIdx];
          const fileName = basename(n.id);
          this.selectNode(n.id);
          onNodeSelect({
            title: fileName,
            path: n.id,
            zone: n.zone || "unzoned",
            incomingImports: n.importCount,
          });
        } else if (isDragging) {
          // Drag ended — persist position for the session by updating x/y
          // and then release the fixed constraint
          dragNode.x = dragNode.fx!;
          dragNode.y = dragNode.fy!;
          dragNode.vx = 0;
          dragNode.vy = 0;
        }
        // Clear drag visual feedback
        this.svg.classList.remove("node-dragging");
        if (dragNodeIdx >= 0) this.nodeGroups[dragNodeIdx].classList.remove("dragging");
        dragNode.fx = null;
        dragNode.fy = null;
        dragNode = null;
        dragNodeIdx = -1;
        mouseDownPos = null;
        isDragging = false;
      }

      if (isPanning) {
        isPanning = false;
        this.svg.classList.remove("grabbing");
      }
    };

    window.addEventListener("mousemove", onMouseMove, { signal });
    window.addEventListener("mouseup", onMouseUp, { signal });
  }

  // ── Private: Touch interaction ─────────────────────────────────────────────

  private setupTouchInteraction(
    onNodeSelect: GraphRendererOptions["onNodeSelect"],
    onNodeDblClick?: (path: string) => void,
  ): void {
    let touchDragNode: GraphNode | null = null;
    let touchDragIdx = -1;
    let touchStartPos: { x: number; y: number } | null = null;
    let isTouchDragging = false;
    const DRAG_THRESHOLD = 8; // higher threshold for touch

    // Touch pan state
    let isTouchPanning = false;
    let touchPanStartX = 0, touchPanStartY = 0;
    let touchPanStartVX = 0, touchPanStartVY = 0;

    // Double-tap detection
    let lastTapTime = 0;
    let lastTapNodeIdx = -1;
    const DOUBLE_TAP_DELAY = 300;

    // Pinch-zoom state
    let pinchStartDist = 0;
    let pinchStartViewW = 0;
    let pinchStartViewH = 0;
    let pinchMidX = 0;
    let pinchMidY = 0;

    const signal = this.ac.signal;

    this.svg.addEventListener("touchstart", (e: TouchEvent) => {
      // Pinch-zoom: two-finger gesture
      if (e.touches.length === 2) {
        e.preventDefault();
        isTouchPanning = false;
        touchDragNode = null;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        pinchStartViewW = this.viewW;
        pinchStartViewH = this.viewH;
        const midX = (t0.clientX + t1.clientX) / 2;
        const midY = (t0.clientY + t1.clientY) / 2;
        const vb = this.clientToViewBox(midX, midY);
        pinchMidX = vb.x;
        pinchMidY = vb.y;
        return;
      }

      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const target = touch.target as Element;
      const idx = this.findNodeIndex(target);

      if (idx >= 0) {
        e.preventDefault();
        touchDragNode = this.nodes[idx];
        touchDragIdx = idx;
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        isTouchDragging = false;
        return;
      }

      // Background touch pan
      isTouchPanning = true;
      touchPanStartX = touch.clientX;
      touchPanStartY = touch.clientY;
      touchPanStartVX = this.viewX;
      touchPanStartVY = this.viewY;
    }, { passive: false, signal });

    this.svg.addEventListener("touchmove", (e: TouchEvent) => {
      // Pinch-zoom
      if (e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        const ratio = pinchStartDist / dist;
        const newW = pinchStartViewW * ratio;
        const newH = pinchStartViewH * ratio;
        this.viewX = pinchMidX - (pinchMidX - this.viewX) * (newW / this.viewW);
        this.viewY = pinchMidY - (pinchMidY - this.viewY) * (newH / this.viewH);
        this.viewW = newW;
        this.viewH = newH;
        this.scale = this.viewW / this.width;
        this.updateViewBox();
        this.updateLOD();
        return;
      }

      if (e.touches.length !== 1) return;
      const touch = e.touches[0];

      // Node drag
      if (touchDragNode && touchStartPos) {
        const dx = touch.clientX - touchStartPos.x;
        const dy = touch.clientY - touchStartPos.y;

        if (!isTouchDragging) {
          if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
            isTouchDragging = true;
            touchDragNode.fx = touchDragNode.x;
            touchDragNode.fy = touchDragNode.y;
            // Visual feedback for touch dragging
            this.svg.classList.add("node-dragging");
            if (touchDragIdx >= 0) this.nodeGroups[touchDragIdx].classList.add("dragging");
            this.reheat();
          }
          return;
        }

        e.preventDefault();
        const vb = this.clientToViewBox(touch.clientX, touch.clientY);
        touchDragNode.fx = vb.x;
        touchDragNode.fy = vb.y;
        return;
      }

      // Background pan
      if (isTouchPanning) {
        const dx = touch.clientX - touchPanStartX;
        const dy = touch.clientY - touchPanStartY;
        const rect = this.svg.getBoundingClientRect();
        this.viewX = touchPanStartVX - (dx / rect.width) * this.viewW;
        this.viewY = touchPanStartVY - (dy / rect.height) * this.viewH;
        this.updateViewBox();
      }
    }, { passive: false, signal });

    this.svg.addEventListener("touchend", (e: TouchEvent) => {
      if (touchDragNode) {
        if (!isTouchDragging && touchDragIdx >= 0) {
          const n = this.nodes[touchDragIdx];
          const now = Date.now();

          // Double-tap detection
          if (now - lastTapTime < DOUBLE_TAP_DELAY && lastTapNodeIdx === touchDragIdx) {
            if (onNodeDblClick) onNodeDblClick(n.id);
            lastTapTime = 0;
            lastTapNodeIdx = -1;
          } else {
            // Single tap — select node
            lastTapTime = now;
            lastTapNodeIdx = touchDragIdx;
            const fileName = basename(n.id);
            this.selectNode(n.id);
            onNodeSelect({
              title: fileName,
              path: n.id,
              zone: n.zone || "unzoned",
              incomingImports: n.importCount,
            });
          }
        } else if (isTouchDragging && touchDragNode) {
          // Drag ended — persist position
          touchDragNode.x = touchDragNode.fx!;
          touchDragNode.y = touchDragNode.fy!;
          touchDragNode.vx = 0;
          touchDragNode.vy = 0;
        }
        // Clear drag visual feedback
        this.svg.classList.remove("node-dragging");
        if (touchDragIdx >= 0) this.nodeGroups[touchDragIdx].classList.remove("dragging");
        if (touchDragNode) {
          touchDragNode.fx = null;
          touchDragNode.fy = null;
        }
        touchDragNode = null;
        touchDragIdx = -1;
        touchStartPos = null;
        isTouchDragging = false;
      }

      // Clear touch pan on last finger lift
      if (e.touches.length === 0) {
        isTouchPanning = false;
      }
    }, { signal });

    this.svg.addEventListener("touchcancel", () => {
      this.svg.classList.remove("node-dragging");
      if (touchDragIdx >= 0) this.nodeGroups[touchDragIdx].classList.remove("dragging");
      if (touchDragNode) {
        touchDragNode.fx = null;
        touchDragNode.fy = null;
        touchDragNode = null;
      }
      touchDragIdx = -1;
      touchStartPos = null;
      isTouchDragging = false;
      isTouchPanning = false;
    }, { signal });
  }

  // ── Private: Label tooltips ──────────────────────────────────────────────

  /**
   * Show full filename tooltip on node hover. The tooltip is a single shared
   * SVG group that follows the hovered node. This avoids per-node <title>
   * elements (which have inconsistent browser rendering and delays).
   */
  private setupLabelTooltips(): void {
    const signal = this.ac.signal;
    const tooltipText = this.tooltip.querySelector("text") as SVGTextElement;
    const tooltipBg = this.tooltip.querySelector("rect") as SVGRectElement;

    for (let i = 0; i < this.nodes.length; i++) {
      this.nodeGroups[i].addEventListener("mouseenter", () => {
        const node = this.nodes[i];
        const fullName = basename(node.id);
        const displayName = this.nodeGroups[i].querySelector("text")?.textContent || "";

        // Only show tooltip if the label is truncated or hidden
        const label = this.nodeGroups[i].querySelector("text") as SVGTextElement | null;
        const labelHidden = label?.style.display === "none";
        if (fullName === displayName && !labelHidden) {
          return;
        }

        tooltipText.textContent = fullName;

        // Position tooltip above node
        const tx = node.x ?? 0;
        const ty = (node.y ?? 0) - this.nodeRadii[i] - 18;
        this.tooltip.setAttribute("transform", `translate(${tx},${ty})`);

        // Size the background rectangle around the text
        const textLen = fullName.length;
        const approxWidth = textLen * (9 * 0.55) + 8; // 9px font, 0.55 char width, 4px padding each side
        tooltipBg.setAttribute("x", String(-approxWidth / 2));
        tooltipBg.setAttribute("y", "-8");
        tooltipBg.setAttribute("width", String(approxWidth));
        tooltipBg.setAttribute("height", "16");
        tooltipText.setAttribute("text-anchor", "middle");

        this.tooltip.style.display = "";
      }, { signal });

      this.nodeGroups[i].addEventListener("mouseleave", () => {
        this.tooltip.style.display = "none";
      }, { signal });
    }
  }

  // ── Private: Hover highlighting ────────────────────────────────────────────

  private setupHoverHighlighting(): void {
    let hoveredNode: string | null = null;
    const signal = this.ac.signal;

    for (let i = 0; i < this.nodes.length; i++) {
      const nodeId = this.nodes[i].id;

      this.nodeGroups[i].addEventListener("mouseenter", () => {
        // Don't override persistent selection with hover
        if (this.selectedNodeId) return;
        if (hoveredNode === nodeId) return;
        hoveredNode = nodeId;
        const connectedEdges = this.nodeEdgeMap.get(nodeId) ?? new Set();
        const connectedNodes = new Set<string>([nodeId]);

        for (const ei of connectedEdges) {
          const l = this.resolvedLinks[ei];
          connectedNodes.add(l.source.id);
          connectedNodes.add(l.target.id);
        }

        // Dim non-connected
        for (let j = 0; j < this.nodes.length; j++) {
          const ng = this.nodeGroups[j];
          if (connectedNodes.has(this.nodes[j].id)) {
            ng.style.opacity = "1";
          } else {
            ng.style.opacity = "0.2";
          }
        }

        for (let j = 0; j < this.linkElements.length; j++) {
          if (connectedEdges.has(j)) {
            this.linkElements[j].style.strokeOpacity = "0.9";
            this.linkElements[j].style.stroke = "var(--accent)";
          } else {
            this.linkElements[j].style.strokeOpacity = "0.05";
          }
        }
      }, { signal });

      this.nodeGroups[i].addEventListener("mouseleave", () => {
        // Don't clear if a node is persistently selected
        if (this.selectedNodeId) return;
        if (hoveredNode !== nodeId) return;
        hoveredNode = null;

        for (let j = 0; j < this.nodes.length; j++) {
          this.nodeGroups[j].style.opacity = "";
        }
        for (let j = 0; j < this.linkElements.length; j++) {
          this.linkElements[j].style.strokeOpacity = "";
          this.linkElements[j].style.stroke = "";
        }
      }, { signal });
    }
  }
}

// ── Geometry helpers (module-level, no DOM) ──────────────────────────────────

/**
 * Compute convex hull of a set of 2D points using Andrew's monotone chain.
 * Returns points in counter-clockwise order. O(n log n).
 */
function convexHull(points: [number, number][]): [number, number][] {
  if (points.length <= 2) return [...points];

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  // Remove last point of each half (duplicate of first point of other half)
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Expand a convex hull outward by a padding distance. */
function padHull(hull: [number, number][], padding: number): [number, number][] {
  if (hull.length < 3) {
    // For degenerate cases, expand bounding box
    const xs = hull.map(p => p[0]);
    const ys = hull.map(p => p[1]);
    const minX = Math.min(...xs) - padding;
    const maxX = Math.max(...xs) + padding;
    const minY = Math.min(...ys) - padding;
    const maxY = Math.max(...ys) + padding;
    return [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]];
  }

  const result: [number, number][] = [];
  const n = hull.length;

  // Compute centroid
  let cx = 0, cy = 0;
  for (const [x, y] of hull) { cx += x; cy += y; }
  cx /= n; cy /= n;

  // Push each vertex outward from centroid
  for (const [x, y] of hull) {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    result.push([x + (dx / dist) * padding, y + (dy / dist) * padding]);
  }
  return result;
}

/** Convert a hull (polygon) to a smooth SVG path with rounded corners. */
function hullToSmoothPath(hull: [number, number][]): string {
  if (hull.length < 3) return "";
  const n = hull.length;

  // Use cardinal spline approach: cubic Bézier through hull vertices
  const tension = 0.3;
  const parts: string[] = [];

  // Start at midpoint between last and first vertex
  const mx = (hull[n - 1][0] + hull[0][0]) / 2;
  const my = (hull[n - 1][1] + hull[0][1]) / 2;
  parts.push(`M ${mx} ${my}`);

  for (let i = 0; i < n; i++) {
    const p0 = hull[(i - 1 + n) % n];
    const p1 = hull[i];
    const p2 = hull[(i + 1) % n];
    const p3 = hull[(i + 2) % n];

    // Control points using Catmull-Rom to Bézier conversion
    const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
    const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
    const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
    const cp2y = p2[1] - (p3[1] - p1[1]) * tension;

    parts.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`);
  }

  parts.push("Z");
  return parts.join(" ");
}

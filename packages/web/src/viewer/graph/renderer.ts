/**
 * GraphRenderer — imperative SVG rendering for the force-directed import graph.
 *
 * Extracted from viewer/views/graph.ts. Owns all DOM manipulation, event
 * handlers, LOD, and physics integration. Uses AbortController for clean
 * teardown of all event listeners.
 */

import {
  type SimState,
  type TickCallbacks,
  initZoneClusteredPositions,
  tick,
} from "./physics.js";

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

export interface GraphRendererOptions {
  svg: SVGSVGElement;
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
  onNodeSelect: (detail: { title: string; path: string; zone: string; incomingImports: number }) => void;
  zones: unknown; // opaque — only needed for future use
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

  constructor(opts: GraphRendererOptions) {
    const { svg, nodes, links, width, height, onNodeSelect } = opts;

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

    // Clear existing SVG content
    svg.innerHTML = "";

    const ns = "http://www.w3.org/2000/svg";

    this.updateViewBox();

    // Create defs for arrow marker
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

    this.g = document.createElementNS(ns, "g");
    svg.appendChild(this.g);

    // Node map for link resolution
    const nodeMap = new Map<string, GraphNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // Zone-clustered initial positions
    initZoneClusteredPositions(nodes, width, height);

    // Resolve links to node references
    this.resolvedLinks = links.map((l) => ({
      ...l,
      source: nodeMap.get(typeof l.source === "string" ? l.source : l.source.id)!,
      target: nodeMap.get(typeof l.target === "string" ? l.target : l.target.id)!,
    })).filter((l) => l.source && l.target);

    // Build adjacency map for hover highlighting
    this.nodeEdgeMap = new Map();
    for (let i = 0; i < this.resolvedLinks.length; i++) {
      const l = this.resolvedLinks[i];
      const sId = l.source.id;
      const tId = l.target.id;
      if (!this.nodeEdgeMap.has(sId)) this.nodeEdgeMap.set(sId, new Set());
      if (!this.nodeEdgeMap.has(tId)) this.nodeEdgeMap.set(tId, new Set());
      this.nodeEdgeMap.get(sId)!.add(i);
      this.nodeEdgeMap.get(tId)!.add(i);
    }

    // Draw links
    for (const l of this.resolvedLinks) {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("class", `graph-link${l.crossZone ? " cross-zone" : ""}`);
      line.setAttribute("marker-end", "url(#arrowhead)");
      this.g.appendChild(line);
      this.linkElements.push(line);
    }

    // Draw nodes
    for (const n of nodes) {
      const group = document.createElementNS(ns, "g");
      group.setAttribute("class", "graph-node");

      const radius = Math.min(3 + Math.sqrt(n.importCount) * 2, 16);
      this.nodeRadii.push(radius);
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", n.zoneColor || "#555");

      group.appendChild(circle);

      // Always create labels — LOD controls visibility
      const label = document.createElementNS(ns, "text");
      label.setAttribute("class", "graph-label");
      label.setAttribute("dy", String(-radius - 3));
      label.setAttribute("text-anchor", "middle");
      label.textContent = n.id.split("/").pop() || n.id;
      group.appendChild(label);

      this.g.appendChild(group);
      this.nodeGroups.push(group);
    }

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
    this.setupPanAndDrag(onNodeSelect);
    this.setupHoverHighlighting();
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

    const ns = "http://www.w3.org/2000/svg";
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

  destroy(): void {
    this.ac.abort();
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

  // ── Private: LOD ───────────────────────────────────────────────────────────

  private updateLOD(): void {
    for (let i = 0; i < this.nodes.length; i++) {
      const visualRadius = this.nodeRadii[i] / this.scale;
      const circle = this.nodeGroups[i].querySelector("circle");
      const label = this.nodeGroups[i].querySelector("text");

      this.nodeGroups[i].style.display = "";
      if (circle && visualRadius < 1) {
        circle.setAttribute("r", String(this.scale));
      } else if (circle) {
        circle.setAttribute("r", String(this.nodeRadii[i]));
      }

      if (label) {
        if (visualRadius < 3) {
          (label as SVGTextElement).style.display = "none";
        } else {
          (label as SVGTextElement).style.display = "";
          const fontSize = Math.max(7, Math.min(11, 9 / Math.sqrt(this.scale)));
          (label as SVGTextElement).style.fontSize = `${fontSize}px`;
        }
      }
    }
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
  }

  // ── Private: Simulation ────────────────────────────────────────────────────

  private startSimulation(): void {
    const tickCallbacks: TickCallbacks = {
      updateDOM: () => this.updateDOM(),
      fitToContent: () => this.fitToContent(),
      scheduleNextTick: (fn: () => void) => requestAnimationFrame(fn),
    };

    const runTick = () => { tick(this.sim, tickCallbacks); };
    requestAnimationFrame(runTick);
  }

  // ── Private: Zoom (mouse wheel) ────────────────────────────────────────────

  private setupZoom(): void {
    this.svg.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();

      const rect = this.svg.getBoundingClientRect();
      const mouseVBX = this.viewX + ((e.clientX - rect.left) / rect.width) * this.viewW;
      const mouseVBY = this.viewY + ((e.clientY - rect.top) / rect.height) * this.viewH;

      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      const newW = this.viewW * zoomFactor;
      const newH = this.viewH * zoomFactor;

      this.viewX = mouseVBX - (mouseVBX - this.viewX) * (newW / this.viewW);
      this.viewY = mouseVBY - (mouseVBY - this.viewY) * (newH / this.viewH);
      this.viewW = newW;
      this.viewH = newH;
      this.scale = this.viewW / this.width;
      this.updateViewBox();

      this.updateLOD();
    }, { passive: false, signal: this.ac.signal });
  }

  // ── Private: Pan + Node drag ───────────────────────────────────────────────

  private setupPanAndDrag(
    onNodeSelect: GraphRendererOptions["onNodeSelect"],
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

    this.svg.addEventListener("mousedown", (e: MouseEvent) => {
      const target = e.target as Element;

      if (target.tagName === "circle") {
        const group = target.parentElement as unknown as SVGGElement;
        const idx = this.nodeGroups.indexOf(group);
        if (idx >= 0) {
          dragNode = this.nodes[idx];
          dragNodeIdx = idx;
          mouseDownPos = { x: e.clientX, y: e.clientY };
          isDragging = false;
          return;
        }
      }

      // Background pan
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartVX = this.viewX;
      panStartVY = this.viewY;
      this.svg.classList.add("grabbing");
    }, { signal });

    this.svg.addEventListener("mousemove", (e: MouseEvent) => {
      // Node drag
      if (dragNode && mouseDownPos) {
        const dx = e.clientX - mouseDownPos.x;
        const dy = e.clientY - mouseDownPos.y;

        if (!isDragging) {
          if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
            isDragging = true;
            dragNode.fx = dragNode.x;
            dragNode.fy = dragNode.y;
            this.sim.alpha.value = 0.3;
            const tickCallbacks: TickCallbacks = {
              updateDOM: () => this.updateDOM(),
              fitToContent: () => this.fitToContent(),
              scheduleNextTick: (fn: () => void) => requestAnimationFrame(fn),
            };
            requestAnimationFrame(() => tick(this.sim, tickCallbacks));
          }
          return;
        }

        // Convert client coords to viewBox coords
        const rect = this.svg.getBoundingClientRect();
        dragNode.fx = this.viewX + ((e.clientX - rect.left) / rect.width) * this.viewW;
        dragNode.fy = this.viewY + ((e.clientY - rect.top) / rect.height) * this.viewH;
        return;
      }

      // Background pan
      if (isPanning) {
        const dx = e.clientX - panStartX;
        const dy = e.clientY - panStartY;
        const rect = this.svg.getBoundingClientRect();
        this.viewX = panStartVX - (dx / rect.width) * this.viewW;
        this.viewY = panStartVY - (dy / rect.height) * this.viewH;
        this.updateViewBox();
      }
    }, { signal });

    this.svg.addEventListener("mouseup", () => {
      if (dragNode) {
        if (!isDragging && dragNodeIdx >= 0) {
          const n = this.nodes[dragNodeIdx];
          const fileName = n.id.split("/").pop() || n.id;
          onNodeSelect({
            title: fileName,
            path: n.id,
            zone: n.zone || "unzoned",
            incomingImports: n.importCount,
          });
        }
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
    }, { signal });
  }

  // ── Private: Hover highlighting ────────────────────────────────────────────

  private setupHoverHighlighting(): void {
    let hoveredNode: string | null = null;
    const signal = this.ac.signal;

    for (let i = 0; i < this.nodes.length; i++) {
      const nodeId = this.nodes[i].id;

      this.nodeGroups[i].addEventListener("mouseenter", () => {
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

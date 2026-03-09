import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for node interaction in the GraphRenderer.
 *
 * Tests the findNodeIndex DOM-walking logic, drag/click state machine,
 * selection highlighting, and coordinate transforms — all in isolation
 * without requiring a full browser SVG environment.
 *
 * Source implementation: src/viewer/graph/renderer.ts
 * These functions are duplicated here because the renderer does not export
 * its internal algorithms. If the renderer is refactored to extract pure
 * logic modules, these tests should import from those modules directly.
 */

// ── findNodeIndex logic (mirrors renderer implementation) ────────────────────

/**
 * Simulated DOM element for testing findNodeIndex logic.
 * Mirrors the SVG element structure used in the renderer.
 */
interface MockElement {
  tagName: string;
  classList: { contains: (cls: string) => boolean };
  parentElement: MockElement | null;
}

/** Pure implementation of the findNodeIndex algorithm used by GraphRenderer. */
function findNodeIndex(
  target: MockElement,
  nodeGroups: MockElement[],
  svg: MockElement,
): number {
  let el: MockElement | null = target;
  while (el && el !== svg) {
    if (el.classList?.contains("graph-node")) {
      return nodeGroups.indexOf(el);
    }
    if (
      (el.tagName === "circle" || el.tagName === "text") &&
      el.parentElement?.classList?.contains("graph-node")
    ) {
      return nodeGroups.indexOf(el.parentElement);
    }
    el = el.parentElement;
  }
  return -1;
}

function makeMockElement(
  tagName: string,
  classes: string[],
  parent: MockElement | null = null,
): MockElement {
  return {
    tagName,
    classList: { contains: (cls: string) => classes.includes(cls) },
    parentElement: parent,
  };
}

describe("findNodeIndex", () => {
  const svg = makeMockElement("svg", []);
  const rootG = makeMockElement("g", [], svg);

  function makeNodeGroup(): { group: MockElement; circle: MockElement; hitTarget: MockElement; text: MockElement } {
    const group = makeMockElement("g", ["graph-node"], rootG);
    const hitTarget = makeMockElement("circle", ["graph-node-hit"], group);
    const circle = makeMockElement("circle", [], group);
    const text = makeMockElement("text", ["graph-label"], group);
    return { group, circle, hitTarget, text };
  }

  it("finds node when clicking on visible circle", () => {
    const { group, circle } = makeNodeGroup();
    expect(findNodeIndex(circle, [group], svg)).toBe(0);
  });

  it("finds node when clicking on hit target circle", () => {
    const { group, hitTarget } = makeNodeGroup();
    expect(findNodeIndex(hitTarget, [group], svg)).toBe(0);
  });

  it("finds node when clicking on text label", () => {
    const { group, text } = makeNodeGroup();
    expect(findNodeIndex(text, [group], svg)).toBe(0);
  });

  it("finds node when clicking on the group element itself", () => {
    const { group } = makeNodeGroup();
    expect(findNodeIndex(group, [group], svg)).toBe(0);
  });

  it("returns -1 for SVG background", () => {
    expect(findNodeIndex(svg, [], svg)).toBe(-1);
  });

  it("returns -1 for root group", () => {
    expect(findNodeIndex(rootG, [], svg)).toBe(-1);
  });

  it("returns -1 for zone hull elements", () => {
    const hullGroup = makeMockElement("g", ["zone-hull-group"], rootG);
    const path = makeMockElement("path", ["zone-hull"], hullGroup);
    expect(findNodeIndex(path, [], svg)).toBe(-1);
    expect(findNodeIndex(hullGroup, [], svg)).toBe(-1);
  });

  it("returns -1 for link elements", () => {
    const link = makeMockElement("line", ["graph-link"], rootG);
    expect(findNodeIndex(link, [], svg)).toBe(-1);
  });

  it("correctly identifies the right node among multiple", () => {
    const node0 = makeNodeGroup();
    const node1 = makeNodeGroup();
    const node2 = makeNodeGroup();
    const groups = [node0.group, node1.group, node2.group];

    expect(findNodeIndex(node0.circle, groups, svg)).toBe(0);
    expect(findNodeIndex(node1.circle, groups, svg)).toBe(1);
    expect(findNodeIndex(node2.hitTarget, groups, svg)).toBe(2);
    expect(findNodeIndex(node1.text, groups, svg)).toBe(1);
    expect(findNodeIndex(node2.group, groups, svg)).toBe(2);
  });

  it("handles nested elements inside node groups (e.g., search ring)", () => {
    const group = makeMockElement("g", ["graph-node"], rootG);
    // Search ring is a circle added as child of node group
    const searchRing = makeMockElement("circle", ["graph-search-ring"], group);
    expect(findNodeIndex(searchRing, [group], svg)).toBe(0);
  });
});

// ── Drag state machine ──────────────────────────────────────────────────────

describe("drag state machine", () => {
  const DRAG_THRESHOLD = 3;

  interface DragState {
    dragNode: { id: string; x: number; y: number; fx: number | null; fy: number | null; vx: number; vy: number } | null;
    mouseDownPos: { x: number; y: number } | null;
    isDragging: boolean;
  }

  function initDragState(): DragState {
    return { dragNode: null, mouseDownPos: null, isDragging: false };
  }

  function startDrag(state: DragState, node: DragState["dragNode"], clientX: number, clientY: number): void {
    state.dragNode = node;
    state.mouseDownPos = { x: clientX, y: clientY };
    state.isDragging = false;
  }

  function moveDrag(state: DragState, clientX: number, clientY: number): "started" | "moved" | "none" {
    if (!state.dragNode || !state.mouseDownPos) return "none";
    const dx = clientX - state.mouseDownPos.x;
    const dy = clientY - state.mouseDownPos.y;
    if (!state.isDragging) {
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        state.isDragging = true;
        state.dragNode.fx = state.dragNode.x;
        state.dragNode.fy = state.dragNode.y;
        return "started";
      }
      return "none";
    }
    state.dragNode.fx = clientX;
    state.dragNode.fy = clientY;
    return "moved";
  }

  function endDrag(state: DragState): "click" | "drag-end" | "none" {
    if (!state.dragNode) return "none";
    let result: "click" | "drag-end" | "none";
    if (!state.isDragging) {
      result = "click";
    } else {
      state.dragNode.x = state.dragNode.fx!;
      state.dragNode.y = state.dragNode.fy!;
      state.dragNode.vx = 0;
      state.dragNode.vy = 0;
      result = "drag-end";
    }
    state.dragNode.fx = null;
    state.dragNode.fy = null;
    state.dragNode = null;
    state.mouseDownPos = null;
    state.isDragging = false;
    return result;
  }

  it("registers a click when mouse down+up without movement", () => {
    const state = initDragState();
    const node = { id: "test.ts", x: 100, y: 200, fx: null, fy: null, vx: 0, vy: 0 };
    startDrag(state, node, 50, 50);
    expect(endDrag(state)).toBe("click");
  });

  it("registers a click when mouse moves less than threshold", () => {
    const state = initDragState();
    const node = { id: "test.ts", x: 100, y: 200, fx: null, fy: null, vx: 0, vy: 0 };
    startDrag(state, node, 50, 50);
    moveDrag(state, 51, 51); // move 1.4px — under threshold
    expect(state.isDragging).toBe(false);
    expect(endDrag(state)).toBe("click");
  });

  it("starts drag when mouse moves past threshold", () => {
    const state = initDragState();
    const node = { id: "test.ts", x: 100, y: 200, fx: null, fy: null, vx: 0, vy: 0 };
    startDrag(state, node, 50, 50);
    const result = moveDrag(state, 54, 50); // move 4px — over threshold
    expect(result).toBe("started");
    expect(state.isDragging).toBe(true);
    // Node should be pinned at its current position
    expect(node.fx).toBe(100);
    expect(node.fy).toBe(200);
  });

  it("updates node position during drag", () => {
    const state = initDragState();
    const node = { id: "test.ts", x: 100, y: 200, fx: null, fy: null, vx: 0, vy: 0 };
    startDrag(state, node, 50, 50);
    moveDrag(state, 54, 50); // start drag
    const result = moveDrag(state, 150, 200); // continue drag
    expect(result).toBe("moved");
    expect(node.fx).toBe(150);
    expect(node.fy).toBe(200);
  });

  it("persists position on drag end and releases fix constraint", () => {
    const state = initDragState();
    const node = { id: "test.ts", x: 100, y: 200, fx: null, fy: null, vx: 5, vy: 5 };
    startDrag(state, node, 50, 50);
    moveDrag(state, 54, 50); // start drag
    moveDrag(state, 300, 400); // drag to new position
    const result = endDrag(state);
    expect(result).toBe("drag-end");
    // Position should be persisted from fx/fy
    expect(node.x).toBe(300);
    expect(node.y).toBe(400);
    // Velocity should be zeroed
    expect(node.vx).toBe(0);
    expect(node.vy).toBe(0);
    // Fixed constraint should be released
    expect(node.fx).toBeNull();
    expect(node.fy).toBeNull();
  });

  it("cleans up state after click", () => {
    const state = initDragState();
    const node = { id: "test.ts", x: 100, y: 200, fx: null, fy: null, vx: 0, vy: 0 };
    startDrag(state, node, 50, 50);
    endDrag(state);
    expect(state.dragNode).toBeNull();
    expect(state.mouseDownPos).toBeNull();
    expect(state.isDragging).toBe(false);
  });

  it("returns none when ending with no active drag", () => {
    const state = initDragState();
    expect(endDrag(state)).toBe("none");
  });
});

// ── Selection highlighting ──────────────────────────────────────────────────

describe("selection highlighting", () => {
  interface SelectionState {
    selectedNodeId: string | null;
    nodeOpacities: Map<string, string>;
    edgeHighlights: Map<number, { strokeOpacity: string; stroke: string }>;
  }

  /** Build a node-edge adjacency map (mirrors GraphRenderer.nodeEdgeMap). */
  function buildNodeEdgeMap(
    links: Array<{ source: string; target: string }>,
  ): Map<string, Set<number>> {
    const map = new Map<string, Set<number>>();
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      if (!map.has(l.source)) map.set(l.source, new Set());
      if (!map.has(l.target)) map.set(l.target, new Set());
      map.get(l.source)!.add(i);
      map.get(l.target)!.add(i);
    }
    return map;
  }

  /** Apply selection highlight (mirrors GraphRenderer.applySelectionHighlight). */
  function applySelectionHighlight(
    nodeId: string,
    nodeIds: string[],
    links: Array<{ source: string; target: string }>,
    nodeEdgeMap: Map<string, Set<number>>,
  ): SelectionState {
    const connectedEdges = nodeEdgeMap.get(nodeId) ?? new Set<number>();
    const connectedNodes = new Set<string>([nodeId]);
    for (const ei of connectedEdges) {
      connectedNodes.add(links[ei].source);
      connectedNodes.add(links[ei].target);
    }

    const nodeOpacities = new Map<string, string>();
    for (const nid of nodeIds) {
      nodeOpacities.set(nid, connectedNodes.has(nid) ? "1" : "0.2");
    }

    const edgeHighlights = new Map<number, { strokeOpacity: string; stroke: string }>();
    for (let i = 0; i < links.length; i++) {
      edgeHighlights.set(i, connectedEdges.has(i)
        ? { strokeOpacity: "0.9", stroke: "var(--accent)" }
        : { strokeOpacity: "0.05", stroke: "" });
    }

    return { selectedNodeId: nodeId, nodeOpacities, edgeHighlights };
  }

  const nodes = ["a.ts", "b.ts", "c.ts", "d.ts"];
  const links = [
    { source: "a.ts", target: "b.ts" },
    { source: "b.ts", target: "c.ts" },
    { source: "c.ts", target: "d.ts" },
  ];
  const nodeEdgeMap = buildNodeEdgeMap(links);

  it("highlights selected node and its direct connections", () => {
    const state = applySelectionHighlight("b.ts", nodes, links, nodeEdgeMap);
    expect(state.selectedNodeId).toBe("b.ts");
    // b.ts is connected to a.ts (via edge 0) and c.ts (via edge 1)
    expect(state.nodeOpacities.get("a.ts")).toBe("1");
    expect(state.nodeOpacities.get("b.ts")).toBe("1");
    expect(state.nodeOpacities.get("c.ts")).toBe("1");
    // d.ts is not directly connected to b.ts
    expect(state.nodeOpacities.get("d.ts")).toBe("0.2");
  });

  it("highlights connected edges and dims unconnected edges", () => {
    const state = applySelectionHighlight("b.ts", nodes, links, nodeEdgeMap);
    // Edge 0 (a→b) and edge 1 (b→c) should be highlighted
    expect(state.edgeHighlights.get(0)!.strokeOpacity).toBe("0.9");
    expect(state.edgeHighlights.get(1)!.strokeOpacity).toBe("0.9");
    // Edge 2 (c→d) should be dimmed
    expect(state.edgeHighlights.get(2)!.strokeOpacity).toBe("0.05");
  });

  it("highlights only the selected node when it has no connections", () => {
    const isolated = ["a.ts", "b.ts", "isolated.ts"];
    const isoLinks = [{ source: "a.ts", target: "b.ts" }];
    const isoMap = buildNodeEdgeMap(isoLinks);
    const state = applySelectionHighlight("isolated.ts", isolated, isoLinks, isoMap);
    expect(state.nodeOpacities.get("isolated.ts")).toBe("1");
    expect(state.nodeOpacities.get("a.ts")).toBe("0.2");
    expect(state.nodeOpacities.get("b.ts")).toBe("0.2");
  });

  it("handles leaf node selection (one connection)", () => {
    const state = applySelectionHighlight("a.ts", nodes, links, nodeEdgeMap);
    // a.ts only connects to b.ts
    expect(state.nodeOpacities.get("a.ts")).toBe("1");
    expect(state.nodeOpacities.get("b.ts")).toBe("1");
    expect(state.nodeOpacities.get("c.ts")).toBe("0.2");
    expect(state.nodeOpacities.get("d.ts")).toBe("0.2");
    // Only edge 0 should be highlighted
    expect(state.edgeHighlights.get(0)!.strokeOpacity).toBe("0.9");
    expect(state.edgeHighlights.get(1)!.strokeOpacity).toBe("0.05");
  });
});

// ── clientToViewBox coordinate transform ─────────────────────────────────────

describe("clientToViewBox coordinate transform", () => {
  /** Mirrors GraphRenderer.clientToViewBox. */
  function clientToViewBox(
    clientX: number,
    clientY: number,
    rect: { left: number; top: number; width: number; height: number },
    viewX: number,
    viewY: number,
    viewW: number,
    viewH: number,
  ): { x: number; y: number } {
    return {
      x: viewX + ((clientX - rect.left) / rect.width) * viewW,
      y: viewY + ((clientY - rect.top) / rect.height) * viewH,
    };
  }

  const rect = { left: 0, top: 0, width: 800, height: 600 };

  it("maps top-left corner to viewBox origin at default view", () => {
    const vb = clientToViewBox(0, 0, rect, 0, 0, 800, 600);
    expect(vb.x).toBe(0);
    expect(vb.y).toBe(0);
  });

  it("maps center of element to center of viewBox at default view", () => {
    const vb = clientToViewBox(400, 300, rect, 0, 0, 800, 600);
    expect(vb.x).toBe(400);
    expect(vb.y).toBe(300);
  });

  it("accounts for panned viewport", () => {
    // Viewport panned to (100, 50)
    const vb = clientToViewBox(0, 0, rect, 100, 50, 800, 600);
    expect(vb.x).toBe(100);
    expect(vb.y).toBe(50);
  });

  it("accounts for zoomed viewport", () => {
    // Zoomed in 2x: viewW=400, viewH=300, viewport at origin
    const vb = clientToViewBox(400, 300, rect, 0, 0, 400, 300);
    // At center of screen, we're at center of a 400x300 viewBox
    expect(vb.x).toBe(200);
    expect(vb.y).toBe(150);
  });

  it("accounts for both zoom and pan", () => {
    // Zoomed 2x, panned to (100, 50)
    const vb = clientToViewBox(0, 0, rect, 100, 50, 400, 300);
    expect(vb.x).toBe(100);
    expect(vb.y).toBe(50);
  });

  it("maps client coordinates correctly for dragging", () => {
    // Simulate: user drags from (100,100) to (200,150) on a zoomed-in viewport
    const start = clientToViewBox(100, 100, rect, 50, 25, 400, 300);
    const end = clientToViewBox(200, 150, rect, 50, 25, 400, 300);
    // The viewBox distance should be proportional to zoom
    expect(end.x - start.x).toBeCloseTo(50); // 100px screen * (400/800) zoom
    expect(end.y - start.y).toBeCloseTo(25); // 50px screen * (300/600) zoom
  });
});

// ── Hit target sizing ────────────────────────────────────────────────────────

describe("hit target sizing", () => {
  /** Compute visible circle radius (mirrors node creation logic). */
  function computeNodeRadius(importCount: number): number {
    return Math.min(3 + Math.sqrt(importCount) * 2, 16);
  }

  /** Compute hit target radius (mirrors node creation logic). */
  function computeHitRadius(visibleRadius: number): number {
    return Math.max(visibleRadius + 4, 10);
  }

  it("hit target is always at least 10px for easy clicking", () => {
    // Node with 0 imports has radius 3
    const smallRadius = computeNodeRadius(0);
    expect(smallRadius).toBe(3);
    expect(computeHitRadius(smallRadius)).toBe(10);
  });

  it("hit target extends 4px beyond visible circle for large nodes", () => {
    // Node with 100 imports has radius 16 (max)
    const largeRadius = computeNodeRadius(100);
    expect(largeRadius).toBe(16);
    expect(computeHitRadius(largeRadius)).toBe(20);
  });

  it("hit target is proportional for medium nodes", () => {
    const mediumRadius = computeNodeRadius(9);
    expect(mediumRadius).toBe(9); // 3 + sqrt(9)*2 = 3+6 = 9
    expect(computeHitRadius(mediumRadius)).toBe(13);
  });
});

// ── Node adjacency map building ──────────────────────────────────────────────

describe("node adjacency map", () => {
  function buildNodeEdgeMap(
    links: Array<{ source: string; target: string }>,
  ): Map<string, Set<number>> {
    const map = new Map<string, Set<number>>();
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      if (!map.has(l.source)) map.set(l.source, new Set());
      if (!map.has(l.target)) map.set(l.target, new Set());
      map.get(l.source)!.add(i);
      map.get(l.target)!.add(i);
    }
    return map;
  }

  it("maps each node to its connected edges", () => {
    const links = [
      { source: "a.ts", target: "b.ts" },
      { source: "b.ts", target: "c.ts" },
    ];
    const map = buildNodeEdgeMap(links);
    expect(map.get("a.ts")!.has(0)).toBe(true);
    expect(map.get("b.ts")!.has(0)).toBe(true);
    expect(map.get("b.ts")!.has(1)).toBe(true);
    expect(map.get("c.ts")!.has(1)).toBe(true);
    // a.ts should not be connected to edge 1
    expect(map.get("a.ts")!.has(1)).toBe(false);
  });

  it("handles nodes with no connections", () => {
    const links: Array<{ source: string; target: string }> = [];
    const map = buildNodeEdgeMap(links);
    expect(map.size).toBe(0);
  });

  it("handles self-referencing edges", () => {
    const links = [{ source: "a.ts", target: "a.ts" }];
    const map = buildNodeEdgeMap(links);
    expect(map.get("a.ts")!.size).toBe(1);
    expect(map.get("a.ts")!.has(0)).toBe(true);
  });
});

// ── Pan state machine ────────────────────────────────────────────────────────

describe("pan state machine", () => {
  /**
   * Simulates the pan state machine from GraphRenderer.setupPanAndDrag.
   * Tests the logic in isolation without DOM.
   */
  interface PanState {
    isPanning: boolean;
    panStartX: number;
    panStartY: number;
    panStartVX: number;
    panStartVY: number;
    wasPanning: boolean;
    viewX: number;
    viewY: number;
    viewW: number;
    viewH: number;
    containerWidth: number;
    containerHeight: number;
  }

  function initPanState(): PanState {
    return {
      isPanning: false,
      panStartX: 0,
      panStartY: 0,
      panStartVX: 0,
      panStartVY: 0,
      wasPanning: false,
      viewX: 0,
      viewY: 0,
      viewW: 800,
      viewH: 600,
      containerWidth: 800,
      containerHeight: 600,
    };
  }

  /** Simulate mousedown on background (non-node target). */
  function startPan(state: PanState, clientX: number, clientY: number): void {
    state.wasPanning = false;
    state.isPanning = true;
    state.panStartX = clientX;
    state.panStartY = clientY;
    state.panStartVX = state.viewX;
    state.panStartVY = state.viewY;
  }

  /** Simulate mousemove during pan. Returns true if viewport moved. */
  function movePan(state: PanState, clientX: number, clientY: number): boolean {
    if (!state.isPanning) return false;
    const dx = clientX - state.panStartX;
    const dy = clientY - state.panStartY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      state.wasPanning = true;
    }
    state.viewX = state.panStartVX - (dx / state.containerWidth) * state.viewW;
    state.viewY = state.panStartVY - (dy / state.containerHeight) * state.viewH;
    return true;
  }

  /** Simulate mouseup to end pan. */
  function endPan(state: PanState): void {
    state.isPanning = false;
  }

  it("starts pan on background mousedown", () => {
    const state = initPanState();
    startPan(state, 100, 100);
    expect(state.isPanning).toBe(true);
    expect(state.wasPanning).toBe(false);
  });

  it("updates viewport on mousemove", () => {
    const state = initPanState();
    startPan(state, 100, 100);
    movePan(state, 200, 150);
    // Dragging right by 100px should shift viewX left by 100 viewBox units
    expect(state.viewX).toBe(-100);
    // Dragging down by 50px should shift viewY up by 50 viewBox units
    expect(state.viewY).toBe(-50);
  });

  it("sets wasPanning flag when mouse moves > 1px", () => {
    const state = initPanState();
    startPan(state, 100, 100);
    // Move just 1px — below threshold
    movePan(state, 101, 100);
    expect(state.wasPanning).toBe(false);
    // Move 2px — above threshold
    movePan(state, 102, 100);
    expect(state.wasPanning).toBe(true);
  });

  it("does NOT set wasPanning on tiny sub-pixel movement", () => {
    const state = initPanState();
    startPan(state, 100, 100);
    movePan(state, 100.5, 100.5);
    expect(state.wasPanning).toBe(false);
  });

  it("resets wasPanning on new mousedown", () => {
    const state = initPanState();
    startPan(state, 100, 100);
    movePan(state, 200, 200);
    expect(state.wasPanning).toBe(true);
    endPan(state);
    // New mousedown resets flag
    startPan(state, 200, 200);
    expect(state.wasPanning).toBe(false);
  });

  it("pan works when zoomed in (smaller viewW)", () => {
    const state = initPanState();
    state.viewW = 400; // 2x zoom
    state.viewH = 300;
    startPan(state, 100, 100);
    movePan(state, 200, 100); // drag 100px right
    // At 2x zoom: 100px drag = 50 viewBox units
    expect(state.viewX).toBeCloseTo(-50);
  });

  it("mouseup ends pan", () => {
    const state = initPanState();
    startPan(state, 100, 100);
    expect(state.isPanning).toBe(true);
    endPan(state);
    expect(state.isPanning).toBe(false);
  });

  it("mousemove after mouseup does not pan", () => {
    const state = initPanState();
    startPan(state, 100, 100);
    endPan(state);
    const moved = movePan(state, 200, 200);
    expect(moved).toBe(false);
    expect(state.viewX).toBe(0);
    expect(state.viewY).toBe(0);
  });
});

// ── Pan + zone hull interaction ──────────────────────────────────────────────

describe("pan vs zone hull click suppression", () => {
  /**
   * Tests that a zone hull click is suppressed when it immediately follows
   * a pan gesture (wasPanning === true).
   */

  it("zone click is suppressed after a pan gesture", () => {
    let wasPanning = false;
    let zoneSelected = false;

    // Simulate pan gesture
    wasPanning = true;

    // Zone click handler logic (mirrors renderer)
    if (wasPanning) {
      wasPanning = false;
      // return; — zone click suppressed
    } else {
      zoneSelected = true;
    }

    expect(zoneSelected).toBe(false);
    expect(wasPanning).toBe(false);
  });

  it("zone click fires when no pan occurred", () => {
    let wasPanning = false;
    let zoneSelected = false;

    // No pan gesture — wasPanning stays false

    // Zone click handler logic (mirrors renderer)
    if (wasPanning) {
      wasPanning = false;
    } else {
      zoneSelected = true;
    }

    expect(zoneSelected).toBe(true);
  });

  it("zone click fires on second click after pan (flag was consumed)", () => {
    let wasPanning = true;
    let zoneSelected = false;

    // First click after pan — suppressed, consumes the flag
    if (wasPanning) {
      wasPanning = false;
    } else {
      zoneSelected = true;
    }
    expect(zoneSelected).toBe(false);

    // Second click — no longer panning
    if (wasPanning) {
      wasPanning = false;
    } else {
      zoneSelected = true;
    }
    expect(zoneSelected).toBe(true);
  });
});

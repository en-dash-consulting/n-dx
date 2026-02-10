/**
 * Physics engine for the force-directed graph layout.
 *
 * Barnes-Hut quad-tree for O(n log n) repulsion,
 * link attraction, center gravity, and velocity integration.
 *
 * Extracted from viewer/views/graph.ts — pure refactor, no behavioural changes.
 */

// ── Types shared with graph.ts ──────────────────────────────────────────────

export interface PhysicsNode {
  id: string;
  zone?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface PhysicsLink {
  source: PhysicsNode;
  target: PhysicsNode;
}

/** Barnes-Hut quad-tree node. */
export interface QTNode {
  cx: number; cy: number; mass: number;
  x0: number; y0: number; x1: number; y1: number;
  children: (QTNode | null)[] | null; // null = leaf
  nodeIdx: number; // -1 for internal nodes
}

// ── Mutable simulation state container ──────────────────────────────────────

export interface SimState {
  nodes: PhysicsNode[];
  resolvedLinks: PhysicsLink[];
  width: number;
  height: number;
  alpha: { value: number };
  frameCount: number;
  hasFitted: boolean;
  /** Current scale factor (viewW / width). */
  scale: number;
  nodeRadii: number[];
}

// ── Force parameters ────────────────────────────────────────────────────────

export function computeForceParams(nodeCount: number) {
  const alphaDecay = 0.02;
  const velocityDecay = 0.6;
  const repulsionStrength = -150 / Math.sqrt(Math.max(nodeCount, 1));
  const centerGravityStrength = 0.01;
  const linkRestLength = Math.max(40, 80 / Math.sqrt(Math.max(nodeCount / 20, 1)));
  const useBH = nodeCount > 200;
  const bhTheta = 0.9;
  return { alphaDecay, velocityDecay, repulsionStrength, centerGravityStrength, linkRestLength, useBH, bhTheta };
}

// ── Deterministic hash for stable initial positions ─────────────────────────

export function hashPosition(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return (h & 0x7fffffff) / 0x7fffffff; // 0..1
}

// ── Zone-clustered initial layout ───────────────────────────────────────────

export function initZoneClusteredPositions(
  nodes: PhysicsNode[],
  width: number,
  height: number,
): void {
  const zoneGroups = new Map<string, PhysicsNode[]>();
  const unzonedNodes: PhysicsNode[] = [];
  for (const n of nodes) {
    if (n.zone) {
      let group = zoneGroups.get(n.zone);
      if (!group) { group = []; zoneGroups.set(n.zone, group); }
      group.push(n);
    } else {
      unzonedNodes.push(n);
    }
  }

  const zoneIds = [...zoneGroups.keys()].sort();
  const clusterRadius = Math.min(width, height) * 0.3;

  for (let zi = 0; zi < zoneIds.length; zi++) {
    const zoneId = zoneIds[zi];
    const members = zoneGroups.get(zoneId)!;
    const angle = (2 * Math.PI * zi) / Math.max(zoneIds.length, 1);
    const cx = width / 2 + clusterRadius * Math.cos(angle);
    const cy = height / 2 + clusterRadius * Math.sin(angle);
    const scatter = Math.min(30 * Math.sqrt(members.length), 200);
    for (const n of members) {
      const hx = hashPosition(n.id + ":x");
      const hy = hashPosition(n.id + ":y");
      n.x = cx + (hx - 0.5) * scatter;
      n.y = cy + (hy - 0.5) * scatter;
      n.vx = 0;
      n.vy = 0;
    }
  }

  // Unzoned files go to center
  for (const n of unzonedNodes) {
    const hx = hashPosition(n.id + ":x");
    const hy = hashPosition(n.id + ":y");
    n.x = width / 2 + (hx - 0.5) * width * 0.15;
    n.y = height / 2 + (hy - 0.5) * height * 0.15;
    n.vx = 0;
    n.vy = 0;
  }
}

// ── Barnes-Hut quad-tree ────────────────────────────────────────────────────

export function buildQuadTree(nodes: PhysicsNode[], nodeCount: number): QTNode | null {
  if (nodeCount === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    if (n.x! < x0) x0 = n.x!; if (n.y! < y0) y0 = n.y!;
    if (n.x! > x1) x1 = n.x!; if (n.y! > y1) y1 = n.y!;
  }
  const pad = Math.max(x1 - x0, y1 - y0) * 0.01 + 1;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;

  const root: QTNode = { cx: 0, cy: 0, mass: 0, x0, y0, x1, y1, children: null, nodeIdx: -1 };

  function insert(qt: QTNode, idx: number, nx: number, ny: number): void {
    if (qt.mass === 0 && qt.children === null) {
      // Empty leaf
      qt.nodeIdx = idx; qt.cx = nx; qt.cy = ny; qt.mass = 1;
      return;
    }
    if (qt.children === null) {
      // Leaf with one node — subdivide
      qt.children = [null, null, null, null];
      const midX = (qt.x0 + qt.x1) / 2, midY = (qt.y0 + qt.y1) / 2;
      const oi = qt.nodeIdx;
      qt.nodeIdx = -1;
      insertIntoChild(qt, oi, qt.cx, qt.cy, midX, midY);
    }
    // Internal node — insert into child
    const midX = (qt.x0 + qt.x1) / 2, midY = (qt.y0 + qt.y1) / 2;
    qt.cx = (qt.cx * qt.mass + nx) / (qt.mass + 1);
    qt.cy = (qt.cy * qt.mass + ny) / (qt.mass + 1);
    qt.mass++;
    insertIntoChild(qt, idx, nx, ny, midX, midY);
  }

  function insertIntoChild(qt: QTNode, idx: number, nx: number, ny: number, midX: number, midY: number): void {
    const ci = (nx < midX ? 0 : 1) + (ny < midY ? 0 : 2);
    if (!qt.children![ci]) {
      const x0 = ci & 1 ? midX : qt.x0;
      const x1 = ci & 1 ? qt.x1 : midX;
      const y0 = ci & 2 ? midY : qt.y0;
      const y1 = ci & 2 ? qt.y1 : midY;
      qt.children![ci] = { cx: 0, cy: 0, mass: 0, x0, y0, x1, y1, children: null, nodeIdx: -1 };
    }
    insert(qt.children![ci]!, idx, nx, ny);
  }

  for (let i = 0; i < nodeCount; i++) {
    insert(root, i, nodes[i].x!, nodes[i].y!);
  }
  return root;
}

export function bhRepulsion(
  qt: QTNode | null,
  idx: number,
  nx: number,
  ny: number,
  a: number,
  nodes: PhysicsNode[],
  repulsionStrength: number,
  bhTheta: number,
): void {
  if (!qt || qt.mass === 0) return;
  const dx = qt.cx - nx, dy = qt.cy - ny;
  const dist2 = dx * dx + dy * dy;
  const size = qt.x1 - qt.x0;
  if (qt.children === null || (size * size / dist2) < bhTheta * bhTheta) {
    // Treat as single body
    if (dist2 < 0.01) return;
    const dist = Math.sqrt(dist2);
    const force = repulsionStrength * a * qt.mass / dist2;
    const fx = (dx / dist) * force, fy = (dy / dist) * force;
    nodes[idx].vx! += fx;
    nodes[idx].vy! += fy;
    return;
  }
  for (const child of qt.children!) {
    if (child) bhRepulsion(child, idx, nx, ny, a, nodes, repulsionStrength, bhTheta);
  }
}

// ── Force tick ──────────────────────────────────────────────────────────────

/**
 * Callbacks the renderer supplies so the tick can update the DOM and viewBox.
 */
export interface TickCallbacks {
  updateDOM: (sim: SimState) => void;
  fitToContent: () => void;
  scheduleNextTick: (fn: () => void) => void;
}

export function tick(sim: SimState, callbacks: TickCallbacks): void {
  const { nodes, resolvedLinks, width, height } = sim;
  const nodeCount = nodes.length;
  const { alphaDecay, velocityDecay, repulsionStrength, centerGravityStrength, linkRestLength, useBH, bhTheta } =
    computeForceParams(nodeCount);

  sim.alpha.value *= (1 - alphaDecay);
  sim.frameCount++;

  // Frame-skip when nearly settled
  if (sim.alpha.value < 0.1 && sim.frameCount % 2 !== 0) {
    if (sim.alpha.value > 0.01) callbacks.scheduleNextTick(() => tick(sim, callbacks));
    return;
  }

  const a = sim.alpha.value;

  // Center gravity (stronger than before)
  for (const n of nodes) {
    n.vx! += (width / 2 - n.x!) * centerGravityStrength * a;
    n.vy! += (height / 2 - n.y!) * centerGravityStrength * a;
  }

  // Repulsion between nodes — Barnes-Hut or direct O(n^2)
  if (useBH) {
    const tree = buildQuadTree(nodes, nodeCount);
    for (let i = 0; i < nodeCount; i++) {
      bhRepulsion(tree, i, nodes[i].x!, nodes[i].y!, a, nodes, repulsionStrength, bhTheta);
    }
  } else {
    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        const dx = nodes[j].x! - nodes[i].x!;
        const dy = nodes[j].y! - nodes[i].y!;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsionStrength * a / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        nodes[i].vx! -= fx;
        nodes[i].vy! -= fy;
        nodes[j].vx! += fx;
        nodes[j].vy! += fy;
      }
    }
  }

  // Link attraction with scaled rest length
  for (const l of resolvedLinks) {
    const source = l.source;
    const target = l.target;
    const dx = target.x! - source.x!;
    const dy = target.y! - source.y!;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - linkRestLength) * 0.005 * a;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    source.vx! += fx;
    source.vy! += fy;
    target.vx! -= fx;
    target.vy! -= fy;
  }

  // Soft boundary force — pull back nodes that drift too far from center
  const boundaryRadius = Math.min(width, height) * 0.6;
  const boundaryStrength = 0.05;
  const cx = width / 2, cy = height / 2;
  for (const n of nodes) {
    const dx = n.x! - cx;
    const dy = n.y! - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > boundaryRadius) {
      const excess = (dist - boundaryRadius) / dist;
      n.vx! -= dx * excess * boundaryStrength * a;
      n.vy! -= dy * excess * boundaryStrength * a;
    }
  }

  // Update positions (no bounds clamping — user can pan)
  for (const n of nodes) {
    if (n.fx != null) { n.x = n.fx; n.vx = 0; }
    else {
      n.vx! *= velocityDecay;
      n.x! += n.vx!;
    }
    if (n.fy != null) { n.y = n.fy; n.vy = 0; }
    else {
      n.vy! *= velocityDecay;
      n.y! += n.vy!;
    }
  }

  // Let the renderer update SVG elements
  callbacks.updateDOM(sim);

  // Continuous fit-to-content during early simulation
  if (sim.frameCount <= 100 && sim.frameCount % 20 === 0) {
    callbacks.fitToContent();
  }
  // Final fit at settle
  if (!sim.hasFitted && sim.alpha.value < 0.1) {
    sim.hasFitted = true;
    callbacks.fitToContent();
  }

  if (sim.alpha.value > 0.01) {
    callbacks.scheduleNextTick(() => tick(sim, callbacks));
  }
}

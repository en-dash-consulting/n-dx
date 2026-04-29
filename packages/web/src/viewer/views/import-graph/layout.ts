/**
 * Deterministic layered layout for the focused import subgraph (SVG coords).
 */

export type NodeKind = "file" | "package";

export interface LayoutNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** Short label (basename or package name) */
  label: string;
}

/** SVG node box sizes — keep in sync with `import-graph.css` (.ig-node-* rect). */
export const FILE_NODE_BOX = { w: 168, h: 52 } as const;
export const PKG_NODE_BOX = { w: 180, h: 42 } as const;

export function nodeBox(kind: NodeKind): { readonly w: number; readonly h: number } {
  return kind === "package" ? PKG_NODE_BOX : FILE_NODE_BOX;
}

export function nodeHalfWidth(kind: NodeKind): number {
  return nodeBox(kind).w / 2;
}

const ROW_H = 64;
/** Keep node centers ≥ half box width + margin so SVG nodes are not clipped (see FILE_NODE_BOX). */
const PAD_X = 28;
const COL_LEFT = PAD_X + FILE_NODE_BOX.w / 2;
const COL_CENTER = 382;
const COL_RIGHT = 666;
const COL_PKG = 472;
const TOP = 88;

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? p : p.slice(i + 1);
}

/**
 * Place center in the middle column; predecessors left, successors right.
 * Optional package node sits below center when `packageName` is set.
 */
export function layoutFocusedGraph(opts: {
  centerPath: string;
  predecessors: string[];
  successors: string[];
  packageName?: string | null;
}): { nodes: LayoutNode[]; width: number; height: number } {
  const { centerPath, predecessors, successors, packageName } = opts;
  const nodes: LayoutNode[] = [];

  const maxCol = Math.max(predecessors.length, successors.length, 1);
  const midY = TOP + (maxCol * ROW_H) / 2;

  predecessors.forEach((p, i) => {
    nodes.push({
      id: p,
      kind: "file",
      x: COL_LEFT,
      y: TOP + i * ROW_H,
      label: basename(p),
    });
  });

  nodes.push({
    id: centerPath,
    kind: "file",
    x: COL_CENTER,
    y: midY,
    label: basename(centerPath),
  });

  successors.forEach((p, i) => {
    nodes.push({
      id: p,
      kind: "file",
      x: COL_RIGHT,
      y: TOP + i * ROW_H,
      label: basename(p),
    });
  });

  if (packageName) {
    nodes.push({
      id: `pkg:${packageName}`,
      kind: "package",
      x: COL_PKG,
      y: midY + ROW_H * 2.2,
      label: packageName,
    });
  }

  const height = Math.max(460, TOP + maxCol * ROW_H + (packageName ? 160 : 72));
  const width = Math.max(760, COL_RIGHT + FILE_NODE_BOX.w / 2 + PAD_X);
  return { nodes, width, height };
}

/** Polyline path for a directed edge from node a to node b (simple elbow). */
export function elbowPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} L ${mx} ${y1} L ${mx} ${y2} L ${x2} ${y2}`;
}

const PKG_COL_FILES = PAD_X + FILE_NODE_BOX.w / 2;
const PKG_COL_PKG = 520;
const PKG_ROW0 = 72;
const PKG_MAX_FILES = 48;

/** Star layout: files in a column, package node to the right. */
export function layoutPackageGraph(
  packageName: string,
  importedBy: string[],
): { nodes: LayoutNode[]; width: number; height: number } {
  const files = importedBy.slice(0, PKG_MAX_FILES);
  const nodes: LayoutNode[] = [];
  files.forEach((p, i) => {
    nodes.push({
      id: p,
      kind: "file",
      x: PKG_COL_FILES,
      y: PKG_ROW0 + i * ROW_H,
      label: basename(p),
    });
  });
  const midY = PKG_ROW0 + (Math.max(files.length, 1) * ROW_H) / 2 - ROW_H / 2;
  nodes.push({
    id: `pkg:${packageName}`,
    kind: "package",
    x: PKG_COL_PKG,
    y: midY,
    label: packageName,
  });
  const height = Math.max(400, PKG_ROW0 + files.length * ROW_H + 56);
  const width = Math.max(680, PKG_COL_PKG + PKG_NODE_BOX.w / 2 + PAD_X);
  return { nodes, width, height };
}

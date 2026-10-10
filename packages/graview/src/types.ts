/**
 * The seed snapshot Graview's CLI reads (`@graview/ship`'s `GraphSnapshot`):
 * records with their fields flat on the node, and directed edges named by the
 * relation declared on the kind they leave. Restated here rather than
 * imported, because this package never depends on `@graview/*`.
 */
export interface SnapshotNode {
  id: string;
  kind: string;
  [field: string]: unknown;
}

export interface SnapshotEdge {
  kind: string;
  from: string;
  to: string;
}

export interface GraphSnapshot {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

/** What one source contributed, before the builder merges and sorts. */
export interface SourceSlice {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

export type Warn = (message: string) => void;

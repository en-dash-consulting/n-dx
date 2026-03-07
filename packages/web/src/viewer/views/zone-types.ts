/**
 * Shared types for the zone diagram view and its extracted hooks.
 */

export interface CallRef {
  funcName: string;
  file: string;
  crossZone: boolean;
}

export interface FuncInfo {
  fn: import("../../schema/v1.js").FunctionNode;
  outgoing: CallRef[];
  incoming: CallRef[];
}

export interface FileInfo {
  path: string;
  functions: FuncInfo[];
  internalCalls: number;
  crossZoneCalls: number;
}

export interface ZoneData {
  id: string;
  name: string;
  color: string;
  description: string;
  cohesion: number;
  coupling: number;
  files: FileInfo[];
  totalFiles: number;
  totalFunctions: number;
  internalCalls: number;
  crossZoneCalls: number;
  /** Nested sub-zones when recursive analysis is available. */
  subZones?: ZoneData[];
  /** Cross-zone edges between sub-zones at this level. */
  subCrossings?: FlowEdge[];
  /** Whether this zone has sub-zone data available for drill-down. */
  hasDrillDown?: boolean;
}

/** Breadcrumb entry for tracking the drill-down navigation path. */
export interface ZoneBreadcrumb {
  /** Zone ID at this level, or null for the root (all zones) level. */
  zoneId: string | null;
  /** Human-readable label for the breadcrumb. */
  label: string;
}

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
  gridCol: number;
  gridRow: number;
}

export interface FlowEdge {
  from: string;
  to: string;
  weight: number;
}

/** Per-file cross-zone connection: which other zones a file connects to. */
export interface FileZoneLink {
  targetZoneId: string;
  weight: number;
}

/** Maps file path → list of cross-zone connections. */
export type FileConnectionMap = Map<string, FileZoneLink[]>;

/** Maps (sourceFile → targetFile → weight) for file-to-file edges. */
export type FileToFileMap = Map<string, Map<string, number>>;

/** Parent zone ID → set of expanded subzone IDs within that zone. */
export type ExpandedSubZones = Map<string, Set<string>>;

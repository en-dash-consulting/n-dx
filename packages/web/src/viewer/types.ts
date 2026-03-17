import type { Manifest, Inventory, Imports, Zones, Components, CallGraph, ViewId } from "./external.js";

// ViewId is canonically defined in the shared layer (framework-agnostic).
// Re-exported here for backward compatibility with viewer consumers.
export type { ViewId };

export interface LoadedData {
  manifest: Manifest | null;
  inventory: Inventory | null;
  imports: Imports | null;
  zones: Zones | null;
  components: Components | null;
  callGraph: CallGraph | null;
}

export type NavigateTo = (view: ViewId, opts?: { file?: string; zone?: string; runId?: string; taskId?: string }) => void;

export interface FileDetail {
  type: "file";
  title: string;
  path: string;
  language?: string;
  size?: string;
  lines?: number;
  role?: string;
  category?: string;
  hash?: string;
  zone?: string;
  incomingImports?: number;
}

export interface ZoneDetail {
  type: "zone";
  title: string;
  id: string;
  zoneId?: string;
  description: string;
  files: number;
  entryPoints: string[];
  cohesion: string;
  coupling: string;
}

export interface GenericDetail {
  type: "generic";
  title: string;
  [key: string]: unknown;
}

export interface PRDDetail {
  type: "prd";
  title: string;
  id: string;
  level: string;
  status: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: string;
  tags?: string[];
  blockedBy?: string[];
  startedAt?: string;
  completedAt?: string;
  children?: Array<{ id: string; title: string; status: string; level: string }>;
}

export type DetailItem = FileDetail | ZoneDetail | GenericDetail | PRDDetail;

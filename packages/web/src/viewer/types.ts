import type { Manifest, Inventory, Imports, Zones, Components } from "../schema/v1.js";

export interface LoadedData {
  manifest: Manifest | null;
  inventory: Inventory | null;
  imports: Imports | null;
  zones: Zones | null;
  components: Components | null;
}

export type ViewId = "overview" | "graph" | "zones" | "files" | "routes" | "architecture" | "problems" | "suggestions" | "rex-dashboard" | "prd" | "rex-analysis" | "token-usage" | "validation" | "hench-runs";

export type NavigateTo = (view: ViewId, opts?: { file?: string; zone?: string }) => void;

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

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

/**
 * Structured pointer to whatever the user was looking at when they asked.
 *
 * Mirrors the `seed` field of `POST /api/sourcevision/ask`. It is a set of
 * facts, not a sentence: a surface that seeds the Ask panel hands over the
 * item's own classification, zone, and files so the answer can name them,
 * rather than flattening them into a pre-written prompt the user would then
 * have to edit to ask anything else.
 *
 * @see ../server/sourcevision-ask-context.ts — the shape this crosses to
 */
export interface AskSeed {
  /** Which surface the question came from, e.g. `"finding"`. */
  kind?: string;
  /** Identifier of the thing on that surface. */
  id?: string;
  /** Verbatim text of the thing being asked about. */
  text?: string;
  /** Zone the thing belongs to. `"global"` when it is project-wide. */
  zone?: string;
  /** Files (or zones) the thing names. */
  files?: string[];
  /** Classification labels — for a finding, its type and severity. */
  labels?: Record<string, string>;
}

export type NavigateTo = (view: ViewId, opts?: { file?: string; zone?: string; runId?: string; taskId?: string; askSeed?: AskSeed }) => void;

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

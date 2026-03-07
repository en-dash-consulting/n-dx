/** Sourcevision Schema v1 — all types for the .sourcevision/ output format */

export const SCHEMA_VERSION = "1.0.0";

// ── Manifest ────────────────────────────────────────────────────────────────

export type ModuleStatus = "pending" | "running" | "complete" | "error";

export interface ModuleInfo {
  status: ModuleStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  /** Number of chunks processed (for large codebases) */
  chunks?: number;
}

export interface Manifest {
  schemaVersion: string;
  toolVersion: string;
  analyzedAt: string;
  gitSha?: string;
  gitBranch?: string;
  targetPath: string;
  modules: Record<string, ModuleInfo>;
  /** Aggregate token usage from the most recent analyze run. */
  tokenUsage?: AnalyzeTokenUsage;
  /** Whether per-zone output files were emitted to zones/ directory. */
  zoneOutputs?: boolean;
  /** Incorporated sub-analyses (nested .sourcevision/ directories). */
  children?: SubAnalysisRef[];
}

/** Reference to an incorporated sub-analysis. */
export interface SubAnalysisRef {
  /** Unique identifier for this sub-analysis (derived from directory path). */
  id: string;
  /** Path prefix for all files in this sub-analysis (relative to root). */
  prefix: string;
  /** Path to the sub-analysis manifest.json (relative to root). */
  manifestPath: string;
}

// ── Zone Output ──────────────────────────────────────────────────────────────

/** Per-zone summary metadata written to zones/{id}/summary.json */
export interface ZoneSummary {
  id: string;
  name: string;
  description: string;
  files: string[];
  entryPoints: string[];
  cohesion: number;
  coupling: number;
  fileCount: number;
  lineCount: number;
}

// ── Inventory ───────────────────────────────────────────────────────────────

export type FileRole =
  | "source"
  | "test"
  | "config"
  | "docs"
  | "generated"
  | "asset"
  | "build"
  | "other";

export interface FileEntry {
  path: string;
  size: number;
  language: string;
  lineCount: number;
  hash: string;
  role: FileRole;
  /** Free-form semantic label: "authentication", "routing", etc. */
  category: string;
  /** File mtime in epoch ms — used for incremental analysis caching */
  lastModified?: number;
}

export interface InventorySummary {
  totalFiles: number;
  totalLines: number;
  byLanguage: Record<string, number>;
  byRole: Partial<Record<FileRole, number>>;
  byCategory: Record<string, number>;
}

export interface Inventory {
  files: FileEntry[];
  summary: InventorySummary;
}

// ── Imports ─────────────────────────────────────────────────────────────────

export type ImportType = "static" | "dynamic" | "require" | "reexport" | "type";

export interface ImportEdge {
  from: string;
  to: string;
  type: ImportType;
  symbols: string[];
}

export interface ExternalImport {
  package: string;
  importedBy: string[];
  symbols: string[];
}

export interface CircularDependency {
  cycle: string[];
}

export interface ImportsSummary {
  totalEdges: number;
  totalExternal: number;
  circularCount: number;
  circulars: CircularDependency[];
  mostImported: Array<{ path: string; count: number }>;
  avgImportsPerFile: number;
}

export interface Imports {
  edges: ImportEdge[];
  external: ExternalImport[];
  summary: ImportsSummary;
}

// ── Findings ─────────────────────────────────────────────────────────────────

export type FindingType = "observation" | "pattern" | "relationship" | "anti-pattern" | "suggestion";

export interface Finding {
  type: FindingType;
  /** Which pass produced this finding */
  pass: number;
  /** "global" or a zone ID */
  scope: string;
  text: string;
  severity?: "info" | "warning" | "critical";
  /** Related zone IDs or file paths */
  related?: string[];
}

// ── Zones ───────────────────────────────────────────────────────────────────

export interface Zone {
  id: string;
  name: string;
  description: string;
  files: string[];
  entryPoints: string[];
  /** 0–1 score: how tightly related the files within this zone are */
  cohesion: number;
  /** 0–1 score: how much this zone depends on other zones */
  coupling: number;
  /** Actionable insights about this zone (structural + AI-generated) */
  insights?: string[];
  /** Hash of this zone's file list for incremental enrichment */
  structureHash?: string;
  /** Token usage from per-zone enrichment */
  tokenUsage?: ZoneTokenUsage;
  /** ID of the sub-analysis this zone came from (if promoted from a child). */
  childId?: string;
  /** Nesting depth: 0 = root analysis, 1+ = from sub-analysis. */
  depth?: number;
  /** Sub-zones from recursive subdivision of large zones. */
  subZones?: Zone[];
  /** Cross-zone import edges within this zone's sub-zones. */
  subCrossings?: ZoneCrossing[];
}

/** Token usage tracked per zone during per-zone enrichment */
export interface ZoneTokenUsage {
  calls: number;
  input: number;
  output: number;
}

export interface ZoneCrossing {
  from: string;
  to: string;
  /** Zone ID of the source file */
  fromZone: string;
  /** Zone ID of the target file */
  toZone: string;
}

export interface Zones {
  zones: Zone[];
  crossings: ZoneCrossing[];
  unzoned: string[];
  /** Cross-zone architectural insights (structural + AI-generated) */
  insights?: string[];
  /** Structured findings from analysis passes */
  findings?: Finding[];
  /** Number of AI enrichment passes completed */
  enrichmentPass?: number;
  /** Number of meta-evaluation passes completed (pass 5+) */
  metaEvaluationCount?: number;
  /** Hash of structural zone groupings for change detection */
  structureHash?: string;
  /** Per-zone content hashes for detecting code changes within stable zones */
  zoneContentHashes?: Record<string, string>;
  /** Records the last pass reset: { from: previousPass, to: currentPass } */
  lastReset?: { from: number; to: number };
}

// ── Token Usage ─────────────────────────────────────────────────────────────

/** Token usage from a single Claude API call. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
}

/** Aggregated token usage across one or more LLM calls. */
export interface AnalyzeTokenUsage {
  /** Number of LLM calls made. */
  calls: number;
  /** Total input tokens across all calls. */
  inputTokens: number;
  /** Total output tokens across all calls. */
  outputTokens: number;
  /** LLM vendor used for this run ("claude" | "codex" | "unknown"). */
  vendor?: string;
  /** Resolved model used for this run (including fallback defaults). */
  model?: string;
  /** Total cache creation input tokens (if any). */
  cacheCreationInputTokens?: number;
  /** Total cache read input tokens (if any). */
  cacheReadInputTokens?: number;
}

// ── Components ──────────────────────────────────────────────────────────────

export type ComponentKind = "function" | "arrow" | "class" | "forwardRef";

export interface ComponentDefinition {
  file: string;
  name: string;
  kind: ComponentKind;
  line: number;
  isDefaultExport: boolean;
  conventionExports: string[];
}

export interface ComponentUsageEdge {
  from: string;
  to: string;
  componentName: string;
  usageCount: number;
}

export type RouteExportKind =
  | "loader"
  | "action"
  | "default"
  | "meta"
  | "links"
  | "headers"
  | "ErrorBoundary"
  | "shouldRevalidate"
  | "handle"
  | "HydrateFallback";

export interface RouteModule {
  file: string;
  routePattern: string | null;
  exports: RouteExportKind[];
  parentLayout: string | null;
  isLayout: boolean;
  isIndex: boolean;
}

export interface RouteTreeNode {
  file: string;
  routePattern: string;
  children: RouteTreeNode[];
}

export interface ComponentsSummary {
  totalComponents: number;
  totalRouteModules: number;
  totalUsageEdges: number;
  routeConventions: Partial<Record<RouteExportKind, number>>;
  mostUsedComponents: Array<{ name: string; file: string; usageCount: number }>;
  layoutDepth: number;
}

export interface Components {
  components: ComponentDefinition[];
  usageEdges: ComponentUsageEdge[];
  routeModules: RouteModule[];
  routeTree: RouteTreeNode[];
  summary: ComponentsSummary;
}

// ── Call Graph ──────────────────────────────────────────────────────────────

export type CallType = "direct" | "method" | "property-chain" | "computed";

/** A function or method definition that can be a caller or callee. */
export interface FunctionNode {
  /** File path (relative to project root) */
  file: string;
  /** Function or method name */
  name: string;
  /** Line number of the definition */
  line: number;
  /** Column number of the definition */
  column: number;
  /** Fully qualified name including class/object context */
  qualifiedName: string;
  /** Whether this function is exported from its module */
  isExported: boolean;
}

/** A call edge from one function to another. */
export interface CallEdge {
  /** File containing the caller */
  callerFile: string;
  /** Qualified name of the calling function */
  caller: string;
  /** File containing the callee (null if external/unresolved) */
  calleeFile: string | null;
  /** Qualified name of the called function */
  callee: string;
  /** How the call was made */
  type: CallType;
  /** Line number of the call site */
  line: number;
  /** Column number of the call site */
  column: number;
}

export interface CallGraphSummary {
  totalFunctions: number;
  totalCalls: number;
  filesWithCalls: number;
  mostCalled: Array<{ qualifiedName: string; file: string; callerCount: number }>;
  mostCalling: Array<{ qualifiedName: string; file: string; calleeCount: number }>;
  cycleCount: number;
}

export interface CallGraph {
  functions: FunctionNode[];
  edges: CallEdge[];
  summary: CallGraphSummary;
}

// ── Next Steps ──────────────────────────────────────────────────────────────

export interface NextStep {
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  category: "refactor" | "fix" | "extract" | "test" | "docs";
  relatedFindings: number[];
  scope: string;
}

// ── Union type for all output modules ───────────────────────────────────────

export interface SourcevisionOutput {
  manifest: Manifest;
  inventory: Inventory;
  imports: Imports;
  zones: Zones;
  components?: Components;
  callGraph?: CallGraph;
}

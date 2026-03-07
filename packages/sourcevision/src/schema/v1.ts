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
  /** True when this analysis is a workspace aggregation (not a single repo). */
  workspace?: boolean;
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
  /** Computed architectural risk metrics (present when risk scoring is enabled). */
  riskMetrics?: ZoneRiskMetrics;
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
  /** Computed architectural risk metrics (deterministic, from cohesion/coupling). */
  riskMetrics?: ZoneRiskMetrics;
}

// ── Risk Metrics ────────────────────────────────────────────────────────────

/** Risk classification level for architectural governance. */
export type RiskLevel = "healthy" | "at-risk" | "critical" | "catastrophic";

/**
 * Architectural risk metrics computed from zone cohesion and coupling.
 *
 * Governance threshold: cohesion < 0.4 AND coupling > 0.6 triggers
 * mandatory refactoring. Catastrophic: cohesion < 0.3 AND coupling > 0.7.
 */
export interface ZoneRiskMetrics {
  /** Zone cohesion (0–1, higher = more cohesive). */
  cohesion: number;
  /** Zone coupling (0–1, higher = more coupled). */
  coupling: number;
  /** Normalized risk score (0–1, 0 = healthy, 1 = worst). */
  riskScore: number;
  /** Risk classification: healthy | at-risk | critical | catastrophic. */
  riskLevel: RiskLevel;
  /** Whether the zone fails the governance threshold (cohesion < 0.4 AND coupling > 0.6). */
  failsThreshold: boolean;
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

// ── Server-side API routes ──────────────────────────────────────────────────

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

export interface ServerRoute {
  /** File that defines this route handler */
  file: string;
  /** HTTP method */
  method: HttpMethod;
  /** Full route path (e.g., "/api/rex/prd") */
  path: string;
  /** Handler function name, if identifiable */
  handler?: string;
}

export interface ServerRouteGroup {
  /** File that defines these routes */
  file: string;
  /** Common path prefix (e.g., "/api/rex/") */
  prefix: string;
  /** Handler function name */
  handler?: string;
  /** Individual routes in this group */
  routes: ServerRoute[];
}

export interface ComponentsSummary {
  totalComponents: number;
  totalRouteModules: number;
  totalUsageEdges: number;
  totalServerRoutes: number;
  routeConventions: Partial<Record<RouteExportKind, number>>;
  mostUsedComponents: Array<{ name: string; file: string; usageCount: number }>;
  layoutDepth: number;
}

export interface Components {
  components: ComponentDefinition[];
  usageEdges: ComponentUsageEdge[];
  routeModules: RouteModule[];
  routeTree: RouteTreeNode[];
  serverRoutes: ServerRouteGroup[];
  summary: ComponentsSummary;
}

// ── Call Graph ──────────────────────────────────────────────────────────────

export type CallType = "direct" | "method" | "property-chain" | "computed";

/** A function or method definition that can be a caller or callee. */
export interface FunctionNode {
  /** File path (relative to project root) */
  file: string;
  /** Function or method name. Anonymous functions use "<anonymous>". */
  name: string;
  /** Line number of the definition */
  line: number;
  /** Column number of the definition */
  column: number;
  /** Fully qualified name including class/object context: "MyClass.method", "utils.helper" */
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
  /** Total number of function/method definitions found */
  totalFunctions: number;
  /** Total number of call edges */
  totalCalls: number;
  /** Number of files with call relationships */
  filesWithCalls: number;
  /** Functions with the most callers (most depended-on) */
  mostCalled: Array<{ qualifiedName: string; file: string; callerCount: number }>;
  /** Functions with the most callees (most complex/orchestrating) */
  mostCalling: Array<{ qualifiedName: string; file: string; calleeCount: number }>;
  /** Number of call cycles detected */
  cycleCount: number;
}

export interface CallGraph {
  /** All function/method definitions discovered */
  functions: FunctionNode[];
  /** All call edges between functions */
  edges: CallEdge[];
  /** Summary statistics */
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

// ── Classifications ─────────────────────────────────────────────────────────

export interface ArchetypeSignal {
  kind: "path" | "import" | "export" | "filename" | "directory";
  pattern: string;
  weight: number;
}

export interface ArchetypeDefinition {
  id: string;
  name: string;
  description: string;
  signals: ArchetypeSignal[];
  analysisHints?: Record<string, string>;
}

export interface ClassificationEvidence {
  archetypeId: string;
  signalKind: ArchetypeSignal["kind"];
  detail: string;
  weight: number;
}

export interface FileClassification {
  path: string;
  archetype: string | null;
  secondaryArchetypes?: string[];
  confidence: number;
  source: "algorithmic" | "llm" | "user-override";
  evidence?: ClassificationEvidence[];
}

export interface ClassificationsSummary {
  totalClassified: number;
  totalUnclassified: number;
  byArchetype: Record<string, number>;
  bySource: Record<string, number>;
}

export interface Classifications {
  archetypes: ArchetypeDefinition[];
  files: FileClassification[];
  summary: ClassificationsSummary;
}

// ── Branch Work Records ─────────────────────────────────────────────────────

/** Significance of changes introduced by a completed work item. */
export type ChangeSignificance = "patch" | "minor" | "major";

/** Reference to an ancestor in the PRD hierarchy (within a branch work record). */
export interface BranchWorkParentRef {
  id: string;
  title: string;
  level: string;
}

/**
 * A completed work item persisted in a branch work record.
 *
 * Extends the collector's BranchWorkItem with optional classification
 * metadata (change significance, breaking change flag).
 */
export interface BranchWorkRecordItem {
  /** Unique PRD item ID. */
  id: string;
  /** Human-readable title. */
  title: string;
  /** PRD hierarchy level: "epic" | "feature" | "task" | "subtask". */
  level: string;
  /** ISO timestamp when the item was marked completed. */
  completedAt: string;
  /** Ancestor chain from root to parent (excludes the item itself). */
  parentChain: BranchWorkParentRef[];
  /** PRD priority (e.g. "high", "medium", "low"). */
  priority?: string;
  /** Free-form tags from the PRD item. */
  tags?: string[];
  /** PRD item description. */
  description?: string;
  /** PRD acceptance criteria. */
  acceptanceCriteria?: string[];
  /** Significance of the change this item represents. */
  changeSignificance?: ChangeSignificance;
  /** Whether this item introduces a breaking change. */
  breakingChange?: boolean;
}

/** Per-epic summary of completed items in a branch work record. */
export interface BranchWorkEpicSummary {
  id: string;
  title: string;
  completedCount: number;
}

/** Optional record-level metadata. */
export interface BranchWorkRecordMetadata {
  /** Total number of completed items across the branch. */
  totalCompletedCount?: number;
  /** Git SHA at the time the record was created/updated. */
  gitSha?: string;
  /** Arbitrary extension fields. */
  [key: string]: unknown;
}

/**
 * Persistent branch work record — the system of record for completed
 * PRD items on a specific branch.
 *
 * Stored at `.sourcevision/branch-work-{sanitized-branch}.json`.
 */
export interface BranchWorkRecord {
  /** Schema version for forward compatibility. */
  schemaVersion: string;
  /** Branch this record tracks. */
  branch: string;
  /** Base branch used to compute the diff. */
  baseBranch: string;
  /** ISO timestamp when the record was first created. */
  createdAt: string;
  /** ISO timestamp of the most recent update. */
  updatedAt: string;
  /** Completed work items attributed to this branch. */
  items: BranchWorkRecordItem[];
  /** Per-epic aggregation of completed items. */
  epicSummaries: BranchWorkEpicSummary[];
  /** Optional record-level metadata. */
  metadata?: BranchWorkRecordMetadata;
}

// ── Workspace ────────────────────────────────────────────────────────────────

/** Workspace member configuration (stored in .n-dx.json). */
export interface WorkspaceMember {
  /** Path to the member directory, relative to workspace root. */
  path: string;
  /** Display name and zone prefix. Defaults to directory basename. */
  name?: string;
}

/** Workspace configuration block in .n-dx.json. */
export interface WorkspaceConfig {
  members: WorkspaceMember[];
}

// ── Union type for all output modules ───────────────────────────────────────

export interface SourcevisionOutput {
  manifest: Manifest;
  inventory: Inventory;
  imports: Imports;
  classifications?: Classifications;
  zones: Zones;
  components?: Components;
  callGraph?: CallGraph;
}

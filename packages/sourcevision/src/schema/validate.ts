import { z } from "zod";
import type * as V1 from "./v1.js";

/**
 * `V1.FactFile`: every fact file's top-level version. Optional, so analyses
 * written before the field existed still validate.
 */
const FactFileVersion = { schemaVersion: z.string().optional() };

// ── Manifest ────────────────────────────────────────────────────────────────

const ModuleStatusSchema = z.enum(["pending", "running", "complete", "error"]);

const ModuleInfoSchema = z.object({
  status: ModuleStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  chunks: z.number().int().positive().optional(),
});

const LLMClassUsageSchema = z.object({
  cacheCreationInputTokens: z.number().int().nonnegative().optional(),
  cacheReadInputTokens: z.number().int().nonnegative().optional(),
  unmeasuredCalls: z.number().int().nonnegative().optional(),
  measuredCalls: z.number().int().nonnegative().optional(),
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative(),
  vendor: z.string(),
  model: z.string(),
});

const PartitionHealthSchema = z.object({
  zones: z.number().int().nonnegative(),
  smallZones: z.number().int().nonnegative(),
  smallShare: z.number().min(0).max(1),
  numericIds: z.number().int().nonnegative(),
  largestShare: z.number().min(0).max(1),
  verdict: z.enum(["healthy", "borderline", "fragmented"]),
  reasons: z.array(z.string()).optional(),
});

const PartitionReviewSchema = z.object({
  fingerprint: z.string(),
  health: PartitionHealthSchema,
  initial: z.boolean().optional(),
  rejected: z.boolean(),
  mapProbability: z.number().min(0).max(1).optional(),
  after: PartitionHealthSchema.optional(),
});

const AnalysisOutcomeSchema = z.object({
  files: z.number().int().nonnegative(),
  importEdges: z.number().int().nonnegative(),
  zoneIds: z.array(z.string()),
  findings: z.record(z.string(), z.array(z.string())),
});

const AnalysisRunSchema = z.object({
  at: z.string(),
  mode: z.enum(["fast", "generative", "narrate", "cascade", "narration"]),
  durationMs: z.number().nonnegative(),
  phases: z.record(z.string(), z.number().nonnegative()),
  llm: z.object({
    byTaskClass: z.record(z.string(), LLMClassUsageSchema),
    judgmentCache: z.object({ hits: z.number().int().nonnegative(), misses: z.number().int().nonnegative() }).optional(),
    costUsd: z.number().nonnegative().optional(),
  }),
  partition: PartitionReviewSchema.extend({ reused: z.boolean() }).optional(),
  outcome: AnalysisOutcomeSchema.optional(),
  jev: z.object({
    available: z.boolean().nullable(),
    source: z.enum(["env", "file", "helper"]).nullable(),
  }).optional(),
  rerun: z.object({
    zonesJudged: z.number().int().nonnegative(),
    refreshed: z.number().int().nonnegative(),
    findingsJudged: z.number().int().nonnegative(),
    carried: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    uncertain: z.number().int().nonnegative(),
    uncertainZones: z.array(z.string()).optional(),
  }).optional(),
});

const RepoIdentitySchema = z.object({
  name: z.string().min(1),
  remoteUrl: z.string().nullable(),
  remoteHost: z.string().nullable(),
  remotePath: z.string().nullable(),
  defaultBranch: z.string().nullable(),
});

export const ManifestSchema = z.object({
  schemaVersion: z.string(),
  toolVersion: z.string(),
  analyzedAt: z.string(),
  gitSha: z.string().optional(),
  gitBranch: z.string().optional(),
  analysisFingerprint: z.string().optional(),
  targetPath: z.string(),
  // Optional, so a manifest written before repo identity existed still
  // validates; nullable inside, so "looked and found no remote" is a thing
  // the artifact can say.
  repo: RepoIdentitySchema.optional(),
  // Optional, so a manifest written before the field existed still validates.
  packs: z.array(z.object({ id: z.string().min(1), version: z.string().min(1) })).optional(),
  modules: z.record(z.string(), ModuleInfoSchema),
  lastAnalysis: AnalysisRunSchema.optional(),
  narration: z.object({
    status: z.enum(["pending", "done", "failed"]),
    zones: z.array(z.string()),
    names: z.array(z.string()).optional(),
    startedAt: z.string(),
    finishedAt: z.string().optional(),
    pid: z.number().int().optional(),
    log: z.string().optional(),
    reason: z.string().optional(),
  }).optional(),
});

// ── Inventory ───────────────────────────────────────────────────────────────

const FileRoleSchema = z.enum([
  "source",
  "test",
  "config",
  "docs",
  "generated",
  "asset",
  "build",
  "other",
]);

const FileEntrySchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
  language: z.string(),
  lineCount: z.number().int().nonnegative(),
  hash: z.string(),
  role: FileRoleSchema,
  category: z.string(),
  lastModified: z.number().int().nonnegative().optional(),
  thirdParty: z.string().optional(),
  mirrorOf: z.string().optional(),
});

const InventoryExcludedSummarySchema = z.object({
  files: z.number().int().nonnegative(),
  byReason: z.record(z.string(), z.number().int().nonnegative()),
});

const InventorySummarySchema = z.object({
  totalFiles: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  byLanguage: z.record(z.string(), z.number().int().nonnegative()),
  byRole: z.record(z.string(), z.number().int().nonnegative()),
  byCategory: z.record(z.string(), z.number().int().nonnegative()),
  skippedExtensions: z.record(z.string(), z.number().int().nonnegative()).optional(),
  analysedLanguages: z.array(z.string()).optional(),
  thirdParty: InventoryExcludedSummarySchema.optional(),
  mirrored: InventoryExcludedSummarySchema.optional(),
});

export const InventorySchema = z.object({
  ...FactFileVersion,
  files: z.array(FileEntrySchema),
  summary: InventorySummarySchema,
});

// ── Imports ─────────────────────────────────────────────────────────────────

const ImportTypeSchema = z.enum([
  "static",
  "dynamic",
  "require",
  "reexport",
  "type",
]);

const ImportEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: ImportTypeSchema,
  symbols: z.array(z.string()),
});

const ExternalImportSchema = z.object({
  package: z.string(),
  importedBy: z.array(z.string()),
  symbols: z.array(z.string()),
});

const CircularDependencySchema = z.object({
  cycle: z.array(z.string()),
});

const ParseIssueSampleSchema = z.object({
  count: z.number().int().nonnegative(),
  examples: z.array(z.string()),
});

const PackParseIssuesSchema = z.object({
  files: z.number().int().nonnegative(),
  clean: z.number().int().nonnegative(),
  sizeLimitBytes: z.number().int().nonnegative(),
  syntaxErrors: ParseIssueSampleSchema,
  oversized: ParseIssueSampleSchema,
  unreadable: ParseIssueSampleSchema,
  notUtf8: ParseIssueSampleSchema,
  legacySyntax: ParseIssueSampleSchema.extend({ constructs: z.record(z.string(), z.number().int().nonnegative()) }).optional(),
});

const ImportsSummarySchema = z.object({
  totalEdges: z.number().int().nonnegative(),
  totalExternal: z.number().int().nonnegative(),
  circularCount: z.number().int().nonnegative(),
  circulars: z.array(CircularDependencySchema),
  mostImported: z.array(
    z.object({
      path: z.string(),
      count: z.number().int().nonnegative(),
    })
  ),
  avgImportsPerFile: z.number().nonnegative(),
  parseIssues: z.record(z.string(), PackParseIssuesSchema).optional(),
});

export const ImportsSchema = z.object({
  ...FactFileVersion,
  edges: z.array(ImportEdgeSchema),
  external: z.array(ExternalImportSchema),
  summary: ImportsSummarySchema,
});

// ── Classifications ──────────────────────────────────────────────────────────

const ArchetypeSignalSchema = z.object({
  kind: z.enum(["path", "import", "export", "filename", "directory"]),
  pattern: z.string(),
  weight: z.number().min(0).max(1),
  languages: z.array(z.string()).optional(),
});

const ArchetypeDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  signals: z.array(ArchetypeSignalSchema),
  analysisHints: z.record(z.string(), z.string()).optional(),
});

const ClassificationEvidenceSchema = z.object({
  archetypeId: z.string(),
  signalKind: z.enum(["path", "import", "export", "filename", "directory", "pack"]),
  detail: z.string(),
  weight: z.number().min(0).max(1),
});

const FileClassificationSchema = z.object({
  path: z.string(),
  archetype: z.string().nullable(),
  secondaryArchetypes: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  source: z.enum(["algorithmic", "llm", "user-override"]),
  evidence: z.array(ClassificationEvidenceSchema).optional(),
});

const ClassificationsSummarySchema = z.object({
  totalClassified: z.number().int().nonnegative(),
  totalUnclassified: z.number().int().nonnegative(),
  byArchetype: z.record(z.string(), z.number().int().nonnegative()),
  bySource: z.record(z.string(), z.number().int().nonnegative()),
});

export const ClassificationsSchema = z.object({
  ...FactFileVersion,
  archetypes: z.array(ArchetypeDefinitionSchema),
  files: z.array(FileClassificationSchema),
  summary: ClassificationsSummarySchema,
});

// ── Findings ─────────────────────────────────────────────────────────────────

const FindingTypeSchema = z.enum([
  "observation",
  "pattern",
  "relationship",
  "anti-pattern",
  "suggestion",
  "move-file",
]);

const MoveFileReasonSchema = z.enum([
  "zone-pin-override",
  "zone-judgment",
  "import-neighbor-majority",
  "directory-consolidation",
]);

export const FindingSchema = z.object({
  type: FindingTypeSchema,
  pass: z.number().int().nonnegative(),
  scope: z.string(),
  text: z.string(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  related: z.array(z.string()).optional(),
  // move-file specific fields (optional, present only when type === "move-file")
  from: z.string().optional(),
  to: z.string().optional(),
  moveReason: MoveFileReasonSchema.optional(),
  predictedImpact: z.number().int().nonnegative().optional(),
});

// ── Zones ───────────────────────────────────────────────────────────────────

const ZoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  files: z.array(z.string()),
  entryPoints: z.array(z.string()),
  cohesion: z.number().min(0).max(1),
  coupling: z.number().min(0).max(1),
  insights: z.array(z.string()).optional(),
  previousIds: z.array(z.string()).optional(),
});

const ZoneCrossingSchema = z.object({
  from: z.string(),
  to: z.string(),
  fromZone: z.string(),
  toZone: z.string(),
});

export const ZonesSchema = z.object({
  ...FactFileVersion,
  zones: z.array(ZoneSchema),
  crossings: z.array(ZoneCrossingSchema),
  unzoned: z.array(z.string()),
  insights: z.array(z.string()).optional(),
  findings: z.array(FindingSchema).optional(),
  enrichmentPass: z.number().int().nonnegative().optional(),
  enrichmentMode: z.enum(["cascade", "generative"]).optional(),
  metaEvaluationCount: z.number().int().nonnegative().optional(),
  structureHash: z.string().optional(),
  zoneContentHashes: z.record(z.string(), z.string()).optional(),
  lastReset: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).optional(),
  partitionReview: PartitionReviewSchema.optional(),
  algorithmVersion: z.number().int().positive().optional(),
  areas: z.array(z.object({
    id: z.string(),
    name: z.string(),
    zones: z.array(z.string()),
    files: z.number().int().nonnegative(),
    nameSource: z.enum(["package", "route", "member", "template", "judged", "generated", "support", "tests"]).optional(),
  })).optional(),
});

// ── Components ──────────────────────────────────────────────────────────────

const ComponentKindSchema = z.enum(["function", "arrow", "class", "forwardRef"]);

const ComponentDefinitionSchema = z.object({
  file: z.string(),
  name: z.string(),
  kind: ComponentKindSchema,
  line: z.number().int().positive(),
  isDefaultExport: z.boolean(),
  conventionExports: z.array(z.string()),
});

const ComponentUsageEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  componentName: z.string(),
  usageCount: z.number().int().positive(),
});

const RouteExportKindSchema = z.enum([
  "loader",
  "action",
  "default",
  "meta",
  "links",
  "headers",
  "ErrorBoundary",
  "shouldRevalidate",
  "handle",
  "HydrateFallback",
]);

const RouteModuleSchema = z.object({
  file: z.string(),
  routePattern: z.string().nullable(),
  exports: z.array(RouteExportKindSchema),
  parentLayout: z.string().nullable(),
  isLayout: z.boolean(),
  isIndex: z.boolean(),
});

const RouteTreeNodeSchema: z.ZodType<V1.RouteTreeNode> = z.lazy(() =>
  z.object({
    file: z.string(),
    routePattern: z.string(),
    children: z.array(RouteTreeNodeSchema),
  })
);

const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

const ServerRouteSchema = z.object({
  file: z.string(),
  method: HttpMethodSchema,
  path: z.string(),
  handler: z.string().optional(),
  source: z.string().optional(),
});

const ServerRouteGroupSchema = z.object({
  file: z.string(),
  prefix: z.string(),
  handler: z.string().optional(),
  routes: z.array(ServerRouteSchema),
});

const ComponentsSummarySchema = z.object({
  totalComponents: z.number().int().nonnegative(),
  totalRouteModules: z.number().int().nonnegative(),
  totalUsageEdges: z.number().int().nonnegative(),
  totalServerRoutes: z.number().int().nonnegative(),
  routeConventions: z.record(z.string(), z.number().int().nonnegative()),
  mostUsedComponents: z.array(
    z.object({
      name: z.string(),
      file: z.string(),
      usageCount: z.number().int().positive(),
    })
  ),
  layoutDepth: z.number().int().nonnegative(),
});

export const ComponentsSchema = z.object({
  ...FactFileVersion,
  components: z.array(ComponentDefinitionSchema),
  usageEdges: z.array(ComponentUsageEdgeSchema),
  routeModules: z.array(RouteModuleSchema),
  routeTree: z.array(RouteTreeNodeSchema),
  serverRoutes: z.array(ServerRouteGroupSchema),
  summary: ComponentsSummarySchema,
});

// ── Call Graph ──────────────────────────────────────────────────────────────

const CallTypeSchema = z.enum(["direct", "method", "property-chain", "computed"]);

const FunctionNodeSchema = z.object({
  file: z.string(),
  name: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
  qualifiedName: z.string(),
  isExported: z.boolean(),
});

const CallEdgeSchema = z.object({
  callerFile: z.string(),
  caller: z.string(),
  calleeFile: z.string().nullable(),
  callee: z.string(),
  type: CallTypeSchema,
  line: z.number().int().positive(),
  column: z.number().int().nonnegative(),
});

const CallGraphSummarySchema = z.object({
  totalFunctions: z.number().int().nonnegative(),
  totalCalls: z.number().int().nonnegative(),
  filesWithCalls: z.number().int().nonnegative(),
  mostCalled: z.array(
    z.object({
      qualifiedName: z.string(),
      file: z.string(),
      callerCount: z.number().int().positive(),
    })
  ),
  mostCalling: z.array(
    z.object({
      qualifiedName: z.string(),
      file: z.string(),
      calleeCount: z.number().int().positive(),
    })
  ),
  cycleCount: z.number().int().nonnegative(),
});

export const CallGraphSchema = z.object({
  ...FactFileVersion,
  functions: z.array(FunctionNodeSchema),
  edges: z.array(CallEdgeSchema),
  summary: CallGraphSummarySchema,
});

// ── Branch Work Record ──────────────────────────────────────────────────────

const ChangeSignificanceSchema = z.enum(["patch", "minor", "major"]);

const BranchWorkParentRefSchema = z.object({
  id: z.string(),
  title: z.string(),
  level: z.string(),
});

const BranchWorkRecordItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  level: z.string(),
  completedAt: z.string(),
  parentChain: z.array(BranchWorkParentRefSchema),
  priority: z.string().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  acceptanceCriteria: z.array(z.string()).optional(),
  changeSignificance: ChangeSignificanceSchema.optional(),
  breakingChange: z.boolean().optional(),
});

const BranchWorkEpicSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  completedCount: z.number().int().nonnegative(),
});

const BranchWorkRecordMetadataSchema = z.object({
  totalCompletedCount: z.number().int().nonnegative().optional(),
  gitSha: z.string().optional(),
}).passthrough();

export const BranchWorkRecordSchema = z.object({
  schemaVersion: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(BranchWorkRecordItemSchema),
  epicSummaries: z.array(BranchWorkEpicSummarySchema),
  metadata: BranchWorkRecordMetadataSchema.optional(),
});

/** Runtime twin of `Confidence` in `v1.ts` — one vocabulary, both detectors. */
const ConfidenceSchema = z.enum(["certain", "likely", "inferred"]);

// ── SDLC readiness profile ──────────────────────────────────────────────────

const SdlcEvidenceSchema = z.object({
  kind: z.string().min(1),
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  excerpt: z.string().optional(),
  confidence: ConfidenceSchema,
});

/**
 * Proof for one detection: at least one piece of evidence.
 *
 * The one-element-plus-rest tuple is what makes the "nothing asserted without
 * proof" rule hold at the boundary. The TypeScript tuple in `v1.ts` stops a
 * detection with no evidence from being written in our own code; this stops
 * one from being read out of a file some other writer produced. (zod 4's
 * `array().nonempty()` no longer infers the tuple type, so it would not
 * satisfy `SdlcEvidenceList`.)
 */
const SdlcEvidenceListSchema = z.tuple([SdlcEvidenceSchema], SdlcEvidenceSchema);

const SdlcCommandSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  kind: z.enum(["test", "lint", "typecheck", "build", "deploy", "migrate"]),
  command: z.string().min(1),
  cwd: z.string().optional(),
  runner: z.string().optional(),
});

const SdlcTestFrameworkSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  name: z.string().min(1),
  roots: z.array(z.string()).optional(),
});

const SdlcTestSuiteSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  kind: z.enum(["unit", "integration", "e2e", "contract", "performance", "smoke"]),
  fileCount: z.number().int().nonnegative().optional(),
});

const SdlcCoverageSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  tool: z.string().min(1),
  threshold: z.number().min(0).max(100).optional(),
  enforced: z.boolean(),
});

const SdlcCiStepSchema = z.object({
  name: z.string().optional(),
  run: z.string().optional(),
  uses: z.string().optional(),
  kind: z.enum([
    "checkout", "setup", "install", "build", "test",
    "lint", "typecheck", "migrate", "deploy", "publish", "other",
  ]),
});

const SdlcCiJobSchema = z.object({
  name: z.string().min(1),
  steps: z.array(SdlcCiStepSchema),
  needs: z.array(z.string()).optional(),
  condition: z.string().optional(),
  environment: z.string().optional(),
});

const SdlcCiPipelineSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  provider: z.string().min(1),
  name: z.string(),
  triggers: z.array(z.string()),
  jobs: z.array(SdlcCiJobSchema),
});

const SdlcParseFailureSchema = z.object({
  path: z.string().min(1),
  kind: z.string().min(1),
  reason: z.string().min(1),
});

const SdlcDeploymentSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  environment: z.string().min(1),
  mechanism: z.string().min(1),
  requiresApproval: z.boolean().optional(),
  automated: z.boolean(),
});

const SdlcRollbackSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  mechanism: z.string().min(1),
  environment: z.string().optional(),
  tool: z.string().optional(),
  versioning: z.enum(["semver", "calver"]).optional(),
});

const SdlcMigrationSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  tool: z.string().min(1),
  directory: z.string().optional(),
  reversible: z.boolean().optional(),
  automated: z.boolean().optional(),
});

const SdlcFeatureFlagSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  provider: z.string().min(1),
  flags: z.array(z.string()).optional(),
});

const SdlcQualityGateSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  kind: z.enum([
    "required-review",
    "required-status-check",
    "branch-protection",
    "pre-commit-hook",
    "codeowners",
    "signed-commits",
  ]),
  blocking: z.boolean(),
  appliesTo: z.string().optional(),
});

const SdlcObservabilitySchema = z.object({
  evidence: SdlcEvidenceListSchema,
  kind: z.enum(["logging", "metrics", "tracing", "error-reporting", "health-check", "alerting"]),
  provider: z.string().min(1),
});

const SdlcContainerSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  path: z.string().min(1),
  baseImages: z.array(z.string()),
  multiStage: z.boolean(),
  orchestration: z.enum(["compose", "kubernetes", "helm", "ecs", "nomad"]).optional(),
});

const SdlcIacSchema = z.object({
  evidence: SdlcEvidenceListSchema,
  tool: z.string().min(1),
  root: z.string().optional(),
  remoteState: z.boolean().optional(),
});

const SdlcVersionFloorsSchema = z.object({
  files: z.number().int().nonnegative(),
  floors: z.record(z.string().regex(/^\d+\.\d+$/), z.number().int().positive()),
  none: z.number().int().nonnegative(),
  highest: z.string().regex(/^\d+\.\d+$/).optional(),
});

const LANGUAGE_VERSION = /^\d+\.\d+$/;
const GUIDE_PAGE = z.string().regex(/^https:\/\/\S+$/);

const SdlcLanguageBoundarySchema = z.object({
  version: z.string().regex(LANGUAGE_VERSION),
  source: GUIDE_PAGE,
});

const SdlcLegacyRuleCountSchema = z.object({
  status: z.enum(["removed", "deprecated", "notice"]),
  uses: z.number().int().positive(),
  files: z.number().int().positive(),
  deprecated: SdlcLanguageBoundarySchema.optional(),
  removed: SdlcLanguageBoundarySchema.optional(),
  changed: SdlcLanguageBoundarySchema.optional(),
  source: GUIDE_PAGE,
  likely: z.literal(true).optional(),
});

const SdlcLegacyConstructsSchema = z.object({
  files: z.number().int().nonnegative(),
  uses: z.number().int().nonnegative(),
  notices: z.number().int().nonnegative(),
  rules: z.record(z.string().min(1), SdlcLegacyRuleCountSchema),
  removedIn: z.record(z.string().regex(LANGUAGE_VERSION), z.number().int().positive()),
  deprecatedIn: z.record(z.string().regex(LANGUAGE_VERSION), z.number().int().positive()),
});

const COUNT = z.number().int().nonnegative();

const SdlcDynamicCodeSchema = z.object({
  files: z.number().int().positive(),
  sites: z.number().int().positive(),
  kinds: z.object({ exec: COUNT, dispatch: COUNT, include: COUNT }),
  literal: COUNT,
  constructs: z.record(z.string().min(1), z.number().int().positive()),
  database: z
    .object({
      sites: z.number().int().positive(),
      kinds: z.object({ exec: COUNT, dispatch: COUNT }),
      tables: z.record(z.string().min(1), z.number().int().positive()),
      columns: z.record(z.string().min(1), z.number().int().positive()),
    })
    .optional(),
});

const SdlcLanguageEcosystemSchema = z.object({
  versionFloors: SdlcVersionFloorsSchema.optional(),
  legacyConstructs: SdlcLegacyConstructsSchema.optional(),
  dynamicCode: SdlcDynamicCodeSchema.optional(),
  thirdParty: z
    .object({ legacyConstructs: SdlcLegacyConstructsSchema.optional(), dynamicCode: SdlcDynamicCodeSchema.optional() })
    .optional(),
});

// ── Legacy constructs per file ──────────────────────────────────────────────

const VersionCountsSchema = z.record(z.string().regex(LANGUAGE_VERSION), z.number().int().positive());

const LegacyFileEntrySchema = z.object({
  path: z.string().min(1),
  floor: z
    .object({ version: z.string().regex(LANGUAGE_VERSION), rule: z.string().min(1), line: z.number().int().positive() })
    .optional(),
  uses: COUNT,
  notices: COUNT,
  removedIn: VersionCountsSchema,
  deprecatedIn: VersionCountsSchema,
  constructs: z.array(z.object({
    rule: z.string().min(1),
    construct: z.string().min(1),
    status: z.enum(["removed", "deprecated", "notice"]),
    line: z.number().int().positive(),
    column: COUNT,
    deprecated: z.string().regex(LANGUAGE_VERSION).optional(),
    removed: z.string().regex(LANGUAGE_VERSION).optional(),
    changed: z.string().regex(LANGUAGE_VERSION).optional(),
    likely: z.literal(true).optional(),
  })),
}).refine((f) => f.floor !== undefined || f.constructs.length > 0, { message: "a file needs a floor or a construct use" });

export const LegacySchema = z.object({
  ...FactFileVersion,
  languages: z.record(z.string().min(1), z.object({
    files: z.array(LegacyFileEntrySchema),
    thirdParty: z.array(LegacyFileEntrySchema).min(1).optional(),
  })),
});

// ── Dynamic-code sites per file ─────────────────────────────────────────────

const CodeSiteSchema = z.object({
  code: z.string().min(1),
  kind: z.enum(["exec", "dispatch", "include"]),
  construct: z.string().min(1),
  line: z.number().int().positive(),
  column: COUNT,
  scope: z.string().min(1).optional(),
  literal: z.literal(true).optional(),
  candidates: z
    .object({ files: z.array(z.string().min(1)).min(1), total: z.number().int().positive(), truncated: z.literal(true).optional() })
    .refine((c) => (c.truncated === true) === c.total > c.files.length, { message: "truncated exactly when total exceeds the listed files" })
    .optional(),
  database: z.object({ tables: z.array(z.string().min(1)), columns: z.array(z.string().min(1)) }).optional(),
});

const SiteFileEntrySchema = z.object({ path: z.string().min(1), sites: z.array(CodeSiteSchema).min(1) });

export const SitesSchema = z.object({
  ...FactFileVersion,
  languages: z.record(z.string().min(1), z.object({
    files: z.array(SiteFileEntrySchema),
    thirdParty: z.array(SiteFileEntrySchema).min(1).optional(),
  })),
});

// ── Declarations per file ───────────────────────────────────────────────────

const DeclarationFileEntrySchema = z.object({
  path: z.string().min(1),
  namespaces: z.array(z.string().min(1)),
  types: z.array(z.object({
    kind: z.string().min(1),
    name: z.string().min(1),
    qualifiedName: z.string().min(1),
    line: z.number().int().positive(),
  })),
}).refine((f) => f.namespaces.length > 0 || f.types.length > 0, { message: "a file with no namespace and no type is not listed" });

export const DeclarationsSchema = z.object({
  ...FactFileVersion,
  languages: z.record(z.string().min(1), z.object({
    files: z.array(DeclarationFileEntrySchema),
    thirdParty: z.array(DeclarationFileEntrySchema).min(1).optional(),
  })),
});

export const SdlcProfileSchema = z.object({
  schemaVersion: z.string(),
  projectDir: z.string().optional(),
  commands: z.array(SdlcCommandSchema),
  tests: z.object({
    frameworks: z.array(SdlcTestFrameworkSchema),
    suites: z.array(SdlcTestSuiteSchema),
    coverage: SdlcCoverageSchema.optional(),
  }),
  ci: z.array(SdlcCiPipelineSchema),
  cd: z.array(SdlcDeploymentSchema),
  rollback: z.array(SdlcRollbackSchema),
  migrations: z.array(SdlcMigrationSchema),
  featureFlags: z.array(SdlcFeatureFlagSchema),
  qualityGates: z.array(SdlcQualityGateSchema),
  observability: z.array(SdlcObservabilitySchema),
  containers: z.array(SdlcContainerSchema),
  iac: z.array(SdlcIacSchema),
  parseFailures: z.array(SdlcParseFailureSchema),
  ecosystem: z.record(z.string().min(1), SdlcLanguageEcosystemSchema).optional(),
});

// ── Outbound dependencies ───────────────────────────────────────────────────

const OutboundDependencySchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  kind: z.enum(["http", "grpc", "queue", "database", "cache", "env"]),
  // Not `min(1)`: an unresolvable target is recorded as the empty string
  // alongside `targetSource: "unknown"`, which is a real detection — a call we
  // can see but cannot address.
  target: z.string(),
  targetSource: z.enum(["literal", "env", "config", "unknown"]),
  client: z.string().min(1),
  confidence: ConfidenceSchema,
  thirdParty: z.string().optional(),
});

const DeclaredContractSchema = z.object({
  file: z.string().min(1),
  kind: z.enum(["openapi", "proto"]),
});

export const OutboundSchema = z.object({
  ...FactFileVersion,
  dependencies: z.array(OutboundDependencySchema),
  contracts: z.array(DeclaredContractSchema),
});

// ── Config reads and flag checks ────────────────────────────────────────────

const ConfigSourceSchema = z.enum(["file", "env", "ini", "yaml", "xml", "json", "define", "unknown"]);
const FlagMechanismSchema = z.enum(["constant", "config", "function", "sdk", "env"]);
const LineSchema = z.number().int().positive();
const ColumnSchema = z.number().int().nonnegative();

const ConfigReadSchema = z.object({
  key: z.string().min(1),
  source: ConfigSourceSchema,
  sourceFile: z.string().min(1).optional(),
  line: LineSchema,
  column: ColumnSchema,
});

const FlagCheckSchema = z.object({
  name: z.string().min(1),
  normalized: z.string().min(1),
  mechanism: FlagMechanismSchema,
  client: z.string().min(1).optional(),
  line: LineSchema,
  column: ColumnSchema,
  gated: z.object({ start: LineSchema, end: LineSchema })
    .refine((g) => g.end >= g.start, { message: "gated.end must not precede gated.start" })
    .optional(),
});

export const ConfigSchema = z.object({
  ...FactFileVersion,
  files: z.array(z.object({
    file: z.string().min(1),
    configReads: z.array(ConfigReadSchema),
    flagChecks: z.array(FlagCheckSchema),
  })),
  flags: z.array(z.object({
    normalized: z.string().min(1),
    names: z.array(z.string().min(1)).min(1),
    mechanisms: z.array(FlagMechanismSchema).min(1),
    files: z.array(z.string().min(1)).min(1),
    checks: z.number().int().positive(),
    gatedLines: z.number().int().nonnegative(),
  })),
  keys: z.array(z.object({
    key: z.string().min(1),
    sources: z.array(ConfigSourceSchema).min(1),
    sourceFiles: z.array(z.string().min(1)),
    files: z.array(z.string().min(1)).min(1),
  })),
});

// ── Validation helpers ──────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: z.ZodError };

export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}

/** Validate any module output by name */
export function validateModule(
  name: string,
  data: unknown
): ValidationResult<unknown> {
  switch (name) {
    case "manifest":
      return validate(ManifestSchema, data);
    case "inventory":
      return validate(InventorySchema, data);
    case "imports":
      return validate(ImportsSchema, data);
    case "classifications":
      return validate(ClassificationsSchema, data);
    case "zones":
      return validate(ZonesSchema, data);
    case "components":
      return validate(ComponentsSchema, data);
    case "callGraph":
      return validate(CallGraphSchema, data);
    case "sdlcProfile":
      return validate(SdlcProfileSchema, data);
    case "outbound":
      return validate(OutboundSchema, data);
    case "config":
      return validate(ConfigSchema, data);
    case "legacy":
      return validate(LegacySchema, data);
    case "sites":
      return validate(SitesSchema, data);
    case "declarations":
      return validate(DeclarationsSchema, data);
    default:
      return {
        ok: false,
        errors: new z.ZodError([
          {
            code: "custom",
            path: [],
            message: `Unknown module: ${name}`,
          },
        ]),
      };
  }
}

/**
 * Format Zod validation errors into clear, actionable messages.
 *
 * Each error includes the field path and what was expected, making it
 * easy to pinpoint and fix the issue.
 */
export function formatValidationErrors(errors: z.ZodError): string[] {
  return errors.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  });
}

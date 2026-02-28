import { z } from "zod";
import type * as V1 from "./v1.js";

// ── Manifest ────────────────────────────────────────────────────────────────

const ModuleStatusSchema = z.enum(["pending", "running", "complete", "error"]);

const ModuleInfoSchema = z.object({
  status: ModuleStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  chunks: z.number().int().positive().optional(),
});

export const ManifestSchema = z.object({
  schemaVersion: z.string(),
  toolVersion: z.string(),
  analyzedAt: z.string(),
  gitSha: z.string().optional(),
  gitBranch: z.string().optional(),
  targetPath: z.string(),
  modules: z.record(z.string(), ModuleInfoSchema),
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
});

const InventorySummarySchema = z.object({
  totalFiles: z.number().int().nonnegative(),
  totalLines: z.number().int().nonnegative(),
  byLanguage: z.record(z.string(), z.number().int().nonnegative()),
  byRole: z.record(z.string(), z.number().int().nonnegative()),
  byCategory: z.record(z.string(), z.number().int().nonnegative()),
});

export const InventorySchema = z.object({
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
});

export const ImportsSchema = z.object({
  edges: z.array(ImportEdgeSchema),
  external: z.array(ExternalImportSchema),
  summary: ImportsSummarySchema,
});

// ── Classifications ──────────────────────────────────────────────────────────

const ArchetypeSignalSchema = z.object({
  kind: z.enum(["path", "import", "export", "filename", "directory"]),
  pattern: z.string(),
  weight: z.number().min(0).max(1),
});

const ArchetypeDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  signals: z.array(ArchetypeSignalSchema),
  analysisHints: z.record(z.string()).optional(),
});

const ClassificationEvidenceSchema = z.object({
  archetypeId: z.string(),
  signalKind: z.enum(["path", "import", "export", "filename", "directory"]),
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
]);

export const FindingSchema = z.object({
  type: FindingTypeSchema,
  pass: z.number().int().nonnegative(),
  scope: z.string(),
  text: z.string(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  related: z.array(z.string()).optional(),
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
});

const ZoneCrossingSchema = z.object({
  from: z.string(),
  to: z.string(),
  fromZone: z.string(),
  toZone: z.string(),
});

export const ZonesSchema = z.object({
  zones: z.array(ZoneSchema),
  crossings: z.array(ZoneCrossingSchema),
  unzoned: z.array(z.string()),
  insights: z.array(z.string()).optional(),
  findings: z.array(FindingSchema).optional(),
  enrichmentPass: z.number().int().nonnegative().optional(),
  metaEvaluationCount: z.number().int().nonnegative().optional(),
  structureHash: z.string().optional(),
  zoneContentHashes: z.record(z.string()).optional(),
  lastReset: z.object({ from: z.number().int().positive(), to: z.number().int().positive() }).optional(),
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

// ── Validation helpers ──────────────────────────────────────────────────────

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: z.ZodError };

function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, errors: result.error };
}

export function validateManifest(data: unknown): ValidationResult<V1.Manifest> {
  return validate(ManifestSchema, data);
}

export function validateInventory(
  data: unknown
): ValidationResult<V1.Inventory> {
  return validate(InventorySchema, data);
}

export function validateImports(data: unknown): ValidationResult<V1.Imports> {
  return validate(ImportsSchema, data);
}

export function validateClassifications(
  data: unknown
): ValidationResult<V1.Classifications> {
  return validate(ClassificationsSchema, data);
}

export function validateZones(data: unknown): ValidationResult<V1.Zones> {
  return validate(ZonesSchema, data);
}

export function validateComponents(
  data: unknown
): ValidationResult<V1.Components> {
  return validate(ComponentsSchema, data);
}

export function validateCallGraph(
  data: unknown
): ValidationResult<V1.CallGraph> {
  return validate(CallGraphSchema, data);
}

export function validateBranchWorkRecord(
  data: unknown
): ValidationResult<V1.BranchWorkRecord> {
  return validate(BranchWorkRecordSchema, data);
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

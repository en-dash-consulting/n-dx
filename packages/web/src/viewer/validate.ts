/**
 * Client-side data validation for the sourcevision viewer.
 *
 * Zod schemas that validate JSON fetched from the server or dropped
 * as files. Lives in the viewer layer because the viewer is the sole
 * consumer — the server layer does its own domain-specific validation
 * independently.
 */

import { z } from "zod";
import type * as V1 from "../schema/v1.js";

// ── Manifest ────────────────────────────────────────────────────────────────

const ModuleStatusSchema = z.enum(["pending", "running", "complete", "error"]);

const ModuleInfoSchema = z.object({
  status: ModuleStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
  chunks: z.number().int().positive().optional(),
});

const ManifestSchema = z.object({
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

const InventorySchema = z.object({
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

const ImportsSchema = z.object({
  edges: z.array(ImportEdgeSchema),
  external: z.array(ExternalImportSchema),
  summary: ImportsSummarySchema,
});

// ── Findings ─────────────────────────────────────────────────────────────────

const FindingTypeSchema = z.enum([
  "observation",
  "pattern",
  "relationship",
  "anti-pattern",
  "suggestion",
]);

const FindingSchema = z.object({
  type: FindingTypeSchema,
  pass: z.number().int().nonnegative(),
  scope: z.string(),
  text: z.string(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  related: z.array(z.string()).optional(),
});

// ── Zones ───────────────────────────────────────────────────────────────────

const ZoneCrossingSchema = z.object({
  from: z.string(),
  to: z.string(),
  fromZone: z.string(),
  toZone: z.string(),
});

const ZoneSchema: z.ZodType<V1.Zone> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  files: z.array(z.string()),
  entryPoints: z.array(z.string()),
  cohesion: z.number().min(0).max(1),
  coupling: z.number().min(0).max(1),
  insights: z.array(z.string()).optional(),
  depth: z.number().int().nonnegative().optional(),
  subZones: z.lazy(() => z.array(ZoneSchema)).optional(),
  subCrossings: z.array(ZoneCrossingSchema).optional(),
});

const ZonesSchema = z.object({
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

const ComponentsSummarySchema = z.object({
  totalComponents: z.number().int().nonnegative(),
  totalRouteModules: z.number().int().nonnegative(),
  totalUsageEdges: z.number().int().nonnegative(),
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

const ComponentsSchema = z.object({
  components: z.array(ComponentDefinitionSchema),
  usageEdges: z.array(ComponentUsageEdgeSchema),
  routeModules: z.array(RouteModuleSchema),
  routeTree: z.array(RouteTreeNodeSchema),
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

const CallGraphSchema = z.object({
  functions: z.array(FunctionNodeSchema),
  edges: z.array(CallEdgeSchema),
  summary: CallGraphSummarySchema,
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

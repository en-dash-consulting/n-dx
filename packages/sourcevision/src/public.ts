/**
 * Public API for the sourcevision package.
 *
 * ## API philosophy: MCP factory + types
 *
 * Sourcevision is primarily a **CLI tool** and **MCP server**. Other packages
 * interact with its analysis output through:
 *
 * 1. **MCP server** — the web package creates an MCP server instance
 * 2. **Filesystem reads** — the web dashboard and rex's analyze command
 *    read `.sourcevision/*.json` files directly from disk
 *
 * This public API exports the MCP factory for (1) and schema types for (2),
 * letting consumers validate JSON file shapes at compile time without
 * creating unnecessary runtime coupling to the analysis engine.
 *
 * Each package's public surface reflects its actual consumption pattern —
 * see PACKAGE_GUIDELINES.md for the full decision tree and comparison table.
 *
 * ## Configuration
 *
 * Sourcevision has no persistent config file — only an ephemeral manifest
 * generated per-analysis run. This matches the pattern across all three
 * packages: config/manifest factories are internal implementation details,
 * not part of the public API.
 *
 * ## Architectural isolation
 *
 * Sourcevision depends only on `@n-dx/llm-client` (the shared
 * foundation) and has **no dependency on rex or hench**:
 *
 * ```
 *   hench → rex → claude-client ← sourcevision
 * ```
 *
 * @module sourcevision/public
 */

// ---- MCP server factory -----------------------------------------------------

export { createSourcevisionMcpServer } from "./cli/mcp.js";

// ---- Dashboard-facing analysis functions -------------------------------------
//
// Consumed by the web dashboard through its sourcevision gateway
// (`packages/web/src/server/domain-gateway.ts`): next-step derivation for the
// Overview panel and archetype override persistence for the Files tab.

export { deriveNextSteps } from "./analyzers/next-steps.js";
export { setArchetypeOverride } from "./util/archetype-overrides.js";
// NextStep type is already exported in the schema-types block below.

// ---- Isometric architecture map -----------------------------------------------
//
// Opt-in renderer behind `sourcevision iso`, and the API the web dashboard's
// /api/iso-map route builds on. Lets a host produce the same map from analysis
// data it already holds, without shelling out to the CLI.

export { buildIsoModel, ISO_KINDS } from "./export/iso-model.js";
export { renderIsoMap } from "./export/iso-map.js";
export { loadIsoInput, loadFromSourcevision, loadFromScan, hasSourcevision } from "./export/iso-sources.js";
export type { IsoSourceMode, LoadOptions as IsoLoadOptions } from "./export/iso-sources.js";
export type {
  IsoModel,
  IsoModelInput,
  IsoModelOptions,
  IsoNode,
  IsoEdge,
  IsoKind,
} from "./export/iso-model.js";

// ---- Schema constants -------------------------------------------------------

export { SCHEMA_VERSION as SV_SCHEMA_VERSION } from "./schema/v1.js";
export { DATA_FILES, ALL_DATA_FILES, SUPPLEMENTARY_FILES } from "./schema/data-files.js";

// ---- Schema types (JSON output files) ---------------------------------------
//
// These define the shape of `.sourcevision/*.json` files. The web dashboard
// reads these files from disk; exporting types here lets consumers validate
// shapes at compile time without importing the analysis engine at runtime.

export type {
  // manifest.json
  Manifest,
  ModuleInfo,
  ModuleStatus,
  SubAnalysisRef,
  AnalyzeTokenUsage,
  // inventory.json
  Inventory,
  FileEntry,
  FileRole,
  InventorySummary,
  // imports.json
  Imports,
  ImportEdge,
  ImportType,
  ExternalImport,
  CircularDependency,
  ImportsSummary,
  // classifications.json
  Classifications,
  FileClassification,
  ClassificationEvidence,
  ClassificationsSummary,
  ArchetypeDefinition,
  ArchetypeSignal,
  // zones.json
  Zones,
  Zone,
  ZoneSummary,
  ZoneRiskMetrics,
  RiskLevel,
  ZoneCrossing,
  ZoneTokenUsage,
  Finding,
  FindingType,
  FindingCategory,
  ZoneStability,
  // components.json
  Components,
  ComponentDefinition,
  ComponentKind,
  ComponentUsageEdge,
  RouteModule,
  RouteExportKind,
  RouteTreeNode,
  ComponentsSummary,
  // callgraph.json
  CallGraph,
  CallEdge,
  CallType,
  FunctionNode,
  CallGraphSummary,
  // workspace
  WorkspaceMember,
  WorkspaceConfig,
  // aggregate
  SourcevisionOutput,
  TokenUsage,
  NextStep,
} from "./schema/v1.js";

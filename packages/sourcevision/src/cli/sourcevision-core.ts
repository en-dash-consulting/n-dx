/**
 * CLI-local facade over Sourcevision internals.
 *
 * Keeping CLI commands pointed at this module consolidates their dependency on
 * the analysis engine, schema, and shared utilities behind a single boundary.
 */

export { SV_DIR, TOOL_VERSION } from "../constants.js";
export { DATA_FILES, SUPPLEMENTARY_FILES } from "../schema/data-files.js";
export {
  validateManifest,
  validateInventory,
  validateImports,
  validateZones,
  validateComponents,
} from "../schema/index.js";
export type {
  AnalyzeTokenUsage,
  BranchWorkEpicSummary,
  BranchWorkRecord,
  BranchWorkRecordItem,
  CallGraph,
  Classifications,
  Components,
  ImportEdge,
  Imports,
  Inventory,
  Manifest,
  RiskJustificationEntry,
  WorkspaceConfig,
  WorkspaceMember,
  Zones,
} from "../schema/index.js";
export { SCHEMA_VERSION } from "../schema/v1.js";
export { toCanonicalJSON } from "../util/sort.js";
export { toPosix } from "../util/paths.js";
export { detectLanguages, mergeLanguageConfigs } from "../language/index.js";
export { analyzeInventory } from "../analyzers/inventory.js";
export type { InventoryResult } from "../analyzers/inventory.js";
export { analyzeImports } from "../analyzers/imports.js";
export { analyzeClassifications, enrichClassificationsWithLLM, mergeClassificationResults } from "../analyzers/classify.js";
export { analyzeZones } from "../analyzers/zones.js";
export { analyzeComponents } from "../analyzers/components.js";
export { analyzeCallGraph, computeZoneCallStats } from "../analyzers/callgraph.js";
export { generateCallGraphFindings } from "../analyzers/callgraph-findings.js";
export { deduplicateFindings, enforceSeverityRules } from "../analyzers/enrich-parsing.js";
export { readManifest, writeManifest, updateManifestModule, updateManifestError } from "../analyzers/manifest.js";
export { detectSubAnalyses, buildSubAnalysisRefs } from "../analyzers/workspace.js";
export {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  resolveMembers,
  writeWorkspaceOutput,
  getWorkspaceStatus,
} from "../analyzers/workspace-aggregate.js";
export { createSnapshot, computeDeltas, loadLatestReport, saveReport, formatDeltaReport } from "../analyzers/convergence.js";
export type { ConvergenceReport } from "../analyzers/convergence.js";
export { generateLlmsTxt } from "../analyzers/llms-txt.js";
export { generateContext } from "../analyzers/context.js";
export { emitZoneOutputs } from "../analyzers/zone-output.js";
export { assessAllZoneRisks } from "../analyzers/risk-scoring.js";
export type { ZoneType } from "../analyzers/risk-scoring.js";
export { emptyAnalyzeTokenUsage, formatTokenUsage } from "../analyzers/token-usage.js";
export {
  setLLMConfig,
  getAuthMode,
  getLLMVendor,
  DEFAULT_MODEL,
  DEFAULT_CODEX_MODEL,
} from "../analyzers/claude-client.js";
export { collectBranchWork } from "../analyzers/branch-work-collector.js";
export type { BranchWorkResult } from "../analyzers/branch-work-collector.js";
export { classifyItems } from "../analyzers/branch-work-classifier.js";
export { deriveNextSteps } from "../analyzers/next-steps.js";
export { renderPRMarkdownFromRecord } from "../generators/pr-markdown-template.js";

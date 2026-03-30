export { analyzeInventory, detectLanguage, classifyRole, deriveCategory, isBinary, loadIgnoreFilter, IgnoreFilter } from "./inventory.js";
export type { InventoryOptions, InventoryResult, InventoryStats } from "./inventory.js";
export { analyzeImports, extractImports, extractPackageName } from "./imports.js";
export { extractGoImports, readGoModulePath } from "./go-imports.js";
export type { GoRawImport, GoImportResult } from "./go-imports.js";
export {
  readManifest,
  writeManifest,
  updateManifestModule,
  updateManifestError,
} from "./manifest.js";
export { analyzeZones, runZonePipeline } from "./zones.js";
export type { AnalyzeZonesResult, ZonePipelineOptions, ZonePipelineResult } from "./zones.js";
export { emptyAnalyzeTokenUsage, accumulateTokenUsage, formatTokenUsage } from "./token-usage.js";
export {
  analyzeComponents,
  extractComponentDefinitions,
  extractJsxUsages,
  extractConventionExports,
} from "./components.js";
export {
  parseFileRoutePattern,
  buildRouteTree,
  findRoutesConfig,
  parseRoutesConfig,
  findRoutesDir,
} from "./route-detection.js";
export { analyzeCallGraph, extractFunctions, extractCalls, computeZoneCallStats } from "./callgraph.js";
export type { ZoneCallStats, CrossZoneCallPattern } from "./callgraph.js";
export { generateCallGraphFindings } from "./callgraph-findings.js";
export type { CallGraphFindingsOptions } from "./callgraph-findings.js";

export { analyzeInventory, detectLanguage, classifyRole, deriveCategory, isBinary, loadIgnoreFilter, IgnoreFilter } from "./inventory.js";
export { analyzeImports, extractImports, extractPackageName } from "./imports.js";
export {
  readManifest,
  writeManifest,
  updateManifestModule,
  updateManifestError,
} from "./manifest.js";
export { analyzeZones } from "./zones.js";
export type { AnalyzeZonesResult } from "./zones.js";
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

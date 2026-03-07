/**
 * Workspace aggregation engine — merges pre-analyzed repos into a unified
 * .sourcevision/ output.
 *
 * Input: List of SubAnalysis objects (from config or auto-detection).
 * Output: Aggregated zones.json, inventory.json, imports.json, updated manifest.
 *
 * The key design decision: workspace output is indistinguishable from
 * single-repo output. Consumers (rex, MCP, web dashboard) don't need
 * workspace-specific code paths.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { SV_DIR, TOOL_VERSION } from "../constants.js";
import { SCHEMA_VERSION } from "../schema/v1.js";
import { DATA_FILES, SUPPLEMENTARY_FILES } from "../schema/data-files.js";
import { toPosix } from "../util/paths.js";
import {
  sortInventory,
  sortImports,
  sortZonesData,
  toCanonicalJSON,
} from "../util/sort.js";
import {
  promoteZones,
  promoteCrossings,
  buildSubAnalysisRefs,
  detectSubAnalyses,
} from "./workspace.js";
import type { SubAnalysis } from "./workspace.js";
import {
  buildPackageMap,
  computeCrossRepoCrossings,
} from "./workspace-crossings.js";
import { generateLlmsTxt } from "./llms-txt.js";
import { generateContext } from "./context.js";
import type {
  WorkspaceConfig,
  WorkspaceMember,
  Manifest,
  Inventory,
  FileEntry,
  InventorySummary,
  Imports,
  ImportEdge,
  ExternalImport,
  ImportsSummary,
  Zones,
  Zone,
  ZoneCrossing,
} from "../schema/index.js";

// ── Config loading ──────────────────────────────────────────────────────────

const PROJECT_CONFIG_FILE = ".n-dx.json";

/**
 * Load workspace configuration from .n-dx.json.
 * Returns the workspace config or null if not configured.
 */
export function loadWorkspaceConfig(rootDir: string): WorkspaceConfig | null {
  const configPath = join(rootDir, PROJECT_CONFIG_FILE);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }

  const svConfig = data.sourcevision as Record<string, unknown> | undefined;
  if (!svConfig) return null;

  const workspace = svConfig.workspace as WorkspaceConfig | undefined;
  if (!workspace?.members || !Array.isArray(workspace.members)) return null;

  return workspace;
}

/**
 * Save workspace configuration to .n-dx.json.
 * Preserves existing config keys, only updates sourcevision.workspace.
 */
export function saveWorkspaceConfig(
  rootDir: string,
  config: WorkspaceConfig,
): void {
  const configPath = join(rootDir, PROJECT_CONFIG_FILE);

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }

  const svConfig = (data.sourcevision ?? {}) as Record<string, unknown>;
  svConfig.workspace = config;
  data.sourcevision = svConfig;

  writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n");
}

// ── Member resolution ───────────────────────────────────────────────────────

/**
 * Convert a workspace member config into an ID (kebab-case from path).
 */
function memberToId(member: WorkspaceMember): string {
  return (member.name ?? basename(member.path))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve workspace members from config into SubAnalysis objects.
 * Validates that each member has a .sourcevision/ with a manifest.
 *
 * @returns Array of loaded SubAnalysis objects.
 * @throws Error if a member is missing its .sourcevision/ analysis.
 */
export function resolveWorkspaceMembers(
  rootDir: string,
  config: WorkspaceConfig,
): SubAnalysis[] {
  const absRoot = resolve(rootDir);
  const results: SubAnalysis[] = [];

  for (const member of config.members) {
    const memberDir = resolve(absRoot, member.path);
    const svDir = join(memberDir, SV_DIR);
    const manifestPath = join(svDir, DATA_FILES.manifest);

    if (!existsSync(manifestPath)) {
      throw new Error(
        `Member "${member.path}" has not been analyzed. ` +
        `Run 'sourcevision analyze ${member.path}' first.`,
      );
    }

    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      throw new Error(
        `Member "${member.path}" has an invalid manifest. ` +
        `Run 'sourcevision analyze ${member.path}' to regenerate.`,
      );
    }

    const prefix = toPosix(relative(absRoot, memberDir));
    const id = memberToId(member);

    const sub: SubAnalysis = {
      id,
      prefix,
      svDir,
      manifest,
    };

    // Load zones
    const zonesPath = join(svDir, DATA_FILES.zones);
    if (existsSync(zonesPath)) {
      try {
        sub.zones = JSON.parse(readFileSync(zonesPath, "utf-8"));
      } catch { /* zones unavailable */ }
    }

    // Load inventory
    const inventoryPath = join(svDir, DATA_FILES.inventory);
    if (existsSync(inventoryPath)) {
      try {
        sub.inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
      } catch { /* inventory unavailable */ }
    }

    // Load imports
    const importsPath = join(svDir, DATA_FILES.imports);
    if (existsSync(importsPath)) {
      try {
        sub.imports = JSON.parse(readFileSync(importsPath, "utf-8"));
      } catch { /* imports unavailable */ }
    }

    results.push(sub);
  }

  return results.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

// ── Aggregation ─────────────────────────────────────────────────────────────

/**
 * Merge inventories from all members with path prefixing.
 */
export function aggregateInventory(members: SubAnalysis[]): Inventory {
  const allFiles: FileEntry[] = [];

  for (const member of members) {
    if (!member.inventory?.files) continue;

    for (const file of member.inventory.files) {
      allFiles.push({
        ...file,
        path: toPosix(join(member.prefix, file.path)),
      });
    }
  }

  const summary = computeInventorySummary(allFiles);
  return sortInventory({ files: allFiles, summary });
}

function computeInventorySummary(files: FileEntry[]): InventorySummary {
  const byLanguage: Record<string, number> = {};
  const byRole: Partial<Record<string, number>> = {};
  const byCategory: Record<string, number> = {};
  let totalLines = 0;

  for (const f of files) {
    byLanguage[f.language] = (byLanguage[f.language] ?? 0) + 1;
    byRole[f.role] = ((byRole[f.role] as number) ?? 0) + 1;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    totalLines += f.lineCount;
  }

  return { totalFiles: files.length, totalLines, byLanguage, byRole, byCategory };
}

/**
 * Merge import graphs from all members with path prefixing.
 * Internal edges get prefixed paths. External imports are preserved.
 */
export function aggregateImports(members: SubAnalysis[]): Imports {
  const allEdges: ImportEdge[] = [];
  const externalMap = new Map<string, { importedBy: Set<string>; symbols: Set<string> }>();

  for (const member of members) {
    if (!member.imports) continue;

    // Prefix internal edges
    for (const edge of member.imports.edges) {
      allEdges.push({
        ...edge,
        from: toPosix(join(member.prefix, edge.from)),
        to: toPosix(join(member.prefix, edge.to)),
      });
    }

    // Merge external imports (same package across members gets merged)
    for (const ext of member.imports.external) {
      let entry = externalMap.get(ext.package);
      if (!entry) {
        entry = { importedBy: new Set(), symbols: new Set() };
        externalMap.set(ext.package, entry);
      }
      for (const f of ext.importedBy) entry.importedBy.add(toPosix(join(member.prefix, f)));
      for (const s of ext.symbols) entry.symbols.add(s);
    }
  }

  const external: ExternalImport[] = [];
  for (const [pkg, entry] of externalMap) {
    external.push({
      package: pkg,
      importedBy: [...entry.importedBy].sort(),
      symbols: [...entry.symbols].sort(),
    });
  }

  const summary = computeImportsSummary(allEdges, external);
  return sortImports({ edges: allEdges, external, summary });
}

function computeImportsSummary(
  edges: ImportEdge[],
  external: ExternalImport[],
): ImportsSummary {
  // Count how many times each file is imported
  const importCounts = new Map<string, number>();
  for (const e of edges) {
    importCounts.set(e.to, (importCounts.get(e.to) ?? 0) + 1);
  }

  const mostImported = [...importCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  const filesWithImports = new Set(edges.map((e) => e.from));

  return {
    totalEdges: edges.length,
    totalExternal: external.length,
    circularCount: 0,
    circulars: [],
    mostImported,
    avgImportsPerFile: filesWithImports.size > 0
      ? Math.round((edges.length / filesWithImports.size) * 100) / 100
      : 0,
  };
}

/**
 * Aggregate zones from all members.
 * Promotes all member zones via promoteZones(), merges intra-member crossings
 * via promoteCrossings(), and computes cross-repo crossings.
 */
export function aggregateZones(members: SubAnalysis[]): Zones {
  const allZones: Zone[] = [];
  const allCrossings: ZoneCrossing[] = [];
  const allUnzoned: string[] = [];

  for (const member of members) {
    // Promote zones with prefixed IDs and paths
    const promoted = promoteZones(member);
    allZones.push(...promoted);

    // Promote intra-member crossings
    const crossings = promoteCrossings(member);
    allCrossings.push(...crossings);

    // Prefix unzoned files
    if (member.zones?.unzoned) {
      for (const f of member.zones.unzoned) {
        allUnzoned.push(toPosix(join(member.prefix, f)));
      }
    }
  }

  // Compute cross-repo crossings
  const packageMap = buildPackageMap(members);
  const crossRepoCrossings = computeCrossRepoCrossings(members, allZones, packageMap);
  allCrossings.push(...crossRepoCrossings);

  return sortZonesData({
    zones: allZones,
    crossings: allCrossings,
    unzoned: allUnzoned,
  });
}

// ── Output writing ──────────────────────────────────────────────────────────

/**
 * Orchestrate the full workspace aggregation pipeline and write output.
 *
 * @param rootDir - The workspace root directory.
 * @param members - Loaded SubAnalysis objects for all members.
 * @returns Summary of what was aggregated.
 */
export function writeWorkspaceOutput(
  rootDir: string,
  members: SubAnalysis[],
): { zoneCount: number; fileCount: number; crossingCount: number } {
  const absRoot = resolve(rootDir);
  const svDir = join(absRoot, SV_DIR);
  mkdirSync(svDir, { recursive: true });

  // Aggregate data
  const inventory = aggregateInventory(members);
  const imports = aggregateImports(members);
  const zones = aggregateZones(members);

  // Write data files
  writeFileSync(join(svDir, DATA_FILES.inventory), toCanonicalJSON(inventory));
  writeFileSync(join(svDir, DATA_FILES.imports), toCanonicalJSON(imports));
  writeFileSync(join(svDir, DATA_FILES.zones), toCanonicalJSON(zones));

  // Build and write manifest
  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    analyzedAt: new Date().toISOString(),
    targetPath: absRoot,
    modules: {
      inventory: { status: "complete", completedAt: new Date().toISOString() },
      imports: { status: "complete", completedAt: new Date().toISOString() },
      zones: { status: "complete", completedAt: new Date().toISOString() },
    },
    children: buildSubAnalysisRefs(members),
    workspace: true,
  };
  writeFileSync(join(svDir, DATA_FILES.manifest), JSON.stringify(manifest, null, 2) + "\n");

  // Generate supplementary output (llms.txt + CONTEXT.md)
  try {
    const llmsTxt = generateLlmsTxt(manifest, inventory, imports, zones, null, null);
    writeFileSync(join(svDir, SUPPLEMENTARY_FILES[0]), llmsTxt);

    const contextMd = generateContext(manifest, inventory, imports, zones, null, null);
    writeFileSync(join(svDir, SUPPLEMENTARY_FILES[1]), contextMd);
  } catch {
    // Non-critical — don't fail aggregation
  }

  return {
    zoneCount: zones.zones.length,
    fileCount: inventory.files.length,
    crossingCount: zones.crossings.length,
  };
}

/**
 * Get the status of workspace members.
 * For each member, reports whether it has been analyzed and when.
 */
export function getWorkspaceStatus(
  rootDir: string,
  config: WorkspaceConfig,
): Array<{
  name: string;
  path: string;
  analyzed: boolean;
  analyzedAt?: string;
  zoneCount?: number;
  fileCount?: number;
}> {
  const absRoot = resolve(rootDir);
  const results: Array<{
    name: string;
    path: string;
    analyzed: boolean;
    analyzedAt?: string;
    zoneCount?: number;
    fileCount?: number;
  }> = [];

  for (const member of config.members) {
    const memberDir = resolve(absRoot, member.path);
    const manifestPath = join(memberDir, SV_DIR, DATA_FILES.manifest);
    const name = member.name ?? basename(member.path);

    if (!existsSync(manifestPath)) {
      results.push({ name, path: member.path, analyzed: false });
      continue;
    }

    try {
      const manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      const zonesPath = join(memberDir, SV_DIR, DATA_FILES.zones);
      let zoneCount: number | undefined;
      let fileCount: number | undefined;

      if (existsSync(zonesPath)) {
        try {
          const zones = JSON.parse(readFileSync(zonesPath, "utf-8"));
          zoneCount = zones.zones?.length;
        } catch { /* zones unavailable */ }
      }

      const invPath = join(memberDir, SV_DIR, DATA_FILES.inventory);
      if (existsSync(invPath)) {
        try {
          const inv = JSON.parse(readFileSync(invPath, "utf-8"));
          fileCount = inv.files?.length;
        } catch { /* inventory unavailable */ }
      }

      results.push({
        name,
        path: member.path,
        analyzed: true,
        analyzedAt: manifest.analyzedAt,
        zoneCount,
        fileCount,
      });
    } catch {
      results.push({ name, path: member.path, analyzed: false });
    }
  }

  return results;
}

/**
 * Resolve members for workspace aggregation.
 *
 * Priority: explicit config > auto-detection.
 * Returns null if no members can be resolved (no config and no sub-analyses).
 */
export function resolveMembers(
  rootDir: string,
): { members: SubAnalysis[]; source: "config" | "auto-detect" } | null {
  // Try explicit config first
  const config = loadWorkspaceConfig(rootDir);
  if (config && config.members.length > 0) {
    const members = resolveWorkspaceMembers(rootDir, config);
    return { members, source: "config" };
  }

  // Fall back to auto-detection
  const detected = detectSubAnalyses(rootDir);
  if (detected.length > 0) {
    return { members: detected, source: "auto-detect" };
  }

  return null;
}

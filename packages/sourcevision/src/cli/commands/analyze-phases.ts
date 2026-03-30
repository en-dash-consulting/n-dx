/**
 * Individual analysis phases extracted from cmdAnalyze.
 *
 * Each phase function follows a common pattern:
 * 1. Check prerequisites (required data files exist)
 * 2. Load previous data for incremental analysis
 * 3. Run the analyzer
 * 4. Write results
 * 5. Report progress
 *
 * Returns false if prerequisites are missing, true on success, throws on error.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DATA_FILES } from "../../schema/data-files.js";
import { toCanonicalJSON } from "../../util/sort.js";
import { analyzeInventory } from "../../analyzers/inventory.js";
import type { InventoryResult } from "../../analyzers/inventory.js";
import { detectLanguages, mergeLanguageConfigs } from "../../language/index.js";
import { analyzeImports } from "../../analyzers/imports.js";
import { analyzeClassifications, enrichClassificationsWithLLM, mergeClassificationResults } from "../../analyzers/classify.js";
import { analyzeZones } from "../../analyzers/zones.js";
import { analyzeComponents } from "../../analyzers/components.js";
import { analyzeCallGraph, computeZoneCallStats } from "../../analyzers/callgraph.js";
import { generateCallGraphFindings } from "../../analyzers/callgraph-findings.js";
import { deduplicateFindings, enforceSeverityRules } from "../../analyzers/enrich-parsing.js";
import type { CallGraph, Classifications, ImportEdge, Inventory } from "../../schema/index.js";
import { readManifest, writeManifest, updateManifestModule, updateManifestError } from "../../analyzers/manifest.js";
import { detectSubAnalyses, buildSubAnalysisRefs } from "../../analyzers/workspace.js";
import { info } from "../output.js";
import { createSnapshot, computeDeltas, loadLatestReport, saveReport, formatDeltaReport } from "../../analyzers/convergence.js";
import type { ConvergenceReport } from "../../analyzers/convergence.js";
import type { AnalyzeTokenUsage } from "../../schema/index.js";
import { loadProjectOverrides } from "@n-dx/llm-client";

// ── Shared context passed between phases ─────────────────────────────

export interface AnalyzeContext {
  absDir: string;
  svDir: string;
  fullMode: boolean;
  fastMode: boolean;
  tokenUsage: AnalyzeTokenUsage;
  /** Result from phase 1 (inventory), used by later phases for incremental hints. */
  inventoryResult: InventoryResult | null;
}

/** Safely load a JSON file, returning undefined if missing or corrupted. */
function loadPreviousData(filePath: string): any {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return undefined; // Corrupted — start fresh
  }
}

/** Merge one AnalyzeTokenUsage aggregate into another. */
function accumulateFromAggregate(target: AnalyzeTokenUsage, source: AnalyzeTokenUsage): void {
  target.calls += source.calls;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  if (source.cacheCreationInputTokens) {
    target.cacheCreationInputTokens =
      (target.cacheCreationInputTokens ?? 0) + source.cacheCreationInputTokens;
  }
  if (source.cacheReadInputTokens) {
    target.cacheReadInputTokens =
      (target.cacheReadInputTokens ?? 0) + source.cacheReadInputTokens;
  }
}

// ── Phase 1: Inventory ───────────────────────────────────────────────

export async function runInventoryPhase(ctx: AnalyzeContext): Promise<void> {
  info("[phase 1] Inventory...");
  updateManifestModule(ctx.absDir, "inventory", "running");

  try {
    const previousInventory = loadPreviousData(join(ctx.svDir, DATA_FILES.inventory));

    // Detect all languages and merge into a unified config for skip dirs, etc.
    const langConfigs = await detectLanguages(ctx.absDir);
    const mergedConfig = mergeLanguageConfigs(langConfigs);

    ctx.inventoryResult = await analyzeInventory(
      ctx.absDir,
      {
        ...((!ctx.fullMode && previousInventory) ? { previousInventory } : {}),
        languageConfig: mergedConfig,
      },
    );

    // Serialize only { files, summary } (strip stats/changedFiles)
    const outPath = join(ctx.svDir, DATA_FILES.inventory);
    writeFileSync(outPath, toCanonicalJSON({
      files: ctx.inventoryResult.files,
      summary: ctx.inventoryResult.summary,
    }));
    updateManifestModule(ctx.absDir, "inventory", "complete");

    // Record resolved language(s) in manifest for downstream consumers
    const manifest = readManifest(ctx.absDir);
    manifest.language = mergedConfig.id;
    manifest.languages = langConfigs.map((c) => c.id);
    writeManifest(ctx.absDir, manifest);

    const stats = ctx.inventoryResult.stats;
    if (stats) {
      const parts = [`${stats.cached} cached`, `${stats.changed} changed`, `${stats.added} new`, `${stats.deleted} deleted`];
      if (stats.touched > 0) parts.push(`${stats.touched} touched`);
      info(`  ${ctx.inventoryResult.files.length} files (${parts.join(", ")}) → ${outPath}`);
    } else {
      info(`  ${ctx.inventoryResult.files.length} files cataloged → ${outPath}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateManifestError(ctx.absDir, "inventory", msg);
    throw new PhaseError(1, "inventory", msg);
  }
}

// ── Phase 2: Imports ─────────────────────────────────────────────────

export async function runImportsPhase(ctx: AnalyzeContext): Promise<void> {
  const inventoryPath = join(ctx.svDir, DATA_FILES.inventory);
  if (!existsSync(inventoryPath)) {
    throw new PhasePrerequsiteError(2, "imports", "inventory.json — run phase 1 first");
  }

  info("[phase 2] Imports...");
  updateManifestModule(ctx.absDir, "imports", "running");

  try {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
    const previousImports = loadPreviousData(join(ctx.svDir, DATA_FILES.imports));

    const stats = ctx.inventoryResult?.stats;
    const fileSetChanged = stats ? (stats.added > 0 || stats.deleted > 0) : true;

    const imports = await analyzeImports(ctx.absDir, inventory, !ctx.fullMode && previousImports ? {
      previousImports,
      changedFiles: ctx.inventoryResult?.changedFiles,
      fileSetChanged,
    } : undefined);
    const outPath = join(ctx.svDir, DATA_FILES.imports);
    writeFileSync(outPath, toCanonicalJSON(imports));
    updateManifestModule(ctx.absDir, "imports", "complete");
    info(`  ${imports.summary.totalEdges} edges, ${imports.summary.totalExternal} external → ${outPath}`);
  } catch (err) {
    if (err instanceof PhasePrerequsiteError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    updateManifestError(ctx.absDir, "imports", msg);
    throw new PhaseError(2, "imports", msg);
  }
}

// ── Phase 3: Classifications ─────────────────────────────────────────

export async function runClassificationsPhase(ctx: AnalyzeContext): Promise<void> {
  const inventoryPath = join(ctx.svDir, DATA_FILES.inventory);
  const importsPath = join(ctx.svDir, DATA_FILES.imports);
  if (!existsSync(inventoryPath) || !existsSync(importsPath)) {
    throw new PhasePrerequsiteError(3, "classifications", "inventory.json and imports.json — run phases 1-2 first");
  }

  info("[phase 3] Classifications...");
  updateManifestModule(ctx.absDir, "classifications", "running");

  try {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
    const importsData = JSON.parse(readFileSync(importsPath, "utf-8"));
    const previousClassifications: Classifications | undefined = loadPreviousData(join(ctx.svDir, DATA_FILES.classifications));

    // Load archetype overrides from .n-dx.json
    const svOverrides = await loadProjectOverrides(ctx.svDir, "sourcevision");
    const archetypeConfig = (svOverrides as Record<string, unknown>).archetypes as Record<string, unknown> | undefined;
    const customArchetypes = (archetypeConfig?.custom ?? []) as import("../../schema/index.js").ArchetypeDefinition[];
    const fileOverrides = (archetypeConfig?.overrides ?? {}) as Record<string, string>;

    // Read project language(s) from manifest (written in Phase 1)
    const manifest = readManifest(ctx.absDir);
    const projectLanguage = manifest.language;
    const projectLanguages = manifest.languages;

    let classifications = analyzeClassifications(inventory, importsData, {
      previousClassifications: !ctx.fullMode ? previousClassifications : undefined,
      changedFiles: ctx.inventoryResult?.changedFiles,
      customArchetypes: customArchetypes.length > 0 ? customArchetypes : undefined,
      overrides: Object.keys(fileOverrides).length > 0 ? fileOverrides : undefined,
      projectLanguage,
      projectLanguages,
    });

    // LLM enrichment (skip in --fast mode)
    if (!ctx.fastMode && classifications.summary.totalUnclassified > 0) {
      info(`  ${classifications.summary.totalClassified} classified, ${classifications.summary.totalUnclassified} unclassified — enriching with LLM...`);
      const llmResult = await enrichClassificationsWithLLM(classifications, inventory, importsData);
      if (llmResult.updatedFiles.length > 0) {
        classifications = mergeClassificationResults(classifications, llmResult.updatedFiles);
        info(`  LLM classified ${llmResult.updatedFiles.length} additional files`);
      }
      accumulateFromAggregate(ctx.tokenUsage, llmResult.tokenUsage);
    }

    const outPath = join(ctx.svDir, DATA_FILES.classifications);
    writeFileSync(outPath, toCanonicalJSON(classifications));
    updateManifestModule(ctx.absDir, "classifications", "complete");
    info(`  ${classifications.summary.totalClassified} classified, ${classifications.summary.totalUnclassified} unclassified → ${outPath}`);
  } catch (err) {
    if (err instanceof PhasePrerequsiteError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    updateManifestError(ctx.absDir, "classifications", msg);
    throw new PhaseError(3, "classifications", msg);
  }
}

// ── Hints loading ────────────────────────────────────────────────────

/**
 * Load project hints from `.sourcevision/hints.md`.
 * Strips HTML comments and blank lines. Returns undefined if file is missing or empty after stripping.
 */
export function loadHints(svDir: string): string | undefined {
  const hintsPath = join(svDir, "hints.md");
  if (!existsSync(hintsPath)) return undefined;
  try {
    const raw = readFileSync(hintsPath, "utf-8");
    // Strip HTML comments (single-line and multi-line)
    const stripped = raw.replace(/<!--[\s\S]*?-->/g, "");
    const trimmed = stripped
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .join("\n")
      .trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

// ── Phase 4: Zones ───────────────────────────────────────────────────

export async function runZonesPhase(ctx: AnalyzeContext, extraArgs: string[]): Promise<void> {
  const inventoryPath = join(ctx.svDir, DATA_FILES.inventory);
  const importsPath = join(ctx.svDir, DATA_FILES.imports);
  if (!existsSync(inventoryPath) || !existsSync(importsPath)) {
    throw new PhasePrerequsiteError(4, "zones", "inventory.json and imports.json — run phases 1-2 first");
  }

  info("[phase 4] Zones...");
  updateManifestModule(ctx.absDir, "zones", "running");

  const enrich = !ctx.fastMode;
  const perZone = extraArgs.includes("--per-zone");
  const previousZones = loadPreviousData(join(ctx.svDir, DATA_FILES.zones));

  if (enrich) {
    const modeLabel = perZone ? " (per-zone mode)" : "";
    info(`  Enriching zones${modeLabel}...`);
  } else {
    info("  Structural analysis only (skipping AI enrichment)");
  }

  try {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
    const importsData = JSON.parse(readFileSync(importsPath, "utf-8"));

    // Detect pre-analyzed subdirectories
    const subAnalyses = detectSubAnalyses(ctx.absDir);
    if (subAnalyses.length > 0) {
      info(`  Found ${subAnalyses.length} sub-analysis: ${subAnalyses.map((s) => s.prefix).join(", ")}`);
    }

    // Load classifications for archetype labels in enrichment prompts
    const fileArchetypes = loadFileArchetypes(ctx.svDir);

    // Load project hints for enrichment context
    const hints = loadHints(ctx.svDir);

    const onReset = (fromPass: number, toPass: number) => {
      info(`  Detected changes, resetting from Pass ${fromPass} to Pass ${toPass}`);
    };

    // Load zone pins from .n-dx.json
    const svZoneOverrides = await loadProjectOverrides(ctx.svDir, "sourcevision");
    const zonesConfig = (svZoneOverrides as Record<string, unknown>).zones as Record<string, unknown> | undefined;
    const zonePins = (zonesConfig?.pins ?? {}) as Record<string, string>;
    const pinCount = Object.keys(zonePins).length;
    if (pinCount > 0) {
      info(`  Applying ${pinCount} zone pin(s) from .n-dx.json`);
    }

    let zonesResult = await analyzeZones(inventory, importsData, {
      enrich, previousZones, perZone, subAnalyses, fileArchetypes, onReset, hints,
      zonePins: pinCount > 0 ? zonePins : undefined,
    });
    let zones = zonesResult.zones;
    if (zonesResult.tokenUsage) {
      accumulateFromAggregate(ctx.tokenUsage, zonesResult.tokenUsage);
    }
    const outPath = join(ctx.svDir, DATA_FILES.zones);
    writeFileSync(outPath, toCanonicalJSON(zones));

    // --full: run remaining enrichment passes up to 4
    if (ctx.fullMode && enrich) {
      const targetPass = 4;
      const currentPass = zones.enrichmentPass ?? 0;
      const passesNeeded = targetPass - currentPass;

      for (let p = 0; p < passesNeeded; p++) {
        info(`\n[phase 4] Enrichment pass ${currentPass + p + 2}...`);
        zonesResult = await analyzeZones(inventory, importsData, {
          enrich: true, previousZones: zones, perZone, subAnalyses, fileArchetypes, onReset, hints,
          zonePins: Object.keys(zonePins).length > 0 ? zonePins : undefined,
          reuseStructure: true,
        });
        zones = zonesResult.zones;
        if (zonesResult.tokenUsage) {
          accumulateFromAggregate(ctx.tokenUsage, zonesResult.tokenUsage);
        }
        writeFileSync(outPath, toCanonicalJSON(zones));
      }
    }

    // Update manifest with children if sub-analyses were detected
    if (subAnalyses.length > 0) {
      const manifest = readManifest(ctx.absDir);
      manifest.children = buildSubAnalysisRefs(subAnalyses);
      writeManifest(ctx.absDir, manifest);
    }

    updateManifestModule(ctx.absDir, "zones", "complete");
    info(`  ${zones.zones.length} zones, ${zones.crossings.length} crossings, ${zones.unzoned.length} unzoned → ${outPath}`);

    // ── Convergence tracking ──
    try {
      const manifest = readManifest(ctx.absDir);
      const snapshots = createSnapshot(zones.zones, manifest.gitSha);
      const report: ConvergenceReport = {
        schemaVersion: "1.0.0",
        snapshots,
        analyzedAt: new Date().toISOString(),
        gitSha: manifest.gitSha,
      };

      const previousReport = await loadLatestReport(ctx.svDir);
      if (previousReport) {
        const delta = computeDeltas(snapshots, previousReport.snapshots);
        const lines = formatDeltaReport(delta);
        for (const line of lines) {
          info(`  ${line}`);
        }
      }

      await saveReport(ctx.svDir, report);
    } catch {
      // Convergence tracking is non-critical — don't fail the analysis
    }

    reportZoneInsights(zones);
  } catch (err) {
    if (err instanceof PhasePrerequsiteError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    updateManifestError(ctx.absDir, "zones", msg);
    throw new PhaseError(4, "zones", msg);
  }
}

function loadFileArchetypes(svDir: string): Map<string, string | null> | undefined {
  const classPath = join(svDir, DATA_FILES.classifications);
  if (!existsSync(classPath)) return undefined;
  try {
    const classData: Classifications = JSON.parse(readFileSync(classPath, "utf-8"));
    return new Map(classData.files.map((f) => [f.path, f.archetype]));
  } catch {
    return undefined; // Non-critical
  }
}

function reportZoneInsights(zones: any): void {
  const totalFindings = zones.findings?.length ?? 0;
  const totalInsights =
    (zones.insights?.length ?? 0) +
    zones.zones.reduce((s: number, z: any) => s + (z.insights?.length ?? 0), 0);
  if (totalFindings > 0) {
    const passLabel = zones.enrichmentPass
      ? zones.enrichmentPass > 0
        ? ` (enrichment pass ${zones.enrichmentPass})`
        : " (structural only)"
      : "";
    info(`  ${totalFindings} findings, ${totalInsights} insights${passLabel}`);
  } else if (totalInsights > 0) {
    info(`  ${totalInsights} insights${zones.enrichmentPass ? ` (enrichment pass ${zones.enrichmentPass})` : ""}`);
  }
  if (zones.insights && zones.insights.length > 0) {
    for (const insight of zones.insights.slice(0, 5)) {
      info(`    · ${insight}`);
    }
    if (zones.insights.length > 5) {
      info(`    ... and ${zones.insights.length - 5} more in zones.json`);
    }
  }
}

// ── Phase 5: Components ──────────────────────────────────────────────

export async function runComponentsPhase(ctx: AnalyzeContext): Promise<void> {
  const inventoryPath = join(ctx.svDir, DATA_FILES.inventory);
  const importsPath = join(ctx.svDir, DATA_FILES.imports);
  if (!existsSync(inventoryPath) || !existsSync(importsPath)) {
    throw new PhasePrerequsiteError(5, "components", "inventory.json and imports.json — run phases 1-2 first");
  }

  info("[phase 5] Components...");
  updateManifestModule(ctx.absDir, "components", "running");

  try {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
    const importsData = JSON.parse(readFileSync(importsPath, "utf-8"));
    const previousComponents = loadPreviousData(join(ctx.svDir, DATA_FILES.components));

    const stats = ctx.inventoryResult?.stats;
    const fileSetChanged = stats ? (stats.added > 0 || stats.deleted > 0) : true;

    const components = await analyzeComponents(ctx.absDir, inventory, importsData, !ctx.fullMode && previousComponents ? {
      previousComponents,
      changedFiles: ctx.inventoryResult?.changedFiles,
      fileSetChanged,
    } : undefined);
    const outPath = join(ctx.svDir, DATA_FILES.components);
    writeFileSync(outPath, toCanonicalJSON(components));
    updateManifestModule(ctx.absDir, "components", "complete");
    info(`  ${components.summary.totalComponents} components, ${components.summary.totalRouteModules} route modules, ${components.summary.totalUsageEdges} usage edges → ${outPath}`);
  } catch (err) {
    if (err instanceof PhasePrerequsiteError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    updateManifestError(ctx.absDir, "components", msg);
    throw new PhaseError(5, "components", msg);
  }
}

// ── Phase 6: Call Graph ──────────────────────────────────────────────

export async function runCallGraphPhase(ctx: AnalyzeContext): Promise<void> {
  const inventoryPath = join(ctx.svDir, DATA_FILES.inventory);
  const importsPath = join(ctx.svDir, DATA_FILES.imports);
  if (!existsSync(inventoryPath) || !existsSync(importsPath)) {
    throw new PhasePrerequsiteError(6, "callgraph", "inventory.json and imports.json — run phases 1-2 first");
  }

  info("[phase 6] Call graph...");
  updateManifestModule(ctx.absDir, "callgraph", "running");

  try {
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
    const importsData = JSON.parse(readFileSync(importsPath, "utf-8"));
    const previousCallGraph = loadPreviousData(join(ctx.svDir, DATA_FILES.callGraph));

    const stats = ctx.inventoryResult?.stats;
    const fileSetChanged = stats ? (stats.added > 0 || stats.deleted > 0) : true;

    const callGraph = await analyzeCallGraph(ctx.absDir, inventory, importsData, !ctx.fullMode && previousCallGraph ? {
      previousCallGraph,
      changedFiles: ctx.inventoryResult?.changedFiles,
      fileSetChanged,
    } : undefined);
    const outPath = join(ctx.svDir, DATA_FILES.callGraph);
    writeFileSync(outPath, toCanonicalJSON(callGraph));
    updateManifestModule(ctx.absDir, "callgraph", "complete");
    info(`  ${callGraph.summary.totalFunctions} functions, ${callGraph.summary.totalCalls} calls, ${callGraph.summary.filesWithCalls} files → ${outPath}`);

    // Load classifications if available for archetype-based findings
    const classificationsData: Classifications | undefined = loadPreviousData(
      join(ctx.svDir, DATA_FILES.classifications),
    );

    // Enrich zones.json with call graph cross-zone statistics and findings
    enrichZonesWithCallGraph(ctx.svDir, callGraph, inventory, importsData.edges, classificationsData);
  } catch (err) {
    if (err instanceof PhasePrerequsiteError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    updateManifestError(ctx.absDir, "callgraph", msg);
    throw new PhaseError(6, "callgraph", msg);
  }
}

// ── Zone enrichment with call graph data ─────────────────────────────

function enrichZonesWithCallGraph(
  svDir: string,
  callGraph: CallGraph,
  inventory?: Inventory,
  importEdges?: ImportEdge[],
  classifications?: Classifications,
): void {
  const zonesPath = join(svDir, DATA_FILES.zones);
  if (!existsSync(zonesPath)) return;

  try {
    const zonesData = JSON.parse(readFileSync(zonesPath, "utf-8"));
    if (!zonesData.zones || !Array.isArray(zonesData.zones)) return;

    // Build file-to-zone mapping
    const fileToZone = new Map<string, string>();
    for (const zone of zonesData.zones) {
      for (const file of zone.files) {
        fileToZone.set(file, zone.id);
      }
    }

    const { zoneStats, crossZonePatterns } = computeZoneCallStats(callGraph.edges, fileToZone);
    const zoneStatsMap = new Map(zoneStats.map((s) => [s.zoneId, s]));

    // Add call graph connectivity stats to each zone's insights
    const CALL_GRAPH_PREFIX = "[call graph]";
    for (const zone of zonesData.zones) {
      const stats = zoneStatsMap.get(zone.id);
      if (!stats) continue;

      if (zone.insights) {
        zone.insights = zone.insights.filter((i: string) => !i.startsWith(CALL_GRAPH_PREFIX));
      } else {
        zone.insights = [];
      }

      const total = stats.internalCalls + stats.outgoingCalls;
      if (total > 0) {
        zone.insights.push(
          `${CALL_GRAPH_PREFIX} ${stats.internalCalls} internal calls, ${stats.outgoingCalls} outgoing, ${stats.incomingCalls} incoming (cohesion: ${stats.callCohesion}, coupling: ${stats.callCoupling})`,
        );
      }
    }

    // Add global call graph insights
    if (!zonesData.insights) zonesData.insights = [];
    zonesData.insights = zonesData.insights.filter((i: string) => !i.startsWith(CALL_GRAPH_PREFIX));

    for (const pattern of crossZonePatterns.slice(0, 5)) {
      if (pattern.callCount >= 5) {
        zonesData.insights.push(
          `${CALL_GRAPH_PREFIX} ${pattern.callCount} calls: "${pattern.fromZone}" → "${pattern.toZone}"`,
        );
      }
    }

    // Generate architectural findings from call graph patterns
    const callGraphFindings = generateCallGraphFindings(callGraph, { inventory, importEdges, classifications });
    if (callGraphFindings.length > 0) {
      const existingFindings = (zonesData.findings ?? []).filter(
        (f: { pass: number; text: string }) =>
          !(f.pass === 0 && (
            f.text.startsWith("God function:") ||
            f.text.startsWith("Tightly coupled modules:") ||
            f.text.startsWith("Hub function:") ||
            f.text.startsWith("Fan-in hotspot:") ||
            f.text.includes("potentially unused export") ||
            f.text.includes("no incoming calls")
          )),
      );
      zonesData.findings = enforceSeverityRules(deduplicateFindings([...existingFindings, ...callGraphFindings]));
    }

    writeFileSync(zonesPath, toCanonicalJSON(zonesData));
    const findingCount = callGraphFindings.length;
    info(`  Enriched zones.json with call graph statistics${findingCount > 0 ? ` and ${findingCount} finding${findingCount !== 1 ? "s" : ""}` : ""}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Warning: call graph zone enrichment failed: ${msg}`);
  }
}

// ── Error types ──────────────────────────────────────────────────────

/** Thrown when a phase's prerequisite data files are missing. */
export class PhasePrerequsiteError extends Error {
  constructor(
    public readonly phase: number,
    public readonly module: string,
    public readonly requirement: string,
  ) {
    super(`Phase ${phase} requires ${requirement}`);
    this.name = "PhasePrerequsiteError";
  }
}

/** Thrown when a phase fails during execution. */
export class PhaseError extends Error {
  constructor(
    public readonly phase: number,
    public readonly module: string,
    public readonly reason: string,
  ) {
    super(`Phase ${phase} (${module}) failed: ${reason}`);
    this.name = "PhaseError";
  }
}

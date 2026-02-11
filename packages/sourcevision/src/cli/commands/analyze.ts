import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { SV_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { DATA_FILES, SUPPLEMENTARY_FILES } from "../../schema/data-files.js";
import { toCanonicalJSON } from "../../util/sort.js";
import { analyzeInventory } from "../../analyzers/inventory.js";
import type { InventoryResult } from "../../analyzers/inventory.js";
import { analyzeImports } from "../../analyzers/imports.js";
import { analyzeZones } from "../../analyzers/zones.js";
import { analyzeComponents } from "../../analyzers/components.js";
import { analyzeCallGraph, computeZoneCallStats } from "../../analyzers/callgraph.js";
import type { CallGraph } from "../../schema/index.js";
import { readManifest, writeManifest, updateManifestModule, updateManifestError } from "../../analyzers/manifest.js";
import { generateLlmsTxt } from "../../analyzers/llms-txt.js";
import { generateContext } from "../../analyzers/context.js";
import { emitZoneOutputs } from "../../analyzers/zone-output.js";
import { detectSubAnalyses, buildSubAnalysisRefs } from "../../analyzers/workspace.js";
import { cmdInit } from "./init.js";
import { info } from "../output.js";
import { emptyAnalyzeTokenUsage, accumulateTokenUsage, formatTokenUsage } from "../../analyzers/token-usage.js";
import type { AnalyzeTokenUsage } from "../../schema/index.js";
import { loadClaudeConfig } from "@n-dx/claude-client";
import { setClaudeConfig, getAuthMode } from "../../analyzers/claude-client.js";

type PhaseFilter =
  | { type: "all" }
  | { type: "phase"; phase: number }
  | { type: "only"; module: string };

function parsePhaseFilter(extraArgs: string[]): PhaseFilter {
  for (const a of extraArgs) {
    if (a.startsWith("--phase=")) {
      return { type: "phase", phase: parseInt(a.split("=")[1], 10) };
    }
    if (a.startsWith("--only=")) {
      return { type: "only", module: a.split("=")[1] };
    }
  }
  return { type: "all" };
}

function shouldRunPhase(filter: PhaseFilter, phase: number, moduleName: string): boolean {
  if (filter.type === "all") return true;
  if (filter.type === "phase") return filter.phase === phase;
  if (filter.type === "only") return filter.module === moduleName;
  return false;
}

export async function cmdAnalyze(targetDir: string, extraArgs: string[]): Promise<void> {
  const absDir = resolve(targetDir);
  if (!existsSync(absDir)) {
    throw new CLIError(
      `Directory not found: ${absDir}`,
      "Check the path and try again.",
    );
  }

  // Auto-init if needed
  const svDir = join(absDir, SV_DIR);
  if (!existsSync(join(svDir, DATA_FILES.manifest))) {
    info("No .sourcevision/ found — initializing...");
    cmdInit(absDir);
    info("");
  }

  // Load unified Claude config
  const claudeConfig = await loadClaudeConfig(absDir);
  setClaudeConfig(claudeConfig);
  if (getAuthMode() === "api") info("Using direct API authentication.");

  const filter = parsePhaseFilter(extraArgs);

  const tokenUsage = emptyAnalyzeTokenUsage();

  info(`Analyzing: ${absDir}`);
  info("");

  // ── Phase 1: Inventory (deterministic) ──────────────────────────────────
  let inventoryResult: InventoryResult | null = null;

  if (shouldRunPhase(filter, 1, "inventory")) {
    info("[phase 1] Inventory...");
    updateManifestModule(absDir, "inventory", "running");

    try {
      // Load previous inventory for incremental analysis
      let previousInventory: any;
      const prevInventoryPath = join(svDir, DATA_FILES.inventory);
      if (existsSync(prevInventoryPath)) {
        try {
          previousInventory = JSON.parse(readFileSync(prevInventoryPath, "utf-8"));
        } catch {
          // Corrupted — start fresh
        }
      }

      inventoryResult = await analyzeInventory(absDir, previousInventory ? { previousInventory } : undefined);

      // Serialize only { files, summary } (strip stats/changedFiles)
      const outPath = join(svDir, DATA_FILES.inventory);
      writeFileSync(outPath, toCanonicalJSON({ files: inventoryResult.files, summary: inventoryResult.summary }));
      updateManifestModule(absDir, "inventory", "complete");

      const stats = inventoryResult.stats;
      if (stats) {
        const parts = [`${stats.cached} cached`, `${stats.changed} changed`, `${stats.added} new`, `${stats.deleted} deleted`];
        if (stats.touched > 0) parts.push(`${stats.touched} touched`);
        info(`  ${inventoryResult.files.length} files (${parts.join(", ")}) → ${outPath}`);
      } else {
        info(`  ${inventoryResult.files.length} files cataloged → ${outPath}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateManifestError(absDir, "inventory", msg);
      console.error(`  Phase 1 failed: ${msg}`);
      if (filter.type === "all") process.exit(1);
    }
  }

  // ── Phase 2: Imports (deterministic) ────────────────────────────────────
  if (shouldRunPhase(filter, 2, "imports")) {
    // Phase 2 requires inventory
    const inventoryPath = join(svDir, DATA_FILES.inventory);
    if (!existsSync(inventoryPath)) {
      console.error("  Phase 2 requires inventory.json — run phase 1 first.");
      if (filter.type === "all") process.exit(1);
    } else {
      info("[phase 2] Imports...");
      updateManifestModule(absDir, "imports", "running");

      try {
        const inventoryRaw = readFileSync(inventoryPath, "utf-8");
        const inventory = JSON.parse(inventoryRaw);

        // Load previous imports for incremental analysis
        let previousImports: any;
        const prevImportsPath = join(svDir, DATA_FILES.imports);
        if (existsSync(prevImportsPath)) {
          try {
            previousImports = JSON.parse(readFileSync(prevImportsPath, "utf-8"));
          } catch {
            // Corrupted — start fresh
          }
        }

        const stats = inventoryResult?.stats;
        const fileSetChanged = stats ? (stats.added > 0 || stats.deleted > 0) : true;

        const imports = await analyzeImports(absDir, inventory, previousImports ? {
          previousImports,
          changedFiles: inventoryResult?.changedFiles,
          fileSetChanged,
        } : undefined);
        const outPath = join(svDir, DATA_FILES.imports);
        writeFileSync(outPath, toCanonicalJSON(imports));
        updateManifestModule(absDir, "imports", "complete");
        info(`  ${imports.summary.totalEdges} edges, ${imports.summary.totalExternal} external → ${outPath}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateManifestError(absDir, "imports", msg);
        console.error(`  Phase 2 failed: ${msg}`);
        if (filter.type === "all") process.exit(1);
      }
    }
  }

  // ── Phase 3: Zones (deterministic Louvain) ─────────────────────────────
  if (shouldRunPhase(filter, 3, "zones")) {
    // Phase 3 requires inventory + imports
    const inventoryPath = join(svDir, DATA_FILES.inventory);
    const importsPath = join(svDir, DATA_FILES.imports);
    if (!existsSync(inventoryPath) || !existsSync(importsPath)) {
      console.error("  Phase 3 requires inventory.json and imports.json — run phases 1-2 first.");
      if (filter.type === "all") process.exit(1);
    } else {
      info("[phase 3] Zones...");
      updateManifestModule(absDir, "zones", "running");

      const enrich = !extraArgs.includes("--fast");
      const perZone = extraArgs.includes("--per-zone");

      // Read previous zones.json for iterative enrichment
      let previousZones: any;
      const zonesPath = join(svDir, DATA_FILES.zones);
      if (existsSync(zonesPath)) {
        try {
          previousZones = JSON.parse(readFileSync(zonesPath, "utf-8"));
        } catch {
          // Corrupted file — start fresh
        }
      }

      if (enrich) {
        const modeLabel = perZone ? " (per-zone mode)" : "";
        info(`  Enriching zones${modeLabel}...`);
      } else {
        info("  Structural analysis only (skipping AI enrichment)");
      }

      try {
        const inventoryRaw = readFileSync(inventoryPath, "utf-8");
        const importsRaw = readFileSync(importsPath, "utf-8");
        const inventory = JSON.parse(inventoryRaw);
        const importsData = JSON.parse(importsRaw);

        // Detect pre-analyzed subdirectories
        const subAnalyses = detectSubAnalyses(absDir);
        if (subAnalyses.length > 0) {
          info(`  Found ${subAnalyses.length} sub-analysis: ${subAnalyses.map((s) => s.prefix).join(", ")}`);
        }

        let zonesResult = await analyzeZones(inventory, importsData, {
          enrich,
          previousZones,
          perZone,
          subAnalyses,
          onReset(fromPass, toPass) {
            info(`  Detected changes, resetting from Pass ${fromPass} to Pass ${toPass}`);
          },
        });
        let zones = zonesResult.zones;
        if (zonesResult.tokenUsage) {
          accumulateFromAggregate(tokenUsage, zonesResult.tokenUsage);
        }
        const outPath = join(svDir, DATA_FILES.zones);
        writeFileSync(outPath, toCanonicalJSON(zones));

        // --full: run remaining enrichment passes up to 4
        const fullMode = extraArgs.includes("--full");
        if (fullMode && enrich) {
          const targetPass = 4;
          const currentPass = zones.enrichmentPass ?? 0;
          const passesNeeded = targetPass - currentPass;

          for (let p = 0; p < passesNeeded; p++) {
            info(`\n[phase 3] Enrichment pass ${currentPass + p + 2}...`);
            const prevZones = zones;
            zonesResult = await analyzeZones(inventory, importsData, {
              enrich: true,
              previousZones: prevZones,
              perZone,
              subAnalyses,
              onReset(fromPass, toPass) {
                info(`  Detected changes, resetting from Pass ${fromPass} to Pass ${toPass}`);
              },
            });
            zones = zonesResult.zones;
            if (zonesResult.tokenUsage) {
              accumulateFromAggregate(tokenUsage, zonesResult.tokenUsage);
            }
            writeFileSync(outPath, toCanonicalJSON(zones));
          }
        }

        // Update manifest with children if sub-analyses were detected
        if (subAnalyses.length > 0) {
          const manifest = readManifest(absDir);
          manifest.children = buildSubAnalysisRefs(subAnalyses);
          writeManifest(absDir, manifest);
        }

        updateManifestModule(absDir, "zones", "complete");
        info(`  ${zones.zones.length} zones, ${zones.crossings.length} crossings, ${zones.unzoned.length} unzoned → ${outPath}`);

        // Print key insights and findings
        const totalFindings = zones.findings?.length ?? 0;
        const totalInsights =
          (zones.insights?.length ?? 0) +
          zones.zones.reduce((s, z) => s + (z.insights?.length ?? 0), 0);
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateManifestError(absDir, "zones", msg);
        console.error(`  Phase 3 failed: ${msg}`);
        if (filter.type === "all") process.exit(1);
      }
    }
  }

  // ── Phase 4: Components (deterministic) ──────────────────────────────────
  if (shouldRunPhase(filter, 4, "components")) {
    // Phase 4 requires inventory + imports
    const inventoryPath = join(svDir, DATA_FILES.inventory);
    const importsPath = join(svDir, DATA_FILES.imports);
    if (!existsSync(inventoryPath) || !existsSync(importsPath)) {
      console.error("  Phase 4 requires inventory.json and imports.json — run phases 1-2 first.");
      if (filter.type === "all") process.exit(1);
    } else {
      info("[phase 4] Components...");
      updateManifestModule(absDir, "components", "running");

      try {
        const inventoryRaw = readFileSync(inventoryPath, "utf-8");
        const importsRaw = readFileSync(importsPath, "utf-8");
        const inventory = JSON.parse(inventoryRaw);
        const importsData = JSON.parse(importsRaw);

        // Load previous components for incremental analysis
        let previousComponents: any;
        const prevComponentsPath = join(svDir, DATA_FILES.components);
        if (existsSync(prevComponentsPath)) {
          try {
            previousComponents = JSON.parse(readFileSync(prevComponentsPath, "utf-8"));
          } catch {
            // Corrupted — start fresh
          }
        }

        const stats = inventoryResult?.stats;
        const fileSetChanged = stats ? (stats.added > 0 || stats.deleted > 0) : true;

        const components = await analyzeComponents(absDir, inventory, importsData, previousComponents ? {
          previousComponents,
          changedFiles: inventoryResult?.changedFiles,
          fileSetChanged,
        } : undefined);
        const outPath = join(svDir, DATA_FILES.components);
        writeFileSync(outPath, toCanonicalJSON(components));
        updateManifestModule(absDir, "components", "complete");
        info(`  ${components.summary.totalComponents} components, ${components.summary.totalRouteModules} route modules, ${components.summary.totalUsageEdges} usage edges → ${outPath}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateManifestError(absDir, "components", msg);
        console.error(`  Phase 4 failed: ${msg}`);
        if (filter.type === "all") process.exit(1);
      }
    }
  }

  // ── Phase 5: Call Graph (deterministic) ──────────────────────────────────
  if (shouldRunPhase(filter, 5, "callgraph")) {
    // Phase 5 requires inventory + imports
    const inventoryPath = join(svDir, DATA_FILES.inventory);
    const importsPath = join(svDir, DATA_FILES.imports);
    if (!existsSync(inventoryPath) || !existsSync(importsPath)) {
      console.error("  Phase 5 requires inventory.json and imports.json — run phases 1-2 first.");
      if (filter.type === "all") process.exit(1);
    } else {
      info("[phase 5] Call graph...");
      updateManifestModule(absDir, "callgraph", "running");

      try {
        const inventoryRaw = readFileSync(inventoryPath, "utf-8");
        const importsRaw = readFileSync(importsPath, "utf-8");
        const inventory = JSON.parse(inventoryRaw);
        const importsData = JSON.parse(importsRaw);

        // Load previous call graph for incremental analysis
        let previousCallGraph: any;
        const prevCallGraphPath = join(svDir, DATA_FILES.callGraph);
        if (existsSync(prevCallGraphPath)) {
          try {
            previousCallGraph = JSON.parse(readFileSync(prevCallGraphPath, "utf-8"));
          } catch {
            // Corrupted — start fresh
          }
        }

        const stats = inventoryResult?.stats;
        const fileSetChanged = stats ? (stats.added > 0 || stats.deleted > 0) : true;

        const callGraph = await analyzeCallGraph(absDir, inventory, importsData, previousCallGraph ? {
          previousCallGraph,
          changedFiles: inventoryResult?.changedFiles,
          fileSetChanged,
        } : undefined);
        const outPath = join(svDir, DATA_FILES.callGraph);
        writeFileSync(outPath, toCanonicalJSON(callGraph));
        updateManifestModule(absDir, "callgraph", "complete");
        info(`  ${callGraph.summary.totalFunctions} functions, ${callGraph.summary.totalCalls} calls, ${callGraph.summary.filesWithCalls} files → ${outPath}`);

        // Enrich zones.json with call graph cross-zone statistics
        enrichZonesWithCallGraph(svDir, callGraph);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateManifestError(absDir, "callgraph", msg);
        console.error(`  Phase 5 failed: ${msg}`);
        // Non-critical — don't exit on failure, just report
        if (filter.type !== "all") {
          // Only exit if user specifically requested this phase
          process.exit(1);
        }
      }
    }
  }

  // ── Generate llms.txt + CONTEXT.md ──────────────────────────────────────
  if (filter.type === "all") {
    try {
      const manifestPath = join(svDir, DATA_FILES.manifest);
      const inventoryPath = join(svDir, DATA_FILES.inventory);
      const importsPath = join(svDir, DATA_FILES.imports);
      const zonesPath = join(svDir, DATA_FILES.zones);
      const componentsPath = join(svDir, DATA_FILES.components);

      if (existsSync(manifestPath) && existsSync(inventoryPath) && existsSync(importsPath) && existsSync(zonesPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
        const importsData = JSON.parse(readFileSync(importsPath, "utf-8"));
        const zonesData = JSON.parse(readFileSync(zonesPath, "utf-8"));
        const componentsData = existsSync(componentsPath)
          ? JSON.parse(readFileSync(componentsPath, "utf-8"))
          : null;

        const llmsTxt = generateLlmsTxt(manifest, inventory, importsData, zonesData, componentsData);
        writeFileSync(join(svDir, SUPPLEMENTARY_FILES[0]), llmsTxt);

        const contextMd = generateContext(manifest, inventory, importsData, zonesData, componentsData);
        writeFileSync(join(svDir, SUPPLEMENTARY_FILES[1]), contextMd);

        // Emit per-zone output files
        if (zonesData.zones.length > 0) {
          emitZoneOutputs(svDir, inventory, importsData, zonesData);
          manifest.zoneOutputs = true;
          writeManifest(absDir, manifest);
          info(`[output] llms.txt + CONTEXT.md + zones/ → ${svDir}`);
        } else {
          info(`[output] llms.txt + CONTEXT.md → ${svDir}`);
        }
      }
    } catch {
      // Non-critical — don't fail the analysis
    }
  }

  // ── Token usage summary ──────────────────────────────────────────────────
  const usageLine = formatTokenUsage(tokenUsage);
  if (usageLine) {
    info(`Token usage: ${usageLine}`);
  }

  // Persist token usage to manifest for cross-package aggregation
  if (tokenUsage.calls > 0) {
    const manifest = readManifest(absDir);
    manifest.tokenUsage = tokenUsage;
    writeManifest(absDir, manifest);
  }

  info("");
  info("Done.");
}

/**
 * Merge one AnalyzeTokenUsage aggregate into another.
 * Used to combine token usage from multiple analyzeZones calls (e.g. --full mode).
 */
/**
 * Enrich zones.json with call graph cross-zone statistics.
 * Adds call graph insights to existing zone insights without overwriting AI-generated content.
 */
function enrichZonesWithCallGraph(svDir: string, callGraph: CallGraph): void {
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

      // Remove previous call graph insights
      if (zone.insights) {
        zone.insights = zone.insights.filter((i: string) => !i.startsWith(CALL_GRAPH_PREFIX));
      } else {
        zone.insights = [];
      }

      // Add call graph summary
      const total = stats.internalCalls + stats.outgoingCalls;
      if (total > 0) {
        zone.insights.push(
          `${CALL_GRAPH_PREFIX} ${stats.internalCalls} internal calls, ${stats.outgoingCalls} outgoing, ${stats.incomingCalls} incoming (cohesion: ${stats.callCohesion}, coupling: ${stats.callCoupling})`
        );
      }
    }

    // Add global call graph insights
    if (!zonesData.insights) zonesData.insights = [];
    zonesData.insights = zonesData.insights.filter((i: string) => !i.startsWith(CALL_GRAPH_PREFIX));

    for (const pattern of crossZonePatterns.slice(0, 5)) {
      if (pattern.callCount >= 5) {
        zonesData.insights.push(
          `${CALL_GRAPH_PREFIX} ${pattern.callCount} calls: "${pattern.fromZone}" → "${pattern.toZone}"`
        );
      }
    }

    writeFileSync(zonesPath, toCanonicalJSON(zonesData));
    info("  Enriched zones.json with call graph statistics");
  } catch {
    // Non-critical — don't fail if zone enrichment doesn't work
  }
}

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

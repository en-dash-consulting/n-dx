import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { SV_DIR } from "../../constants.js";
import { CLIError } from "../errors.js";
import { DATA_FILES, SUPPLEMENTARY_FILES } from "../../schema/data-files.js";
import { readManifest, writeManifest } from "../../analyzers/manifest.js";
import { generateLlmsTxt } from "../../analyzers/llms-txt.js";
import { generateContext } from "../../analyzers/context.js";
import { emitZoneOutputs } from "../../analyzers/zone-output.js";
import { cmdInit } from "./init.js";
import { info } from "../output.js";
import { emptyAnalyzeTokenUsage, formatTokenUsage } from "../../analyzers/token-usage.js";
import { loadLLMConfig } from "@n-dx/llm-client";
import {
  setLLMConfig,
  getAuthMode,
  getLLMVendor,
  DEFAULT_MODEL,
  DEFAULT_CODEX_MODEL,
} from "../../analyzers/claude-client.js";
import {
  runInventoryPhase,
  runImportsPhase,
  runClassificationsPhase,
  runZonesPhase,
  runComponentsPhase,
  runCallGraphPhase,
  PhasePrerequsiteError,
  PhaseError,
} from "./analyze-phases.js";
import type { AnalyzeContext } from "./analyze-phases.js";
import { generatePrMarkdownFile } from "./pr-markdown.js";

type PhaseFilter =
  | { type: "all" }
  | { type: "phase"; phase: number }
  | { type: "only"; module: string };

const UNKNOWN_PROVIDER_METADATA = "unknown";

function normalizeProviderMetadata(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveAnalyzeTokenEventMetadata(
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>,
): { vendor: string; model: string } {
  const vendor = normalizeProviderMetadata(getLLMVendor()) ?? UNKNOWN_PROVIDER_METADATA;

  if (vendor === "codex") {
    return {
      vendor,
      model: normalizeProviderMetadata(llmConfig.codex?.model) ?? DEFAULT_CODEX_MODEL,
    };
  }
  if (vendor === "claude") {
    return {
      vendor,
      model: normalizeProviderMetadata(llmConfig.claude?.model) ?? DEFAULT_MODEL,
    };
  }

  return {
    vendor,
    model: UNKNOWN_PROVIDER_METADATA,
  };
}

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

  // Load unified LLM config (llm.vendor + vendor-specific settings)
  const llmConfig = await loadLLMConfig(absDir);
  setLLMConfig(llmConfig);
  const vendor = getLLMVendor();
  if (vendor) info(`Using ${vendor} for enrichment.`);
  if (getAuthMode() === "api") info("Using direct API authentication.");

  const filter = parsePhaseFilter(extraArgs);

  const ctx: AnalyzeContext = {
    absDir,
    svDir,
    fullMode: extraArgs.includes("--full"),
    fastMode: extraArgs.includes("--fast"),
    tokenUsage: emptyAnalyzeTokenUsage(),
    inventoryResult: null,
  };

  info(`Analyzing: ${absDir}`);
  info("");

  // ── Run analysis phases ────────────────────────────────────────────

  const phases: Array<{ phase: number; module: string; run: () => Promise<void>; critical: boolean }> = [
    { phase: 1, module: "inventory",       run: () => runInventoryPhase(ctx),               critical: true },
    { phase: 2, module: "imports",         run: () => runImportsPhase(ctx),                 critical: true },
    { phase: 3, module: "classifications", run: () => runClassificationsPhase(ctx),         critical: true },
    { phase: 4, module: "zones",           run: () => runZonesPhase(ctx, extraArgs),        critical: true },
    { phase: 5, module: "components",      run: () => runComponentsPhase(ctx),              critical: true },
    { phase: 6, module: "callgraph",       run: () => runCallGraphPhase(ctx),               critical: false },
  ];

  for (const { phase, module, run, critical } of phases) {
    if (!shouldRunPhase(filter, phase, module)) continue;

    try {
      await run();
    } catch (err) {
      if (err instanceof PhasePrerequsiteError) {
        console.error(`  Phase ${err.phase} requires ${err.requirement}.`);
        if (filter.type === "all") process.exit(1);
      } else if (err instanceof PhaseError) {
        console.error(`  Phase ${err.phase} failed: ${err.reason}`);
        if (critical && filter.type === "all") process.exit(1);
        if (!critical && filter.type !== "all") process.exit(1);
      } else {
        throw err;
      }
    }
  }

  // ── Generate llms.txt + CONTEXT.md ──────────────────────────────────
  if (filter.type === "all") {
    generateOutputFiles(ctx);
  }

  // ── Generate PR markdown from branch work record ───────────────────
  if (filter.type === "all") {
    await generatePrMarkdownStep(ctx);
  }

  // ── Token usage summary ─────────────────────────────────────────────
  const usageLine = formatTokenUsage(ctx.tokenUsage);
  if (usageLine) {
    info(`Token usage: ${usageLine}`);
  }

  // Persist token usage to manifest for cross-package aggregation
  if (ctx.tokenUsage.calls > 0) {
    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    const manifest = readManifest(absDir);
    manifest.tokenUsage = {
      ...ctx.tokenUsage,
      vendor: metadata.vendor,
      model: metadata.model,
    };
    writeManifest(absDir, manifest);
  }

  info("");
  info("Done.");
}

// ── PR markdown generation ───────────────────────────────────────────

/**
 * Classify a PR markdown generation error into an actionable guidance message.
 *
 * Inspects the error message for common filesystem and configuration patterns
 * and returns a human-readable suggestion for resolution.
 */
export function classifyPrMarkdownError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/EACCES|EPERM/i.test(message)) {
    return "Permission denied writing to .sourcevision/. Check directory permissions and try again.";
  }
  if (/ENOSPC/i.test(message)) {
    return "Disk full. Free up space and re-run the analysis.";
  }
  if (/ENOENT/i.test(message) && /\.sourcevision/i.test(message)) {
    return "The .sourcevision/ directory is missing. Run 'sourcevision init' first.";
  }
  if (/ENOENT/i.test(message)) {
    return "A required file or directory was not found. Run 'sourcevision init' to ensure the project is set up.";
  }

  return `${message}. Re-run 'sourcevision analyze' or check .rex/prd.json integrity.`;
}

async function generatePrMarkdownStep(ctx: AnalyzeContext): Promise<void> {
  try {
    const { outputPath, itemCount, warnings } = await generatePrMarkdownFile(
      ctx.absDir,
      ctx.svDir,
    );

    for (const warning of warnings) {
      info(`  Warning: ${warning}`);
    }

    info(`[output] pr-markdown.md (${itemCount} item${itemCount !== 1 ? "s" : ""}) → ${outputPath}`);
  } catch (err) {
    const guidance = classifyPrMarkdownError(err);
    info("[output] pr-markdown.md — generation failed");
    info(`  ${guidance}`);
  }
}

// ── Output generation ────────────────────────────────────────────────

function generateOutputFiles(ctx: AnalyzeContext): void {
  try {
    const manifestPath = join(ctx.svDir, DATA_FILES.manifest);
    const inventoryPath = join(ctx.svDir, DATA_FILES.inventory);
    const importsPath = join(ctx.svDir, DATA_FILES.imports);
    const zonesPath = join(ctx.svDir, DATA_FILES.zones);
    const componentsPath = join(ctx.svDir, DATA_FILES.components);
    const classificationsPath = join(ctx.svDir, DATA_FILES.classifications);

    if (!existsSync(manifestPath) || !existsSync(inventoryPath) || !existsSync(importsPath) || !existsSync(zonesPath)) {
      return;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
    const importsData = JSON.parse(readFileSync(importsPath, "utf-8"));
    const zonesData = JSON.parse(readFileSync(zonesPath, "utf-8"));
    const componentsData = existsSync(componentsPath)
      ? JSON.parse(readFileSync(componentsPath, "utf-8"))
      : null;
    const classData = existsSync(classificationsPath)
      ? JSON.parse(readFileSync(classificationsPath, "utf-8"))
      : null;

    const llmsTxt = generateLlmsTxt(manifest, inventory, importsData, zonesData, componentsData, classData);
    writeFileSync(join(ctx.svDir, SUPPLEMENTARY_FILES[0]), llmsTxt);

    const contextMd = generateContext(manifest, inventory, importsData, zonesData, componentsData, classData);
    writeFileSync(join(ctx.svDir, SUPPLEMENTARY_FILES[1]), contextMd);

    // Emit per-zone output files
    if (zonesData.zones.length > 0) {
      emitZoneOutputs(ctx.svDir, inventory, importsData, zonesData);
      manifest.zoneOutputs = true;
      writeManifest(ctx.absDir, manifest);
      info(`[output] llms.txt + CONTEXT.md + zones/ → ${ctx.svDir}`);
    } else {
      info(`[output] llms.txt + CONTEXT.md → ${ctx.svDir}`);
    }
  } catch {
    // Non-critical — don't fail the analysis
  }
}

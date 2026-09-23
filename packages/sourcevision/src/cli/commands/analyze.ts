import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {resolve, join} from "node:path";import {
  SV_DIR,
  DATA_FILES,
  SUPPLEMENTARY_FILES,
  readManifest,
  writeManifest,
  generateLlmsTxt,
  generateContext,
  emitZoneOutputs,
  assessAllZoneRisks,
  deduplicateFindings,
  enforceSeverityRules,
  toCanonicalJSON,
  emptyAnalyzeTokenUsage,
  formatTokenUsage,
  detectSubAnalyses,
  setLLMConfig,
  setProjectDir,
  getAuthMode,
  getLLMVendor,
} from "../sourcevision-core.js";
import { CLIError } from "../errors.js";
import { cmdInit } from "./init.js";
import { info } from "../output.js";
import { DEFAULT_LLM_VENDOR, loadLLMConfig, printVendorModelHeader, resolveVendorModel, bold, dim, green, cyan, classifyLLMError, warn, spawnTool } from "@n-dx/llm-client";
import type { RiskJustificationEntry, ZoneType } from "../sourcevision-core.js";
import {
  runInventoryPhase,
  runImportsPhase,
  runClassificationsPhase,
  runZonesPhase,
  runComponentsPhase,
  runCallGraphPhase,
  PhasePrerequsiteError,
  PhaseError,
  MAX_ENRICHMENT_PASS,
} from "./analyze-phases.js";
import type { AnalyzeContext } from "./analyze-phases.js";
import { generatePrMarkdownFile } from "./pr-markdown.js";
import { buildProjectProfile, stripProjectProfileForDisk } from "../../analyzers/project-profile.js";
import { generatePrimer, PRIMER_FILE } from "../../analyzers/primer.js";
import { callClaude } from "../../analyzers/claude-client.js";
import { startRunLedger, recordPhaseDuration, snapshotRunLedger, formatRunLedger } from "../../analyzers/run-ledger.js";
import { configureJudgmentCache } from "../../analyzers/judgment-cache.js";
import { carryNarration, cmdNarrate, NARRATION_LOG, takeOverNarration } from "./narrate.js";
import type { NarrateDeps } from "./narrate.js";
import type { Manifest } from "../sourcevision-core.js";

type PhaseFilter =
  | { type: "all" }
  | { type: "phase"; phase: number }
  | { type: "only"; module: string };

/**
 * Parse `--target-pass=<N>` from CLI args. Returns undefined when absent.
 * A plain analyze run already reaches pass 1 and `--full` runs to pass
 * MAX_ENRICHMENT_PASS, so only 2–MAX_ENRICHMENT_PASS are meaningful targets.
 */
export function parseTargetPass(extraArgs: string[]): number | undefined {
  const arg = extraArgs.find((a) => a.startsWith("--target-pass="));
  if (!arg) return undefined;
  const raw = arg.slice("--target-pass=".length);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 2 || value > MAX_ENRICHMENT_PASS) {
    throw new CLIError(
      `Invalid --target-pass value: ${raw}`,
      `Use an integer between 2 and ${MAX_ENRICHMENT_PASS} (a plain analyze run reaches pass 1; --full runs to pass ${MAX_ENRICHMENT_PASS}).`,
    );
  }
  return value;
}

const UNKNOWN_PROVIDER_METADATA = "unknown";

function normalizeProviderMetadata(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveAnalyzeTokenEventMetadata(
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>,
): { vendor: string; model: string } {
  const rawVendor = getLLMVendor();
  const vendor = normalizeProviderMetadata(rawVendor) ?? UNKNOWN_PROVIDER_METADATA;

  if (rawVendor) {
    return {
      vendor,
      model: resolveVendorModel(rawVendor, llmConfig),
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

/**
 * Ensure the .sourcevision directory exists and load LLM configuration.
 *
 * Returns the loaded LLM config and the resolved svDir path.
 */
export async function initAndLoadLLMConfig(absDir: string): Promise<{
  svDir: string;
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>;
}> {
  const svDir = join(absDir, SV_DIR);
  if (!existsSync(join(svDir, DATA_FILES.manifest))) {
    info("No .sourcevision/ found — initializing...");
    cmdInit(absDir);
    info("");
  }

  const llmConfig = await loadLLMConfig(absDir);
  setLLMConfig(llmConfig);
  setProjectDir(absDir);
  configureJudgmentCache({ svDir: join(absDir, SV_DIR) });
  const vendor = getLLMVendor();
  if (vendor) {
    printVendorModelHeader(vendor, llmConfig);
  }
  if (getAuthMode() === "api") info("Using direct API authentication.");

  return { svDir, llmConfig };
}

/**
 * Run deep-mode sub-package analyses before the root analysis.
 */
async function runDeepSubAnalyses(absDir: string, extraArgs: string[]): Promise<void> {
  if (!extraArgs.includes("--deep")) return;

  const subAnalyses = detectSubAnalyses(absDir);
  if (subAnalyses.length === 0) return;

  info(`${dim("[deep]")} Found ${subAnalyses.length} sub-package${subAnalyses.length > 1 ? "s" : ""}: ${subAnalyses.map((s) => s.prefix).join(", ")}`);
  const childArgs = extraArgs.filter((a) => a !== "--deep");
  for (const sub of subAnalyses) {
    const subDir = join(absDir, sub.prefix);
    info(`\n${dim("[deep]")} Analyzing ${sub.prefix}...`);
    await cmdAnalyze(subDir, childArgs);
    info("");
  }
  info(`${dim("[deep]")} Sub-package analysis complete, proceeding with root.\n`);
}

/**
 * Execute filtered analysis phases, handling phase-specific errors.
 */
async function executePhases(ctx: AnalyzeContext, filter: PhaseFilter, extraArgs: string[]): Promise<void> {
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

    const phaseStartedAt = Date.now();
    try {
      await run();
    } catch (err) {
      if (err instanceof PhasePrerequsiteError) {
        console.error(`  Phase ${err.phase} requires ${err.requirement}.`);
        if (filter.type === "all") process.exit(1);
      } else if (err instanceof PhaseError) {
        // Classify the underlying error for LLM-specific guidance
        const vendor = getLLMVendor() ?? DEFAULT_LLM_VENDOR;
        const classified = classifyLLMError(
          new Error(err.reason),
          vendor,
          `run phase ${err.phase} (${err.module})`,
        );
        if (classified.category !== "unknown") {
          console.error(`  Phase ${err.phase} failed: ${classified.message}`);
          warn(`  Hint: ${classified.suggestion}`);
        } else {
          console.error(`  Phase ${err.phase} failed: ${err.reason}`);
        }
        if (critical && filter.type === "all") process.exit(1);
        if (!critical && filter.type !== "all") process.exit(1);
      } else {
        // Unrecognized error — try LLM classification before rethrowing
        const errObj = err instanceof Error ? err : new Error(String(err));
        const vendor = getLLMVendor() ?? DEFAULT_LLM_VENDOR;
        const classified = classifyLLMError(errObj, vendor);
        if (classified.category !== "unknown") {
          console.error(`  Phase ${phase} failed: ${classified.message}`);
          warn(`  Hint: ${classified.suggestion}`);
          if (critical && filter.type === "all") process.exit(1);
          if (!critical && filter.type !== "all") process.exit(1);
        } else {
          throw err;
        }
      }
    } finally {
      recordPhaseDuration(module, Date.now() - phaseStartedAt);
    }
  }
}

/** The analyze helpers `sv narrate` reuses (see NarrateDeps for why they are injected). */
export function narrateDeps(): NarrateDeps {
  return {
    bootstrap: initAndLoadLLMConfig,
    generateOutputs: generateOutputFiles,
    appendHistory: appendAnalysisHistory,
  };
}

/**
 * Spawn `sv narrate <dir>` detached, log to `.sourcevision/.cache/narration.log`,
 * and record the pending state on the manifest so the dashboard and the
 * next `analyze` can see it. The child regenerates the outputs when done.
 */
async function scheduleDetachedNarration(absDir: string, svDir: string, zoneIds: string[], nameZoneIds: string[]): Promise<void> {
  const logPath = join(absDir, NARRATION_LOG);
  const startedAt = new Date().toISOString();
  try {
    mkdirSync(join(svDir, ".cache"), { recursive: true });
    const cli = fileURLToPath(new URL("../index.js", import.meta.url));
    const child = await spawnTool(process.execPath, [cli, "narrate", absDir], {
      detached: true,
      detachedLogFile: logPath,
      env: process.env,
    });
    const manifest = readManifest(absDir);
    manifest.narration = { status: "pending", zones: zoneIds, ...(nameZoneIds.length > 0 ? { names: nameZoneIds } : {}), startedAt, pid: child.pid, log: NARRATION_LOG };
    writeManifest(absDir, manifest);
    info("");
    const parts = [
      ...(zoneIds.length > 0 ? [`narrating ${bold(String(zoneIds.length))} zone${zoneIds.length === 1 ? "" : "s"}`] : []),
      ...(nameZoneIds.length > 0 ? [`naming ${bold(String(nameZoneIds.length))} zone${nameZoneIds.length === 1 ? "" : "s"}`] : []),
    ];
    info(`${cyan("Background:")} ${parts.join(", ")} — results above are complete; names and insights land in zones.json when it finishes.`);
    info(`  ${dim(`log: ${NARRATION_LOG} · pass --wait to block instead`)}`);
  } catch (err) {
    const manifest = readManifest(absDir);
    manifest.narration = { status: "failed", zones: zoneIds, ...(nameZoneIds.length > 0 ? { names: nameZoneIds } : {}), startedAt, reason: `could not spawn narrator: ${err instanceof Error ? err.message : String(err)}` };
    writeManifest(absDir, manifest);
    warn(`  could not start background narration (${err instanceof Error ? err.message : String(err)}); run 'sv narrate .' or 'sv analyze --wait .'`);
  }
}

function currentZoneIds(svDir: string): Set<string> {
  try {
    type Z = { id: string; subZones?: Z[] };
    const zones = JSON.parse(readFileSync(join(svDir, DATA_FILES.zones), "utf-8")) as { zones?: Z[]; areas?: { id: string }[] };
    const ids: string[] = [];
    const walk = (z: Z) => { ids.push(z.id); (z.subZones ?? []).forEach(walk); };
    (zones.zones ?? []).forEach(walk);
    // Sub-zone ids and `area:<id>` names are queued alongside zone ids.
    return new Set([...ids, ...(zones.areas ?? []).map((a) => `area:${a.id}`)]);
  } catch {
    return new Set();
  }
}

/** Runs kept in `.sourcevision/.cache/analyses.jsonl`; older lines are dropped. */
const ANALYSIS_HISTORY_MAX = 200;

/**
 * Report and persist token usage to manifest for cross-package aggregation,
 * and record the run — per phase and per task class — on the manifest and
 * in the machine-local history.
 */
function finalizeTokenUsage(
  ctx: AnalyzeContext,
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>,
): void {
  const usageLine = formatTokenUsage(ctx.tokenUsage);
  if (usageLine) {
    info(`${dim("Token usage:")} ${usageLine}`);
  }
  const run = snapshotRunLedger();
  for (const line of formatRunLedger(run)) info(dim(line));

  const manifest = readManifest(ctx.absDir);
  if (ctx.tokenUsage.calls > 0) {
    const metadata = resolveAnalyzeTokenEventMetadata(llmConfig);
    manifest.tokenUsage = {
      ...ctx.tokenUsage,
      vendor: metadata.vendor,
      model: metadata.model,
    };
  }
  manifest.lastAnalysis = run;
  writeManifest(ctx.absDir, manifest);
  appendAnalysisHistory(ctx.svDir, JSON.stringify(run));
}

/** Append one run to the history file, trimming it to {@link ANALYSIS_HISTORY_MAX} lines. */
export function appendAnalysisHistory(svDir: string, line: string): void {
  try {
    const dir = join(svDir, ".cache");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "analyses.jsonl");
    appendFileSync(path, line + "\n");
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    if (lines.length > ANALYSIS_HISTORY_MAX) {
      writeFileSync(path, lines.slice(-ANALYSIS_HISTORY_MAX).join("\n") + "\n");
    }
  } catch {
    // History is a convenience; never fail an analysis for it.
  }
}

export async function cmdAnalyze(targetDir: string, extraArgs: string[]): Promise<void> {
  const absDir = resolve(targetDir);
  if (!existsSync(absDir)) {
    throw new CLIError(
      `Directory not found: ${absDir}`,
      "Check the path and try again.",
    );
  }

  const { svDir, llmConfig } = await initAndLoadLLMConfig(absDir);
  const filter = parsePhaseFilter(extraArgs);

  startRunLedger(
    extraArgs.includes("--fast") ? "fast" : extraArgs.includes("--narrate") ? "narrate" : "generative",
  );
  const ctx: AnalyzeContext = {
    absDir,
    svDir,
    fullMode: extraArgs.includes("--full"),
    fastMode: extraArgs.includes("--fast"),
    narrate: extraArgs.includes("--narrate"),
    wait: extraArgs.includes("--wait"),
    targetPass: parseTargetPass(extraArgs),
    tokenUsage: emptyAnalyzeTokenUsage(),
    inventoryResult: null,
  };

  // Stop a narrator still working on the previous analysis before this one
  // rewrites zones.json; whatever it had not finished is queued again below.
  const takenOver = takeOverNarration(absDir);
  if (takenOver.stopped !== undefined) {
    info(dim(`  [narrate] stopped the previous background narrator (pid ${takenOver.stopped}); its unfinished work is carried into this run`));
  }

  await runDeepSubAnalyses(absDir, extraArgs);

  info(`${bold("Analyzing:")} ${dim(absDir)}`);
  info("");

  await executePhases(ctx, filter, extraArgs);

  // A --fast run makes no LLM calls, so it leaves the carried work recorded
  // (as a retryable failure) for the next full run instead of spawning for it.
  if (!ctx.fastMode && takenOver.zones.length + takenOver.names.length > 0) {
    const merged = carryNarration(
      takenOver,
      { zones: ctx.pendingNarration, names: ctx.pendingNames },
      currentZoneIds(svDir),
    );
    ctx.pendingNarration = merged.zones;
    ctx.pendingNames = merged.names;
    if (merged.carried + merged.dropped > 0) {
      info(dim(`  [narrate] ${merged.carried} unfinished item(s) from the previous narration carried forward${merged.dropped > 0 ? `, ${merged.dropped} dropped (zone no longer exists)` : ""}`));
    }
  }

  // --wait: narrate the escalated zones (and generate pending names) now,
  // before the outputs are written.
  const anythingPending = (ctx.pendingNarration?.length ?? 0) + (ctx.pendingNames?.length ?? 0) > 0;
  if (anythingPending && ctx.wait) {
    await cmdNarrate(absDir, { inline: true, zoneIds: ctx.pendingNarration ?? [], nameZoneIds: ctx.pendingNames ?? [], deps: narrateDeps() });
    ctx.pendingNarration = undefined;
    ctx.pendingNames = undefined;
  }

  if (filter.type === "all") {
    await generateOutputFiles(ctx);
    await generatePrMarkdownStep(ctx);
  }

  finalizeTokenUsage(ctx, llmConfig);

  // Otherwise the results are on disk already; narration continues in a
  // detached child so this command can return.
  if ((ctx.pendingNarration?.length ?? 0) + (ctx.pendingNames?.length ?? 0) > 0) {
    await scheduleDetachedNarration(ctx.absDir, ctx.svDir, ctx.pendingNarration ?? [], ctx.pendingNames ?? []);
  }

  // Hint about zone pins when move-file or structural findings exist
  try {
    const zonesPath = join(ctx.svDir, "zones.json");
    const zonesRaw = readFileSync(zonesPath, "utf-8");
    const zonesData = JSON.parse(zonesRaw);
    const findings = zonesData.findings ?? [];
    const moveCount = findings.filter((f: { type: string }) => f.type === "move-file").length;
    const structuralCount = findings.filter((f: { category?: string }) => f.category === "structural").length;
    if (moveCount > 0 || structuralCount > 0) {
      info("");
      info(`${cyan("Tip:")} ${moveCount > 0 ? `${bold(String(moveCount))} file-move suggestion${moveCount === 1 ? "" : "s"} detected. ` : ""}If zone assignments look wrong, you can override them with zone pins:`);
      info(`  ${dim("ndx config sourcevision.zones.pins '{\"path/to/file.ts\": \"target-zone-id\"}'")}`);
    }
  } catch {
    // Non-critical — don't fail the analysis
  }

  info("");
  info(green("Done."));
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

    info(`${dim("[output]")} pr-markdown.md (${bold(String(itemCount))} item${itemCount !== 1 ? "s" : ""}) → ${dim(outputPath)}`);
  } catch (err) {
    const guidance = classifyPrMarkdownError(err);
    info(`${dim("[output]")} pr-markdown.md — generation failed`);
    info(`  ${guidance}`);
  }
}

// ── Output generation ────────────────────────────────────────────────

/**
 * Distil and persist the startup primer, best-effort.
 *
 * Consumers (the `ndx work` context pipe) fall back to CONTEXT.md when no
 * primer exists, so every failure path here is a silent skip: no LLM
 * configured, a refusal, or output that breaks the primer contract. The only
 * visible outcome is a one-line note when a primer is written or reused.
 */
async function writePrimerIfPossible(
  ctx: AnalyzeContext,
  manifest: Manifest,
  contextMd: string,
): Promise<void> {
  try {
    const primerPath = join(ctx.svDir, PRIMER_FILE);
    const cachedPrimer = existsSync(primerPath) ? readFileSync(primerPath, "utf-8") : null;

    // Only distil when this analysis already made successful LLM calls.
    //
    // That is the one reliable signal that a working, authenticated model is
    // reachable: the vendor and auth-mode getters both fall back to defaults
    // when nothing is configured, so consulting them would have this attempt
    // a spawn in every environment without one — including `ndx ci` and the
    // test suite, where it costs a timeout rather than a primer. A cached
    // primer is still served in those runs; only generation is gated.
    if (ctx.tokenUsage.calls === 0) {
      if (!cachedPrimer) {
        info(`${dim("[primer]")} skipped — no LLM calls in this analysis`);
      }
      return;
    }
    // The cascade's calls are judgments, not generation: they prove a Jev
    // key works, not that a text model is reachable. The primer is prose,
    // so it is generated only by a generative run (`--narrate`, or the
    // default without a judgment route); a cached primer is still served.
    if (snapshotRunLedger().mode === "cascade") {
      if (!cachedPrimer) {
        info(`${dim("[primer]")} skipped — cascade mode; run with --narrate to generate it`);
      }
      return;
    }

    const result = await generatePrimer({
      contextMd,
      manifest,
      cachedPrimer,
      call: (prompt) => callClaude(prompt, undefined, { taskClass: "context.distill" }),
    });

    if (result.status === "generated") {
      writeFileSync(primerPath, result.primer);
      info(`${dim("[output]")} ${PRIMER_FILE} (distilled startup context) → ${dim(ctx.svDir)}`);
    } else if (result.status === "skipped") {
      info(`${dim("[primer]")} skipped — ${result.reason}`);
    }
  } catch {
    // Never fail an analysis for a primer.
  }
}

export async function generateOutputFiles(ctx: AnalyzeContext): Promise<void> {
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

    // Load risk justifications and zone types from .n-dx.json
    const riskJustifications = loadRiskJustifications(ctx.svDir);
    const zoneTypes = loadZoneTypes(ctx.svDir);

    // Compute architectural risk scoring and attach metrics to zones
    if (zonesData.zones.length > 0) {
      const riskResult = assessAllZoneRisks(zonesData, {
        justifications: riskJustifications,
        zoneTypes,
      });

      // Attach risk metrics to each zone object
      for (const zone of zonesData.zones) {
        const metrics = riskResult.metrics[zone.id];
        if (metrics) {
          zone.riskMetrics = metrics;
        }
      }

      // Merge risk findings with existing findings (replace previous risk findings)
      if (riskResult.findings.length > 0) {
        const existingFindings = (zonesData.findings ?? []).filter(
          (f: { pass: number; text: string }) =>
            !(f.pass === 0 && (
              f.text.includes("(risk score:") ||
              f.text.includes("zones are fragile")
            )),
        );
        zonesData.findings = enforceSeverityRules(
          deduplicateFindings([...existingFindings, ...riskResult.findings]),
        );
      }

      writeFileSync(join(ctx.svDir, DATA_FILES.zones), toCanonicalJSON(zonesData));
    }

    // Project profile — primary language, frameworks, release/build/CI surfaces
    // and import-graph quality. Written before CONTEXT.md / llms.txt so they
    // can reference it on a future pass; consumed by the finding LLM prompt
    // to suppress recommendations that contradict the detected project shape.
    const projectProfile = buildProjectProfile(ctx.absDir, inventory, importsData);
    writeFileSync(
      join(ctx.svDir, DATA_FILES.projectProfile),
      toCanonicalJSON(stripProjectProfileForDisk(projectProfile)),
    );

    const llmsTxt = generateLlmsTxt(manifest, inventory, importsData, zonesData, componentsData, classData);
    writeFileSync(join(ctx.svDir, SUPPLEMENTARY_FILES[0]), llmsTxt);

    const contextMd = generateContext(manifest, inventory, importsData, zonesData, componentsData, classData);
    writeFileSync(join(ctx.svDir, SUPPLEMENTARY_FILES[1]), contextMd);

    // Distil a short primer for agent startup context. Best-effort by design:
    // consumers fall back to CONTEXT.md, so no primer is a known-good state
    // and this must never fail an analysis. Skipped entirely when the run made
    // no LLM calls (`--lite`), since there is no configured model to ask.
    await writePrimerIfPossible(ctx, manifest, contextMd);

    // Emit per-zone output files
    if (zonesData.zones.length > 0) {
      emitZoneOutputs(ctx.svDir, inventory, importsData, zonesData);
      manifest.zoneOutputs = true;
      writeManifest(ctx.absDir, manifest);
      info(`${dim("[output]")} llms.txt + CONTEXT.md + zones/ → ${dim(ctx.svDir)}`);
    } else {
      info(`${dim("[output]")} llms.txt + CONTEXT.md → ${dim(ctx.svDir)}`);
    }
  } catch {
    // Non-critical — don't fail the analysis
  }
}

/**
 * Load risk justifications from .n-dx.json (synchronous).
 * Returns the array from `sourcevision.riskJustifications` or undefined.
 */
function loadRiskJustifications(svDir: string): RiskJustificationEntry[] | undefined {
  try {
    const projectDir = resolve(svDir, "..");
    const configPath = join(projectDir, ".n-dx.json");
    if (!existsSync(configPath)) return undefined;
    const data = JSON.parse(readFileSync(configPath, "utf-8"));
    const justifications = data?.sourcevision?.riskJustifications;
    if (Array.isArray(justifications) && justifications.length > 0) {
      return justifications as RiskJustificationEntry[];
    }
  } catch {
    // Invalid config — no justifications
  }
  return undefined;
}

/**
 * Load zone type annotations from .n-dx.json (synchronous).
 * Returns the map from `sourcevision.zones.types` or undefined.
 */
function loadZoneTypes(svDir: string): Record<string, ZoneType> | undefined {
  try {
    const projectDir = resolve(svDir, "..");
    const configPath = join(projectDir, ".n-dx.json");
    if (!existsSync(configPath)) return undefined;
    const data = JSON.parse(readFileSync(configPath, "utf-8"));
    const types = data?.sourcevision?.zones?.types;
    if (types && typeof types === "object" && Object.keys(types).length > 0) {
      return types as Record<string, ZoneType>;
    }
  } catch {
    // Invalid config — no zone types
  }
  return undefined;
}

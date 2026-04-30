import { join, resolve } from "node:path";
import { access, readFile, unlink } from "node:fs/promises";
import { atomicWriteJSON } from "../../store/atomic-write.js";
import { randomUUID } from "node:crypto";
import { resolveStore, ensureLegacyPrdMigrated } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { syncFolderTree } from "./folder-tree-sync.js";
import { CLIError, BudgetExceededError } from "../errors.js";
import { parseIntSafe } from "../validate-input.js";
import { info, warn, result, startSpinner } from "../output.js";
import {
  preflightBudgetCheck,
  formatBudgetWarnings,
} from "./token-format.js";
import {
  scanTests,
  scanDocs,
  scanSourceVision,
  scanPackageJson,
  scanGoMod,
  reconcile,
  buildProposals,
  deduplicateScanResults,
  reasonFromFiles,
  reasonFromScanResults,
  emptyAnalyzeTokenUsage,
  formatDiff,
  DEFAULT_MODEL,
  DEFAULT_CODEX_MODEL,
  setLLMConfig,
  setClaudeConfig,
  getAuthMode,
  getLLMVendor,
  applyDecompositionPass,
  applyConsolidationGuard,
} from "../../analyze/index.js";
import type { ScanResult, Proposal } from "../../analyze/index.js";
import type { PRDItem, PRDDocument, AnalyzeTokenUsage, LoEConfig } from "../../schema/index.js";
import { LOE_DEFAULTS } from "../../schema/index.js";
import type { BatchAcceptanceRecord } from "../../analyze/index.js";
import { loadClaudeConfig, loadLLMConfig } from "../../store/project-config.js";
import { printVendorModelHeader, resolveVendorModel, cyan, yellow, dim } from "@n-dx/llm-client";
import { formatTaskLoE, formatTaskLoERationale } from "./format-loe.js";
import { resolveVendorCompatibleRexModel } from "../model-resolution.js";

const PENDING_FILE = "pending-proposals.json";
/**
 * Sentinel file written before acceptance starts and removed after completion.
 * If this file exists on load, the previous accept was interrupted mid-write,
 * indicating the pending-proposals and PRD may be in an inconsistent state.
 */
const ACCEPT_SENTINEL = ".accepting";
const UNKNOWN_PROVIDER_METADATA = "unknown";

function normalizeProviderMetadata(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveAnalyzeTokenEventMetadata(
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>,
  requestedModel?: string,
): { vendor: string; model: string } {
  const vendor = normalizeProviderMetadata(getLLMVendor()) ?? UNKNOWN_PROVIDER_METADATA;
  const explicitModel = normalizeProviderMetadata(requestedModel);
  if (explicitModel) {
    return { vendor, model: explicitModel };
  }

  if (vendor === "codex" || vendor === "claude") {
    return {
      vendor,
      model: normalizeProviderMetadata(resolveVendorModel(vendor, llmConfig))
        ?? (vendor === "codex" ? DEFAULT_CODEX_MODEL : DEFAULT_MODEL),
    };
  }

  return {
    vendor,
    model: UNKNOWN_PROVIDER_METADATA,
  };
}

/** Format token usage for display. Returns empty string when no tokens were used. */
export function formatTokenUsage(usage: AnalyzeTokenUsage): string {
  if (usage.calls === 0 || (usage.inputTokens === 0 && usage.outputTokens === 0)) {
    return "";
  }

  const total = usage.inputTokens + usage.outputTokens;
  const parts = [
    `${total.toLocaleString()} tokens`,
    `(${usage.inputTokens.toLocaleString()} in`,
    `/ ${usage.outputTokens.toLocaleString()} out)`,
  ];

  if (usage.calls > 1) {
    parts.push(`across ${usage.calls} LLM calls`);
  }

  return parts.join(" ");
}

async function hasRexDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, REX_DIR));
    return true;
  } catch {
    return false;
  }
}

function formatProposals(proposals: Proposal[], thresholdWeeks?: number): string {
  const lines: string[] = [];
  for (const p of proposals) {
    lines.push(`${cyan("[epic]")} ${p.epic.title} ${dim(`(from: ${p.epic.source})`)}`);
    for (const f of p.features) {
      lines.push(`  ${yellow("[feature]")} ${f.title} ${dim(`(from: ${f.source})`)}`);
      for (const t of f.tasks) {
        const pri = t.priority ? ` [${t.priority}]` : "";
        if (t.decomposition) {
          const loeLabel = t.loe !== undefined ? `${t.loe}w` : "?";
          const thresholdLabel = `${t.decomposition.thresholdWeeks}w`;
          lines.push(`    ${dim("[task]")} ${t.title}${pri} ⚡ decomposed (LoE: ${loeLabel} > ${thresholdLabel} threshold)`);
          for (const child of t.decomposition.children) {
            const childPri = child.priority ? ` [${child.priority}]` : "";
            const childLoe = formatTaskLoE(child, thresholdWeeks);
            lines.push(`      ↳ ${child.title}${childPri}${childLoe}`);
            const childRationale = formatTaskLoERationale(child, "         ");
            if (childRationale) lines.push(childRationale);
          }
        } else {
          const loe = formatTaskLoE(t, thresholdWeeks);
          lines.push(`    ${dim("[task]")} ${t.title}${pri}${loe} ${dim(`(from: ${t.sourceFile})`)}`);
          const rationale = formatTaskLoERationale(t, "      ");
          if (rationale) lines.push(rationale);
        }
      }
    }
  }
  return lines.join("\n");
}

async function savePending(dir: string, proposals: Proposal[]): Promise<void> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  await atomicWriteJSON(filePath, proposals);
}

async function loadPending(dir: string): Promise<Proposal[] | null> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as Proposal[];
  } catch {
    return null;
  }
}

async function clearPending(dir: string): Promise<void> {
  try {
    await unlink(join(dir, REX_DIR, PENDING_FILE));
  } catch {
    // Already gone
  }
}

/** Write sentinel file indicating an accept is in progress. */
async function writeSentinel(dir: string): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(dir, REX_DIR, ACCEPT_SENTINEL),
    JSON.stringify({ startedAt: new Date().toISOString(), pid: process.pid }),
  );
}

/** Remove sentinel file after successful accept. */
async function clearSentinel(dir: string): Promise<void> {
  try {
    await unlink(join(dir, REX_DIR, ACCEPT_SENTINEL));
  } catch {
    // Already gone
  }
}

/**
 * Check for stale accept sentinel indicating a crashed accept.
 * Returns true if a sentinel was found (caller should warn).
 */
async function checkSentinel(dir: string): Promise<boolean> {
  try {
    await access(join(dir, REX_DIR, ACCEPT_SENTINEL));
    return true;
  } catch {
    return false;
  }
}

async function acceptProposals(
  dir: string,
  proposals: Proposal[],
  batchRecord?: BatchAcceptanceRecord,
): Promise<void> {
  if (!(await hasRexDir(dir))) {
    throw new CLIError(
      `Rex directory not found in ${dir}`,
      "Run 'n-dx init' to set up the project, or 'rex init' if using rex standalone.",
    );
  }

  // Check for stale sentinel from a crashed previous accept
  if (await checkSentinel(dir)) {
    warn(
      "Detected incomplete previous accept (stale sentinel file).\n" +
      "The PRD may contain partially-added proposals. Review with 'rex status'\n" +
      "before continuing. Clearing stale sentinel and pending proposals.",
    );
    await clearSentinel(dir);
    await clearPending(dir);
    return;
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  // Write sentinel before starting — if we crash between here and
  // clearSentinel(), the next run will detect the inconsistency.
  await writeSentinel(dir);

  let addedCount = 0;

  let completedCount = 0;
  for (const p of proposals) {
    const epicId = randomUUID();
    const epicStatus = p.epic.status ?? "pending";
    const epicItem: PRDItem = {
      id: epicId,
      title: p.epic.title,
      level: "epic",
      status: epicStatus,
      source: p.epic.source,
      description: p.epic.description,
      ...(epicStatus === "completed" && { completedAt: new Date().toISOString() }),
    };
    await store.addItem(epicItem);
    addedCount++;
    if (epicStatus === "completed") completedCount++;

    for (const f of p.features) {
      const featureId = randomUUID();
      const featureStatus = f.status ?? "pending";
      const featureItem: PRDItem = {
        id: featureId,
        title: f.title,
        level: "feature",
        status: featureStatus,
        source: f.source,
        description: f.description,
        ...(featureStatus === "completed" && { completedAt: new Date().toISOString() }),
      };
      await store.addItem(featureItem, epicId);
      addedCount++;
      if (featureStatus === "completed") completedCount++;

      for (const t of f.tasks) {
        const taskId = randomUUID();
        const taskStatus = t.status ?? "pending";
        const taskItem: PRDItem = {
          id: taskId,
          title: t.title,
          level: "task",
          status: taskStatus,
          source: t.source,
          description: t.description,
          acceptanceCriteria: t.acceptanceCriteria,
          priority: t.priority as PRDItem["priority"],
          tags: t.tags,
          // LoE fields — optional, present when the LLM included estimates
          ...(t.loe !== undefined && { loe: t.loe }),
          ...(t.loeRationale !== undefined && { loeRationale: t.loeRationale }),
          ...(t.loeConfidence !== undefined && { loeConfidence: t.loeConfidence }),
          ...(taskStatus === "completed" && { completedAt: new Date().toISOString() }),
        };
        await store.addItem(taskItem, featureId);
        addedCount++;
        if (taskStatus === "completed") completedCount++;
      }
    }
  }

  // Log batch acceptance with detailed record when available
  const logDetail = batchRecord
    ? JSON.stringify({
        ...batchRecord,
        addedItemCount: addedCount,
      })
    : `Added ${addedCount} items from analysis`;

  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "analyze_accept",
    detail: logDetail,
  });

  await clearPending(dir);
  await clearSentinel(dir);
  await syncFolderTree(rexDir, store);

  // Show formatted summary when batch record is available, else simple message
  if (batchRecord) {
    const { formatBatchSummary } = await import("./chunked-review.js");
    // Update the record with actual item count from insertion
    const finalRecord = { ...batchRecord, acceptedItemCount: addedCount };
    result(formatBatchSummary(finalRecord));
  } else {
    result(`Added ${addedCount} items to PRD.`);
  }

  if (completedCount > 0) {
    const pendingCount = addedCount - completedCount;
    info(`Baseline: ${completedCount} items marked completed (existing code), ${pendingCount} pending (gaps/improvements).`);
  }
}

/**
 * Output flow trace for `ndx plan` / `rex analyze`:
 *
 * [sourcevision analyze subprocess — already finished when rex starts]
 *   Phases 1–6 each print progress via info()
 *   "Done." ← last sourcevision output; console.log, no buffering
 *
 * [orchestration: cli.js handlePlan spawns rex analyze — ~50–200 ms, no output]
 *
 * [rex analyze — this function]
 *   initLLMClients  → prints vendor/model header + auth note  ← first rex output
 *   resolveModel    → reads .rex/config.json                  ← silent, ~5 ms
 *   runBudgetPreflight → reads PRD, may print warnings        ← usually silent
 *   loadExistingItems  → reads .rex/prd.json                  ← silent, ~10–100 ms
 *   generateProposals → runScannerMode:
 *     parallel scans (scanTests, scanDocs, scanSourceVision,
 *                     scanPackageJson, scanGoMod)              ← silent GAP #1
 *                                                                dominant cost: 500 ms–10 s
 *     "Scanning project…" spinner                             ← spinner covers gap #1
 *     deduplicateScanResults + reconcile                      ← silent, ~10–50 ms
 *     "Building proposals…" spinner (LLM call)               ← spinner covers LLM wait
 *     "Proposals refined by LLM."
 *     "Scanned: X test files, …"
 *     "Found: N proposals (K new, …)"
 *   postProcessProposals:
 *     "Checking proposal granularity…" spinner (LLM call)
 *     "Checking task sizes…" spinner (LLM call)
 *   displayAndReviewProposals → prints proposal tree
 *   logUsageAndCache → "Token usage: …"
 *   handleAcceptance → acceptance prompt or summary
 *
 * Stdout notes:
 *   All info() calls use console.log → synchronous write, no user-space buffering.
 *   Spinners write to process.stderr (ora) — separate fd, never interleaved with stdout.
 *   --quiet suppresses all info() and spinners; --format=json suppresses spinners.
 */
export async function cmdAnalyze(
  dir: string,
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before reading/writing PRD
  await ensureLegacyPrdMigrated(dir);

  const accept = flags.accept === "true";
  const noLlm = flags["no-llm"] === "true";

  const llmConfig = await initLLMClients(dir, noLlm, flags.format);

  const filePaths: string[] = multiFlags.file ?? (flags.file ? [flags.file] : []);
  const chunkSize = flags["chunk-size"] !== undefined
    ? parseIntSafe(flags["chunk-size"], "chunk-size", { min: 1 })
    : undefined;

  const model = await resolveModel(dir, flags.model);

  await runBudgetPreflight(dir);

  // --accept with no other flags: replay cached proposals
  if (accept && filePaths.length === 0 && !flags.format) {
    if (await replayCachedProposals(dir)) return;
  }

  const existing = await loadExistingItems(dir);

  let { proposals, tokenUsage } = await generateProposals(
    dir, existing, filePaths, flags, { lite: flags.lite === "true", noLlm, model, accept },
  );
  if (!proposals) return; // early return from JSON output or no proposals

  proposals = await postProcessProposals(proposals, tokenUsage, noLlm, dir, model);

  const loeConfig = await loadLoEConfig(dir, noLlm);
  const thresholdWeeks = loeConfig?.taskThresholdWeeks ?? LOE_DEFAULTS.taskThresholdWeeks;

  proposals = await displayAndReviewProposals(
    dir, proposals, existing, accept, thresholdWeeks,
  );

  await logUsageAndCache(dir, tokenUsage, llmConfig, model, proposals);

  await handleAcceptance(dir, proposals, { accept, chunkSize, model, thresholdWeeks });
}

// ── Phase functions ───────────────────────────────────────────────────

/** Initialize LLM clients and display auth info. */
async function initLLMClients(
  dir: string,
  noLlm: boolean,
  format: string | undefined,
): Promise<Awaited<ReturnType<typeof loadLLMConfig>>> {
  const rexConfigDir = join(dir, REX_DIR);
  const llmConfig = await loadLLMConfig(rexConfigDir);
  setLLMConfig(llmConfig);
  const claudeConfig = await loadClaudeConfig(rexConfigDir);
  setClaudeConfig(claudeConfig);

  if (!noLlm) {
    const vendor = getLLMVendor();
    if (vendor) {
      printVendorModelHeader(vendor, llmConfig, { format });
    }
    if (format !== "json") {
      const authMode = getAuthMode();
      if (authMode === "api") {
        info("Using direct API authentication.");
      }
    }
  }

  return llmConfig;
}

/** Resolve model from --model flag, rex config, or default. */
async function resolveModel(dir: string, flagModel?: string): Promise<string | undefined> {
  if (flagModel) return flagModel;
  if (await hasRexDir(dir)) {
    try {
      const rexDir = join(dir, REX_DIR);
      const store = await resolveStore(rexDir);
      const config = await store.loadConfig();
      const vendor = getLLMVendor() ?? "claude";
      const model = resolveVendorCompatibleRexModel(vendor, config.model);
      if (model) return model;
    } catch {
      // Config unreadable — fall through to default
    }
  }
  return undefined;
}

/** Run pre-flight budget check; warn or abort before expensive LLM calls. */
async function runBudgetPreflight(dir: string): Promise<void> {
  if (!(await hasRexDir(dir))) return;

  const rexDir = join(dir, REX_DIR);
  const budgetResult = await preflightBudgetCheck(rexDir, dir);
  if (!budgetResult) return;

  const budgetLines = formatBudgetWarnings(budgetResult);
  if (budgetLines.length > 0) {
    for (const line of budgetLines) warn(line);
    warn("");
  }
  if (budgetResult.severity === "exceeded") {
    const store = await resolveStore(rexDir);
    const config = await store.loadConfig();
    if (config.budget?.abort) {
      throw new BudgetExceededError(budgetResult.warnings);
    }
  }
}

/** Replay cached proposals if available. Returns true if accepted and done. */
async function replayCachedProposals(dir: string): Promise<boolean> {
  const cached = await loadPending(dir);
  if (!cached || cached.length === 0) return false;

  info(`Accepting ${cached.length} cached proposals...`);
  const { createReviewState, buildBatchRecord } = await import("./chunked-review.js");
  const state = createReviewState(cached, cached.length);
  for (let i = 0; i < cached.length; i++) state.accepted.add(i);
  const batchRecord = buildBatchRecord(state, "cached");
  await acceptProposals(dir, cached, batchRecord);
  return true;
}

/** Load existing PRD items for deduplication. */
async function loadExistingItems(dir: string): Promise<PRDItem[]> {
  if (!(await hasRexDir(dir))) return [];
  try {
    const rexDir = join(dir, REX_DIR);
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    return doc.items;
  } catch {
    return [];
  }
}

/** Generate proposals from file import, scanner mode, or guided spec. */
async function generateProposals(
  dir: string,
  existing: PRDItem[],
  filePaths: string[],
  flags: Record<string, string>,
  opts: { lite: boolean; noLlm: boolean; model?: string; accept: boolean },
): Promise<{ proposals: Proposal[] | null; tokenUsage: AnalyzeTokenUsage }> {
  let proposals: Proposal[];
  let tokenUsage = emptyAnalyzeTokenUsage();

  if (filePaths.length > 0) {
    const resolved = filePaths.map((fp) => resolve(dir, fp));
    if (flags.format !== "json") {
      const label = resolved.length === 1 ? "file" : "files";
      info(`Importing from ${label}: ${resolved.join(", ")}`);
    }

    try {
      const reasonResult = await reasonFromFiles(resolved, existing, opts.model);
      proposals = reasonResult.proposals;
      tokenUsage = reasonResult.tokenUsage;
    } catch (err) {
      throw new CLIError(
        `Failed to analyze file: ${(err as Error).message}`,
        "Check the file path and format, then try again.",
      );
    }

    if (flags.format === "json") {
      result(JSON.stringify({ proposals, tokenUsage }, null, 2));
      return { proposals: null, tokenUsage };
    }

    const fileLabel = resolved.length === 1 ? "file" : `${resolved.length} files`;
    info(`Extracted ${proposals.length} epics from ${fileLabel}.`);
  } else {
    const scanResult = await runScannerMode(dir, existing, {
      lite: opts.lite, noLlm: opts.noLlm, model: opts.model,
      accept: opts.accept, formatJson: flags.format === "json",
    });
    proposals = scanResult.proposals;
    tokenUsage = scanResult.tokenUsage;
    if (scanResult.earlyReturn) return { proposals: null, tokenUsage };
  }

  // Try guided spec if no proposals found
  if (proposals.length === 0) {
    const guided = flags.guided === "true";
    if ((existing.length === 0 || guided) && !opts.noLlm) {
      if (process.stdin.isTTY) {
        const { runGuidedSpec } = await import("../../analyze/guided.js");
        const guidedResult = await runGuidedSpec(dir, opts.model);
        proposals = guidedResult.proposals;
        tokenUsage = guidedResult.tokenUsage;
      } else if (!guided) {
        result("No new proposals found.");
        info("Hint: Run 'n-dx plan --guided' interactively to build your initial spec.");
        return { proposals: null, tokenUsage };
      } else {
        throw new CLIError(
          "Guided spec mode requires an interactive terminal.",
          "Run this command in a terminal (not piped).",
        );
      }
    }
    if (proposals.length === 0) {
      result("No new proposals found.");
      return { proposals: null, tokenUsage };
    }
  }

  return { proposals, tokenUsage };
}

/** Accumulate token usage from a sub-pass into the running total. */
function accumulateTokenUsage(
  total: AnalyzeTokenUsage,
  addition: AnalyzeTokenUsage,
): void {
  total.calls += addition.calls;
  total.inputTokens += addition.inputTokens;
  total.outputTokens += addition.outputTokens;
  if (addition.cacheCreationInputTokens) {
    total.cacheCreationInputTokens =
      (total.cacheCreationInputTokens ?? 0) + addition.cacheCreationInputTokens;
  }
  if (addition.cacheReadInputTokens) {
    total.cacheReadInputTokens =
      (total.cacheReadInputTokens ?? 0) + addition.cacheReadInputTokens;
  }
}

/** Load LoE config from rex store. */
async function loadLoEConfig(dir: string, noLlm: boolean): Promise<LoEConfig | undefined> {
  if (noLlm || !(await hasRexDir(dir))) return undefined;
  try {
    const rexDir = join(dir, REX_DIR);
    const store = await resolveStore(rexDir);
    const config = await store.loadConfig();
    return config.loe;
  } catch {
    return undefined;
  }
}

/** Apply consolidation guard and LoE decomposition post-processing. */
async function postProcessProposals(
  proposals: Proposal[],
  tokenUsage: AnalyzeTokenUsage,
  noLlm: boolean,
  dir: string,
  model: string | undefined,
): Promise<Proposal[]> {
  if (noLlm) return proposals;

  const loeConfig = await loadLoEConfig(dir, noLlm);

  // Consolidation guard: reduce over-granular LLM output
  const guardSpin = startSpinner("Checking proposal granularity…");
  const guardResult = await applyConsolidationGuard(proposals, loeConfig, model);
  guardSpin.stop();
  if (guardResult.triggered) {
    proposals = guardResult.proposals;
    accumulateTokenUsage(tokenUsage, guardResult.tokenUsage);

    if (guardResult.reduced) {
      info(
        `Consolidation guard: reduced from ${guardResult.originalTaskCount} to ${guardResult.finalTaskCount} tasks (ceiling: ${guardResult.ceiling}).`,
      );
    } else if (guardResult.warning) {
      warn(guardResult.warning);
    }
  }

  // LoE decomposition: break down oversized tasks
  const decomposeSpin = startSpinner("Checking task sizes…");
  const decompositionResult = await applyDecompositionPass(proposals, loeConfig, model);
  decomposeSpin.stop();
  if (decompositionResult.decomposed.length > 0) {
    proposals = decompositionResult.proposals;
    accumulateTokenUsage(tokenUsage, decompositionResult.tokenUsage);
    info(
      `Decomposed ${decompositionResult.decomposed.length} oversized task${decompositionResult.decomposed.length === 1 ? "" : "s"} (LoE exceeded threshold).`,
    );
  }

  return proposals;
}

/** Display proposals, run decomposition review, and show token usage. */
async function displayAndReviewProposals(
  dir: string,
  proposals: Proposal[],
  existing: PRDItem[],
  accept: boolean,
  thresholdWeeks: number,
): Promise<Proposal[]> {
  if (existing.length > 0) {
    info(formatDiff(proposals, existing));
  } else {
    info(formatProposals(proposals, thresholdWeeks));
  }
  info("");

  // Decomposition review: let user choose how to handle decomposed tasks
  const { countDecomposedTasks } = await import("./decomposition-review.js");
  if (countDecomposedTasks(proposals) > 0) {
    const {
      autoResolveDecompositions,
      runDecompositionReview,
      formatDecompositionSummary,
    } = await import("./decomposition-review.js");

    const decompositionResult = (accept || !process.stdin.isTTY)
      ? await autoResolveDecompositions(proposals)
      : await runDecompositionReview(proposals);

    proposals = decompositionResult.proposals;
    const summaryLine = formatDecompositionSummary(decompositionResult.summary);
    if (summaryLine) {
      info(summaryLine);
      info("");
    }
  }

  return proposals;
}

/** Log token usage and cache proposals for later acceptance. */
async function logUsageAndCache(
  dir: string,
  tokenUsage: AnalyzeTokenUsage,
  llmConfig: Awaited<ReturnType<typeof loadLLMConfig>>,
  model: string | undefined,
  proposals: Proposal[],
): Promise<void> {
  const usageLine = formatTokenUsage(tokenUsage);
  if (usageLine) {
    info(`Token usage: ${usageLine}`);
  }

  if (await hasRexDir(dir)) {
    const rexDir = join(dir, REX_DIR);
    const store = await resolveStore(rexDir);

    if (tokenUsage.calls > 0) {
      const metadata = resolveAnalyzeTokenEventMetadata(llmConfig, model);
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "analyze_token_usage",
        detail: JSON.stringify({
          ...tokenUsage,
          vendor: metadata.vendor,
          model: metadata.model,
        }),
      });
    }

    await savePending(dir, proposals);
  }
}

// ── Extracted phases ──────────────────────────────────────────────────

interface ScannerResult {
  proposals: Proposal[];
  tokenUsage: AnalyzeTokenUsage;
  earlyReturn: boolean;
}

/** Run all scanners, reconcile results, optionally refine with LLM. */
async function runScannerMode(
  dir: string,
  existing: PRDItem[],
  opts: { lite: boolean; noLlm: boolean; model?: string; accept: boolean; formatJson: boolean },
): Promise<ScannerResult> {
  const { lite, noLlm, model, accept, formatJson } = opts;
  const scanOpts = { lite };

  // GAP #1: parallel file-system scans + reconcile — dominant silent cost (500 ms–10 s+
  // depending on codebase size). Spinner covers this gap; suppressed in --format=json.
  const scanSpin = formatJson ? null : startSpinner("Scanning project…");
  const [testResults, docResults, svScan, pkgResults, goModResults] = await Promise.all([
    scanTests(dir, scanOpts),
    scanDocs(dir, scanOpts),
    scanSourceVision(dir),
    scanPackageJson(dir, scanOpts),
    scanGoMod(dir, scanOpts),
  ]);
  const svResults = svScan.results;

  const rawResults: ScanResult[] = [...testResults, ...docResults, ...svResults, ...pkgResults, ...goModResults];
  const allResults = deduplicateScanResults(rawResults);

  const testFiles = new Set(testResults.map((r) => r.sourceFile)).size;
  const docFiles = new Set(docResults.map((r) => r.sourceFile)).size;
  const svZones = svResults.filter((r) => r.kind === "feature" && r.source === "sourcevision").length;
  const svStale = svScan.staleCount;
  const pkgFiles = new Set(pkgResults.map((r) => r.sourceFile)).size;

  const { results: newResults, stats, updateCandidates = [] } = reconcile(
    allResults,
    existing,
    { detectUpdates: existing.length > 0 },
  );
  scanSpin?.stop();

  let proposals: Proposal[];
  let tokenUsage = emptyAnalyzeTokenUsage();

  if (!noLlm) {
    const spin = formatJson ? null : startSpinner("Building proposals…");
    try {
      const reasonResult = await reasonFromScanResults(newResults, existing, { dir, model });
      proposals = reasonResult.proposals;
      tokenUsage = reasonResult.tokenUsage;
      spin?.stop();
      if (!formatJson) {
        info("Proposals refined by LLM.");
      }
    } catch {
      spin?.stop();
      proposals = buildProposals(newResults);
    }
  } else {
    proposals = buildProposals(newResults);
  }

  if (formatJson) {
    result(
      JSON.stringify(
        { scanned: { testFiles, docFiles, svZones, pkgFiles, staleFindings: svStale }, stats, proposals, updateCandidates, tokenUsage },
        null,
        2,
      ),
    );
    return { proposals, tokenUsage, earlyReturn: true };
  }

  info(
    `Scanned: ${testFiles} test files, ${docFiles} docs, ${svZones} sourcevision zones, ${pkgFiles} package.json files`,
  );
  if (svStale > 0) {
    info(`Skipped: ${svStale} stale finding${svStale === 1 ? "" : "s"} (referenced files no longer exist)`);
  }
  info(
    `Found: ${stats.total} proposals (${stats.newCount} new, ${stats.alreadyTracked} already tracked)`,
  );

  // Show update candidates for existing items with richer info
  if (updateCandidates.length > 0) {
    info(`\n${updateCandidates.length} existing item${updateCandidates.length === 1 ? "" : "s"} could be updated:`);
    for (const uc of updateCandidates) {
      info(`  ${uc.itemTitle} (${uc.itemId.slice(0, 8)})`);
      info(`    ${uc.field}: ${uc.current.slice(0, 60)} → ${uc.proposed.slice(0, 60)}`);
    }

    // Apply update candidates if --accept and we have a store
    if (accept && await hasRexDir(dir)) {
      const rexDir = join(dir, REX_DIR);
      const store = await resolveStore(rexDir);
      let updatedCount = 0;
      for (const uc of updateCandidates) {
        const updates: Partial<PRDItem> = {};
        if (uc.field === "description") {
          updates.description = uc.proposed;
        } else if (uc.field === "acceptanceCriteria") {
          updates.acceptanceCriteria = uc.proposed.split("; ");
        }
        await store.updateItem(uc.itemId, updates);
        updatedCount++;
      }
      if (updatedCount > 0) {
        info(`Updated ${updatedCount} existing item${updatedCount === 1 ? "" : "s"} with richer info.`);
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "analyze_update",
          detail: `Updated ${updatedCount} items: ${updateCandidates.map((uc) => uc.itemTitle).join(", ")}`,
        });
      }
    }
  }

  info("");
  return { proposals, tokenUsage, earlyReturn: false };
}

/** Handle proposal acceptance: auto, interactive, or deferred. */
async function handleAcceptance(
  dir: string,
  proposals: Proposal[],
  opts: { accept: boolean; chunkSize?: number; model?: string; thresholdWeeks?: number },
): Promise<void> {
  const { accept, chunkSize, model, thresholdWeeks } = opts;

  if (accept) {
    // Non-interactive: accept immediately with auto-accept batch record
    const { createReviewState, buildBatchRecord } = await import("./chunked-review.js");
    const state = createReviewState(proposals, proposals.length);
    for (let i = 0; i < proposals.length; i++) state.accepted.add(i);
    const batchRecord = buildBatchRecord(state, "auto");
    await acceptProposals(dir, proposals, batchRecord);
  } else if (process.stdin.isTTY) {
    // Interactive: chunked review for multiple proposals
    const { runChunkedReview } = await import("./chunked-review.js");
    const { adjustGranularity, assessGranularity, formatAssessment } = await import("../../analyze/index.js");
    const granularityHandler = async (
      targetProposals: Proposal[],
      direction: "break_down" | "consolidate",
    ): Promise<Proposal[]> => {
      const r = await adjustGranularity(targetProposals, direction, model);
      return r.proposals;
    };
    const assessmentHandler = async (
      targetProposals: Proposal[],
    ): Promise<{ assessments: import("./chunked-review.js").ProposalAssessment[]; formatted: string }> => {
      const r = await assessGranularity(targetProposals, model);
      return {
        assessments: r.assessments,
        formatted: formatAssessment(r.assessments),
      };
    };
    const { accepted, remaining, batchRecord } = await runChunkedReview(proposals, chunkSize, granularityHandler, assessmentHandler, undefined, thresholdWeeks);

    if (accepted.length > 0) {
      await acceptProposals(dir, accepted, batchRecord);
    } else {
      // Log the rejection decision even when nothing was accepted
      if (await hasRexDir(dir)) {
        const rexDir = join(dir, REX_DIR);
        const store = await resolveStore(rexDir);
        await store.appendLog({
          timestamp: new Date().toISOString(),
          event: "analyze_reject",
          detail: JSON.stringify(batchRecord),
        });
      }
    }

    // Cache remaining proposals for later acceptance
    if (remaining.length > 0) {
      await savePending(dir, remaining);
      info(
        `${remaining.length} proposal(s) saved. Run \`rex analyze --accept\` to accept later.`,
      );
    }
  } else {
    // Non-interactive without --accept: just show
    info("Proposals saved. Run `rex analyze --accept` to accept later.");
  }
}

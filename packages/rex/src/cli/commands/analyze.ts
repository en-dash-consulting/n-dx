import { join, resolve } from "node:path";
import { access, writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { CLIError, BudgetExceededError } from "../errors.js";
import { parseIntSafe } from "../validate-input.js";
import { info, warn, result } from "../output.js";
import {
  preflightBudgetCheck,
  formatBudgetWarnings,
} from "../../core/token-usage.js";
import {
  scanTests,
  scanDocs,
  scanSourceVision,
  scanPackageJson,
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
} from "../../analyze/index.js";
import type { ScanResult, Proposal } from "../../analyze/index.js";
import type { PRDItem, PRDDocument, AnalyzeTokenUsage } from "../../schema/index.js";
import type { BatchAcceptanceRecord } from "./chunked-review.js";
import { loadClaudeConfig, loadLLMConfig } from "../../store/project-config.js";

const PENDING_FILE = "pending-proposals.json";
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

function formatProposals(proposals: Proposal[]): string {
  const lines: string[] = [];
  for (const p of proposals) {
    lines.push(`[epic] ${p.epic.title} (from: ${p.epic.source})`);
    for (const f of p.features) {
      lines.push(`  [feature] ${f.title} (from: ${f.source})`);
      for (const t of f.tasks) {
        const pri = t.priority ? ` [${t.priority}]` : "";
        lines.push(`    [task] ${t.title}${pri} (from: ${t.sourceFile})`);
      }
    }
  }
  return lines.join("\n");
}

async function savePending(dir: string, proposals: Proposal[]): Promise<void> {
  const filePath = join(dir, REX_DIR, PENDING_FILE);
  await writeFile(filePath, JSON.stringify(proposals, null, 2));
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

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  let addedCount = 0;

  for (const p of proposals) {
    const epicId = randomUUID();
    const epicItem: PRDItem = {
      id: epicId,
      title: p.epic.title,
      level: "epic",
      status: "pending",
      source: p.epic.source,
      description: p.epic.description,
    };
    await store.addItem(epicItem);
    addedCount++;

    for (const f of p.features) {
      const featureId = randomUUID();
      const featureItem: PRDItem = {
        id: featureId,
        title: f.title,
        level: "feature",
        status: "pending",
        source: f.source,
        description: f.description,
      };
      await store.addItem(featureItem, epicId);
      addedCount++;

      for (const t of f.tasks) {
        const taskId = randomUUID();
        const taskItem: PRDItem = {
          id: taskId,
          title: t.title,
          level: "task",
          status: "pending",
          source: t.source,
          description: t.description,
          acceptanceCriteria: t.acceptanceCriteria,
          priority: t.priority as PRDItem["priority"],
          tags: t.tags,
        };
        await store.addItem(taskItem, featureId);
        addedCount++;
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

  // Show formatted summary when batch record is available, else simple message
  if (batchRecord) {
    const { formatBatchSummary } = await import("./chunked-review.js");
    // Update the record with actual item count from insertion
    const finalRecord = { ...batchRecord, acceptedItemCount: addedCount };
    result(formatBatchSummary(finalRecord));
  } else {
    result(`Added ${addedCount} items to PRD.`);
  }
}

export async function cmdAnalyze(
  dir: string,
  flags: Record<string, string>,
  multiFlags: Record<string, string[]> = {},
): Promise<void> {
  const lite = flags.lite === "true";
  const accept = flags.accept === "true";
  const noLlm = flags["no-llm"] === "true";

  // Load unified LLM config and initialize the client abstraction layer
  const rexConfigDir = join(dir, REX_DIR);
  const llmConfig = await loadLLMConfig(rexConfigDir);
  setLLMConfig(llmConfig);
  // Backward compatibility for paths still reading claude.* defaults
  const claudeConfig = await loadClaudeConfig(rexConfigDir);
  setClaudeConfig(claudeConfig);

  // Display which authentication method will be used for LLM calls
  if (!noLlm && flags.format !== "json") {
    const vendor = getLLMVendor();
    if (vendor) info(`Using ${vendor} for reasoning.`);
    const authMode = getAuthMode();
    if (authMode === "api") {
      info("Using direct API authentication.");
    }
  }

  // Support multiple --file flags; fall back to single flags.file for compat
  const filePaths: string[] = multiFlags.file ?? (flags.file ? [flags.file] : []);

  // Parse --chunk-size: must be a positive integer when provided
  const chunkSize = flags["chunk-size"] !== undefined
    ? parseIntSafe(flags["chunk-size"], "chunk-size", { min: 1 })
    : undefined;

  // Resolve model: --model flag → config.model → DEFAULT_MODEL
  let model: string | undefined = flags.model;
  if (!model && await hasRexDir(dir)) {
    try {
      const rexDir = join(dir, REX_DIR);
      const store = await resolveStore(rexDir);
      const config = await store.loadConfig();
      if (config.model) {
        model = config.model;
      }
    } catch {
      // Config unreadable — fall through to default
    }
  }

  // Pre-flight budget check — warn or abort before expensive LLM calls
  if (await hasRexDir(dir)) {
    const rexDir = join(dir, REX_DIR);
    const budgetResult = await preflightBudgetCheck(rexDir, dir);
    if (budgetResult) {
      const budgetLines = formatBudgetWarnings(budgetResult);
      if (budgetLines.length > 0) {
        for (const line of budgetLines) {
          warn(line);
        }
        warn("");
      }
      if (budgetResult.severity === "exceeded") {
        // Load config to check abort setting
        const store = await resolveStore(rexDir);
        const config = await store.loadConfig();
        if (config.budget?.abort) {
          throw new BudgetExceededError(budgetResult.warnings);
        }
      }
    }
  }

  // --accept with no other flags: replay cached proposals
  if (accept && filePaths.length === 0 && !flags.format) {
    const cached = await loadPending(dir);
    if (cached && cached.length > 0) {
      info(`Accepting ${cached.length} cached proposals...`);
      const { createReviewState, buildBatchRecord } = await import("./chunked-review.js");
      const state = createReviewState(cached, cached.length);
      for (let i = 0; i < cached.length; i++) state.accepted.add(i);
      const batchRecord = buildBatchRecord(state, "cached");
      await acceptProposals(dir, cached, batchRecord);
      return;
    }
    // No cache — fall through to generate fresh proposals
  }

  // Load existing PRD items for deduplication
  let existing: PRDItem[] = [];
  if (await hasRexDir(dir)) {
    try {
      const rexDir = join(dir, REX_DIR);
      const store = await resolveStore(rexDir);
      const doc = await store.loadDocument();
      existing = doc.items;
    } catch {
      // No valid PRD yet, treat as empty
    }
  }

  let proposals: Proposal[];
  let tokenUsage = emptyAnalyzeTokenUsage();

  if (filePaths.length > 0) {
    // --file mode: import from document(s) via structured parsing or LLM
    const resolved = filePaths.map((fp) => resolve(dir, fp));

    if (flags.format !== "json") {
      const label = resolved.length === 1 ? "file" : "files";
      info(`Importing from ${label}: ${resolved.join(", ")}`);
    }

    try {
      const reasonResult = await reasonFromFiles(resolved, existing, model);
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
      return;
    }

    const fileLabel = resolved.length === 1 ? "file" : `${resolved.length} files`;
    info(`Extracted ${proposals.length} epics from ${fileLabel}.`);
  } else {
    // Scanner mode: run all scanners, reconcile, and optionally refine with LLM
    const scanResult = await runScannerMode(dir, existing, { lite, noLlm, model, accept, formatJson: flags.format === "json" });
    proposals = scanResult.proposals;
    tokenUsage = scanResult.tokenUsage;
    if (scanResult.earlyReturn) return;
  }

  if (proposals.length === 0) {
    const guided = flags.guided === "true";
    if ((existing.length === 0 || guided) && !noLlm) {
      if (process.stdin.isTTY) {
        const { runGuidedSpec } = await import("../../analyze/guided.js");
        const guidedResult = await runGuidedSpec(dir, model);
        proposals = guidedResult.proposals;
        tokenUsage = guidedResult.tokenUsage;
      } else if (!guided) {
        result("No new proposals found.");
        info("Hint: Run 'n-dx plan --guided' interactively to build your initial spec.");
        return;
      } else {
        throw new CLIError(
          "Guided spec mode requires an interactive terminal.",
          "Run this command in a terminal (not piped).",
        );
      }
    }
    if (proposals.length === 0) {
      result("No new proposals found.");
      return;
    }
  }

  // Show diff view when existing PRD items are present, otherwise plain list
  if (existing.length > 0) {
    info(formatDiff(proposals, existing));
  } else {
    info(formatProposals(proposals));
  }
  info("");

  // Display token usage summary
  const usageLine = formatTokenUsage(tokenUsage);
  if (usageLine) {
    info(`Token usage: ${usageLine}`);
  }

  // Log token usage to execution log
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

    // Cache proposals so they can be accepted later without re-running
    await savePending(dir, proposals);
  }

  await handleAcceptance(dir, proposals, { accept, chunkSize, model });
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
  const [testResults, docResults, svResults, pkgResults] = await Promise.all([
    scanTests(dir, scanOpts),
    scanDocs(dir, scanOpts),
    scanSourceVision(dir),
    scanPackageJson(dir, scanOpts),
  ]);

  const rawResults: ScanResult[] = [...testResults, ...docResults, ...svResults, ...pkgResults];
  const allResults = deduplicateScanResults(rawResults);

  const testFiles = new Set(testResults.map((r) => r.sourceFile)).size;
  const docFiles = new Set(docResults.map((r) => r.sourceFile)).size;
  const svZones = svResults.filter((r) => r.kind === "feature" && r.source === "sourcevision").length;
  const pkgFiles = new Set(pkgResults.map((r) => r.sourceFile)).size;

  const { results: newResults, stats, updateCandidates = [] } = reconcile(
    allResults,
    existing,
    { detectUpdates: existing.length > 0 },
  );

  let proposals: Proposal[];
  let tokenUsage = emptyAnalyzeTokenUsage();

  if (!noLlm) {
    try {
      const reasonResult = await reasonFromScanResults(newResults, existing, { dir, model });
      proposals = reasonResult.proposals;
      tokenUsage = reasonResult.tokenUsage;
      if (!formatJson) {
        info("Proposals refined by LLM.");
      }
    } catch {
      proposals = buildProposals(newResults);
    }
  } else {
    proposals = buildProposals(newResults);
  }

  if (formatJson) {
    result(
      JSON.stringify(
        { scanned: { testFiles, docFiles, svZones, pkgFiles }, stats, proposals, updateCandidates, tokenUsage },
        null,
        2,
      ),
    );
    return { proposals, tokenUsage, earlyReturn: true };
  }

  info(
    `Scanned: ${testFiles} test files, ${docFiles} docs, ${svZones} sourcevision zones, ${pkgFiles} package.json files`,
  );
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
  opts: { accept: boolean; chunkSize?: number; model?: string },
): Promise<void> {
  const { accept, chunkSize, model } = opts;

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
    const { accepted, remaining, batchRecord } = await runChunkedReview(proposals, chunkSize, granularityHandler, assessmentHandler);

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

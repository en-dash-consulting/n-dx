import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import type { PRDStore } from "../../store/index.js";
import type { PRDDocument } from "../../schema/index.js";
import {
  detectReorganizations,
  formatReorganizationPlan,
} from "../../core/reorganize.js";
import type { ReorganizationProposal, ReorganizationPlan } from "../../core/reorganize.js";
import {
  applyProposals,
  formatApplyResult,
} from "../../core/reorganize-executor.js";
import { applyReshape } from "../../core/reshape.js";
import type { ReshapeProposal } from "../../core/reshape.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result, startSpinner } from "../output.js";
import { loadClaudeConfig, loadLLMConfig } from "../../store/project-config.js";

// ── LLM analysis ──────────────────────────────────────────────────────

async function runLlmAnalysis(
  rexDir: string,
  dir: string,
  items: PRDDocument["items"],
  structuralProposals: ReorganizationProposal[],
  flags: Record<string, string>,
): Promise<ReshapeProposal[]> {
  try {
    const { setLLMConfig, setClaudeConfig } = await import("../../analyze/reason.js");
    const { reasonForReshape } = await import("../../analyze/reshape-reason.js");

    const llmConfig = await loadLLMConfig(rexDir);
    setLLMConfig(llmConfig);
    const claudeConfig = await loadClaudeConfig(rexDir);
    setClaudeConfig(claudeConfig);

    const spinner = startSpinner("Running LLM analysis...");
    try {
      const { proposals } = await reasonForReshape(items, {
        dir,
        model: flags.model,
      });
      const deduped = deduplicateAgainstProgrammatic(structuralProposals, proposals);
      spinner.stop(`LLM analysis complete — ${deduped.length} proposal${deduped.length === 1 ? "" : "s"}.`);
      return deduped;
    } catch (err) {
      spinner.stop(`LLM analysis failed: ${(err as Error).message}`);
      return [];
    }
  } catch (err) {
    info(`LLM analysis skipped: ${(err as Error).message}`);
    return [];
  }
}

// ── Display ───────────────────────────────────────────────────────────

async function displayProposals(
  plan: ReorganizationPlan,
  reshapeProposals: ReshapeProposal[],
  items: PRDDocument["items"],
): Promise<void> {
  if (plan.proposals.length > 0) {
    result(formatReorganizationPlan(plan));
  }
  if (reshapeProposals.length > 0) {
    const { formatReshapeProposal } = await import("../../analyze/reshape-reason.js");
    info("");
    info("─── LLM Proposals ───");
    info("");
    for (let i = 0; i < reshapeProposals.length; i++) {
      info(`  ${i + 1}. ${formatReshapeProposal(reshapeProposals[i], items)}`);
      info("");
    }
  }
}

// ── Structural proposal selection & application ───────────────────────

function selectStructuralProposals(
  plan: ReorganizationPlan,
  acceptFlag: string,
  isAcceptAll: boolean,
): ReorganizationProposal[] {
  if (isAcceptAll || acceptFlag === "true") {
    const lowRisk = plan.proposals.filter((p) => p.risk === "low");
    if (lowRisk.length === 0 && !isAcceptAll) {
      info("No low-risk structural proposals to apply. Use --accept=<ids> to apply specific proposals.");
    } else if (lowRisk.length > 0 && lowRisk.length < plan.proposals.length) {
      info(`\nApplying ${lowRisk.length} low-risk structural proposal${lowRisk.length === 1 ? "" : "s"} (skipping ${plan.proposals.length - lowRisk.length} higher-risk).`);
    }
    return lowRisk;
  }

  // --accept=1,3 — parse comma-separated IDs
  const ids = acceptFlag.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  if (ids.length === 0) {
    throw new CLIError(
      "Invalid --accept value.",
      "Usage: --accept (all low-risk), --accept=1,3 (specific IDs), --accept=all (all structural + all LLM)",
    );
  }
  const idSet = new Set(ids);
  const selected = plan.proposals.filter((p) => idSet.has(p.id));
  const missing = ids.filter((id) => !plan.proposals.some((p) => p.id === id));
  if (missing.length > 0) {
    info(`Warning: structural proposal IDs not found: ${missing.join(", ")}`);
  }
  return selected;
}

async function applyStructural(
  store: PRDStore,
  doc: PRDDocument,
  toApply: ReorganizationProposal[],
  isJson: boolean,
): Promise<number> {
  if (toApply.length === 0) return 0;

  info(`\nApplying ${toApply.length} structural proposal${toApply.length === 1 ? "" : "s"}...`);
  const applyResult = applyProposals(doc.items, toApply);
  if (applyResult.applied > 0) {
    await store.saveDocument(doc);
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "reorganize_applied",
      detail: `Applied ${applyResult.applied} structural reorganization proposals`,
    });
  }
  if (!isJson) {
    result(formatApplyResult(applyResult));
  }
  return applyResult.applied;
}

// ── LLM proposal selection & application ──────────────────────────────

function selectLlmProposals(
  reshapeProposals: ReshapeProposal[],
  acceptLlmFlag: string | undefined,
  isAcceptAll: boolean,
): ReshapeProposal[] {
  if (isAcceptAll || acceptLlmFlag === "true") {
    return reshapeProposals;
  }
  if (acceptLlmFlag) {
    const indices = acceptLlmFlag.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    const selected = indices
      .map((i) => reshapeProposals[i - 1])
      .filter((p): p is ReshapeProposal => p !== undefined);
    if (selected.length === 0) {
      info("No matching LLM proposals to apply.");
    }
    return selected;
  }
  return [];
}

async function applyLlm(
  store: PRDStore,
  doc: PRDDocument,
  toApply: ReshapeProposal[],
  structuralApplied: number,
  isJson: boolean,
): Promise<number> {
  if (toApply.length === 0) return 0;

  // Reload document if structural proposals were applied (to get updated tree)
  const targetDoc = structuralApplied > 0 ? await store.loadDocument() : doc;

  info(`\nApplying ${toApply.length} LLM proposal${toApply.length === 1 ? "" : "s"}...`);
  const reshapeResult = applyReshape(targetDoc.items, toApply);
  const applied = reshapeResult.applied.length;

  if (applied > 0) {
    await store.saveDocument(targetDoc);
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "reorganize_llm_applied",
      detail: `Applied ${applied} LLM reorganization proposals`,
    });
  }

  if (!isJson) {
    info(`Applied ${applied} LLM proposal${applied === 1 ? "" : "s"}${reshapeResult.errors.length > 0 ? `, ${reshapeResult.errors.length} failed` : ""}.`);
    for (const err of reshapeResult.errors) {
      info(`  Error: ${err.error}`);
    }
  }
  return applied;
}

// ── Main command ──────────────────────────────────────────────────────

/**
 * `rex reorganize [options] [dir]`
 *
 * Detect structural issues in the PRD and propose reorganizations.
 * Runs both programmatic detectors and LLM reasoning (unless --fast).
 *
 * - Default: detect + display proposals (structural + LLM)
 * - `--fast`: programmatic only (no LLM call)
 * - `--accept`: apply all low-risk structural proposals
 * - `--accept=1,3`: apply specific structural proposals by ID
 * - `--accept=all`: apply structural (low-risk) + all LLM proposals
 * - `--accept-llm`: apply all LLM proposals
 * - `--accept-llm=1,3`: apply specific LLM proposals by display index
 * - `--include-completed`: include completed items in analysis
 */
export async function cmdReorganize(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    throw new CLIError(
      "PRD is empty — nothing to reorganize.",
      "Run 'rex analyze' first to build your PRD.",
    );
  }

  const includeCompleted = flags["include-completed"] === "true";
  const fast = flags.fast === "true";
  const isJson = flags.format === "json";

  // Stage 1: Programmatic detectors
  info("Analyzing PRD structure...");
  const plan = detectReorganizations(doc.items, { includeCompleted });

  // Stage 2: LLM reasoning (unless --fast)
  const reshapeProposals = fast
    ? []
    : await runLlmAnalysis(rexDir, dir, doc.items, plan.proposals, flags);

  const hasStructural = plan.proposals.length > 0;
  const hasLlm = reshapeProposals.length > 0;

  if (!hasStructural && !hasLlm) {
    if (isJson) {
      result(JSON.stringify({ structural: { proposals: [], stats: plan.stats }, llm: [] }, null, 2));
    } else {
      result("No reorganization proposals — PRD structure looks good.");
    }
    return;
  }

  // Display proposals
  if (!isJson) {
    await displayProposals(plan, reshapeProposals, doc.items);
  }

  // Determine which proposals to apply
  const acceptFlag = flags.accept;
  const acceptLlmFlag = flags["accept-llm"];
  const isAcceptAll = acceptFlag === "all";

  if (acceptFlag === undefined && acceptLlmFlag === undefined) {
    // Detection only — show proposals and exit
    if (isJson) {
      result(JSON.stringify({
        structural: {
          proposals: plan.proposals.map(summarizeProposal),
          stats: plan.stats,
        },
        llm: reshapeProposals.map(summarizeReshapeProposal),
      }, null, 2));
    } else {
      const hints: string[] = [];
      if (hasStructural) hints.push("--accept to apply low-risk structural proposals");
      if (hasLlm) hints.push("--accept-llm to apply LLM proposals");
      if (hasStructural && hasLlm) hints.push("--accept=all for both");
      info(`\nRun with ${hints.join(", or ")}.`);
    }
    return;
  }

  // Apply structural proposals
  let structuralApplied = 0;
  if (acceptFlag !== undefined && hasStructural) {
    const toApply = selectStructuralProposals(plan, acceptFlag, isAcceptAll);
    structuralApplied = await applyStructural(store, doc, toApply, isJson);
  }

  // Apply LLM proposals
  let llmApplied = 0;
  if ((acceptLlmFlag !== undefined || isAcceptAll) && hasLlm) {
    const toApply = selectLlmProposals(reshapeProposals, acceptLlmFlag, isAcceptAll);
    llmApplied = await applyLlm(store, doc, toApply, structuralApplied, isJson);
  }

  // JSON output
  if (isJson) {
    result(JSON.stringify({
      structural: {
        proposals: plan.proposals.map(summarizeProposal),
        stats: plan.stats,
        applied: structuralApplied,
      },
      llm: reshapeProposals.map(summarizeReshapeProposal),
      llmApplied,
    }, null, 2));
  }
}

/**
 * Deduplicate LLM proposals against programmatic proposals.
 * Removes LLM proposals that overlap with programmatic ones
 * (same item IDs involved in similar operations).
 */
function deduplicateAgainstProgrammatic(
  structural: ReorganizationProposal[],
  llm: ReshapeProposal[],
): ReshapeProposal[] {
  // Build a set of item IDs already covered by structural proposals
  const structuralItemIds = new Set<string>();
  for (const p of structural) {
    for (const id of p.items) {
      structuralItemIds.add(id);
    }
  }

  return llm.filter((proposal) => {
    const action = proposal.action;
    switch (action.action) {
      case "merge":
        // Skip if all involved items are already in structural proposals
        return !([action.survivorId, ...action.mergedIds].every((id) => structuralItemIds.has(id)));
      case "reparent":
        return !structuralItemIds.has(action.itemId);
      case "obsolete":
        return !structuralItemIds.has(action.itemId);
      case "update":
        return !structuralItemIds.has(action.itemId);
      case "split":
        return !structuralItemIds.has(action.sourceId);
      default:
        return true;
    }
  });
}

function summarizeProposal(p: ReorganizationProposal): Record<string, unknown> {
  return {
    id: p.id,
    type: p.type,
    description: p.description,
    risk: p.risk,
    confidence: p.confidence,
    items: p.items,
  };
}

function summarizeReshapeProposal(p: ReshapeProposal): Record<string, unknown> {
  return {
    id: p.id,
    action: p.action.action,
    reason: p.action.reason,
  };
}

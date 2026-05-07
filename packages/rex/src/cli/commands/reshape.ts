import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveStore } from "../../store/index.js";
import { applyReshape } from "../../core/reshape.js";
import type { ReshapeProposal } from "../../core/reshape.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { ARCHIVE_FILE, loadArchive, trimArchive } from "../../core/archive.js";
import { reasonForReshape, formatReshapeProposal } from "../../analyze/reshape-reason.js";
import { setLLMConfig, setClaudeConfig, resolveConfiguredModel } from "../../analyze/reason.js";
import { loadLLMConfig, loadClaudeConfig } from "../../store/project-config.js";
import { compactSingleChildren } from "../../core/compact-single-children.js";
import { printVendorModelHeader } from "@n-dx/llm-client";
import { REX_DIR } from "./constants.js";
import { CLIError, BudgetExceededError } from "../errors.js";
import { info, warn, result } from "../output.js";
import { formatTokenUsage } from "./analyze.js";
import { preflightBudgetCheck, formatBudgetWarnings } from "./token-format.js";
import { classifyLLMError } from "../llm-error-classifier.js";
import { getLLMVendor } from "../../analyze/reason.js";
import type { PRDItem } from "../../schema/index.js";

export async function cmdReshape(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    throw new CLIError(
      "PRD is empty — nothing to reshape.",
      "Run 'rex analyze' first to build your PRD.",
    );
  }

  // Run single-child compaction migration pass
  const treeRoot = join(rexDir, "prd_tree");
  info("Compacting single-child directories...");
  const compactionResult = await compactSingleChildren(treeRoot);
  if (compactionResult.errors.length > 0) {
    for (const err of compactionResult.errors) {
      warn(`  Warning: ${err.error} (${err.path})`);
    }
  }
  if (compactionResult.compactedCount > 0) {
    info(`Compacted ${compactionResult.compactedCount} single-child director${compactionResult.compactedCount === 1 ? "y" : "ies"}.`);
  }

  // Reload document after compaction
  const docAfterCompaction = await store.loadDocument();

  // Load LLM config
  const llmConfig = await loadLLMConfig(rexDir);
  setLLMConfig(llmConfig);
  const claudeConfig = await loadClaudeConfig(rexDir);
  setClaudeConfig(claudeConfig);

  const dryRun = flags["dry-run"] === "true";
  const accept = flags.accept === "true";

  // Resolve model: explicit flag > vendor config > default
  const resolvedModel = resolveConfiguredModel(flags.model);
  const vendor = getLLMVendor() ?? "claude";
  const modelSource = flags.model
    ? "cli-override" as const
    : llmConfig.claude?.model || llmConfig.codex?.model
      ? "configured" as const
      : "default" as const;
  printVendorModelHeader(vendor, llmConfig, {
    format: flags.format,
    resolvedModel,
    modelSource,
  });

  // Pre-flight budget check
  const budgetResult = await preflightBudgetCheck(rexDir, dir);
  if (budgetResult) {
    const budgetLines = formatBudgetWarnings(budgetResult);
    if (budgetLines.length > 0) {
      for (const line of budgetLines) warn(line);
      warn("");
    }
    if (budgetResult.severity === "exceeded") {
      const store2 = await resolveStore(rexDir);
      const config = await store2.loadConfig();
      if (config.budget?.abort) {
        throw new BudgetExceededError(budgetResult.warnings);
      }
    }
  }

  // Get reshape proposals from LLM
  info("Analyzing PRD structure...");
  let proposals: ReshapeProposal[];
  let tokenUsage: Awaited<ReturnType<typeof reasonForReshape>>["tokenUsage"];
  try {
    const reshapeResult = await reasonForReshape(docAfterCompaction.items, { dir, model: resolvedModel });
    proposals = reshapeResult.proposals;
    tokenUsage = reshapeResult.tokenUsage;
  } catch (err) {
    const classified = classifyLLMError(err instanceof Error ? err : new Error(String(err)), vendor, "analyze PRD structure");
    throw new CLIError(classified.message, classified.suggestion);
  }

  // Show token usage
  const usageLine = formatTokenUsage(tokenUsage);
  if (usageLine) {
    info(`Token usage: ${usageLine}`);
  }

  if (proposals.length === 0) {
    result("No reshape proposals — PRD structure looks good.");
    return;
  }

  // Display proposals
  info(`\nFound ${proposals.length} reshape proposal${proposals.length === 1 ? "" : "s"}:\n`);
  for (let i = 0; i < proposals.length; i++) {
    info(`${i + 1}. ${formatReshapeProposal(proposals[i], docAfterCompaction.items)}`);
    info("");
  }

  if (flags.format === "json") {
    result(JSON.stringify({
      dryRun,
      proposals: proposals.map((p) => ({
        id: p.id,
        ...p.action,
      })),
      tokenUsage,
    }, null, 2));
    if (dryRun) return;
  }

  if (dryRun) {
    result(`\n${proposals.length} proposal${proposals.length === 1 ? "" : "s"} (dry run — no changes made).`);
    return;
  }

  // Determine which proposals to apply
  let accepted: ReshapeProposal[];
  if (accept) {
    accepted = proposals;
  } else if (process.stdin.isTTY) {
    accepted = await interactiveReview(proposals, docAfterCompaction.items);
  } else {
    info("Proposals shown above. Run with --accept to apply, or use interactively in a TTY.");
    return;
  }

  if (accepted.length === 0) {
    result("No proposals accepted.");
    return;
  }

  // Apply accepted proposals
  const reshapeResult = applyReshape(docAfterCompaction.items, accepted);

  // Report errors
  for (const err of reshapeResult.errors) {
    info(`  Warning: ${err.error}`);
  }

  // Archive removed items
  if (reshapeResult.archivedItems.length > 0) {
    const archivePath = join(rexDir, ARCHIVE_FILE);
    const archive = await loadArchive(archivePath);
    archive.batches.push({
      timestamp: new Date().toISOString(),
      source: "reshape",
      items: reshapeResult.archivedItems,
      count: reshapeResult.archivedItems.length,
      reason: `Reshape: ${accepted.map((p) => p.action.action).join(", ")}`,
      actions: accepted,
    });
    trimArchive(archive);
    await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");
  }

  // Save document
  await store.saveDocument(doc);

  // Log the reshape
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "reshape",
    detail: JSON.stringify({
      applied: reshapeResult.applied.length,
      deleted: reshapeResult.deletedIds.length,
      errors: reshapeResult.errors.length,
      actions: reshapeResult.applied.map((p) => p.action.action),
    }),
  });

  // Output
  if (flags.format === "json") {
    result(JSON.stringify({
      applied: reshapeResult.applied.length,
      deletedIds: reshapeResult.deletedIds,
      archivedCount: reshapeResult.archivedItems.length,
      errors: reshapeResult.errors.map((e) => e.error),
    }, null, 2));
  } else {
    result(`Applied ${reshapeResult.applied.length} reshape action${reshapeResult.applied.length === 1 ? "" : "s"}.`);
    if (reshapeResult.deletedIds.length > 0) {
      info(`  ${reshapeResult.deletedIds.length} item${reshapeResult.deletedIds.length === 1 ? "" : "s"} archived.`);
    }
    if (reshapeResult.errors.length > 0) {
      info(`  ${reshapeResult.errors.length} error${reshapeResult.errors.length === 1 ? "" : "s"} (see above).`);
    }
  }
}

async function interactiveReview(
  proposals: ReshapeProposal[],
  items: PRDItem[],
): Promise<ReshapeProposal[]> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  const accepted: ReshapeProposal[] = [];

  try {
    for (let i = 0; i < proposals.length; i++) {
      const p = proposals[i];
      info(`\n[${i + 1}/${proposals.length}] ${formatReshapeProposal(p, items)}`);
      const answer = await ask("  Accept? (y/n/a=all/q=quit) ");
      const choice = answer.trim().toLowerCase();

      if (choice === "q") break;
      if (choice === "a") {
        accepted.push(...proposals.slice(i));
        break;
      }
      if (choice === "y" || choice === "yes") {
        accepted.push(p);
      }
    }
  } finally {
    rl.close();
  }

  return accepted;
}

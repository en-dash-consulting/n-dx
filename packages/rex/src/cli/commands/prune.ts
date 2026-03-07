import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveStore } from "../../store/index.js";
import { findPrunableItems, pruneItems, countSubtree } from "../../core/prune.js";
import { applyReshape } from "../../core/reshape.js";
import type { ReshapeProposal } from "../../core/reshape.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import { formatTokenUsage } from "./analyze.js";
import type { PRDItem } from "../../schema/index.js";
import { getLevelEmoji, formatLevelSummary as formatLevels } from "../../schema/index.js";

const ARCHIVE_FILE = "archive.json";

/**
 * Archive structure written to `.rex/archive.json`.
 *
 * Each prune run appends a batch to the archive's `batches` array,
 * preserving a timestamped history of all pruned subtrees.
 */
interface PruneArchive {
  schema: "rex/archive/v1";
  batches: PruneBatch[];
}

interface PruneBatch {
  timestamp: string;
  source?: "prune" | "reshape";
  items: PRDItem[];
  count: number;
  reason?: string;
  actions?: ReshapeProposal[];
}

async function loadArchive(archivePath: string): Promise<PruneArchive> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(archivePath, "utf-8");
    return JSON.parse(raw) as PruneArchive;
  } catch {
    return { schema: "rex/archive/v1", batches: [] };
  }
}

/**
 * Ask a single yes/no question in a TTY. Returns true for "y"/"yes".
 */
async function confirmPrompt(question: string): Promise<boolean> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) =>
    rl.question(question, resolve),
  );
  rl.close();

  return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
}

/**
 * Format a pruning impact summary for interactive preview.
 *
 * Groups prunable items by level and shows individual/total counts.
 */
function formatPrunePreview(prunable: PRDItem[]): {
  lines: string[];
  totalItems: number;
  byLevel: Record<string, number>;
} {
  let totalItems = 0;
  const byLevel: Record<string, number> = {};

  const lines: string[] = [];
  for (const item of prunable) {
    const subtreeCount = countSubtree(item);
    totalItems += subtreeCount;
    byLevel[item.level] = (byLevel[item.level] || 0) + 1;

    const childInfo = subtreeCount > 1 ? ` (${subtreeCount} items including children)` : "";
    lines.push(`  ${icon(item.level)} ${item.title} [${item.id.slice(0, 8)}]${childInfo}`);
  }

  return { lines, totalItems, byLevel };
}

/**
 * Format a level summary like "2 epics, 3 tasks".
 */
function formatLevelSummary(byLevel: Record<string, number>): string {
  return formatLevels(byLevel);
}

export async function cmdPrune(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const smart = flags.smart === "true";

  if (smart) {
    await smartPrune(dir, flags);
    return;
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  const dryRun = flags["dry-run"] === "true";
  const skipConsolidate = flags["no-consolidate"] === "true";
  const accept = flags.accept === "true";
  const autoConfirm = flags.yes === "true" || flags.y === "true";

  if (dryRun) {
    // Preview mode — show what would be pruned without mutating.
    const prunable = findPrunableItems(doc.items);
    const hasPrunable = prunable.length > 0;

    if (hasPrunable) {
      if (flags.format !== "json") {
        const preview = formatPrunePreview(prunable);
        result("Would prune:");
        for (const line of preview.lines) {
          result(line);
        }
        result("");
        result(`Impact: ${preview.totalItems} total item${preview.totalItems === 1 ? "" : "s"} (${formatLevelSummary(preview.byLevel)})`);
      }
    } else {
      if (flags.format !== "json") {
        result("Nothing to prune.");
      }
    }

    // Also preview consolidation proposals in dry-run
    let consolidationProposals: ReshapeProposal[] = [];
    let consolidationTokenUsage: import("../../schema/index.js").AnalyzeTokenUsage | undefined;
    if (!skipConsolidate && doc.items.length > 0) {
      try {
        const { setLLMConfig, setClaudeConfig } = await import("../../analyze/reason.js");
        const { loadLLMConfig, loadClaudeConfig } = await import("../../store/project-config.js");
        const llmConfig = await loadLLMConfig(rexDir);
        setLLMConfig(llmConfig);
        const claudeConfig = await loadClaudeConfig(rexDir);
        setClaudeConfig(claudeConfig);

        const { reasonForReshape, formatReshapeProposal: fmtProposal } = await import("../../analyze/reshape-reason.js");

        if (flags.format !== "json") {
          info("\nAnalyzing for consolidation opportunities...");
        }

        const consolidateResult = await reasonForReshape(doc.items, {
          dir,
          model: flags.model,
          consolidateMode: true,
        });
        consolidationProposals = consolidateResult.proposals;
        consolidationTokenUsage = consolidateResult.tokenUsage;

        if (flags.format !== "json") {
          const usageLine = formatTokenUsage(consolidateResult.tokenUsage);
          if (usageLine) info(`Token usage: ${usageLine}`);

          if (consolidationProposals.length > 0) {
            info(`\nWould propose ${consolidationProposals.length} consolidation action${consolidationProposals.length === 1 ? "" : "s"}:\n`);
            for (let i = 0; i < consolidationProposals.length; i++) {
              info(`${i + 1}. ${fmtProposal(consolidationProposals[i], doc.items)}`);
              info("");
            }
          } else {
            info("\nNo consolidation needed.");
          }
        }
      } catch (err) {
        if (flags.format !== "json") {
          info(`\nConsolidation preview skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    if (flags.format === "json") {
      result(JSON.stringify({
        dryRun: true,
        items: hasPrunable ? prunable.map(summarize) : [],
        ...(hasPrunable ? { totalItems: formatPrunePreview(prunable).totalItems } : {}),
        ...(consolidationProposals.length > 0 ? {
          consolidation: {
            proposals: consolidationProposals.map((p) => ({ id: p.id, ...p.action })),
            ...(consolidationTokenUsage ? { tokenUsage: consolidationTokenUsage } : {}),
          },
        } : {}),
      }, null, 2));
    }
    return;
  }

  // Preview what will be pruned before executing
  const prunable = findPrunableItems(doc.items);

  if (prunable.length === 0) {
    result("Nothing to prune.");
    // Still run consolidation even if nothing was pruned — the PRD may
    // benefit from regrouping regardless.
    if (!skipConsolidate && doc.items.length > 0) {
      await consolidateAfterPrune(dir, rexDir, store, doc, flags);
    }
    return;
  }

  const preview = formatPrunePreview(prunable);

  // Interactive confirmation: show preview and ask before mutating
  // Skip confirmation for: JSON format, --yes flag, non-TTY, --accept flag
  const needsConfirmation = flags.format !== "json" && !autoConfirm && !accept && process.stdin.isTTY;

  if (needsConfirmation) {
    info("Pruning preview:\n");
    for (const line of preview.lines) {
      info(line);
    }
    info("");
    info(`Will remove ${preview.totalItems} completed item${preview.totalItems === 1 ? "" : "s"} (${formatLevelSummary(preview.byLevel)}).`);
    info("Items will be archived to archive.json for recovery.\n");

    const confirmed = await confirmPrompt("Proceed with prune? (y/n) ");
    if (!confirmed) {
      result("Prune cancelled.");
      return;
    }
    info("");
  }

  // Progress helper: shows step-by-step output in human-readable mode only
  const isJson = flags.format === "json";
  const progress = (msg: string): void => { if (!isJson) info(msg); };

  // Prune completed subtrees
  progress("Pruning completed subtrees...");
  const pruneResult = pruneItems(doc.items);

  if (pruneResult.prunedCount === 0) {
    result("Nothing to prune.");
    if (!skipConsolidate && doc.items.length > 0) {
      await consolidateAfterPrune(dir, rexDir, store, doc, flags);
    }
    return;
  }

  // Archive pruned items
  progress("Archiving pruned items...");
  const archivePath = join(rexDir, ARCHIVE_FILE);
  const archive = await loadArchive(archivePath);
  archive.batches.push({
    timestamp: new Date().toISOString(),
    source: "prune",
    items: pruneResult.pruned,
    count: pruneResult.prunedCount,
  });
  await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");

  // Persist the pruned document
  progress("Saving pruned document...");
  await store.saveDocument(doc);

  // Log the prune action
  const titles = pruneResult.pruned.map((i) => i.title).join(", ");
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "items_pruned",
    detail: `Pruned ${pruneResult.prunedCount} completed items: ${titles}`,
  });

  // Output results
  if (flags.format === "json") {
    const jsonResult: Record<string, unknown> = {
      pruned: pruneResult.pruned.map(summarize),
      prunedCount: pruneResult.prunedCount,
      archivePath,
    };

    // Run consolidation and include in JSON output
    if (!skipConsolidate && doc.items.length > 0) {
      const consolidation = await consolidateAfterPrune(dir, rexDir, store, doc, flags);
      if (consolidation) {
        jsonResult.consolidation = consolidation;
      }
    }

    result(JSON.stringify(jsonResult, null, 2));
  } else {
    result(`Pruned ${pruneResult.prunedCount} completed item${pruneResult.prunedCount === 1 ? "" : "s"}:`);
    for (const item of pruneResult.pruned) {
      result(`  ${icon(item.level)} ${item.title}`);
    }
    info(`Archived to ${ARCHIVE_FILE}`);

    // Chain consolidation after prune
    if (!skipConsolidate && doc.items.length > 0) {
      await consolidateAfterPrune(dir, rexDir, store, doc, flags);
    }
  }
}

/**
 * Post-prune consolidation: LLM-assisted regrouping of remaining items.
 * Analyzes the current PRD state and proposes restructuring to create
 * clean, logical groupings after completed items have been removed.
 *
 * Returns consolidation summary for JSON output, or undefined if skipped.
 */
async function consolidateAfterPrune(
  dir: string,
  rexDir: string,
  store: Awaited<ReturnType<typeof resolveStore>>,
  doc: Awaited<ReturnType<Awaited<ReturnType<typeof resolveStore>>["loadDocument"]>>,
  flags: Record<string, string>,
): Promise<{ applied: number; archivedCount: number } | undefined> {
  const accept = flags.accept === "true";

  try {
    // Load Claude config
    const { setLLMConfig, setClaudeConfig } = await import("../../analyze/reason.js");
    const { loadLLMConfig, loadClaudeConfig } = await import("../../store/project-config.js");
    const llmConfig = await loadLLMConfig(rexDir);
    setLLMConfig(llmConfig);
    const claudeConfig = await loadClaudeConfig(rexDir);
    setClaudeConfig(claudeConfig);

    const { reasonForReshape, formatReshapeProposal } = await import("../../analyze/reshape-reason.js");

    info("\nAnalyzing remaining items for consolidation...");
    const { proposals, tokenUsage } = await reasonForReshape(doc.items, {
      dir,
      model: flags.model,
      consolidateMode: true,
    });

    const usageLine = formatTokenUsage(tokenUsage);
    if (usageLine) info(`Token usage: ${usageLine}`);

    if (proposals.length === 0) {
      info("No consolidation needed.");
      return undefined;
    }

    info(`\nFound ${proposals.length} consolidation proposal${proposals.length === 1 ? "" : "s"}:\n`);
    for (let i = 0; i < proposals.length; i++) {
      info(`${i + 1}. ${formatReshapeProposal(proposals[i], doc.items)}`);
      info("");
    }

    // Determine which to apply
    let accepted: ReshapeProposal[];
    if (accept) {
      accepted = proposals;
    } else if (process.stdin.isTTY) {
      accepted = await interactiveAcceptProposals(proposals, doc.items, "Consolidate");
    } else {
      info("Run with --accept to apply consolidation, or use interactively in a TTY.");
      return undefined;
    }

    if (accepted.length === 0) {
      info("No consolidation proposals accepted.");
      return undefined;
    }

    // Apply via reshape
    info("Applying consolidation...");
    const reshapeResult = applyReshape(doc.items, accepted);

    for (const err of reshapeResult.errors) {
      info(`  Warning: ${err.error}`);
    }

    // Archive any items removed during consolidation
    if (reshapeResult.archivedItems.length > 0) {
      info("Archiving consolidated items...");
      const archivePath = join(rexDir, ARCHIVE_FILE);
      const archive = await loadArchive(archivePath);
      archive.batches.push({
        timestamp: new Date().toISOString(),
        source: "reshape",
        items: reshapeResult.archivedItems,
        count: reshapeResult.archivedItems.length,
        reason: "Post-prune consolidation: LLM-proposed restructuring",
        actions: accepted,
      });
      await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");
    }

    // Save document
    info("Saving consolidated document...");
    await store.saveDocument(doc);

    // Log the consolidation
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "post_prune_consolidation",
      detail: JSON.stringify({
        applied: reshapeResult.applied.length,
        deleted: reshapeResult.deletedIds.length,
        archived: reshapeResult.archivedItems.length,
        actions: reshapeResult.applied.map((p) => p.action.action),
      }),
    });

    if (flags.format !== "json") {
      result(`Consolidated ${reshapeResult.applied.length} item${reshapeResult.applied.length === 1 ? "" : "s"}.`);
      if (reshapeResult.archivedItems.length > 0) {
        info(`  ${reshapeResult.archivedItems.length} item${reshapeResult.archivedItems.length === 1 ? "" : "s"} archived.`);
      }
    }

    return {
      applied: reshapeResult.applied.length,
      archivedCount: reshapeResult.archivedItems.length,
    };
  } catch (err) {
    info(`\nConsolidation skipped: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/**
 * Smart prune: LLM-assisted identification of obsolete/mergeable items.
 * Delegates to reshape-reason with a prune-focused prompt, then applies
 * via applyReshape().
 */
async function smartPrune(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    throw new CLIError(
      "PRD is empty — nothing to prune.",
      "Run 'rex analyze' first to build your PRD.",
    );
  }

  // Load Claude config
  const { setLLMConfig, setClaudeConfig } = await import("../../analyze/reason.js");
  const { loadLLMConfig, loadClaudeConfig } = await import("../../store/project-config.js");
  const llmConfig = await loadLLMConfig(rexDir);
  setLLMConfig(llmConfig);
  const claudeConfig = await loadClaudeConfig(rexDir);
  setClaudeConfig(claudeConfig);

  const { reasonForReshape, formatReshapeProposal } = await import("../../analyze/reshape-reason.js");

  const dryRun = flags["dry-run"] === "true";
  const accept = flags.accept === "true";
  const model = flags.model;

  info("Analyzing PRD for pruning opportunities...");
  const { proposals, tokenUsage } = await reasonForReshape(doc.items, {
    dir,
    model,
    pruneMode: true,
  });

  const usageLine = formatTokenUsage(tokenUsage);
  if (usageLine) {
    info(`Token usage: ${usageLine}`);
  }

  if (proposals.length === 0) {
    result("No smart prune candidates found.");
    return;
  }

  info(`\nFound ${proposals.length} prune candidate${proposals.length === 1 ? "" : "s"}:\n`);
  for (let i = 0; i < proposals.length; i++) {
    info(`${i + 1}. ${formatReshapeProposal(proposals[i], doc.items)}`);
    info("");
  }

  if (dryRun) {
    if (flags.format === "json") {
      result(JSON.stringify({
        dryRun: true,
        proposals: proposals.map((p) => ({ id: p.id, ...p.action })),
        tokenUsage,
      }, null, 2));
    } else {
      result(`${proposals.length} prune candidate${proposals.length === 1 ? "" : "s"} (dry run — no changes made).`);
    }
    return;
  }

  // Determine which to apply
  let accepted: ReshapeProposal[];
  if (accept) {
    accepted = proposals;
  } else if (process.stdin.isTTY) {
    accepted = await interactiveAcceptProposals(proposals, doc.items, "Prune");
  } else {
    info("Run with --accept to apply, or use interactively in a TTY.");
    return;
  }

  if (accepted.length === 0) {
    result("No prune candidates accepted.");
    return;
  }

  // Apply via reshape
  info("Applying smart prune...");
  const reshapeResult = applyReshape(doc.items, accepted);

  for (const err of reshapeResult.errors) {
    info(`  Warning: ${err.error}`);
  }

  // Archive
  if (reshapeResult.archivedItems.length > 0) {
    info("Archiving pruned items...");
    const archivePath = join(rexDir, ARCHIVE_FILE);
    const archive = await loadArchive(archivePath);
    archive.batches.push({
      timestamp: new Date().toISOString(),
      source: "reshape",
      items: reshapeResult.archivedItems,
      count: reshapeResult.archivedItems.length,
      reason: "Smart prune: LLM-identified obsolete/mergeable items",
      actions: accepted,
    });
    await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");
  }

  info("Saving document...");
  await store.saveDocument(doc);

  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "smart_prune",
    detail: JSON.stringify({
      applied: reshapeResult.applied.length,
      deleted: reshapeResult.deletedIds.length,
      actions: reshapeResult.applied.map((p) => p.action.action),
    }),
  });

  if (flags.format === "json") {
    result(JSON.stringify({
      applied: reshapeResult.applied.length,
      deletedIds: reshapeResult.deletedIds,
      archivedCount: reshapeResult.archivedItems.length,
    }, null, 2));
  } else {
    result(`Smart-pruned ${reshapeResult.applied.length} item${reshapeResult.applied.length === 1 ? "" : "s"}.`);
    if (reshapeResult.archivedItems.length > 0) {
      info(`  ${reshapeResult.archivedItems.length} item${reshapeResult.archivedItems.length === 1 ? "" : "s"} archived.`);
    }
  }
}

async function interactiveAcceptProposals(
  proposals: ReshapeProposal[],
  items: PRDItem[],
  promptLabel = "Accept",
): Promise<ReshapeProposal[]> {
  const { formatReshapeProposal } = await import("../../analyze/reshape-reason.js");
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
      const answer = await ask(`  ${promptLabel}? (y/n/a=all/q=quit) `);
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

function summarize(item: PRDItem): { id: string; title: string; level: string } {
  return { id: item.id, title: item.title, level: item.level };
}

function icon(level: string): string {
  return getLevelEmoji(level);
}

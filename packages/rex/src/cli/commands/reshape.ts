import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { resolveStore, FileStore } from "../../store/index.js";
import { applyReshape } from "../../core/reshape.js";
import type { ReshapeProposal } from "../../core/reshape.js";
import { toCanonicalJSON } from "../../core/canonical.js";
import { ARCHIVE_FILE, loadArchive, trimArchive } from "../../core/archive.js";
import type { MergeAuditEntry, GroupAuditEntry } from "../../core/archive.js";
import { reasonForReshape, formatReshapeProposal, reasonForBodyMerge } from "../../analyze/reshape-reason.js";
import { setLLMConfig, setClaudeConfig, resolveConfiguredModel } from "../../analyze/reason.js";
import { loadLLMConfig, loadClaudeConfig } from "../../store/project-config.js";
import { migrateToFolderPerTask } from "../../core/folder-per-task-migration.js";
import { snapshotPRDTree, pruneBackups } from "../../core/backup-snapshots.js";
import { captureGitCommitHash } from "../../core/git-utils.js";
import { printVendorModelHeader } from "@n-dx/llm-client";
import { REX_DIR } from "./constants.js";
import { CLIError, BudgetExceededError } from "../errors.js";
import { info, warn, result } from "../output.js";
import { formatTokenUsage } from "./analyze.js";
import { preflightBudgetCheck, formatBudgetWarnings } from "./token-format.js";
import { classifyLLMError } from "../llm-error-classifier.js";
import { getLLMVendor } from "../../analyze/reason.js";
import { detectCrossPRDDuplicates } from "./reshape-detect-duplicates.js";
import { acquireReshapeLock, detectHashSuffixDuplicatesInTree } from "./add-reshape.js";
import type { MergeAction } from "../../core/reshape.js";
import type { PRDItem } from "../../schema/index.js";

export async function cmdReshape(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);

  // Acquire reshape lock so concurrent `add` commands skip their scoped pass.
  const releaseReshapeLock = await acquireReshapeLock(rexDir);

  try {
    await _cmdReshapeCore(dir, rexDir, flags);
  } finally {
    await releaseReshapeLock();
  }
}

async function _cmdReshapeCore(
  dir: string,
  rexDir: string,
  flags: Record<string, string>,
): Promise<void> {
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  if (doc.items.length === 0) {
    throw new CLIError(
      "PRD is empty — nothing to reshape.",
      "Run 'rex analyze' first to build your PRD.",
    );
  }

  // Snapshot PRD tree before structural migrations (backup for recovery on failure)
  const treeRoot = join(rexDir, "prd_tree");
  let backupSnapshot = null;
  try {
    backupSnapshot = await snapshotPRDTree(rexDir);
  } catch (err) {
    // Best-effort: don't fail the command if backup creation fails
    warn(`Warning: Failed to create backup snapshot: ${String(err)}`);
  }

  // Run folder-per-task structural migration pass
  info("Migrating non-conforming task structures to folder-per-task form...");
  let migrationResult;
  try {
    migrationResult = await migrateToFolderPerTask(treeRoot);
  } catch (err) {
    // Surface backup path in error message for recovery
    const backupMsg = backupSnapshot
      ? `\n\nBackup saved to: ${backupSnapshot.backupPath}\nRestore with: cp -r ${backupSnapshot.backupPath} ${treeRoot}`
      : "";
    throw new CLIError(
      `Migration failed: ${String(err)}${backupMsg}`,
      "Check the backup path above to restore the PRD tree.",
    );
  }

  if (migrationResult.errors.length > 0) {
    for (const err of migrationResult.errors) {
      warn(`  Warning: ${err.error} (${err.path})`);
    }
  }
  if (migrationResult.migratedCount > 0) {
    info(`Migrated ${migrationResult.migratedCount} item${migrationResult.migratedCount === 1 ? "" : "s"} to folder-per-task form.`);
  }

  // Canonicalize the on-disk tree: load (handles legacy `__parent*` shims and
  // dual `<title>.md` + `index.md` shapes via the parser) and save back
  // through the serializer, which writes one `index.md` per folder item and
  // sweeps up stale leftovers via `removeStaleEntries`. This satisfies the
  // user-facing rule that reshape always migrates the tree forward, even
  // when no proposals end up being applied.
  const canonicalDoc = await store.loadDocument();
  await store.saveDocument(canonicalDoc);

  // Prune old backups if migrations were applied
  if (migrationResult.migratedCount > 0) {
    try {
      await pruneBackups(rexDir, 10);
    } catch {
      // Best-effort: don't fail the command if pruning fails
    }
  }

  const docAfterCompaction = canonicalDoc;

  // Load file ownership map for cross-file duplicate detection (FileStore feature)
  const fileOwnership = store instanceof FileStore
    ? await store.loadFileOwnership()
    : new Map();

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

  // Run cross-PRD duplicate detection pass
  const duplicateProposals = detectCrossPRDDuplicates(docAfterCompaction.items, fileOwnership);

  // Run hash-suffix duplicate detection across all sibling cohorts in the tree
  const hashSuffixGroups = detectHashSuffixDuplicatesInTree(docAfterCompaction.items);
  const hashSuffixProposals = hashSuffixGroups.flatMap((g) => g.proposals);

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

  // Combine proposals: cross-PRD duplicates, hash-suffix duplicates, then LLM proposals
  const allProposals = [...duplicateProposals, ...hashSuffixProposals, ...proposals];

  // Show token usage
  const usageLine = formatTokenUsage(tokenUsage);
  if (usageLine) {
    info(`Token usage: ${usageLine}`);
  }

  if (allProposals.length === 0) {
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
      proposals: allProposals.map((p) => ({
        id: p.id,
        ...p.action,
      })),
      tokenUsage,
    }, null, 2));
    if (dryRun) return;
  }

  if (dryRun) {
    result(`\n${allProposals.length} proposal${allProposals.length === 1 ? "" : "s"} (dry run — no changes made).`);
    return;
  }

  // Determine which proposals to apply
  let accepted: ReshapeProposal[];
  if (accept) {
    accepted = allProposals;
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

  // Capture pre-reshape commit hash for rollback support
  const preReshapeCommit = await captureGitCommitHash(dir);

  // Apply accepted proposals
  const reshapeResult = applyReshape(docAfterCompaction.items, accepted);

  // Report errors
  for (const err of reshapeResult.errors) {
    info(`  Warning: ${err.error}`);
  }

  // LLM body merge: for each accepted hash-suffix MergeAction, generate a merged description
  const { findItem: findItemInTree, updateInTree } = await import("../../core/tree.js");
  for (const proposal of reshapeResult.applied) {
    if (
      proposal.action.action === "merge" &&
      (proposal.action as MergeAction).reason === "hash-suffix-duplicate-sibling"
    ) {
      const mergeAction = proposal.action as MergeAction;
      // Collect original items (survivor + losers, which are now archived)
      const survivorEntry = findItemInTree(docAfterCompaction.items, mergeAction.survivorId);
      const loserItems = reshapeResult.archivedItems.filter((item) =>
        mergeAction.mergedIds.includes(item.id),
      );
      if (survivorEntry && loserItems.length > 0) {
        const group = [survivorEntry.item, ...loserItems];
        try {
          const bodyMerge = await reasonForBodyMerge(group, resolvedModel);
          updateInTree(docAfterCompaction.items, mergeAction.survivorId, {
            description: bodyMerge.description,
          });
        } catch {
          // Body merge is best-effort; don't fail the reshape command
        }
      }
    }
  }

  // Archive removed items and record group audit trail
  const hasArchivedItems = reshapeResult.archivedItems.length > 0;
  const hasGroupAudit = reshapeResult.groupAuditTrail.length > 0;

  if (hasArchivedItems || hasGroupAudit) {
    const archivePath = join(rexDir, ARCHIVE_FILE);
    const archive = await loadArchive(archivePath);
    const batchTimestamp = new Date().toISOString();

    // Build merge audit trail entries with pre-reshape commit hash
    const mergeAuditTrail: MergeAuditEntry[] = reshapeResult.mergeAuditTrail.map((merge) => ({
      survivorId: merge.survivorId,
      mergedFromIds: merge.mergedFromIds,
      reasoning: merge.reasoning,
      preReshapeCommit,
      timestamp: batchTimestamp,
    }));

    // Build group audit trail entries with pre-reshape commit hash
    const groupAuditTrail: GroupAuditEntry[] = reshapeResult.groupAuditTrail.map((g) => ({
      containerId: g.containerId,
      containerTitle: g.containerTitle,
      originalParentId: g.originalParentId,
      movedItemIds: g.movedItemIds,
      reasoning: g.reasoning,
      preReshapeCommit,
      timestamp: batchTimestamp,
    }));

    archive.batches.push({
      timestamp: batchTimestamp,
      source: "reshape",
      items: reshapeResult.archivedItems,
      count: reshapeResult.archivedItems.length,
      reason: `Reshape: ${accepted.map((p) => p.action.action).join(", ")}`,
      actions: accepted,
      mergeAuditTrail: mergeAuditTrail.length > 0 ? mergeAuditTrail : undefined,
      groupAuditTrail: groupAuditTrail.length > 0 ? groupAuditTrail : undefined,
    });
    trimArchive(archive);
    await writeFile(archivePath, toCanonicalJSON(archive), "utf-8");
  }

  // Save document (use docAfterCompaction which holds the mutated items)
  await store.saveDocument(docAfterCompaction);

  // Log the reshape and migrations
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "reshape",
    detail: JSON.stringify({
      applied: reshapeResult.applied.length,
      deleted: reshapeResult.deletedIds.length,
      errors: reshapeResult.errors.length,
      actions: reshapeResult.applied.map((p) => p.action.action),
      migrated: migrationResult.migratedCount,
      migrations: migrationResult.migrations.map((m) => ({
        type: m.type,
        beforePath: m.beforePath,
        afterPath: m.afterPath,
      })),
    }),
  });

  // Output
  if (flags.format === "json") {
    result(JSON.stringify({
      applied: reshapeResult.applied.length,
      deletedIds: reshapeResult.deletedIds,
      archivedCount: reshapeResult.archivedItems.length,
      preReshapeCommit,
      mergeAuditTrail: reshapeResult.mergeAuditTrail,
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

    // Per-group summary for hash-suffix proposals
    const appliedHashSuffix = reshapeResult.applied.filter(
      (p) =>
        (p.action.action === "merge" && (p.action as MergeAction).reason === "hash-suffix-duplicate-sibling") ||
        p.action.action === "group",
    );
    for (const p of appliedHashSuffix) {
      if (p.action.action === "merge") {
        const mergeAction = p.action as MergeAction;
        const reparented = reshapeResult.archivedItems
          .filter((item) => mergeAction.mergedIds.includes(item.id))
          .reduce((sum, item) => sum + (item.children?.length ?? 0), 0);
        info(
          `  [hash-suffix] survivor: ${mergeAction.survivorId.slice(0, 8)} (merged: ${mergeAction.mergedIds.map((id) => id.slice(0, 8)).join(", ")}, strategy: merge, reparented: ${reparented} children)`,
        );
      } else if (p.action.action === "group") {
        const groupAction = p.action as import("../../core/reshape.js").GroupAction;
        info(
          `  [hash-suffix] container: ${groupAction.containerId.slice(0, 8)} "${groupAction.containerTitle}" (grouped: ${groupAction.itemIds.map((id) => id.slice(0, 8)).join(", ")}, strategy: parent-container)`,
        );
      }
    }

    // Show rollback information if there were merges
    if (reshapeResult.mergeAuditTrail.length > 0) {
      if (preReshapeCommit !== "no-git") {
        info(`\nTo rollback: git reset --hard ${preReshapeCommit}`);
      }
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

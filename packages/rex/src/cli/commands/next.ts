import { resolveStore, ensureLegacyPrdMigrated, openClaimsStore, resolveClaimHolder, resolveRexPaths, isChangeLayerStore } from "../../store/index.js";
import type { ChangeLayerStore } from "../../store/change-layer-store.js";
import type { PRDItem } from "../../schema/index.js";
import { collectForeignClaims } from "../mcp-tools/index.js";
import type { SkippedClaim } from "../mcp-tools/claims.js";
import { loadItemsPreferFolderTree } from "./folder-tree-sync.js";
import { findNextTask, collectCompletedIds, explainSelection, type SelectionExplanation } from "../../core/next-task.js";
import { completedWorkIds, findNextWorkTask } from "../../core/change-next-task.js";

import { info, result } from "../output.js";
import { bold, yellow, red, dim, colorStatus } from "@n-dx/llm-client";
import { emitMigrationNotification } from "../migration-notification.js";

function colorPriority(priority: string): string {
  switch (priority) {
    case "high": return red(priority);
    case "medium": return yellow(priority);
    case "low": return dim(priority);
    default: return priority;
  }
}

export async function cmdNext(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before reading PRD
  const migrationResult = await ensureLegacyPrdMigrated(dir);

  const rexDir = resolveRexPaths(dir).rexDir;
  const store = await resolveStore(rexDir);

  // Emit migration notification to CLI and execution log
  await emitMigrationNotification(migrationResult, flags, (entry) => store.appendLog(entry));
  if (isChangeLayerStore(store)) return nextV2Work(dir, store, flags);
  const doc = await store.loadDocument();
  doc.items = await loadItemsPreferFolderTree(rexDir, store, doc);

  if (doc.items.length === 0) {
    result("No items in PRD. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  const completedIds = collectCompletedIds(doc.items);
  const { excludeIds, skipped } = await foreignClaims(dir);
  const skippedClaimed = skipped.filter((c) => !completedIds.has(c.taskId));
  const nextResult = findNextTask(doc.items, completedIds, excludeIds.size > 0 ? { excludeIds } : undefined);

  if (!nextResult) return printNoneLeft(skippedClaimed, flags);
  const explanation = explainSelection(doc.items, nextResult, completedIds);
  printNext(nextResult.item, nextResult.parents, explanation, skippedClaimed, flags);
}

/**
 * `rex next` on a v2 tree: selection through `findNextWork` (placed changes and
 * their tasks, task-less changes as units, never the Inbox). `--format=json`
 * keeps the v1 fields and adds `changeId`, the change the unit belongs to.
 */
async function nextV2Work(dir: string, store: ChangeLayerStore, flags: Record<string, string>): Promise<void> {
  const tree = await store.loadTree();
  const { excludeIds, skipped } = await foreignClaims(dir);
  const completed = completedWorkIds(tree);
  const skippedClaimed = skipped.filter((c) => !completed.has(c.taskId));
  const next = findNextWorkTask(tree, { excludeIds });
  if (!next) return printNoneLeft(skippedClaimed, flags);
  printNext(next.item, next.parents, next.explanation, skippedClaimed, flags, { changeId: next.unit.change.id });
}

/**
 * Tasks another worktree holds a live claim on are passed over, not treated
 * as done: `ndx work` there will finish or release them.
 */
function foreignClaims(dir: string): ReturnType<typeof collectForeignClaims> {
  return collectForeignClaims({
    store: openClaimsStore(dir),
    worktreeRoot: resolveClaimHolder(dir).worktreeRoot,
  });
}

function printNoneLeft(skippedClaimed: SkippedClaim[], flags: Record<string, string>): void {
  if (flags.format === "json") {
    result(JSON.stringify({ item: null, skippedClaimed }, null, 2));
    return;
  }
  result(skippedClaimed.length > 0
    ? `COMPLETE — no actionable tasks remaining that are not claimed by another worktree (${skippedClaimed.length} claimed elsewhere)`
    : "COMPLETE — no actionable tasks remaining");
  printSkippedClaims(skippedClaimed, flags.verbose === "true");
}

function printNext(
  item: PRDItem,
  parents: PRDItem[],
  explanation: SelectionExplanation,
  skippedClaimed: SkippedClaim[],
  flags: Record<string, string>,
  v2Fields: { changeId?: string } = {},
): void {
  if (flags.format === "json") {
    result(JSON.stringify({ item, parents, explanation, ...v2Fields, skippedClaimed }, null, 2));
    return;
  }

  if (parents.length > 0) {
    const breadcrumb = parents.map((p) => p.title).join(dim(" → "));
    info(dim(breadcrumb + " →"));
  }

  result(`\n[${item.level}] ${bold(item.title)}`);
  result(`  ID:     ${dim(item.id)}`);
  info(`  Status: ${colorStatus(item.status)}`);
  if (item.priority) info(`  Priority: ${colorPriority(item.priority)}`);
  if (item.blockedBy && item.blockedBy.length > 0) {
    info(`  Blocked by: ${item.blockedBy.join(", ")}`);
  }
  if (item.description) info(`\n  ${item.description}`);
  if (item.acceptanceCriteria && item.acceptanceCriteria.length > 0) {
    info("\n  Acceptance Criteria:");
    for (const ac of item.acceptanceCriteria) {
      info(`    - ${ac}`);
    }
  }

  // Selection reasoning
  info(`\n  Why: ${explanation.summary}`);
  if (explanation.dependencies.status === "resolved") {
    info(`  Dependencies: ${explanation.dependencies.resolvedBlockers.length} resolved`);
  }
  if (explanation.skipped.total > 0) {
    const parts: string[] = [];
    if (explanation.skipped.completed > 0) parts.push(`${explanation.skipped.completed} completed`);
    if (explanation.skipped.deferred > 0) parts.push(`${explanation.skipped.deferred} deferred`);
    if (explanation.skipped.blocked > 0) parts.push(`${explanation.skipped.blocked} blocked`);
    if (explanation.skipped.unresolvedDeps > 0) parts.push(`${explanation.skipped.unresolvedDeps} awaiting deps`);
    info(`  Skipped: ${parts.join(", ")}`);
  }
  printSkippedClaims(skippedClaimed, flags.verbose === "true");
}

/** One line per worktree-claimed task under --verbose; a count otherwise. */
function printSkippedClaims(
  skipped: Array<{ taskId: string; worktreeRoot: string; pid: number }>,
  verbose: boolean,
): void {
  if (skipped.length === 0) return;
  info(`  Claimed elsewhere: ${skipped.length} task(s) held by another worktree${verbose ? "" : dim(" (--verbose lists them)")}`);
  if (!verbose) return;
  for (const c of skipped) {
    info(`    ${dim(c.taskId)} — ${c.worktreeRoot} (pid ${c.pid})`);
  }
}

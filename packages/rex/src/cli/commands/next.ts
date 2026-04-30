import { join } from "node:path";
import { resolveStore, ensureLegacyPrdMigrated } from "../../store/index.js";
import { loadItemsPreferFolderTree } from "./folder-tree-sync.js";
import { findNextTask, collectCompletedIds, explainSelection } from "../../core/next-task.js";
import { REX_DIR } from "./constants.js";
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

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  // Emit migration notification to CLI and execution log
  await emitMigrationNotification(migrationResult, flags, (entry) => store.appendLog(entry));
  const doc = await store.loadDocument();
  doc.items = await loadItemsPreferFolderTree(rexDir, store);

  if (doc.items.length === 0) {
    result("No items in PRD. Run: rex add epic --title=\"...\" " + dir);
    return;
  }

  const completedIds = collectCompletedIds(doc.items);
  const nextResult = findNextTask(doc.items, completedIds);

  if (!nextResult) {
    result("COMPLETE — no actionable tasks remaining");
    return;
  }

  const { item, parents } = nextResult;
  const explanation = explainSelection(doc.items, nextResult, completedIds);

  if (flags.format === "json") {
    result(JSON.stringify({ item, parents, explanation }, null, 2));
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
}

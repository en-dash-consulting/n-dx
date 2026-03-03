import { join } from "node:path";
import { resolveStore } from "../../store/index.js";
import { removeEpic } from "../../core/remove-epic.js";
import { removeTask } from "../../core/remove-task.js";
import {
  preCheckFeatureDeletion,
  removeFeature,
} from "../../core/remove-feature.js";
import { findItem } from "../../core/tree.js";
import { countSubtree } from "../../core/prune.js";
import { computeTimestampUpdates } from "../../core/timestamps.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, warn, result } from "../output.js";
import type { ItemStatus } from "../../schema/index.js";
import { isRootLevel, getLevelLabel } from "../../schema/index.js";

/**
 * Supported levels for the remove command.
 * Epics, features, and tasks have dedicated removal logic.
 * Features include integrity pre-checks (external dependents, sync state).
 */
const REMOVABLE_LEVELS = new Set(["epic", "feature", "task"]);

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
 * `rex remove <level> <id> [dir]` — remove an epic, feature, or task from the PRD.
 *
 * When `level` is omitted, the item's level is auto-detected from the tree.
 * Shows a confirmation prompt unless `--yes` / `-y` is passed.
 *
 * Feature removal includes integrity pre-checks:
 * - Validates no external items depend on the feature's subtree via `blockedBy`
 * - Checks for synced items (remoteId) that could cause remote data corruption
 * - Shows warnings and requires explicit confirmation when risks are detected
 */
export async function cmdRemove(
  dir: string,
  id: string,
  level: string | undefined,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();

  // Resolve the item and validate
  const entry = findItem(doc.items, id);
  if (!entry) {
    throw new CLIError(
      `Item "${id}" not found.`,
      "Check the ID with 'rex status' and try again.",
    );
  }

  const item = entry.item;

  // If level was specified, validate it matches
  if (level) {
    if (!REMOVABLE_LEVELS.has(level)) {
      throw new CLIError(
        `Cannot remove a ${level} directly.`,
        "Use 'rex remove epic <id>', 'rex remove feature <id>', or 'rex remove task <id>'.",
      );
    }
    if (item.level !== level) {
      const article = level === "epic" ? "an" : "a";
      throw new CLIError(
        `Item "${id}" is a ${getLevelLabel(item.level)}, not ${article} ${getLevelLabel(level)}.`,
        `Use 'rex remove ${item.level} ${id}' instead.`,
      );
    }
  } else {
    // Auto-detect: validate the item is a removable level
    if (!REMOVABLE_LEVELS.has(item.level)) {
      throw new CLIError(
        `Cannot remove a ${getLevelLabel(item.level)} directly.`,
        "Only epics, features, and tasks can be removed. Use 'rex remove <epic|feature|task> <id>'.",
      );
    }
  }

  const subtreeCount = countSubtree(item);
  const autoConfirm = flags.yes === "true" || flags.y === "true";

  // Confirmation prompt (skip for --yes, --format=json, or non-TTY)
  const needsConfirmation = flags.format !== "json" && !autoConfirm && process.stdin.isTTY;

  if (needsConfirmation) {
    const childInfo = subtreeCount > 1
      ? ` and ${subtreeCount - 1} descendant${subtreeCount - 1 === 1 ? "" : "s"}`
      : "";
    info(`\nAbout to remove ${item.level}: ${item.title} [${item.id.slice(0, 8)}]${childInfo}`);

    const confirmed = await confirmPrompt(`\nRemove this ${item.level}? (y/n) `);
    if (!confirmed) {
      result("Remove cancelled.");
      return;
    }
    info("");
  }

  // Execute the removal
  if (isRootLevel(item.level)) {
    const epicResult = removeEpic(doc.items, id);
    if (!epicResult.ok) {
      throw new CLIError(epicResult.error!, "Check the ID with 'rex status' and try again.");
    }

    await store.saveDocument(doc);

    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "epic_removed",
      itemId: id,
      detail: epicResult.detail,
    });

    if (flags.format === "json") {
      result(JSON.stringify({
        removed: { id, title: item.title, level: item.level },
        deletedIds: epicResult.deletedIds,
        deletedCount: epicResult.deletedIds.length,
      }, null, 2));
    } else {
      result(epicResult.detail);
    }
  } else if (item.level === "feature") {
    // Feature removal with integrity pre-checks
    const preCheck = preCheckFeatureDeletion(doc.items, id);

    // Show integrity warnings in interactive mode
    if (needsConfirmation && !preCheck.safe) {
      warn("\n⚠ Integrity warnings:");
      for (const w of preCheck.warnings) {
        warn(`  • ${w}`);
      }
      info("");

      const confirmed = await confirmPrompt(
        `Proceed with deletion despite warnings? (y/n) `,
      );
      if (!confirmed) {
        result("Remove cancelled.");
        return;
      }
      info("");
    }

    const featureResult = removeFeature(doc.items, id);
    if (!featureResult.ok) {
      throw new CLIError(featureResult.error!, "Check the ID with 'rex status' and try again.");
    }

    await store.saveDocument(doc);

    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "feature_removed",
      itemId: id,
      detail: featureResult.detail,
    });

    if (flags.format === "json") {
      result(JSON.stringify({
        removed: { id, title: item.title, level: item.level },
        deletedIds: featureResult.deletedIds,
        deletedCount: featureResult.deletedIds.length,
        cleanedRefs: featureResult.cleanedRefs,
        integrityCheck: {
          safe: preCheck.safe,
          externalDependents: preCheck.externalDependents,
          syncedItems: preCheck.syncedItems,
          warnings: preCheck.warnings,
        },
      }, null, 2));
    } else {
      result(featureResult.detail);
      if (featureResult.cleanedRefs > 0) {
        info(`  Cleaned ${featureResult.cleanedRefs} blockedBy reference${featureResult.cleanedRefs === 1 ? "" : "s"}`);
      }
    }
  } else {
    // task
    const taskResult = removeTask(doc.items, id);
    if (!taskResult.ok) {
      throw new CLIError(taskResult.error!, "Check the ID with 'rex status' and try again.");
    }

    await store.saveDocument(doc);

    // Handle parent auto-completions
    const autoCompleted: Array<{ id: string; title: string; level: string }> = [];
    for (const parent of taskResult.parentAutoCompletions) {
      const parentItem = await store.getItem(parent.id);
      if (!parentItem) continue;

      const tsUpdates = computeTimestampUpdates(
        parentItem.status,
        "completed",
        parentItem,
      );
      await store.updateItem(parent.id, {
        status: "completed" as ItemStatus,
        ...tsUpdates,
      });
      await store.appendLog({
        timestamp: new Date().toISOString(),
        event: "auto_completed",
        itemId: parent.id,
        detail: `Auto-completed ${parent.level}: ${parent.title} (all remaining children done after task removal)`,
      });
      autoCompleted.push(parent);
    }

    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "task_removed",
      itemId: id,
      detail: taskResult.detail,
    });

    if (flags.format === "json") {
      result(JSON.stringify({
        removed: { id, title: item.title, level: item.level },
        deletedIds: taskResult.deletedIds,
        deletedCount: taskResult.deletedIds.length,
        autoCompleted,
      }, null, 2));
    } else {
      result(taskResult.detail);
      for (const ac of autoCompleted) {
        info(`  \u2713 Auto-completed ${ac.level}: ${ac.title}`);
      }
    }
  }
}

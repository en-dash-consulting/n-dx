import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  resolveStore,
  FileStore,
  resolvePRDFile,
  resolveGitBranch,
  ensureLegacyPrdMigrated,
} from "../../store/index.js";
import { LEVEL_HIERARCHY, CHILD_LEVEL, isItemLevel } from "../../schema/index.js";
import { findItem } from "../../core/tree.js";
import { validateDAG } from "../../core/dag.js";
import { migrateToFolderPerTask } from "../../core/folder-per-task-migration.js";
import { snapshotPRDTree, pruneBackups } from "../../core/backup-snapshots.js";
import { REX_DIR } from "./constants.js";
import { syncFolderTree } from "./folder-tree-sync.js";
import { cascadeParentReset } from "../../core/parent-reset.js";
import { CLIError } from "../errors.js";
import { info, result, warn } from "../output.js";
import { emitMigrationNotification } from "../migration-notification.js";
import { getFolderTreePath } from "../folder-tree-path.js";
import { runScopedConsolidationPass } from "./add-reshape.js";
import type { PRDItem, ItemLevel, ItemStatus, Priority } from "../../schema/index.js";

export async function cmdAdd(
  dir: string,
  level: string | undefined,
  flags: Record<string, string>,
): Promise<void> {
  // Ensure legacy .rex/prd.json is migrated to folder-tree format before writing PRD
  const migrationResult = await ensureLegacyPrdMigrated(dir);

  const title = flags.title;
  if (!title) {
    throw new CLIError(
      "Missing required flag: --title",
      'Usage: rex add <level> --title="..." or rex add --title="..." --level=<level>',
    );
  }

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  // Emit migration notification to CLI and execution log
  await emitMigrationNotification(migrationResult, flags, (entry) => store.appendLog(entry));

  // Snapshot PRD tree before structural migration (backup for recovery on failure)
  let backupSnapshot = null;
  try {
    backupSnapshot = await snapshotPRDTree(rexDir);
  } catch (err) {
    // Best-effort: don't fail the command if backup creation fails
    warn(`Warning: Failed to create backup snapshot: ${String(err)}`);
  }

  // Run folder-per-task structural migration pass (pre-write check)
  const treeRoot = join(rexDir, "prd_tree");
  if (flags.format !== "json") {
    info("Checking PRD tree conformance...");
  }
  let folderPerTaskMigrationResult;
  try {
    folderPerTaskMigrationResult = await migrateToFolderPerTask(treeRoot);
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

  if (folderPerTaskMigrationResult.errors.length > 0) {
    for (const err of folderPerTaskMigrationResult.errors) {
      warn(`  Warning: ${err.error} (${err.path})`);
    }
  }
  if (folderPerTaskMigrationResult.migratedCount > 0 && flags.format !== "json") {
    info(`Migrated ${folderPerTaskMigrationResult.migratedCount} item${folderPerTaskMigrationResult.migratedCount === 1 ? "" : "s"} to folder-per-task form.`);
  }

  // Prune old backups if migrations were applied
  if (folderPerTaskMigrationResult.migratedCount > 0) {
    try {
      await pruneBackups(rexDir, 10);
    } catch {
      // Best-effort: don't fail the command if pruning fails
    }
  }

  // Ensure the current branch's PRD file exists and is the write target.
  // resolveStore does a read-only lookup; resolvePRDFile creates the file if needed.
  if (store instanceof FileStore) {
    const branch = resolveGitBranch(dir);
    if (branch !== "unknown") {
      const resolution = await resolvePRDFile(rexDir, dir);
      store.setCurrentBranchFile(resolution.filename);
    }
  }

  const doc = await store.loadDocument();

  const parentId = flags.parent;

  // Infer level when not explicitly provided
  let resolvedLevel: string;
  if (level) {
    resolvedLevel = level;
  } else if (parentId) {
    // Infer from parent: epic→feature, feature→task, task→subtask
    const parentEntry = findItem(doc.items, parentId);
    if (!parentEntry) {
      throw new CLIError(
        `Parent "${parentId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }
    const inferred = CHILD_LEVEL[parentEntry.item.level];
    if (!inferred) {
      throw new CLIError(
        `Cannot infer child level for parent type "${parentEntry.item.level}".`,
        'Specify the level explicitly with --level=<level> or as a positional argument.',
      );
    }
    resolvedLevel = inferred;
  } else {
    // No parent, no level → default to epic
    resolvedLevel = "epic";
  }

  if (!isItemLevel(resolvedLevel)) {
    throw new CLIError(
      `Invalid level "${resolvedLevel}".`,
      `Must be one of: ${Object.keys(LEVEL_HIERARCHY).join(", ")}`,
    );
  }

  // Validate parent-child level relationship
  const allowedParents = LEVEL_HIERARCHY[resolvedLevel as ItemLevel];
  const canBeRoot = allowedParents.includes(null);
  const allowedParentLevels = allowedParents.filter((p): p is ItemLevel => p !== null);

  if (!canBeRoot && !parentId) {
    const parentNames = allowedParentLevels.join(" or ");
    throw new CLIError(
      `A ${resolvedLevel} requires a parent.`,
      `Use --parent=<id> to specify a ${parentNames}.`,
    );
  }

  if (parentId) {
    // Re-fetch parent (may already have it from inference, but need it for validation too)
    const parentEntry = findItem(doc.items, parentId);
    if (!parentEntry) {
      throw new CLIError(
        `Parent "${parentId}" not found.`,
        "Check the ID with 'rex status' and try again.",
      );
    }
    if (allowedParentLevels.length > 0 && !allowedParentLevels.includes(parentEntry.item.level)) {
      const parentNames = allowedParentLevels.join(" or ");
      throw new CLIError(
        `A ${resolvedLevel} must be a child of a ${parentNames}, but "${parentId}" is a ${parentEntry.item.level}.`,
        `Use --parent=<id> to specify a ${parentNames} instead.`,
      );
    }
  }

  const id = randomUUID();
  const item: PRDItem = {
    id,
    title,
    status: (flags.status as ItemStatus) ?? "pending",
    level: resolvedLevel as ItemLevel,
  };

  if (flags.description) item.description = flags.description;
  if (flags.priority) item.priority = flags.priority as Priority;

  if (flags.blockedBy) {
    const deps = flags.blockedBy.split(",").map((s) => s.trim()).filter(Boolean);
    if (deps.length > 0) {
      item.blockedBy = deps;
    }
  }

  // Validate dependencies before persisting
  if (item.blockedBy && item.blockedBy.length > 0) {
    const doc = await store.loadDocument();
    // Simulate adding the item to validate the DAG
    const simItems = [...doc.items, item];
    const dagResult = validateDAG(simItems);
    if (!dagResult.valid) {
      throw new CLIError(
        `Invalid dependencies: ${dagResult.errors.join("; ")}`,
        "Check the IDs with 'rex status' and ensure no cycles exist.",
      );
    }
  }

  await store.addItem(item, parentId, { applyAttribution: true, projectDir: dir });

  // Reset completed ancestors when adding under a completed parent
  const { resetItems } = await cascadeParentReset(store, parentId, {
    applyAttribution: true,
    projectDir: dir,
  });

  // Log the addition with migration details
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "item_added",
    itemId: id,
    detail: JSON.stringify({
      addedItem: `${resolvedLevel}: ${title}`,
      folderPerTaskMigrations: folderPerTaskMigrationResult.migratedCount,
      migrations: folderPerTaskMigrationResult.migrations.map((m) => ({
        type: m.type,
        beforePath: m.beforePath,
        afterPath: m.afterPath,
      })),
    }),
  });

  // Persist the updated tree to the folder structure.
  await syncFolderTree(rexDir, store);

  // Run scoped hash-suffix consolidation pass on siblings of the new item.
  // Skipped when --no-reshape is set or a full ndx reshape is in progress.
  const consolidation = await runScopedConsolidationPass(rexDir, store, id, flags);

  // Compute the folder-tree path where the item was written.
  const updatedDoc = await store.loadDocument();
  const folderTreePath = getFolderTreePath(updatedDoc.items, id);

  if (flags.format === "json") {
    result(
      JSON.stringify(
        { id, level: resolvedLevel, title, resetItems, ...(folderTreePath ? { folderTreePath } : {}) },
        null,
        2,
      ),
    );
  } else {
    if (folderTreePath) {
      result(`Added to: ${folderTreePath}`);
    }
    result(`Created ${resolvedLevel}: ${title}`);
    result(`  ID: ${id}`);
    for (const ri of resetItems) {
      info(`  ↺ Reset ${ri.level}: ${ri.title} (was completed)`);
    }
    if (consolidation.mergedCount > 0) {
      info(`  Consolidated ${consolidation.mergedCount} duplicate sibling${consolidation.mergedCount === 1 ? "" : "s"} under ${consolidation.parentLabel}`);
    }
  }
}

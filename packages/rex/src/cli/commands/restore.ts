/**
 * `rex restore` — roll the PRD tree back to a snapshot taken before a
 * mutating command ran.
 *
 * Snapshots are created automatically by commands that rewrite the tree (see
 * `core/backup-snapshots.ts`). This command is the user-facing half: without
 * it, the snapshots existed on disk but there was no supported way to use
 * them, so recovery meant hand-copying directories.
 *
 * @module cli/commands/restore
 */

import { join } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { CLIError, requireRexDir } from "../errors.js";
import { info, result, warn } from "../output.js";
import { REX_DIR } from "./constants.js";
import { getAvailableBackups, restoreFromBackup } from "../../core/backup-snapshots.js";

/** Render a snapshot id back into a readable timestamp. */
function formatSnapshotId(id: string): string {
  // Ids are ISO-8601 with colons replaced by dashes. Put them back for display
  // only — the on-disk name must stay colon-free for Windows.
  const restored = id.replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3");
  return restored;
}

/** Count files in a snapshot so the user can sanity-check size before restoring. */
async function countFiles(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) total += await countFiles(join(dir, entry.name));
    else total++;
  }
  return total;
}

async function confirmPrompt(question: string): Promise<boolean> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

export async function cmdRestore(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  requireRexDir(dir);
  const rexDir = join(dir, REX_DIR);
  const backupsDir = join(rexDir, ".backups");
  const isJson = flags.format === "json";

  const snapshots = await getAvailableBackups(rexDir);

  if (snapshots.length === 0) {
    if (isJson) {
      result(JSON.stringify({ snapshots: [], restored: null }, null, 2));
      return;
    }
    warn("No PRD snapshots found.");
    info(
      "Snapshots are written to .rex/.backups/ before commands that rewrite the tree.\n" +
        "If you are on a version older than the Windows snapshot fix, no snapshots were\n" +
        "ever created on Windows — recover from git instead (`git restore -- .rex`).",
    );
    return;
  }

  // No target given: list what is available and stop. Listing must never mutate.
  const requested = flags.id ?? flags.snapshot ?? null;
  if (requested === null && flags.latest !== "true") {
    if (isJson) {
      result(JSON.stringify({ snapshots }, null, 2));
      return;
    }
    info(`Available PRD snapshots (newest first):\n`);
    for (const [index, id] of snapshots.entries()) {
      const files = await countFiles(join(backupsDir, `prd_tree_${id}`));
      const marker = index === 0 ? " (latest)" : "";
      result(`  ${formatSnapshotId(id)}  ${files} files${marker}`);
    }
    info(
      `\nRestore with:\n` +
        `  rex restore --latest ${dir}\n` +
        `  rex restore --id=${snapshots[0]} ${dir}`,
    );
    return;
  }

  const targetId = flags.latest === "true" ? snapshots[0] : requested!;
  const targetPath = join(backupsDir, `prd_tree_${targetId}`);

  const exists = await stat(targetPath)
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (!exists) {
    throw new CLIError(
      `Snapshot not found: ${targetId}`,
      `Run 'rex restore ${dir}' to list available snapshots.`,
    );
  }

  const fileCount = await countFiles(targetPath);

  // Restoring deletes the live tree. Confirm unless explicitly waived.
  const skipConfirm = flags.yes === "true" || isJson || !process.stdin.isTTY;
  if (!skipConfirm) {
    warn(
      `This replaces .rex/prd_tree/ with snapshot ${formatSnapshotId(targetId)} ` +
        `(${fileCount} files).\nAny PRD change made after that snapshot will be lost.`,
    );
    const confirmed = await confirmPrompt("Proceed with restore? (y/n) ");
    if (!confirmed) {
      info("Restore cancelled — nothing changed.");
      return;
    }
  }

  await restoreFromBackup(rexDir, targetId);

  if (isJson) {
    result(JSON.stringify({ restored: targetId, files: fileCount }, null, 2));
    return;
  }
  result(`Restored PRD tree from snapshot ${formatSnapshotId(targetId)} (${fileCount} files).`);
  info(`The snapshot remains in .rex/.backups/ — restoring does not consume it.`);
}

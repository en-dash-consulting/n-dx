/**
 * Migration command: rename the PRD tree to id-qualified slugs in one pass.
 *
 * `slugify()` used to emit title-only slugs — the `-{id6}` suffix appeared
 * only for long titles or same-tree sibling collisions. Same-titled items
 * created on divergent branches therefore collided on identical paths, and a
 * rename relocated an item's files. Every new write is now id-qualified; this
 * command brings an existing tree onto the new scheme deliberately, in one
 * reviewable commit, instead of letting the next ordinary save produce a
 * surprise mass diff.
 *
 * The mechanics are a canonicalizing round-trip: load the tree through the
 * store, save it back inside a transaction. The serializer writes every item
 * at its id-qualified path and removes the title-only entries — the stale-save
 * guard permits those deletions because they were part of the loaded snapshot.
 *
 * Idempotent: a second run finds every entry already id-qualified and changes
 * nothing.
 *
 * @module rex/cli/commands/migrate-slugs
 */

import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { resolveStore, PRD_TREE_DIRNAME } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { info, result } from "../output.js";
import { ensureSnapshot } from "../snapshot-guard.js";

/**
 * `rex migrate-slugs [dir]`
 *
 * Rename every folder-tree entry to its id-qualified slug.
 */
export async function cmdMigrateSlugs(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const rexDir = join(dir, REX_DIR);
  const treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  const store = await resolveStore(rexDir);

  const before = await listTree(treeRoot);
  if (before.length === 0) {
    throw new CLIError(
      "No PRD tree found — nothing to migrate.",
      `Expected a folder tree at ${treeRoot}. Run 'rex migrate-to-folder-tree' first if the PRD is still in a legacy format.`,
    );
  }

  // Snapshot first so `rex restore` can undo a migration gone wrong.
  await ensureSnapshot(rexDir, "migrate-slugs", flags);

  // Load + save under one lock: the serializer emits id-qualified paths and
  // removes the title-only entries it loaded.
  await store.withTransaction(async () => {});

  const after = await listTree(treeRoot);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const renamed = before.filter((p) => !afterSet.has(p)).length;
  const unchanged = before.filter((p) => beforeSet.has(p) && afterSet.has(p)).length;

  if (flags.format === "json") {
    result(JSON.stringify({ entriesRenamed: renamed, entriesUnchanged: unchanged }, null, 2));
    return;
  }

  if (renamed === 0) {
    result("PRD tree already uses id-qualified slugs — nothing to rename.");
    return;
  }
  result(`Renamed ${renamed} entr${renamed === 1 ? "y" : "ies"} to id-qualified slugs (${unchanged} already canonical).`);
  info("Commit the renamed tree so divergent branches stop colliding on same-titled items.");
}

/** All tree-entry paths (relative), sorted — dotfiles and non-md noise excluded. */
async function listTree(dir: string, prefix = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out.push(rel);
      out.push(...(await listTree(join(dir, entry.name), rel)));
    } else if (entry.name.endsWith(".md")) {
      out.push(rel);
    }
  }
  return out.sort();
}

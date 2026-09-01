/**
 * Migration command: rename the PRD tree to the current slug rule in one pass.
 *
 * Slugs are title-only; the id lives in front matter. A tree written by a build
 * older than that rule carries a `-{id6}` suffix on every path, and this
 * command brings it onto the current rule deliberately — in one reviewable
 * commit — instead of letting the next ordinary save produce a surprise mass
 * diff.
 *
 * ## Why this renames on disk instead of re-saving
 *
 * The obvious implementation is a canonicalizing round-trip: load through the
 * store, save back, let the serializer write every item at its new path. That
 * works, but it is not a *rename* — the serializer normalizes as it writes
 * (field order, `acceptanceCriteria: []` on items that had none), so git scores
 * the moves as ~R081 and a reviewer of an 800-file migration has to read
 * content diffs to satisfy themselves nothing else changed.
 *
 * So the renames go through `fs.rename`, leaving leaf files byte-identical
 * (`R100`). Only `index.md` files change content, and only in their children
 * table, because that table embeds sibling slugs — the one thing a rename must
 * alter. Nothing else about an item is touched.
 *
 * Idempotent: a second run finds every path already canonical and does nothing.
 *
 * Refuses to run while two siblings' titles normalise to the same slug.
 * Ordinary writes disambiguate those with a suffix to avoid losing an item, but
 * a migration whose purpose is readable paths should not quietly bake a suffix
 * in — consolidate the duplicates first.
 *
 * @module rex/cli/commands/migrate-slugs
 */

import { join, dirname } from "node:path";
import { readdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolveStore, PRD_TREE_DIRNAME, resolveSiblingSlugs, slugify } from "../../store/index.js";
import type { PRDItem } from "../../schema/index.js";
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

  const doc = await store.loadDocument();

  // Refuse before touching anything: a collision means the readable form is
  // ambiguous, and the fix is to consolidate the items, not to suffix them.
  const collisions = findTitleCollisions(doc.items);
  if (collisions.length > 0) {
    throw new CLIError(
      `Sibling title collision — ${collisions.length} group(s) would need a suffix to stay distinct:\n` +
        collisions.map((c) => `  ${c}`).join("\n"),
      "Merge or retitle the duplicates first (see 'rex merge'), then re-run. Ordinary writes disambiguate these automatically; a migration should not bake the suffix in.",
    );
  }

  // Snapshot first so `rex restore` can undo a migration gone wrong.
  await ensureSnapshot(rexDir, "migrate-slugs", flags);

  const moves = await planRenames(doc.items, treeRoot);
  if (moves.length === 0) {
    if (flags.format === "json") {
      result(JSON.stringify({ entriesRenamed: 0, entriesUnchanged: before.length }, null, 2));
      return;
    }
    result("PRD tree already matches the current slug rule — nothing to rename.");
    return;
  }

  // Deepest first so a parent's rename never invalidates a pending child path.
  for (const move of [...moves].sort((a, b) => b.depth - a.depth)) {
    await rename(move.from, move.to);
  }

  // The children tables embed sibling slugs, so they are the one thing a
  // rename has to rewrite. Patch just those links — re-serializing the file
  // would renormalise its front matter and stop this being a rename.
  await repointChildLinks(treeRoot, moves);

  const after = await listTree(treeRoot);
  // Count by comparing path sets rather than subtracting move count from the
  // total: an index.md moves with its parent directory without being a move of
  // its own, so the subtraction reported those files as "already canonical"
  // when they had in fact just been relocated.
  const afterSet = new Set(after);
  const unchanged = before.filter((path) => afterSet.has(path)).length;

  if (flags.format === "json") {
    result(
      JSON.stringify({ entriesRenamed: moves.length, entriesUnchanged: unchanged }, null, 2),
    );
    return;
  }
  result(
    `Renamed ${moves.length} entr${moves.length === 1 ? "y" : "ies"} to the current slug rule ` +
      `(${unchanged} of ${before.length} path${before.length === 1 ? "" : "s"} already canonical).`,
  );
  info("Commit the renamed tree as its own change — leaf files are byte-identical renames.");
}

interface PlannedMove {
  from: string;
  to: string;
  /** Nesting depth, so renames can be applied deepest-first. */
  depth: number;
  /** Directory holding the entry, for link repointing. */
  parentDir: string;
  oldEntry: string;
  newEntry: string;
}

/** Sibling groups whose titles normalise to the same slug, described for the operator. */
function findTitleCollisions(items: PRDItem[], path = "(root)"): string[] {
  const out: string[] = [];
  const bySlug = new Map<string, PRDItem[]>();
  for (const item of items) {
    const key = slugify(item.title, item.id);
    const list = bySlug.get(key) ?? [];
    list.push(item);
    bySlug.set(key, list);
  }
  for (const [slug, group] of bySlug) {
    if (group.length > 1) {
      out.push(`${path}: "${slug}" wanted by ${group.map((g) => `"${g.title}"`).join(", ")}`);
    }
  }
  for (const item of items) {
    if (item.children?.length) out.push(...findTitleCollisions(item.children, `${path}/${slugify(item.title, item.id)}`));
  }
  return out;
}

/**
 * Match each item to its entry on disk and compute where it belongs.
 *
 * Items are located by front-matter id rather than by guessing the old slug
 * rule: the tree may have been written by any older build, and the point is to
 * be indifferent to which.
 */
async function planRenames(
  items: PRDItem[],
  treeRoot: string,
  depth = 0,
): Promise<PlannedMove[]> {
  const moves: PlannedMove[] = [];
  let entries: string[];
  try {
    entries = await readdir(treeRoot);
  } catch {
    return moves;
  }

  const expected = resolveSiblingSlugs(items);

  for (const item of items) {
    const children = item.children ?? [];
    const isDir = children.length > 0;
    const want = expected.get(item.id)!;
    const wantEntry = isDir ? want : `${want}.md`;

    const found = await locateEntryById(treeRoot, entries, item.id, isDir);
    if (!found) continue; // Absent on disk — a different fault, reported elsewhere.

    if (found !== wantEntry) {
      moves.push({
        from: join(treeRoot, found),
        to: join(treeRoot, wantEntry),
        depth,
        parentDir: treeRoot,
        oldEntry: found,
        newEntry: wantEntry,
      });
    }

    if (isDir) {
      // Recurse into the entry at its CURRENT name; the rename happens later.
      moves.push(...(await planRenames(children, join(treeRoot, found), depth + 1)));
    }
  }
  return moves;
}

/** Entry in `dir` whose front-matter id is `id`. */
async function locateEntryById(
  dir: string,
  entries: readonly string[],
  id: string,
  wantDirectory: boolean,
): Promise<string | undefined> {
  for (const entry of entries) {
    if (entry === "tree-meta.json") continue;
    if (wantDirectory === entry.endsWith(".md")) continue;
    if (entry === "index.md") continue;
    const file = wantDirectory ? join(dir, entry, "index.md") : join(dir, entry);
    try {
      const raw = await readFile(file, "utf8");
      if (new RegExp(`^id:\\s*"?${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"?\\s*$`, "m").test(raw)) {
        return entry;
      }
    } catch {
      // Unreadable or not the shape being looked for.
    }
  }
  return undefined;
}

/** Rewrite children-table links that pointed at a renamed sibling. */
async function repointChildLinks(treeRoot: string, moves: readonly PlannedMove[]): Promise<void> {
  // Group by the directory whose index.md holds the links. After renaming,
  // that directory may itself have moved, so resolve against the final tree.
  const byParent = new Map<string, PlannedMove[]>();
  for (const move of moves) {
    const list = byParent.get(move.parentDir) ?? [];
    list.push(move);
    byParent.set(move.parentDir, list);
  }

  for (const [parentDir, group] of byParent) {
    const indexPath = await resolveMovedPath(treeRoot, parentDir, moves);
    const file = join(indexPath, "index.md");
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue; // The tree root has no index.md.
    }
    let next = text;
    for (const move of group) {
      const oldLink = move.oldEntry.endsWith(".md") ? move.oldEntry : `${move.oldEntry}/index.md`;
      const newLink = move.newEntry.endsWith(".md") ? move.newEntry : `${move.newEntry}/index.md`;
      next = next.split(`./${oldLink}`).join(`./${newLink}`);
    }
    if (next !== text) await writeFile(file, next, "utf8");
  }
}

/** Translate a pre-rename directory path into its post-rename location. */
async function resolveMovedPath(
  treeRoot: string,
  dir: string,
  moves: readonly PlannedMove[],
): Promise<string> {
  if (dir === treeRoot) return dir;
  const parent = await resolveMovedPath(treeRoot, dirname(dir), moves);
  const base = dir.slice(dirname(dir).length + 1);
  const moved = moves.find((m) => m.parentDir === dirname(dir) && m.oldEntry === base);
  return join(parent, moved ? moved.newEntry : base);
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

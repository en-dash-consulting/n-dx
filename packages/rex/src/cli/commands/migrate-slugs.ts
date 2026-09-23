/**
 * Migration command: bring the PRD tree onto the current slug rule in one pass.
 *
 * The rule is title-only, with a `-{id6}` suffix added only where siblings
 * collide on a normalised title. It replaced a rule that suffixed every slug
 * unconditionally. This command performs the rename deliberately, in one
 * reviewable commit, instead of letting the next ordinary save produce a
 * surprise mass diff.
 *
 * The mechanics are a canonicalizing round-trip: load the tree through the
 * store, save it back inside a transaction. The serializer writes every item
 * at its current-rule path and removes the entries written under the old one —
 * the stale-save guard permits those deletions because they were part of the
 * loaded snapshot. Because it round-trips rather than encoding a rule of its
 * own, this command follows the serializer automatically.
 *
 * Idempotent: a second run finds every entry already canonical and changes
 * nothing.
 *
 * @module rex/cli/commands/migrate-slugs
 */

import { join } from "node:path";
import { readdir } from "node:fs/promises";
import {
  resolveStore,
  PRD_TREE_DIRNAME,
  SLUG_RULE_VERSION,
  readSlugRuleMarker,
} from "../../store/index.js";
import {
  findUnresolvableSiblingCollisions,
  fingerprintTree,
  diffFingerprints,
  isLossless,
} from "../../core/slug-migration.js";
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

  // Refuse a downgrade before anything is written, including the snapshot.
  // This command rewrites the tree under *this* build's rule, so it can only
  // move a tree forwards or hold it still. Pointed at a tree written by a
  // newer rule it would rename every path backwards and stamp the older
  // marker over the newer one — and since the newer build then refuses the
  // tree in turn, the two can trade whole-tree renames indefinitely.
  const markerBefore = await readSlugRuleMarker(rexDir);
  if (markerBefore !== undefined && markerBefore > SLUG_RULE_VERSION) {
    throw new CLIError(
      `The PRD tree was written under slug rule ${markerBefore}, which is newer than the rule ${SLUG_RULE_VERSION} this build implements.`,
      `Migrating would rewrite every path under the superseded rule and record rule ${SLUG_RULE_VERSION} over the newer marker. ` +
        `Upgrade rex to a build that implements slug rule ${markerBefore} instead.`,
    );
  }

  // Refuse before touching anything if the tree holds a collision the slug
  // rule cannot resolve. Same-titled siblings are ordinary — they take an
  // `-{id6}` suffix. Siblings sharing a title *and* an id are not: the
  // serializer would fall back to position suffixes, making those paths depend
  // on array order.
  const beforeDoc = await store.loadDocument();
  const unresolvable = findUnresolvableSiblingCollisions(beforeDoc.items);
  if (unresolvable.length > 0) {
    const offenders = unresolvable
      .slice(0, 10)
      .map((c) => `  ${c.slug} — id "${c.id}" claimed by ${c.count} siblings: ${c.titles.join(", ")}`)
      .join("\n");
    throw new CLIError(
      `${unresolvable.length} sibling collision${unresolvable.length === 1 ? "" : "s"} cannot be resolved by the slug rule.`,
      `Two siblings share both a title and an id, so they compile to the same slug:\n${offenders}\n` +
        `Give them distinct ids (or merge them) and re-run. 'rex validate' reports the same duplicate ids.`,
    );
  }
  const beforePrints = fingerprintTree(beforeDoc.items);

  // Snapshot first so `rex restore` can undo a migration gone wrong.
  await ensureSnapshot(rexDir, "migrate-slugs", flags);

  // Load + save under one lock: the serializer emits current-rule paths and
  // removes the entries it loaded from the superseded ones, and the same write
  // records the slug-rule marker. This is the only call that may go past the
  // write guard — an ordinary save against a tree on a superseded rule is
  // refused, because re-slugging is exactly what this command exists to do
  // deliberately and no other command should do at all.
  if (!store.adoptSlugRule) {
    throw new CLIError(
      "This PRD backend cannot migrate slugs.",
      `Slugs are a property of the local folder tree; the resolved store is a remote adapter with no paths to rename.`,
    );
  }
  await store.adoptSlugRule();

  // Prove the rename was lossless by reading the tree back. Git similarity
  // scores cannot do this: a container's index.md lists its children's paths,
  // so renaming a child rewrites its parent and reports below R100 while
  // nothing has actually been lost.
  const afterDoc = await store.loadDocument();
  const diff = diffFingerprints(beforePrints, fingerprintTree(afterDoc.items));
  if (!isLossless(diff)) {
    const parts = [
      diff.lost.length > 0 ? `${diff.lost.length} lost (${diff.lost.slice(0, 5).join(", ")})` : "",
      diff.gained.length > 0 ? `${diff.gained.length} appeared (${diff.gained.slice(0, 5).join(", ")})` : "",
      diff.changed.length > 0 ? `${diff.changed.length} altered (${diff.changed.slice(0, 5).join(", ")})` : "",
    ].filter(Boolean);
    throw new CLIError(
      `The rename was not lossless: ${parts.join("; ")}.`,
      `A slug migration must only move files. Restore the pre-migration snapshot with 'rex restore' and report this — ` +
        `the tree on disk no longer round-trips through the parser.`,
    );
  }

  const after = await listTree(treeRoot);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const renamed = before.filter((p) => !afterSet.has(p)).length;
  const unchanged = before.filter((p) => beforeSet.has(p) && afterSet.has(p)).length;

  if (flags.format === "json") {
    result(
      JSON.stringify(
        {
          entriesRenamed: renamed,
          entriesUnchanged: unchanged,
          // A non-lossless rename throws above, so reaching here proves it.
          itemsVerified: beforePrints.size,
          lossless: true,
          // The other half of this command's job, and invisible in the counts:
          // a tree with no marker is refused by every writer, so a run that
          // renamed nothing may still be the run that unblocked the repository.
          // `entriesRenamed: 0` alone reads as "nothing happened".
          slugRuleRecorded: markerBefore !== SLUG_RULE_VERSION,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (renamed === 0) {
    // "Nothing to rename" is only the whole story when nothing changed at all.
    // A run that recorded the marker on a previously unmarked tree did the
    // other half of this command's job, and reporting it as a no-op hides the
    // one write that unblocks every subsequent save.
    result(
      markerBefore === SLUG_RULE_VERSION
        ? "PRD tree already uses the current slug rule — nothing to rename."
        : `PRD tree paths already match slug rule ${SLUG_RULE_VERSION} — nothing to rename; recorded the slug-rule marker.`,
    );
    return;
  }
  result(`Renamed ${renamed} entr${renamed === 1 ? "y" : "ies"} to readable slugs (${unchanged} already canonical).`);
  info(`Verified lossless: all ${beforePrints.size} items round-tripped with their fields intact.`);
  info("Commit the renamed tree. Expect sub-R100 similarity on container index.md files — they list their children's paths.");
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

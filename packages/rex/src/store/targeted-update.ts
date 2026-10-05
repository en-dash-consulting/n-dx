/**
 * Single-item write path for `performance.fastWrites`.
 *
 * Changing one field of one item — a status transition, most often — goes
 * through the full serializer by default: the whole document is handed to
 * `serializeFolderTree`, which walks every directory in the tree and reads
 * every item file to work out that all but one of them is unchanged. On a
 * 431-item PRD that is roughly half a second of pure comparison to write one
 * line.
 *
 * This module writes just the files that actually differ. For a field-only
 * update that is at most two:
 *
 *   - the item's own file, because its frontmatter changed;
 *   - its **direct parent's** file, because a parent's `## Children` table
 *     prints each child's title and status, so a status change edits the
 *     parent too. Only the direct parent: a grandparent's table lists the
 *     parent, whose own title and status did not change.
 *
 * ## Why it refuses more than it accepts
 *
 * The fast path is only correct while the change cannot move a file. A title
 * change re-slugs the item's directory, and can renumber *siblings'*
 * directories through `resolveSiblingSlugs`; adding a child promotes a leaf
 * `<slug>.md` into `<slug>/index.md`; a level change alters placement. Each
 * of those is a tree-shaped edit wearing a field update's clothes.
 *
 * Rather than enumerate the safe mutations, this asks two questions that are
 * cheap and total:
 *
 *   1. Did anything structural change — id, title, level, or the set of
 *      children? (Compared against a pre-image taken before the mutation.)
 *   2. Does the path the parser actually read this item from match the path
 *      the serializer's own rules say it belongs at?
 *
 * The second question is what makes legacy layouts safe by construction. A
 * folder item stored as `<title>.md` with no `index.md`, a flattened
 * single-child carrying `__parentId`, an item mid-relocation — all of them
 * sit somewhere the serializer would not put them, so all of them answer
 * "no" and take the full write, which is the thing that knows how to move
 * them.
 *
 * Anything that is not a plain "yes" returns {@link TargetedWriteOutcome}
 * `"declined"` and the caller performs the ordinary full write. Declining is
 * always safe; the flag only ever buys speed.
 *
 * @module rex/store/targeted-update
 */

import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { PRDItem } from "../schema/index.js";
import { atomicWriteTempPath } from "./atomic-write.js";
import { renderItemIndexMd, resolveSiblingSlugs } from "./folder-tree-serializer.js";
import { digestItemFile } from "./folder-tree-parser.js";

/** What a targeted write attempt did. */
export type TargetedWriteOutcome =
  | { kind: "written"; files: Map<string, string> }
  | { kind: "declined"; reason: string };

/** The fields whose change would move a file rather than just rewrite one. */
export interface ItemPreImage {
  id: string;
  title: string;
  level: string;
  /** Child ids in order — a change here rewrites the children table and may promote a leaf. */
  childIds: string[];
}

/** Capture the structural shape of an item before a mutation. */
export function preImageOf(item: PRDItem): ItemPreImage {
  return {
    id: item.id,
    title: item.title,
    level: String(item.level),
    childIds: (item.children ?? []).map((c) => c.id),
  };
}

function sameShape(before: ItemPreImage, after: PRDItem): string | null {
  if (before.id !== after.id) return "id changed";
  if (before.title !== after.title) return "title changed (the directory slug derives from it)";
  if (before.level !== String(after.level)) return "level changed";
  const afterChildren = (after.children ?? []).map((c) => c.id);
  if (afterChildren.length !== before.childIds.length) return "children added or removed";
  for (let i = 0; i < afterChildren.length; i++) {
    if (afterChildren[i] !== before.childIds[i]) return "children reordered or replaced";
  }
  return null;
}

/**
 * Where the serializer's own rules place an item, given its ancestors.
 *
 * Mirrors the placement `serializeFolderTree` performs: a directory per
 * non-leaf item holding `index.md`, and a bare `<slug>.md` beside the parent
 * for a leaf. Slugs come from `resolveSiblingSlugs`, the same function the
 * serializer uses, so collision suffixes resolve identically.
 *
 * Only ever used to *compare* against the path the parser read, never to
 * decide where to write — a mismatch declines the fast path.
 */
function expectedPathFor(
  treeRoot: string,
  chain: Array<{ siblings: PRDItem[]; item: PRDItem }>,
): string | null {
  let dir = treeRoot;
  for (let i = 0; i < chain.length; i++) {
    const { siblings, item } = chain[i];
    const slug = resolveSiblingSlugs(siblings).get(item.id);
    if (!slug) return null;
    const isLast = i === chain.length - 1;
    const isLeaf = (item.children?.length ?? 0) === 0;
    if (isLast) {
      return isLeaf ? join(dir, `${slug}.md`) : join(dir, slug, "index.md");
    }
    dir = join(dir, slug);
  }
  return null;
}

/**
 * Locate an item and every ancestor above it, each paired with the sibling
 * list its slug is resolved against.
 */
function chainTo(
  items: PRDItem[],
  id: string,
): Array<{ siblings: PRDItem[]; item: PRDItem }> | null {
  for (const item of items) {
    if (item.id === id) return [{ siblings: items, item }];
    const below = item.children ? chainTo(item.children, id) : null;
    if (below) return [{ siblings: items, item }, ...below];
  }
  return null;
}

async function atomicWriteFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = atomicWriteTempPath(path);
  await writeFile(temp, content, "utf-8");
  await rename(temp, path);
}

/**
 * Attempt a targeted write of one item (and its parent's children table).
 *
 * The caller must already hold the PRD lock and must have validated the
 * document — this writes, it does not check.
 *
 * @param treeRoot    `.rex/prd_tree/`.
 * @param items       The whole document's items, already mutated.
 * @param id          The item that changed.
 * @param before      Its shape before the mutation, from {@link preImageOf}.
 * @param knownPaths  `itemFiles` from the parse this mutation was built on.
 * @returns The files written and their new digests, or why it declined.
 */
export async function tryTargetedItemWrite(
  treeRoot: string,
  items: PRDItem[],
  id: string,
  before: ItemPreImage,
  knownPaths: ReadonlyMap<string, string>,
): Promise<TargetedWriteOutcome> {
  const chain = chainTo(items, id);
  if (!chain) return { kind: "declined", reason: "item not found in the document" };

  const target = chain[chain.length - 1].item;
  const shapeChange = sameShape(before, target);
  if (shapeChange) return { kind: "declined", reason: shapeChange };

  // Ground truth vs. the serializer's rules. Disagreement means this item is
  // not where a full write would keep it, so only a full write may move it.
  const actualPath = knownPaths.get(id);
  if (!actualPath) {
    return { kind: "declined", reason: "item has no recorded source file (legacy subtask section?)" };
  }
  const expected = expectedPathFor(treeRoot, chain);
  if (!expected || resolve(expected) !== resolve(actualPath)) {
    return { kind: "declined", reason: "on-disk path differs from the canonical path" };
  }

  // Everything is decided before anything is written. A decline after a
  // partial write would leave the tree in a state the caller's fallback
  // would repair, but "the fallback cleans up after us" is a worse contract
  // than "we wrote nothing".
  const plan: Array<{ path: string; content: string }> = [
    {
      path: actualPath,
      content: renderItemIndexMd(
        target,
        target.children ?? [],
        resolveSiblingSlugs(target.children ?? []),
      ),
    },
  ];

  // The parent's children table prints this item's title and status.
  if (chain.length >= 2) {
    const parent = chain[chain.length - 2].item;
    const parentPath = knownPaths.get(parent.id);
    const parentExpected = expectedPathFor(treeRoot, chain.slice(0, -1));
    if (!parentPath || !parentExpected || resolve(parentExpected) !== resolve(parentPath)) {
      return { kind: "declined", reason: "parent's on-disk path differs from the canonical path" };
    }
    plan.push({
      path: parentPath,
      content: renderItemIndexMd(
        parent,
        parent.children ?? [],
        resolveSiblingSlugs(parent.children ?? []),
      ),
    });
  }

  const written = new Map<string, string>();
  for (const { path, content } of plan) {
    await atomicWriteFile(path, content);
    written.set(resolve(path), digestItemFile(content));
  }

  return { kind: "written", files: written };
}

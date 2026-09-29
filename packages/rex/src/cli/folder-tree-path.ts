/**
 * Utilities for computing folder-tree paths for PRD items.
 */

import { relative } from "node:path";

import type { PRDItem } from "../schema/index.js";
import { findItem } from "../core/tree.js";
import { resolveSiblingSlugs, resolveRexPaths } from "../store/index.js";

/**
 * Compute the folder-tree path for a given item, mirroring the on-disk
 * layout the serializer produces.
 *
 * An item with children gets its own slug-named folder containing
 * `index.md`; an item with no children (any level) is stored as a bare
 * `<slug>.md` file inside its parent's folder. For leaves we therefore
 * return the path to the `.md` file rather than a non-existent folder.
 *
 * The result is relative to `root` — this is a path an operator reads or pastes,
 * so it is anchored to the project rather than the filesystem. `root` is
 * required because the tree's own location depends on the folder layout.
 */
export function getFolderTreePath(items: PRDItem[], itemId: string, root: string): string | undefined {
  const entry = findItem(items, itemId);
  if (!entry) return undefined;

  const { item, parents } = entry;

  // A slug is a property of a sibling set, so each level is resolved against
  // the siblings it actually sits among — walking down from the root rather
  // than slugifying each ancestor in isolation.
  const pathSegments = [
    relative(root, resolveRexPaths(root).prdTreeDir).replaceAll("\\", "/"),
  ];
  let level = items;
  for (const ancestor of parents) {
    pathSegments.push(resolveSiblingSlugs(level).get(ancestor.id) ?? "");
    level = ancestor.children ?? [];
  }

  const isLeaf = (item.children?.length ?? 0) === 0;
  const itemSlug = resolveSiblingSlugs(level).get(item.id) ?? "";
  pathSegments.push(isLeaf ? `${itemSlug}.md` : itemSlug);

  return pathSegments.join("/");
}

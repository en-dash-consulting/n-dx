/**
 * Utilities for computing folder-tree paths for PRD items.
 */

import type { PRDItem } from "../schema/index.js";
import { findItem } from "../core/tree.js";
import { resolveSiblingSlugs, PRD_TREE_DIRNAME } from "../store/index.js";

/**
 * Compute the folder-tree path for a given item, mirroring the on-disk
 * layout the serializer produces.
 *
 * An item with children gets its own slug-named folder containing
 * `index.md`; an item with no children (any level) is stored as a bare
 * `<slug>.md` file inside its parent's folder. For leaves we therefore
 * return the path to the `.md` file rather than a non-existent folder.
 */
export function getFolderTreePath(items: PRDItem[], itemId: string): string | undefined {
  const entry = findItem(items, itemId);
  if (!entry) return undefined;

  const { item, parents } = entry;

  // A slug is a property of a sibling set, so each level is resolved against
  // the siblings it actually sits among — walking down from the root rather
  // than slugifying each ancestor in isolation.
  const pathSegments = [".rex", PRD_TREE_DIRNAME];
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

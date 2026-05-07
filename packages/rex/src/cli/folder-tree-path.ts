/**
 * Utilities for computing folder-tree paths for PRD items.
 */

import type { PRDItem } from "../schema/index.js";
import { findItem } from "../core/tree.js";
import { slugify, PRD_TREE_DIRNAME } from "../store/index.js";

/**
 * Compute the folder-tree path for a given item, mirroring the on-disk layout
 * the serializer produces — including single-child compaction.
 *
 * The serializer collapses a feature-or-lower ancestor whose only child is the
 * next ancestor in the chain. Such ancestors are skipped here so the returned
 * path always points at a directory that actually exists on disk.
 */
export function getFolderTreePath(items: PRDItem[], itemId: string): string | undefined {
  const entry = findItem(items, itemId);
  if (!entry) return undefined;

  const { item, parents } = entry;

  // Build path segments: .rex/<PRD_TREE_DIRNAME>/<retained-ancestor-slugs>/<item-slug>
  const pathSegments = [".rex", PRD_TREE_DIRNAME];

  // The serializer only writes a directory for an ancestor when it is NOT
  // single-child-compacted. An ancestor is compacted when it is feature-or-
  // lower AND has exactly one child (the next ancestor or `item`).
  //
  // Walk the ancestor chain and skip any ancestor that qualifies for
  // compaction. Epics are never compacted, and ancestors with two or more
  // children are never compacted. The item itself always gets a directory
  // (because it is processed under the multi-child branch when it has zero or
  // multiple children, and when it has a single child of its own that child
  // is compacted into the item's directory rather than the other way around).
  for (const ancestor of parents) {
    const isFeatureOrLower = ancestor.level !== "epic";
    const childCount = (ancestor.children ?? []).length;
    if (isFeatureOrLower && childCount === 1) continue;
    pathSegments.push(slugify(ancestor.title, ancestor.id));
  }

  pathSegments.push(slugify(item.title, item.id));

  return pathSegments.join("/");
}

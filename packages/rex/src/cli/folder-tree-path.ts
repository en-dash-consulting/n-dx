/**
 * Utilities for computing folder-tree paths for PRD items.
 */

import type { PRDItem } from "../schema/index.js";
import { findItem } from "../core/tree.js";
import { slugify, PRD_TREE_DIRNAME } from "../store/index.js";

/**
 * Compute the folder-tree path for a given item.
 *
 * For subtasks, returns the path to the parent task's directory (since subtasks
 * are sections within the task's markdown file, stored in the task directory).
 *
 * For all other levels, returns the path to the item's directory.
 */
export function getFolderTreePath(items: PRDItem[], itemId: string): string | undefined {
  const entry = findItem(items, itemId);
  if (!entry) return undefined;

  const { item, parents } = entry;

  // Build path segments: .rex/<PRD_TREE_DIRNAME>/<ancestor-slugs>/<item-slug>
  const pathSegments = [".rex", PRD_TREE_DIRNAME];

  // Add ancestor slugs
  for (const ancestor of parents) {
    pathSegments.push(slugify(ancestor.title, ancestor.id));
  }

  // For all levels (including subtasks), add item slug and return the directory path
  // For subtasks, this is the parent task's directory where the subtask section is stored
  pathSegments.push(slugify(item.title, item.id));

  return pathSegments.join("/");
}

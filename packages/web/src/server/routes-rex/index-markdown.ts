/**
 * Server route for fetching index.md content from PRD folder tree.
 *
 * Fetches the generated index.md summary file for a PRD item,
 * which contains completion tables, commits, changes, and metadata sections.
 *
 * @module web/server/routes-rex/index-markdown
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPRDSync } from "../prd-io.js";
import { errorResponse } from "../response-utils.js";
import { PRD_TREE_DIRNAME, resolveSiblingSlugs, type PRDItem } from "../rex-gateway.js";
import type { ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";

/**
 * Build the root-to-target ancestor chain (inclusive) for an item, or null
 * if the item isn't in the tree.
 */
function findAncestorChain(items: PRDItem[], targetId: string, chain: PRDItem[] = []): PRDItem[] | null {
  for (const item of items) {
    const nextChain = [...chain, item];
    if (item.id === targetId) return nextChain;
    if (item.children) {
      const found = findAncestorChain(item.children, targetId, nextChain);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolve the on-disk location of a PRD item's markdown file.
 *
 * Uses `resolveSiblingSlugs` — the same slug-collision-resolution logic the
 * folder-tree serializer itself uses — rather than recomputing slugs with a
 * simplified standalone algorithm, so this always agrees with reality
 * regardless of collision suffixes or short-id disambiguation.
 *
 * Mirrors the serializer's folder-vs-leaf rule (see
 * folder-tree-serializer.ts): an item with children is `<slug>/index.md`;
 * an item with no children is a bare `<slug>.md` file in its *parent's*
 * directory, not its own directory.
 */
function resolveItemMdPath(treeRoot: string, allItems: PRDItem[], itemId: string): string | null {
  const chain = findAncestorChain(allItems, itemId);
  if (!chain) return null;

  let siblings = allItems;
  const dirSegments: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    const isTarget = i === chain.length - 1;
    const slugMap = resolveSiblingSlugs(siblings);
    const slug = slugMap.get(node.id);
    if (!slug) return null;

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    if (isTarget && !hasChildren) {
      // Leaf: bare `<slug>.md` at the current directory level.
      return join(treeRoot, ...dirSegments, `${slug}.md`);
    }

    dirSegments.push(slug);
    siblings = node.children ?? [];
  }

  // Every ancestor had children (we descended through all of them), so the
  // target itself is a folder item — its content lives at `index.md`.
  return join(treeRoot, ...dirSegments, "index.md");
}

/**
 * GET /api/rex/items/:id/index-md
 *
 * Fetch the raw markdown index.md file for a specific PRD item.
 * The index.md contains completion tables, commits, changes, and metadata sections.
 *
 * Response: text/markdown with raw markdown content
 * Status: 200 if found, 404 if not yet regenerated, 500 on error
 */
export function getIndexMarkdown(
  res: ServerResponse,
  ctx: ServerContext,
  itemId: string,
): boolean {
  const treeRoot = join(ctx.rexDir, PRD_TREE_DIRNAME);

  // Load PRD to get structure
  const prd = loadPRDSync(ctx.rexDir);
  if (!prd || !prd.items) {
    errorResponse(res, 500, "Failed to load PRD");
    return true;
  }

  // Resolve the item's markdown file path directly from the tree structure.
  const mdPath = resolveItemMdPath(treeRoot, prd.items, itemId);
  if (!mdPath) {
    errorResponse(res, 404, "Item not found in PRD");
    return true;
  }

  if (!existsSync(mdPath)) {
    errorResponse(res, 404, "index.md not yet generated for this item");
    return true;
  }

  // Read and return the file
  try {
    const content = readFileSync(mdPath, "utf-8");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.end(content);
    return true;
  } catch (err) {
    errorResponse(res, 500, `Failed to read index.md: ${String(err)}`);
    return true;
  }
}

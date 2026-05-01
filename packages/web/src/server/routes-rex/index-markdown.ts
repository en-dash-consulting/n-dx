/**
 * Server route for fetching index.md content from PRD folder tree.
 *
 * Fetches the generated index.md summary file for a PRD item,
 * which contains completion tables, commits, changes, and metadata sections.
 *
 * @module web/server/routes-rex/index-markdown
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadPRDSync } from "../prd-io.js";
import { jsonResponse, errorResponse } from "../response-utils.js";
import { PRD_TREE_DIRNAME } from "../rex-gateway.js";
import type { ServerResponse } from "node:http";
import type { ServerContext } from "../types.js";

/**
 * Build a map of item ID to parent for path traversal.
 */
function buildParentMap(items: any[], parentMap = new Map<string, any>()): Map<string, any> {
  for (const item of items) {
    if (item.children) {
      for (const child of item.children) {
        parentMap.set(child.id, item);
      }
      buildParentMap(item.children, parentMap);
    }
  }
  return parentMap;
}

/**
 * Find an item by ID in the tree.
 */
function findItemById(items: any[], targetId: string): any {
  for (const item of items) {
    if (item.id === targetId) return item;
    if (item.children) {
      const found = findItemById(item.children, targetId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Compute the directory slug for an item within its parent directory.
 * This is a simplified version — uses a basic slug algorithm.
 * TODO: Export the actual slugify function from rex package.
 */
function computeItemSlug(title: string, id: string): string {
  const titleSlug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Remove diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const id8 = id.replace(/-/g, "").slice(0, 8);
  return titleSlug ? `${titleSlug}-${id8}` : id8;
}

/**
 * Find the directory path for a PRD item in the folder tree.
 * Walks up the parent chain to build the full path.
 */
function findItemPath(
  itemId: string,
  treeRoot: string,
  allItems: any[],
  parentMap: Map<string, any>,
): string | null {
  const item = findItemById(allItems, itemId);
  if (!item) return null;

  // Walk up the tree to collect path segments
  const segments: string[] = [];
  let current: any = item;

  while (current) {
    const parent = parentMap.get(current.id);
    if (!parent) {
      // Top level (epic) — add it and break
      segments.unshift(computeItemSlug(current.title, current.id));
      break;
    }

    // Add current item's slug
    segments.unshift(computeItemSlug(current.title, current.id));
    current = parent;
  }

  return join(treeRoot, ...segments);
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

  // Build parent map for path traversal
  const parentMap = buildParentMap(prd.items);

  // Find item's directory
  const itemPath = findItemPath(itemId, treeRoot, prd.items, parentMap);
  if (!itemPath) {
    errorResponse(res, 404, "Item not found in PRD");
    return true;
  }

  // Try to find markdown file in the directory
  // Check for index.md or title-named .md files
  let mdPath: string | null = null;

  if (existsSync(itemPath)) {
    try {
      const files = readdirSync(itemPath);
      // Prefer title-named .md file, fall back to index.md
      for (const file of files) {
        if (file.endsWith(".md")) {
          mdPath = join(itemPath, file);
          break;
        }
      }
    } catch {
      // Fall through to error
    }
  }

  // Check if we found a markdown file
  if (!mdPath || !existsSync(mdPath)) {
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

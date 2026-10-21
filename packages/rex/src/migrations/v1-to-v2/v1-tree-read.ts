/**
 * The v1 item files the migration cannot see.
 *
 * The v1 store's load drops the parser's warnings, so an item whose file does
 * not parse — front matter left unclosed by a hand edit or a merge conflict —
 * is simply absent from what it returns. Plan, dry run and apply compare v2
 * against that load, so nothing downstream notices, and apply then removes
 * `prd_tree/` with the item's file in it. Planning and applying therefore
 * refuse while the parser skips any item.
 *
 * @module migrations/v1-to-v2/v1-tree-read
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseFolderTree, type ParseWarning } from "../../store/folder-tree-parser.js";
import { PRD_TREE_DIRNAME } from "../../store/paths.js";

/** The parser warnings under `rexDir`'s v1 tree that dropped an item; empty when every item reads. */
export async function skippedV1Items(rexDir: string): Promise<ParseWarning[]> {
  const treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  if (!existsSync(treeRoot)) return [];
  return (await parseFolderTree(treeRoot)).warnings.filter((w) => w.skipped);
}

/** The refusal, naming each file and why it was skipped. */
export function describeSkippedV1Items(skipped: readonly ParseWarning[]): string {
  const files = new Map<string, string>();
  for (const w of skipped) if (!files.has(w.path)) files.set(w.path, w.message);
  const list = [...files].map(([path, message]) => `${path}: ${message}`).join("; ");
  return `The v1 tree has ${files.size} item file${files.size === 1 ? "" : "s"} that do${files.size === 1 ? "es" : ""} not read, ` +
    `so the migration would lose ${files.size === 1 ? "it" : "them"}: ${list}. Fix or remove ${files.size === 1 ? "it" : "each"}, then run again.`;
}

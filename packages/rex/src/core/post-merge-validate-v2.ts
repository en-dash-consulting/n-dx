/**
 * Post-merge structural validation of a v2 PRD (`product/` and `changes/`).
 *
 * The v1 scan in post-merge-validate.ts walks `prd_tree/`; a v2 merge leaves
 * a different residue. The case that motivated this one: both branches
 * capture the same title under one change, git sees an add/add conflict on
 * the item file, and the resolution keeps one side's copy. The dropped id
 * still has a row in that folder's `state.yaml`, and any `blockedBy` naming
 * it now points nowhere. Nothing errors on that, so nothing would clean it.
 *
 * Like the v1 scan it reads the raw files, not the store: a freshly merged
 * tree may not load (duplicate ids, conflict markers), and the point is to
 * see the residue rather than the reader's best guess.
 *
 * | class               | meaning                                          | repair |
 * |---------------------|--------------------------------------------------|--------|
 * | conflict-markers    | unresolved `<<<<<<<` blocks in a node or state   | refused — a human owns conflict resolution |
 * | malformed-state     | a `state.yaml` that does not parse               | refused |
 * | duplicate-id        | one node id in two or more files                 | refused — which copy wins is ambiguous |
 * | orphaned-state-row  | a `state.yaml` row whose id no node file carries | rows dropped |
 * | dangling-blocked-by | `blockedBy` naming no node id, display id or alias | dangling refs dropped |
 *
 * Paths in the report are relative to the rex directory (`changes/…`).
 * Repairs run under the PRD lock and write state through state-writer.ts.
 *
 * @module rex/core/post-merge-validate-v2
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withLock } from "../store/file-lock.js";
import { prdLockPath } from "../store/paths.js";
import { CHANGES_DIRNAME, PRODUCT_DIRNAME } from "../store/prd-model-reader.js";
import { STATE_FILE_NAME, loadStateFile, parseStateYaml, saveStateFile } from "../store/state-writer.js";
import {
  CONFLICT_MARKERS,
  dropBlockedByRefs,
  matchList,
  matchScalar,
  rewriteFile,
  toRel,
  type PostMergeIssue,
  type PostMergeReport,
} from "./post-merge-validate.js";

interface NodeFile {
  relPath: string;
  id?: string;
  /** Display id and aliases: other names a `blockedBy` may use. */
  names: string[];
  blockedBy: string[];
}

interface StateRows {
  relPath: string;
  ids: string[];
}

/** Whether `rexDir` holds a v2 PRD: `product/` being present selects v2. */
export async function isV2Tree(rexDir: string): Promise<boolean> {
  return (await listDir(join(rexDir, PRODUCT_DIRNAME))) !== null;
}

/** Scan the v2 roots under `rexDir`; a missing root is skipped. */
export async function detectV2PostMergeIssues(rexDir: string): Promise<PostMergeReport> {
  const nodes: NodeFile[] = [];
  const states: StateRows[] = [];
  const issues: PostMergeIssue[] = [];
  /** Ids and display ids named in node files that still hold conflict markers. */
  const unresolved = new Set<string>();

  for (const layer of [PRODUCT_DIRNAME, CHANGES_DIRNAME]) {
    await walk(rexDir, join(rexDir, layer), nodes, states, issues, unresolved);
  }

  const byId = new Map<string, NodeFile[]>();
  const names = new Set<string>(unresolved);
  for (const node of nodes) {
    for (const name of node.names) names.add(name);
    if (!node.id) continue;
    names.add(node.id);
    byId.set(node.id, [...(byId.get(node.id) ?? []), node]);
  }

  for (const [id, holders] of byId) {
    if (holders.length < 2) continue;
    issues.push({
      class: "duplicate-id",
      path: holders[0].relPath,
      itemId: id,
      message: `id ${id} appears in ${holders.length} files: ${holders.map((h) => h.relPath).join(", ")} — keep one and delete the rest by hand`,
      repairable: false,
    });
  }

  for (const state of states) {
    const orphans = state.ids.filter((id) => !byId.has(id) && !unresolved.has(id));
    if (orphans.length === 0) continue;
    issues.push({
      class: "orphaned-state-row",
      path: state.relPath,
      message: `state rows for item${orphans.length === 1 ? "" : "s"} no node file carries: ${orphans.join(", ")} — left when a merge dropped the item's file`,
      repairable: true,
      detail: orphans,
    });
  }

  for (const node of nodes) {
    const dangling = node.blockedBy.filter((ref) => !names.has(ref));
    if (dangling.length === 0) continue;
    issues.push({
      class: "dangling-blocked-by",
      path: node.relPath,
      itemId: node.id,
      message: `blockedBy references item${dangling.length === 1 ? "" : "s"} that exist nowhere in the tree: ${dangling.join(", ")}`,
      repairable: true,
      detail: dangling,
    });
  }

  issues.sort((a, b) => a.path.localeCompare(b.path) || a.class.localeCompare(b.class));
  return { issues, scannedFiles: nodes.length + states.length };
}

async function walk(
  rexDir: string,
  dir: string,
  nodes: NodeFile[],
  states: StateRows[],
  issues: PostMergeIssue[],
  unresolved: Set<string>,
): Promise<void> {
  const entries = await listDir(dir);
  if (entries === null) return;
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(rexDir, full, nodes, states, issues, unresolved);
      continue;
    }
    const relPath = toRel(rexDir, full);
    if (entry.name === STATE_FILE_NAME) {
      const text = await readFile(full, "utf-8");
      if (CONFLICT_MARKERS.test(text)) {
        issues.push({ class: "conflict-markers", path: relPath, message: "unresolved merge conflict markers — resolve them, then re-run", repairable: false });
        continue;
      }
      try {
        states.push({ relPath, ids: Object.keys(parseStateYaml(text, relPath, { ignoreSchemaStamp: true }).items) });
      } catch (err) {
        issues.push({ class: "malformed-state", path: relPath, message: err instanceof Error ? err.message : String(err), repairable: false });
      }
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const text = await readFile(full, "utf-8");
    const id = matchScalar(text, "id");
    if (CONFLICT_MARKERS.test(text)) {
      issues.push({ class: "conflict-markers", path: relPath, itemId: id, message: "unresolved merge conflict markers — resolve them, then re-run", repairable: false });
      // Either side may survive the resolution, so every id or display id
      // the file names still counts: its state row and refs are not residue.
      for (const match of text.matchAll(/^(?:id|displayId):[^\S\n]*(.+)$/gm)) unresolved.add(unquote(match[1].trim()));
      continue;
    }
    const displayId = matchScalar(text, "displayId");
    nodes.push({
      relPath,
      id,
      names: [...(displayId ? [displayId] : []), ...matchList(text, "aliases")],
      blockedBy: matchList(text, "blockedBy"),
    });
  }
}

/**
 * Apply the deterministic v2 repairs under the PRD lock; ambiguous classes
 * come back in `refused`. Callers re-detect afterwards.
 */
export async function repairV2PostMergeIssues(
  rexDir: string,
  issues: PostMergeIssue[],
): Promise<{ repaired: PostMergeIssue[]; refused: PostMergeIssue[] }> {
  const repaired: PostMergeIssue[] = [];
  const refused: PostMergeIssue[] = [];
  await withLock(prdLockPath(rexDir), async () => {
    for (const issue of issues) {
      const fullPath = join(rexDir, ...issue.path.split("/"));
      const drop = new Set(issue.detail ?? []);
      if (issue.class === "orphaned-state-row") {
        const folder = dirname(fullPath);
        const file = await loadStateFile(folder);
        for (const id of drop) delete file.items[id];
        await saveStateFile(folder, file, { rexDir, specs: new Map() });
      } else if (issue.class === "dangling-blocked-by") {
        await rewriteFile(fullPath, (text) => dropBlockedByRefs(text, drop));
      } else {
        refused.push(issue);
        continue;
      }
      repaired.push(issue);
    }
  });
  return { repaired, refused };
}

function unquote(value: string): string {
  if (!value.startsWith('"')) return value;
  try {
    return JSON.parse(value) as string;
  } catch {
    return value.slice(1, -1);
  }
}

async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

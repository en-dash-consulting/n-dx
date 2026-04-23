/**
 * Per-PRD-item token rollup.
 *
 * Walks the PRD tree and sums run token totals from each hench run into the
 * item the run targeted, then rolls those sums up to every ancestor so the
 * dashboard and MCP consumers can read usage at any level (subtask → task →
 * feature → epic) without recomputing from the raw run records on every
 * request.
 *
 * Design constraints
 * ------------------
 * - **Pure.** `aggregateItemTokenUsage(items, runs)` has no I/O and no hidden
 *   state. The disk-reading helper (`readRunTokensFromHench`) is separate so
 *   callers can substitute their own source (e.g. already-listed run tuples
 *   from hench's `listCompletedRunTokens`) and so tests can run on synthetic
 *   inputs.
 * - **Orphan-aware.** Runs whose `itemId` is no longer in the PRD (archived,
 *   pruned, or deleted) are collected into an `orphans` array rather than
 *   silently dropped — callers decide whether to surface them.
 * - **Linear.** A single walk of the tree builds the id map; a single pass
 *   over runs attributes self-usage; a post-order walk of the tree rolls
 *   descendants into totals. Cost is O(items + runs), which comfortably
 *   fits the < 50 ms budget at 500 items × 5k runs on any modern hardware.
 *
 * This module sits next to the existing package-level `token-usage.ts`
 * aggregator but is independent — that one sums by source package (rex,
 * hench, sv); this one sums by PRD node.
 *
 * @module rex/core/item-token-rollup
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_DIRS } from "@n-dx/llm-client";
import type { PRDItem } from "../schema/v1.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Normalized token tuple (matches hench's RunTokens shape). */
export interface ItemTokenTuple {
  input: number;
  output: number;
  cached: number;
  total: number;
}

/**
 * A single run's token attribution, shaped for the aggregator's input.
 *
 * Matches the projection produced by hench's
 * `listCompletedRunTokens`, without depending on the hench package (rex is
 * in the domain tier and cannot import from the execution tier).
 */
export interface ItemRunTokens {
  itemId: string;
  tokens: ItemTokenTuple;
}

/** Rolled-up token totals for a single PRD item. */
export interface ItemTokenTotals {
  /** Tokens consumed by runs that directly targeted this item. */
  self: ItemTokenTuple;
  /** Tokens consumed by runs targeting any descendant of this item. */
  descendants: ItemTokenTuple;
  /** Convenience sum: `self + descendants`. */
  total: ItemTokenTuple;
  /** Number of runs counted toward `total` (self + descendants). */
  runCount: number;
}

/** Result of aggregating run tokens over a PRD tree. */
export interface ItemTokenAggregation {
  /** Map of `itemId → totals` for every item in the PRD. */
  totals: Map<string, ItemTokenTotals>;
  /**
   * Runs whose `itemId` is not present in the PRD (archived, pruned, or
   * deleted). Reported separately so callers can surface them rather than
   * silently losing the token cost.
   */
  orphans: ItemRunTokens[];
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

function zeroTuple(): ItemTokenTuple {
  return { input: 0, output: 0, cached: 0, total: 0 };
}

function addInto(target: ItemTokenTuple, src: ItemTokenTuple): void {
  target.input += src.input;
  target.output += src.output;
  target.cached += src.cached;
  target.total += src.total;
}

function emptyTotals(): ItemTokenTotals {
  return {
    self: zeroTuple(),
    descendants: zeroTuple(),
    total: zeroTuple(),
    runCount: 0,
  };
}

/**
 * Sum per-item run tokens and roll them up through the PRD tree.
 *
 * For every item the returned map contains a `{ self, descendants, total }`
 * triple. `total` is always `self + descendants` and `descendants` is the
 * sum of every child's `total` (recursively).
 *
 * Runs whose `itemId` is not present in the tree are returned in `orphans`;
 * they never contribute to any item's totals.
 *
 * Pure: no I/O, no mutation of the input tree, safe to call repeatedly.
 */
export function aggregateItemTokenUsage(
  items: PRDItem[],
  runs: Iterable<ItemRunTokens>,
): ItemTokenAggregation {
  // 1. One walk of the tree to build id → item map and initialize totals.
  const idToItem = new Map<string, PRDItem>();
  const totals = new Map<string, ItemTokenTotals>();

  const stack: PRDItem[] = [...items];
  while (stack.length > 0) {
    const node = stack.pop()!;
    idToItem.set(node.id, node);
    totals.set(node.id, emptyTotals());
    const kids = node.children;
    if (kids && kids.length > 0) {
      for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
  }

  // 2. Attribute each run's tokens to its item's `self` bucket (and the
  //    item's own self-run count), or bucket orphans if the item no longer
  //    exists in the tree. `runCount` is temporarily used to hold SELF runs
  //    only; it is replaced with the rolled-up count in step 3.
  const orphans: ItemRunTokens[] = [];
  const selfRunCount = new Map<string, number>();
  for (const id of totals.keys()) selfRunCount.set(id, 0);
  for (const run of runs) {
    const t = totals.get(run.itemId);
    if (!t) {
      orphans.push(run);
      continue;
    }
    addInto(t.self, run.tokens);
    selfRunCount.set(run.itemId, selfRunCount.get(run.itemId)! + 1);
  }

  // 3. Post-order walk: fold each child's rolled-up `total` into its
  //    parent's `descendants`, derive `total = self + descendants`, and
  //    fold child runCounts upward (parent.runCount = ownSelf + Σ child.runCount).
  function rollUp(node: PRDItem): ItemTokenTotals {
    const t = totals.get(node.id)!;
    let runCount = selfRunCount.get(node.id)!;
    const kids = node.children;
    if (kids && kids.length > 0) {
      for (let i = 0; i < kids.length; i++) {
        const child = rollUp(kids[i]);
        addInto(t.descendants, child.total);
        runCount += child.runCount;
      }
    }
    t.total.input = t.self.input + t.descendants.input;
    t.total.output = t.self.output + t.descendants.output;
    t.total.cached = t.self.cached + t.descendants.cached;
    t.total.total = t.self.total + t.descendants.total;
    t.runCount = runCount;
    return t;
  }

  for (const root of items) rollUp(root);

  return { totals, orphans };
}

// ---------------------------------------------------------------------------
// Disk reader: project hench run files into ItemRunTokens
// ---------------------------------------------------------------------------

/**
 * Subset of hench's `RunRecord` shape that we need for rollup.
 *
 * We intentionally don't import from the hench package (domain tier cannot
 * depend on the execution tier). The structure is stable because rex is
 * hench's schema source of truth.
 */
interface MinimalRunRecord {
  taskId?: string;
  status?: string;
  tokens?: Partial<ItemTokenTuple>;
  tokenUsage?: {
    input?: number;
    output?: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
  };
}

function tokensFromRecord(run: MinimalRunRecord): ItemTokenTuple {
  if (run.tokens) {
    const input = run.tokens.input ?? 0;
    const output = run.tokens.output ?? 0;
    const cached = run.tokens.cached ?? 0;
    const total = run.tokens.total ?? input + output + cached;
    return { input, output, cached, total };
  }
  const u = run.tokenUsage;
  if (!u) return zeroTuple();
  const input = u.input ?? 0;
  const output = u.output ?? 0;
  const cached = (u.cacheCreationInput ?? 0) + (u.cacheReadInput ?? 0);
  return { input, output, cached, total: input + output + cached };
}

/**
 * Read `.hench/runs/*.json` and project each terminal-state run into an
 * `ItemRunTokens` tuple suitable for `aggregateItemTokenUsage`.
 *
 * Only runs with a `taskId` and non-`running` status are returned — in-flight
 * runs are provisional and their counts should not feed rollups.
 *
 * Missing or malformed files are silently skipped; a missing `.hench/runs/`
 * directory returns an empty array.
 */
export async function readRunTokensFromHench(
  projectDir: string,
): Promise<ItemRunTokens[]> {
  const runsDir = join(projectDir, PROJECT_DIRS.HENCH, "runs");
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return [];
  }

  const out: ItemRunTokens[] = [];
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(runsDir, file), "utf-8");
      const run = JSON.parse(raw) as MinimalRunRecord;
      if (!run.taskId) continue;
      if (run.status === "running") continue;
      out.push({ itemId: run.taskId, tokens: tokensFromRecord(run) });
    } catch {
      // Unreadable or invalid run file — skip.
    }
  }
  return out;
}

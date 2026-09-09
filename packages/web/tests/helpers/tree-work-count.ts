/**
 * Work counters for the PRD-tree performance tests.
 *
 * ## Why counters and not a clock
 *
 * TESTING.md, Flake Resistance / Family 2, ranks three techniques for a
 * complexity claim and puts "count work, not time" first: traversal steps and
 * render counts are exact on every machine and cannot flake. The viewer's tree
 * performance tests used absolute millisecond budgets instead, and were observed
 * failing under full-suite load with the work itself unchanged — a 160ms budget
 * read 420ms while the same file completed in 108ms run alone.
 *
 * Growth ratios (technique 2) were tried here first and rejected on measurement.
 * A ratio only cancels ambient load when both readings face the same chance of
 * being preempted, and these operations are far too cheap for that to hold: with
 * min-of-7-batches timing, `diffItems` measured 7.7x across an 8x size step on an
 * idle machine and 46.5x on a loaded one, because a batch at n=502 takes ~4ms and
 * lands inside a clean scheduler slice while a batch at n=4002 takes ~30ms and
 * usually does not. The asymmetry is in the measurement, not the code. Counting
 * removes the question.
 *
 * Every counter here is exactly reproducible: the counts below were identical
 * across repeated runs and identical again with every core saturated.
 *
 * @see packages/web/tests/unit/viewer/large-tree-performance.test.ts
 * @see packages/web/tests/unit/viewer/prd-tree-live-tick-perf.test.ts
 */

import { options } from "preact";
import type { PRDItemData } from "../../src/viewer/components/prd-tree/types.js";

// ── Tree traversal counting ───────────────────────────────────────────────────

let treeReadCounting = false;
let treeReads = 0;

/**
 * Replace every `children` array on a fixture tree with an equivalent counting
 * getter, so that a traversal's step count can be read off exactly.
 *
 * Only nodes that actually hold a `children` array are instrumented. Leaves keep
 * their original shape — defining an enumerable `children` getter on a leaf would
 * make `"children" in item` newly true and change what the code under test sees,
 * which is the one thing an instrument must not do.
 *
 * Call once per fixture, before any measurement. Mutates and returns `items`.
 */
export function instrumentTreeReads(items: PRDItemData[]): PRDItemData[] {
  for (const item of items) {
    const kids = item.children;
    if (!Array.isArray(kids)) continue;
    instrumentTreeReads(kids);
    Object.defineProperty(item, "children", {
      enumerable: true,
      configurable: true,
      get() {
        if (treeReadCounting) treeReads++;
        return kids;
      },
    });
  }
  return items;
}

/**
 * Number of `children` reads an instrumented tree sees while `fn` runs.
 *
 * ### What this catches, and what it does not
 *
 * For these functions the tree *is* the input and walking it *is* the algorithm,
 * so the read count is the traversal step count: an operation that starts
 * re-walking the tree per node goes from ~2 reads per node to ~n, which no
 * tolerance hides.
 *
 * The documented blind spot for a data-access counter (TESTING.md: "count the
 * primitive, not the data access") applies and is not closed by anything here: a
 * refactor that first flattens the tree into a local array and then does
 * quadratic work on *that* array would keep the read count linear. Such a
 * refactor has to be reviewed on its own terms. It is still strictly more than
 * the millisecond budget these assertions replaced caught, which failed on a busy
 * machine and passed on a quiet one regardless of either shape.
 *
 * Reads on freshly cloned trees are not counted: an object spread copies the
 * getter's value into a plain data property, so only the instrumented original
 * contributes. Every count below is therefore "reads of the fixture".
 */
export function countTreeReads(fn: () => void): number {
  treeReads = 0;
  treeReadCounting = true;
  try {
    fn();
  } finally {
    treeReadCounting = false;
  }
  return treeReads;
}

// ── Preact render counting ────────────────────────────────────────────────────

export interface RenderWork {
  /** vnodes Preact diffed — the render work the component tree actually did. */
  vnodeDiffs: number;
  /** DOM records observed — what the render changed in the document. */
  domMutations: number;
}

/**
 * Count vnode diffs and DOM mutations produced by `fn`.
 *
 * `options.diffed` is Preact's per-vnode addon hook (the same seam
 * `preact/devtools` and `preact/debug` attach to), so this counts render work at
 * the framework's own granularity rather than inferring it from elapsed time. The
 * previous hook is chained and restored, so nesting and concurrent use are safe.
 *
 * The two counters catch different regressions and are both needed:
 *   - vnodeDiffs rises when `shouldComponentUpdate` stops short-circuiting rows —
 *     every row re-renders even though Preact then emits no DOM change, so the
 *     DOM counter stays flat and only this one moves.
 *   - domMutations rises when row identity churns — Preact tears down and rebuilds
 *     real nodes. Measured, that case *lowers* the diff count (fresh keys reset the
 *     expanded set, so fewer rows render at all), so only this one moves.
 */
export function countRenderWork(root: Node, fn: () => void): RenderWork {
  let vnodeDiffs = 0;
  const previousDiffed = options.diffed;
  options.diffed = (vnode) => {
    vnodeDiffs++;
    previousDiffed?.(vnode);
  };

  let domMutations = 0;
  const observer = new MutationObserver((records) => {
    domMutations += records.length;
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  try {
    fn();
  } finally {
    // MutationObserver callbacks are microtasks; drain anything still queued
    // before disconnecting so a synchronous render is fully accounted for.
    domMutations += observer.takeRecords().length;
    observer.disconnect();
    options.diffed = previousDiffed;
  }

  return { vnodeDiffs, domMutations };
}

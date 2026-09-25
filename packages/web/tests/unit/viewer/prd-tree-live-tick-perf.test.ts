// @vitest-environment jsdom
/**
 * Performance guardrail for the live-duration tick on large PRD trees.
 *
 * The brief requires:
 *   > UI remains usable on a PRD with 500 items — rendering and live
 *   > updates stay under a 16ms-per-frame budget in a profiled test.
 *
 * We measure the *incremental* cost of a live tick rather than a cold
 * re-render. The tree's `NodeRow.shouldComponentUpdate` short-circuits
 * when no tracked prop changed, so only rows whose `tickMs` prop
 * ticked (i.e. in-progress rows) should do any work on a tick.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE NO LONGER USES A CLOCK
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * It used to assert `elapsedMs < 16 * 10` around the tick render. That budget
 * failed under full-suite load at 420.10ms while the whole file completed in
 * 108ms run alone on an idle machine — the code was identical in both runs, so
 * the assertion was reporting the machine. Raising it is not available: TESTING.md
 * forbids padding a budget to green a suite, and the next busier machine simply
 * fails at the new number.
 *
 * The 16ms frame budget was never actually being tested here in any case. A cold
 * jsdom mount of this 500-item tree measures 46–235ms depending on ambient load,
 * so nothing in this environment can be held to a real frame. What the budget was
 * *standing in for* is a structural claim — a tick must not re-render the tree —
 * and that claim is countable exactly, which is the first technique TESTING.md
 * ranks under Family 2 ("count work, not time").
 *
 * So the assertions below count Preact's own render work instead. Both counts are
 * reproducible to the digit: repeated runs and a run with every core saturated
 * produced byte-identical numbers.
 *
 * MEASURED (jsdom, 500-item tree, 501 rendered rows, 66 of them in-progress):
 *
 *   scenario                                    vnode diffs   DOM mutations
 *   cold mount (the baseline, same process)          10 279               7
 *   tick, structurally identical items                1 033               1
 *   REGRESSION A — shouldComponentUpdate broken       7 805             442
 *   REGRESSION B — row keys churn on every tick         263             512
 *
 * Regression A is the failure this file exists to catch: every row re-renders,
 * but Preact's diff emits almost no DOM change, so a DOM-level check alone would
 * miss it. Regression B is the opposite shape — few rows render (fresh ids reset
 * the expanded set) while real nodes are torn down and rebuilt, so the diff count
 * alone would miss it. Hence one assertion per counter; neither is redundant.
 *
 * Both regressions were injected and confirmed to fail these bounds, per
 * TESTING.md rule 3. See packages/web/tests/helpers/tree-work-count.ts for the
 * counters and their documented blind spots.
 */
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import { countRenderWork } from "../../helpers/tree-work-count.js";
import type { PRDItemData, PRDDocumentData, ItemStatus } from "../../../src/viewer/components/prd-tree/types.js";

/**
 * Share of the cold mount's vnode-diff count a tick may spend.
 *
 * Clean measures 0.100 (1 033 / 10 279) and regression A measures 0.759. A third
 * sits 3.3x above the clean reading and 2.3x below the regression, which is the
 * "roughly 2x above the worst clean reading" that TESTING.md rule 3 asks for —
 * except that here there is no spread to leave room for, because the counts do
 * not vary at all. The headroom is for legitimate change (a row gaining a memoized
 * child, say), not for noise.
 */
const MAX_TICK_SHARE_OF_COLD_DIFFS = 1 / 3;

function makeLargeTree(totalItems: number, runningCount: number): PRDItemData[] {
  // 10 epics, each with features; features have tasks. A handful of
  // tasks are `in_progress` with a startedAt in the past — those drive
  // the live tick.
  const epics: PRDItemData[] = [];
  const epicsCount = 10;
  const featuresPerEpic = 5;
  const leavesPerFeature = Math.ceil((totalItems - epicsCount - epicsCount * featuresPerEpic) / (epicsCount * featuresPerEpic));
  let generated = 0;
  let runningSoFar = 0;
  const startedAt = new Date(Date.now() - 120_000).toISOString(); // 2 minutes ago
  for (let e = 0; e < epicsCount; e++) {
    const features: PRDItemData[] = [];
    for (let f = 0; f < featuresPerEpic; f++) {
      const tasks: PRDItemData[] = [];
      for (let t = 0; t < leavesPerFeature; t++) {
        const isRunning = runningSoFar < runningCount;
        if (isRunning) runningSoFar++;
        const status: ItemStatus = isRunning ? "in_progress" : "pending";
        tasks.push({
          id: `t-${e}-${f}-${t}`,
          title: `Task ${t}`,
          level: "task",
          status,
          ...(isRunning ? { startedAt } : {}),
        });
        generated++;
        if (generated >= totalItems - epicsCount - epicsCount * featuresPerEpic) break;
      }
      features.push({
        id: `f-${e}-${f}`,
        title: `Feature ${f}`,
        level: "feature",
        status: "in_progress",
        children: tasks,
      });
    }
    epics.push({
      id: `e-${e}`,
      title: `Epic ${e}`,
      level: "epic",
      status: "in_progress",
      children: features,
    });
  }
  return epics;
}

const ACTIVE_STATUSES: Set<ItemStatus> = new Set<ItemStatus>(["pending", "in_progress"]);

interface TickMeasurement {
  coldDiffs: number;
  tickDiffs: number;
  tickMutations: number;
  renderedRows: number;
  runningRows: number;
}

/**
 * Mount the tree once (the in-process baseline), then re-render it with a fresh
 * document reference — the shape a live tick produces — and report both.
 *
 * The mount is measured rather than discarded as a warm-up because it *is* the
 * baseline the tick is compared against: "a tick costs a fraction of a mount" is
 * the claim, and taking both readings from the same process and the same fixture
 * is what makes the fraction meaningful.
 */
function measureTick(): TickMeasurement {
  const items = makeLargeTree(500, 5);
  const doc1: PRDDocumentData = { schema: "rex/v1", title: "Perf", items };
  const root = document.createElement("div");

  const cold = countRenderWork(root, () => {
    act(() => {
      render(h(PRDTree, {
        document: doc1,
        defaultExpandDepth: 3,
        activeStatuses: ACTIVE_STATUSES,
      }), root);
    });
  });

  const renderedRows = root.querySelectorAll("[role='treeitem']").length;
  // The duration cell lives in the detail flyout, so the in-progress status
  // indicator is what identifies a row the tick can legitimately touch.
  const runningRows = root.querySelectorAll(".prd-status-in-progress").length;

  // A second render with a fresh doc reference simulates the tick's effect: a
  // prop identity change in the tree that the virtual-scroll + NodeRow
  // `shouldComponentUpdate` should absorb cheaply because the items array is
  // structurally identical.
  const doc2: PRDDocumentData = { ...doc1 };
  const tick = countRenderWork(root, () => {
    act(() => {
      render(h(PRDTree, {
        document: doc2,
        defaultExpandDepth: 3,
        activeStatuses: ACTIVE_STATUSES,
      }), root);
    });
  });

  // Unmount before returning. `useLiveTick` runs a real 1s `setInterval` while
  // any in-progress row is visible, and a tree left mounted keeps re-rendering
  // for the rest of the file — which is load-sensitive work leaking into every
  // later measurement.
  act(() => {
    render(null, root);
  });

  return {
    coldDiffs: cold.vnodeDiffs,
    tickDiffs: tick.vnodeDiffs,
    tickMutations: tick.domMutations,
    renderedRows,
    runningRows,
  };
}

describe("PRDTree live tick at scale", () => {
  it("re-rendering a 500-item tree with a new reference does a fraction of a mount's render work", () => {
    const m = measureTick();

    // Guard the measurement itself: with no rendered rows, or no in-progress
    // rows, both counters would be trivially satisfied and the test vacuous.
    expect(m.renderedRows).toBeGreaterThan(0);
    expect(m.runningRows).toBeGreaterThan(0);

    const share = m.tickDiffs / m.coldDiffs;
    expect(
      share,
      `A tick diffed ${m.tickDiffs} vnodes against a cold mount's ${m.coldDiffs} ` +
      `(${(share * 100).toFixed(1)}% of a full mount) across ${m.renderedRows} rendered rows. ` +
      `A clean tree measures 10.0%; if NodeRow.shouldComponentUpdate stops ` +
      `short-circuiting rows whose tracked props did not change, this rises to ~76% ` +
      `while the DOM barely moves — which is why this counter exists separately from ` +
      `the DOM one below.`,
    ).toBeLessThan(MAX_TICK_SHARE_OF_COLD_DIFFS);
  });

  it("re-rendering a 500-item tree with a new reference does not rebuild rows in the DOM", () => {
    const m = measureTick();

    expect(m.renderedRows).toBeGreaterThan(0);
    expect(m.runningRows).toBeGreaterThan(0);

    // A tick whose items are structurally identical can only legitimately touch
    // the surfaces of rows that are actually running, so their count is the
    // ceiling. Clean measures 1 mutation against 66 running rows; the two
    // row-identity regressions measure 442 and 512.
    expect(
      m.tickMutations,
      `A tick produced ${m.tickMutations} DOM mutations with ${m.runningRows} ` +
      `in-progress rows on screen (a clean tree produces 1). A count at or above ` +
      `the row count means Preact tore down and rebuilt rows rather than diffing ` +
      `them — the signature of row keys churning per tick, which leaves the vnode ` +
      `diff count *lower* than clean and so is invisible to the assertion above.`,
    ).toBeLessThanOrEqual(m.runningRows);
  });
});

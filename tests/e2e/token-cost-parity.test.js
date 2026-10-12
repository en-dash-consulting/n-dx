/**
 * The dashboard's token-cost rules must agree with hench's.
 *
 * `packages/web/src/server/token-cost.ts` is a deliberate port of
 * `packages/hench/src/agent/token-cost.ts`: web sits alongside orchestration
 * and does not depend on hench, and adding a gateway to reach three pure
 * functions would be an architecture change made in passing. A port is only
 * safe if something fails when the two drift, and that is this file.
 *
 * It is a root-level e2e test on purpose. Only here can both packages be
 * imported at once — neither package may import the other — so this is the
 * one place the two implementations can be put side by side and driven over
 * the same inputs.
 *
 * What drift costs: the web copies previously counted `input + output`, which
 * on a prompt-cached run is roughly a twelfth of what `checkTokenBudget`
 * enforces. The routes are wired into the dashboard, so an operator could
 * press Apply on a token budget below the context write every run pays on
 * arrival, and every run afterwards would fail before doing any work.
 */

import { describe, it, expect } from "vitest";

import * as hench from "../../packages/hench/dist/agent/token-cost.js";
import * as web from "../../packages/web/dist/server/token-cost.js";

/**
 * Run shapes that separate the rules: uncached, prompt-cached, cache-read
 * heavy, all-failed-cached, and the caching-turned-on-then-failing shape
 * where the floor's fallback is the only thing standing between the tuner and
 * a budget drawn from cheap pre-caching history.
 */
const RUN_SETS = {
  empty: [],
  uncached: [
    { status: "completed", tokenUsage: { input: 40_000, output: 110_000 } },
    { status: "failed", tokenUsage: { input: 50_000, output: 100_000 } },
  ],
  promptCached: [
    { status: "completed", tokenUsage: { input: 534, output: 50_000, cacheCreationInput: 876_000, cacheReadInput: 40_000_000 } },
    { status: "completed", tokenUsage: { input: 1_200, output: 60_000, cacheCreationInput: 184_000 } },
    { status: "failed", tokenUsage: { input: 900, output: 30_000, cacheCreationInput: 300_000 } },
  ],
  allFailedCached: [
    { status: "failed", tokenUsage: { input: 2_000, output: 80_000, cacheCreationInput: 600_000 } },
    { status: "failed", tokenUsage: { input: 1_500, output: 90_000, cacheCreationInput: 550_000 } },
    { status: "budget_exceeded", tokenUsage: { input: 1_000, output: 50_000, cacheCreationInput: 500_000 } },
  ],
  cachingTurnedOnThenFailing: [
    { status: "completed", tokenUsage: { input: 8_000, output: 12_000 } },
    { status: "completed", tokenUsage: { input: 9_000, output: 11_000 } },
    { status: "failed", tokenUsage: { input: 2_000, output: 40_000, cacheCreationInput: 420_000 } },
    { status: "failed", tokenUsage: { input: 1_800, output: 38_000, cacheCreationInput: 380_000 } },
  ],
  missingUsage: [
    { status: "completed" },
    { status: "completed", tokenUsage: {} },
  ],
};

describe("web/server/token-cost is in step with hench/agent/token-cost", () => {
  it("counts the same budgeted tokens for every run", () => {
    for (const [name, runs] of Object.entries(RUN_SETS)) {
      for (const [i, run] of runs.entries()) {
        expect(web.runBudgetedTokens(run), `${name}[${i}]`).toBe(hench.runBudgetedTokens(run));
        expect(
          web.countBudgetedTokens(run.tokenUsage),
          `${name}[${i}] usage`,
        ).toBe(hench.countBudgetedTokens(run.tokenUsage));
      }
    }
  });

  it("measures the same context-write floor for every run set", () => {
    for (const [name, runs] of Object.entries(RUN_SETS)) {
      expect(web.contextWriteFloor(runs), name).toBe(hench.contextWriteFloor(runs));
    }
  });

  it("agrees on which run sets are prompt-cached", () => {
    for (const [name, runs] of Object.entries(RUN_SETS)) {
      expect(web.hasCacheWrites(runs), name).toBe(hench.hasCacheWrites(runs));
    }
  });

  it("declares the same token classes", () => {
    expect(web.BUDGET_TOKEN_CLASSES).toBe(hench.BUDGET_TOKEN_CLASSES);
  });

  it("excludes cache reads on both sides", () => {
    // The rule most at risk of being "fixed" on one side only: a cache read is
    // a re-read of tokens already counted when written, so counting reads
    // charges the same tokens once per turn. The prompt-cached fixture above
    // carries a 40M read against an 876K write, so a copy that counted reads
    // would be off by a factor of 45 here and nowhere near the other copy.
    const run = RUN_SETS.promptCached[0];
    const expected = 534 + 876_000 + 50_000;
    expect(hench.runBudgetedTokens(run)).toBe(expected);
    expect(web.runBudgetedTokens(run)).toBe(expected);
  });
});

describe("the high-consumption thresholds match hench's", () => {
  it("uses the same two constants", () => {
    // Compared against hench's exported values, not against a literal: a
    // literal here would be a third copy, free to agree with neither.
    expect(web.HIGH_COUNTED_TOKENS_PER_RUN_UNCACHED)
      .toBe(hench.HIGH_COUNTED_TOKENS_PER_RUN_UNCACHED);
    expect(web.HIGH_COUNTED_TOKENS_PER_RUN_CACHED)
      .toBe(hench.HIGH_COUNTED_TOKENS_PER_RUN_CACHED);
  });

  it("picks the same threshold for every run set", () => {
    for (const [name, runs] of Object.entries(RUN_SETS)) {
      expect(web.highConsumptionThreshold(runs), name)
        .toBe(hench.highConsumptionThreshold(runs));
    }
  });

  it("picks the cached threshold for a set whose cached runs all failed", () => {
    // The case that used to be read as uncached, because the floor was 0.
    expect(web.highConsumptionThreshold(RUN_SETS.allFailedCached))
      .toBe(hench.HIGH_COUNTED_TOKENS_PER_RUN_CACHED);
  });
});

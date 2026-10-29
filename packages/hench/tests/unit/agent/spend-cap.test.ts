import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { priceTokens, resolveModelPricing } from "@n-dx/llm-client";
import {
  priceRunUsd,
  checkSpendCaps,
  ledgerSpendTodayUsd,
  createSpendGate,
  startOfLocalDay,
} from "../../../src/agent/lifecycle/spend-cap.js";
import { saveRun } from "../../../src/store/runs.js";
import type { RunRecord } from "../../../src/schema/index.js";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";

/** USD for `input` input tokens and `output` output tokens at `model`. */
function usd(model: string, input: number, output: number): number {
  return priceTokens(
    { inputTokens: input, outputTokens: output, cacheCreationTokens: 0, cacheReadTokens: 0 },
    resolveModelPricing(model).pricing,
  ).totalRaw;
}

describe("priceRunUsd", () => {
  it("prices the total at the run's model when there are no per-turn entries", () => {
    expect(priceRunUsd({ tokenUsage: { input: 1_000_000, output: 100_000 }, model: OPUS }))
      .toBeCloseTo(usd(OPUS, 1_000_000, 100_000), 10);
  });

  it("prices each turn at its own model and the untracked remainder at the run's", () => {
    const cost = priceRunUsd({
      tokenUsage: { input: 300_000, output: 30_000 },
      turnTokenUsage: [
        { turn: 1, input: 100_000, output: 10_000, model: OPUS },
        { turn: 2, input: 100_000, output: 10_000, model: SONNET },
      ],
      model: OPUS,
    });
    const expected = usd(OPUS, 100_000, 10_000) + usd(SONNET, 100_000, 10_000) + usd(OPUS, 100_000, 10_000);
    expect(cost).toBeCloseTo(expected, 10);
  });

  it("never prices an unknown model as free", () => {
    expect(priceRunUsd({ tokenUsage: { input: 1_000_000, output: 0 }, model: "not-a-model" })).toBeGreaterThan(0);
  });
});

describe("checkSpendCaps", () => {
  it("is silent when no cap is set, or spend is under it", () => {
    expect(checkSpendCaps({}, { runUsd: 1e6, dayUsd: 1e6 })).toBeUndefined();
    expect(checkSpendCaps({ maxCostUsdPerRun: 0, maxCostUsdPerDay: 0 }, { runUsd: 1e6, dayUsd: 1e6 })).toBeUndefined();
    expect(checkSpendCaps({ maxCostUsdPerRun: 5 }, { runUsd: 4.99 })).toBeUndefined();
  });

  it("stops at the per-run cap, naming the cap and the spend", () => {
    const hit = checkSpendCaps({ maxCostUsdPerRun: 5 }, { runUsd: 5 });
    expect(hit?.cap).toBe("maxCostUsdPerRun");
    expect(hit?.message).toContain("hench.maxCostUsdPerRun $5.00");
    expect(hit?.message).toContain("$5.00 of");
  });

  it("stops at the per-day cap", () => {
    const hit = checkSpendCaps({ maxCostUsdPerRun: 50, maxCostUsdPerDay: 20 }, { runUsd: 3, dayUsd: 21.5 });
    expect(hit?.cap).toBe("maxCostUsdPerDay");
    expect(hit?.message).toContain("$21.50 of hench.maxCostUsdPerDay $20.00");
  });
});

describe("the run ledger", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-test-spend-ledger-"));
  });
  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  function run(id: string, startedAt: string, input: number): RunRecord {
    return {
      id,
      taskId: "t",
      taskTitle: "T",
      startedAt,
      status: "completed",
      turns: 1,
      tokenUsage: { input, output: 0 },
      toolCalls: [],
      model: OPUS,
    };
  }

  it("sums today's runs, leaving out the asking run and runs started before midnight", async () => {
    const now = new Date();
    const today = new Date(startOfLocalDay(now).getTime() + 60_000).toISOString();
    const yesterday = new Date(startOfLocalDay(now).getTime() - 60_000).toISOString();
    await saveRun(henchDir, run("a", today, 1_000_000));
    await saveRun(henchDir, run("b", today, 2_000_000));
    await saveRun(henchDir, run("self", today, 9_000_000));
    // Rewritten today but started yesterday: still yesterday's spend.
    await saveRun(henchDir, run("old", yesterday, 5_000_000));
    // Last written yesterday: skipped without being read.
    await saveRun(henchDir, run("stale", today, 7_000_000));
    const past = new Date(startOfLocalDay(now).getTime() - 3_600_000);
    await utimes(join(henchDir, "runs", "stale.json"), past, past);

    const spent = await ledgerSpendTodayUsd(henchDir, now, "self");
    expect(spent).toBeCloseTo(usd(OPUS, 3_000_000, 0), 10);
  });

  it("the gate adds the run's own in-memory spend to the day's ledger", async () => {
    const now = new Date();
    await saveRun(henchDir, run("earlier", new Date(startOfLocalDay(now).getTime() + 1000).toISOString(), 1_000_000));
    const earlierUsd = usd(OPUS, 1_000_000, 0);

    const gate = createSpendGate({
      limits: { maxCostUsdPerDay: earlierUsd + 1 },
      henchDir,
      runId: "current",
      currentRunUsd: () => 1,
      now: () => now,
    });
    const hit = await gate!();
    expect(hit?.cap).toBe("maxCostUsdPerDay");
    expect(hit?.spentUsd).toBeCloseTo(earlierUsd + 1, 10);
  });

  it("an uncapped run gets no gate at all", () => {
    expect(createSpendGate({ limits: {}, henchDir, runId: "r", currentRunUsd: () => 0 })).toBeUndefined();
  });
});

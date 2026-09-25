import { describe, it, expect } from "vitest";
import {
  checkTokenBudget,
  formatBudgetExceeded,
  type TokenBudgetResult,
} from "../../../src/agent/lifecycle/token-budget.js";
import type { TokenUsage } from "../../../src/schema/v1.js";

describe("checkTokenBudget", () => {
  it("returns ok when no budget is set (0 = unlimited)", () => {
    const usage: TokenUsage = { input: 100_000, output: 50_000 };
    const result = checkTokenBudget(usage, 0);
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(150_000);
  });

  it("returns ok when no budget is set (undefined)", () => {
    const usage: TokenUsage = { input: 100_000, output: 50_000 };
    const result = checkTokenBudget(usage, undefined);
    expect(result.exceeded).toBe(false);
  });

  it("returns ok when under budget", () => {
    const usage: TokenUsage = { input: 50_000, output: 20_000 };
    const result = checkTokenBudget(usage, 100_000);
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(70_000);
    expect(result.budget).toBe(100_000);
    expect(result.remaining).toBe(30_000);
  });

  it("returns exceeded when at exactly the budget", () => {
    const usage: TokenUsage = { input: 60_000, output: 40_000 };
    const result = checkTokenBudget(usage, 100_000);
    expect(result.exceeded).toBe(true);
    expect(result.totalUsed).toBe(100_000);
    expect(result.remaining).toBe(0);
  });

  it("returns exceeded when over budget", () => {
    const usage: TokenUsage = { input: 80_000, output: 50_000 };
    const result = checkTokenBudget(usage, 100_000);
    expect(result.exceeded).toBe(true);
    expect(result.totalUsed).toBe(130_000);
    expect(result.remaining).toBe(0);
  });

  it("counts both input and output tokens toward budget", () => {
    const usage: TokenUsage = { input: 30_000, output: 30_000 };
    const result = checkTokenBudget(usage, 50_000);
    expect(result.exceeded).toBe(true);
    expect(result.totalUsed).toBe(60_000);
  });

  // Prompt caching moves nearly all input tokens out of `input` and into the
  // cache fields. Counting only `input + output` therefore bounded output plus
  // a rounding error, and a configured budget silently stopped applying on the
  // Anthropic loop — the PR that introduced cache_control recorded 534 uncached
  // input tokens against 876K cache writes and 34.1M cache reads.
  it("counts cache-write input toward the budget", () => {
    const usage: TokenUsage = {
      input: 534,
      output: 40,
      cacheCreationInput: 876_000,
      cacheReadInput: 34_100_000,
    };
    const result = checkTokenBudget(usage, 1_000_000);
    // Cache writes alone clear a 1M budget; the 34.1M reads are not counted.
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(534 + 40 + 876_000);
    expect(result.cacheReadNotCounted).toBe(34_100_000);
  });

  // Acceptance criterion: the API-loop case that motivated #390 must still stop
  // at a configured budget. Every built-in template budget is below its counted
  // total, so the run is caught by cache writes alone.
  it("still stops the #390 API-loop run at a configured budget", () => {
    const usage: TokenUsage = {
      input: 534,
      output: 40,
      cacheCreationInput: 876_000,
      cacheReadInput: 34_100_000,
    };
    for (const budget of [30_000, 150_000, 200_000, 500_000, 876_000]) {
      const result = checkTokenBudget(usage, budget);
      expect(result.exceeded).toBe(true);
      expect(result.remaining).toBe(0);
    }
  });

  // Acceptance criterion: a Claude CLI run that reads millions of cached tokens
  // must not trip a 200K budget on 40K of actual new work. Before this rule the
  // same fixture totalled 2.04M and was marked budget_exceeded after finishing.
  it("does not let CLI cache reads trip the budget", () => {
    const usage: TokenUsage = {
      input: 10_000,
      output: 30_000,
      cacheReadInput: 2_000_000,
    };
    const result = checkTokenBudget(usage, 200_000);
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(40_000);
    expect(result.remaining).toBe(160_000);
    expect(result.cacheReadNotCounted).toBe(2_000_000);
  });

  it("excludes cache reads from the reported total when no budget is set", () => {
    const usage: TokenUsage = {
      input: 100,
      output: 50,
      cacheCreationInput: 1_000,
      cacheReadInput: 9_000,
    };
    const result = checkTokenBudget(usage, 0);
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(1_150);
    expect(result.cacheReadNotCounted).toBe(9_000);
  });

  it("subtracts cache writes, not cache reads, from the remaining budget", () => {
    const usage: TokenUsage = {
      input: 1_000,
      output: 1_000,
      cacheCreationInput: 6_000,
      cacheReadInput: 8_000,
    };
    const result = checkTokenBudget(usage, 50_000);
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(8_000);
    expect(result.remaining).toBe(42_000);
  });

  it("names the counted token classes for the budget-exceeded message", () => {
    const usage: TokenUsage = {
      input: 1_000,
      output: 2_000,
      cacheCreationInput: 300_000,
      cacheReadInput: 5_000_000,
    };
    const result = checkTokenBudget(usage, 200_000);
    expect(result.exceeded).toBe(true);
    expect(formatBudgetExceeded(result)).toBe(
      "Token budget exceeded: 303,000 of 200,000 " +
        "(uncached input + cache writes + output; 5,000,000 cache-read tokens not counted)",
    );
  });

  it("omits the cache-read note when the run read no cache", () => {
    const usage: TokenUsage = { input: 150_000, output: 60_000 };
    const result = checkTokenBudget(usage, 200_000);
    expect(formatBudgetExceeded(result)).toBe(
      "Token budget exceeded: 210,000 of 200,000 (uncached input + cache writes + output)",
    );
  });

  it("handles zero usage correctly", () => {
    const usage: TokenUsage = { input: 0, output: 0 };
    const result = checkTokenBudget(usage, 100_000);
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(0);
    expect(result.remaining).toBe(100_000);
  });

  it("returns correct remaining when under budget", () => {
    const usage: TokenUsage = { input: 10_000, output: 5_000 };
    const result = checkTokenBudget(usage, 50_000);
    expect(result.remaining).toBe(35_000);
  });
});

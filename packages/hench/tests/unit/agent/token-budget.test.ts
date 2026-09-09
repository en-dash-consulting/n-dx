import { describe, it, expect } from "vitest";
import {
  checkTokenBudget,
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
  it("counts cache-write and cache-read input toward the budget", () => {
    const usage: TokenUsage = {
      input: 534,
      output: 40,
      cacheCreationInput: 876_000,
      cacheReadInput: 34_100_000,
    };
    const result = checkTokenBudget(usage, 1_000_000);
    expect(result.exceeded).toBe(true);
    expect(result.totalUsed).toBe(534 + 40 + 876_000 + 34_100_000);
    expect(result.remaining).toBe(0);
  });

  it("reports the cache-inclusive total when no budget is set", () => {
    const usage: TokenUsage = {
      input: 100,
      output: 50,
      cacheCreationInput: 1_000,
      cacheReadInput: 9_000,
    };
    const result = checkTokenBudget(usage, 0);
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(10_150);
  });

  it("subtracts cached input from the remaining budget", () => {
    const usage: TokenUsage = {
      input: 1_000,
      output: 1_000,
      cacheReadInput: 8_000,
    };
    const result = checkTokenBudget(usage, 50_000);
    expect(result.exceeded).toBe(false);
    expect(result.totalUsed).toBe(10_000);
    expect(result.remaining).toBe(40_000);
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

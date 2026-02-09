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

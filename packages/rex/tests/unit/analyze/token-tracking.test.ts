import { describe, it, expect } from "vitest";
import {
  parseTokenUsage,
  emptyAnalyzeTokenUsage,
  accumulateTokenUsage,
} from "../../../src/analyze/reason.js";
import { formatTokenUsage } from "../../../src/cli/commands/analyze.js";
import type { TokenUsage, AnalyzeTokenUsage } from "../../../src/schema/v1.js";

describe("parseTokenUsage", () => {
  it("extracts input and output tokens from envelope", () => {
    const usage = parseTokenUsage({
      result: "text",
      input_tokens: 1500,
      output_tokens: 300,
    });

    expect(usage).toEqual({ input: 1500, output: 300 });
  });

  it("extracts total_input/output_tokens as fallback", () => {
    const usage = parseTokenUsage({
      result: "text",
      total_input_tokens: 2000,
      total_output_tokens: 500,
    });

    expect(usage).toEqual({ input: 2000, output: 500 });
  });

  it("prefers input_tokens over total_input_tokens", () => {
    const usage = parseTokenUsage({
      input_tokens: 100,
      total_input_tokens: 200,
      output_tokens: 50,
    });

    expect(usage).toEqual({ input: 100, output: 50 });
  });

  it("extracts cache token fields when present", () => {
    const usage = parseTokenUsage({
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 300,
    });

    expect(usage).toEqual({
      input: 1000,
      output: 200,
      cacheCreationInput: 500,
      cacheReadInput: 300,
    });
  });

  it("omits cache fields when they are zero", () => {
    const usage = parseTokenUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    expect(usage).toEqual({ input: 100, output: 50 });
    expect(usage?.cacheCreationInput).toBeUndefined();
    expect(usage?.cacheReadInput).toBeUndefined();
  });

  it("returns undefined when no token fields present", () => {
    const usage = parseTokenUsage({
      result: "text",
      model: "claude-sonnet",
    });

    expect(usage).toBeUndefined();
  });

  it("returns undefined for empty envelope", () => {
    expect(parseTokenUsage({})).toBeUndefined();
  });

  it("handles partial fields (only input)", () => {
    const usage = parseTokenUsage({ input_tokens: 100 });

    expect(usage).toEqual({ input: 100, output: 0 });
  });

  it("handles partial fields (only output)", () => {
    const usage = parseTokenUsage({ output_tokens: 50 });

    expect(usage).toEqual({ input: 0, output: 50 });
  });
});

describe("emptyAnalyzeTokenUsage", () => {
  it("returns zeroed accumulator", () => {
    const usage = emptyAnalyzeTokenUsage();

    expect(usage).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("returns a fresh object each time", () => {
    const a = emptyAnalyzeTokenUsage();
    const b = emptyAnalyzeTokenUsage();
    a.calls = 5;

    expect(b.calls).toBe(0);
  });
});

describe("accumulateTokenUsage", () => {
  it("increments call count", () => {
    const agg = emptyAnalyzeTokenUsage();

    accumulateTokenUsage(agg, { input: 100, output: 50 });

    expect(agg.calls).toBe(1);
  });

  it("accumulates input and output tokens", () => {
    const agg = emptyAnalyzeTokenUsage();

    accumulateTokenUsage(agg, { input: 100, output: 50 });
    accumulateTokenUsage(agg, { input: 200, output: 80 });

    expect(agg.calls).toBe(2);
    expect(agg.inputTokens).toBe(300);
    expect(agg.outputTokens).toBe(130);
  });

  it("accumulates cache tokens when present", () => {
    const agg = emptyAnalyzeTokenUsage();

    accumulateTokenUsage(agg, {
      input: 100,
      output: 50,
      cacheCreationInput: 30,
      cacheReadInput: 20,
    });
    accumulateTokenUsage(agg, {
      input: 200,
      output: 80,
      cacheCreationInput: 40,
    });

    expect(agg.cacheCreationInputTokens).toBe(70);
    expect(agg.cacheReadInputTokens).toBe(20);
  });

  it("increments call count even when usage is undefined", () => {
    const agg = emptyAnalyzeTokenUsage();

    accumulateTokenUsage(agg, undefined);

    expect(agg.calls).toBe(1);
    expect(agg.inputTokens).toBe(0);
    expect(agg.outputTokens).toBe(0);
  });

  it("does not set cache fields when not provided", () => {
    const agg = emptyAnalyzeTokenUsage();

    accumulateTokenUsage(agg, { input: 100, output: 50 });

    expect(agg.cacheCreationInputTokens).toBeUndefined();
    expect(agg.cacheReadInputTokens).toBeUndefined();
  });
});

describe("formatTokenUsage", () => {
  it("returns empty string for zero calls", () => {
    const usage: AnalyzeTokenUsage = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };

    expect(formatTokenUsage(usage)).toBe("");
  });

  it("returns empty string when tokens are zero despite calls", () => {
    const usage: AnalyzeTokenUsage = {
      calls: 1,
      inputTokens: 0,
      outputTokens: 0,
    };

    expect(formatTokenUsage(usage)).toBe("");
  });

  it("formats single call without call count", () => {
    const usage: AnalyzeTokenUsage = {
      calls: 1,
      inputTokens: 1500,
      outputTokens: 300,
    };

    const result = formatTokenUsage(usage);

    expect(result).toContain("1,800 tokens");
    expect(result).toContain("1,500 in");
    expect(result).toContain("300 out");
    expect(result).not.toContain("across");
  });

  it("formats multiple calls with call count", () => {
    const usage: AnalyzeTokenUsage = {
      calls: 3,
      inputTokens: 5000,
      outputTokens: 1200,
    };

    const result = formatTokenUsage(usage);

    expect(result).toContain("6,200 tokens");
    expect(result).toContain("across 3 LLM calls");
  });
});

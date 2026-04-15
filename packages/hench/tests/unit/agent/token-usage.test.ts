import { describe, it, expect } from "vitest";
import {
  parseTokenUsage,
  parseStreamTokenUsage,
  mapCodexUsageToTokenUsage,
  emptyAggregateTokenUsage,
  accumulateTokenUsage,
  formatTokenUsage,
} from "../../../src/agent/lifecycle/token-usage.js";
import type { AggregateTokenUsage } from "../../../src/agent/lifecycle/token-usage.js";

// ── parseTokenUsage (API SDK response.usage) ────────────────────────────────

describe("parseTokenUsage", () => {
  it("extracts input and output tokens from envelope", () => {
    const usage = parseTokenUsage({
      input_tokens: 1500,
      output_tokens: 300,
    });

    expect(usage).toEqual({ input: 1500, output: 300 });
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
    expect(usage.cacheCreationInput).toBeUndefined();
    expect(usage.cacheReadInput).toBeUndefined();
  });

  it("handles partial fields (only input)", () => {
    const usage = parseTokenUsage({
      input_tokens: 100,
    });

    expect(usage).toEqual({ input: 100, output: 0 });
  });

  it("handles partial fields (only output)", () => {
    const usage = parseTokenUsage({
      output_tokens: 50,
    });

    expect(usage).toEqual({ input: 0, output: 50 });
  });

  it("returns zeros when no fields present", () => {
    const usage = parseTokenUsage({});

    expect(usage).toEqual({ input: 0, output: 0 });
  });

  it("handles non-numeric values gracefully", () => {
    const usage = parseTokenUsage({
      input_tokens: "bad" as unknown as number,
      output_tokens: 50,
    });

    expect(usage).toEqual({ input: 0, output: 50 });
  });

  it("includes only non-zero cache fields", () => {
    const usage = parseTokenUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 0,
    });

    expect(usage).toEqual({ input: 100, output: 50, cacheCreationInput: 200 });
    expect(usage.cacheReadInput).toBeUndefined();
  });
});

// ── parseStreamTokenUsage (CLI stream-json event) ───────────────────────────

describe("parseStreamTokenUsage", () => {
  it("extracts input and output tokens from envelope", () => {
    const usage = parseStreamTokenUsage({
      type: "result",
      result: "text",
      input_tokens: 1500,
      output_tokens: 300,
    });

    expect(usage).toEqual({ input: 1500, output: 300 });
  });

  it("extracts total_input/output_tokens as fallback", () => {
    const usage = parseStreamTokenUsage({
      type: "result",
      total_input_tokens: 2000,
      total_output_tokens: 500,
    });

    expect(usage).toEqual({ input: 2000, output: 500 });
  });

  it("prefers input_tokens over total_input_tokens", () => {
    const usage = parseStreamTokenUsage({
      input_tokens: 100,
      total_input_tokens: 200,
      output_tokens: 50,
    });

    expect(usage).toEqual({ input: 100, output: 50 });
  });

  it("extracts from nested usage object", () => {
    const usage = parseStreamTokenUsage({
      type: "result",
      result: "text",
      usage: {
        input_tokens: 800,
        output_tokens: 200,
      },
    });

    expect(usage).toEqual({ input: 800, output: 200 });
  });

  it("prefers top-level fields over nested usage", () => {
    const usage = parseStreamTokenUsage({
      input_tokens: 100,
      output_tokens: 50,
      usage: {
        input_tokens: 999,
        output_tokens: 888,
      },
    });

    expect(usage).toEqual({ input: 100, output: 50 });
  });

  it("extracts cache token fields when present", () => {
    const usage = parseStreamTokenUsage({
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

  it("extracts cache tokens from nested usage object", () => {
    const usage = parseStreamTokenUsage({
      type: "result",
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: 400,
        cache_read_input_tokens: 100,
      },
    });

    expect(usage).toEqual({
      input: 1000,
      output: 200,
      cacheCreationInput: 400,
      cacheReadInput: 100,
    });
  });

  it("omits cache fields when they are zero", () => {
    const usage = parseStreamTokenUsage({
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
    const usage = parseStreamTokenUsage({
      type: "result",
      result: "text",
    });

    expect(usage).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    expect(parseStreamTokenUsage({})).toBeUndefined();
  });

  it("handles partial fields (only input)", () => {
    const usage = parseStreamTokenUsage({ input_tokens: 100 });

    expect(usage).toEqual({ input: 100, output: 0 });
  });

  it("handles partial fields (only output)", () => {
    const usage = parseStreamTokenUsage({ output_tokens: 50 });

    expect(usage).toEqual({ input: 0, output: 50 });
  });

  it("returns undefined when usage is not an object", () => {
    const usage = parseStreamTokenUsage({
      type: "result",
      usage: "not-an-object",
    });

    expect(usage).toBeUndefined();
  });

  it("handles partial fields in nested usage (only total_output_tokens)", () => {
    const usage = parseStreamTokenUsage({
      usage: {
        total_output_tokens: 300,
      },
    });

    expect(usage).toEqual({ input: 0, output: 300 });
  });
});

// ── mapCodexUsageToTokenUsage ───────────────────────────────────────────────

describe("mapCodexUsageToTokenUsage", () => {
  it("maps top-level Codex usage fields", () => {
    const mapped = mapCodexUsageToTokenUsage({
      usage: {
        input_tokens: 1200,
        output_tokens: 300,
        total_tokens: 1500,
      },
    });

    expect(mapped.usage).toEqual({ input: 1200, output: 300 });
    expect(mapped.total).toBe(1500);
    expect(mapped.diagnosticStatus).toBe("complete");
  });

  it("maps nested response.usage payloads", () => {
    const mapped = mapCodexUsageToTokenUsage({
      response: {
        usage: {
          prompt_tokens: 800,
          completion_tokens: 200,
        },
      },
    });

    expect(mapped.usage).toEqual({ input: 800, output: 200 });
    expect(mapped.total).toBe(1000);
    expect(mapped.diagnosticStatus).toBe("complete");
  });

  it("uses top-level usage fields when usage object is absent", () => {
    const mapped = mapCodexUsageToTokenUsage({
      input_tokens: 55,
      output_tokens: 45,
    });

    expect(mapped.usage).toEqual({ input: 55, output: 45 });
    expect(mapped.total).toBe(100);
    expect(mapped.diagnosticStatus).toBe("complete");
  });

  it("returns zero usage with unavailable status when usage is absent", () => {
    const mapped = mapCodexUsageToTokenUsage({
      status: "completed",
      result: "ok",
    });

    expect(mapped.usage).toEqual({ input: 0, output: 0 });
    expect(mapped.total).toBe(0);
    expect(mapped.diagnosticStatus).toBe("unavailable");
  });

  it("returns zero usage with unavailable status when usage object exists but is empty", () => {
    const mapped = mapCodexUsageToTokenUsage({
      response: {
        usage: {},
      },
      status: "completed",
    });

    expect(mapped.usage).toEqual({ input: 0, output: 0 });
    expect(mapped.total).toBe(0);
    expect(mapped.diagnosticStatus).toBe("unavailable");
  });
});

// ── emptyAggregateTokenUsage ────────────────────────────────────────────────

describe("emptyAggregateTokenUsage", () => {
  it("returns zeroed accumulator", () => {
    const usage = emptyAggregateTokenUsage();

    expect(usage).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("returns a fresh object each time", () => {
    const a = emptyAggregateTokenUsage();
    const b = emptyAggregateTokenUsage();
    a.calls = 5;

    expect(b.calls).toBe(0);
  });
});

// ── accumulateTokenUsage ────────────────────────────────────────────────────

describe("accumulateTokenUsage", () => {
  it("increments call count", () => {
    const agg = emptyAggregateTokenUsage();

    accumulateTokenUsage(agg, { input: 100, output: 50 });

    expect(agg.calls).toBe(1);
  });

  it("accumulates input and output tokens", () => {
    const agg = emptyAggregateTokenUsage();

    accumulateTokenUsage(agg, { input: 100, output: 50 });
    accumulateTokenUsage(agg, { input: 200, output: 80 });

    expect(agg.calls).toBe(2);
    expect(agg.inputTokens).toBe(300);
    expect(agg.outputTokens).toBe(130);
  });

  it("accumulates cache tokens when present", () => {
    const agg = emptyAggregateTokenUsage();

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
    const agg = emptyAggregateTokenUsage();

    accumulateTokenUsage(agg, undefined);

    expect(agg.calls).toBe(1);
    expect(agg.inputTokens).toBe(0);
    expect(agg.outputTokens).toBe(0);
  });

  it("does not set cache fields when not provided", () => {
    const agg = emptyAggregateTokenUsage();

    accumulateTokenUsage(agg, { input: 100, output: 50 });

    expect(agg.cacheCreationInputTokens).toBeUndefined();
    expect(agg.cacheReadInputTokens).toBeUndefined();
  });
});

// ── formatTokenUsage ────────────────────────────────────────────────────────

describe("formatTokenUsage", () => {
  it("returns empty string for zero calls", () => {
    const usage: AggregateTokenUsage = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    };

    expect(formatTokenUsage(usage)).toBe("");
  });

  it("returns empty string when tokens are zero despite calls", () => {
    const usage: AggregateTokenUsage = {
      calls: 1,
      inputTokens: 0,
      outputTokens: 0,
    };

    expect(formatTokenUsage(usage)).toBe("");
  });

  it("formats single call without call count", () => {
    const usage: AggregateTokenUsage = {
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
    const usage: AggregateTokenUsage = {
      calls: 3,
      inputTokens: 5000,
      outputTokens: 1200,
    };

    const result = formatTokenUsage(usage);

    expect(result).toContain("6,200 tokens");
    expect(result).toContain("across 3 calls");
  });
});

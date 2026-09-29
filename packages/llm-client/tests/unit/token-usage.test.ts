import { describe, it, expect } from "vitest";
import {
  parseApiTokenUsage,
  parseApiTokenUsageWithDiagnostic,
  parseCliTokenUsage,
  parseCliTokenUsageWithDiagnostic,
  parseStreamTokenUsage,
  parseStreamTokenUsageWithDiagnostic,
  mapCodexUsageToTokenUsage,
} from "../../src/token-usage.js";

// ── parseApiTokenUsage (Anthropic SDK response.usage) ────────────────────────

describe("parseApiTokenUsage", () => {
  it("extracts input and output tokens", () => {
    const usage = parseApiTokenUsage({
      input_tokens: 1500,
      output_tokens: 300,
    });

    expect(usage).toEqual({ input: 1500, output: 300 });
  });

  it("extracts cache token fields when present", () => {
    const usage = parseApiTokenUsage({
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
    const usage = parseApiTokenUsage({
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
    const usage = parseApiTokenUsage({ input_tokens: 100 });
    expect(usage).toEqual({ input: 100, output: 0 });
  });

  it("handles partial fields (only output)", () => {
    const usage = parseApiTokenUsage({ output_tokens: 50 });
    expect(usage).toEqual({ input: 0, output: 50 });
  });

  it("returns zeros when no fields present", () => {
    const usage = parseApiTokenUsage({});
    expect(usage).toEqual({ input: 0, output: 0 });
  });

  it("handles non-numeric values gracefully", () => {
    const usage = parseApiTokenUsage({
      input_tokens: "bad" as unknown as number,
      output_tokens: 50,
    });

    expect(usage).toEqual({ input: 0, output: 50 });
  });
});

// ── parseCliTokenUsage (CLI --output-format json envelope) ───────────────────

describe("parseCliTokenUsage", () => {
  it("extracts input and output from standard fields", () => {
    const usage = parseCliTokenUsage({
      result: "hello",
      input_tokens: 1000,
      output_tokens: 200,
    });

    expect(usage).toEqual({ input: 1000, output: 200 });
  });

  it("extracts from total_ prefixed fields as fallback", () => {
    const usage = parseCliTokenUsage({
      total_input_tokens: 2000,
      total_output_tokens: 500,
    });

    expect(usage).toEqual({ input: 2000, output: 500 });
  });

  it("returns undefined when no token fields present", () => {
    expect(parseCliTokenUsage({ result: "hello" })).toBeUndefined();
  });

  it("extracts cache tokens when present", () => {
    const usage = parseCliTokenUsage({
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 400,
      cache_read_input_tokens: 100,
    });

    expect(usage).toEqual({
      input: 1000,
      output: 200,
      cacheCreationInput: 400,
      cacheReadInput: 100,
    });
  });

  it("omits cache fields when zero", () => {
    const usage = parseCliTokenUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    expect(usage).toEqual({ input: 100, output: 50 });
    expect(usage?.cacheCreationInput).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    expect(parseCliTokenUsage({})).toBeUndefined();
  });
});

// ── parseStreamTokenUsage (CLI stream-json events) ───────────────────────────

describe("parseStreamTokenUsage", () => {
  it("extracts from top-level fields", () => {
    const usage = parseStreamTokenUsage({
      type: "result",
      input_tokens: 1500,
      output_tokens: 300,
    });

    expect(usage).toEqual({ input: 1500, output: 300 });
  });

  it("extracts from total_ prefixed fields", () => {
    const usage = parseStreamTokenUsage({
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

  it("extracts cache tokens from top-level", () => {
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

  it("extracts cache tokens from nested usage", () => {
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

  it("omits cache fields when zero", () => {
    const usage = parseStreamTokenUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    expect(usage).toEqual({ input: 100, output: 50 });
    expect(usage?.cacheCreationInput).toBeUndefined();
  });

  it("returns undefined when no token fields present", () => {
    expect(parseStreamTokenUsage({ type: "result" })).toBeUndefined();
  });

  it("returns undefined for empty object", () => {
    expect(parseStreamTokenUsage({})).toBeUndefined();
  });

  it("handles partial fields (only input)", () => {
    const usage = parseStreamTokenUsage({ input_tokens: 100 });
    expect(usage).toEqual({ input: 100, output: 0 });
  });

  it("returns undefined when usage is not an object", () => {
    const usage = parseStreamTokenUsage({
      type: "result",
      usage: "not-an-object",
    });
    expect(usage).toBeUndefined();
  });

  it("handles partial fields in nested usage", () => {
    const usage = parseStreamTokenUsage({
      usage: { total_output_tokens: 300 },
    });
    expect(usage).toEqual({ input: 0, output: 300 });
  });
});

// ── Diagnostic-aware parsers ─────────────────────────────────────────────────

describe("parseApiTokenUsageWithDiagnostic", () => {
  it("returns complete when both fields present", () => {
    const result = parseApiTokenUsageWithDiagnostic({
      input_tokens: 100,
      output_tokens: 50,
    });
    expect(result.usage).toEqual({ input: 100, output: 50 });
    expect(result.diagnosticStatus).toBe("complete");
  });

  it("returns partial when only input present", () => {
    const result = parseApiTokenUsageWithDiagnostic({ input_tokens: 100 });
    expect(result.usage).toEqual({ input: 100, output: 0 });
    expect(result.diagnosticStatus).toBe("partial");
  });

  it("returns partial when only output present", () => {
    const result = parseApiTokenUsageWithDiagnostic({ output_tokens: 50 });
    expect(result.usage).toEqual({ input: 0, output: 50 });
    expect(result.diagnosticStatus).toBe("partial");
  });

  it("returns unavailable when no fields present", () => {
    const result = parseApiTokenUsageWithDiagnostic({});
    expect(result.usage).toEqual({ input: 0, output: 0 });
    expect(result.diagnosticStatus).toBe("unavailable");
  });

  it("returns unavailable when fields are non-numeric", () => {
    const result = parseApiTokenUsageWithDiagnostic({
      input_tokens: "bad" as unknown as number,
      output_tokens: null as unknown as number,
    });
    expect(result.usage).toEqual({ input: 0, output: 0 });
    expect(result.diagnosticStatus).toBe("unavailable");
  });

  it("includes cache fields in diagnostic result", () => {
    const result = parseApiTokenUsageWithDiagnostic({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 30,
    });
    expect(result.usage.cacheCreationInput).toBe(30);
    expect(result.diagnosticStatus).toBe("complete");
  });
});

describe("parseCliTokenUsageWithDiagnostic", () => {
  it("returns complete when both fields present", () => {
    const result = parseCliTokenUsageWithDiagnostic({
      input_tokens: 1000,
      output_tokens: 200,
    });
    expect(result.usage).toEqual({ input: 1000, output: 200 });
    expect(result.diagnosticStatus).toBe("complete");
  });

  it("returns complete with total_ prefixed fields", () => {
    const result = parseCliTokenUsageWithDiagnostic({
      total_input_tokens: 2000,
      total_output_tokens: 500,
    });
    expect(result.usage).toEqual({ input: 2000, output: 500 });
    expect(result.diagnosticStatus).toBe("complete");
  });

  it("returns unavailable when no token fields present", () => {
    const result = parseCliTokenUsageWithDiagnostic({ result: "hello" });
    expect(result.usage).toEqual({ input: 0, output: 0 });
    expect(result.diagnosticStatus).toBe("unavailable");
  });

  it("returns partial when only one field present", () => {
    const result = parseCliTokenUsageWithDiagnostic({ input_tokens: 100 });
    expect(result.usage).toEqual({ input: 100, output: 0 });
    expect(result.diagnosticStatus).toBe("partial");
  });
});

describe("parseStreamTokenUsageWithDiagnostic", () => {
  it("returns complete when both fields present", () => {
    const result = parseStreamTokenUsageWithDiagnostic({
      input_tokens: 1500,
      output_tokens: 300,
    });
    expect(result.usage).toEqual({ input: 1500, output: 300 });
    expect(result.diagnosticStatus).toBe("complete");
  });

  it("returns unavailable when no fields present", () => {
    const result = parseStreamTokenUsageWithDiagnostic({
      type: "result",
      result: "text",
    });
    expect(result.usage).toEqual({ input: 0, output: 0 });
    expect(result.diagnosticStatus).toBe("unavailable");
  });

  it("returns complete from nested usage object", () => {
    const result = parseStreamTokenUsageWithDiagnostic({
      type: "result",
      usage: {
        input_tokens: 800,
        output_tokens: 200,
      },
    });
    expect(result.usage).toEqual({ input: 800, output: 200 });
    expect(result.diagnosticStatus).toBe("complete");
  });

  it("returns partial when only one nested field present", () => {
    const result = parseStreamTokenUsageWithDiagnostic({
      usage: { total_output_tokens: 300 },
    });
    expect(result.usage).toEqual({ input: 0, output: 300 });
    expect(result.diagnosticStatus).toBe("partial");
  });

  it("returns unavailable when nested usage is not an object", () => {
    const result = parseStreamTokenUsageWithDiagnostic({
      type: "result",
      usage: "not-an-object",
    });
    expect(result.usage).toEqual({ input: 0, output: 0 });
    expect(result.diagnosticStatus).toBe("unavailable");
  });
});

// ── mapCodexUsageToTokenUsage ────────────────────────────────────────────────

describe("mapCodexUsageToTokenUsage", () => {
  it("maps top-level Codex usage fields with complete status", () => {
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

  it("returns unavailable when usage is absent", () => {
    const mapped = mapCodexUsageToTokenUsage({
      status: "completed",
      result: "ok",
    });
    expect(mapped.usage).toEqual({ input: 0, output: 0 });
    expect(mapped.total).toBe(0);
    expect(mapped.diagnosticStatus).toBe("unavailable");
  });

  it("returns unavailable when input is null/undefined", () => {
    const mapped = mapCodexUsageToTokenUsage(null);
    expect(mapped.diagnosticStatus).toBe("unavailable");
  });

  it("returns unavailable when usage object is empty", () => {
    const mapped = mapCodexUsageToTokenUsage({
      response: { usage: {} },
    });
    expect(mapped.usage).toEqual({ input: 0, output: 0 });
    expect(mapped.total).toBe(0);
    expect(mapped.diagnosticStatus).toBe("unavailable");
  });

  it("maps data.usage nested path", () => {
    const mapped = mapCodexUsageToTokenUsage({
      data: {
        usage: {
          input_tokens: 50,
          output_tokens: 25,
        },
      },
    });
    expect(mapped.usage).toEqual({ input: 50, output: 25 });
    expect(mapped.total).toBe(75);
    expect(mapped.diagnosticStatus).toBe("complete");
  });
});

// ── Cache accounting and its provenance ──────────────────────────────────────

describe("cache accounting", () => {
  // The exact payload a real `codex exec --json` turn emits — copied from
  // packages/hench/tests/fixtures/codex-file-change-real.jsonl.
  const CODEX_TURN = {
    input_tokens: 45_472,
    cached_input_tokens: 35_072,
    cache_write_input_tokens: 0,
    output_tokens: 180,
    reasoning_output_tokens: 28,
  };

  describe("Codex dialect", () => {
    it("moves the cached portion out of input rather than adding to it", () => {
      const { usage } = parseApiTokenUsageWithDiagnostic(CODEX_TURN);

      // Codex's input_tokens is the whole input, cached portion included. Read
      // additively, this turn would total 80,544 instead of 45,652 — a 77%
      // overcount on every cached Codex turn.
      expect(usage.input).toBe(10_400);
      expect(usage.cacheReadInput).toBe(35_072);
      expect(usage.input + usage.output + (usage.cacheReadInput ?? 0)).toBe(45_652);
    });

    it("reports it as measured", () => {
      expect(parseApiTokenUsageWithDiagnostic(CODEX_TURN).cacheProvenance).toBe("measured");
    });

    it("carries cache_write_input_tokens as the creation half", () => {
      const { usage } = parseApiTokenUsageWithDiagnostic({
        ...CODEX_TURN,
        cache_write_input_tokens: 2_048,
      });

      // Not subtracted from input: it is a separate class, as Anthropic's
      // cache_creation_input_tokens is.
      expect(usage.cacheCreationInput).toBe(2_048);
      expect(usage.input).toBe(10_400);
    });

    it("clamps rather than reporting negative input on a malformed payload", () => {
      const { usage } = parseApiTokenUsageWithDiagnostic({
        input_tokens: 100,
        cached_input_tokens: 500,
        output_tokens: 10,
      });

      expect(usage.input).toBe(0);
    });
  });

  describe("Anthropic dialect", () => {
    it("leaves input alone — its cache read is already excluded from it", () => {
      const { usage, cacheProvenance } = parseApiTokenUsageWithDiagnostic({
        input_tokens: 534,
        output_tokens: 120,
        cache_creation_input_tokens: 876,
        cache_read_input_tokens: 34_100,
      });

      expect(usage.input).toBe(534);
      expect(usage.cacheReadInput).toBe(34_100);
      expect(cacheProvenance).toBe("measured");
    });
  });

  describe("provenance", () => {
    it("is unavailable when the payload names no cache field at all", () => {
      const result = parseApiTokenUsageWithDiagnostic({ input_tokens: 10, output_tokens: 5 });

      // The input/output data is complete; the cache data is absent. The two
      // are independent, which is why they are separate values.
      expect(result.diagnosticStatus).toBe("complete");
      expect(result.cacheProvenance).toBe("unavailable");
    });

    it("is measured when a cache field is present but zero", () => {
      const result = parseApiTokenUsageWithDiagnostic({
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
      });

      // "The vendor cached nothing" and "the vendor said nothing about
      // caching" both leave cacheReadInput absent — only the provenance tells
      // them apart, which is the whole reason it exists.
      expect(result.cacheProvenance).toBe("measured");
      expect(result.usage.cacheReadInput).toBeUndefined();
    });

    it("is carried by the stream and CLI parsers too", () => {
      expect(parseStreamTokenUsageWithDiagnostic(CODEX_TURN).cacheProvenance).toBe("measured");
      expect(
        parseCliTokenUsageWithDiagnostic({ input_tokens: 1, output_tokens: 2 }).cacheProvenance,
      ).toBe("unavailable");
    });

    it("is carried by mapCodexUsageToTokenUsage, with `total` left as reported", () => {
      const mapped = mapCodexUsageToTokenUsage({ usage: CODEX_TURN });

      expect(mapped.cacheProvenance).toBe("measured");
      expect(mapped.usage.input).toBe(10_400);
      // Splitting the cached half out changes the attribution, not the cost.
      expect(mapped.total).toBe(45_652);
    });
  });

  it("a payload in both dialects is read as Anthropic, adjusting nothing", () => {
    const { usage } = parseApiTokenUsageWithDiagnostic({
      input_tokens: 1_000,
      output_tokens: 50,
      cache_read_input_tokens: 400,
      cached_input_tokens: 400,
    });

    expect(usage.input).toBe(1_000);
    expect(usage.cacheReadInput).toBe(400);
  });
});

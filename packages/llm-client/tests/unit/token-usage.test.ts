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

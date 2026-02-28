import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  processStreamLine,
  type CliRunResult,
} from "../../../src/agent/lifecycle/cli-loop.js";
import type { TurnTokenUsage } from "../../../src/schema/v1.js";

function makeResult(): CliRunResult {
  return {
    turns: 0,
    toolCalls: [],
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
  };
}

describe("processStreamLine token tracking", () => {
  // Suppress console output from processStreamLine
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("extracts token usage from assistant event with message.usage", () => {
    const result = makeResult();
    const counter = { value: 0 };

    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello" }],
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
        },
      },
    });

    processStreamLine(event, result, counter);

    expect(result.tokenUsage.input).toBe(1000);
    expect(result.tokenUsage.output).toBe(500);
    expect(result.turnTokenUsage).toHaveLength(1);
    expect(result.turnTokenUsage[0]).toEqual({
      turn: 1,
      input: 1000,
      output: 500,
    });
  });

  it("stores vendor/model metadata when provided by caller", () => {
    const result = makeResult();
    const counter = { value: 0 };

    const event = JSON.stringify({
      type: "assistant",
      message: {
        usage: { input_tokens: 200, output_tokens: 100 },
      },
    });

    processStreamLine(event, result, counter, { vendor: "codex", model: "gpt-5-codex" });

    expect(result.turnTokenUsage[0]).toEqual({
      turn: 1,
      input: 200,
      output: 100,
      vendor: "codex",
      model: "gpt-5-codex",
    });
  });

  it("accumulates tokens across multiple turns", () => {
    const result = makeResult();
    const counter = { value: 0 };

    const event1 = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Turn 1" }],
        usage: { input_tokens: 1000, output_tokens: 200 },
      },
    });

    const event2 = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Turn 2" }],
        usage: { input_tokens: 1500, output_tokens: 300 },
      },
    });

    processStreamLine(event1, result, counter);
    processStreamLine(event2, result, counter);

    expect(result.tokenUsage.input).toBe(2500);
    expect(result.tokenUsage.output).toBe(500);
    expect(result.turnTokenUsage).toHaveLength(2);
    expect(result.turnTokenUsage[0].turn).toBe(1);
    expect(result.turnTokenUsage[1].turn).toBe(2);
  });

  it("extracts cache token fields from assistant event", () => {
    const result = makeResult();
    const counter = { value: 0 };

    const event = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello" }],
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 800,
        },
      },
    });

    processStreamLine(event, result, counter);

    expect(result.tokenUsage.cacheCreationInput).toBe(200);
    expect(result.tokenUsage.cacheReadInput).toBe(800);
    expect(result.turnTokenUsage[0].cacheCreationInput).toBe(200);
    expect(result.turnTokenUsage[0].cacheReadInput).toBe(800);
  });

  it("accumulates cache tokens across turns", () => {
    const result = makeResult();
    const counter = { value: 0 };

    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "T1" }],
          usage: {
            input_tokens: 500,
            output_tokens: 100,
            cache_creation_input_tokens: 300,
            cache_read_input_tokens: 0,
          },
        },
      }),
      result,
      counter,
    );

    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "T2" }],
          usage: {
            input_tokens: 500,
            output_tokens: 100,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 300,
          },
        },
      }),
      result,
      counter,
    );

    expect(result.tokenUsage.cacheCreationInput).toBe(300);
    expect(result.tokenUsage.cacheReadInput).toBe(300);
  });

  it("does not set cache fields when not present in usage", () => {
    const result = makeResult();
    const counter = { value: 0 };

    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }),
      result,
      counter,
    );

    expect(result.tokenUsage.cacheCreationInput).toBeUndefined();
    expect(result.tokenUsage.cacheReadInput).toBeUndefined();
    expect(result.turnTokenUsage[0].cacheCreationInput).toBeUndefined();
    expect(result.turnTokenUsage[0].cacheReadInput).toBeUndefined();
  });

  it("handles assistant event without usage field", () => {
    const result = makeResult();
    const counter = { value: 0 };

    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "Hello" }],
        },
      }),
      result,
      counter,
    );

    expect(result.tokenUsage.input).toBe(0);
    expect(result.tokenUsage.output).toBe(0);
    expect(result.turnTokenUsage).toHaveLength(0);
  });

  it("extracts fallback token totals from result event", () => {
    const result = makeResult();
    const counter = { value: 0 };

    processStreamLine(
      JSON.stringify({
        type: "result",
        result: "Done",
        num_turns: 5,
        cost_usd: 0.05,
        total_input_tokens: 10000,
        total_output_tokens: 5000,
      }),
      result,
      counter,
    );

    expect(result.tokenUsage.input).toBe(10000);
    expect(result.tokenUsage.output).toBe(5000);
    expect(result.turns).toBe(5);
    expect(result.costUsd).toBe(0.05);
  });

  it("does not overwrite per-turn accumulated tokens from result event", () => {
    const result = makeResult();
    const counter = { value: 0 };

    // Simulate an assistant event first (has usage data)
    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "T1" }],
          usage: { input_tokens: 500, output_tokens: 200 },
        },
      }),
      result,
      counter,
    );

    // Now a result event with totals — should NOT overwrite since per-turn data exists
    processStreamLine(
      JSON.stringify({
        type: "result",
        result: "Done",
        total_input_tokens: 500,
        total_output_tokens: 200,
      }),
      result,
      counter,
    );

    // Token values should remain from per-turn tracking, not be overwritten
    expect(result.tokenUsage.input).toBe(500);
    expect(result.tokenUsage.output).toBe(200);
  });

  it("handles string message assistant events (no usage)", () => {
    const result = makeResult();
    const counter = { value: 0 };

    processStreamLine(
      JSON.stringify({
        type: "assistant",
        message: "Simple string message",
      }),
      result,
      counter,
    );

    expect(result.tokenUsage.input).toBe(0);
    expect(result.tokenUsage.output).toBe(0);
    expect(result.turnTokenUsage).toHaveLength(0);
  });

  it("ignores non-JSON lines", () => {
    const result = makeResult();
    const counter = { value: 0 };

    processStreamLine("not json", result, counter);

    expect(result.tokenUsage.input).toBe(0);
    expect(result.turnTokenUsage).toHaveLength(0);
  });
});

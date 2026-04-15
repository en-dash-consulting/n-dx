/**
 * Unit tests for EventAccumulator.
 *
 * Validates that RuntimeEvent[] streams are correctly derived into:
 * - Token usage totals with diagnostic status
 * - Tool call counts and records
 * - Assistant message text collection
 * - Completion summary extraction
 * - Failure detail accumulation
 * - toCliRunResult() backward-compatible bridge
 */
import { describe, it, expect } from "vitest";
import { EventAccumulator } from "../../../src/agent/lifecycle/event-accumulator.js";
import type {
  AccumulatedTokenUsage,
  AccumulatedToolCalls,
  AccumulatedFailure,
  CliRunResult,
} from "../../../src/agent/lifecycle/event-accumulator.js";
import type { RuntimeEvent } from "../../../src/prd/llm-gateway.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a RuntimeEvent with sensible defaults. */
function makeEvent(overrides: Partial<RuntimeEvent> & Pick<RuntimeEvent, "type">): RuntimeEvent {
  return {
    vendor: "claude",
    turn: 1,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ── Empty accumulator ────────────────────────────────────────────────────

describe("EventAccumulator — empty", () => {
  it("has zero events", () => {
    const acc = new EventAccumulator();
    expect(acc.eventCount).toBe(0);
    expect(acc.events).toEqual([]);
  });

  it("token usage is zero with unavailable diagnostic", () => {
    const acc = new EventAccumulator();
    const usage = acc.tokenUsage;
    expect(usage.total).toEqual({ input: 0, output: 0 });
    expect(usage.perTurn).toEqual([]);
    expect(usage.overallDiagnostic).toBe("unavailable");
  });

  it("tool calls are empty", () => {
    const acc = new EventAccumulator();
    expect(acc.toolCalls.count).toBe(0);
    expect(acc.toolCalls.calls).toEqual([]);
  });

  it("assistant text is empty", () => {
    const acc = new EventAccumulator();
    expect(acc.assistantText).toEqual([]);
  });

  it("completion summary is undefined", () => {
    const acc = new EventAccumulator();
    expect(acc.completionSummary).toBeUndefined();
  });

  it("failures are empty", () => {
    const acc = new EventAccumulator();
    expect(acc.failures).toEqual([]);
  });

  it("maxTurn is 0", () => {
    const acc = new EventAccumulator();
    expect(acc.maxTurn).toBe(0);
  });

  it("toCliRunResult() returns empty result", () => {
    const acc = new EventAccumulator();
    const result = acc.toCliRunResult();
    expect(result.turns).toBe(0);
    expect(result.toolCalls).toEqual([]);
    expect(result.tokenUsage).toEqual({ input: 0, output: 0 });
    expect(result.turnTokenUsage).toEqual([]);
    expect(result.summary).toBeUndefined();
    expect(result.error).toBeUndefined();
  });
});

// ── Token usage derivation ───────────────────────────────────────────────

describe("EventAccumulator — token usage", () => {
  it("accumulates token usage from a single event", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "token_usage",
      turn: 1,
      tokenUsage: { input: 100, output: 50 },
    }));

    const usage = acc.tokenUsage;
    expect(usage.total).toEqual({ input: 100, output: 50 });
    expect(usage.perTurn).toHaveLength(1);
    expect(usage.perTurn[0].turn).toBe(1);
    expect(usage.perTurn[0].input).toBe(100);
    expect(usage.perTurn[0].output).toBe(50);
    expect(usage.overallDiagnostic).toBe("complete");
  });

  it("accumulates token usage from multiple turns", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 50 } }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 200, output: 100 } }),
      makeEvent({ type: "token_usage", turn: 3, tokenUsage: { input: 300, output: 150 } }),
    );

    const usage = acc.tokenUsage;
    expect(usage.total).toEqual({ input: 600, output: 300 });
    expect(usage.perTurn).toHaveLength(3);
    expect(usage.overallDiagnostic).toBe("complete");
  });

  it("accumulates cache creation and read tokens", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "token_usage",
      turn: 1,
      tokenUsage: { input: 100, output: 50, cacheCreationInput: 20, cacheReadInput: 30 },
    }));
    acc.push(makeEvent({
      type: "token_usage",
      turn: 2,
      tokenUsage: { input: 200, output: 100, cacheCreationInput: 40, cacheReadInput: 60 },
    }));

    const usage = acc.tokenUsage;
    expect(usage.total.cacheCreationInput).toBe(60);
    expect(usage.total.cacheReadInput).toBe(90);
    expect(usage.perTurn[0].cacheCreationInput).toBe(20);
    expect(usage.perTurn[0].cacheReadInput).toBe(30);
    expect(usage.perTurn[1].cacheCreationInput).toBe(40);
    expect(usage.perTurn[1].cacheReadInput).toBe(60);
  });

  it("diagnostic is partial when one turn has zero input", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 50 } }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 0, output: 75 } }),
    );

    expect(acc.tokenUsage.overallDiagnostic).toBe("partial");
  });

  it("diagnostic is partial when one turn has zero output", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 0 } }),
    );

    expect(acc.tokenUsage.overallDiagnostic).toBe("partial");
  });

  it("diagnostic is unavailable when a turn has zero input and output", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 50 } }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 0, output: 0 } }),
    );

    expect(acc.tokenUsage.overallDiagnostic).toBe("unavailable");
  });

  it("diagnostic is unavailable when no token_usage events exist", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "assistant", turn: 1, text: "hello" }));

    expect(acc.tokenUsage.overallDiagnostic).toBe("unavailable");
    expect(acc.tokenUsage.total).toEqual({ input: 0, output: 0 });
  });

  it("preserves vendor in per-turn usage", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "token_usage",
      turn: 1,
      vendor: "codex",
      tokenUsage: { input: 100, output: 50 },
    }));

    expect(acc.tokenUsage.perTurn[0].vendor).toBe("codex");
  });

  it("ignores token_usage events with missing tokenUsage payload", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "token_usage", turn: 1 }));

    expect(acc.tokenUsage.total).toEqual({ input: 0, output: 0 });
    // Still has the event but payload was undefined
    expect(acc.tokenUsage.perTurn).toHaveLength(0);
  });
});

// ── Tool call derivation ─────────────────────────────────────────────────

describe("EventAccumulator — tool calls", () => {
  it("collects a single tool_use event", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "tool_use",
      turn: 1,
      toolCall: { tool: "Read", input: { file: "foo.ts" } },
    }));

    expect(acc.toolCalls.count).toBe(1);
    expect(acc.toolCalls.calls[0].tool).toBe("Read");
    expect(acc.toolCalls.calls[0].input).toEqual({ file: "foo.ts" });
    expect(acc.toolCalls.calls[0].turn).toBe(1);
  });

  it("pairs tool_use with subsequent tool_result", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({
        type: "tool_use",
        turn: 1,
        toolCall: { tool: "Read", input: { file: "foo.ts" } },
      }),
      makeEvent({
        type: "tool_result",
        turn: 1,
        toolResult: { tool: "Read", output: "file contents here", durationMs: 42 },
      }),
    );

    expect(acc.toolCalls.count).toBe(1);
    expect(acc.toolCalls.calls[0].output).toBe("file contents here");
    expect(acc.toolCalls.calls[0].durationMs).toBe(42);
  });

  it("handles multiple tool calls in sequence", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: { file: "a.ts" } } }),
      makeEvent({ type: "tool_result", turn: 1, toolResult: { tool: "Read", output: "a content", durationMs: 10 } }),
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Write", input: { file: "b.ts" } } }),
      makeEvent({ type: "tool_result", turn: 1, toolResult: { tool: "Write", output: "written", durationMs: 20 } }),
    );

    expect(acc.toolCalls.count).toBe(2);
    expect(acc.toolCalls.calls[0].tool).toBe("Read");
    expect(acc.toolCalls.calls[0].output).toBe("a content");
    expect(acc.toolCalls.calls[1].tool).toBe("Write");
    expect(acc.toolCalls.calls[1].output).toBe("written");
  });

  it("handles tool_use without a following tool_result", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: {} } }),
    );

    expect(acc.toolCalls.count).toBe(1);
    expect(acc.toolCalls.calls[0].output).toBe("");
    expect(acc.toolCalls.calls[0].durationMs).toBe(0);
  });

  it("truncates tool_result output to 2000 chars", () => {
    const acc = new EventAccumulator();
    const longOutput = "x".repeat(3000);
    acc.push(
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: {} } }),
      makeEvent({ type: "tool_result", turn: 1, toolResult: { tool: "Read", output: longOutput, durationMs: 5 } }),
    );

    expect(acc.toolCalls.calls[0].output.length).toBe(2000);
  });

  it("ignores tool_use events with missing toolCall payload", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "tool_use", turn: 1 }));

    expect(acc.toolCalls.count).toBe(0);
  });

  it("does not count non-tool events", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "thinking..." }),
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: {} } }),
      makeEvent({ type: "completion", turn: 2, completionSummary: "done" }),
    );

    expect(acc.toolCalls.count).toBe(1);
  });
});

// ── Assistant text derivation ────────────────────────────────────────────

describe("EventAccumulator — assistant text", () => {
  it("collects assistant messages in order", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "First message" }),
      makeEvent({ type: "assistant", turn: 2, text: "Second message" }),
    );

    expect(acc.assistantText).toEqual(["First message", "Second message"]);
  });

  it("ignores assistant events without text", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "assistant", turn: 1 }));

    expect(acc.assistantText).toEqual([]);
  });

  it("ignores non-assistant events", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: {} } }),
      makeEvent({ type: "assistant", turn: 1, text: "hello" }),
      makeEvent({ type: "completion", turn: 2, completionSummary: "done" }),
    );

    expect(acc.assistantText).toEqual(["hello"]);
  });
});

// ── Completion summary derivation ────────────────────────────────────────

describe("EventAccumulator — completion summary", () => {
  it("extracts completion summary", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "completion", turn: 5, completionSummary: "Task completed successfully" }));

    expect(acc.completionSummary).toBe("Task completed successfully");
  });

  it("uses the last completion event when multiple exist", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "completion", turn: 3, completionSummary: "First attempt" }),
      makeEvent({ type: "completion", turn: 5, completionSummary: "Final result" }),
    );

    expect(acc.completionSummary).toBe("Final result");
  });

  it("returns undefined when no completion events exist", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "assistant", turn: 1, text: "hello" }));

    expect(acc.completionSummary).toBeUndefined();
  });

  it("ignores completion events without a summary", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "completion", turn: 1 }));

    expect(acc.completionSummary).toBeUndefined();
  });
});

// ── Failure derivation ───────────────────────────────────────────────────

describe("EventAccumulator — failures", () => {
  it("collects a single failure event", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "failure",
      turn: 3,
      failure: { category: "auth", message: "API key expired" },
    }));

    expect(acc.failures).toHaveLength(1);
    expect(acc.failures[0].category).toBe("auth");
    expect(acc.failures[0].message).toBe("API key expired");
  });

  it("collects multiple failure events", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "failure", turn: 1, failure: { category: "rate_limit", message: "Too many requests" } }),
      makeEvent({ type: "failure", turn: 2, failure: { category: "timeout", message: "Request timed out" } }),
    );

    expect(acc.failures).toHaveLength(2);
    expect(acc.failures[0].category).toBe("rate_limit");
    expect(acc.failures[1].category).toBe("timeout");
  });

  it("includes vendorDetail when present", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "failure",
      turn: 1,
      failure: {
        category: "unknown",
        message: "Something went wrong",
        vendorDetail: "claude_error_code_42",
      },
    }));

    expect(acc.failures[0].vendorDetail).toBe("claude_error_code_42");
  });

  it("omits vendorDetail when absent", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "failure",
      turn: 1,
      failure: { category: "unknown", message: "Oops" },
    }));

    expect(acc.failures[0]).not.toHaveProperty("vendorDetail");
  });

  it("ignores failure events with missing failure payload", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "failure", turn: 1 }));

    expect(acc.failures).toEqual([]);
  });
});

// ── maxTurn ──────────────────────────────────────────────────────────────

describe("EventAccumulator — maxTurn", () => {
  it("tracks the highest turn number", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "a" }),
      makeEvent({ type: "tool_use", turn: 3, toolCall: { tool: "Read", input: {} } }),
      makeEvent({ type: "assistant", turn: 2, text: "b" }),
    );

    expect(acc.maxTurn).toBe(3);
  });
});

// ── Cache invalidation ──────────────────────────────────────────────────

describe("EventAccumulator — cache invalidation", () => {
  it("recomputes derived values after push", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "assistant", turn: 1, text: "first" }));

    // Access to populate cache
    expect(acc.assistantText).toEqual(["first"]);

    // Push more events
    acc.push(makeEvent({ type: "assistant", turn: 2, text: "second" }));

    // Should include the new event
    expect(acc.assistantText).toEqual(["first", "second"]);
  });

  it("recomputes token usage after push", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 50 } }));

    expect(acc.tokenUsage.total.input).toBe(100);

    acc.push(makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 200, output: 100 } }));

    expect(acc.tokenUsage.total.input).toBe(300);
    expect(acc.tokenUsage.total.output).toBe(150);
  });

  it("recomputes failures after push", () => {
    const acc = new EventAccumulator();
    expect(acc.failures).toHaveLength(0);

    acc.push(makeEvent({ type: "failure", turn: 1, failure: { category: "auth", message: "bad key" } }));
    expect(acc.failures).toHaveLength(1);
  });
});

// ── toCliRunResult() ─────────────────────────────────────────────────────

describe("EventAccumulator — toCliRunResult()", () => {
  it("produces a backward-compatible CliRunResult from a full run", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "Let me help you with that." }),
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 500, output: 200 } }),
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: { file: "foo.ts" } } }),
      makeEvent({ type: "tool_result", turn: 1, toolResult: { tool: "Read", output: "file contents", durationMs: 15 } }),
      makeEvent({ type: "assistant", turn: 2, text: "I found the issue." }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 300, output: 150 } }),
      makeEvent({ type: "completion", turn: 2, completionSummary: "Fixed the bug in foo.ts" }),
    );

    const result = acc.toCliRunResult();
    expect(result.turns).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("Read");
    expect(result.toolCalls[0].output).toBe("file contents");
    expect(result.tokenUsage).toEqual({ input: 800, output: 350 });
    expect(result.turnTokenUsage).toHaveLength(2);
    expect(result.summary).toBe("Fixed the bug in foo.ts");
    expect(result.error).toBeUndefined();
  });

  it("uses last assistant text as summary when no completion event exists", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "First message" }),
      makeEvent({ type: "assistant", turn: 2, text: "Final message" }),
    );

    const result = acc.toCliRunResult();
    expect(result.summary).toBe("Final message");
  });

  it("truncates assistant text summary to 500 chars", () => {
    const acc = new EventAccumulator();
    const longText = "x".repeat(1000);
    acc.push(makeEvent({ type: "assistant", turn: 1, text: longText }));

    const result = acc.toCliRunResult();
    expect(result.summary!.length).toBe(500);
  });

  it("sets error from first failure event", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "failure", turn: 1, failure: { category: "auth", message: "Authentication failed" } }),
      makeEvent({ type: "failure", turn: 2, failure: { category: "timeout", message: "Timed out" } }),
    );

    const result = acc.toCliRunResult();
    expect(result.error).toBe("Authentication failed");
  });

  it("includes cache tokens in tokenUsage", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "token_usage",
      turn: 1,
      tokenUsage: { input: 100, output: 50, cacheCreationInput: 25, cacheReadInput: 10 },
    }));

    const result = acc.toCliRunResult();
    expect(result.tokenUsage.cacheCreationInput).toBe(25);
    expect(result.tokenUsage.cacheReadInput).toBe(10);
  });

  it("returns a fresh object each call (not a reference to internal state)", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "assistant", turn: 1, text: "hi" }));

    const a = acc.toCliRunResult();
    const b = acc.toCliRunResult();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ── Mixed event stream (integration-style) ──────────────────────────────

describe("EventAccumulator — mixed event stream", () => {
  it("handles a realistic multi-turn run", () => {
    const acc = new EventAccumulator();

    // Turn 1: assistant speaks, uses a tool, gets result
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "I'll read the file first." }),
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: { path: "/src/main.ts" } } }),
      makeEvent({ type: "tool_result", turn: 1, toolResult: { tool: "Read", output: "const x = 1;", durationMs: 12 } }),
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 1000, output: 500 } }),
    );

    // Turn 2: assistant speaks, edits, gets result
    acc.push(
      makeEvent({ type: "assistant", turn: 2, text: "Now I'll fix the issue." }),
      makeEvent({ type: "tool_use", turn: 2, toolCall: { tool: "Edit", input: { path: "/src/main.ts", content: "const x = 2;" } } }),
      makeEvent({ type: "tool_result", turn: 2, toolResult: { tool: "Edit", output: "ok", durationMs: 8 } }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 800, output: 400, cacheReadInput: 200 } }),
    );

    // Turn 3: completion
    acc.push(
      makeEvent({ type: "completion", turn: 3, completionSummary: "Fixed variable in main.ts" }),
    );

    expect(acc.eventCount).toBe(9);
    expect(acc.maxTurn).toBe(3);

    // Token usage
    expect(acc.tokenUsage.total.input).toBe(1800);
    expect(acc.tokenUsage.total.output).toBe(900);
    expect(acc.tokenUsage.total.cacheReadInput).toBe(200);
    expect(acc.tokenUsage.perTurn).toHaveLength(2);
    expect(acc.tokenUsage.overallDiagnostic).toBe("complete");

    // Tool calls
    expect(acc.toolCalls.count).toBe(2);
    expect(acc.toolCalls.calls[0].tool).toBe("Read");
    expect(acc.toolCalls.calls[1].tool).toBe("Edit");

    // Text
    expect(acc.assistantText).toEqual([
      "I'll read the file first.",
      "Now I'll fix the issue.",
    ]);

    // Completion
    expect(acc.completionSummary).toBe("Fixed variable in main.ts");

    // No failures
    expect(acc.failures).toHaveLength(0);

    // Backward compat
    const result = acc.toCliRunResult();
    expect(result.turns).toBe(3);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.tokenUsage.input).toBe(1800);
    expect(result.summary).toBe("Fixed variable in main.ts");
    expect(result.error).toBeUndefined();
  });

  it("handles a failed run with retries", () => {
    const acc = new EventAccumulator();

    // First attempt fails
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "Starting..." }),
      makeEvent({ type: "failure", turn: 1, failure: { category: "rate_limit", message: "429 Too Many Requests" } }),
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 10 } }),
    );

    // Second attempt succeeds
    acc.push(
      makeEvent({ type: "assistant", turn: 2, text: "Retrying..." }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 500, output: 200 } }),
      makeEvent({ type: "completion", turn: 2, completionSummary: "Done after retry" }),
    );

    expect(acc.failures).toHaveLength(1);
    expect(acc.failures[0].category).toBe("rate_limit");
    expect(acc.tokenUsage.total.input).toBe(600);
    expect(acc.completionSummary).toBe("Done after retry");

    const result = acc.toCliRunResult();
    // Error is set from the failure event
    expect(result.error).toBe("429 Too Many Requests");
    // Summary comes from completion
    expect(result.summary).toBe("Done after retry");
  });

  it("handles Codex vendor events", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, vendor: "codex", text: "Codex response" }),
      makeEvent({ type: "token_usage", turn: 1, vendor: "codex", tokenUsage: { input: 300, output: 150 } }),
    );

    expect(acc.tokenUsage.perTurn[0].vendor).toBe("codex");
    expect(acc.assistantText).toEqual(["Codex response"]);
  });
});

// ── Edge cases ──────────────────────────────────────────────────────────

describe("EventAccumulator — edge cases", () => {
  it("handles push with zero arguments", () => {
    const acc = new EventAccumulator();
    acc.push();
    expect(acc.eventCount).toBe(0);
  });

  it("handles push with multiple events at once", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "a" }),
      makeEvent({ type: "assistant", turn: 2, text: "b" }),
      makeEvent({ type: "assistant", turn: 3, text: "c" }),
    );
    expect(acc.eventCount).toBe(3);
    expect(acc.assistantText).toEqual(["a", "b", "c"]);
  });

  it("events property returns a read-only snapshot", () => {
    const acc = new EventAccumulator();
    const event = makeEvent({ type: "assistant", turn: 1, text: "hello" });
    acc.push(event);

    const events = acc.events;
    expect(events).toHaveLength(1);
    // The returned array should be the internal array (not a copy)
    // but typed as ReadonlyArray to prevent external mutation
    expect(events[0]).toBe(event);
  });

  it("all FailureCategory values work in failure events", () => {
    const categories = [
      "auth", "not_found", "timeout", "rate_limit",
      "completion_rejected", "budget_exceeded", "spin_detected",
      "malformed_output", "mcp_unavailable", "transient_exhausted", "unknown",
    ] as const;

    for (const category of categories) {
      const acc = new EventAccumulator();
      acc.push(makeEvent({
        type: "failure",
        turn: 1,
        failure: { category, message: `${category} error` },
      }));
      expect(acc.failures[0].category).toBe(category);
    }
  });
});

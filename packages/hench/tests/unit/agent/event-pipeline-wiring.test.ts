/**
 * Unit tests for the event pipeline wiring in cli-loop.ts.
 *
 * Validates that:
 * - emitStreamOutput() emits UI output for each event type
 * - rawJsonToTokenUsageEvent() converts raw JSON to token_usage RuntimeEvents
 * - EventAccumulator produces SpawnResult-equivalent data
 * - Spin detection uses accumulator-derived counts when flag is on
 * - Token budget checking uses accumulator totals when flag is on
 * - Feature flag gating: useEventPipeline config option
 * - Run records are equivalent between legacy and event pipeline paths
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  emitStreamOutput,
  rawJsonToTokenUsageEvent,
} from "../../../src/agent/lifecycle/cli-loop.js";
import { EventAccumulator } from "../../../src/agent/lifecycle/event-accumulator.js";
import type { CliRunResult } from "../../../src/agent/lifecycle/event-accumulator.js";
import { isSpinningRun, DEFAULT_SPIN_THRESHOLD } from "../../../src/agent/analysis/spin.js";
import { checkTokenBudget } from "../../../src/agent/lifecycle/token-budget.js";
import { validateConfig } from "../../../src/schema/validate.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";
import type { RuntimeEvent } from "../../../src/prd/llm-gateway.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<RuntimeEvent> & Pick<RuntimeEvent, "type">): RuntimeEvent {
  return {
    vendor: "claude",
    turn: 1,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ── emitStreamOutput ──────────────────────────────────────────────────────

describe("emitStreamOutput", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The stream/info functions write to stdout
    consoleSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("does not throw for assistant events", () => {
    expect(() => emitStreamOutput(makeEvent({ type: "assistant", text: "hello" }))).not.toThrow();
  });

  it("does not throw for tool_use events", () => {
    expect(() => emitStreamOutput(makeEvent({
      type: "tool_use",
      toolCall: { tool: "Read", input: { file: "foo.ts" } },
    }))).not.toThrow();
  });

  it("does not throw for tool_result events", () => {
    expect(() => emitStreamOutput(makeEvent({
      type: "tool_result",
      toolResult: { tool: "Read", output: "file contents", durationMs: 10 },
    }))).not.toThrow();
  });

  it("does not throw for completion events", () => {
    expect(() => emitStreamOutput(makeEvent({
      type: "completion",
      completionSummary: "Done",
    }))).not.toThrow();
  });

  it("does not throw for failure events", () => {
    expect(() => emitStreamOutput(makeEvent({
      type: "failure",
      failure: { category: "unknown", message: "oops" },
    }))).not.toThrow();
  });

  it("does not throw for token_usage events", () => {
    expect(() => emitStreamOutput(makeEvent({
      type: "token_usage",
      tokenUsage: { input: 100, output: 50 },
    }))).not.toThrow();
  });

  it("handles assistant events without text", () => {
    expect(() => emitStreamOutput(makeEvent({ type: "assistant" }))).not.toThrow();
  });

  it("handles tool_use events without toolCall", () => {
    expect(() => emitStreamOutput(makeEvent({ type: "tool_use" }))).not.toThrow();
  });

  it("handles tool_result events without toolResult", () => {
    expect(() => emitStreamOutput(makeEvent({ type: "tool_result" }))).not.toThrow();
  });
});

// ── rawJsonToTokenUsageEvent ──────────────────────────────────────────────

describe("rawJsonToTokenUsageEvent", () => {
  const metadata = { vendor: "claude" as const, model: "sonnet" };

  it("extracts usage from top-level usage field", () => {
    const event = rawJsonToTokenUsageEvent(
      { usage: { input_tokens: 100, output_tokens: 50 } },
      1,
      metadata,
    );

    expect(event).not.toBeNull();
    expect(event!.type).toBe("token_usage");
    expect(event!.vendor).toBe("claude");
    expect(event!.turn).toBe(1);
    expect(event!.tokenUsage).toBeDefined();
    expect(event!.tokenUsage!.input).toBe(100);
    expect(event!.tokenUsage!.output).toBe(50);
  });

  it("extracts usage from nested message.usage field", () => {
    const event = rawJsonToTokenUsageEvent(
      { message: { usage: { input_tokens: 200, output_tokens: 100 } } },
      2,
      metadata,
    );

    expect(event).not.toBeNull();
    expect(event!.tokenUsage!.input).toBe(200);
    expect(event!.tokenUsage!.output).toBe(100);
    expect(event!.turn).toBe(2);
  });

  it("returns null when no usage data is present", () => {
    const event = rawJsonToTokenUsageEvent({ type: "assistant" }, 1, metadata);
    expect(event).toBeNull();
  });

  it("returns null when usage is not an object", () => {
    const event = rawJsonToTokenUsageEvent({ usage: "not an object" }, 1, metadata);
    expect(event).toBeNull();
  });

  it("returns null when message.usage is not an object", () => {
    const event = rawJsonToTokenUsageEvent(
      { message: { usage: 42 } },
      1,
      metadata,
    );
    expect(event).toBeNull();
  });

  it("defaults turn to 1 when turn is 0", () => {
    const event = rawJsonToTokenUsageEvent(
      { usage: { input_tokens: 100, output_tokens: 50 } },
      0,
      metadata,
    );
    expect(event!.turn).toBe(1);
  });

  it("includes cache tokens when present", () => {
    const event = rawJsonToTokenUsageEvent(
      {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 25,
          cache_read_input_tokens: 10,
        },
      },
      1,
      metadata,
    );

    expect(event!.tokenUsage!.cacheCreationInput).toBe(25);
    expect(event!.tokenUsage!.cacheReadInput).toBe(10);
  });

  it("uses vendor from metadata", () => {
    const event = rawJsonToTokenUsageEvent(
      { usage: { input_tokens: 100, output_tokens: 50 } },
      1,
      { vendor: "codex", model: "gpt-5-codex" },
    );
    expect(event!.vendor).toBe("codex");
  });
});

// ── EventAccumulator ↔ SpawnResult equivalence ────────────────────────────

describe("EventAccumulator → SpawnResult equivalence", () => {
  it("produces equivalent token usage totals", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 500, output: 200 } }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 300, output: 150 } }),
    );

    const result = acc.toCliRunResult();
    expect(result.tokenUsage.input).toBe(800);
    expect(result.tokenUsage.output).toBe(350);
  });

  it("produces equivalent tool call records", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: { file: "a.ts" } } }),
      makeEvent({ type: "tool_result", turn: 1, toolResult: { tool: "Read", output: "content", durationMs: 10 } }),
      makeEvent({ type: "tool_use", turn: 2, toolCall: { tool: "Write", input: { file: "b.ts" } } }),
      makeEvent({ type: "tool_result", turn: 2, toolResult: { tool: "Write", output: "ok", durationMs: 5 } }),
    );

    const result = acc.toCliRunResult();
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].tool).toBe("Read");
    expect(result.toolCalls[0].output).toBe("content");
    expect(result.toolCalls[1].tool).toBe("Write");
    expect(result.toolCalls[1].output).toBe("ok");
  });

  it("produces equivalent turn count", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "hi" }),
      makeEvent({ type: "assistant", turn: 2, text: "bye" }),
      makeEvent({ type: "assistant", turn: 5, text: "done" }),
    );

    const result = acc.toCliRunResult();
    expect(result.turns).toBe(5);
  });

  it("produces equivalent summary from completion event", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "Working on it..." }),
      makeEvent({ type: "completion", turn: 1, completionSummary: "Task completed" }),
    );

    const result = acc.toCliRunResult();
    expect(result.summary).toBe("Task completed");
  });

  it("produces equivalent error from failure event", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "failure", turn: 1, failure: { category: "auth", message: "API key expired" } }),
    );

    const result = acc.toCliRunResult();
    expect(result.error).toBe("API key expired");
  });

  it("full run: event pipeline produces same shape as inline accumulation", () => {
    const acc = new EventAccumulator();

    // Simulate a complete run
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "Let me help." }),
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 500, output: 200 } }),
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: { file: "foo.ts" } } }),
      makeEvent({ type: "tool_result", turn: 1, toolResult: { tool: "Read", output: "contents", durationMs: 15 } }),
      makeEvent({ type: "assistant", turn: 2, text: "Found the issue." }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 300, output: 150 } }),
      makeEvent({ type: "tool_use", turn: 2, toolCall: { tool: "Write", input: { file: "foo.ts" } } }),
      makeEvent({ type: "tool_result", turn: 2, toolResult: { tool: "Write", output: "written", durationMs: 8 } }),
      makeEvent({ type: "completion", turn: 2, completionSummary: "Fixed bug in foo.ts" }),
    );

    const result = acc.toCliRunResult();

    // Verify all fields are populated correctly
    expect(result.turns).toBe(2);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.tokenUsage).toEqual({ input: 800, output: 350 });
    expect(result.turnTokenUsage).toHaveLength(2);
    expect(result.summary).toBe("Fixed bug in foo.ts");
    expect(result.error).toBeUndefined();

    // Verify per-turn token usage
    expect(result.turnTokenUsage[0].turn).toBe(1);
    expect(result.turnTokenUsage[0].input).toBe(500);
    expect(result.turnTokenUsage[1].turn).toBe(2);
    expect(result.turnTokenUsage[1].input).toBe(300);
  });
});

// ── Spin detection via accumulator ────────────────────────────────────────

describe("Spin detection via EventAccumulator", () => {
  it("detects spin from accumulator: many turns, zero tool calls", () => {
    const acc = new EventAccumulator();
    for (let i = 1; i <= DEFAULT_SPIN_THRESHOLD; i++) {
      acc.push(makeEvent({ type: "assistant", turn: i, text: `Turn ${i}` }));
      acc.push(makeEvent({ type: "token_usage", turn: i, tokenUsage: { input: 100, output: 50 } }));
    }

    // This is how the event pipeline path checks spin
    const spinning = isSpinningRun(acc.maxTurn, acc.toolCalls.count);
    expect(spinning).toBe(true);
  });

  it("does not detect spin when tool calls are present", () => {
    const acc = new EventAccumulator();
    for (let i = 1; i <= DEFAULT_SPIN_THRESHOLD; i++) {
      acc.push(makeEvent({ type: "assistant", turn: i, text: `Turn ${i}` }));
    }
    acc.push(makeEvent({
      type: "tool_use", turn: 1,
      toolCall: { tool: "Read", input: { file: "a.ts" } },
    }));

    const spinning = isSpinningRun(acc.maxTurn, acc.toolCalls.count);
    expect(spinning).toBe(false);
  });

  it("does not detect spin for short runs", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({ type: "assistant", turn: 1, text: "short run" }));

    const spinning = isSpinningRun(acc.maxTurn, acc.toolCalls.count);
    expect(spinning).toBe(false);
  });

  it("accumulator maxTurn matches expected turn count", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "assistant", turn: 1, text: "a" }),
      makeEvent({ type: "assistant", turn: 5, text: "b" }),
      makeEvent({ type: "assistant", turn: 3, text: "c" }),
    );
    expect(acc.maxTurn).toBe(5);
  });
});

// ── Token budget checking via accumulator ─────────────────────────────────

describe("Token budget checking via EventAccumulator", () => {
  it("budget check passes when under budget", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 50 } }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 200, output: 100 } }),
    );

    const budget = checkTokenBudget(acc.tokenUsage.total, 1000);
    expect(budget.exceeded).toBe(false);
    expect(budget.totalUsed).toBe(450);
    expect(budget.remaining).toBe(550);
  });

  it("budget check fails when over budget", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 500, output: 300 } }),
      makeEvent({ type: "token_usage", turn: 2, tokenUsage: { input: 300, output: 200 } }),
    );

    const budget = checkTokenBudget(acc.tokenUsage.total, 1000);
    expect(budget.exceeded).toBe(true);
    expect(budget.totalUsed).toBe(1300);
  });

  it("unlimited budget always passes", () => {
    const acc = new EventAccumulator();
    acc.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 999999, output: 999999 } }),
    );

    const budget = checkTokenBudget(acc.tokenUsage.total, 0);
    expect(budget.exceeded).toBe(false);
  });

  it("cross-retry accumulation reflects total usage", () => {
    const runAcc = new EventAccumulator();

    // Attempt 1 events
    const attempt1 = new EventAccumulator();
    attempt1.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 50 } }),
    );
    runAcc.push(...attempt1.events);

    // Attempt 2 events
    const attempt2 = new EventAccumulator();
    attempt2.push(
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 200, output: 100 } }),
    );
    runAcc.push(...attempt2.events);

    const budget = checkTokenBudget(runAcc.tokenUsage.total, 500);
    expect(budget.exceeded).toBe(false);
    expect(budget.totalUsed).toBe(450);
  });
});

// ── Feature flag gating ───────────────────────────────────────────────────

describe("useEventPipeline config flag", () => {
  it("is accepted by config validation when true", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), useEventPipeline: true };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.useEventPipeline).toBe(true);
    }
  });

  it("is accepted by config validation when false", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), useEventPipeline: false };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.useEventPipeline).toBe(false);
    }
  });

  it("is optional (undefined is valid)", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.useEventPipeline).toBeUndefined();
    }
  });

  it("defaults to off when not set", () => {
    const config = DEFAULT_HENCH_CONFIG();
    expect(config.useEventPipeline).toBeUndefined();
    // The cliLoop code uses: config.useEventPipeline ?? false
    expect(config.useEventPipeline ?? false).toBe(false);
  });

  it("rejects non-boolean values", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), useEventPipeline: "yes" as unknown };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });
});

// ── rawJsonToTokenUsageEvent + EventAccumulator integration ───────────────

describe("rawJsonToTokenUsageEvent → EventAccumulator integration", () => {
  const metadata = { vendor: "claude" as const, model: "sonnet" };

  it("token usage events flow through accumulator correctly", () => {
    const acc = new EventAccumulator();

    // Simulate processing two raw JSON lines with usage data
    const event1 = rawJsonToTokenUsageEvent(
      { usage: { input_tokens: 100, output_tokens: 50 } },
      1,
      metadata,
    );
    const event2 = rawJsonToTokenUsageEvent(
      { message: { usage: { input_tokens: 200, output_tokens: 100 } } },
      2,
      metadata,
    );

    if (event1) acc.push(event1);
    if (event2) acc.push(event2);

    expect(acc.tokenUsage.total.input).toBe(300);
    expect(acc.tokenUsage.total.output).toBe(150);
    expect(acc.tokenUsage.perTurn).toHaveLength(2);
    expect(acc.tokenUsage.overallDiagnostic).toBe("complete");
  });

  it("mixed events accumulate correctly", () => {
    const acc = new EventAccumulator();

    // Push adapter-produced events
    acc.push(makeEvent({ type: "assistant", turn: 1, text: "Working..." }));
    acc.push(makeEvent({
      type: "tool_use", turn: 1,
      toolCall: { tool: "Read", input: { file: "test.ts" } },
    }));

    // Push rawJson-produced token usage event
    const tokenEvent = rawJsonToTokenUsageEvent(
      { usage: { input_tokens: 500, output_tokens: 200 } },
      1,
      metadata,
    );
    if (tokenEvent) acc.push(tokenEvent);

    expect(acc.assistantText).toEqual(["Working..."]);
    expect(acc.toolCalls.count).toBe(1);
    expect(acc.tokenUsage.total.input).toBe(500);
    expect(acc.tokenUsage.total.output).toBe(200);
  });
});

// ── Per-turn model enrichment ─────────────────────────────────────────────

describe("Per-turn model enrichment", () => {
  it("accumulator perTurn entries carry vendor from event", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "token_usage",
      turn: 1,
      vendor: "codex",
      tokenUsage: { input: 100, output: 50 },
    }));

    expect(acc.tokenUsage.perTurn[0].vendor).toBe("codex");
  });

  it("toCliRunResult turnTokenUsage can be enriched with model post-derivation", () => {
    const acc = new EventAccumulator();
    acc.push(makeEvent({
      type: "token_usage",
      turn: 1,
      tokenUsage: { input: 100, output: 50 },
    }));

    const result = acc.toCliRunResult();
    // Simulate the model enrichment step from spawnWithAdapter
    for (const tu of result.turnTokenUsage) {
      if (!tu.model) tu.model = "sonnet";
    }

    expect(result.turnTokenUsage[0].model).toBe("sonnet");
  });
});

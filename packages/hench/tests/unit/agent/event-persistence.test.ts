/**
 * Unit tests for event persistence in run records.
 *
 * Covers all three acceptance criteria:
 * 1. Optional events field on RunRecord schema
 * 2. Events stored in verbose/debug mode (event pipeline)
 * 3. hench show --events displays event stream for a run
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunRecord, PersistedRuntimeEvent } from "../../../src/schema/index.js";
import { RunRecordSchema, validateRunRecord } from "../../../src/schema/validate.js";
import { saveRun } from "../../../src/store/runs.js";
import { initConfig } from "../../../src/store/config.js";
import { toPersistedEvent } from "../../../src/agent/lifecycle/cli-loop.js";
import { formatEvent } from "../../../src/cli/commands/show.js";
import type { RuntimeEvent } from "../../../src/prd/llm-gateway.js";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a RuntimeEvent with sensible defaults. */
function makeEvent(overrides: Partial<RuntimeEvent> & Pick<RuntimeEvent, "type">): RuntimeEvent {
  return {
    vendor: "claude",
    turn: 1,
    timestamp: "2025-06-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: "run-events-001",
    taskId: "task-001",
    taskTitle: "Test task",
    startedAt: "2025-06-01T00:00:00.000Z",
    finishedAt: "2025-06-01T00:01:00.000Z",
    status: "completed",
    turns: 3,
    tokenUsage: { input: 1000, output: 500 },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  };
}

// ── AC1: Optional events field on RunRecord schema ────────────────────

describe("RunRecord schema — events field", () => {
  it("validates a RunRecord without events (backward compat)", () => {
    const run = makeRun();
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("validates a RunRecord with an empty events array", () => {
    const run = makeRun({ events: [] });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("validates a RunRecord with assistant events", () => {
    const events: PersistedRuntimeEvent[] = [
      {
        type: "assistant",
        vendor: "claude",
        turn: 1,
        timestamp: "2025-06-01T00:00:01.000Z",
        text: "Hello, I will implement this feature.",
      },
    ];
    const run = makeRun({ events });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("validates a RunRecord with tool_use events", () => {
    const events: PersistedRuntimeEvent[] = [
      {
        type: "tool_use",
        vendor: "claude",
        turn: 1,
        timestamp: "2025-06-01T00:00:02.000Z",
        toolCall: { tool: "Read", input: { file: "src/index.ts" } },
      },
    ];
    const run = makeRun({ events });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("validates a RunRecord with tool_result events", () => {
    const events: PersistedRuntimeEvent[] = [
      {
        type: "tool_result",
        vendor: "claude",
        turn: 1,
        timestamp: "2025-06-01T00:00:03.000Z",
        toolResult: { tool: "Read", output: "file contents here", durationMs: 50 },
      },
    ];
    const run = makeRun({ events });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("validates a RunRecord with token_usage events", () => {
    const events: PersistedRuntimeEvent[] = [
      {
        type: "token_usage",
        vendor: "claude",
        turn: 1,
        timestamp: "2025-06-01T00:00:04.000Z",
        tokenUsage: { input: 500, output: 200 },
      },
    ];
    const run = makeRun({ events });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("validates a RunRecord with failure events", () => {
    const events: PersistedRuntimeEvent[] = [
      {
        type: "failure",
        vendor: "codex",
        turn: 2,
        timestamp: "2025-06-01T00:00:05.000Z",
        failure: { category: "timeout", message: "Operation timed out", vendorDetail: "ETIMEDOUT" },
      },
    ];
    const run = makeRun({ events });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("validates a RunRecord with completion events", () => {
    const events: PersistedRuntimeEvent[] = [
      {
        type: "completion",
        vendor: "claude",
        turn: 3,
        timestamp: "2025-06-01T00:00:06.000Z",
        completionSummary: "Task completed successfully.",
      },
    ];
    const run = makeRun({ events });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("validates a RunRecord with mixed event types", () => {
    const events: PersistedRuntimeEvent[] = [
      { type: "assistant", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:01.000Z", text: "Starting work." },
      { type: "tool_use", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:02.000Z", toolCall: { tool: "Read", input: { file: "a.ts" } } },
      { type: "tool_result", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:03.000Z", toolResult: { tool: "Read", output: "contents", durationMs: 10 } },
      { type: "token_usage", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:04.000Z", tokenUsage: { input: 200, output: 100 } },
      { type: "assistant", vendor: "claude", turn: 2, timestamp: "2025-06-01T00:00:05.000Z", text: "Done." },
      { type: "completion", vendor: "claude", turn: 2, timestamp: "2025-06-01T00:00:06.000Z", completionSummary: "Implemented feature." },
    ];
    const run = makeRun({ events });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("rejects events with missing required fields", () => {
    const run = makeRun({
      events: [
        // Missing 'type' field
        { vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:00.000Z" } as unknown as PersistedRuntimeEvent,
      ],
    });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(false);
  });
});

// ── AC2: toPersistedEvent conversion ──────────────────────────────────

describe("toPersistedEvent — RuntimeEvent → PersistedRuntimeEvent", () => {
  it("converts an assistant event", () => {
    const event = makeEvent({ type: "assistant", text: "Hello world" });
    const persisted = toPersistedEvent(event);
    expect(persisted.type).toBe("assistant");
    expect(persisted.vendor).toBe("claude");
    expect(persisted.turn).toBe(1);
    expect(persisted.text).toBe("Hello world");
    expect(persisted.toolCall).toBeUndefined();
    expect(persisted.toolResult).toBeUndefined();
  });

  it("converts a tool_use event", () => {
    const event = makeEvent({
      type: "tool_use",
      toolCall: { tool: "Edit", input: { file: "src/main.ts", content: "new content" } },
    });
    const persisted = toPersistedEvent(event);
    expect(persisted.type).toBe("tool_use");
    expect(persisted.toolCall).toEqual({ tool: "Edit", input: { file: "src/main.ts", content: "new content" } });
    expect(persisted.text).toBeUndefined();
  });

  it("converts a tool_result event", () => {
    const event = makeEvent({
      type: "tool_result",
      toolResult: { tool: "Edit", output: "File edited successfully", durationMs: 25 },
    });
    const persisted = toPersistedEvent(event);
    expect(persisted.type).toBe("tool_result");
    expect(persisted.toolResult).toEqual({ tool: "Edit", output: "File edited successfully", durationMs: 25 });
  });

  it("converts a token_usage event", () => {
    const event = makeEvent({
      type: "token_usage",
      tokenUsage: { input: 1000, output: 500, cacheCreationInput: 200, cacheReadInput: 100 },
    });
    const persisted = toPersistedEvent(event);
    expect(persisted.type).toBe("token_usage");
    expect(persisted.tokenUsage).toEqual({ input: 1000, output: 500, cacheCreationInput: 200, cacheReadInput: 100 });
  });

  it("converts a failure event with vendorDetail", () => {
    const event = makeEvent({
      type: "failure",
      vendor: "codex",
      failure: { category: "rate_limit", message: "Too many requests", vendorDetail: "429 status" },
    });
    const persisted = toPersistedEvent(event);
    expect(persisted.type).toBe("failure");
    expect(persisted.vendor).toBe("codex");
    expect(persisted.failure).toEqual({ category: "rate_limit", message: "Too many requests", vendorDetail: "429 status" });
  });

  it("converts a failure event without vendorDetail", () => {
    const event = makeEvent({
      type: "failure",
      failure: { category: "unknown", message: "Something broke" },
    });
    const persisted = toPersistedEvent(event);
    expect(persisted.failure).toEqual({ category: "unknown", message: "Something broke" });
    expect(persisted.failure!.vendorDetail).toBeUndefined();
  });

  it("converts a completion event", () => {
    const event = makeEvent({
      type: "completion",
      completionSummary: "All tasks done.",
    });
    const persisted = toPersistedEvent(event);
    expect(persisted.type).toBe("completion");
    expect(persisted.completionSummary).toBe("All tasks done.");
  });

  it("preserves timestamp and turn from the original event", () => {
    const event = makeEvent({
      type: "assistant",
      turn: 7,
      timestamp: "2025-12-25T12:00:00.000Z",
      text: "Merry Christmas!",
    });
    const persisted = toPersistedEvent(event);
    expect(persisted.turn).toBe(7);
    expect(persisted.timestamp).toBe("2025-12-25T12:00:00.000Z");
  });

  it("produces Zod-valid events when round-tripped through RunRecord", () => {
    const events: RuntimeEvent[] = [
      makeEvent({ type: "assistant", text: "Starting" }),
      makeEvent({ type: "tool_use", turn: 1, toolCall: { tool: "Read", input: { path: "x" } } }),
      makeEvent({ type: "tool_result", turn: 1, toolResult: { tool: "Read", output: "data", durationMs: 5 } }),
      makeEvent({ type: "token_usage", turn: 1, tokenUsage: { input: 100, output: 50 } }),
      makeEvent({ type: "completion", turn: 2, completionSummary: "Done" }),
    ];
    const persisted = events.map(toPersistedEvent);
    const run = makeRun({ events: persisted });
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });
});

// ── AC3: hench show --events displays event stream ────────────────────

describe("formatEvent — human-readable event formatting", () => {
  it("formats an assistant event", () => {
    const event: PersistedRuntimeEvent = {
      type: "assistant", vendor: "claude", turn: 1,
      timestamp: "2025-06-01T00:00:01.000Z", text: "Hello world",
    };
    const line = formatEvent(event);
    expect(line).toContain("[1]");
    expect(line).toContain("claude");
    expect(line).toContain("assistant");
    expect(line).toContain("Hello world");
  });

  it("formats a tool_use event", () => {
    const event: PersistedRuntimeEvent = {
      type: "tool_use", vendor: "claude", turn: 2,
      timestamp: "2025-06-01T00:00:02.000Z",
      toolCall: { tool: "Edit", input: { file: "main.ts" } },
    };
    const line = formatEvent(event);
    expect(line).toContain("[2]");
    expect(line).toContain("tool_use");
    expect(line).toContain("Edit");
  });

  it("formats a tool_result event with duration", () => {
    const event: PersistedRuntimeEvent = {
      type: "tool_result", vendor: "codex", turn: 2,
      timestamp: "2025-06-01T00:00:03.000Z",
      toolResult: { tool: "Read", output: "file contents", durationMs: 42 },
    };
    const line = formatEvent(event);
    expect(line).toContain("tool_result");
    expect(line).toContain("Read");
    expect(line).toContain("42ms");
  });

  it("formats a token_usage event", () => {
    const event: PersistedRuntimeEvent = {
      type: "token_usage", vendor: "claude", turn: 1,
      timestamp: "2025-06-01T00:00:04.000Z",
      tokenUsage: { input: 500, output: 200 },
    };
    const line = formatEvent(event);
    expect(line).toContain("token_usage");
    expect(line).toContain("500 in");
    expect(line).toContain("200 out");
  });

  it("formats a completion event", () => {
    const event: PersistedRuntimeEvent = {
      type: "completion", vendor: "claude", turn: 3,
      timestamp: "2025-06-01T00:00:05.000Z",
      completionSummary: "Feature implemented successfully.",
    };
    const line = formatEvent(event);
    expect(line).toContain("completion");
    expect(line).toContain("Feature implemented");
  });

  it("formats a failure event with category", () => {
    const event: PersistedRuntimeEvent = {
      type: "failure", vendor: "codex", turn: 2,
      timestamp: "2025-06-01T00:00:06.000Z",
      failure: { category: "timeout", message: "Operation timed out" },
    };
    const line = formatEvent(event);
    expect(line).toContain("failure");
    expect(line).toContain("timeout");
    expect(line).toContain("Operation timed out");
  });

  it("truncates long assistant text", () => {
    const longText = "A".repeat(500);
    const event: PersistedRuntimeEvent = {
      type: "assistant", vendor: "claude", turn: 1,
      timestamp: "2025-06-01T00:00:00.000Z", text: longText,
    };
    const line = formatEvent(event);
    // The formatEvent truncates text at 200 chars
    expect(line.length).toBeLessThan(longText.length);
  });
});

describe("cmdShow --events integration", () => {
  let projectDir: string;
  let henchDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-events-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("displays no-events message when events are absent", async () => {
    const run = makeRun();
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-events-001", { events: "" });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("no events recorded");
    expect(allOutput).toContain("useEventPipeline");
  });

  it("displays event stream when events are present", async () => {
    const events: PersistedRuntimeEvent[] = [
      { type: "assistant", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:01.000Z", text: "Starting implementation." },
      { type: "tool_use", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:02.000Z", toolCall: { tool: "Read", input: { file: "index.ts" } } },
      { type: "tool_result", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:03.000Z", toolResult: { tool: "Read", output: "export function main() {}", durationMs: 15 } },
      { type: "token_usage", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:04.000Z", tokenUsage: { input: 300, output: 100 } },
      { type: "completion", vendor: "claude", turn: 2, timestamp: "2025-06-01T00:00:05.000Z", completionSummary: "Done." },
    ];
    const run = makeRun({ events });
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-events-001", { events: "" });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Events (5)");
    expect(allOutput).toContain("assistant");
    expect(allOutput).toContain("Starting implementation");
    expect(allOutput).toContain("tool_use");
    expect(allOutput).toContain("Read");
    expect(allOutput).toContain("tool_result");
    expect(allOutput).toContain("15ms");
    expect(allOutput).toContain("token_usage");
    expect(allOutput).toContain("300 in");
    expect(allOutput).toContain("completion");
    expect(allOutput).toContain("Done.");
  });

  it("shows event count hint in normal show mode when events are present", async () => {
    const events: PersistedRuntimeEvent[] = [
      { type: "assistant", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:01.000Z", text: "Hello" },
    ];
    const run = makeRun({ events });
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-events-001", {});

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Events: 1 captured");
    expect(allOutput).toContain("--events");
  });

  it("--events does not show full run details", async () => {
    const events: PersistedRuntimeEvent[] = [
      { type: "assistant", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:01.000Z", text: "Hello" },
    ];
    const run = makeRun({ events });
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-events-001", { events: "" });

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Should show run ID but not the full details
    expect(allOutput).toContain("Run: run-events-001");
    expect(allOutput).not.toContain("Turns:");
    expect(allOutput).not.toContain("Token Usage Per Turn");
  });
});

// ── Round-trip: persist → load → validate ─────────────────────────────

describe("event persistence round-trip", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-rt-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("saves and loads a run with events, events survive validation", async () => {
    const { loadRun } = await import("../../../src/store/runs.js");

    const events: PersistedRuntimeEvent[] = [
      { type: "assistant", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:01.000Z", text: "Hello" },
      { type: "tool_use", vendor: "claude", turn: 1, timestamp: "2025-06-01T00:00:02.000Z", toolCall: { tool: "Edit", input: { path: "a.ts" } } },
      { type: "failure", vendor: "codex", turn: 2, timestamp: "2025-06-01T00:00:03.000Z", failure: { category: "unknown", message: "err" } },
    ];
    const run = makeRun({ events });

    await saveRun(henchDir, run);
    const loaded = await loadRun(henchDir, "run-events-001");

    expect(loaded.events).toBeDefined();
    expect(loaded.events).toHaveLength(3);
    expect(loaded.events![0].type).toBe("assistant");
    expect(loaded.events![0].text).toBe("Hello");
    expect(loaded.events![1].toolCall?.tool).toBe("Edit");
    expect(loaded.events![2].failure?.category).toBe("unknown");
  });
});

import { describe, it, expect } from "vitest";
import {
  validateConfig,
  validateRunRecord,
  HenchConfigSchema,
  RunRecordSchema,
} from "../../../src/schema/validate.js";
import { DEFAULT_HENCH_CONFIG } from "../../../src/schema/v1.js";

describe("validateConfig", () => {
  it("accepts valid default config", () => {
    const config = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.schema).toBe("hench/v1");
      expect(result.data.model).toBe("sonnet");
      expect(result.data.provider).toBe("cli");
    }
  });

  it("rejects config with missing fields", () => {
    const result = validateConfig({ schema: "hench/v1" });
    expect(result.ok).toBe(false);
  });

  it("rejects config with invalid maxTurns", () => {
    const config = { ...DEFAULT_HENCH_CONFIG(), maxTurns: -1 };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });

  it("accepts config with all fields", () => {
    const config = DEFAULT_HENCH_CONFIG();
    config.model = "claude-opus-4-20250514";
    config.maxTurns = 100;
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
  });

  it("accepts config with retry section", () => {
    const config = DEFAULT_HENCH_CONFIG();
    config.retry = { maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 60000 };
    const result = validateConfig(config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.retry).toEqual({
        maxRetries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 60000,
      });
    }
  });

  it("provides retry defaults when retry section is missing", () => {
    const { retry, ...configWithoutRetry } = DEFAULT_HENCH_CONFIG();
    const result = validateConfig(configWithoutRetry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.retry).toEqual({
        maxRetries: 3,
        baseDelayMs: 2000,
        maxDelayMs: 30000,
      });
    }
  });

  it("rejects config with invalid retry values", () => {
    const config = {
      ...DEFAULT_HENCH_CONFIG(),
      retry: { maxRetries: -1, baseDelayMs: 0, maxDelayMs: -100 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
  });
});

describe("validateRunRecord", () => {
  const validRun = {
    id: "test-id",
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: "2025-01-01T00:00:00Z",
    status: "completed",
    turns: 5,
    tokenUsage: { input: 1000, output: 500 },
    toolCalls: [],
    model: "claude-sonnet-4-20250514",
  };

  it("accepts valid run record", () => {
    const result = validateRunRecord(validRun);
    expect(result.ok).toBe(true);
  });

  it("accepts run with optional fields", () => {
    const run = {
      ...validRun,
      finishedAt: "2025-01-01T00:05:00Z",
      summary: "Did some work",
      error: undefined,
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("accepts run with tool calls", () => {
    const run = {
      ...validRun,
      toolCalls: [
        {
          turn: 1,
          tool: "read_file",
          input: { path: "test.ts" },
          output: "content",
          durationMs: 10,
        },
      ],
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("rejects run with invalid status", () => {
    const run = { ...validRun, status: "invalid" };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(false);
  });

  it("rejects run with missing required fields", () => {
    const result = validateRunRecord({ id: "test" });
    expect(result.ok).toBe(false);
  });

  it("accepts error_transient status", () => {
    const run = { ...validRun, status: "error_transient" };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("accepts budget_exceeded status", () => {
    const run = { ...validRun, status: "budget_exceeded" };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
  });

  it("accepts retryAttempts field", () => {
    const run = { ...validRun, retryAttempts: 2 };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.retryAttempts).toBe(2);
    }
  });

  it("accepts run without retryAttempts (backward compat)", () => {
    const result = validateRunRecord(validRun);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.retryAttempts).toBeUndefined();
    }
  });

  it("accepts run with structuredSummary", () => {
    const run = {
      ...validRun,
      structuredSummary: {
        filesChanged: ["src/foo.ts"],
        filesRead: ["src/bar.ts"],
        commandsExecuted: [
          { command: "npm test", exitStatus: "ok", durationMs: 5000 },
        ],
        testsRun: [
          { command: "npm test", passed: true, durationMs: 5000 },
        ],
        counts: {
          filesRead: 1,
          filesChanged: 1,
          commandsExecuted: 1,
          testsRun: 1,
          toolCallsTotal: 3,
        },
      },
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.structuredSummary).toBeDefined();
      expect(result.data.structuredSummary!.filesChanged).toEqual(["src/foo.ts"]);
      expect(result.data.structuredSummary!.counts.testsRun).toBe(1);
    }
  });

  it("accepts run without structuredSummary (backward compat)", () => {
    const result = validateRunRecord(validRun);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.structuredSummary).toBeUndefined();
    }
  });

  it("rejects run with invalid structuredSummary", () => {
    const run = {
      ...validRun,
      structuredSummary: {
        filesChanged: "not-an-array",
      },
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(false);
  });

  it("accepts run with turnTokenUsage", () => {
    const run = {
      ...validRun,
      turnTokenUsage: [
        { turn: 1, input: 500, output: 200 },
        { turn: 2, input: 600, output: 300, cacheCreationInput: 100, cacheReadInput: 400 },
      ],
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.turnTokenUsage).toHaveLength(2);
      expect(result.data.turnTokenUsage![0]).toEqual({ turn: 1, input: 500, output: 200 });
      expect(result.data.turnTokenUsage![1].cacheCreationInput).toBe(100);
      expect(result.data.turnTokenUsage![1].cacheReadInput).toBe(400);
    }
  });

  it("accepts run without turnTokenUsage (backward compat)", () => {
    const result = validateRunRecord(validRun);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.turnTokenUsage).toBeUndefined();
    }
  });

  it("accepts tokenUsage with cache fields", () => {
    const run = {
      ...validRun,
      tokenUsage: { input: 1000, output: 500, cacheCreationInput: 200, cacheReadInput: 800 },
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenUsage.cacheCreationInput).toBe(200);
      expect(result.data.tokenUsage.cacheReadInput).toBe(800);
    }
  });

  it("accepts tokenUsage without cache fields (backward compat)", () => {
    const result = validateRunRecord(validRun);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.tokenUsage.cacheCreationInput).toBeUndefined();
      expect(result.data.tokenUsage.cacheReadInput).toBeUndefined();
    }
  });

  it("rejects run with invalid turnTokenUsage entries", () => {
    const run = {
      ...validRun,
      turnTokenUsage: [{ turn: "not-a-number", input: 500 }],
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(false);
  });
});

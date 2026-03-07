import { describe, it, expect } from "vitest";
import {
  validateConfig,
  validateRunRecord,
  formatValidationErrors,
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

  describe("tokenBudget defaults and validation", () => {
    it("is optional in schema and defaults to 0 (unlimited)", () => {
      const { tokenBudget, ...configWithout } = DEFAULT_HENCH_CONFIG();
      const result = validateConfig(configWithout);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.tokenBudget).toBe(0);
      }
    });

    it("can be set to a positive value", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: 500000 };
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.tokenBudget).toBe(500000);
      }
    });

    it("accepts tokenBudget of 0 (unlimited)", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: 0 };
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.tokenBudget).toBe(0);
      }
    });

    it("rejects negative tokenBudget", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), tokenBudget: -1 };
      const result = validateConfig(config);
      expect(result.ok).toBe(false);
    });

    it("validates existing configs without tokenBudget field (backward compat)", () => {
      const { tokenBudget, ...legacy } = DEFAULT_HENCH_CONFIG();
      const result = validateConfig(legacy);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.tokenBudget).toBe(0);
      }
    });
  });

  describe("maxFailedAttempts defaults and validation", () => {
    it("is optional in schema and defaults to 3", () => {
      const { maxFailedAttempts, ...configWithout } = DEFAULT_HENCH_CONFIG();
      const result = validateConfig(configWithout);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.maxFailedAttempts).toBe(3);
      }
    });

    it("can be customised in config", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: 5 };
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.maxFailedAttempts).toBe(5);
      }
    });

    it("rejects maxFailedAttempts of 0", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: 0 };
      const result = validateConfig(config);
      expect(result.ok).toBe(false);
    });

    it("rejects negative maxFailedAttempts", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), maxFailedAttempts: -1 };
      const result = validateConfig(config);
      expect(result.ok).toBe(false);
    });
  });

  describe("guard.spawnTimeout defaults and validation", () => {
    it("is optional in schema and defaults to 300000", () => {
      const config = DEFAULT_HENCH_CONFIG();
      const { spawnTimeout, ...guardWithout } = config.guard;
      const result = validateConfig({ ...config, guard: guardWithout });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.spawnTimeout).toBe(300000);
      }
    });

    it("can be set to a positive value", () => {
      const config = DEFAULT_HENCH_CONFIG();
      config.guard.spawnTimeout = 600000;
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.spawnTimeout).toBe(600000);
      }
    });

    it("accepts 0 (no timeout)", () => {
      const config = DEFAULT_HENCH_CONFIG();
      config.guard.spawnTimeout = 0;
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.spawnTimeout).toBe(0);
      }
    });

    it("rejects negative spawnTimeout", () => {
      const config = DEFAULT_HENCH_CONFIG();
      config.guard.spawnTimeout = -1;
      const result = validateConfig(config);
      expect(result.ok).toBe(false);
    });
  });

  describe("guard.maxConcurrentProcesses defaults and validation", () => {
    it("is optional in schema and defaults to 3", () => {
      const config = DEFAULT_HENCH_CONFIG();
      const { maxConcurrentProcesses, ...guardWithout } = config.guard;
      const result = validateConfig({ ...config, guard: guardWithout });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.maxConcurrentProcesses).toBe(3);
      }
    });

    it("can be customised", () => {
      const config = DEFAULT_HENCH_CONFIG();
      config.guard.maxConcurrentProcesses = 8;
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.maxConcurrentProcesses).toBe(8);
      }
    });

    it("rejects 0", () => {
      const config = DEFAULT_HENCH_CONFIG();
      config.guard.maxConcurrentProcesses = 0;
      const result = validateConfig(config);
      expect(result.ok).toBe(false);
    });

    it("rejects negative value", () => {
      const config = DEFAULT_HENCH_CONFIG();
      config.guard.maxConcurrentProcesses = -1;
      const result = validateConfig(config);
      expect(result.ok).toBe(false);
    });
  });

  describe("guard.memoryThrottle preservation", () => {
    it("preserves memoryThrottle when present in guard config", () => {
      const config = DEFAULT_HENCH_CONFIG();
      (config.guard as Record<string, unknown>).memoryThrottle = { enabled: false };
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.memoryThrottle).toEqual({ enabled: false });
      }
    });

    it("accepts memoryThrottle with partial overrides", () => {
      const config = DEFAULT_HENCH_CONFIG();
      (config.guard as Record<string, unknown>).memoryThrottle = {
        enabled: true,
        delayThreshold: 70,
        rejectThreshold: 90,
      };
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.memoryThrottle).toEqual({
          enabled: true,
          delayThreshold: 70,
          rejectThreshold: 90,
        });
      }
    });

    it("accepts config without memoryThrottle (backward compat)", () => {
      const config = DEFAULT_HENCH_CONFIG();
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.memoryThrottle).toBeUndefined();
      }
    });
  });

  describe("guard.memoryMonitor preservation", () => {
    it("preserves memoryMonitor when present in guard config", () => {
      const config = DEFAULT_HENCH_CONFIG();
      (config.guard as Record<string, unknown>).memoryMonitor = { enabled: false };
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.memoryMonitor).toEqual({ enabled: false });
      }
    });

    it("accepts config without memoryMonitor (backward compat)", () => {
      const config = DEFAULT_HENCH_CONFIG();
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.guard.memoryMonitor).toBeUndefined();
      }
    });
  });

  describe("loopPauseMs defaults and validation", () => {
    it("is optional in schema and defaults to 2000", () => {
      const { loopPauseMs, ...configWithout } = DEFAULT_HENCH_CONFIG();
      const result = validateConfig(configWithout);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.loopPauseMs).toBe(2000);
      }
    });

    it("can be customised in config", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), loopPauseMs: 5000 };
      const result = validateConfig(config);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.loopPauseMs).toBe(5000);
      }
    });

    it("rejects negative loopPauseMs", () => {
      const config = { ...DEFAULT_HENCH_CONFIG(), loopPauseMs: -1 };
      const result = validateConfig(config);
      expect(result.ok).toBe(false);
    });
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
    model: "claude-sonnet-4-6",
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

  it("accepts turnTokenUsage entries with vendor/model metadata", () => {
    const run = {
      ...validRun,
      turnTokenUsage: [
        { turn: 1, input: 500, output: 200, vendor: "claude", model: "claude-sonnet-4-6" },
      ],
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.turnTokenUsage![0].vendor).toBe("claude");
      expect(result.data.turnTokenUsage![0].model).toBe("claude-sonnet-4-6");
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

  it("accepts all valid run status values", () => {
    const statuses = ["running", "completed", "failed", "timeout", "budget_exceeded", "error_transient"];
    for (const status of statuses) {
      const run = { ...validRun, status };
      const result = validateRunRecord(run);
      expect(result.ok).toBe(true);
    }
  });

  it("accepts legacy run without finishedAt (backward compat)", () => {
    const { finishedAt, ...legacyRun } = { ...validRun, finishedAt: undefined };
    const result = validateRunRecord(legacyRun);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.finishedAt).toBeUndefined();
    }
  });

  it("accepts run with lastActivityAt", () => {
    const run = { ...validRun, lastActivityAt: "2025-01-01T00:03:00Z" };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lastActivityAt).toBe("2025-01-01T00:03:00Z");
    }
  });

  it("accepts run without lastActivityAt (backward compat)", () => {
    const result = validateRunRecord(validRun);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.lastActivityAt).toBeUndefined();
    }
  });
});

describe("formatValidationErrors", () => {
  it("formats missing field errors with path", () => {
    const result = validateConfig({ schema: "hench/v1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.length).toBeGreaterThan(0);
      // Should mention the missing field name
      expect(messages.some((m) => m.includes("model") || m.includes("maxTurns"))).toBe(true);
    }
  });

  it("formats invalid value errors with field path", () => {
    const run = {
      id: "test",
      taskId: "task-1",
      taskTitle: "Test",
      startedAt: "2025-01-01T00:00:00Z",
      status: "bad_status",
      turns: 5,
      tokenUsage: { input: 1000, output: 500 },
      toolCalls: [],
      model: "sonnet",
    };
    const result = validateRunRecord(run);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.some((m) => m.includes("status"))).toBe(true);
    }
  });

  it("provides actionable messages for nested validation errors", () => {
    const config = {
      ...DEFAULT_HENCH_CONFIG(),
      guard: { blockedPaths: "not-an-array", allowedCommands: [], commandTimeout: 30000, maxFileSize: 1048576 },
    };
    const result = validateConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = formatValidationErrors(result.errors);
      expect(messages.some((m) => m.includes("guard") && m.includes("blockedPaths"))).toBe(true);
    }
  });
});

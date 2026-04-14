import { describe, it, expect } from "vitest";
import {
  validateTokenReporting,
  compareCodexAndClaude,
  validateVendorAttribution,
  validateTokenReportingBatch,
} from "../../../src/quota/token-validation.js";
import type { RunRecord, TurnTokenUsage } from "../../../src/schema/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function createRunRecord(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: "run-123",
    taskId: "task-123",
    taskTitle: "Test Task",
    status: "completed",
    turns: 1,
    startedAt: new Date().toISOString(),
    tokenUsage: { input: 1000, output: 200 },
    turnTokenUsage: [
      {
        turn: 1,
        vendor: "claude",
        model: "claude-3-opus",
        input: 1000,
        output: 200,
      },
    ],
    toolCalls: [],
    model: "claude-3-opus",
    ...overrides,
  };
}

function createCodexTurn(turn: number = 1): TurnTokenUsage {
  return {
    turn,
    vendor: "codex",
    model: "gpt-4o",
    input: 1000,
    output: 200,
  };
}

// ── validateTokenReporting ───────────────────────────────────────────────────

describe("validateTokenReporting", () => {
  describe("non-zero token validation", () => {
    it("passes when Codex run has non-zero tokens", () => {
      const run = createRunRecord({
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 1000, output: 200 },
      });

      const result = validateTokenReporting(run);

      expect(result.ok).toBe(true);
      expect(result.issues.filter((i) => i.category === "non-zero")).toHaveLength(0);
    });

    it("fails when Codex run has zero input and output tokens", () => {
      const run = createRunRecord({
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 0, output: 0 },
      });

      const result = validateTokenReporting(run);

      expect(result.ok).toBe(false);
      expect(result.issues.some((i) => i.category === "non-zero" && i.severity === "error")).toBe(true);
    });

    it("warns when Codex run has zero input tokens", () => {
      const run = createRunRecord({
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 0, output: 200 },
      });

      const result = validateTokenReporting(run);

      expect(result.issues.some((i) => i.category === "non-zero" && i.severity === "warning")).toBe(true);
    });

    it("warns when Codex run has zero output tokens", () => {
      const run = createRunRecord({
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 1000, output: 0 },
      });

      const result = validateTokenReporting(run);

      expect(result.issues.some((i) => i.category === "non-zero" && i.severity === "warning")).toBe(true);
    });

    it("passes when Claude run has zero tokens (expected for certain scenarios)", () => {
      const run = createRunRecord({
        tokenUsage: { input: 0, output: 0 },
      });

      const result = validateTokenReporting(run);

      expect(result.issues.filter((i) => i.category === "non-zero")).toHaveLength(0);
    });
  });

  describe("metrics computation", () => {
    it("computes correct metrics for multi-turn run", () => {
      const run = createRunRecord({
        turns: 3,
        turnTokenUsage: [
          { turn: 1, vendor: "codex", model: "gpt-4o", input: 500, output: 100 },
          { turn: 2, vendor: "codex", model: "gpt-4o", input: 1000, output: 200 },
          { turn: 3, vendor: "codex", model: "gpt-4o", input: 500, output: 100 },
        ],
        tokenUsage: { input: 2000, output: 400 },
      });

      const result = validateTokenReporting(run);

      expect(result.metrics).toEqual({
        totalInput: 2000,
        totalOutput: 400,
        avgTokensPerTurn: 800,
        maxTokensPerTurn: 1200,
        zeroTokenTurns: 0,
        vendorBreakdown: { codex: 3 },
        isCodexRun: true,
        isClaudeRun: false,
      });
    });

    it("detects zero-token turns", () => {
      const run = createRunRecord({
        turns: 3,
        turnTokenUsage: [
          { turn: 1, vendor: "codex", model: "gpt-4o", input: 1000, output: 200 },
          { turn: 2, vendor: "codex", model: "gpt-4o", input: 0, output: 0 },
          { turn: 3, vendor: "codex", model: "gpt-4o", input: 500, output: 100 },
        ],
        tokenUsage: { input: 1500, output: 300 },
      });

      const result = validateTokenReporting(run);

      expect(result.metrics.zeroTokenTurns).toBe(1);
      expect(result.issues.some((i) => i.category === "consistency")).toBe(true);
    });

    it("tracks vendor breakdown correctly", () => {
      const run = createRunRecord({
        turns: 3,
        turnTokenUsage: [
          { turn: 1, vendor: "claude", model: "claude-3-opus", input: 1000, output: 200 },
          { turn: 2, vendor: "codex", model: "gpt-4o", input: 500, output: 100 },
          { turn: 3, vendor: "claude", model: "claude-3-opus", input: 1000, output: 200 },
        ],
        tokenUsage: { input: 2500, output: 500 },
      });

      const result = validateTokenReporting(run);

      expect(result.metrics.vendorBreakdown).toEqual({
        claude: 2,
        codex: 1,
      });
      expect(result.metrics.isCodexRun).toBe(true);
      expect(result.metrics.isClaudeRun).toBe(true);
    });
  });

  describe("outlier detection", () => {
    it("warns on extremely high token usage", () => {
      const run = createRunRecord({
        turns: 1,
        taskTitle: "Simple task",
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 50000, output: 10000 },
      });

      const result = validateTokenReporting(run);

      expect(result.issues.some((i) => i.category === "outlier")).toBe(true);
    });

    it("warns on extremely low token usage for complex tasks", () => {
      const run = createRunRecord({
        turns: 8,
        taskTitle: "Complex refactoring with many changes",
        turnTokenUsage: [
          ...Array.from({ length: 8 }, (_, i) =>
            ({
              turn: i + 1,
              vendor: "codex" as const,
              model: "gpt-4o",
              input: 100,
              output: 20,
            }),
          ),
        ],
        tokenUsage: { input: 800, output: 160 },
      });

      const result = validateTokenReporting(run);

      expect(result.issues.some((i) => i.category === "outlier")).toBe(true);
    });

    it("passes on normal token usage within expected ranges", () => {
      const run = createRunRecord({
        turns: 3,
        taskTitle: "Moderate task",
        turnTokenUsage: [
          { turn: 1, vendor: "codex", model: "gpt-4o", input: 1500, output: 300 },
          { turn: 2, vendor: "codex", model: "gpt-4o", input: 2000, output: 400 },
          { turn: 3, vendor: "codex", model: "gpt-4o", input: 1500, output: 300 },
        ],
        tokenUsage: { input: 5000, output: 1000 },
      });

      const result = validateTokenReporting(run);

      expect(result.issues.filter((i) => i.category === "outlier")).toHaveLength(0);
    });
  });

  describe("vendor attribution", () => {
    it("detects mismatched vendor and model", () => {
      const run = createRunRecord({
        turnTokenUsage: [createCodexTurn()],
        model: "claude-3-opus", // Mismatch: Codex vendor but Claude model
      });

      const result = validateTokenReporting(run);

      expect(result.issues.some((i) => i.category === "attribution")).toBe(true);
    });

    it("passes when vendor and model match", () => {
      const run = createRunRecord({
        turnTokenUsage: [createCodexTurn()],
        model: "gpt-4o",
      });

      const result = validateTokenReporting(run);

      expect(result.issues.filter((i) => i.category === "attribution")).toHaveLength(0);
    });
  });
});

// ── compareCodexAndClaude ────────────────────────────────────────────────────

describe("compareCodexAndClaude", () => {
  it("marks runs as comparable when within acceptable ratio", () => {
    const codexRun = createRunRecord({
      id: "codex-1",
      turnTokenUsage: [createCodexTurn()],
      tokenUsage: { input: 1000, output: 200 },
    });

    const claudeRun = createRunRecord({
      id: "claude-1",
      tokenUsage: { input: 1200, output: 240 },
    });

    const result = compareCodexAndClaude(codexRun, claudeRun);

    expect(result.comparable).toBe(true);
    expect(result.tokenRatio).toBeCloseTo(0.83, 1); // 1200 / 1440 ≈ 0.83
    expect(result.issues).toHaveLength(0);
  });

  it("flags when Codex uses significantly fewer tokens", () => {
    const codexRun = createRunRecord({
      id: "codex-1",
      turnTokenUsage: [createCodexTurn()],
      tokenUsage: { input: 200, output: 50 },
    });

    const claudeRun = createRunRecord({
      id: "claude-1",
      tokenUsage: { input: 1200, output: 240 },
    });

    const result = compareCodexAndClaude(codexRun, claudeRun);

    expect(result.comparable).toBe(false);
    expect(result.issues.some((i) => i.includes("fewer tokens"))).toBe(true);
  });

  it("flags when Codex uses significantly more tokens", () => {
    const codexRun = createRunRecord({
      id: "codex-1",
      turnTokenUsage: [createCodexTurn()],
      tokenUsage: { input: 5000, output: 1000 },
    });

    const claudeRun = createRunRecord({
      id: "claude-1",
      tokenUsage: { input: 1200, output: 240 },
    });

    const result = compareCodexAndClaude(codexRun, claudeRun);

    expect(result.comparable).toBe(false);
    expect(result.issues.some((i) => i.includes("more tokens"))).toBe(true);
  });

  it("flags when Codex has zero tokens", () => {
    const codexRun = createRunRecord({
      id: "codex-1",
      turnTokenUsage: [createCodexTurn()],
      tokenUsage: { input: 0, output: 0 },
    });

    const claudeRun = createRunRecord({
      id: "claude-1",
      tokenUsage: { input: 1200, output: 240 },
    });

    const result = compareCodexAndClaude(codexRun, claudeRun);

    expect(result.issues.some((i) => i.includes("zero tokens"))).toBe(true);
  });
});

// ── validateVendorAttribution ────────────────────────────────────────────────

describe("validateVendorAttribution", () => {
  it("passes when all turns have valid vendors", () => {
    const run = createRunRecord({
      turnTokenUsage: [
        { turn: 1, vendor: "codex", model: "gpt-4o", input: 1000, output: 200 },
        { turn: 2, vendor: "codex", model: "gpt-4o", input: 500, output: 100 },
      ],
      model: "gpt-4o",
    });

    const issues = validateVendorAttribution(run);

    expect(issues).toHaveLength(0);
  });

  it("detects missing vendor field", () => {
    const run = createRunRecord({
      turnTokenUsage: [{ turn: 1, vendor: undefined as any, model: "gpt-4o", input: 1000, output: 200 }],
    });

    const issues = validateVendorAttribution(run);

    expect(issues.some((i) => i.includes("invalid vendor"))).toBe(true);
  });

  it("warns on mixed vendors", () => {
    const run = createRunRecord({
      turnTokenUsage: [
        { turn: 1, vendor: "codex", model: "gpt-4o", input: 1000, output: 200 },
        { turn: 2, vendor: "claude", model: "claude-3-opus", input: 500, output: 100 },
      ],
    });

    const issues = validateVendorAttribution(run);

    expect(issues.some((i) => i.includes("multiple vendors"))).toBe(true);
  });

  it("detects model/vendor mismatch", () => {
    const run = createRunRecord({
      turnTokenUsage: [createCodexTurn()],
      model: "claude-3-opus", // Claude model with Codex vendor
    });

    const issues = validateVendorAttribution(run);

    expect(issues.some((i) => i.includes("vendor is Codex but model is not"))).toBe(true);
  });
});

// ── validateTokenReportingBatch ──────────────────────────────────────────────

describe("validateTokenReportingBatch", () => {
  it("summarizes validation results across multiple runs", () => {
    const runs = [
      createRunRecord({
        id: "run-1",
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 1000, output: 200 },
      }),
      createRunRecord({
        id: "run-2",
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 0, output: 0 },
      }),
      createRunRecord({
        id: "run-3",
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 50000, output: 10000 },
      }),
    ];

    const summary = validateTokenReportingBatch(runs);

    expect(summary.totalRuns).toBe(3);
    expect(summary.passedRuns).toBeGreaterThanOrEqual(0);
    expect(summary.failedRuns).toBeGreaterThanOrEqual(0);
  });

  it("computes Codex-specific summary", () => {
    const runs = [
      createRunRecord({
        id: "codex-1",
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 1000, output: 200 },
      }),
      createRunRecord({
        id: "codex-2",
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 2000, output: 400 },
      }),
      createRunRecord({
        id: "claude-1",
        tokenUsage: { input: 1000, output: 200 },
      }),
    ];

    const summary = validateTokenReportingBatch(runs);

    expect(summary.codexSummary).toBeDefined();
    expect(summary.codexSummary?.totalCodexRuns).toBe(2);
    expect(summary.codexSummary?.codexRunsWithNonZeroTokens).toBe(2);
    expect(summary.codexSummary?.averageTokensPerCodexRun).toBe(Math.round((1000 + 200 + 2000 + 400) / 2));
  });

  it("tracks common issues", () => {
    const runs = [
      createRunRecord({
        id: "run-1",
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 0, output: 0 },
      }),
      createRunRecord({
        id: "run-2",
        turnTokenUsage: [createCodexTurn()],
        tokenUsage: { input: 0, output: 0 },
      }),
    ];

    const summary = validateTokenReportingBatch(runs);

    expect(summary.commonIssues.length).toBeGreaterThan(0);
    expect(summary.commonIssues[0].count).toBe(2);
  });
});

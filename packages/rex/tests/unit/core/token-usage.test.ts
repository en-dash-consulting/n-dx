import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  extractRexTokenUsage,
  extractHenchTokenUsage,
  extractSvTokenUsage,
  aggregateTokenUsage,
  estimateCost,
  extractRexTokenEvents,
  extractHenchTokenEvents,
  extractSvTokenEvents,
  collectTokenEvents,
  groupByCommand,
  groupByTimePeriod,
  periodKey,
  checkBudget,
} from "../../../src/core/token-usage.js";
import {
  formatAggregateTokenUsage,
  formatBudgetWarnings,
} from "../../../src/cli/commands/token-format.js";
import type {
  AggregateTokenUsage,
  TokenEvent,
  BudgetConfig,
  TokenUsageLogEntry,
} from "../../../src/core/token-usage.js";

// ---------------------------------------------------------------------------
// extractRexTokenUsage
// ---------------------------------------------------------------------------

describe("extractRexTokenUsage", () => {
  it("extracts token usage from analyze_token_usage log entries", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 2, inputTokens: 3000, outputTokens: 500 }),
      },
    ];

    const usage = extractRexTokenUsage(entries);

    expect(usage.calls).toBe(2);
    expect(usage.inputTokens).toBe(3000);
    expect(usage.outputTokens).toBe(500);
  });

  it("accumulates across multiple log entries", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
      },
      {
        timestamp: "2026-01-16T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 3, inputTokens: 5000, outputTokens: 800 }),
      },
    ];

    const usage = extractRexTokenUsage(entries);

    expect(usage.calls).toBe(4);
    expect(usage.inputTokens).toBe(6000);
    expect(usage.outputTokens).toBe(1000);
  });

  it("ignores non-token events", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "task_completed",
        detail: "some task finished",
      },
      {
        timestamp: "2026-01-15T11:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 500, outputTokens: 100 }),
      },
    ];

    const usage = extractRexTokenUsage(entries);

    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(500);
    expect(usage.outputTokens).toBe(100);
  });

  it("skips entries with malformed detail JSON", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: "not valid json {",
      },
      {
        timestamp: "2026-01-15T11:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 200, outputTokens: 50 }),
      },
    ];

    const usage = extractRexTokenUsage(entries);

    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(200);
  });

  it("skips entries without detail field", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "analyze_token_usage",
      },
    ];

    const usage = extractRexTokenUsage(entries);

    expect(usage.calls).toBe(0);
    expect(usage.inputTokens).toBe(0);
  });

  it("returns zero usage for empty log", () => {
    const usage = extractRexTokenUsage([]);

    expect(usage.calls).toBe(0);
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });

  describe("time filtering", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-10T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
      },
      {
        timestamp: "2026-01-20T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 2000, outputTokens: 400 }),
      },
      {
        timestamp: "2026-01-30T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 3000, outputTokens: 600 }),
      },
    ];

    it("filters by --since", () => {
      const usage = extractRexTokenUsage(entries, {
        since: "2026-01-15T00:00:00.000Z",
      });

      expect(usage.calls).toBe(2);
      expect(usage.inputTokens).toBe(5000);
    });

    it("filters by --until", () => {
      const usage = extractRexTokenUsage(entries, {
        until: "2026-01-25T00:00:00.000Z",
      });

      expect(usage.calls).toBe(2);
      expect(usage.inputTokens).toBe(3000);
    });

    it("filters by both --since and --until", () => {
      const usage = extractRexTokenUsage(entries, {
        since: "2026-01-15T00:00:00.000Z",
        until: "2026-01-25T00:00:00.000Z",
      });

      expect(usage.calls).toBe(1);
      expect(usage.inputTokens).toBe(2000);
    });

    it("returns zero when filter excludes all entries", () => {
      const usage = extractRexTokenUsage(entries, {
        since: "2099-01-01T00:00:00.000Z",
      });

      expect(usage.calls).toBe(0);
      expect(usage.inputTokens).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// extractHenchTokenUsage
// ---------------------------------------------------------------------------

describe("extractHenchTokenUsage", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-token-hench-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  function writeRun(id: string, run: Record<string, unknown>): void {
    mkdirSync(join(tmp, ".hench", "runs"), { recursive: true });
    writeFileSync(
      join(tmp, ".hench", "runs", `${id}.json`),
      JSON.stringify(run),
    );
  }

  it("reads token usage from hench run files", async () => {
    writeRun("run-001", {
      id: "run-001",
      startedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { input: 5000, output: 1500 },
    });

    const usage = await extractHenchTokenUsage(tmp);

    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(5000);
    expect(usage.outputTokens).toBe(1500);
  });

  it("aggregates across multiple run files", async () => {
    writeRun("run-001", {
      id: "run-001",
      startedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { input: 3000, output: 1000 },
    });
    writeRun("run-002", {
      id: "run-002",
      startedAt: "2026-01-16T10:00:00.000Z",
      tokenUsage: { input: 4000, output: 1200 },
    });

    const usage = await extractHenchTokenUsage(tmp);

    expect(usage.calls).toBe(2);
    expect(usage.inputTokens).toBe(7000);
    expect(usage.outputTokens).toBe(2200);
  });

  it("returns zero when .hench/runs does not exist", async () => {
    const usage = await extractHenchTokenUsage(tmp);

    expect(usage.calls).toBe(0);
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });

  it("skips invalid run files", async () => {
    mkdirSync(join(tmp, ".hench", "runs"), { recursive: true });
    writeFileSync(
      join(tmp, ".hench", "runs", "bad.json"),
      "not valid json",
    );
    writeRun("run-001", {
      id: "run-001",
      startedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { input: 1000, output: 200 },
    });

    const usage = await extractHenchTokenUsage(tmp);

    expect(usage.calls).toBe(1);
    expect(usage.inputTokens).toBe(1000);
  });

  it("skips runs without tokenUsage field", async () => {
    writeRun("run-001", {
      id: "run-001",
      startedAt: "2026-01-15T10:00:00.000Z",
    });

    const usage = await extractHenchTokenUsage(tmp);

    expect(usage.calls).toBe(0);
  });

  it("skips non-json files", async () => {
    mkdirSync(join(tmp, ".hench", "runs"), { recursive: true });
    writeFileSync(join(tmp, ".hench", "runs", "notes.txt"), "not a run");
    writeRun("run-001", {
      id: "run-001",
      startedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { input: 500, output: 100 },
    });

    const usage = await extractHenchTokenUsage(tmp);

    expect(usage.calls).toBe(1);
  });

  describe("time filtering", () => {
    it("filters by --since", async () => {
      writeRun("run-001", {
        id: "run-001",
        startedAt: "2026-01-10T10:00:00.000Z",
        tokenUsage: { input: 1000, output: 200 },
      });
      writeRun("run-002", {
        id: "run-002",
        startedAt: "2026-01-20T10:00:00.000Z",
        tokenUsage: { input: 2000, output: 400 },
      });

      const usage = await extractHenchTokenUsage(tmp, {
        since: "2026-01-15T00:00:00.000Z",
      });

      expect(usage.calls).toBe(1);
      expect(usage.inputTokens).toBe(2000);
    });

    it("filters by --until", async () => {
      writeRun("run-001", {
        id: "run-001",
        startedAt: "2026-01-10T10:00:00.000Z",
        tokenUsage: { input: 1000, output: 200 },
      });
      writeRun("run-002", {
        id: "run-002",
        startedAt: "2026-01-20T10:00:00.000Z",
        tokenUsage: { input: 2000, output: 400 },
      });

      const usage = await extractHenchTokenUsage(tmp, {
        until: "2026-01-15T00:00:00.000Z",
      });

      expect(usage.calls).toBe(1);
      expect(usage.inputTokens).toBe(1000);
    });
  });
});

// ---------------------------------------------------------------------------
// extractSvTokenUsage
// ---------------------------------------------------------------------------

describe("extractSvTokenUsage", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-token-sv-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  function writeManifest(manifest: Record<string, unknown>): void {
    mkdirSync(join(tmp, ".sourcevision"), { recursive: true });
    writeFileSync(
      join(tmp, ".sourcevision", "manifest.json"),
      JSON.stringify(manifest),
    );
  }

  it("reads token usage from sourcevision manifest", async () => {
    writeManifest({
      schemaVersion: "1.0.0",
      analyzedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { calls: 3, inputTokens: 2000, outputTokens: 600 },
    });

    const usage = await extractSvTokenUsage(tmp);

    expect(usage.calls).toBe(3);
    expect(usage.inputTokens).toBe(2000);
    expect(usage.outputTokens).toBe(600);
  });

  it("returns zero when .sourcevision does not exist", async () => {
    const usage = await extractSvTokenUsage(tmp);

    expect(usage.calls).toBe(0);
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });

  it("returns zero when manifest has no tokenUsage field", async () => {
    writeManifest({
      schemaVersion: "1.0.0",
      analyzedAt: "2026-01-15T10:00:00.000Z",
    });

    const usage = await extractSvTokenUsage(tmp);

    expect(usage.calls).toBe(0);
  });

  it("returns zero for invalid manifest JSON", async () => {
    mkdirSync(join(tmp, ".sourcevision"), { recursive: true });
    writeFileSync(
      join(tmp, ".sourcevision", "manifest.json"),
      "not valid json",
    );

    const usage = await extractSvTokenUsage(tmp);

    expect(usage.calls).toBe(0);
  });

  describe("time filtering", () => {
    it("filters by --since using analyzedAt", async () => {
      writeManifest({
        schemaVersion: "1.0.0",
        analyzedAt: "2026-01-10T10:00:00.000Z",
        tokenUsage: { calls: 2, inputTokens: 1000, outputTokens: 300 },
      });

      const usage = await extractSvTokenUsage(tmp, {
        since: "2026-01-15T00:00:00.000Z",
      });

      expect(usage.calls).toBe(0);
      expect(usage.inputTokens).toBe(0);
    });

    it("includes data when analyzedAt is within range", async () => {
      writeManifest({
        schemaVersion: "1.0.0",
        analyzedAt: "2026-01-20T10:00:00.000Z",
        tokenUsage: { calls: 2, inputTokens: 1000, outputTokens: 300 },
      });

      const usage = await extractSvTokenUsage(tmp, {
        since: "2026-01-15T00:00:00.000Z",
      });

      expect(usage.calls).toBe(2);
      expect(usage.inputTokens).toBe(1000);
    });

    it("filters by --until using analyzedAt", async () => {
      writeManifest({
        schemaVersion: "1.0.0",
        analyzedAt: "2026-01-20T10:00:00.000Z",
        tokenUsage: { calls: 2, inputTokens: 1000, outputTokens: 300 },
      });

      const usage = await extractSvTokenUsage(tmp, {
        until: "2026-01-15T00:00:00.000Z",
      });

      expect(usage.calls).toBe(0);
    });

    it("includes data when no analyzedAt is present", async () => {
      writeManifest({
        schemaVersion: "1.0.0",
        tokenUsage: { calls: 2, inputTokens: 1000, outputTokens: 300 },
      });

      const usage = await extractSvTokenUsage(tmp, {
        since: "2026-01-15T00:00:00.000Z",
      });

      // No analyzedAt means we can't filter — include the data
      expect(usage.calls).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// aggregateTokenUsage
// ---------------------------------------------------------------------------

describe("aggregateTokenUsage", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-token-agg-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  function writeRun(id: string, run: Record<string, unknown>): void {
    mkdirSync(join(tmp, ".hench", "runs"), { recursive: true });
    writeFileSync(
      join(tmp, ".hench", "runs", `${id}.json`),
      JSON.stringify(run),
    );
  }

  function writeSvManifest(manifest: Record<string, unknown>): void {
    mkdirSync(join(tmp, ".sourcevision"), { recursive: true });
    writeFileSync(
      join(tmp, ".sourcevision", "manifest.json"),
      JSON.stringify(manifest),
    );
  }

  it("combines rex, hench, and sv token usage", async () => {
    const logEntries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 2, inputTokens: 3000, outputTokens: 500 }),
      },
    ];
    writeRun("run-001", {
      id: "run-001",
      startedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { input: 5000, output: 1500 },
    });
    writeSvManifest({
      schemaVersion: "1.0.0",
      analyzedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { calls: 3, inputTokens: 2000, outputTokens: 600 },
    });

    const result = await aggregateTokenUsage(logEntries, tmp);

    expect(result.packages.rex.calls).toBe(2);
    expect(result.packages.rex.inputTokens).toBe(3000);
    expect(result.packages.hench.calls).toBe(1);
    expect(result.packages.hench.inputTokens).toBe(5000);
    expect(result.packages.sv.calls).toBe(3);
    expect(result.packages.sv.inputTokens).toBe(2000);
    expect(result.packages.sv.outputTokens).toBe(600);
    expect(result.totalInputTokens).toBe(10000);
    expect(result.totalOutputTokens).toBe(2600);
    expect(result.totalCalls).toBe(6);
  });

  it("returns zero when no data exists", async () => {
    const result = await aggregateTokenUsage([], tmp);

    expect(result.totalInputTokens).toBe(0);
    expect(result.totalOutputTokens).toBe(0);
    expect(result.totalCalls).toBe(0);
  });

  it("passes filter to all extractors", async () => {
    const logEntries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-10T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
      },
      {
        timestamp: "2026-01-20T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 2000, outputTokens: 400 }),
      },
    ];
    writeRun("run-001", {
      id: "run-001",
      startedAt: "2026-01-10T10:00:00.000Z",
      tokenUsage: { input: 3000, output: 500 },
    });
    writeRun("run-002", {
      id: "run-002",
      startedAt: "2026-01-20T10:00:00.000Z",
      tokenUsage: { input: 4000, output: 600 },
    });
    // SV manifest from Jan 10 — should be excluded by --since filter
    writeSvManifest({
      schemaVersion: "1.0.0",
      analyzedAt: "2026-01-10T10:00:00.000Z",
      tokenUsage: { calls: 1, inputTokens: 500, outputTokens: 100 },
    });

    const result = await aggregateTokenUsage(logEntries, tmp, {
      since: "2026-01-15T00:00:00.000Z",
    });

    // Only the Jan 20 entries should be included
    expect(result.packages.rex.inputTokens).toBe(2000);
    expect(result.packages.hench.inputTokens).toBe(4000);
    expect(result.packages.sv.inputTokens).toBe(0);
    expect(result.totalInputTokens).toBe(6000);
  });
});

// ---------------------------------------------------------------------------
// formatAggregateTokenUsage
// ---------------------------------------------------------------------------

describe("formatAggregateTokenUsage", () => {
  const EMPTY_PKG = { inputTokens: 0, outputTokens: 0, calls: 0 };

  it("formats zero usage as 'none recorded'", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { ...EMPTY_PKG },
        hench: { ...EMPTY_PKG },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCalls: 0,
    };

    const lines = formatAggregateTokenUsage(usage);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("none recorded");
  });

  it("formats total usage with input/output breakdown", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { inputTokens: 3000, outputTokens: 500, calls: 2 },
        hench: { inputTokens: 5000, outputTokens: 1500, calls: 1 },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 8000,
      totalOutputTokens: 2000,
      totalCalls: 3,
    };

    const lines = formatAggregateTokenUsage(usage);

    expect(lines[0]).toContain("10,000 tokens");
    expect(lines[0]).toContain("8,000 in");
    expect(lines[0]).toContain("2,000 out");
  });

  it("shows per-package breakdown", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { inputTokens: 3000, outputTokens: 500, calls: 2 },
        hench: { inputTokens: 5000, outputTokens: 1500, calls: 1 },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 8000,
      totalOutputTokens: 2000,
      totalCalls: 3,
    };

    const lines = formatAggregateTokenUsage(usage);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1]).toContain("rex:");
    expect(lines[1]).toContain("3,500");
    expect(lines[1]).toContain("2 calls");
    expect(lines[1]).toContain("hench:");
    expect(lines[1]).toContain("6,500");
    expect(lines[1]).toContain("1 runs");
  });

  it("shows all three packages when all have usage", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { inputTokens: 3000, outputTokens: 500, calls: 2 },
        hench: { inputTokens: 5000, outputTokens: 1500, calls: 1 },
        sv: { inputTokens: 2000, outputTokens: 600, calls: 3 },
      },
      totalInputTokens: 10000,
      totalOutputTokens: 2600,
      totalCalls: 6,
    };

    const lines = formatAggregateTokenUsage(usage);

    expect(lines[0]).toContain("12,600 tokens");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1]).toContain("sv:");
    expect(lines[1]).toContain("2,600");
    expect(lines[1]).toContain("3 calls");
    expect(lines[1]).toContain("rex:");
    expect(lines[1]).toContain("hench:");
  });

  it("omits packages with zero usage from breakdown", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { inputTokens: 3000, outputTokens: 500, calls: 2 },
        hench: { ...EMPTY_PKG },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 3000,
      totalOutputTokens: 500,
      totalCalls: 2,
    };

    const lines = formatAggregateTokenUsage(usage);

    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1]).toContain("rex:");
    expect(lines[1]).not.toContain("hench:");
    expect(lines[1]).not.toContain("sv:");
  });

  it("shows only hench when rex and sv have no usage", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { ...EMPTY_PKG },
        hench: { inputTokens: 10000, outputTokens: 3000, calls: 5 },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 10000,
      totalOutputTokens: 3000,
      totalCalls: 5,
    };

    const lines = formatAggregateTokenUsage(usage);

    expect(lines[1]).toContain("hench:");
    expect(lines[1]).not.toContain("rex:");
    expect(lines[1]).not.toContain("sv:");
  });

  it("shows only sv when rex and hench have no usage", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { ...EMPTY_PKG },
        hench: { ...EMPTY_PKG },
        sv: { inputTokens: 4000, outputTokens: 1000, calls: 2 },
      },
      totalInputTokens: 4000,
      totalOutputTokens: 1000,
      totalCalls: 2,
    };

    const lines = formatAggregateTokenUsage(usage);

    expect(lines[1]).toContain("sv:");
    expect(lines[1]).not.toContain("rex:");
    expect(lines[1]).not.toContain("hench:");
  });
});

// ---------------------------------------------------------------------------
// estimateCost
// ---------------------------------------------------------------------------

describe("estimateCost", () => {
  const EMPTY_PKG = { inputTokens: 0, outputTokens: 0, calls: 0 };

  it("estimates cost with default Sonnet pricing", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { ...EMPTY_PKG },
        hench: { inputTokens: 1000000, outputTokens: 1000000, calls: 1 },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 1000000,
      totalOutputTokens: 1000000,
      totalCalls: 1,
    };

    const cost = estimateCost(usage);

    // $3/1M input + $15/1M output = $18
    expect(cost.total).toBe("$18.00");
    expect(cost.inputCost).toBe(3);
    expect(cost.outputCost).toBe(15);
    expect(cost.totalRaw).toBe(18);
  });

  it("returns zero for empty usage", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { ...EMPTY_PKG },
        hench: { ...EMPTY_PKG },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCalls: 0,
    };

    const cost = estimateCost(usage);

    expect(cost.total).toBe("$0.00");
    expect(cost.totalRaw).toBe(0);
  });

  it("accepts custom pricing", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { ...EMPTY_PKG },
        hench: { inputTokens: 1000000, outputTokens: 1000000, calls: 1 },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 1000000,
      totalOutputTokens: 1000000,
      totalCalls: 1,
    };

    // Opus pricing: $15/1M input, $75/1M output
    const cost = estimateCost(usage, {
      inputPerMillion: 15,
      outputPerMillion: 75,
    });

    expect(cost.total).toBe("$90.00");
    expect(cost.inputCost).toBe(15);
    expect(cost.outputCost).toBe(75);
  });

  it("handles fractional token counts", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { inputTokens: 500, outputTokens: 100, calls: 1 },
        hench: { ...EMPTY_PKG },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: 500,
      totalOutputTokens: 100,
      totalCalls: 1,
    };

    const cost = estimateCost(usage);

    // $3 * 500/1M = $0.0015, $15 * 100/1M = $0.0015
    expect(cost.total).toBe("$0.00");
    expect(cost.totalRaw).toBeCloseTo(0.003, 4);
  });
});

// ---------------------------------------------------------------------------
// extractRexTokenEvents
// ---------------------------------------------------------------------------

describe("extractRexTokenEvents", () => {
  it("returns token events from analyze_token_usage entries with vendor/model", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({
          calls: 2,
          inputTokens: 3000,
          outputTokens: 500,
          vendor: "claude",
          model: "claude-sonnet-4-6",
        }),
      },
    ];

    const events = extractRexTokenEvents(entries);

    expect(events).toHaveLength(1);
    expect(events[0].command).toBe("analyze");
    expect(events[0].package).toBe("rex");
    expect(events[0].inputTokens).toBe(3000);
    expect(events[0].outputTokens).toBe(500);
    expect(events[0].calls).toBe(2);
    expect(events[0].vendor).toBe("claude");
    expect(events[0].model).toBe("claude-sonnet-4-6");
  });

  it("maps smart_add_token_usage events to smart-add command", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "smart_add_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
      },
    ];

    const events = extractRexTokenEvents(entries);

    expect(events).toHaveLength(1);
    expect(events[0].command).toBe("smart-add");
    expect(events[0].package).toBe("rex");
    expect(events[0].vendor).toBe("unknown");
    expect(events[0].model).toBe("unknown");
  });

  it("uses unknown fallback when metadata is missing or empty", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({
          calls: 1,
          inputTokens: 500,
          outputTokens: 100,
          vendor: " ",
        }),
      },
    ];

    const events = extractRexTokenEvents(entries);

    expect(events).toHaveLength(1);
    expect(events[0].vendor).toBe("unknown");
    expect(events[0].model).toBe("unknown");
  });

  it("ignores non-token events", () => {
    const entries: TokenUsageLogEntry[] = [
      { timestamp: "2026-01-15T10:00:00.000Z", event: "task_completed", detail: "done" },
      {
        timestamp: "2026-01-15T11:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 500, outputTokens: 100 }),
      },
    ];

    const events = extractRexTokenEvents(entries);

    expect(events).toHaveLength(1);
    expect(events[0].command).toBe("analyze");
  });

  it("applies time filter", () => {
    const entries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-10T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
      },
      {
        timestamp: "2026-01-20T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 1, inputTokens: 2000, outputTokens: 400 }),
      },
    ];

    const events = extractRexTokenEvents(entries, { since: "2026-01-15T00:00:00.000Z" });

    expect(events).toHaveLength(1);
    expect(events[0].inputTokens).toBe(2000);
  });

  it("returns empty array for empty log", () => {
    expect(extractRexTokenEvents([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractHenchTokenEvents
// ---------------------------------------------------------------------------

describe("extractHenchTokenEvents", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-hench-events-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  function writeRun(id: string, run: Record<string, unknown>): void {
    mkdirSync(join(tmp, ".hench", "runs"), { recursive: true });
    writeFileSync(join(tmp, ".hench", "runs", `${id}.json`), JSON.stringify(run));
  }

  it("returns token events from hench run files", async () => {
    writeRun("run-001", {
      id: "run-001",
      startedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { input: 5000, output: 1500 },
    });

    const events = await extractHenchTokenEvents(tmp);

    expect(events).toHaveLength(1);
    expect(events[0].command).toBe("run");
    expect(events[0].package).toBe("hench");
    expect(events[0].inputTokens).toBe(5000);
    expect(events[0].outputTokens).toBe(1500);
    expect(events[0].calls).toBe(1);
  });

  it("returns multiple events from multiple run files", async () => {
    writeRun("run-001", {
      startedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { input: 3000, output: 1000 },
    });
    writeRun("run-002", {
      startedAt: "2026-01-16T10:00:00.000Z",
      tokenUsage: { input: 4000, output: 1200 },
    });

    const events = await extractHenchTokenEvents(tmp);

    expect(events).toHaveLength(2);
  });

  it("emits per-turn events with vendor/model when available", async () => {
    writeRun("run-001", {
      startedAt: "2026-01-15T10:00:00.000Z",
      model: "fallback-model",
      tokenUsage: { input: 7000, output: 2200 },
      turnTokenUsage: [
        { turn: 1, input: 3000, output: 1000, vendor: "claude", model: "claude-sonnet-4-6" },
        { turn: 1, input: 4000, output: 1200, vendor: "codex" },
      ],
    });

    const events = await extractHenchTokenEvents(tmp);

    expect(events).toHaveLength(2);
    expect(events[0].inputTokens).toBe(3000);
    expect(events[0].vendor).toBe("claude");
    expect(events[0].model).toBe("claude-sonnet-4-6");
    expect(events[1].inputTokens).toBe(4000);
    expect(events[1].vendor).toBe("codex");
    expect(events[1].model).toBe("fallback-model");
  });

  it("returns empty array when no .hench/runs exists", async () => {
    const events = await extractHenchTokenEvents(tmp);
    expect(events).toEqual([]);
  });

  it("applies time filter", async () => {
    writeRun("run-001", {
      startedAt: "2026-01-10T10:00:00.000Z",
      tokenUsage: { input: 1000, output: 200 },
    });
    writeRun("run-002", {
      startedAt: "2026-01-20T10:00:00.000Z",
      tokenUsage: { input: 2000, output: 400 },
    });

    const events = await extractHenchTokenEvents(tmp, { since: "2026-01-15T00:00:00.000Z" });

    expect(events).toHaveLength(1);
    expect(events[0].inputTokens).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// extractSvTokenEvents
// ---------------------------------------------------------------------------

describe("extractSvTokenEvents", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-sv-events-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  function writeManifest(manifest: Record<string, unknown>): void {
    mkdirSync(join(tmp, ".sourcevision"), { recursive: true });
    writeFileSync(join(tmp, ".sourcevision", "manifest.json"), JSON.stringify(manifest));
  }

  it("returns token event from sourcevision manifest", async () => {
    writeManifest({
      analyzedAt: "2026-01-15T10:00:00.000Z",
      tokenUsage: { calls: 3, inputTokens: 2000, outputTokens: 600 },
    });

    const events = await extractSvTokenEvents(tmp);

    expect(events).toHaveLength(1);
    expect(events[0].command).toBe("analyze");
    expect(events[0].package).toBe("sv");
    expect(events[0].inputTokens).toBe(2000);
    expect(events[0].calls).toBe(3);
  });

  it("returns empty array when no manifest exists", async () => {
    const events = await extractSvTokenEvents(tmp);
    expect(events).toEqual([]);
  });

  it("applies time filter", async () => {
    writeManifest({
      analyzedAt: "2026-01-10T10:00:00.000Z",
      tokenUsage: { calls: 2, inputTokens: 1000, outputTokens: 300 },
    });

    const events = await extractSvTokenEvents(tmp, { since: "2026-01-15T00:00:00.000Z" });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// collectTokenEvents
// ---------------------------------------------------------------------------

describe("collectTokenEvents", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-collect-events-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true });
  });

  function writeRun(id: string, run: Record<string, unknown>): void {
    mkdirSync(join(tmp, ".hench", "runs"), { recursive: true });
    writeFileSync(join(tmp, ".hench", "runs", `${id}.json`), JSON.stringify(run));
  }

  function writeSvManifest(manifest: Record<string, unknown>): void {
    mkdirSync(join(tmp, ".sourcevision"), { recursive: true });
    writeFileSync(join(tmp, ".sourcevision", "manifest.json"), JSON.stringify(manifest));
  }

  it("collects events from all packages sorted by timestamp", async () => {
    const logEntries: TokenUsageLogEntry[] = [
      {
        timestamp: "2026-01-15T10:00:00.000Z",
        event: "analyze_token_usage",
        detail: JSON.stringify({ calls: 2, inputTokens: 3000, outputTokens: 500 }),
      },
    ];
    writeRun("run-001", {
      startedAt: "2026-01-14T10:00:00.000Z",
      tokenUsage: { input: 5000, output: 1500 },
    });
    writeSvManifest({
      analyzedAt: "2026-01-16T10:00:00.000Z",
      tokenUsage: { calls: 1, inputTokens: 2000, outputTokens: 600 },
    });

    const events = await collectTokenEvents(logEntries, tmp);

    expect(events).toHaveLength(3);
    // Should be sorted by timestamp
    expect(events[0].package).toBe("hench");
    expect(events[1].package).toBe("rex");
    expect(events[2].package).toBe("sv");
  });

  it("returns empty array when no data exists", async () => {
    const events = await collectTokenEvents([], tmp);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// groupByCommand
// ---------------------------------------------------------------------------

describe("groupByCommand", () => {
  it("groups events by package:command", () => {
    const events: TokenEvent[] = [
      { timestamp: "2026-01-15T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 3000, outputTokens: 500, calls: 2 },
      { timestamp: "2026-01-16T10:00:00.000Z", command: "run", package: "hench", inputTokens: 5000, outputTokens: 1500, calls: 1 },
      { timestamp: "2026-01-17T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 2000, outputTokens: 300, calls: 1 },
    ];

    const commands = groupByCommand(events);

    expect(commands).toHaveLength(2);
    // Sorted by total tokens descending
    const hench = commands.find((c) => c.package === "hench");
    const rex = commands.find((c) => c.package === "rex");
    expect(hench?.inputTokens).toBe(5000);
    expect(hench?.outputTokens).toBe(1500);
    expect(hench?.calls).toBe(1);
    expect(rex?.inputTokens).toBe(5000);
    expect(rex?.outputTokens).toBe(800);
    expect(rex?.calls).toBe(3);
  });

  it("returns empty array for no events", () => {
    expect(groupByCommand([])).toEqual([]);
  });

  it("sorts by total tokens descending", () => {
    const events: TokenEvent[] = [
      { timestamp: "2026-01-15T10:00:00.000Z", command: "analyze", package: "sv", inputTokens: 100, outputTokens: 50, calls: 1 },
      { timestamp: "2026-01-16T10:00:00.000Z", command: "run", package: "hench", inputTokens: 50000, outputTokens: 10000, calls: 5 },
      { timestamp: "2026-01-17T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 500, outputTokens: 200, calls: 2 },
    ];

    const commands = groupByCommand(events);

    expect(commands[0].package).toBe("hench");
    expect(commands[1].package).toBe("rex");
    expect(commands[2].package).toBe("sv");
  });
});

// ---------------------------------------------------------------------------
// periodKey
// ---------------------------------------------------------------------------

describe("periodKey", () => {
  it("returns date for day period", () => {
    expect(periodKey("2026-01-15T10:00:00.000Z", "day")).toBe("2026-01-15");
  });

  it("returns year-month for month period", () => {
    expect(periodKey("2026-01-15T10:00:00.000Z", "month")).toBe("2026-01");
  });

  it("returns ISO week for week period", () => {
    // 2026-01-15 is a Thursday in ISO week 3
    expect(periodKey("2026-01-15T10:00:00.000Z", "week")).toBe("2026-W03");
  });

  it("handles year boundaries for week period", () => {
    // 2026-01-01 is a Thursday in ISO week 1
    expect(periodKey("2026-01-01T10:00:00.000Z", "week")).toBe("2026-W01");
  });

  it("handles different months for day period", () => {
    expect(periodKey("2026-12-31T23:59:59.000Z", "day")).toBe("2026-12-31");
  });
});

// ---------------------------------------------------------------------------
// groupByTimePeriod
// ---------------------------------------------------------------------------

describe("groupByTimePeriod", () => {
  it("groups events by day", () => {
    const events: TokenEvent[] = [
      { timestamp: "2026-01-15T08:00:00.000Z", command: "analyze", package: "rex", inputTokens: 1000, outputTokens: 200, calls: 1 },
      { timestamp: "2026-01-15T14:00:00.000Z", command: "run", package: "hench", inputTokens: 3000, outputTokens: 500, calls: 1 },
      { timestamp: "2026-01-16T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 2000, outputTokens: 400, calls: 1 },
    ];

    const buckets = groupByTimePeriod(events, "day");

    expect(buckets).toHaveLength(2);
    expect(buckets[0].period).toBe("2026-01-15");
    expect(buckets[0].usage.totalInputTokens).toBe(4000);
    expect(buckets[0].usage.totalOutputTokens).toBe(700);
    expect(buckets[1].period).toBe("2026-01-16");
    expect(buckets[1].usage.totalInputTokens).toBe(2000);
  });

  it("groups events by month", () => {
    const events: TokenEvent[] = [
      { timestamp: "2026-01-15T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 1000, outputTokens: 200, calls: 1 },
      { timestamp: "2026-02-10T10:00:00.000Z", command: "run", package: "hench", inputTokens: 5000, outputTokens: 1000, calls: 1 },
      { timestamp: "2026-02-20T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 2000, outputTokens: 400, calls: 1 },
    ];

    const buckets = groupByTimePeriod(events, "month");

    expect(buckets).toHaveLength(2);
    expect(buckets[0].period).toBe("2026-01");
    expect(buckets[0].usage.totalInputTokens).toBe(1000);
    expect(buckets[1].period).toBe("2026-02");
    expect(buckets[1].usage.totalInputTokens).toBe(7000);
  });

  it("groups events by week", () => {
    const events: TokenEvent[] = [
      { timestamp: "2026-01-12T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 1000, outputTokens: 200, calls: 1 },
      { timestamp: "2026-01-14T10:00:00.000Z", command: "run", package: "hench", inputTokens: 3000, outputTokens: 500, calls: 1 },
      { timestamp: "2026-01-20T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 2000, outputTokens: 400, calls: 1 },
    ];

    const buckets = groupByTimePeriod(events, "week");

    expect(buckets).toHaveLength(2);
    // Jan 12 and Jan 14 should be in the same week
    expect(buckets[0].usage.totalInputTokens).toBe(4000);
    // Jan 20 is a different week
    expect(buckets[1].usage.totalInputTokens).toBe(2000);
  });

  it("sorts buckets by period ascending", () => {
    const events: TokenEvent[] = [
      { timestamp: "2026-03-01T10:00:00.000Z", command: "run", package: "hench", inputTokens: 3000, outputTokens: 500, calls: 1 },
      { timestamp: "2026-01-01T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 1000, outputTokens: 200, calls: 1 },
    ];

    const buckets = groupByTimePeriod(events, "month");

    expect(buckets[0].period).toBe("2026-01");
    expect(buckets[1].period).toBe("2026-03");
  });

  it("includes cost estimation per bucket", () => {
    const events: TokenEvent[] = [
      { timestamp: "2026-01-15T10:00:00.000Z", command: "run", package: "hench", inputTokens: 1000000, outputTokens: 1000000, calls: 1 },
    ];

    const buckets = groupByTimePeriod(events, "day");

    expect(buckets).toHaveLength(1);
    expect(buckets[0].estimatedCost.total).toBe("$18.00");
  });

  it("preserves per-package breakdown in buckets", () => {
    const events: TokenEvent[] = [
      { timestamp: "2026-01-15T10:00:00.000Z", command: "analyze", package: "rex", inputTokens: 1000, outputTokens: 200, calls: 1 },
      { timestamp: "2026-01-15T14:00:00.000Z", command: "run", package: "hench", inputTokens: 3000, outputTokens: 500, calls: 1 },
    ];

    const buckets = groupByTimePeriod(events, "day");

    expect(buckets).toHaveLength(1);
    expect(buckets[0].usage.packages.rex.inputTokens).toBe(1000);
    expect(buckets[0].usage.packages.hench.inputTokens).toBe(3000);
    expect(buckets[0].usage.packages.sv.inputTokens).toBe(0);
  });

  it("returns empty array for no events", () => {
    expect(groupByTimePeriod([], "day")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// checkBudget
// ---------------------------------------------------------------------------

describe("checkBudget", () => {
  const EMPTY_PKG = { inputTokens: 0, outputTokens: 0, calls: 0 };

  function makeUsage(input: number, output: number): AggregateTokenUsage {
    return {
      packages: {
        rex: { ...EMPTY_PKG },
        hench: { inputTokens: input, outputTokens: output, calls: 1 },
        sv: { ...EMPTY_PKG },
      },
      totalInputTokens: input,
      totalOutputTokens: output,
      totalCalls: 1,
    };
  }

  it("returns ok when no budget is configured", () => {
    const result = checkBudget(makeUsage(10000, 5000), {});

    expect(result.severity).toBe("ok");
    expect(result.warnings).toHaveLength(0);
    expect(result.tokens).toBeUndefined();
    expect(result.cost).toBeUndefined();
  });

  it("returns ok when usage is below token budget", () => {
    const result = checkBudget(makeUsage(5000, 2000), { tokens: 100000 });

    expect(result.severity).toBe("ok");
    expect(result.warnings).toHaveLength(0);
    expect(result.tokens).toBeDefined();
    expect(result.tokens!.used).toBe(7000);
    expect(result.tokens!.budget).toBe(100000);
    expect(result.tokens!.percent).toBeCloseTo(7, 1);
    expect(result.tokens!.severity).toBe("ok");
  });

  it("returns warning when usage exceeds warnAt threshold", () => {
    // 85000 tokens used of 100000 = 85%, default warnAt = 80
    const result = checkBudget(makeUsage(60000, 25000), { tokens: 100000 });

    expect(result.severity).toBe("warning");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Approaching token budget");
    expect(result.warnings[0]).toContain("85%");
    expect(result.tokens!.severity).toBe("warning");
  });

  it("returns exceeded when usage meets or exceeds token budget", () => {
    // 100000 tokens used of 100000 = 100%
    const result = checkBudget(makeUsage(70000, 30000), { tokens: 100000 });

    expect(result.severity).toBe("exceeded");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Token budget exceeded");
    expect(result.warnings[0]).toContain("100%");
    expect(result.tokens!.severity).toBe("exceeded");
  });

  it("returns exceeded when usage is over token budget", () => {
    const result = checkBudget(makeUsage(80000, 40000), { tokens: 100000 });

    expect(result.severity).toBe("exceeded");
    expect(result.tokens!.used).toBe(120000);
    expect(result.tokens!.percent).toBe(120);
  });

  it("respects custom warnAt threshold", () => {
    // 50000 tokens of 100000 = 50%, warnAt = 50 means this IS a warning
    const result = checkBudget(makeUsage(30000, 20000), { tokens: 100000, warnAt: 50 });

    expect(result.severity).toBe("warning");
    expect(result.warnings).toHaveLength(1);
  });

  it("checks cost budget", () => {
    // 1M input + 1M output @ Sonnet pricing = $3 + $15 = $18
    const result = checkBudget(makeUsage(1000000, 1000000), { cost: 20 });

    expect(result.severity).toBe("warning"); // $18 of $20 = 90%
    expect(result.cost).toBeDefined();
    expect(result.cost!.used).toBe(18);
    expect(result.cost!.budget).toBe(20);
    expect(result.cost!.percent).toBe(90);
    expect(result.cost!.severity).toBe("warning");
    expect(result.warnings[0]).toContain("Approaching cost budget");
  });

  it("returns exceeded when cost exceeds budget", () => {
    // 1M input + 1M output = $18, budget $10
    const result = checkBudget(makeUsage(1000000, 1000000), { cost: 10 });

    expect(result.severity).toBe("exceeded");
    expect(result.cost!.severity).toBe("exceeded");
    expect(result.warnings[0]).toContain("Cost budget exceeded");
  });

  it("returns ok when cost is below budget", () => {
    // 500 input + 100 output = $0.003, budget $10
    const result = checkBudget(makeUsage(500, 100), { cost: 10 });

    expect(result.severity).toBe("ok");
    expect(result.cost!.severity).toBe("ok");
    expect(result.warnings).toHaveLength(0);
  });

  it("checks both token and cost budgets simultaneously", () => {
    // 90000 tokens used of 100000 = 90% (warning)
    // $0.42 of $10 cost (ok)
    const result = checkBudget(makeUsage(60000, 30000), {
      tokens: 100000,
      cost: 10,
    });

    expect(result.severity).toBe("warning");
    expect(result.tokens!.severity).toBe("warning");
    expect(result.cost!.severity).toBe("ok");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("token budget");
  });

  it("exceeded takes precedence over warning", () => {
    // Token: 120% (exceeded), Cost: 90% (warning)
    const result = checkBudget(makeUsage(80000, 40000), {
      tokens: 100000,
      cost: 100, // large cost budget so it's only warning/ok
    });

    expect(result.severity).toBe("exceeded");
  });

  it("treats zero token budget as unlimited", () => {
    const result = checkBudget(makeUsage(1000000, 1000000), { tokens: 0 });

    expect(result.severity).toBe("ok");
    expect(result.tokens).toBeUndefined();
  });

  it("treats zero cost budget as unlimited", () => {
    const result = checkBudget(makeUsage(1000000, 1000000), { cost: 0 });

    expect(result.severity).toBe("ok");
    expect(result.cost).toBeUndefined();
  });

  it("treats negative budgets as unlimited", () => {
    const result = checkBudget(makeUsage(1000000, 1000000), {
      tokens: -1,
      cost: -5,
    });

    expect(result.severity).toBe("ok");
    expect(result.tokens).toBeUndefined();
    expect(result.cost).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// formatBudgetWarnings
// ---------------------------------------------------------------------------

describe("formatBudgetWarnings", () => {
  it("returns empty array for ok severity", () => {
    const lines = formatBudgetWarnings({
      severity: "ok",
      warnings: [],
    });

    expect(lines).toEqual([]);
  });

  it("formats warning severity with header", () => {
    const lines = formatBudgetWarnings({
      severity: "warning",
      warnings: ["Approaching token budget: 85,000 of 100,000 tokens used (85%)"],
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Budget warning");
    expect(lines[1]).toContain("Approaching token budget");
  });

  it("formats exceeded severity with header", () => {
    const lines = formatBudgetWarnings({
      severity: "exceeded",
      warnings: ["Token budget exceeded: 120,000 of 100,000 tokens used (120%)"],
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("BUDGET EXCEEDED");
    expect(lines[1]).toContain("Token budget exceeded");
  });

  it("formats multiple warnings", () => {
    const lines = formatBudgetWarnings({
      severity: "exceeded",
      warnings: [
        "Token budget exceeded: 120,000 of 100,000 tokens used (120%)",
        "Cost budget exceeded: $25.00 of $20.00 used (125%)",
      ],
    });

    expect(lines).toHaveLength(3); // header + 2 warnings
    expect(lines[0]).toContain("BUDGET EXCEEDED");
    expect(lines[1]).toContain("Token budget exceeded");
    expect(lines[2]).toContain("Cost budget exceeded");
  });
});

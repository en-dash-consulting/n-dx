import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  extractRexTokenUsage,
  extractHenchTokenUsage,
  extractSvTokenUsage,
  aggregateTokenUsage,
  formatAggregateTokenUsage,
} from "../../../src/core/token-usage.js";
import type { LogEntry } from "../../../src/schema/index.js";
import type { AggregateTokenUsage } from "../../../src/core/token-usage.js";

// ---------------------------------------------------------------------------
// extractRexTokenUsage
// ---------------------------------------------------------------------------

describe("extractRexTokenUsage", () => {
  it("extracts token usage from analyze_token_usage log entries", () => {
    const entries: LogEntry[] = [
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
    const entries: LogEntry[] = [
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
    const entries: LogEntry[] = [
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
    const entries: LogEntry[] = [
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
    const entries: LogEntry[] = [
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
    const entries: LogEntry[] = [
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
    const logEntries: LogEntry[] = [
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
    const logEntries: LogEntry[] = [
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

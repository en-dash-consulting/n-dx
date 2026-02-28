import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aggregateTokenUsage,
  collectTokenEvents,
  groupByCommand,
  checkBudget,
} from "../../../src/core/token-usage.js";
import type { LogEntry } from "../../../src/schema/index.js";
import type { AggregateTokenUsage } from "../../../src/core/token-usage.js";

interface RegressionFixtureFile {
  aggregation: {
    logEntries: LogEntry[];
    henchRuns: Array<Record<string, unknown>>;
    svManifest: Record<string, unknown>;
    allTime: {
      packages: AggregateTokenUsage["packages"];
      totals: { inputTokens: number; outputTokens: number; calls: number };
      commands: Record<string, { inputTokens: number; outputTokens: number; calls: number }>;
    };
    window: {
      since: string;
      until: string;
      packages: AggregateTokenUsage["packages"];
      totals: { inputTokens: number; outputTokens: number; calls: number };
    };
  };
  budget: {
    usage: { input: number; output: number };
    normal: {
      budget: { tokens: number; warnAt: number };
      expected: {
        severity: "warning" | "ok" | "exceeded";
        percent: number;
        tokensDefined: boolean;
        warnings: number;
      };
    };
    zeroBudget: {
      budget: { tokens: number; cost: number };
      expected: {
        severity: "warning" | "ok" | "exceeded";
        tokensDefined: boolean;
        costDefined: boolean;
        warnings: number;
      };
    };
    missingBudget: {
      budget: Record<string, never>;
      expected: {
        severity: "warning" | "ok" | "exceeded";
        tokensDefined: boolean;
        costDefined: boolean;
        warnings: number;
      };
    };
  };
}

const fixtures = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../fixtures/token-usage-regression.json"),
    "utf-8",
  ),
) as RegressionFixtureFile;

function writeFixtureRuns(projectDir: string, runs: Array<Record<string, unknown>>): void {
  const runsDir = join(projectDir, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  for (const run of runs) {
    const id = String(run.id ?? "run");
    writeFileSync(join(runsDir, `${id}.json`), JSON.stringify(run));
  }
}

function writeFixtureManifest(projectDir: string, manifest: Record<string, unknown>): void {
  const svDir = join(projectDir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, "manifest.json"), JSON.stringify(manifest));
}

describe("token usage regression fixtures", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-token-regression-"));
    writeFixtureRuns(tmp, fixtures.aggregation.henchRuns);
    writeFixtureManifest(tmp, fixtures.aggregation.svManifest);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("aggregates totals across rex, hench, and sv fixtures", async () => {
    const result = await aggregateTokenUsage(fixtures.aggregation.logEntries, tmp);

    expect(result.packages).toEqual(fixtures.aggregation.allTime.packages);
    expect(result.totalInputTokens).toBe(fixtures.aggregation.allTime.totals.inputTokens);
    expect(result.totalOutputTokens).toBe(fixtures.aggregation.allTime.totals.outputTokens);
    expect(result.totalCalls).toBe(fixtures.aggregation.allTime.totals.calls);
  });

  it("aggregates correctly for a bounded time window", async () => {
    const { since, until } = fixtures.aggregation.window;
    const result = await aggregateTokenUsage(fixtures.aggregation.logEntries, tmp, { since, until });

    expect(result.packages).toEqual(fixtures.aggregation.window.packages);
    expect(result.totalInputTokens).toBe(fixtures.aggregation.window.totals.inputTokens);
    expect(result.totalOutputTokens).toBe(fixtures.aggregation.window.totals.outputTokens);
    expect(result.totalCalls).toBe(fixtures.aggregation.window.totals.calls);
  });

  it("preserves per-command totals across tools", async () => {
    const events = await collectTokenEvents(fixtures.aggregation.logEntries, tmp);
    const commands = groupByCommand(events);

    for (const [key, expected] of Object.entries(fixtures.aggregation.allTime.commands)) {
      const [pkg, command] = key.split(":");
      const entry = commands.find((c) => c.package === pkg && c.command === command);
      expect(entry, key).toBeDefined();
      expect(entry!.inputTokens, key).toBe(expected.inputTokens);
      expect(entry!.outputTokens, key).toBe(expected.outputTokens);
      expect(entry!.calls, key).toBe(expected.calls);
    }
  });

  it("computes budget percentages for normal, zero-budget, and missing-budget scenarios", () => {
    const usage: AggregateTokenUsage = {
      packages: {
        rex: { inputTokens: fixtures.budget.usage.input, outputTokens: fixtures.budget.usage.output, calls: 1 },
        hench: { inputTokens: 0, outputTokens: 0, calls: 0 },
        sv: { inputTokens: 0, outputTokens: 0, calls: 0 },
      },
      totalInputTokens: fixtures.budget.usage.input,
      totalOutputTokens: fixtures.budget.usage.output,
      totalCalls: 1,
    };

    const normal = checkBudget(usage, fixtures.budget.normal.budget);
    expect(normal.severity).toBe(fixtures.budget.normal.expected.severity);
    expect(normal.tokens).toBeDefined();
    expect(normal.tokens!.percent).toBe(fixtures.budget.normal.expected.percent);
    expect(normal.warnings).toHaveLength(fixtures.budget.normal.expected.warnings);

    const zeroBudget = checkBudget(usage, fixtures.budget.zeroBudget.budget);
    expect(zeroBudget.severity).toBe(fixtures.budget.zeroBudget.expected.severity);
    expect(Boolean(zeroBudget.tokens)).toBe(fixtures.budget.zeroBudget.expected.tokensDefined);
    expect(Boolean(zeroBudget.cost)).toBe(fixtures.budget.zeroBudget.expected.costDefined);
    expect(zeroBudget.warnings).toHaveLength(fixtures.budget.zeroBudget.expected.warnings);

    const missingBudget = checkBudget(usage, fixtures.budget.missingBudget.budget);
    expect(missingBudget.severity).toBe(fixtures.budget.missingBudget.expected.severity);
    expect(Boolean(missingBudget.tokens)).toBe(fixtures.budget.missingBudget.expected.tokensDefined);
    expect(Boolean(missingBudget.cost)).toBe(fixtures.budget.missingBudget.expected.costDefined);
    expect(missingBudget.warnings).toHaveLength(fixtures.budget.missingBudget.expected.warnings);
  });
});

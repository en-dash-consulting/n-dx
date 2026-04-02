import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdUsage } from "../../../../src/cli/commands/usage.js";
import type { PRDDocument, RexConfig } from "../../../../src/schema/index.js";
import { writeConfig, writePRD } from "../../../helpers/rex-dir-test-support.js";

function writeLog(dir: string, entries: Array<Record<string, unknown>>): void {
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(join(dir, ".rex", "execution-log.jsonl"), lines);
}

function writeHenchRun(
  dir: string,
  id: string,
  run: Record<string, unknown>,
): void {
  const runsDir = join(dir, ".hench", "runs");
  mkdirSync(runsDir, { recursive: true });
  writeFileSync(join(runsDir, `${id}.json`), JSON.stringify(run));
}

function writeSvManifest(
  dir: string,
  manifest: Record<string, unknown>,
): void {
  const svDir = join(dir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });
  writeFileSync(join(svDir, "manifest.json"), JSON.stringify(manifest));
}

const MINIMAL_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [],
};

const MINIMAL_CONFIG: RexConfig = {
  schema: "rex/v1",
  project: "test",
  adapter: "file",
};

let tmp: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

function output(): string {
  return logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
}

function errOutput(): string {
  return errSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "rex-usage-test-"));
  mkdirSync(join(tmp, ".rex"));
  writePRD(tmp, MINIMAL_PRD);
  writeConfig(tmp, MINIMAL_CONFIG);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  rmSync(tmp, { recursive: true, force: true });
});

describe("cmdUsage", () => {
  describe("tree output", () => {
    it("shows 'none recorded' when no token data exists", async () => {
      await cmdUsage(tmp, {});
      const out = output();
      expect(out).toContain("Token usage: none recorded");
    });

    it("shows total token counts with input/output breakdown", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 2,
            inputTokens: 3000,
            outputTokens: 500,
          }),
        },
      ]);

      await cmdUsage(tmp, {});
      const out = output();

      expect(out).toContain("3,500 tokens");
      expect(out).toContain("3,000 in");
      expect(out).toContain("500 out");
    });

    it("shows per-package breakdown", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 2,
            inputTokens: 3000,
            outputTokens: 500,
          }),
        },
      ]);
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 5000, output: 1500 },
      });

      await cmdUsage(tmp, {});
      const out = output();

      expect(out).toContain("rex:");
      expect(out).toContain("hench:");
    });

    it("shows cost estimation", async () => {
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 100000, output: 20000 },
      });

      await cmdUsage(tmp, {});
      const out = output();

      expect(out).toContain("Estimated cost:");
      expect(out).toContain("$");
    });

    it("does not show cost line when zero tokens", async () => {
      await cmdUsage(tmp, {});
      const out = output();

      expect(out).not.toContain("Estimated cost:");
    });

    it("applies --since filter", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-10T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 1000,
            outputTokens: 200,
          }),
        },
        {
          timestamp: "2026-01-20T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 5000,
            outputTokens: 800,
          }),
        },
      ]);

      await cmdUsage(tmp, { since: "2026-01-15T00:00:00.000Z" });
      const out = output();

      expect(out).toContain("5,800 tokens");
      expect(out).toContain("filtered:");
      expect(out).toContain("since");
    });

    it("applies --until filter", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-10T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 1000,
            outputTokens: 200,
          }),
        },
        {
          timestamp: "2026-01-20T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 5000,
            outputTokens: 800,
          }),
        },
      ]);

      await cmdUsage(tmp, { until: "2026-01-15T00:00:00.000Z" });
      const out = output();

      expect(out).toContain("1,200 tokens");
      expect(out).toContain("filtered:");
      expect(out).toContain("until");
    });

    it("shows per-package detail with input/output per package", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 2,
            inputTokens: 3000,
            outputTokens: 500,
          }),
        },
      ]);
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 5000, output: 1500 },
      });
      writeSvManifest(tmp, {
        analyzedAt: "2026-01-17T10:00:00.000Z",
        tokenUsage: { calls: 1, inputTokens: 2000, outputTokens: 600 },
      });

      await cmdUsage(tmp, {});
      const out = output();

      // Should show per-package input/output detail
      expect(out).toContain("rex");
      expect(out).toContain("hench");
      expect(out).toContain("sv");
    });
  });

  describe("json output", () => {
    it("outputs valid JSON with all fields", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 2,
            inputTokens: 3000,
            outputTokens: 500,
          }),
        },
      ]);

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.packages).toBeDefined();
      expect(parsed.packages.rex).toBeDefined();
      expect(parsed.packages.rex.inputTokens).toBe(3000);
      expect(parsed.packages.rex.outputTokens).toBe(500);
      expect(parsed.packages.rex.calls).toBe(2);
      expect(parsed.totalInputTokens).toBe(3000);
      expect(parsed.totalOutputTokens).toBe(500);
      expect(parsed.totalCalls).toBe(2);
    });

    it("includes cost estimation in JSON output", async () => {
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 100000, output: 20000 },
      });

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.estimatedCost).toBeDefined();
      expect(typeof parsed.estimatedCost.total).toBe("string");
      expect(parsed.estimatedCost.total).toMatch(/^\$/);
    });

    it("includes filter metadata in JSON output", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({
            calls: 1,
            inputTokens: 1000,
            outputTokens: 200,
          }),
        },
      ]);

      await cmdUsage(tmp, {
        format: "json",
        since: "2026-01-10T00:00:00.000Z",
        until: "2026-01-20T00:00:00.000Z",
      });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.filter).toBeDefined();
      expect(parsed.filter.since).toBe("2026-01-10T00:00:00.000Z");
      expect(parsed.filter.until).toBe("2026-01-20T00:00:00.000Z");
    });

    it("omits filter from JSON when no filters applied", async () => {
      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.filter).toBeUndefined();
    });
  });

  describe("cost estimation", () => {
    it("estimates cost using default Sonnet pricing", async () => {
      // Sonnet: $3/1M input, $15/1M output
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 1000000, output: 1000000 },
      });

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      // $3 input + $15 output = $18
      expect(parsed.estimatedCost.total).toBe("$18.00");
    });

    it("shows zero cost when no tokens", async () => {
      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.estimatedCost.total).toBe("$0.00");
    });
  });

  describe("command breakdown", () => {
    it("shows per-command breakdown in tree output", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 2, inputTokens: 3000, outputTokens: 500 }),
        },
      ]);
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 5000, output: 1500 },
      });

      await cmdUsage(tmp, {});
      const out = output();

      expect(out).toContain("By command:");
      expect(out).toContain("rex analyze:");
      expect(out).toContain("hench run:");
    });

    it("includes commands array in JSON output", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 2, inputTokens: 3000, outputTokens: 500 }),
        },
      ]);
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 5000, output: 1500 },
      });

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.commands).toBeDefined();
      expect(parsed.commands).toHaveLength(2);

      const rexCmd = parsed.commands.find((c: Record<string, unknown>) => c.package === "rex");
      expect(rexCmd.command).toBe("analyze");
      expect(rexCmd.inputTokens).toBe(3000);
      expect(rexCmd.calls).toBe(2);

      const henchCmd = parsed.commands.find((c: Record<string, unknown>) => c.package === "hench");
      expect(henchCmd.command).toBe("run");
      expect(henchCmd.inputTokens).toBe(5000);
    });

    it("includes empty commands array when no data", async () => {
      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.commands).toBeDefined();
      expect(parsed.commands).toHaveLength(0);
    });
  });

  describe("time period grouping", () => {
    it("groups by day in tree output", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
        },
        {
          timestamp: "2026-01-16T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 1, inputTokens: 2000, outputTokens: 400 }),
        },
      ]);

      await cmdUsage(tmp, { group: "day" });
      const out = output();

      expect(out).toContain("By day:");
      expect(out).toContain("2026-01-15:");
      expect(out).toContain("2026-01-16:");
    });

    it("groups by month in tree output", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
        },
        {
          timestamp: "2026-02-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 1, inputTokens: 2000, outputTokens: 400 }),
        },
      ]);

      await cmdUsage(tmp, { group: "month" });
      const out = output();

      expect(out).toContain("By month:");
      expect(out).toContain("2026-01:");
      expect(out).toContain("2026-02:");
    });

    it("includes periods in JSON output with --group", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
        },
        {
          timestamp: "2026-01-16T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 1, inputTokens: 2000, outputTokens: 400 }),
        },
      ]);

      await cmdUsage(tmp, { format: "json", group: "day" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.periods).toBeDefined();
      expect(parsed.periods).toHaveLength(2);
      expect(parsed.periods[0].period).toBe("2026-01-15");
      expect(parsed.periods[0].totalInputTokens).toBe(1000);
      expect(parsed.periods[1].period).toBe("2026-01-16");
      expect(parsed.periods[1].totalInputTokens).toBe(2000);
      expect(parsed.group).toBe("day");
    });

    it("includes cost estimation per period in JSON output", async () => {
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-15T10:00:00.000Z",
        status: "completed",
        model: "sonnet",
        tokenUsage: { input: 1000000, output: 1000000 },
      });

      await cmdUsage(tmp, { format: "json", group: "day" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.periods[0].estimatedCost).toBeDefined();
      expect(parsed.periods[0].estimatedCost.total).toBe("$18.00");
    });

    it("omits periods from JSON when no --group specified", async () => {
      writeLog(tmp, [
        {
          timestamp: "2026-01-15T10:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 1, inputTokens: 1000, outputTokens: 200 }),
        },
      ]);

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.periods).toBeUndefined();
      expect(parsed.group).toBeUndefined();
    });

    it("does not show period section when no data", async () => {
      await cmdUsage(tmp, { group: "day" });
      const out = output();

      expect(out).not.toContain("By day:");
    });
  });

  describe("error handling", () => {
    it("rejects invalid format", async () => {
      await expect(cmdUsage(tmp, { format: "csv" })).rejects.toThrow(
        /Unknown format/,
      );
    });

    it("rejects invalid group period", async () => {
      await expect(cmdUsage(tmp, { group: "hour" })).rejects.toThrow(
        /Unknown group period/,
      );
    });
  });

  describe("budget warnings", () => {
    it("shows warning when token budget threshold is reached", async () => {
      writeConfig(tmp, {
        ...MINIMAL_CONFIG,
        budget: { tokens: 10000, warnAt: 80 },
      });
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        tokenUsage: { input: 7000, output: 2000 },
      });

      await cmdUsage(tmp, {});
      const err = errOutput();

      expect(err).toContain("Budget warning");
      expect(err).toContain("Approaching token budget");
    });

    it("shows exceeded warning when token budget is exceeded", async () => {
      writeConfig(tmp, {
        ...MINIMAL_CONFIG,
        budget: { tokens: 5000 },
      });
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        tokenUsage: { input: 4000, output: 2000 },
      });

      await cmdUsage(tmp, {});
      const err = errOutput();

      expect(err).toContain("BUDGET EXCEEDED");
      expect(err).toContain("Token budget exceeded");
    });

    it("shows cost budget warning", async () => {
      writeConfig(tmp, {
        ...MINIMAL_CONFIG,
        budget: { cost: 20, warnAt: 80 },
      });
      // 1M input + 1M output @ Sonnet pricing = $18 → 90% of $20
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        tokenUsage: { input: 1000000, output: 1000000 },
      });

      await cmdUsage(tmp, {});
      const err = errOutput();

      expect(err).toContain("Approaching cost budget");
    });

    it("does not show budget warnings when under threshold", async () => {
      writeConfig(tmp, {
        ...MINIMAL_CONFIG,
        budget: { tokens: 100000 },
      });
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        tokenUsage: { input: 1000, output: 500 },
      });

      await cmdUsage(tmp, {});
      const err = errOutput();

      expect(err).not.toContain("Budget");
    });

    it("does not show budget warnings when no budget configured", async () => {
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        tokenUsage: { input: 100000, output: 50000 },
      });

      await cmdUsage(tmp, {});
      const err = errOutput();

      expect(err).not.toContain("Budget");
    });

    it("includes budget in JSON output when configured", async () => {
      writeConfig(tmp, {
        ...MINIMAL_CONFIG,
        budget: { tokens: 10000 },
      });
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        tokenUsage: { input: 7000, output: 2000 },
      });

      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.budget).toBeDefined();
      expect(parsed.budget.severity).toBe("warning");
      expect(parsed.budget.tokens).toBeDefined();
      expect(parsed.budget.tokens.used).toBe(9000);
      expect(parsed.budget.tokens.budget).toBe(10000);
    });

    it("omits budget from JSON when not configured", async () => {
      await cmdUsage(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.budget).toBeUndefined();
    });

    it("aborts when budget exceeded and abort is true", async () => {
      writeConfig(tmp, {
        ...MINIMAL_CONFIG,
        budget: { tokens: 5000, abort: true },
      });
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        tokenUsage: { input: 4000, output: 2000 },
      });

      await expect(cmdUsage(tmp, {})).rejects.toThrow(/Budget exceeded/);
    });

    it("does not abort when budget exceeded but abort is false", async () => {
      writeConfig(tmp, {
        ...MINIMAL_CONFIG,
        budget: { tokens: 5000, abort: false },
      });
      writeHenchRun(tmp, "run-1", {
        startedAt: "2026-01-16T10:00:00.000Z",
        status: "completed",
        tokenUsage: { input: 4000, output: 2000 },
      });

      // Should not throw
      await cmdUsage(tmp, {});
      const err = errOutput();

      expect(err).toContain("BUDGET EXCEEDED");
    });
  });
});

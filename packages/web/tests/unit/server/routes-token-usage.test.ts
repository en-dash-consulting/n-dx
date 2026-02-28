import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleTokenUsageRoute, resetAggregationCache } from "../../../src/server/routes-token-usage.js";

/** Create a hench run record with token usage. */
function makeRun(
  id: string,
  startedAt: string,
  inputTokens: number,
  outputTokens: number,
  opts?: { model?: string; turnTokenUsage?: Array<{ input: number; output: number; vendor?: string; model?: string }> },
) {
  return {
    id,
    startedAt,
    status: "completed",
    tokenUsage: { input: inputTokens, output: outputTokens },
    model: opts?.model,
    turnTokenUsage: opts?.turnTokenUsage,
  };
}

/** Create a rex execution log entry for analyze. */
function makeLogEntry(
  timestamp: string,
  inputTokens: number,
  outputTokens: number,
  calls: number,
  vendor = "codex",
  model = "gpt-5-codex",
) {
  return JSON.stringify({
    timestamp,
    event: "analyze_token_usage",
    detail: JSON.stringify({ calls, inputTokens, outputTokens, vendor, model }),
  });
}

/** Start a test server that only runs token usage routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (await handleTokenUsageRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("Token Usage API routes", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let henchRunsDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "token-api-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    henchRunsDir = join(tmpDir, ".hench", "runs");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchRunsDir, { recursive: true });
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          vendor: "codex",
          codex: { model: "gpt-5-codex" },
        },
      }),
    );

    // Seed test data: hench runs
    await writeFile(
      join(henchRunsDir, "run-1.json"),
      JSON.stringify(makeRun("run-1", "2026-02-01T10:00:00.000Z", 5000, 2000, {
        model: "gpt-5-codex",
        turnTokenUsage: [{ input: 5000, output: 2000, vendor: "codex", model: "gpt-5-codex" }],
      })),
    );
    await writeFile(
      join(henchRunsDir, "run-2.json"),
      JSON.stringify(makeRun("run-2", "2026-02-03T14:00:00.000Z", 8000, 3000, {
        model: "gpt-5-codex",
        turnTokenUsage: [{ input: 8000, output: 3000, vendor: "codex", model: "gpt-5-codex" }],
      })),
    );

    // Seed test data: rex execution log
    const logPath = join(rexDir, "execution-log.jsonl");
    await appendFile(logPath, makeLogEntry("2026-02-02T09:00:00.000Z", 1000, 500, 3) + "\n");
    await appendFile(logPath, makeLogEntry("2026-02-04T11:00:00.000Z", 2000, 800, 5) + "\n");

    // Seed test data: sourcevision manifest
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify({
        analyzedAt: "2026-02-03T08:00:00.000Z",
        tokenUsage: {
          calls: 2,
          inputTokens: 400,
          outputTokens: 200,
          vendor: "claude",
          model: "claude-sonnet-4-20250514",
        },
        targetPath: tmpDir,
        version: "1.0.0",
      }),
    );

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    resetAggregationCache();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/token/summary returns aggregate usage with cost", async () => {
    const res = await fetch(`http://localhost:${port}/api/token/summary`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Total: hench(5000+8000=13000 in, 2000+3000=5000 out)
    //        rex(1000+2000=3000 in, 500+800=1300 out)
    //        sv(400 in, 200 out)
    expect(data.usage.totalInputTokens).toBe(16400);
    expect(data.usage.totalOutputTokens).toBe(6500);
    expect(data.usage.totalCalls).toBe(12); // 2 runs + 8 rex calls + 2 sv calls
    expect(data.usage.packages.hench.inputTokens).toBe(13000);
    expect(data.usage.packages.rex.inputTokens).toBe(3000);
    expect(data.usage.packages.sv.inputTokens).toBe(400);
    expect(data.cost).toBeDefined();
    expect(data.cost.totalRaw).toBeGreaterThan(0);
    expect(data.eventCount).toBe(5); // 2 hench + 2 rex + 1 sv
  });

  it("GET /api/token/summary respects since/until filters", async () => {
    const since = "2026-02-03T00:00:00.000Z";
    const res = await fetch(`http://localhost:${port}/api/token/summary?since=${since}`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // Only events on/after Feb 3: run-2, rex log entry 2, sv manifest
    expect(data.usage.packages.hench.inputTokens).toBe(8000);
    expect(data.usage.packages.rex.inputTokens).toBe(2000);
    expect(data.usage.packages.sv.inputTokens).toBe(400);
    expect(data.eventCount).toBe(3);
  });

  it("GET /api/token/events returns all events sorted by time", async () => {
    const res = await fetch(`http://localhost:${port}/api/token/events`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.events).toHaveLength(5);
    // Sorted by timestamp
    expect(data.events[0].timestamp).toBe("2026-02-01T10:00:00.000Z");
    expect(data.events[0].package).toBe("hench");
    expect(data.events[4].timestamp).toBe("2026-02-04T11:00:00.000Z");
    expect(data.events[4].package).toBe("rex");
  });

  it("GET /api/token/events filters by package", async () => {
    const res = await fetch(`http://localhost:${port}/api/token/events?package=hench`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.events).toHaveLength(2);
    expect(data.events.every((e: { package: string }) => e.package === "hench")).toBe(true);
  });

  it("GET /api/token/by-command returns command breakdown", async () => {
    const res = await fetch(`http://localhost:${port}/api/token/by-command`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.commands).toBeDefined();
    expect(data.commands.length).toBeGreaterThan(0);

    const henchCmd = data.commands.find((c: { command: string; package: string }) =>
      c.package === "hench" && c.command === "run",
    );
    expect(henchCmd).toBeDefined();
    expect(henchCmd.inputTokens).toBe(13000);
    expect(henchCmd.calls).toBe(2);

    const rexCmd = data.commands.find((c: { command: string; package: string }) =>
      c.package === "rex" && c.command === "analyze",
    );
    expect(rexCmd).toBeDefined();
    expect(rexCmd.inputTokens).toBe(3000);
    expect(rexCmd.calls).toBe(8);
  });

  it("GET /api/token/by-period groups by day", async () => {
    const res = await fetch(`http://localhost:${port}/api/token/by-period?period=day`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.period).toBe("day");
    expect(data.buckets).toBeDefined();
    expect(data.buckets.length).toBeGreaterThan(0);

    // Check that buckets are sorted chronologically
    for (let i = 1; i < data.buckets.length; i++) {
      expect(data.buckets[i].period >= data.buckets[i - 1].period).toBe(true);
    }

    // Each bucket should have estimatedCost
    for (const bucket of data.buckets) {
      expect(bucket.estimatedCost).toBeDefined();
      expect(bucket.estimatedCost.total).toBeDefined();
    }
  });

  it("GET /api/token/by-period supports week and month groupings", async () => {
    const weekRes = await fetch(`http://localhost:${port}/api/token/by-period?period=week`);
    expect(weekRes.status).toBe(200);
    const weekData = await weekRes.json();
    expect(weekData.period).toBe("week");
    expect(weekData.buckets.length).toBeGreaterThan(0);

    const monthRes = await fetch(`http://localhost:${port}/api/token/by-period?period=month`);
    expect(monthRes.status).toBe(200);
    const monthData = await monthRes.json();
    expect(monthData.period).toBe("month");
    expect(monthData.buckets.length).toBe(1); // All in February 2026
    expect(monthData.buckets[0].period).toBe("2026-02");
  });

  it("GET /api/token/by-period rejects invalid period", async () => {
    const res = await fetch(`http://localhost:${port}/api/token/by-period?period=quarter`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("Invalid period");
  });

  it("GET /api/token/budget returns ok when no budget configured", async () => {
    const res = await fetch(`http://localhost:${port}/api/token/budget`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.budget.severity).toBe("ok");
    expect(data.usage).toBeDefined();
    expect(data.cost).toBeDefined();
  });

  it("GET /api/token/budget detects exceeded budget", async () => {
    // Configure a very low budget
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ budget: { tokens: 100, warnAt: 80 } }),
    );

    const res = await fetch(`http://localhost:${port}/api/token/budget`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.budget.severity).toBe("exceeded");
    expect(data.budget.tokens).toBeDefined();
    expect(data.budget.tokens.severity).toBe("exceeded");
    expect(data.budget.tokens.percent).toBeGreaterThan(100);
    expect(data.budget.warnings.length).toBeGreaterThan(0);
  });

  it("GET /api/token/budget detects warning threshold", async () => {
    // Set budget just above usage (total is 22900 tokens)
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ budget: { tokens: 25000, warnAt: 80 } }),
    );

    const res = await fetch(`http://localhost:${port}/api/token/budget`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.budget.severity).toBe("warning");
    expect(data.budget.tokens.severity).toBe("warning");
  });

  it("GET /api/token/utilization returns vendor/model totals, trend, and source metadata", async () => {
    // Simulate config changing after events were recorded.
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          vendor: "claude",
          claude: { model: "claude-sonnet-4-20250514" },
        },
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/token/utilization?period=day&since=2026-02-03T00:00:00.000Z`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.configured).toEqual({
      vendor: "claude",
      model: "claude-sonnet-4-20250514",
    });
    expect(data.source.rex).toBe(".rex/execution-log.jsonl");
    expect(data.source.hench).toBe(".hench/runs/*.json");
    expect(data.source.sourcevision).toBe(".sourcevision/manifest.json");
    expect(data.window).toEqual({
      since: "2026-02-03T00:00:00.000Z",
      until: null,
    });

    expect(data.byVendorModel).toHaveLength(2);
    expect(data.byVendorModel[0].vendor).toBe("codex");
    expect(data.byVendorModel[0].model).toBe("gpt-5-codex");
    expect(data.byVendorModel[0].inputTokens).toBe(10000);
    expect(data.byVendorModel[0].outputTokens).toBe(3800);
    expect(data.byVendorModel[0].toolBreakdown.hench.inputTokens).toBe(8000);
    expect(data.byVendorModel[0].toolBreakdown.rex.inputTokens).toBe(2000);
    expect(data.byVendorModel[1].vendor).toBe("claude");
    expect(data.byVendorModel[1].model).toBe("claude-sonnet-4-20250514");
    expect(data.byVendorModel[1].inputTokens).toBe(400);
    expect(data.byVendorModel[1].outputTokens).toBe(200);
    expect(data.byVendorModel[1].toolBreakdown.sv.inputTokens).toBe(400);
    const groupedTotal = data.byVendorModel
      .reduce((sum: number, vm: { inputTokens: number; outputTokens: number }) => sum + vm.inputTokens + vm.outputTokens, 0);
    expect(groupedTotal).toBe(data.usage.totalInputTokens + data.usage.totalOutputTokens);

    expect(data.trend.length).toBeGreaterThan(0);
    for (const bucket of data.trend) {
      const bucketTokenTotal = bucket.byVendorModel
        .reduce((sum: number, vm: { inputTokens: number; outputTokens: number }) => sum + vm.inputTokens + vm.outputTokens, 0);
      expect(bucketTokenTotal).toBe(bucket.totalTokens);
      expect(bucket.toolBreakdown).toBeDefined();
      expect(bucket.estimatedCost.total).toBeDefined();
    }
  });

  it("GET /api/token/utilization groups by per-event metadata instead of configured model", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          vendor: "claude",
          claude: { model: "claude-opus-4-20250514" },
        },
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/token/utilization?since=2026-02-03T00:00:00.000Z`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.configured).toEqual({
      vendor: "claude",
      model: "claude-opus-4-20250514",
    });

    expect(data.byVendorModel).toHaveLength(2);
    expect(data.byVendorModel.some((vm: { vendor: string; model: string }) =>
      vm.vendor === "codex" && vm.model === "gpt-5-codex",
    )).toBe(true);
    expect(data.byVendorModel.some((vm: { vendor: string; model: string }) =>
      vm.vendor === "claude" && vm.model === "claude-sonnet-4-20250514",
    )).toBe(true);
    expect(data.byVendorModel.some((vm: { vendor: string; model: string }) =>
      vm.vendor === "claude" && vm.model === "claude-opus-4-20250514",
    )).toBe(false);
  });

  it("GET /api/token/utilization includes fallback reason code when weekly budget uses vendor default", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          vendor: "codex",
          codex: { model: "gpt-5-codex" },
        },
        tokenUsage: {
          weeklyBudget: {
            globalDefault: 90_000,
            vendors: {
              codex: {
                default: 80_000,
                models: {},
              },
            },
          },
        },
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/token/utilization`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.weeklyBudget).toEqual({
      budget: 80_000,
      source: "vendor_default",
      reasonCode: "fallback_model_budget_missing_or_invalid",
    });
    expect(data.weeklyBudgetValidationErrors).toEqual([]);
  });

  it("GET /api/token/utilization rejects invalid weekly budget entries with validation diagnostics", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        llm: {
          vendor: "codex",
          codex: { model: "gpt-5-codex" },
        },
        tokenUsage: {
          weeklyBudget: {
            globalDefault: "100000",
            vendors: {
              codex: {
                default: -1,
                models: {
                  "gpt-5-codex": Number.NaN,
                },
              },
            },
          },
        },
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/token/utilization`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.weeklyBudget).toEqual({
      budget: null,
      source: "missing_budget",
      reasonCode: "missing_budget_invalid_config",
    });
    expect(data.weeklyBudgetValidationErrors).toHaveLength(3);
    expect(data.weeklyBudgetValidationErrors[0]).toMatchObject({
      code: "invalid_budget_value",
      path: "tokenUsage.weeklyBudget.globalDefault",
    });
    expect(data.weeklyBudgetValidationErrors[1]).toMatchObject({
      code: "invalid_budget_value",
      path: "tokenUsage.weeklyBudget.vendors.codex.default",
    });
    expect(data.weeklyBudgetValidationErrors[2]).toMatchObject({
      code: "invalid_budget_value",
      path: "tokenUsage.weeklyBudget.vendors.codex.models.gpt-5-codex",
    });
  });

  it("GET /api/token/utilization aggregates missing metadata into unknown bucket across packages", async () => {
    await writeFile(
      join(henchRunsDir, "run-1.json"),
      JSON.stringify(makeRun("run-1", "2026-02-01T10:00:00.000Z", 1000, 100, {
        turnTokenUsage: [{ input: 1000, output: 100 }],
      })),
    );
    await writeFile(
      join(henchRunsDir, "run-2.json"),
      JSON.stringify(makeRun("run-2", "2026-02-03T14:00:00.000Z", 8000, 3000, {
        model: "gpt-5-codex",
        turnTokenUsage: [{ input: 8000, output: 3000, vendor: "codex", model: "gpt-5-codex" }],
      })),
    );

    await writeFile(
      join(rexDir, "execution-log.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-02-02T09:00:00.000Z",
          event: "analyze_token_usage",
          detail: JSON.stringify({ calls: 1, inputTokens: 300, outputTokens: 30 }),
        }),
        makeLogEntry("2026-02-04T11:00:00.000Z", 2000, 800, 5),
      ].join("\n") + "\n",
    );

    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify({
        analyzedAt: "2026-02-03T08:00:00.000Z",
        tokenUsage: { calls: 2, inputTokens: 400, outputTokens: 200 },
        targetPath: tmpDir,
        version: "1.0.0",
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/token/utilization`);
    expect(res.status).toBe(200);
    const data = await res.json();

    const unknownBucket = data.byVendorModel.find(
      (vm: { vendor: string; model: string }) => vm.vendor === "unknown" && vm.model === "unknown",
    );
    expect(unknownBucket).toBeDefined();
    expect(unknownBucket.inputTokens).toBe(1700); // hench 1000 + rex 300 + sv 400
    expect(unknownBucket.outputTokens).toBe(330); // hench 100 + rex 30 + sv 200
    expect(unknownBucket.toolBreakdown.hench.inputTokens).toBe(1000);
    expect(unknownBucket.toolBreakdown.rex.inputTokens).toBe(300);
    expect(unknownBucket.toolBreakdown.sv.inputTokens).toBe(400);

    const codexBucket = data.byVendorModel.find(
      (vm: { vendor: string; model: string }) => vm.vendor === "codex" && vm.model === "gpt-5-codex",
    );
    expect(codexBucket).toBeDefined();
    expect(codexBucket.inputTokens).toBe(10000);
    expect(codexBucket.outputTokens).toBe(3800);
  });

  it("falls back to unknown vendor/model when sourcevision metadata is missing", async () => {
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify({
        analyzedAt: "2026-02-03T08:00:00.000Z",
        tokenUsage: { calls: 2, inputTokens: 400, outputTokens: 200 },
        targetPath: tmpDir,
        version: "1.0.0",
      }),
    );

    const res = await fetch(`http://localhost:${port}/api/token/events?package=sv`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.events).toHaveLength(1);
    expect(data.events[0].vendor).toBe("unknown");
    expect(data.events[0].model).toBe("unknown");
  });

  it("returns false for non-token routes", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/stats`);
    expect(res.status).toBe(404); // Falls through to 404 since only token routes are registered
  });

  it("handles missing data gracefully", async () => {
    // Create a fresh tmpDir with no data
    const emptyDir = await mkdtemp(join(tmpdir(), "token-empty-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    const emptyRexDir = join(emptyDir, ".rex");
    await mkdir(emptySvDir, { recursive: true });
    await mkdir(emptyRexDir, { recursive: true });

    const emptyCtx: ServerContext = {
      projectDir: emptyDir,
      svDir: emptySvDir,
      rexDir: emptyRexDir,
      dev: false,
    };

    const emptyServer = await startTestServer(emptyCtx);

    try {
      const res = await fetch(`http://localhost:${emptyServer.port}/api/token/summary`);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.usage.totalInputTokens).toBe(0);
      expect(data.usage.totalOutputTokens).toBe(0);
      expect(data.usage.totalCalls).toBe(0);
      expect(data.eventCount).toBe(0);
    } finally {
      emptyServer.server.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

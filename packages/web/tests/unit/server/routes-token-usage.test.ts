import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleTokenUsageRoute } from "../../../src/server/routes-token-usage.js";

/** Create a hench run record with token usage. */
function makeRun(id: string, startedAt: string, inputTokens: number, outputTokens: number) {
  return {
    id,
    startedAt,
    status: "completed",
    tokenUsage: { input: inputTokens, output: outputTokens },
  };
}

/** Create a rex execution log entry for analyze. */
function makeLogEntry(timestamp: string, inputTokens: number, outputTokens: number, calls: number) {
  return JSON.stringify({
    timestamp,
    event: "analyze_token_usage",
    detail: JSON.stringify({ calls, inputTokens, outputTokens }),
  });
}

/** Start a test server that only runs token usage routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (handleTokenUsageRoute(req, res, ctx)) return;
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

    // Seed test data: hench runs
    await writeFile(
      join(henchRunsDir, "run-1.json"),
      JSON.stringify(makeRun("run-1", "2026-02-01T10:00:00.000Z", 5000, 2000)),
    );
    await writeFile(
      join(henchRunsDir, "run-2.json"),
      JSON.stringify(makeRun("run-2", "2026-02-03T14:00:00.000Z", 8000, 3000)),
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
        tokenUsage: { calls: 2, inputTokens: 400, outputTokens: 200 },
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

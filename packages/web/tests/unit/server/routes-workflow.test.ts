import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleWorkflowRoute } from "../../../src/server/routes-workflow.js";

/** Minimal hench config for testing. */
function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "hench/v1",
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: ".n-dx/rex",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
    guard: {
      blockedPaths: [".n-dx/hench/**", ".n-dx/rex/**", ".git/**"],
      allowedCommands: ["npm", "git", "tsc"],
      commandTimeout: 30000,
      maxFileSize: 1048576,
    },
    retry: {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
    },
    ...overrides,
  };
}

/** Minimal run record for testing. */
function makeRun(
  taskId: string,
  status: string,
  startedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: `run-${Math.random().toString(36).slice(2, 8)}`,
    taskId,
    taskTitle: `Task ${taskId}`,
    startedAt,
    finishedAt: status === "running" ? undefined : startedAt,
    status,
    turns: 10,
    tokenUsage: { input: 5000, output: 1000 },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  };
}

/** Start a test server that routes through handleWorkflowRoute. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleWorkflowRoute(req, res, ctx);
      if (result instanceof Promise) {
        if (await result) return;
      } else if (result) {
        return;
      }
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

describe("Workflow Optimization API routes", () => {
  let tmpDir: string;
  let henchDir: string;
  let runsDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "workflow-api-"));
    henchDir = join(tmpDir, ".n-dx/hench");
    runsDir = join(henchDir, "runs");
    await mkdir(runsDir, { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".n-dx/sourcevision"),
      rexDir: join(tmpDir, ".n-dx/rex"),
      dev: false,
    };

    // Write default config
    await writeFile(
      join(henchDir, "config.json"),
      JSON.stringify(makeConfig(), null, 2) + "\n",
    );

    const result = await startTestServer(ctx);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── GET /api/hench/workflow/analysis ──────────────────────────────

  it("returns empty analysis when no runs exist", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/analysis`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalRuns).toBe(0);
    expect(body.timeRange).toBeNull();
    expect(body.suggestions).toEqual([]);
    expect(body.decisionHistory).toBeDefined();
  });

  it("returns analysis with stats and suggestions", async () => {
    // Write some run files
    const runs = [
      makeRun("t1", "timeout", "2024-01-01T01:00:00Z"),
      makeRun("t1", "timeout", "2024-01-01T02:00:00Z"),
      makeRun("t2", "completed", "2024-01-01T03:00:00Z"),
    ];

    for (const run of runs) {
      await writeFile(
        join(runsDir, `${run.id}.json`),
        JSON.stringify(run, null, 2),
      );
    }

    const res = await fetch(`http://localhost:${port}/api/hench/workflow/analysis`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalRuns).toBe(3);
    expect(body.stats).toBeDefined();
    expect(body.stats.successRate).toBeDefined();
    expect(body.timeRange).toBeDefined();
    expect(body.suggestions.length).toBeGreaterThan(0);
  });

  it("generates failure prevention suggestions for timeouts", async () => {
    const runs = [
      makeRun("t1", "timeout", "2024-01-01T01:00:00Z"),
      makeRun("t1", "timeout", "2024-01-01T02:00:00Z"),
    ];

    for (const run of runs) {
      await writeFile(
        join(runsDir, `${run.id}.json`),
        JSON.stringify(run, null, 2),
      );
    }

    const res = await fetch(`http://localhost:${port}/api/hench/workflow/analysis`);
    const body = await res.json();
    const timeoutSuggestion = body.suggestions.find(
      (s: { category: string; title: string }) =>
        s.category === "failure-prevention" && s.title.includes("timeout"),
    );
    expect(timeoutSuggestion).toBeDefined();
  });

  // ── POST /api/hench/workflow/suggestions/:id ─────────────────────

  it("records a suggestion decision", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/suggestions/test-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "rejected",
        title: "Test suggestion",
        category: "token-efficiency",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.record.decision).toBe("rejected");

    // Verify persistence
    const history = JSON.parse(
      await readFile(join(henchDir, "suggestions.json"), "utf-8"),
    );
    expect(history.records).toHaveLength(1);
    expect(history.records[0].suggestionId).toBe("test-1");
  });

  it("rejects invalid decision values", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/suggestions/test-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts deferred decisions", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/suggestions/test-2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "deferred",
        title: "Deferred suggestion",
        category: "turn-optimization",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.record.decision).toBe("deferred");
  });

  // ── POST /api/hench/workflow/apply ────────────────────────────────

  it("previews config changes without applying", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: { maxTurns: 80 },
        preview: true,
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.preview).toBe(true);
    expect(body.diff).toBeDefined();
    expect(body.diff).toHaveLength(1);
    expect(body.diff[0].path).toBe("maxTurns");
    expect(body.diff[0].oldValue).toBe(50);
    expect(body.diff[0].newValue).toBe(80);

    // Verify config NOT changed
    const config = JSON.parse(
      await readFile(join(henchDir, "config.json"), "utf-8"),
    );
    expect(config.maxTurns).toBe(50);
  });

  it("applies config changes and records acceptance", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: { maxTurns: 80 },
        suggestionId: "turn-optimization-1",
        title: "Increase turns",
        category: "turn-optimization",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.diff).toHaveLength(1);

    // Verify config changed
    const config = JSON.parse(
      await readFile(join(henchDir, "config.json"), "utf-8"),
    );
    expect(config.maxTurns).toBe(80);

    // Verify acceptance recorded
    const history = JSON.parse(
      await readFile(join(henchDir, "suggestions.json"), "utf-8"),
    );
    expect(history.records).toHaveLength(1);
    expect(history.records[0].decision).toBe("accepted");
    expect(history.records[0].appliedChanges).toEqual({ maxTurns: 80 });
  });

  it("applies nested config changes", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: { "retry.maxRetries": 5 },
      }),
    });
    expect(res.status).toBe(200);

    const config = JSON.parse(
      await readFile(join(henchDir, "config.json"), "utf-8"),
    );
    expect(config.retry.maxRetries).toBe(5);
  });

  it("rejects empty changes", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: {} }),
    });
    expect(res.status).toBe(400);
  });

  // ── GET /api/hench/workflow/history ───────────────────────────────

  it("returns empty history initially", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/history`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.records).toEqual([]);
    expect(body.stats.total).toBe(0);
    expect(body.stats.acceptanceRate).toBe(0);
  });

  it("returns history with stats after decisions", async () => {
    // Record some decisions
    await fetch(`http://localhost:${port}/api/hench/workflow/suggestions/s1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "accepted", title: "A", category: "token-efficiency" }),
    });
    await fetch(`http://localhost:${port}/api/hench/workflow/suggestions/s2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "rejected", title: "B", category: "failure-prevention" }),
    });

    const res = await fetch(`http://localhost:${port}/api/hench/workflow/history`);
    const body = await res.json();

    expect(body.records).toHaveLength(2);
    expect(body.stats.total).toBe(2);
    expect(body.stats.accepted).toBe(1);
    expect(body.stats.rejected).toBe(1);
    expect(body.stats.acceptanceRate).toBe(0.5);
    expect(body.stats.byCategory["token-efficiency"]).toBeDefined();
  });

  // ── Unmatched routes ──────────────────────────────────────────────

  it("returns 404 for unknown workflow paths", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/workflow/unknown`);
    expect(res.status).toBe(404);
  });
});

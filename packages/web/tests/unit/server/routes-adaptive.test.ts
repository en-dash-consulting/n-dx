import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleAdaptiveRoute } from "../../../src/server/routes-adaptive.js";

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
      blockedPaths: [".hench/**", ".rex/**", ".git/**"],
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

/** Start a test server that routes through handleAdaptiveRoute. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleAdaptiveRoute(req, res, ctx);
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

describe("Adaptive Workflow Adjustment API routes", () => {
  let tmpDir: string;
  let henchDir: string;
  let runsDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "adaptive-api-"));
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

  // ── GET /api/hench/adaptive/analysis ──────────────────────────────

  it("returns empty analysis when no runs exist", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/analysis`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.metrics).toBeDefined();
    expect(body.metrics.totalRuns).toBe(0);
    expect(body.adjustments).toEqual([]);
    expect(body.notifications).toEqual([]);
    expect(body.settings).toBeDefined();
  });

  it("returns analysis with metrics when runs exist", async () => {
    // Write enough runs to exceed min threshold (5)
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );

    for (const run of runs) {
      await writeFile(
        join(runsDir, `${run.id}.json`),
        JSON.stringify(run, null, 2),
      );
    }

    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/analysis`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.metrics.totalRuns).toBe(6);
    expect(body.metrics.recentSuccessRate).toBeDefined();
    expect(body.settings).toBeDefined();
    expect(body.settings.enabled).toBe(true);
  });

  it("returns adjustments when conditions trigger them", async () => {
    // Create runs with high turn usage to trigger complexity scaling
    const runs = Array.from({ length: 6 }, (_, i) =>
      makeRun(`t${i}`, i < 3 ? "failed" : "completed",
        `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        { turns: 40 }),
    );

    for (const run of runs) {
      await writeFile(
        join(runsDir, `${run.id}.json`),
        JSON.stringify(run, null, 2),
      );
    }

    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/analysis`);
    const body = await res.json();
    // Should have at least one adjustment (complexity scaling for maxTurns)
    expect(body.adjustments.length).toBeGreaterThan(0);
    expect(body.notifications.length).toBe(body.adjustments.length);
  });

  // ── GET /api/hench/adaptive/settings ──────────────────────────────

  it("returns default settings when no state exists", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/settings`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.settings.enabled).toBe(true);
    expect(body.settings.windowSize).toBe(20);
    expect(body.settings.minRunsRequired).toBe(5);
    expect(body.settings.lockedKeys).toEqual([]);
    expect(body.overrides).toEqual({});
  });

  // ── POST /api/hench/adaptive/settings ─────────────────────────────

  it("updates settings", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false, windowSize: 30 }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.settings.enabled).toBe(false);
    expect(body.settings.windowSize).toBe(30);

    // Verify persistence
    const state = JSON.parse(
      await readFile(join(henchDir, "adaptive.json"), "utf-8"),
    );
    expect(state.settings.enabled).toBe(false);
    expect(state.settings.windowSize).toBe(30);
  });

  it("rejects invalid window size", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ windowSize: 3 }), // below minimum of 5
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    // Settings should not include invalid windowSize
    expect(body.settings.windowSize).toBe(20); // default
  });

  // ── POST /api/hench/adaptive/apply ────────────────────────────────

  it("applies an adjustment to config", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adjustmentId: "adj-complexity-scaling-1",
        configKey: "maxTurns",
        newValue: 80,
        title: "Scale up turns",
        category: "complexity-scaling",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.configKey).toBe("maxTurns");
    expect(body.previousValue).toBe(50);
    expect(body.newValue).toBe(80);

    // Verify config changed
    const config = JSON.parse(
      await readFile(join(henchDir, "config.json"), "utf-8"),
    );
    expect(config.maxTurns).toBe(80);

    // Verify history recorded
    const state = JSON.parse(
      await readFile(join(henchDir, "adaptive.json"), "utf-8"),
    );
    expect(state.history).toHaveLength(1);
    expect(state.history[0].decision).toBe("applied");
  });

  it("rejects apply without required fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ configKey: "maxTurns" }), // missing newValue
    });
    expect(res.status).toBe(400);
  });

  // ── POST /api/hench/adaptive/dismiss/:id ──────────────────────────

  it("dismisses a recommended adjustment", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/dismiss/adj-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Some adjustment",
        category: "complexity-scaling",
        configKey: "maxTurns",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.adjustmentId).toBe("adj-1");

    // Verify history recorded
    const state = JSON.parse(
      await readFile(join(henchDir, "adaptive.json"), "utf-8"),
    );
    expect(state.history).toHaveLength(1);
    expect(state.history[0].decision).toBe("dismissed");
  });

  // ── POST /api/hench/adaptive/lock/:key ────────────────────────────

  it("locks a config key from auto-adjustment", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/lock/maxTurns`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.lockedKeys).toContain("maxTurns");
  });

  it("does not duplicate locked keys", async () => {
    await fetch(`http://localhost:${port}/api/hench/adaptive/lock/maxTurns`, { method: "POST" });
    await fetch(`http://localhost:${port}/api/hench/adaptive/lock/maxTurns`, { method: "POST" });

    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/settings`);
    const body = await res.json();
    const count = body.settings.lockedKeys.filter((k: string) => k === "maxTurns").length;
    expect(count).toBe(1);
  });

  // ── POST /api/hench/adaptive/unlock/:key ──────────────────────────

  it("unlocks a config key for auto-adjustment", async () => {
    // First lock it
    await fetch(`http://localhost:${port}/api/hench/adaptive/lock/maxTurns`, { method: "POST" });

    // Then unlock
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/unlock/maxTurns`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.lockedKeys).not.toContain("maxTurns");
  });

  // ── POST /api/hench/adaptive/override ─────────────────────────────

  it("sets a manual override and locks the key", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "maxTurns", value: 100 }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.overrides.maxTurns).toBe(100);
    expect(body.lockedKeys).toContain("maxTurns");

    // Verify config was updated
    const config = JSON.parse(
      await readFile(join(henchDir, "config.json"), "utf-8"),
    );
    expect(config.maxTurns).toBe(100);
  });

  it("rejects override without required fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "maxTurns" }), // missing value
    });
    expect(res.status).toBe(400);
  });

  // ── DELETE /api/hench/adaptive/override/:key ──────────────────────

  it("removes a manual override and unlocks the key", async () => {
    // Set an override first
    await fetch(`http://localhost:${port}/api/hench/adaptive/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "maxTurns", value: 100 }),
    });

    // Remove it
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/override/maxTurns`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.overrides.maxTurns).toBeUndefined();
  });

  // ── GET /api/hench/adaptive/history ───────────────────────────────

  it("returns empty history initially", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/history`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.records).toEqual([]);
    expect(body.stats.total).toBe(0);
  });

  it("returns history with stats after adjustments", async () => {
    // Apply an adjustment
    await fetch(`http://localhost:${port}/api/hench/adaptive/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adjustmentId: "adj-1",
        configKey: "maxTurns",
        newValue: 80,
        title: "Scale up",
        category: "complexity-scaling",
        automatic: true,
      }),
    });

    // Dismiss another
    await fetch(`http://localhost:${port}/api/hench/adaptive/dismiss/adj-2`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Some other",
        category: "velocity-tracking",
        configKey: "loopPauseMs",
      }),
    });

    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/history`);
    const body = await res.json();

    expect(body.records).toHaveLength(2);
    expect(body.stats.total).toBe(2);
    expect(body.stats.applied).toBe(1);
    expect(body.stats.dismissed).toBe(1);
    expect(body.stats.automatic).toBe(1);
    expect(body.stats.manual).toBe(1);
  });

  // ── Unmatched routes ──────────────────────────────────────────────

  it("returns 404 for unknown adaptive paths", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/adaptive/unknown`);
    expect(res.status).toBe(404);
  });
});

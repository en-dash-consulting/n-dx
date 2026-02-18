import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleHenchRoute(req, res, ctx);
      if (result instanceof Promise) {
        result.then((handled) => {
          if (!handled) { res.writeHead(404); res.end("Not found"); }
        });
      } else if (!result) {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("Heartbeat data in audit endpoint", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-heartbeat-"));
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns healthy heartbeat status for fresh running task", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    const run = {
      id: "run-hb-1",
      taskId: "task-hb-1",
      taskTitle: "Fresh Task",
      startedAt: new Date().toISOString(),
      status: "running",
      lastActivityAt: new Date().toISOString(),
      turns: 2,
      tokenUsage: { input: 500, output: 200 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-hb-1.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);

    const entry = data.entries[0];
    expect(entry.heartbeatStatus).toBe("healthy");
    expect(entry.missedHeartbeats).toBe(0);
  });

  it("returns warning heartbeat status for task with 60s+ inactivity", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    // 70 seconds ago — past the warning threshold (2 * 30s = 60s)
    const run = {
      id: "run-hb-2",
      taskId: "task-hb-2",
      taskTitle: "Delayed Task",
      startedAt: new Date(Date.now() - 120_000).toISOString(),
      status: "running",
      lastActivityAt: new Date(Date.now() - 70_000).toISOString(),
      turns: 5,
      tokenUsage: { input: 1000, output: 500 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-hb-2.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);

    const entry = data.entries[0];
    expect(entry.heartbeatStatus).toBe("warning");
    expect(entry.missedHeartbeats).toBeGreaterThanOrEqual(2);
  });

  it("returns unresponsive heartbeat status for task with 120s+ inactivity", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    // 130 seconds ago — past the unresponsive threshold (4 * 30s = 120s)
    const run = {
      id: "run-hb-3",
      taskId: "task-hb-3",
      taskTitle: "Unresponsive Task",
      startedAt: new Date(Date.now() - 300_000).toISOString(),
      status: "running",
      lastActivityAt: new Date(Date.now() - 130_000).toISOString(),
      turns: 10,
      tokenUsage: { input: 2000, output: 1000 },
      toolCalls: [],
      model: "opus",
    };
    await writeFile(join(runsDir, "run-hb-3.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);

    const entry = data.entries[0];
    expect(entry.heartbeatStatus).toBe("unresponsive");
    expect(entry.missedHeartbeats).toBeGreaterThanOrEqual(4);
  });

  it("returns unknown heartbeat status for task without lastActivityAt", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    const run = {
      id: "run-hb-4",
      taskId: "task-hb-4",
      taskTitle: "Legacy Task",
      startedAt: new Date(Date.now() - 600_000).toISOString(),
      status: "running",
      turns: 5,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-hb-4.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);

    const entry = data.entries[0];
    expect(entry.heartbeatStatus).toBe("unknown");
    expect(entry.missedHeartbeats).toBe(0);
  });

  it("correctly computes missedHeartbeats count", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    // 95 seconds ago — should be 3 missed heartbeats (95 / 30 = 3.16, floor = 3)
    const run = {
      id: "run-hb-5",
      taskId: "task-hb-5",
      taskTitle: "Counting Heartbeats",
      startedAt: new Date(Date.now() - 200_000).toISOString(),
      status: "running",
      lastActivityAt: new Date(Date.now() - 95_000).toISOString(),
      turns: 7,
      tokenUsage: { input: 1500, output: 700 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-hb-5.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);

    const entry = data.entries[0];
    expect(entry.missedHeartbeats).toBe(3);
  });

  it("audit entries still include all existing fields alongside heartbeat data", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    const run = {
      id: "run-hb-6",
      taskId: "task-hb-6",
      taskTitle: "Full Entry",
      startedAt: new Date().toISOString(),
      status: "running",
      lastActivityAt: new Date().toISOString(),
      turns: 3,
      tokenUsage: { input: 800, output: 400 },
      toolCalls: [],
      model: "haiku",
    };
    await writeFile(join(runsDir, "run-hb-6.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    const entry = data.entries[0];

    // Existing fields
    expect(entry.taskId).toBe("task-hb-6");
    expect(entry.taskTitle).toBe("Full Entry");
    expect(entry.runId).toBe("run-hb-6");
    expect(entry.pid).toBeNull();
    expect(entry.status).toBe("running");
    expect(entry.source).toBe("disk");
    expect(entry.stale).toBe(false);
    expect(typeof entry.elapsedMs).toBe("number");
    expect(entry.turns).toBe(3);
    expect(entry.model).toBe("haiku");
    expect(entry.tokenUsage).toEqual({ input: 800, output: 400 });

    // New heartbeat fields
    expect(entry.heartbeatStatus).toBeDefined();
    expect(typeof entry.missedHeartbeats).toBe("number");
  });
});

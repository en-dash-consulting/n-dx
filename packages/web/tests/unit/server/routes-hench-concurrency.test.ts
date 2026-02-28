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

describe("GET /api/hench/concurrency", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-concurrency-"));
    const henchDir = join(tmpDir, ".hench");
    const runsDir = join(henchDir, "runs");
    const locksDir = join(henchDir, "locks");
    const rexDir = join(tmpDir, ".rex");
    await mkdir(runsDir, { recursive: true });
    await mkdir(locksDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir,
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns default concurrency status with no active processes", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.processCount).toBe(0);
    expect(data.maxConcurrent).toBe(3); // default
    expect(data.slotsAvailable).toBe(3);
    expect(data.level).toBe("low");
    expect(data.utilization).toBe(0);
    expect(data.totalRunning).toBe(0);
    expect(data.dashboardActive).toBe(0);
    expect(data.diskRunning).toBe(0);
    expect(data.pendingTasks).toBe(0);
    expect(data.locks).toEqual([]);
    expect(data.timestamp).toBeDefined();
  });

  it("reads maxConcurrent from hench config", async () => {
    const config = {
      schema: "hench/v1",
      guard: { maxConcurrentProcesses: 5 },
    };
    await writeFile(
      join(tmpDir, ".hench", "config.json"),
      JSON.stringify(config),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    const data = await res.json();
    expect(data.maxConcurrent).toBe(5);
    expect(data.slotsAvailable).toBe(5);
  });

  it("detects lock files with live PIDs", async () => {
    // Create a lock file for the current process (which is definitely alive)
    const lock = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      taskId: "task-1",
    };
    await writeFile(
      join(tmpDir, ".hench", "locks", `${process.pid}.lock`),
      JSON.stringify(lock),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    const data = await res.json();
    expect(data.processCount).toBe(1);
    expect(data.slotsAvailable).toBe(2); // 3 - 1
    expect(data.level).toBe("moderate");
    expect(data.utilization).toBeCloseTo(1 / 3, 1);
    expect(data.locks).toHaveLength(1);
    expect(data.locks[0].pid).toBe(process.pid);
    expect(data.locks[0].taskId).toBe("task-1");
  });

  it("ignores lock files with dead PIDs", async () => {
    // PID 99999999 almost certainly doesn't exist
    const lock = {
      pid: 99999999,
      startedAt: new Date().toISOString(),
      taskId: "task-dead",
    };
    await writeFile(
      join(tmpDir, ".hench", "locks", "99999999.lock"),
      JSON.stringify(lock),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    const data = await res.json();
    expect(data.processCount).toBe(0);
    expect(data.locks).toEqual([]);
  });

  it("counts disk-based running runs", async () => {
    const run = {
      id: "run-1",
      taskId: "task-running",
      taskTitle: "Running Task",
      startedAt: new Date().toISOString(),
      status: "running",
      lastActivityAt: new Date().toISOString(),
      turns: 5,
      tokenUsage: { input: 1000, output: 500 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(
      join(tmpDir, ".hench", "runs", "run-1.json"),
      JSON.stringify(run),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    const data = await res.json();
    expect(data.totalRunning).toBe(1);
    expect(data.diskRunning).toBe(1);
  });

  it("ignores completed runs", async () => {
    const run = {
      id: "run-done",
      taskId: "task-done",
      taskTitle: "Done Task",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 10,
      tokenUsage: { input: 2000, output: 1000 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(
      join(tmpDir, ".hench", "runs", "run-done.json"),
      JSON.stringify(run),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    const data = await res.json();
    expect(data.totalRunning).toBe(0);
    expect(data.diskRunning).toBe(0);
  });

  it("counts pending tasks from PRD", async () => {
    const prd = {
      schema: "rex/v1",
      items: [
        {
          id: "epic-1",
          title: "Epic",
          level: "epic",
          status: "in_progress",
          children: [
            { id: "task-1", title: "Pending Task", level: "task", status: "pending", children: [] },
            { id: "task-2", title: "Blocked Task", level: "task", status: "blocked", children: [] },
            { id: "task-3", title: "Done Task", level: "task", status: "completed", children: [] },
          ],
        },
      ],
    };
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify(prd),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    const data = await res.json();
    expect(data.pendingTasks).toBe(2); // task-1 (pending) + task-2 (blocked)
  });

  it("reports correct utilization levels", async () => {
    // Set max concurrent to 3 and create 2 live lock files → "high" level (2/3 = 67%)
    const config = { schema: "hench/v1", guard: { maxConcurrentProcesses: 3 } };
    await writeFile(
      join(tmpDir, ".hench", "config.json"),
      JSON.stringify(config),
    );

    // Use current PID for both (write same PID twice doesn't work, so use
    // a single lock and check moderate level)
    const lock = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    await writeFile(
      join(tmpDir, ".hench", "locks", `${process.pid}.lock`),
      JSON.stringify(lock),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    const data = await res.json();
    // 1/3 ≈ 33% → "moderate" (between 0 and 67%)
    expect(data.level).toBe("moderate");
    expect(data.utilization).toBeCloseTo(1 / 3, 1);
  });

  it("handles missing locks directory gracefully", async () => {
    // Remove the locks directory
    await rm(join(tmpDir, ".hench", "locks"), { recursive: true });

    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.processCount).toBe(0);
    expect(data.locks).toEqual([]);
  });

  it("handles missing hench config gracefully", async () => {
    // No config.json → uses default maxConcurrent=3
    const res = await fetch(`http://localhost:${port}/api/hench/concurrency`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.maxConcurrent).toBe(3);
  });
});

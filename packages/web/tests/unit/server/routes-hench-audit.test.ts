import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
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

describe("GET /api/hench/audit", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-audit-"));
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    await mkdir(runsDir, { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".n-dx/sourcevision"),
      rexDir: join(tmpDir, ".n-dx/rex"),
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty entries when no running tasks", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
    expect(data.systemInfo).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });

  it("includes system resource info", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    const info = data.systemInfo;
    expect(typeof info.serverPid).toBe("number");
    expect(info.serverPid).toBeGreaterThan(0);
    expect(typeof info.serverUptime).toBe("number");
    expect(info.serverUptime).toBeGreaterThanOrEqual(0);
    expect(typeof info.memoryUsage.heapUsed).toBe("number");
    expect(typeof info.memoryUsage.heapTotal).toBe("number");
    expect(typeof info.memoryUsage.rss).toBe("number");
    expect(typeof info.activeExecutions).toBe("number");
  });

  it("includes disk-based running runs in audit entries", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "run-audit-1",
      taskId: "task-1",
      taskTitle: "Running Task",
      startedAt: new Date().toISOString(),
      status: "running",
      lastActivityAt: new Date().toISOString(),
      turns: 5,
      tokenUsage: { input: 1000, output: 500 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-audit-1.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);

    const entry = data.entries[0];
    expect(entry.taskId).toBe("task-1");
    expect(entry.taskTitle).toBe("Running Task");
    expect(entry.runId).toBe("run-audit-1");
    expect(entry.pid).toBeNull(); // disk-based runs don't have PIDs
    expect(entry.status).toBe("running");
    expect(entry.source).toBe("disk");
    expect(entry.stale).toBe(false);
    expect(typeof entry.elapsedMs).toBe("number");
    expect(entry.turns).toBe(5);
    expect(entry.model).toBe("sonnet");
    expect(entry.tokenUsage).toEqual({ input: 1000, output: 500 });
  });

  it("flags stale disk-based running runs", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "run-stale",
      taskId: "task-stale",
      taskTitle: "Stale Task",
      startedAt: new Date(Date.now() - 600000).toISOString(),
      status: "running",
      lastActivityAt: new Date(Date.now() - 600000).toISOString(),
      turns: 10,
      tokenUsage: { input: 2000, output: 1000 },
      toolCalls: [],
      model: "opus",
    };
    await writeFile(join(runsDir, "run-stale.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].stale).toBe(true);
  });

  it("ignores completed runs", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "run-done",
      taskId: "task-done",
      taskTitle: "Done Task",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 15,
      tokenUsage: { input: 5000, output: 2000 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-done.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/audit`);
    const data = await res.json();
    expect(data.entries).toEqual([]);
  });
});

describe("POST /api/hench/execute/:taskId/terminate", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-terminate-"));
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    await mkdir(runsDir, { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".n-dx/sourcevision"),
      rexDir: join(tmpDir, ".n-dx/rex"),
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 404 when no active execution found", async () => {
    const res = await fetch(
      `http://localhost:${port}/api/hench/execute/nonexistent/terminate`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("No active execution found");
  });

  it("marks disk-based running run as terminated", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "run-term",
      taskId: "task-term",
      taskTitle: "Terminable Task",
      startedAt: new Date().toISOString(),
      status: "running",
      lastActivityAt: new Date().toISOString(),
      turns: 3,
      tokenUsage: { input: 500, output: 200 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-term.json"), JSON.stringify(run));

    const res = await fetch(
      `http://localhost:${port}/api/hench/execute/task-term/terminate`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.taskId).toBe("task-term");
    expect(data.terminated).toBe(true);
    expect(data.method).toBe("disk-mark");

    // Verify file updated on disk
    const updated = JSON.parse(
      await readFile(join(runsDir, "run-term.json"), "utf-8"),
    );
    expect(updated.status).toBe("failed");
    expect(updated.error).toContain("Terminated via audit interface");
    expect(updated.finishedAt).toBeTruthy();
  });

  it("returns 404 if no running run matches the taskId on disk", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    // Create a completed run — should not be terminable
    const run = {
      id: "run-completed",
      taskId: "task-completed",
      taskTitle: "Completed Task",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 10,
      tokenUsage: { input: 2000, output: 1000 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-completed.json"), JSON.stringify(run));

    const res = await fetch(
      `http://localhost:${port}/api/hench/execute/task-completed/terminate`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });
});

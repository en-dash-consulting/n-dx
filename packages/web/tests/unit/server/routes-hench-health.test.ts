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

describe("Hench runs health endpoint", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-health-"));
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

  it("returns empty health when no runs exist", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/runs/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.activeRuns).toBe(0);
    expect(data.staleRuns).toBe(0);
    expect(data.runs).toEqual([]);
  });

  it("detects stale running run", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "run-1",
      taskId: "t1",
      taskTitle: "Task 1",
      startedAt: new Date(Date.now() - 600000).toISOString(),
      status: "running",
      lastActivityAt: new Date(Date.now() - 600000).toISOString(),
      turns: 3,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-1.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs/health`);
    const data = await res.json();
    expect(data.activeRuns).toBe(1);
    expect(data.staleRuns).toBe(1);
    expect(data.runs[0].stale).toBe(true);
  });

  it("does not flag fresh running run as stale", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "run-2",
      taskId: "t2",
      taskTitle: "Task 2",
      startedAt: new Date().toISOString(),
      status: "running",
      lastActivityAt: new Date().toISOString(),
      turns: 1,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-2.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs/health`);
    const data = await res.json();
    expect(data.activeRuns).toBe(1);
    expect(data.staleRuns).toBe(0);
    expect(data.runs[0].stale).toBe(false);
  });

  it("ignores completed runs in health check", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "run-3",
      taskId: "t3",
      taskTitle: "Task 3",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 10,
      tokenUsage: { input: 1000, output: 500 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-3.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs/health`);
    const data = await res.json();
    expect(data.activeRuns).toBe(0);
    expect(data.runs).toEqual([]);
  });

  it("treats legacy running run without lastActivityAt as stale", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "run-4",
      taskId: "t4",
      taskTitle: "Legacy Task",
      startedAt: new Date(Date.now() - 600000).toISOString(),
      status: "running",
      turns: 5,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "run-4.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs/health`);
    const data = await res.json();
    expect(data.staleRuns).toBe(1);
    expect(data.runs[0].stale).toBe(true);
    expect(data.runs[0].lastActivityAt).toBeUndefined();
  });
});

describe("Hench mark-stuck endpoint", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-stuck-"));
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

  it("marks a running run as failed", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "stuck-1",
      taskId: "t1",
      taskTitle: "Stuck Task",
      startedAt: new Date().toISOString(),
      status: "running",
      turns: 5,
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "stuck-1.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs/stuck-1/mark-stuck`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("failed");

    // Verify file was updated on disk
    const updated = JSON.parse(await readFile(join(runsDir, "stuck-1.json"), "utf-8"));
    expect(updated.status).toBe("failed");
    expect(updated.finishedAt).toBeTruthy();
    expect(updated.error).toContain("stuck");
  });

  it("rejects marking a completed run as stuck", async () => {
    const runsDir = join(tmpDir, ".n-dx/hench", "runs");
    const run = {
      id: "done-1",
      taskId: "t1",
      taskTitle: "Done Task",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 10,
      tokenUsage: { input: 1000, output: 500 },
      toolCalls: [],
      model: "sonnet",
    };
    await writeFile(join(runsDir, "done-1.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs/done-1/mark-stuck`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("returns 404 for nonexistent run", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/runs/nonexistent/mark-stuck`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

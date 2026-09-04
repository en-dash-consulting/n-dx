import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, resetHenchRouteStateForTests, shutdownActiveExecutions } from "../../../src/server/routes-hench.js";
import {
  startRouteTestServer,
  closeRouteTestServer,
  removeTestDir,
} from "../../helpers/server-route-test-support.js";

/** Minimal PRD document for testing. */
function makePRD(items: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return {
    schema: "rex/v1",
    title: "Test PRD",
    items,
  };
}

/** Start a test server that routes through handleHenchRoute. */
function startTestServer(
  ctx: ServerContext,
  broadcast?: (data: unknown) => void,
): Promise<{ server: Server; port: number }> {
  return startRouteTestServer((req, res) => Promise.resolve(handleHenchRoute(req, res, ctx, broadcast)));
}

describe("POST /api/hench/execute", () => {
  let tmpDir: string;
  let rexDir: string;
  let henchDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-api-"));
    rexDir = join(tmpDir, ".rex");
    henchDir = join(tmpDir, ".hench");
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchDir, { recursive: true });
    await mkdir(join(henchDir, "runs"), { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir,
      dev: false,
    };

    const result = await startTestServer(ctx);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    // Await the close before removing the directory: on Windows the still-open
    // server handle is what makes the removal fail, so the order matters.
    await closeRouteTestServer(server);
    // Terminate any spawned hench processes before removing tmpDir.
    // On Windows, an active child process holds a CWD lock causing EBUSY.
    await shutdownActiveExecutions(500).catch(() => {});
    await removeTestDir(tmpDir);
  });

  it("rejects request without taskId", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("taskId is required");
  });

  it("rejects invalid JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Invalid JSON");
  });

  it("returns 404 when PRD not found", async () => {
    // No PRD file exists
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "nonexistent" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("PRD not found");
  });

  it("returns 404 when task not found in PRD", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Task One", status: "pending", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "nonexistent-id" }),
    });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toContain("not found in PRD");
  });

  it("rejects completed task with 409", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Done Task", status: "completed", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("completed");
    expect(body.error).toContain("cannot be executed");
  });

  it("rejects in_progress task with 409", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Active Task", status: "in_progress", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("in_progress");
  });

  it("accepts deferred task and returns 202", async () => {
    // Deferred tasks are executable: the route passes --reset-deferred to hench
    // so the task is reset to pending before the run starts.
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Deferred Task", status: "deferred", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.taskId).toBe("task-1");
    expect(body.status).toBe("started");
  });

  it("finds nested tasks in PRD tree", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        {
          id: "epic-1",
          title: "Epic",
          status: "pending",
          level: "epic",
          children: [
            {
              id: "feature-1",
              title: "Feature",
              status: "pending",
              level: "feature",
              children: [
                { id: "task-deep", title: "Deep Task", status: "completed", level: "task" },
              ],
            },
          ],
        },
      ]), null, 2),
    );

    // Task should be found but rejected because it's completed
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-deep" }),
    });
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.error).toContain("completed");
  });

  it("accepts pending task and returns 202", async () => {
    // This test will attempt to spawn hench which won't exist in the test env,
    // but the endpoint should still return 202 because spawning is async.
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Pending Task", status: "pending", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.runId).toBeDefined();
    expect(body.taskId).toBe("task-1");
    expect(body.taskTitle).toBe("Pending Task");
    expect(body.status).toBe("started");
  });

  it("accepts blocked task and returns 202", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-blocked", title: "Blocked Task", status: "blocked", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-blocked" }),
    });
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body.taskId).toBe("task-blocked");
    expect(body.status).toBe("started");
  });
});

describe("GET /api/hench/execute/status", () => {
  let tmpDir: string;
  let rexDir: string;
  let henchDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    tmpDir = await mkdtemp(join(tmpdir(), "hench-exec-status-"));
    rexDir = join(tmpDir, ".rex");
    henchDir = join(tmpDir, ".hench");
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchDir, { recursive: true });
    await mkdir(join(henchDir, "runs"), { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir,
      dev: false,
    };

    const result = await startTestServer(ctx);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    // Await the close before removing the directory: on Windows the still-open
    // server handle is what makes the removal fail, so the order matters.
    await closeRouteTestServer(server);
    await removeTestDir(tmpDir);
  });

  it("returns null execution for unknown task", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute/status/unknown-task`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.execution).toBeNull();
  });

  it("returns 200 for status list endpoint", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute/status`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(Array.isArray(body.executions)).toBe(true);
  });
});

describe("broadcast on execute", () => {
  let tmpDir: string;
  let rexDir: string;
  let henchDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let broadcastMessages: unknown[];
  let broadcastFn: (data: unknown) => void;

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    tmpDir = await mkdtemp(join(tmpdir(), "hench-exec-broadcast-"));
    rexDir = join(tmpDir, ".rex");
    henchDir = join(tmpDir, ".hench");
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchDir, { recursive: true });
    await mkdir(join(henchDir, "runs"), { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir,
      dev: false,
    };

    broadcastMessages = [];
    broadcastFn = vi.fn((data: unknown) => {
      broadcastMessages.push(data);
    });

    const result = await startTestServer(ctx, broadcastFn);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    // Await the close before removing the directory: on Windows the still-open
    // server handle is what makes the removal fail, so the order matters.
    await closeRouteTestServer(server);
    // Same reason as the sibling describe block above: a still-running spawned
    // child holds a CWD lock on tmpDir and removal fails with EBUSY on Windows.
    // This block spawns too, so it needs the same teardown.
    await shutdownActiveExecutions(500).catch(() => {});
    await removeTestDir(tmpDir);
  });

  it("broadcasts execution progress events when task is triggered", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-bc", title: "Broadcast Task", status: "pending", level: "task" },
      ]), null, 2),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-bc" }),
    });
    expect(res.status).toBe(202);

    // Wait for the spawn to REACH a terminal state rather than sleeping a fixed
    // interval. There is no hench binary in the test environment so the run
    // fails fast, but "fast" is not bounded: under full-suite parallel load on
    // Windows the spawn, its failure, and the broadcast together exceeded the
    // 200ms this used to sleep, and the last recorded state was still
    // "starting" when the assertions ran. Poll for the work instead of guessing
    // the wall clock (TESTING.md, flake family 3).
    await vi.waitFor(() => {
      expect(broadcastMessages.length).toBeGreaterThan(0);
      const last = (broadcastMessages.at(-1) as Record<string, unknown>).state as Record<string, unknown>;
      expect(["completed", "failed"]).toContain(last.status);
    }, { timeout: 5_000 });

    expect(broadcastFn).toHaveBeenCalled();

    // All broadcasts should be of type hench:task-execution-progress
    for (const msg of broadcastMessages) {
      const m = msg as Record<string, unknown>;
      expect(m.type).toBe("hench:task-execution-progress");
      expect(m.timestamp).toBeDefined();
      const state = m.state as Record<string, unknown>;
      expect(state.taskId).toBe("task-bc");
      expect(state.taskTitle).toBe("Broadcast Task");
      expect(state.runId).toBeDefined();
      expect(state.startedAt).toBeDefined();
    }

    // First broadcast should be "starting", last should be terminal
    const firstState = (broadcastMessages[0] as Record<string, unknown>).state as Record<string, unknown>;
    expect(firstState.status).toBe("starting");

    const lastState = (broadcastMessages[broadcastMessages.length - 1] as Record<string, unknown>).state as Record<string, unknown>;
    expect(["completed", "failed"]).toContain(lastState.status);
    expect(lastState.finishedAt).toBeDefined();
  });
});

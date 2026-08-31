/**
 * Regression coverage for "Start Working" (POST /api/hench/execute)
 * incorrectly reporting a failed task run as "completed".
 *
 * `hench run --auto` (spawned by `ndx work`, which this route triggers) only
 * ever throws for truly unexpected errors — a task run that ends in
 * failed/timeout/budget_exceeded status is a *graceful* stop: it logs
 * "Stopping after N iteration(s) due to X status." to stdout (via `info()`,
 * never stderr) and returns normally, so the process used to exit 0 either
 * way. `handleExecute` treated `exitCode === 0` as the sole success signal,
 * so a failed task run showed up in the dashboard as "completed" with no
 * indication anything went wrong — confirmed live. The fix is two-sided:
 * hench's `run.ts` now sets `process.exitCode = 1` on that path, and this
 * route falls back to the last stdout line for the error message (since
 * stderr is empty for this failure mode) and logs the full detail to
 * `.rex/execution-log.jsonl` so "View details" (the dashboard's Activity
 * link) has something real to show.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

const { spawnManagedMock } = vi.hoisted(() => ({ spawnManagedMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, spawnManaged: spawnManagedMock };
});

import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, resetHenchRouteStateForTests, shutdownActiveExecutions } from "../../../src/server/routes-hench.js";
import { startRouteTestServer, closeRouteTestServer, removeTestDir } from "../../helpers/server-route-test-support.js";

/** Resolve spawnManaged's `done` promise once the caller triggers it. */
function stubManagedRun(result: { exitCode: number | null; stdout: string; stderr: string }) {
  spawnManagedMock.mockImplementation(() => ({
    done: Promise.resolve(result),
    kill: vi.fn(() => true),
    pid: 4242,
  }));
}

describe("POST /api/hench/execute — failure detection beyond exit code", () => {
  let tmpDir: string;
  let rexDir: string;
  let henchDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    spawnManagedMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "hench-execute-failure-"));
    rexDir = join(tmpDir, ".rex");
    henchDir = join(tmpDir, ".hench");
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchDir, { recursive: true });
    await mkdir(join(henchDir, "runs"), { recursive: true });
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Test PRD",
        items: [{ id: "task-1", title: "Add dark mode toggle", status: "pending", level: "task" }],
      }),
    );

    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    const started = await startRouteTestServer((req, res) =>
      Promise.resolve(handleHenchRoute(req, res, ctx)),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await shutdownActiveExecutions(500).catch(() => {});
    await removeTestDir(tmpDir);
  });

  /** Poll GET /api/hench/execute/status until the task reaches a terminal state. */
  async function waitForTerminal(taskId: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute/status`);
      const body = (await res.json()) as { executions: Array<Record<string, unknown>> };
      const entry = body.executions.find((e) => e.taskId === taskId);
      if (!entry) {
        // Already removed from the active map — read the last broadcast
        // instead isn't available here, so this path only matters if the
        // test didn't await long enough; fall through to retry.
      } else if (entry.status === "completed" || entry.status === "failed") {
        return entry;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("execution did not reach a terminal state");
  }

  it("reports failed when exitCode is non-zero, using the last stdout line as the error", async () => {
    stubManagedRun({
      exitCode: 1,
      stdout: "Starting task...\nStopping after 1 iteration(s) due to failed status.",
      stderr: "",
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(202);

    // The broadcast is fire-and-forget from the response's perspective, so
    // read the final state directly rather than racing the status poll.
    await new Promise((r) => setTimeout(r, 50));
    const statusRes = await fetch(`http://127.0.0.1:${port}/api/hench/execute/status`);
    const statusBody = (await statusRes.json()) as { executions: Array<Record<string, unknown>> };
    // The execution is removed from the active map immediately on
    // completion, so assert via the execution-log side effect instead —
    // see the log assertion below, which is the durable record.
    expect(statusBody.executions.find((e) => e.taskId === "task-1")).toBeUndefined();

    const log = await readFile(join(rexDir, "execution-log.jsonl"), "utf-8");
    const entries = log.trim().split("\n").map((l) => JSON.parse(l));
    const failureEntry = entries.find((e) => e.event === "task_execution_failed");
    expect(failureEntry).toBeDefined();
    expect(failureEntry.itemId).toBe("task-1");
    expect(failureEntry.detail).toContain("Add dark mode toggle");
    expect(failureEntry.detail).toContain("Stopping after 1 iteration(s) due to failed status.");
  });

  it("still reports completed when exitCode is 0", async () => {
    stubManagedRun({ exitCode: 0, stdout: "Task completed successfully.", stderr: "" });

    await fetch(`http://127.0.0.1:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });

    await new Promise((r) => setTimeout(r, 50));
    const log = await readFile(join(rexDir, "execution-log.jsonl"), "utf-8").catch(() => "");
    expect(log).not.toContain("task_execution_failed");
  });
});

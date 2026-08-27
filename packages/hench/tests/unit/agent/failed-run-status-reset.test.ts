/**
 * A failed run must not leave the PRD claiming the task succeeded.
 *
 * `resetInProgressTaskIfFailed` is the net that returns a task to pending when
 * a run ends in a failure status. It used to fire only when the item was still
 * `in_progress`, which left a real hole: the spawned agent can mark the task
 * `completed` itself, mid-run, before hench's gates run. If the run then failed,
 * the item's status was `completed` rather than `in_progress`, the guard
 * returned early, and the PRD permanently recorded a failed task as done —
 * with `get_next_task` never offering it again.
 *
 * Run 60c3a951 showed the executor doing exactly that self-marking, around turn
 * 48, well before the full test suite gate. The exposure window is the whole
 * remainder of the run, including the adversarial review pass.
 *
 * Statuses that represent a deliberate parking decision — blocked, deferred,
 * failing, cancelled — must survive untouched: specific failure handlers set
 * them, and the executor prompt tells the agent to use blocked for an external
 * dependency and deferred for postponement.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ensureHenchDir, initConfig } from "../../../src/store/config.js";

/** A run record shaped enough for finalizeRun's failure path. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runRecord(status: string): any {
  return {
    id: "run-1",
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    turns: 1,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "claude-sonnet-4-6",
  };
}

describe("failed run does not leave the PRD claiming success", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-status-reset-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await ensureHenchDir(henchDir);

    rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Test",
        items: [
          { id: "task-1", title: "Test task", status: "pending", level: "task", priority: "high" },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  /**
   * Put the task in `startStatus`, finalize a run with `runStatus`, return the
   * resulting status.
   *
   * `skipFullTestGate` matters only for a succeeding run: finalizeRun runs the
   * full test suite gate when `run.status === "completed"`, and a bare temp
   * fixture has no resolvable test command, so resolution throws and the run is
   * legitimately re-marked failed (shared.ts:1991). That would make a
   * "succeeded" case indistinguishable from a failed one. Failure cases never
   * reach the gate, so they do not need it.
   */
  async function finalizeWith(
    startStatus: string,
    runStatus: string,
    skipFullTestGate = false,
  ): Promise<string> {
    const { finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const store = createStore("file", rexDir);

    await store.updateItem("task-1", { status: startStatus });

    await finalizeRun({
      run: runRecord(runStatus),
      henchDir,
      projectDir,
      store,
      rollbackOnFailure: false,
      yes: true,
      skipFullTestGate,
    });

    const item = await store.getItem("task-1");
    return item.status as string;
  }

  // ── The bug ───────────────────────────────────────────────────────────────

  it("resets a task the agent marked completed when the run failed", async () => {
    expect(await finalizeWith("completed", "failed")).toBe("pending");
  });

  it("resets an agent-completed task on a timeout, not just on 'failed'", async () => {
    expect(await finalizeWith("completed", "timeout")).toBe("pending");
  });

  it("resets an agent-completed task when the token budget was exceeded", async () => {
    expect(await finalizeWith("completed", "budget_exceeded")).toBe("pending");
  });

  // ── Existing behaviour must not change ────────────────────────────────────

  it("still resets an in_progress task on failure", async () => {
    expect(await finalizeWith("in_progress", "failed")).toBe("pending");
  });

  it("leaves the task completed when the run succeeded", async () => {
    expect(await finalizeWith("completed", "completed", true)).toBe("completed");
  });

  it("does still reset when a 'completed' run fails its own test gate", async () => {
    // The gate re-marks the run failed when it cannot even resolve a test
    // command, and a run that failed its gate must not leave the task claiming
    // success — the same rule, arrived at from the run side rather than the
    // agent side. Runs without skipFullTestGate so the gate actually fires.
    expect(await finalizeWith("completed", "completed")).toBe("pending");
  });

  // ── Deliberate parking decisions survive ──────────────────────────────────

  it("does not clobber a blocked task", async () => {
    expect(await finalizeWith("blocked", "failed")).toBe("blocked");
  });

  it("does not clobber a deferred task", async () => {
    expect(await finalizeWith("deferred", "failed")).toBe("deferred");
  });
});

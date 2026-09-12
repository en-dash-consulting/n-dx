import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo } from "../helpers/index.js";

const execAsync = promisify(execCb);

/**
 * The missing-review gate, end to end through finalizeRun.
 *
 * The defect these cover: `ndx work --review --review-model=<x>` where the
 * installed vendor CLI rejects `<x>` with a 400. The reviewer spawn failed
 * before it read a line of the diff, the run recorded
 * `review: { failed: "spawn-failed" }` — and then reported `completed`,
 * committed, and said nothing. An opt-in gate that silently no-ops is
 * indistinguishable from a reviewer that attacked the change and found
 * nothing, which is the one conclusion the operator must not draw.
 */
describe("finalizeRun — missing-review gate", () => {
  const taskId = "task-abc-123";
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  let statuses: string[];

  function buildCompletedRun(review: RunRecord["review"]): RunRecord {
    return {
      id: randomUUID(),
      taskId,
      taskTitle: "Test task",
      startedAt: new Date().toISOString(),
      status: "completed",
      turns: 3,
      tokenUsage: { input: 100, output: 50 },
      turnTokenUsage: [],
      toolCalls: [],
      model: "test-model",
      review,
    };
  }

  /** The record `reportReviewFailure` writes when the reviewer never started. */
  function spawnFailedReview(): RunRecord["review"] {
    return {
      failed: "spawn-failed",
      detail:
        "API Error: 400 model 'claude-fable-5-1' requires Claude Code version 2.1.251 or newer",
    };
  }

  /** A reviewer that ran, attacked the change, and found nothing. */
  function cleanReview(): RunRecord["review"] {
    return {
      model: "claude-opus-5",
      resumedSession: true,
      findingCount: 0,
      unresolvedCount: 0,
      unrepairedMustFixCount: 0,
      failedActionCount: 0,
      fixesApplied: false,
      reportPath: join(henchDir, "reviews", "report.json"),
      repairedFiles: [],
    };
  }

  function buildStore() {
    let status = "in_progress";
    return {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status, title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id !== taskId || typeof updates.status !== "string") return;
        const next = updates.status;
        statuses.push(next);
        const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
        await writeFile(taskIndexPath, current.replace(`status: ${status}`, `status: ${next}`), "utf-8");
        status = next;
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };
  }

  async function runFinalize(
    run: RunRecord,
    store: ReturnType<typeof buildStore>,
    reviewOptional = false,
    // autoCommit: the executor committed its own work before the review pass
    // ran, which is the shape the defect was observed in. The rollback test
    // below passes false to reach the commit-prompt path, where the work is
    // still uncommitted when the gate fires.
    autoCommit = true,
  ): Promise<void> {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit,
      skipFullTestGate: true,
      autonomous: true,
      store,
      reviewOptional,
    });
  }

  beforeEach(async () => {
    statuses = [];
    projectDir = await mkdtemp(join(tmpdir(), "hench-missing-review-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    const taskDir = join(projectDir, ".rex", PRD_TREE_DIRNAME, "task-slug-abc");
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Test task\nstatus: in_progress\n", "utf-8");

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    // The task's own work, committed by the executor before the review pass —
    // so the uncommitted-work gate has nothing to say and any refusal in these
    // tests comes from the review gate alone.
    await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "feat: the work"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("refuses the completion when the reviewer never spawned, and names the missing review", async () => {
    const run = buildCompletedRun(spawnFailedReview());
    await runFinalize(run, buildStore());

    expect(run.status).toBe("failed");
    expect(run.error).toContain("adversarial review never ran");
    expect(run.error).toContain("spawn-failed");
    // The vendor's own diagnosis is the operator's fix — losing it would leave
    // them with a refusal and no way to act on it.
    expect(run.error).toContain("2.1.251");
    expect(statuses).not.toContain("completed");
  });

  it("marks the refusal on the run so it is not read as a task failure", async () => {
    const run = buildCompletedRun(spawnFailedReview());
    await runFinalize(run, buildStore());

    expect(run.review).toMatchObject({ failed: "spawn-failed", gated: true });
  });

  it("never reaches the rollback path, so uncommitted work is not offered up for deletion", async () => {
    // The commit-prompt path: the agent's work is still in the working tree
    // when the gate fires. Without the suppression this run is `failed` with a
    // dirty tree, which is exactly the shape performRollbackIfNeeded acts on —
    // and on an interactive terminal it would offer to revert the very work
    // the reviewer was supposed to read.
    //
    // Asserted through the rollback path's own output rather than by faking a
    // TTY: the message below is printed only once performRollbackIfNeeded has
    // been called *and* found dirty paths, so its absence proves the guard
    // short-circuited before the call. Faking a TTY would make the
    // unsuppressed case block on a readline prompt instead of failing.
    await writeFile(join(projectDir, "uncommitted.ts"), "export const b = 2;\n", "utf-8");

    const run = buildCompletedRun(spawnFailedReview());
    await runFinalize(run, buildStore(), false, false);

    const printed = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((args) => args.join(" "))
      .join("\n");

    expect(run.status).toBe("failed");
    expect(printed).not.toContain("a rollback only runs after an interactive confirmation");
    expect(existsSync(join(projectDir, "uncommitted.ts"))).toBe(true);
  });

  it("returns the task to pending, not deferred", async () => {
    const run = buildCompletedRun(spawnFailedReview());
    await runFinalize(run, buildStore());

    // A config error the operator can fix and retry — not a task to push out
    // of the queue.
    expect(statuses).toContain("pending");
    expect(statuses).not.toContain("deferred");
  });

  it("withdraws a completion the agent already wrote to the PRD itself", async () => {
    const store = buildStore();
    await store.updateItem(taskId, { status: "completed" });
    await execAsync("git add .rex", { cwd: projectDir });
    await execAsync('git commit -m "chore(prd): agent status write"', { cwd: projectDir });
    statuses.length = 0;

    const run = buildCompletedRun(spawnFailedReview());
    await runFinalize(run, store);

    expect(run.status).toBe("failed");
    expect(statuses).toEqual(["pending"]);
  });

  it("does not touch a run whose reviewer ran and found nothing", async () => {
    const run = buildCompletedRun(cleanReview());
    await runFinalize(run, buildStore());

    expect(run.status).toBe("completed");
    expect(statuses).toEqual(["completed"]);
  });

  it("does not refuse when the reviewer ran but lost its report", async () => {
    // The change *was* attacked; only the transport broke. That stays a
    // warning, as the module contract has always said.
    const run = buildCompletedRun({ failed: "no-report", detail: "report file absent" });
    await runFinalize(run, buildStore());

    expect(run.status).toBe("completed");
    expect(statuses).toEqual(["completed"]);
  });

  it("does not refuse when --review was never passed", async () => {
    const run = buildCompletedRun(undefined);
    await runFinalize(run, buildStore());

    expect(run.status).toBe("completed");
    expect(statuses).toEqual(["completed"]);
  });

  it("downgrades the refusal to a warning under --review-optional", async () => {
    const run = buildCompletedRun(spawnFailedReview());
    await runFinalize(run, buildStore(), true);

    expect(run.status).toBe("completed");
    expect(statuses).toEqual(["completed"]);
    // Still recorded, so `ndx show` and the summary line can still say the run
    // was never reviewed.
    expect(run.review).toMatchObject({ failed: "spawn-failed" });
    expect((run.review as { gated?: boolean }).gated).toBeUndefined();
  });
});

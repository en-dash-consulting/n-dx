import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import { finalizeRun, quarantinePendingCommitMessage } from "../../src/agent/lifecycle/shared.js";
import { startCommitMsgWatcher } from "../../src/agent/lifecycle/commit-msg-watcher.js";
import type { RunRecord } from "../../src/schema/index.js";
import { initGitFixtureRepo } from "../helpers/index.js";

const execAsync = promisify(execCb);
const SENTINEL = ".hench-commit-msg.txt";

/**
 * A run that ends without committing must not leave its proposed commit
 * message where the next run will find it.
 *
 * The agent stages its work and writes the sentinel; anything that flips the
 * run to failed afterwards makes the commit prompt return at its
 * `status !== "completed"` guard and leave the file. The next run's watcher
 * arms on *detecting* the file rather than on a write during that run, so it
 * commits whatever is staged under the previous task's message — trailers,
 * item permalink and all. Two runs in sequence is exactly what `--loop` does.
 */

describe("stale .hench-commit-msg.txt quarantine", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-stale-msg-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await initGitFixtureRepo(projectDir);
    await writeFile(join(projectDir, "app.js"), "// initial\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
    return {
      id: randomUUID(),
      taskId: "task-a",
      taskTitle: "Task A",
      startedAt: new Date().toISOString(),
      status: "failed",
      turns: 1,
      tokenUsage: { input: 10, output: 5 },
      toolCalls: [],
      model: "test-model",
      ...overrides,
    };
  }

  /** Stage some work and leave a proposed message, as the agent does. */
  async function stageWorkWithMessage(message: string): Promise<void> {
    await writeFile(join(projectDir, "app.js"), "// task A's work\n", "utf-8");
    await execAsync("git add -A", { cwd: projectDir });
    await writeFile(join(projectDir, SENTINEL), message, "utf-8");
  }

  async function headSubject(): Promise<string> {
    const { stdout } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
    return stdout.trim();
  }

  // ── The helper on its own ────────────────────────────────────────────

  describe("quarantinePendingCommitMessage", () => {
    it("moves a populated sentinel beside the run that wrote it", async () => {
      await writeFile(join(projectDir, SENTINEL), "feat: task A\n\nN-DX-Status: task-a\n", "utf-8");

      const rescued = quarantinePendingCommitMessage(projectDir, henchDir, "run-1");
      expect(rescued).toBe(join(henchDir, "runs", "run-1.commit-msg.txt"));
      expect(existsSync(join(projectDir, SENTINEL))).toBe(false);
      expect(await readFile(rescued!, "utf-8")).toContain("N-DX-Status: task-a");
    });

    it("removes an empty sentinel instead — there is nothing to rescue", async () => {
      await writeFile(join(projectDir, SENTINEL), "   \n\n", "utf-8");

      expect(quarantinePendingCommitMessage(projectDir, henchDir, "run-2")).toBeNull();
      expect(existsSync(join(projectDir, SENTINEL))).toBe(false);
      expect(existsSync(join(henchDir, "runs", "run-2.commit-msg.txt"))).toBe(false);
    });

    it("does nothing when there is no sentinel", () => {
      expect(quarantinePendingCommitMessage(projectDir, henchDir, "run-3")).toBeNull();
    });

    it("keeps the rescued file out of the run list — it is not a run record", async () => {
      await writeFile(join(projectDir, SENTINEL), "feat: task A\n", "utf-8");
      quarantinePendingCommitMessage(projectDir, henchDir, "run-4");

      const { listRuns } = await import("../../src/store/runs.js");
      expect(await listRuns(henchDir)).toEqual([]);
      // But it is right there next to them, for the operator.
      expect(await readdir(join(henchDir, "runs"))).toContain("run-4.commit-msg.txt");
    });
  });

  // ── Through finalizeRun, and the watcher that used to act on it ──────

  it("a failed run leaves nothing the next run's watcher will commit", async () => {
    await stageWorkWithMessage("feat: task A\n\nN-DX-Status: task-a pending → completed\n");
    const run = makeRun({ status: "failed", error: "test gate failed" });

    await finalizeRun({
      run,
      henchDir,
      projectDir,
      config: { autoCommit: false } as never,
      rollbackOnFailure: false,
      autonomous: true,
      yes: true,
    } as never);

    // The message survived, attached to the run that proposed it.
    const rescued = join(henchDir, "runs", `${run.id}.commit-msg.txt`);
    expect(existsSync(join(projectDir, SENTINEL))).toBe(false);
    expect(await readFile(rescued, "utf-8")).toContain("N-DX-Status: task-a");

    // Now the next run's watcher: it arms on detection, so with the sentinel
    // gone it has nothing to arm on and commits nothing.
    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 30 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    watcher.cancel();

    expect(watcher.didAutoCommit()).toBe(false);
    expect(await headSubject()).toBe("initial");
  });

  it("without the quarantine, that watcher commits task A's message — the defect", async () => {
    // The same setup, minus finalizeRun: this is what the file left behind
    // does, and why it must not be left behind.
    await stageWorkWithMessage("feat: task A\n\nN-DX-Status: task-a pending → completed\n");

    const watcher = startCommitMsgWatcher({ projectDir, timeoutMs: 30 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    watcher.cancel();

    expect(watcher.didAutoCommit()).toBe(true);
    expect(await headSubject()).toBe("feat: task A");
  });

  it("leaves a completed run's sentinel alone — the commit prompt owns that file", async () => {
    // Every exit inside the commit prompt removes the sentinel itself,
    // including a declined prompt, so finalizeRun must not second-guess it.
    await writeFile(join(projectDir, SENTINEL), "feat: task A\n", "utf-8");
    const run = makeRun({ status: "completed" });

    const rescued = quarantinePendingCommitMessage(projectDir, henchDir, run.id);
    expect(rescued).not.toBeNull();
    // (The helper is unconditional; finalizeRun is what gates it on status.)
    expect(run.status).toBe("completed");
  });

  it("rescues the message on each of the routes that skip the commit prompt", async () => {
    for (const status of ["failed", "timeout", "budget_exceeded"] as const) {
      await stageWorkWithMessage(`feat: ${status}\n`);
      const run = makeRun({ status });

      await finalizeRun({
        run,
        henchDir,
        projectDir,
        config: { autoCommit: false } as never,
        rollbackOnFailure: false,
        autonomous: true,
        yes: true,
      } as never);

      expect(existsSync(join(projectDir, SENTINEL)), `${status} left the sentinel`).toBe(false);
      expect(await readFile(join(henchDir, "runs", `${run.id}.commit-msg.txt`), "utf-8"))
        .toContain(`feat: ${status}`);
    }
  });
});

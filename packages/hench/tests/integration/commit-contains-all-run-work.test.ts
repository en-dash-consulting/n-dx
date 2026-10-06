/**
 * The commit a completed task lands must contain everything the run changed,
 * and it must land after the task is marked complete.
 *
 * Reported from the dashboard's run-task button: files the agent had changed
 * were missing from the commit, and the task was recorded `completed`
 * regardless. Two causes, both covered here:
 *
 *   1. The commit only ever contained what the *agent* had staged. The prompt
 *      asks it to `git add -- <path...>` naming each path, and anything it
 *      forgot was simply absent. `stageRunWork` now stages the run's own work
 *      before the uncommitted-work gate looks at the tree.
 *   2. The mid-run auto-commit timer committed whatever was staged at expiry,
 *      ahead of the test gate, the uncommitted-work gate and the completion
 *      write — and then suppressed the real commit path. It is off by
 *      default now.
 *
 * These exercise `finalizeRun` itself rather than its parts, because the
 * property being asserted is an ordering across them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { RunRecord, HenchConfig } from "../../src/schema/index.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/index.js";
import {
  finalizeRun,
  captureBaselineDirty,
  captureStartingHead,
} from "../../src/agent/lifecycle/shared.js";
import { initGitFixtureRepo, RM_RETRY } from "../helpers/index.js";

const execAsync = promisify(execCb);

async function git(dir: string, cmd: string): Promise<string> {
  const { stdout } = await execAsync(`git ${cmd}`, { cwd: dir });
  return stdout.trim();
}

/** Files touched by HEAD. */
async function filesInHeadCommit(dir: string): Promise<string[]> {
  const out = await git(dir, "show --name-only --pretty=format: HEAD");
  return out.split("\n").map((l) => l.trim()).filter(Boolean).sort();
}

function completedRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 3,
    tokenUsage: { input: 100, output: 50 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
    vendor: "claude",
    weight: "standard",
    summary: "did the thing",
  };
}

describe("a completed task's commit contains all of the run's work", () => {
  let projectDir: string;
  let henchDir: string;
  let config: HenchConfig;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "commit-all-work-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(henchDir, { recursive: true });
    await initGitFixtureRepo(projectDir);

    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(join(projectDir, "src", "a.ts"), "export const a = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });

    config = { ...DEFAULT_HENCH_CONFIG(), autoCommit: false };

    // Autonomous: no approval prompt, which is what the dashboard runs.
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("includes files the agent changed but never staged", async () => {
    const baselineDirty = await captureBaselineDirty(projectDir);
    const startingHead = captureStartingHead(projectDir);

    // What the agent did: changed three files, staged one, wrote its message.
    await writeFile(join(projectDir, "src", "a.ts"), "export const a = 2;\n", "utf-8");
    await writeFile(join(projectDir, "src", "b.ts"), "export const b = 1;\n", "utf-8");
    await writeFile(join(projectDir, "src", "c.ts"), "export const c = 1;\n", "utf-8");
    await execAsync("git add src/a.ts", { cwd: projectDir });
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: add b and c\n", "utf-8");

    const run = completedRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      config,
      autonomous: true,
      yes: true,
      autoCommit: false,
      skipFullTestGate: true,
      baselineDirty,
      startingHead,
    });

    expect(run.status).toBe("completed");
    expect(await filesInHeadCommit(projectDir)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);

    // None of the run's work left behind. What remains dirty is hench's own
    // runtime state, which finalization itself creates (`.hench/`, and the
    // `.gitignore` it writes for it) and which is never the run's to commit.
    const leftover = (await git(projectDir, "status --porcelain"))
      .split("\n")
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    expect(leftover.filter((p) => p.startsWith("src/"))).toEqual([]);
    expect(leftover.every((p) => p === ".gitignore" || p.startsWith(".hench"))).toBe(true);
  });

  it("leaves the operator's pre-existing work out of the commit, and uncommitted", async () => {
    // The operator's work in progress, already dirty before the run.
    await writeFile(join(projectDir, "src", "a.ts"), "export const a = 99; // mine\n", "utf-8");
    await writeFile(join(projectDir, "notes.local"), "my notes\n", "utf-8");

    const baselineDirty = await captureBaselineDirty(projectDir);
    const startingHead = captureStartingHead(projectDir);
    expect(baselineDirty.sort()).toEqual(["notes.local", "src/a.ts"]);

    // The agent's own work, unstaged.
    await writeFile(join(projectDir, "src", "agent.ts"), "export const z = 1;\n", "utf-8");
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: agent work\n", "utf-8");

    const run = completedRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      config,
      autonomous: true,
      yes: true,
      autoCommit: false,
      skipFullTestGate: true,
      baselineDirty,
      startingHead,
    });

    // The gate is entitled to refuse here — the operator's files are dirty
    // and nothing in this run owns them. What must NOT happen either way is
    // the operator's work being swept into the task's commit.
    const status = await git(projectDir, "status --porcelain");
    expect(status).toContain("notes.local");

    if (run.status === "completed") {
      const committed = await filesInHeadCommit(projectDir);
      expect(committed).not.toContain("notes.local");
    }
  });

  it("does not commit the message sentinel itself", async () => {
    const baselineDirty = await captureBaselineDirty(projectDir);
    const startingHead = captureStartingHead(projectDir);

    await writeFile(join(projectDir, "src", "d.ts"), "export const d = 1;\n", "utf-8");
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: add d\n", "utf-8");

    const run = completedRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      config,
      autonomous: true,
      yes: true,
      autoCommit: false,
      skipFullTestGate: true,
      baselineDirty,
      startingHead,
    });

    expect(await filesInHeadCommit(projectDir)).not.toContain(".hench-commit-msg.txt");
  });

  it("stages nothing extra when no baseline was captured", async () => {
    // Without a baseline the run cannot tell its work from the operator's, so
    // it stages none of it and behaves exactly as it did before this change:
    // the commit carries only what the agent staged.
    const startingHead = captureStartingHead(projectDir);

    await writeFile(join(projectDir, "src", "staged.ts"), "export const s = 1;\n", "utf-8");
    await writeFile(join(projectDir, "src", "forgotten.ts"), "export const f = 1;\n", "utf-8");
    await execAsync("git add src/staged.ts", { cwd: projectDir });
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: staged only\n", "utf-8");

    const run = completedRun();
    await finalizeRun({
      run,
      henchDir,
      projectDir,
      config,
      autonomous: true,
      yes: true,
      autoCommit: false,
      skipFullTestGate: true,
      startingHead,
    });

    // The forgotten file is still uncommitted — and the gate caught it,
    // rather than the task being recorded complete over the top of it.
    expect(run.status).toBe("failed");
    expect(run.error ?? "").toContain("forgotten.ts");
  });
});

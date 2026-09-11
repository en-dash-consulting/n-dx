import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
 * The uncommitted-work gate, end to end through finalizeRun (#363).
 *
 * The defect these cover: a run finished, the agent's files were never
 * committed, and the only thing that landed was hench's own PRD-status commit
 * — so the task read `completed` while its work sat in the working tree.
 */
describe("finalizeRun — uncommitted-work gate", () => {
  const taskId = "task-abc-123";
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  let statuses: string[];

  function buildCompletedRun(): RunRecord {
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
    };
  }

  /** A store that mirrors status writes onto the tracked PRD file, as the real one does. */
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

  async function runFinalize(run: RunRecord, store: ReturnType<typeof buildStore>): Promise<void> {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      // The autoCommit path is where the defect was observed: the executor is
      // expected to have committed its own work already, so nothing downstream
      // picks up whatever it left behind.
      autoCommit: true,
      skipFullTestGate: true,
      autonomous: true,
      store,
    });
  }

  beforeEach(async () => {
    statuses = [];
    projectDir = await mkdtemp(join(tmpdir(), "hench-uncommitted-work-"));
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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("completes as before when the agent committed its work", async () => {
    await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "feat: the work"', { cwd: projectDir });

    const run = buildCompletedRun();
    await runFinalize(run, buildStore());

    expect(run.status).toBe("completed");
    expect(statuses).toEqual(["completed"]);
  });

  it("refuses to complete while the agent's files are uncommitted, and names them", async () => {
    // Exactly what was observed: a new test file and a stray scratch log, both
    // written by the agent and neither of them committed.
    await writeFile(join(projectDir, "git-origin.test.ts"), "// 18 passing tests\n", "utf-8");
    await writeFile(join(projectDir, "root-test-output.log"), "vitest output\n", "utf-8");

    const run = buildCompletedRun();
    await runFinalize(run, buildStore());

    expect(run.status).toBe("failed");
    expect(run.error).toContain("git-origin.test.ts");
    expect(run.error).toContain("root-test-output.log");
    expect(statuses).not.toContain("completed");
  });

  it("withdraws a completion the agent already wrote to the PRD itself", async () => {
    // The agent is told to call update_task_status before the run ends, so the
    // PRD can already read `completed` by the time the gate fires. Leaving it
    // there is the half of the defect where the status reports the opposite of
    // the truth.
    await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");
    const store = buildStore();
    await store.updateItem(taskId, { status: "completed" });
    await execAsync("git add .rex", { cwd: projectDir });
    await execAsync('git commit -m "chore(prd): agent status write"', { cwd: projectDir });
    statuses.length = 0;

    const run = buildCompletedRun();
    await runFinalize(run, store);

    expect(run.status).toBe("failed");
    expect(statuses).toEqual(["pending"]);
  });

  it("leaves the refused work in place — nothing is reverted", async () => {
    await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");

    const run = buildCompletedRun();
    await runFinalize(run, buildStore());

    const { stdout } = await execAsync("git status --porcelain", { cwd: projectDir });
    expect(stdout).toContain("leaked.ts");
  });

  it("completes when the only dirt is hench's own runtime artifacts", async () => {
    await mkdir(join(henchDir, "locks"), { recursive: true });
    await writeFile(join(henchDir, "locks", "1234.lock"), "pid\n", "utf-8");
    await writeFile(join(henchDir, "runs", "run-1.json"), "{}\n", "utf-8");

    const run = buildCompletedRun();
    await runFinalize(run, buildStore());

    expect(run.status).toBe("completed");
    expect(statuses).toEqual(["completed"]);
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { RunRecord } from "../../src/schema/index.js";
import { initGitFixtureRepo } from "../helpers/index.js";
import { initConfig } from "../../src/store/config.js";

const execAsync = promisify(execCb);

function completedRun(): RunRecord {
  return {
    id: randomUUID(),
    taskId: "task-1",
    taskTitle: "Test task",
    startedAt: new Date().toISOString(),
    status: "completed",
    turns: 1,
    tokenUsage: { input: 1, output: 1 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "test-model",
  };
}

async function failGitMutation(operation: "add" | "commit" | "diff", message: string): Promise<void> {
  vi.resetModules();
  vi.doMock("../../src/process/exec.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/process/exec.js")>();
    return {
      ...actual,
      exec: vi.fn(async (
        command: string,
        args: string[],
        options: Parameters<typeof actual.exec>[2],
      ): Promise<Awaited<ReturnType<typeof actual.exec>>> => {
        if (command === "git" && args[0] === operation) {
          return {
            stdout: "",
            stderr: message,
            exitCode: 1,
            error: new Error(`Command failed: git ${args.join(" ")}\n${message}`),
            launched: true,
          };
        }
        return actual.exec(command, args, options);
      }),
    };
  });
}

afterEach(() => {
  vi.doUnmock("../../src/process/exec.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("Git mutation failures in the Hench lifecycle", () => {
  it("stops before work starts when a pre-run commit is rejected", async () => {
    const { performPreRunCommitGateIfNeeded } = await import("../../src/agent/lifecycle/shared.js");

    const result = await performPreRunCommitGateIfNeeded({
      projectDir: "/project",
      henchDir: "/project/.hench",
      deps: {
        isTTY: true,
        listDirty: async () => [" M src.ts"],
        measureMagnitude: async () => ({ linesChanged: 1, filesChanged: 1 }),
        collectDiff: async () => ({ diff: "diff", stat: " src.ts | 1 +" }),
        proposeMessage: async () => "feat: staged work",
        promptChoice: async () => "commit",
        commit: async () => {
          throw new Error("pre-commit hook rejected this change");
        },
      },
    });

    expect(result).toBe("stop");
  });

  it("does not report review repairs staged when git add fails", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "hench-git-add-failure-"));
    try {
      await initGitFixtureRepo(projectDir);
      await writeFile(join(projectDir, "lib.ts"), "export const lib = 1;\n", "utf-8");
      await execAsync("git add lib.ts && git commit -m initial", { cwd: projectDir });
      await writeFile(join(projectDir, "src.ts"), "export const src = 1;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await writeFile(join(projectDir, "lib.ts"), "export const lib = 2;\n", "utf-8");
      await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: update source\n", "utf-8");

      await failGitMutation("add", "gpg: signing request rejected");
      const { performCommitPromptIfNeeded } = await import("../../src/agent/lifecycle/shared.js");
      const { getCapturedLines, resetCapturedLines } = await import("../../src/types/output.js");
      resetCapturedLines();

      const run = completedRun();
      run.review = {
        model: "reviewer",
        resumedSession: false,
        findingCount: 1,
        unresolvedCount: 0,
        unrepairedMustFixCount: 0,
        failedActionCount: 0,
        fixesApplied: true,
        repairedFiles: ["lib.ts"],
      };
      await performCommitPromptIfNeeded(run, projectDir, false, true, true);

      expect(run.status).toBe("failed");
      expect(run.error).toContain("gpg: signing request rejected");
      expect(getCapturedLines().join("\n")).toContain("could not stage review repairs");
      expect(getCapturedLines().join("\n")).not.toContain("Staged 1 review repair");
      const { stdout: log } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
      expect(log.trim()).toBe("initial");
      const { stdout: status } = await execAsync("git status --porcelain", { cwd: projectDir });
      expect(status).toContain("lib.ts");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("returns the failed reset-deferred commit and leaves the PRD write for the gate", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "hench-git-commit-failure-"));
    try {
      await initGitFixtureRepo(projectDir);
      const prdDir = join(projectDir, ".rex", "prd_tree", "task");
      await mkdir(prdDir, { recursive: true });
      const prdPath = join(prdDir, "index.md");
      await writeFile(prdPath, "status: deferred\n", "utf-8");
      await execAsync("git add . && git commit -m initial", { cwd: projectDir });
      await writeFile(prdPath, "status: pending\n", "utf-8");

      await failGitMutation("commit", "pre-commit hook rejected this change");
      const { commitResetDeferredChanges, performPreRunCommitGateIfNeeded } = await import(
        "../../src/agent/lifecycle/shared.js"
      );

      const result = await commitResetDeferredChanges(projectDir, 1);
      expect(result.error?.message).toContain("pre-commit hook rejected this change");
      expect(result.staged).toBe(1);
      const { stdout: log } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
      expect(log.trim()).toBe("initial");
      const { stdout: status } = await execAsync("git status --porcelain", { cwd: projectDir });
      expect(status).toContain(".rex/prd_tree/task/index.md");

      const gate = await performPreRunCommitGateIfNeeded({
        projectDir,
        henchDir: join(projectDir, ".hench"),
        autonomous: true,
        deps: { isTTY: false },
      });
      expect(gate).toBe("stop");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("marks the run failed instead of reporting a rejected commit as created", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "hench-commit-prompt-failure-"));
    try {
      await initGitFixtureRepo(projectDir);
      await writeFile(join(projectDir, "src.ts"), "export const value = 1;\n", "utf-8");
      await execAsync("git add src.ts && git commit -m initial", { cwd: projectDir });
      await writeFile(join(projectDir, "src.ts"), "export const value = 2;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: update value\n", "utf-8");

      await failGitMutation("commit", "unable to auto-detect email address");
      const { performCommitPromptIfNeeded } = await import("../../src/agent/lifecycle/shared.js");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const run = completedRun();
      await performCommitPromptIfNeeded(run, projectDir, false, true, true);

      expect(run.status).toBe("failed");
      expect(run.error).toContain("unable to auto-detect email address");
      expect(log.mock.calls.flat().join("\n")).toContain("Commit failed:");
      expect(log.mock.calls.flat().join("\n")).not.toContain("Commit created");
      const { stdout: head } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
      expect(head.trim()).toBe("initial");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("fails the auto-commit lifecycle when its completion metadata commit is rejected", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "hench-metadata-commit-failure-"));
    try {
      const henchDir = join(projectDir, ".hench");
      const taskId = "task-1";
      const taskPath = join(projectDir, ".rex", "prd_tree", "task", "index.md");
      await initGitFixtureRepo(projectDir);
      await initConfig(henchDir);
      await mkdir(join(henchDir, "runs"), { recursive: true });
      await mkdir(join(projectDir, ".rex", "prd_tree", "task"), { recursive: true });
      await writeFile(taskPath, "status: in_progress\n", "utf-8");
      await execAsync("git add . && git commit -m initial", { cwd: projectDir });

      let taskStatus = "in_progress";
      const store = {
        getItem: vi.fn(async (id: string) => id === taskId
          ? { id: taskId, status: taskStatus, title: "Test task", level: "task" }
          : null),
        updateItem: vi.fn(async (id: string, updates: { status?: string }) => {
          if (id !== taskId || !updates.status) return;
          taskStatus = updates.status;
          const current = await readFile(taskPath, "utf-8");
          await writeFile(taskPath, current.replace(/status: \w+/, `status: ${updates.status}`), "utf-8");
        }),
        appendLog: vi.fn(async () => {}),
        loadDocument: vi.fn(async () => ({ items: [] })),
      };

      await failGitMutation("commit", "pre-commit hook rejected completion metadata");
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      const run = completedRun();
      await finalizeRun({
        run,
        henchDir,
        projectDir,
        autoCommit: true,
        rollbackOnFailure: false,
        skipFullTestGate: true,
        store: store as never,
      });

      expect(run.status).toBe("failed");
      expect(run.error).toContain("pre-commit hook rejected completion metadata");
      expect(taskStatus).toBe("pending");
      const { stdout: log } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
      expect(log.trim()).toBe("initial");
      const { stdout: status } = await execAsync("git status --porcelain", { cwd: projectDir });
      expect(status).toContain(".rex/prd_tree/task/index.md");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("withdraws auto-commit completion when staging reviewer repairs is rejected", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "hench-auto-review-add-failure-"));
    try {
      const henchDir = join(projectDir, ".hench");
      const taskId = "task-1";
      const taskPath = join(projectDir, ".rex", "prd_tree", "task", "index.md");
      const sourcePath = join(projectDir, "src.ts");
      await initGitFixtureRepo(projectDir);
      await initConfig(henchDir);
      await mkdir(join(henchDir, "runs"), { recursive: true });
      await mkdir(join(projectDir, ".rex", "prd_tree", "task"), { recursive: true });
      await writeFile(taskPath, "status: in_progress\n", "utf-8");
      await writeFile(sourcePath, "export const value = 1;\n", "utf-8");
      await execAsync("git add . && git commit -m initial", { cwd: projectDir });
      await writeFile(sourcePath, "export const value = 2; // reviewer repair\n", "utf-8");

      let taskStatus = "in_progress";
      const store = {
        getItem: vi.fn(async (id: string) => id === taskId
          ? { id: taskId, status: taskStatus, title: "Test task", level: "task" }
          : null),
        updateItem: vi.fn(async (id: string, updates: { status?: string }) => {
          if (id !== taskId || !updates.status) return;
          taskStatus = updates.status;
          const current = await readFile(taskPath, "utf-8");
          await writeFile(taskPath, current.replace(/status: \w+/, `status: ${updates.status}`), "utf-8");
        }),
        appendLog: vi.fn(async () => {}),
        loadDocument: vi.fn(async () => ({ items: [] })),
      };

      await failGitMutation("add", "fatal: could not lock index");
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
      const run = completedRun();
      run.review = {
        model: "reviewer",
        resumedSession: false,
        findingCount: 1,
        unresolvedCount: 0,
        unrepairedMustFixCount: 0,
        failedActionCount: 0,
        fixesApplied: true,
        repairedFiles: ["src.ts"],
      };
      await finalizeRun({
        run,
        henchDir,
        projectDir,
        autoCommit: true,
        rollbackOnFailure: false,
        skipFullTestGate: true,
        store: store as never,
      });

      expect(run.status).toBe("failed");
      expect(run.error).toContain("fatal: could not lock index");
      expect(run.review.repairCommit).toBeUndefined();
      expect(taskStatus).toBe("pending");
      expect(consoleLog.mock.calls.flat().join("\n")).toContain("Could not commit review repairs");
      expect(consoleLog.mock.calls.flat().join("\n")).not.toContain("Committed review repairs");
      const { stdout: log } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
      expect(log.trim()).toBe("initial");
      const { stdout: status } = await execAsync("git status --porcelain", { cwd: projectDir });
      expect(status).toContain("src.ts");
      expect(status).toContain(".rex/prd_tree/task/index.md");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("withdraws auto-commit completion when checking staged reviewer repairs fails", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "hench-auto-review-diff-failure-"));
    try {
      const henchDir = join(projectDir, ".hench");
      const taskId = "task-1";
      const taskPath = join(projectDir, ".rex", "prd_tree", "task", "index.md");
      const sourcePath = join(projectDir, "src.ts");
      await initGitFixtureRepo(projectDir);
      await initConfig(henchDir);
      await mkdir(join(henchDir, "runs"), { recursive: true });
      await mkdir(join(projectDir, ".rex", "prd_tree", "task"), { recursive: true });
      await writeFile(taskPath, "status: in_progress\n", "utf-8");
      await writeFile(sourcePath, "export const value = 1;\n", "utf-8");
      await execAsync("git add . && git commit -m initial", { cwd: projectDir });
      await writeFile(sourcePath, "export const value = 2; // reviewer repair\n", "utf-8");

      let taskStatus = "in_progress";
      const store = {
        getItem: vi.fn(async (id: string) => id === taskId
          ? { id: taskId, status: taskStatus, title: "Test task", level: "task" }
          : null),
        updateItem: vi.fn(async (id: string, updates: { status?: string }) => {
          if (id !== taskId || !updates.status) return;
          taskStatus = updates.status;
          const current = await readFile(taskPath, "utf-8");
          await writeFile(taskPath, current.replace(/status: \w+/, `status: ${updates.status}`), "utf-8");
        }),
        appendLog: vi.fn(async () => {}),
        loadDocument: vi.fn(async () => ({ items: [] })),
      };

      await failGitMutation("diff", "fatal: index is corrupt");
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      const run = completedRun();
      run.review = {
        model: "reviewer",
        resumedSession: false,
        findingCount: 1,
        unresolvedCount: 0,
        unrepairedMustFixCount: 0,
        failedActionCount: 0,
        fixesApplied: true,
        repairedFiles: ["src.ts"],
      };
      await finalizeRun({
        run,
        henchDir,
        projectDir,
        autoCommit: true,
        rollbackOnFailure: false,
        skipFullTestGate: true,
        store: store as never,
      });

      expect(run.status).toBe("failed");
      expect(run.error).toContain("fatal: index is corrupt");
      expect(run.review.repairCommit).toBeUndefined();
      expect(taskStatus).toBe("pending");
      const { stdout: log } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
      expect(log.trim()).toBe("initial");
      const { stdout: status } = await execAsync("git status --porcelain", { cwd: projectDir });
      expect(status).toContain("src.ts");
      expect(status).toContain(".rex/prd_tree/task/index.md");
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, appendFile, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo, RM_RETRY } from "../helpers/index.js";

const execAsync = promisify(execCb);

function buildCompletedRun(taskId: string): RunRecord {
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

/**
 * Returns lines from `git status --porcelain` that reference the .rex/ tree.
 */
async function getRexDirtyLines(projectDir: string): Promise<string[]> {
  const { stdout } = await execAsync("git status --porcelain", { cwd: projectDir });
  return stdout
    .split("\n")
    .filter(Boolean)
    .filter((line) => line.replace(/\r/g, "").includes(".rex"));
}

describe("commitCompletionMetadata — autoCommit path (Bug A)", () => {
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  const taskId = "task-abc-123";

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-completion-commit-"));
    henchDir = join(projectDir, ".hench");
    const rexDir = join(projectDir, ".rex");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    // Create a tracked task file in prd_tree
    const taskSlug = "task-slug-abc";
    const taskDir = join(rexDir, PRD_TREE_DIRNAME, taskSlug);
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Test task\nstatus: in_progress\n", "utf-8");
    await writeFile(join(rexDir, "execution-log.jsonl"), "baseline log\n", "utf-8");

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("commits .rex/prd_tree metadata on autoCommit path, leaving working tree clean", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // Mock store: updateItem writes file to disk (simulates real store behaviour)
    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "in_progress", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    const run = buildCompletedRun(taskId);

    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    // .rex/prd_tree changes must be committed — no dirty entries
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty).toHaveLength(0);

    // The completion metadata commit should exist and contain the task id
    const { stdout: logMsg } = await execAsync("git log -1 --format='%s'", { cwd: projectDir });
    expect(logMsg.trim()).toContain(taskId);
  });

  it("commits with Co-Authored-By trailer on the autoCommit path", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "in_progress", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    const run = buildCompletedRun(taskId);

    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    const { stdout: fullMsg } = await execAsync("git log -1 --format='%B'", { cwd: projectDir });
    expect(fullMsg).toContain("Co-Authored-By:");
  });

  it("never stages or commits the execution log itself, even across a rotation", async () => {
    // The execution log is untracked by design (rex init gitignores it) —
    // hench must not stage it regardless of whether a given project happens
    // to have it tracked already. The completion commit still has to land.
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const rexDir = join(projectDir, ".rex");
    const logPath = join(rexDir, "execution-log.jsonl");
    let rotationPending = true;

    const mockStore = {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status: "in_progress", title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {
        if (rotationPending) {
          rotationPending = false;
          await rename(logPath, join(rexDir, "execution-log.1.jsonl"));
        }
        await appendFile(logPath, "completion log\n", "utf-8");
      }),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    // The task-completion commit still lands…
    const { stdout: logMsg } = await execAsync("git log -1 --format='%s'", { cwd: projectDir });
    expect(logMsg.trim()).toContain(taskId);

    // …but never includes the rotated execution log, on either side of the
    // rotation.
    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    expect(changed).not.toContain("execution-log");
  });

  it("reports a tracked execution log as the operator's instead of leaving it silently dirty", async () => {
    // This fixture's execution log was committed at baseline, i.e. the project
    // tracks it (created before rex init gitignored the pattern). Hench never
    // stages it and the completion gate discounts it, so without the report it
    // stayed dirty after every completion and the next autonomous run's
    // pre-run gate refused to start.
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const logPath = join(projectDir, ".rex", "execution-log.jsonl");

    const mockStore = {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status: "in_progress", title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      // A real store appends every status transition to the log.
      appendLog: vi.fn(async () => {
        await appendFile(logPath, "completion log\n", "utf-8");
      }),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    // The completion commit lands, without the log…
    const { stdout: logMsg } = await execAsync("git log -1 --format='%s'", { cwd: projectDir });
    expect(logMsg.trim()).toContain(taskId);
    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    expect(changed).not.toContain("execution-log");

    // …the log stays the operator's, dirty in the tree…
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty.some((line) => line.includes("execution-log.jsonl"))).toBe(true);

    // …and hench says so instead of leaving it silently.
    const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .flat()
      .join("\n");
    expect(logged).toContain("hench never commits");
    expect(logged).toContain(".rex/execution-log.jsonl");
  });

  it("no-ops cleanly when task is already completed (nothing to stage)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // Store returns already-completed — updateCompletedTaskStatus short-circuits
    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "completed", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async () => {}),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    const run = buildCompletedRun(taskId);

    await expect(
      (finalizeRun as Function)({
        run,
        henchDir,
        projectDir,
        autoCommit: true,
        skipFullTestGate: true,
        store: mockStore,
      }),
    ).resolves.not.toThrow();

    // Working tree should remain clean — nothing was written
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty).toHaveLength(0);
  });

  it("does not commit metadata on non-autoCommit path (no double-commit)", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    const mockStore = {
      getItem: vi.fn(async (id: string) => {
        if (id !== taskId) return null;
        return { id: taskId, status: "in_progress", title: "Test task", level: "task" };
      }),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    const run = buildCompletedRun(taskId);

    // On the non-autoCommit path there is no pending commit file, so
    // performCommitPromptIfNeeded is a no-op (existsSync returns false).
    // commitCompletionMetadata must NOT be called — the test verifies there
    // is exactly one commit (the initial one) after finalizeRun.
    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: false,   // non-autoCommit path
      skipFullTestGate: true,
      store: mockStore,
    });

    const { stdout: log } = await execAsync("git log --oneline", { cwd: projectDir });
    // Only the initial commit: commitCompletionMetadata must not create a commit
    expect(log.trim().split("\n")).toHaveLength(1);
  });
});

/**
 * Regression coverage for the reported failure: `rex init` writes
 * `.rex/execution-log*.jsonl` into `.gitignore`
 * (packages/rex/src/cli/commands/init.ts), while the completion commit used
 * to list the execution log as an unconditional staging candidate. `git add`
 * on an ignored path errors, which aborted the staging loop before any PRD
 * path was staged, so the completion commit never happened — two of four
 * autonomous runs failed this way in one session.
 */
describe("commitCompletionMetadata — execution log gitignored per rex init (Bug)", () => {
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  const taskId = "task-gitignored-log";

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-completion-commit-gitignore-"));
    henchDir = join(projectDir, ".hench");
    const rexDir = join(projectDir, ".rex");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    const taskSlug = "task-slug-gitignored";
    const taskDir = join(rexDir, PRD_TREE_DIRNAME, taskSlug);
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Test task\nstatus: in_progress\n", "utf-8");

    // The exact pattern rex init writes — see
    // packages/rex/src/cli/commands/init.ts ensureGitignoreEntries call.
    await writeFile(join(projectDir, ".gitignore"), ".rex/execution-log*.jsonl\n", "utf-8");

    // No execution-log.jsonl exists yet at baseline commit time — it is
    // created fresh, gitignored from the start, exactly as `rex init` +
    // a first PRD write produces it.
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("lands the completion commit instead of aborting on the ignored log", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const logPath = join(projectDir, ".rex", "execution-log.jsonl");

    const mockStore = {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status: "in_progress", title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      // A real store appends every status transition to the (gitignored) log.
      appendLog: vi.fn(async () => {
        await appendFile(logPath, "completion log\n", "utf-8");
      }),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };

    const run = buildCompletedRun(taskId);

    await expect(
      (finalizeRun as Function)({
        run,
        henchDir,
        projectDir,
        autoCommit: true,
        skipFullTestGate: true,
        store: mockStore,
      }),
    ).resolves.not.toThrow();

    // Before the fix this aborted with "Command failed: git add
    // .rex/execution-log.jsonl" and left the run marked failed/withdrawn.
    expect(run.status).toBe("completed");
    expect(run.error).toBeUndefined();

    const { stdout: logMsg } = await execAsync("git log -1 --format='%s'", { cwd: projectDir });
    expect(logMsg.trim()).toContain(taskId);

    // The task file was staged and committed…
    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    expect(changed).toContain(`.rex/${PRD_TREE_DIRNAME}/${"task-slug-gitignored"}/index.md`);
    // …the gitignored log was not.
    expect(changed).not.toContain("execution-log");

    // A gitignored log is nobody's problem: neither staged nor reported.
    const logged = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .flat()
      .join("\n");
    expect(logged).not.toContain("hench never commits");
  });
});

/**
 * WM2040: the completion and --reset-deferred commits stage exactly the files
 * the store's save reported written and deleted (plus the tree-meta sidecar),
 * not the whole `.rex/prd_tree/`. Staging the directory wholesale once swept a
 * 1,378-file in-flight rename into a "task completed" commit. A store exposes
 * the list via takeSaveFileReport; mocks without it keep the wholesale
 * fallback, which the earlier describes in this file still cover.
 */
describe("commitCompletionMetadata — stages only the save report's files (WM2040)", () => {
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  let unrelatedPath: string;
  const taskId = "task-scoped-stage";
  const taskRelPath = ".rex/prd_tree/task-slug-scoped/index.md";
  const unrelatedRelPath = ".rex/prd_tree/unrelated-item/index.md";

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-scoped-stage-"));
    henchDir = join(projectDir, ".hench");
    const rexDir = join(projectDir, ".rex");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    const taskDir = join(rexDir, PRD_TREE_DIRNAME, "task-slug-scoped");
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Test task\nstatus: in_progress\n", "utf-8");

    const unrelatedDir = join(rexDir, PRD_TREE_DIRNAME, "unrelated-item");
    await mkdir(unrelatedDir, { recursive: true });
    unrelatedPath = join(unrelatedDir, "index.md");
    await writeFile(unrelatedPath, "# Unrelated\nstatus: pending\n", "utf-8");

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  function buildScopedMockStore() {
    return {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status: "in_progress", title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
      takeSaveFileReport: vi.fn(() => ({ written: [taskRelPath], deleted: [] })),
    };
  }

  it("leaves an unrelated dirty prd_tree file out of the completion commit and still dirty", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    // An operator's in-flight edit sitting under .rex/prd_tree/ during the run.
    await writeFile(unrelatedPath, "# Unrelated\nstatus: pending\nnotes: operator edit in flight\n", "utf-8");

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: buildScopedMockStore(),
    });

    // The completion commit landed and carries the task's file…
    const { stdout: logMsg } = await execAsync("git log -1 --format='%s'", { cwd: projectDir });
    expect(logMsg.trim()).toContain(taskId);
    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    expect(changed).toContain(taskRelPath);
    // …but not the operator's file, which stays dirty in the working tree.
    expect(changed).not.toContain(unrelatedRelPath);
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]).toContain("unrelated-item");
  });

  it("stages a deletion the save report names", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const doomedRelPath = ".rex/prd_tree/doomed-leaf.md";
    const doomedPath = join(projectDir, ".rex", PRD_TREE_DIRNAME, "doomed-leaf.md");
    await writeFile(doomedPath, "# Doomed\nstatus: pending\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "add doomed leaf"', { cwd: projectDir });

    const store = buildScopedMockStore();
    store.takeSaveFileReport = vi.fn(() => ({ written: [taskRelPath], deleted: [doomedRelPath] }));
    // The save's cleanup removed the leaf (e.g. a leaf-to-folder promotion).
    await rm(doomedPath, { force: true });

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: changed } = await execAsync("git show --format= --name-status HEAD", { cwd: projectDir });
    expect(changed).toContain(taskRelPath);
    expect(changed).toMatch(/D\s+\.rex\/prd_tree\/doomed-leaf\.md/);
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty).toHaveLength(0);
  });
});

describe("commitResetDeferredChanges — stages only the save report's files (WM2040)", () => {
  let projectDir: string;
  let resetTaskPath: string;
  let unrelatedPath: string;
  const resetRelPath = ".rex/prd_tree/deferred-task.md";
  const unrelatedRelPath = ".rex/prd_tree/unrelated-item/index.md";

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-reset-scoped-"));
    const rexDir = join(projectDir, ".rex");

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    await mkdir(join(rexDir, PRD_TREE_DIRNAME, "unrelated-item"), { recursive: true });
    resetTaskPath = join(rexDir, PRD_TREE_DIRNAME, "deferred-task.md");
    unrelatedPath = join(rexDir, PRD_TREE_DIRNAME, "unrelated-item", "index.md");
    await writeFile(resetTaskPath, "# Deferred task\nstatus: deferred\n", "utf-8");
    await writeFile(unrelatedPath, "# Unrelated\nstatus: pending\n", "utf-8");

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("commits the reset's own write and leaves an unrelated dirty file dirty", async () => {
    const { commitResetDeferredChanges } = await import("../../src/agent/lifecycle/shared.js");

    // The reset's write and, alongside it, an operator edit in flight.
    await writeFile(resetTaskPath, "# Deferred task\nstatus: pending\n", "utf-8");
    await writeFile(unrelatedPath, "# Unrelated\nstatus: pending\nnotes: operator edit\n", "utf-8");

    const result = await commitResetDeferredChanges(projectDir, 1, {
      written: [resetRelPath],
      deleted: [],
    });
    expect(result.error).toBeUndefined();
    expect(result.staged).toBeGreaterThan(0);

    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    expect(changed).toContain(resetRelPath);
    expect(changed).not.toContain(unrelatedRelPath);
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty).toHaveLength(1);
    expect(dirty[0]).toContain("unrelated-item");
  });
});

/**
 * WM2040 end-to-end: a real store (resolveStore, the same factory `ndx work`
 * uses) reports its own save's files through takeSaveFileReport, and the
 * completion commit stages exactly those plus the tree-meta sidecar — the
 * completed item's file, its parent's index.md if the save touched it, and
 * nothing else under `.rex/prd_tree/`.
 */
describe("commitCompletionMetadata — real store save report (WM2040)", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-real-store-stage-"));
    henchDir = join(projectDir, ".hench");
    rexDir = join(projectDir, ".rex");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("commits only the files the completion save wrote, plus the sidecar", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore, takeSaveFileReport } = await import("../../src/prd/rex-gateway.js");

    // The folder tree must exist for the store to pick the tree backend
    // (an empty .rex would fall back to the legacy prd.json sources).
    await mkdir(join(rexDir, "prd_tree"), { recursive: true });
    const store = await resolveStore(rexDir);
    await store.addItem({ id: "epic-1", title: "Epic One", status: "pending", level: "epic" });
    await store.addItem(
      { id: "feat-1", title: "Feature One", status: "in_progress", level: "feature", acceptanceCriteria: [] },
      "epic-1",
    );

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "baseline"', { cwd: projectDir });

    // The setup writes above belong to the baseline commit, not to the run.
    takeSaveFileReport(store);

    await (finalizeRun as Function)({
      run: buildCompletedRun("feat-1"),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: logMsg } = await execAsync("git log -1 --format='%s'", { cwd: projectDir });
    expect(logMsg.trim()).toContain("feat-1");

    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    const changedFiles = changed.split("\n").map((l) => l.trim()).filter(Boolean);
    // Every committed path is the completed item's file, its parent's
    // index.md, or the tree-meta sidecar — never the operator's file.
    for (const file of changedFiles) {
      expect(file).toMatch(/^\.rex\/(prd_tree\/epic-one\/(index\.md|feature-one\.md)|tree-meta\.json)$/);
    }
    expect(changedFiles.some((f) => f.includes("feature-one"))).toBe(true);

    // Nothing under .rex/ is left dirty except the execution log, which is
    // untracked by design (rex init gitignores it) and never staged.
    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty.filter((line) => !line.includes("execution-log"))).toHaveLength(0);
  });
});

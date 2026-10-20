import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, appendFile, rename, cp } from "node:fs/promises";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb, execFile as execFileCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo, RM_RETRY } from "../helpers/index.js";

const execAsync = promisify(execCb);
const execFileAsync = promisify(execFileCb);

/**
 * The values of HEAD's `key` trailers, read through git's own trailer parser
 * rather than by scanning the message — a line that is not where git expects a
 * trailer reads as absent here, which is exactly the failure worth catching.
 *
 * Runs without a shell: `cmd.exe` keeps the single quotes a POSIX shell would
 * strip, and does not reliably pass the parentheses in `%(trailers:…)`.
 */
async function headTrailer(projectDir: string, key: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "-1", `--format=%(trailers:key=${key},valueonly)`],
    { cwd: projectDir },
  );
  return stdout.trim();
}

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

  // The record commit is a commit n-dx makes *for* an item, so it carries the
  // same `N-DX-Item` trailer as the work commit. Without it, a task whose code
  // the operator committed by hand leaves only this commit in history naming
  // the task — and rex's realized-by edge, which reads nothing but the trailer,
  // never sees it. The subject already mentions the id, but no reader parses
  // subjects: `scanTrailerCommits` asks git for `%(trailers:key=N-DX-Item)`.
  it("commits with the N-DX-Item trailer naming the task on the autoCommit path", async () => {
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

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    // Read it the way rex does rather than scanning the message text, so the
    // assertion fails if the line lands somewhere git will not parse as a
    // trailer (split from the block by a blank line, say).
    expect(await headTrailer(projectDir, "N-DX-Item")).toBe(taskId);
    // All three trailers share the one final block git parses.
    expect(await headTrailer(projectDir, "N-DX")).toBe("PRD record (task completion)");
    expect(await headTrailer(projectDir, "Co-Authored-By")).toBe("En Dash's n-dx <n-dx@endash.us>");
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

  it("commits the record on the non-autoCommit path when nothing else will", async () => {
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

    // The reported failure, and what this test used to assert the opposite of.
    // There is no pending commit file, so the commit prompt bows out before it
    // reaches its own `git commit` - the ordinary ending when the executor
    // commits its own work as it goes. The record commit used to be gated on
    // autoCommit, so on this path the completion write was left in the tree
    // with the task marked completed, and the next autonomous run's pre-run
    // gate refused to start over it.
    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit: false,
      skipFullTestGate: true,
      store: mockStore,
    });

    const { stdout: log } = await execAsync("git log --oneline", { cwd: projectDir });
    expect(log.trim().split("\n")).toHaveLength(2);

    // And the point of committing it: the tree is clean, so the next run starts.
    expect(await getRexDirtyLines(projectDir)).toHaveLength(0);
  });

  it("makes no duplicate commit when the prompt already landed the record", async () => {
    // The guarantee the previous version of this test was named for. Once the
    // prompt has swept the PRD paths into its own commit there is nothing left
    // to stage, so the record commit is a no-op rather than a duplicate.
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

    // A real commit handoff: a staged code change plus the message sentinel.
    await writeFile(join(projectDir, "feature.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add feature.ts", { cwd: projectDir });
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: add x\n", "utf-8");

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: false,
      yes: true,
      autonomous: true,
      skipFullTestGate: true,
      store: mockStore,
    });

    const { stdout: log } = await execAsync("git log --oneline", { cwd: projectDir });
    // Baseline + the prompt's commit, and at most one more for the attribution
    // write the prompt makes *after* committing. Never a duplicate of the
    // record the prompt already carried.
    expect(log.trim().split("\n").length).toBeLessThanOrEqual(3);
    expect(await getRexDirtyLines(projectDir)).toHaveLength(0);
  });

  /**
   * A store whose item reads back the status last written, as a real one does.
   * The mocks above always answer in_progress, which hides the case that
   * matters here: finalizeRun writes "completed" before the commit prompt
   * runs, so a prompt that asks the store for the old status gets "completed".
   */
  function statefulStore() {
    let status = "in_progress";
    return {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status, title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id === taskId && updates.status === "completed") {
          status = "completed";
          const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
          await writeFile(taskIndexPath, current.replace("status: in_progress", "status: completed"), "utf-8");
        }
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };
  }

  it("records the status transition on the completion commit", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: false,
      skipFullTestGate: true,
      store: statefulStore(),
    });

    expect(await headTrailer(projectDir, "N-DX-Status")).toBe(`${taskId} in_progress → completed`);
    expect(await headTrailer(projectDir, "N-DX-Item")).toBe(taskId);
    expect(await getRexDirtyLines(projectDir)).toHaveLength(0);
  });

  it("records the status transition on the prompt's commit, which carries the completion", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");

    await writeFile(join(projectDir, "feature.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add feature.ts", { cwd: projectDir });
    await writeFile(join(projectDir, ".hench-commit-msg.txt"), "feat: add x\n", "utf-8");

    await (finalizeRun as Function)({
      run: buildCompletedRun(taskId),
      henchDir,
      projectDir,
      autoCommit: false,
      yes: true,
      autonomous: true,
      skipFullTestGate: true,
      store: statefulStore(),
    });

    const { stdout } = await execFileAsync(
      "git",
      ["log", "--format=%s%x09%(trailers:key=N-DX-Status,valueonly,separator=;)"],
      { cwd: projectDir },
    );
    const bySubject = new Map(
      stdout
        .split("\n")
        .filter((line) => line.includes("\t"))
        .map((line) => line.split("\t") as [string, string]),
    );
    // The commit that lands the completed status says so…
    expect(bySubject.get("feat: add x")?.trim()).toBe(`${taskId} in_progress → completed`);
    // …and no follow-up commit claims the same transition a second time.
    const claims = [...bySubject.values()].filter((v) => v.trim() !== "");
    expect(claims).toHaveLength(1);
    // Nor does any follow-up commit land at all: nothing writes the PRD after
    // the commit that carries the completion.
    const { stdout: head } = await execFileAsync("git", ["log", "-1", "--format=%s"], { cwd: projectDir });
    expect(head.trim()).toBe("feat: add x");
    expect(await getRexDirtyLines(projectDir)).toHaveLength(0);
  });

  // The order a task lands in is: work finished, task marked completed, then
  // the commit. An executor that commits for itself does so before hench's
  // gates mark the task, so its completion is folded into that commit —
  // guarded so a rewrite can never reach anyone else.
  describe("when the executor committed its own work", () => {
    const git = async (...args: string[]) =>
      (await execFileAsync("git", args, { cwd: projectDir })).stdout.trim();

    /** The executor's commit, and a run that started just before it. */
    async function executorCommits(message = "feat: add x"): Promise<RunRecord> {
      const startHead = await git("rev-parse", "HEAD");
      await writeFile(join(projectDir, "feature.ts"), "export const x = 1;\n", "utf-8");
      await git("add", "feature.ts");
      await git("commit", "-q", "-m", message);
      const run = buildCompletedRun(taskId);
      run.startHead = startHead;
      run.branch = await git("rev-parse", "--abbrev-ref", "HEAD");
      return run;
    }

    async function finalize(run: RunRecord, autoCommit: boolean): Promise<void> {
      const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
      await (finalizeRun as Function)({
        run, henchDir, projectDir, autoCommit, autonomous: true, skipFullTestGate: true,
        store: statefulStore(),
      });
    }

    for (const autoCommit of [true, false]) {
      it(`folds the completion into it — one commit (autoCommit=${autoCommit})`, async () => {
        const run = await executorCommits();
        await finalize(run, autoCommit);

        expect((await git("log", "--format=%s", `${run.startHead}..HEAD`)).split("\n")).toEqual(["feat: add x"]);
        const files = await git("show", "--name-only", "--format=", "HEAD");
        expect(files).toContain("feature.ts");
        expect(files).toContain("task-slug-abc/index.md");
        expect(await headTrailer(projectDir, "N-DX-Status")).toBe(`${taskId} in_progress → completed`);
        expect(await headTrailer(projectDir, "N-DX-Item")).toBe(taskId);
        expect(await getRexDirtyLines(projectDir)).toHaveLength(0);
        // The run record names the commit that is on the branch, not the one
        // the fold replaced.
        expect(run.commits?.map((c) => c.sha)).toEqual([await git("rev-parse", "HEAD")]);
      });
    }

    it("leaves work the operator staged out of the fold, and still staged", async () => {
      const run = await executorCommits();
      await writeFile(join(projectDir, "operator.ts"), "mine\n", "utf-8");
      await git("add", "operator.ts");

      await finalize(run, true);

      expect(await git("show", "--name-only", "--format=", "HEAD")).not.toContain("operator.ts");
      expect(await git("status", "--porcelain", "--", "operator.ts")).toBe("A  operator.ts");
    });

    it("commits the completion on its own when the work commit is already on a remote", async () => {
      const run = await executorCommits();
      const pushed = await git("rev-parse", "HEAD");
      await git("update-ref", "refs/remotes/origin/main", pushed);

      await finalize(run, true);

      // The published commit is untouched; the record follows it.
      expect(await git("rev-parse", "HEAD~1")).toBe(pushed);
      expect(await git("log", "-1", "--format=%s")).toContain("chore(prd)");
      expect(await headTrailer(projectDir, "N-DX-Status")).toBe(`${taskId} in_progress → completed`);
      expect(await getRexDirtyLines(projectDir)).toHaveLength(0);
    });

    it("commits the completion on its own when HEAD is the commit for another item", async () => {
      const run = await executorCommits("feat: someone else's\n\nN-DX-Item: other-item");
      const other = await git("rev-parse", "HEAD");

      await finalize(run, true);

      expect(await git("rev-parse", "HEAD~1")).toBe(other);
      expect(await headTrailer(projectDir, "N-DX-Item")).toBe(taskId);
    });
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

  // The counterpart to the completion commit's trailer. A reset spans every
  // deferred task it touched, so there is no single item the commit is "for"
  // and it emits no `N-DX-Item` — naming one of the N would attribute the
  // whole commit to it in the realized-by edge.
  it("emits no N-DX-Item trailer — a reset spans every task it touched", async () => {
    const { commitResetDeferredChanges } = await import("../../src/agent/lifecycle/shared.js");

    await writeFile(resetTaskPath, "# Deferred task\nstatus: pending\n", "utf-8");
    const result = await commitResetDeferredChanges(projectDir, 2, {
      written: [resetRelPath],
      deleted: [],
    });
    expect(result.error).toBeUndefined();

    expect(await headTrailer(projectDir, "N-DX-Item")).toBe("");
    // The co-authorship trailer is still there, so an empty read above means
    // "no item trailer", not "no trailer block at all".
    expect(await headTrailer(projectDir, "Co-Authored-By")).not.toBe("");
    expect(await headTrailer(projectDir, "N-DX")).toBe("PRD record (--reset-deferred)");
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

/**
 * The v2 half of WM2040, on rex's real ChangeLayerStore (review 2026-10-12,
 * PR #692 should-fix 2). Completing a change's last task writes the change's
 * state and, on apply, the capability it amends. The completion commit carries
 * exactly those files: an operator's edit in flight under another change, or
 * elsewhere in product/, stays out of it and stays dirty.
 */
describe("commitCompletionMetadata — v2 change layer, real store", () => {
  const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
  /** CH-1 and its only task; completing the task completes and applies CH-1. */
  const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
  const WIRE_ID = "c0000000-0000-4000-8000-000000000002";
  const OTHER_CHANGE_ID = "c0000000-0000-4000-8000-000000000009";
  const otherChangeRel = ".rex/changes/fix-typo/index.md";
  const productRootRel = ".rex/product/index.md";
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    projectDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-v2-stage-")));
    henchDir = join(projectDir, ".hench");
    rexDir = join(projectDir, ".rex");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);
    await cp(FIXTURE, rexDir, { recursive: true });
    await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
    await writeFile(
      join(rexDir, "changes", "add-apple-pay", "state.yaml"),
      ['schema: "rex/v2"', "items:", `  "${CHANGE_ID}":`, '    status: "pending"', `  "${WIRE_ID}":`, '    status: "in_progress"', ""].join("\n"),
    );
    // A second change, which the operator is editing while the run works.
    await mkdir(join(rexDir, "changes", "fix-typo"));
    await writeFile(
      join(projectDir, otherChangeRel),
      ["---", `id: "${OTHER_CHANGE_ID}"`, 'type: "change"', 'title: "Fix typo"', 'slug: "fix-typo"', 'intent: "A typo on the receipt."', "---", ""].join("\n"),
    );
    await writeFile(join(projectDir, ".gitignore"), ".hench/\n.rex/execution-log*.jsonl\n.rex/.cache/\n");
    await execAsync("git add -A", { cwd: projectDir });
    await execAsync('git commit -q -m "baseline"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("commits the completion's change-layer writes and leaves an operator's changes/ and product/ edits dirty", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore, isChangeLayerStore } = await import("../../src/prd/rex-gateway.js");
    const store = await resolveStore(rexDir);
    expect(isChangeLayerStore(store)).toBe(true);

    await appendFile(join(projectDir, otherChangeRel), "\nOperator notes in flight.\n");
    await appendFile(join(projectDir, productRootRel), "\nOperator notes in flight.\n");

    await (finalizeRun as Function)({
      run: buildCompletedRun(WIRE_ID),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: subject } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
    expect(subject.trim()).toContain(WIRE_ID);
    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    const files = changed.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(files).toContain(".rex/changes/add-apple-pay/state.yaml");
    expect(files.some((f) => f.startsWith(".rex/product/checkout/"))).toBe(true);
    expect(files).not.toContain(otherChangeRel);
    expect(files).not.toContain(productRootRel);

    const dirty = await getRexDirtyLines(projectDir);
    expect(dirty.map((l) => l.slice(3)).sort()).toEqual([otherChangeRel, productRootRel].sort());
  });

  it("never stages product/ or changes/ wholesale when the store reports no save", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore, completeV2Work } = await import("../../src/prd/rex-gateway.js");
    // The completion was written by another store instance (the rex MCP
    // server, say), so the store finalizeRun drains has nothing to report.
    const other = await resolveStore(rexDir);
    await completeV2Work(other as Parameters<typeof completeV2Work>[0], WIRE_ID);
    const store = await resolveStore(rexDir);

    await appendFile(join(projectDir, otherChangeRel), "\nOperator notes in flight.\n");
    await appendFile(join(projectDir, productRootRel), "\nOperator notes in flight.\n");

    await (finalizeRun as Function)({
      run: buildCompletedRun(WIRE_ID),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: subject } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
    expect(subject.trim()).toBe("baseline");
    const dirty = (await getRexDirtyLines(projectDir)).map((l) => l.slice(3));
    expect(dirty).toContain(otherChangeRel);
    expect(dirty).toContain(productRootRel);
  });

  /**
   * PROBE4 (holistic review 2026-10-13). A follow-up captured and placed
   * through MCP after the agent's commit is untracked when a later run
   * completes it. The completion writes only its `state.yaml`, so a commit of
   * the report alone would land a state row for a node git does not have.
   */
  it("commits a placed follow-up's untracked intent files with its completion state", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore } = await import("../../src/prd/rex-gateway.js");
    const changeRel = ".rex/changes/add-apple-pay";
    await execAsync(`git rm -r -q --cached ${changeRel}`, { cwd: projectDir });
    await execAsync('git commit -q -m "follow-up placed after the agent commit"', { cwd: projectDir });
    // An unrelated untracked change the operator is drafting.
    const draftRel = ".rex/changes/draft-idea/index.md";
    await mkdir(join(rexDir, "changes", "draft-idea"));
    await writeFile(
      join(projectDir, draftRel),
      ["---", 'id: "c0000000-0000-4000-8000-000000000010"', 'type: "change"', 'title: "Draft idea"', 'slug: "draft-idea"', 'intent: "Not yet."', "---", ""].join("\n"),
    );

    const store = await resolveStore(rexDir);
    await (finalizeRun as Function)({
      run: buildCompletedRun(WIRE_ID),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: subject } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
    expect(subject.trim()).toContain(WIRE_ID);
    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    const files = changed.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(files).toEqual(
      expect.arrayContaining([`${changeRel}/state.yaml`, `${changeRel}/index.md`, `${changeRel}/wire-the-button.md`]),
    );
    expect(files).not.toContain(draftRel);
    const { stdout: status } = await execAsync("git status --porcelain -uall", { cwd: projectDir });
    const dirty = status.split("\n").filter(Boolean).map((l) => l.slice(3));
    expect(dirty.filter((p) => p.startsWith(`${changeRel}/`))).toEqual([]);
    expect(dirty).toContain(draftRel);
  });

  /**
   * The apply writes product/checkout/state.yaml, but a capability the
   * operator is drafting in that folder has no state row: it is not the
   * completion's node, so it stays out of the commit and stays untracked.
   */
  it("leaves an operator's untracked draft out of a folder whose state.yaml the completion writes", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore } = await import("../../src/prd/rex-gateway.js");
    const draftRel = ".rex/product/checkout/refunds.md";
    await writeFile(
      join(projectDir, draftRel),
      [
        "---",
        'id: "a0000000-0000-4000-8000-000000000099"',
        'type: "capability"',
        'title: "Refunds"',
        'slug: "refunds"',
        'statement: "A shopper can be refunded."',
        'criteria: [{"id":"c1","text":"A refund reaches the card"}]',
        "---",
        "",
      ].join("\n"),
    );

    const store = await resolveStore(rexDir);
    await (finalizeRun as Function)({
      run: buildCompletedRun(WIRE_ID),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    const files = changed.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(files).toContain(".rex/product/checkout/state.yaml");
    expect(files).not.toContain(draftRel);
    const { stdout: status } = await execAsync("git status --porcelain -uall", { cwd: projectDir });
    expect(status.split("\n")).toContain(`?? ${draftRel}`);
  });

  it("leaves an operator's untracked draft task out of the change folder whose state.yaml the completion writes", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore } = await import("../../src/prd/rex-gateway.js");
    const draftRel = ".rex/changes/add-apple-pay/draft-step.md";
    await writeFile(
      join(projectDir, draftRel),
      ["---", 'id: "c0000000-0000-4000-8000-000000000098"', 'type: "task"', 'title: "Draft step"', 'slug: "draft-step"', "---", ""].join("\n"),
    );

    const store = await resolveStore(rexDir);
    await (finalizeRun as Function)({
      run: buildCompletedRun(WIRE_ID),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    const files = changed.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(files).toContain(".rex/changes/add-apple-pay/state.yaml");
    expect(files).not.toContain(draftRel);
    const { stdout: status } = await execAsync("git status --porcelain -uall", { cwd: projectDir });
    expect(status.split("\n")).toContain(`?? ${draftRel}`);
  });

  /**
   * An Inbox capture the operator committed is moved out of changes/inbox/ by
   * place_change, an MCP write no hench save report names. Completing it must
   * land the move: staging the new folder without the Inbox deletion would
   * leave the change's id in two folders of HEAD.
   */
  it("lands a placed change's move out of a committed Inbox with its completion", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore } = await import("../../src/prd/rex-gateway.js");
    const changeRel = ".rex/changes/add-apple-pay";
    const inboxRel = ".rex/changes/inbox/add-apple-pay";
    await mkdir(join(rexDir, "changes", "inbox"));
    await execAsync(`git mv ${changeRel} ${inboxRel}`, { cwd: projectDir });
    await execAsync('git commit -q -m "capture in the Inbox"', { cwd: projectDir });
    // place_change: the folder moves on disk; git is not told.
    await rename(join(projectDir, inboxRel), join(projectDir, changeRel));

    const store = await resolveStore(rexDir);
    await (finalizeRun as Function)({
      run: buildCompletedRun(WIRE_ID),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: subject } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
    expect(subject.trim()).toContain(WIRE_ID);
    const { stdout: tree } = await execAsync("git ls-tree -r --name-only HEAD -- .rex/changes", { cwd: projectDir });
    const committed = tree.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(committed).toEqual(
      expect.arrayContaining([`${changeRel}/state.yaml`, `${changeRel}/index.md`, `${changeRel}/wire-the-button.md`]),
    );
    expect(committed.filter((p) => p.startsWith(`${inboxRel}/`))).toEqual([]);
    const { stdout: status } = await execAsync("git status --porcelain -uall", { cwd: projectDir });
    const dirty = status.split("\n").filter(Boolean).map((l) => l.slice(3));
    expect(dirty.filter((p) => p.startsWith(`${inboxRel}/`) || p.startsWith(`${changeRel}/`))).toEqual([]);
  });

  /**
   * Completing a subtask writes only its task folder's state.yaml, deep inside
   * the placed change. The move still lands whole: committing the task folder
   * without the change's own index.md would leave it in a folder rex skips on
   * a clean clone, and the Inbox copy would have lost it.
   */
  it("lands a whole placed change when the completion writes only a nested folder's state", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore, loadPrdModel } = await import("../../src/prd/rex-gateway.js");
    const changeRel = ".rex/changes/add-apple-pay";
    const inboxRel = ".rex/changes/inbox/add-apple-pay";
    const PRESS_ID = "c0000000-0000-4000-8000-000000000021";
    const LABEL_ID = "c0000000-0000-4000-8000-000000000022";
    const taskDir = join(rexDir, "changes", "add-apple-pay", "wire-the-button");
    await mkdir(taskDir);
    await rename(join(rexDir, "changes", "add-apple-pay", "wire-the-button.md"), join(taskDir, "index.md"));
    for (const [id, slug] of [[PRESS_ID, "press"], [LABEL_ID, "label"]]) {
      await writeFile(
        join(taskDir, `${slug}.md`),
        ["---", `id: "${id}"`, 'type: "subtask"', `title: "${slug}"`, `slug: "${slug}"`, "---", ""].join("\n"),
      );
    }
    await writeFile(
      join(rexDir, "changes", "add-apple-pay", "state.yaml"),
      ['schema: "rex/v2"', "items:", `  "${CHANGE_ID}":`, '    status: "in_progress"', ""].join("\n"),
    );
    await writeFile(
      join(taskDir, "state.yaml"),
      [
        'schema: "rex/v2"', "items:",
        `  "${WIRE_ID}":`, '    status: "in_progress"',
        `  "${PRESS_ID}":`, '    status: "in_progress"',
        `  "${LABEL_ID}":`, '    status: "pending"', "",
      ].join("\n"),
    );
    await mkdir(join(rexDir, "changes", "inbox"));
    await execAsync("git add -A", { cwd: projectDir });
    await execAsync(`git mv ${changeRel} ${inboxRel}`, { cwd: projectDir });
    await execAsync('git commit -q -m "capture in the Inbox"', { cwd: projectDir });
    await rename(join(projectDir, inboxRel), join(projectDir, changeRel));

    const store = await resolveStore(rexDir);
    await (finalizeRun as Function)({
      run: buildCompletedRun(PRESS_ID),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: subject } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
    expect(subject.trim()).toContain(PRESS_ID);
    const { stdout: tree } = await execAsync("git ls-tree -r --name-only HEAD -- .rex/changes", { cwd: projectDir });
    const committed = tree.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(committed).toEqual(
      expect.arrayContaining([
        `${changeRel}/index.md`,
        `${changeRel}/state.yaml`,
        `${changeRel}/wire-the-button/index.md`,
        `${changeRel}/wire-the-button/press.md`,
        `${changeRel}/wire-the-button/label.md`,
        `${changeRel}/wire-the-button/state.yaml`,
      ]),
    );
    expect(committed.filter((p) => p.startsWith(`${inboxRel}/`))).toEqual([]);
    const { stdout: status } = await execAsync("git status --porcelain -uall", { cwd: projectDir });
    const dirty = status.split("\n").filter(Boolean).map((l) => l.slice(3));
    expect(dirty.filter((p) => p.startsWith(`${inboxRel}/`) || p.startsWith(`${changeRel}/`))).toEqual([]);

    // A clean checkout of HEAD reads the change once, with its task and subtasks.
    const clone = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-v2-clone-")));
    try {
      await execAsync(`git clone -q "${projectDir}" "${clone}"`);
      const model = await loadPrdModel(join(clone, ".rex"), { warn: () => {} });
      const ids: string[] = [];
      const walk = (nodes: ReadonlyArray<{ id: string; children?: unknown[] }>) => {
        for (const n of nodes) {
          ids.push(n.id);
          if (n.children) walk(n.children as typeof nodes);
        }
      };
      walk(model.tree.changes);
      expect(ids.filter((id) => [CHANGE_ID, WIRE_ID, PRESS_ID, LABEL_ID].includes(id)).sort()).toEqual(
        [CHANGE_ID, WIRE_ID, PRESS_ID, LABEL_ID].sort(),
      );
    } finally {
      await rm(clone, { recursive: true, force: true, ...RM_RETRY });
    }
  });

  /** A deleted Inbox file whose id is not the completed node's is someone else's edit. */
  it("leaves a deleted Inbox change with another id out of the completion commit", async () => {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    const { resolveStore } = await import("../../src/prd/rex-gateway.js");
    const changeRel = ".rex/changes/add-apple-pay";
    const otherInboxRel = ".rex/changes/inbox/add-apple-pay/index.md";
    await execAsync(`git rm -r -q --cached ${changeRel}`, { cwd: projectDir });
    // Another change committed in the Inbox under the same slug.
    await mkdir(join(rexDir, "changes", "inbox", "add-apple-pay"), { recursive: true });
    await writeFile(
      join(projectDir, otherInboxRel),
      ["---", 'id: "c0000000-0000-4000-8000-000000000011"', 'type: "change"', 'title: "Add Apple Pay"', 'slug: "add-apple-pay"', 'intent: "Another."', "---", ""].join("\n"),
    );
    await execAsync(`git add ${otherInboxRel}`, { cwd: projectDir });
    await execAsync('git commit -q -m "another capture"', { cwd: projectDir });
    await rm(join(rexDir, "changes", "inbox"), { recursive: true });

    const store = await resolveStore(rexDir);
    await (finalizeRun as Function)({
      run: buildCompletedRun(WIRE_ID),
      henchDir,
      projectDir,
      autoCommit: true,
      skipFullTestGate: true,
      store,
    });

    const { stdout: changed } = await execAsync("git show --format= --name-only HEAD", { cwd: projectDir });
    const files = changed.split("\n").map((l) => l.trim()).filter(Boolean);
    expect(files).toContain(`${changeRel}/index.md`);
    expect(files).not.toContain(otherInboxRel);
    const { stdout: status } = await execAsync("git status --porcelain -uall", { cwd: projectDir });
    expect(status.split("\n")).toContain(` D ${otherInboxRel}`);
  });
});

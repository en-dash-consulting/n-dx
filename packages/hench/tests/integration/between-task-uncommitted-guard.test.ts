import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../src/prd/rex-gateway.js";
import { initGitFixtureRepo } from "../helpers/index.js";

const execAsync = promisify(execCb);

/**
 * The between-task working-tree guard (#363), against a real git repository.
 *
 * Two defects are covered here, both introduced by the guard's first revision.
 *
 * The guard discounted nothing but hench's runtime artifacts, on the premise
 * that an uncommitted `.rex/prd_tree/` between tasks meant the previous task's
 * status write never landed. That is only true of a task that *succeeded*.
 * Every failure path writes the PRD and commits nothing, so the first failed or
 * deferred task in a `--loop` stopped the loop outright and the
 * consecutive-failure counter and stuck-task skipping were unreachable.
 *
 * The sidecar `.rex/tree-meta.json` is rewritten by every store save, and where
 * the committed copy predates the schema marker the rewrite changes its bytes.
 * It was in nobody's discount list and nobody's staging list.
 */
describe("shouldStopForUncommittedWork", () => {
  let projectDir: string;
  let taskIndexPath: string;
  let treeMetaPath: string;

  /** Import fresh so the module's colour memoisation can't leak across files. */
  async function guard(autonomous: boolean | undefined = true): Promise<boolean> {
    const { shouldStopForUncommittedWork } = await import("../../src/cli/commands/run.js");
    return shouldStopForUncommittedWork(projectDir, autonomous);
  }

  /** Rewrite the task's status the way `handleRunFailure` does — no commit. */
  async function writeStatus(status: string): Promise<void> {
    const current = await readFile(taskIndexPath, "utf-8");
    await writeFile(taskIndexPath, current.replace(/status: \w+/, `status: ${status}`), "utf-8");
  }

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-between-task-guard-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;

    await initGitFixtureRepo(projectDir);

    const taskDir = join(projectDir, ".rex", PRD_TREE_DIRNAME, "task-slug-abc");
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Test task\nstatus: in_progress\n", "utf-8");
    treeMetaPath = join(projectDir, ".rex", TREE_META_FILENAME);
    // The pre-marker shape this repo's merge base carried.
    await writeFile(treeMetaPath, JSON.stringify({ title: "PRD" }), "utf-8");

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await rm(projectDir, { recursive: true, force: true });
  });

  it("continues the loop on a clean tree", async () => {
    await expect(guard()).resolves.toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it("continues when the previous task only left a deferred status write", async () => {
    // Task 1 was deferred: handleRunFailure wrote the status and nothing
    // committed it, because both committers run only for a completed run.
    await writeStatus("deferred");

    await expect(guard()).resolves.toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it("continues when the only dirt is the rewritten tree-meta sidecar", async () => {
    await writeFile(treeMetaPath, JSON.stringify({ title: "PRD", schema: "rex/v1" }), "utf-8");

    await expect(guard()).resolves.toBe(false);
    expect(process.exitCode).toBeUndefined();
  });

  it("stops when the previous task leaked a code file, even alongside a PRD write", async () => {
    await writeStatus("deferred");
    await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");

    await expect(guard()).resolves.toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it("still stops on operator .rex content outside the PRD paths", async () => {
    await writeFile(join(projectDir, ".rex", "config.json"), "{}\n", "utf-8");

    await expect(guard()).resolves.toBe(true);
    expect(process.exitCode).toBe(1);
  });

  it("leaves attended runs alone", async () => {
    // A user who declined the commit prompt made that choice and is watching.
    await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");

    await expect(guard(false)).resolves.toBe(false);
    expect(process.exitCode).toBeUndefined();
  });
});

/**
 * Every autonomous mode must run the guard between tasks.
 *
 * `--epic-by-epic` iterates tasks in `runEpicByEpic`'s own `while (true)` loop,
 * which was never wired to the guard, so the tangling the guard exists to stop
 * still happened there. A behavioural test would have to drive `runOne`, which
 * spawns a real LLM CLI; this asserts the wiring instead, per mode, so a fourth
 * mode (or a refactor that drops a call) cannot repeat the omission silently.
 */
describe("between-task guard wiring", () => {
  const MODES = ["runIterations", "runLoop", "runEpicByEpic"] as const;

  it.each(MODES)("%s calls shouldStopForUncommittedWork", async (mode) => {
    const source = await readFile(
      new URL("../../src/cli/commands/run.ts", import.meta.url),
      "utf-8",
    );
    const start = source.indexOf(`async function ${mode}(`);
    expect(start, `${mode} not found in run.ts`).toBeGreaterThan(-1);
    const next = MODES.map((m) => source.indexOf(`async function ${m}(`))
      .filter((i) => i > start)
      .sort((a, b) => a - b)[0] ?? source.length;

    expect(source.slice(start, next)).toContain("shouldStopForUncommittedWork(");
  });
});

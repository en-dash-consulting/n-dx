/**
 * A run must not leave its own housekeeping in the working tree.
 *
 * `.run-logs/` needs a .gitignore entry, and the append used to happen inside
 * `persistRunLog` — which finalize calls AFTER the commit step. The append is
 * idempotent, so it fired once per project and left exactly one modified
 * tracked file behind, with nothing left in the run to commit it. Two people
 * paid for that: the edit rode the NEXT run's `git add -A` into a "commit local
 * changes before hench run" commit attributed to unrelated work, and an
 * autonomous run (`--auto`/`--loop`/`--epic-by-epic`) that aborts on a dirty
 * tree could be blocked by hench's own writes.
 *
 * The entry is now claimed at run START, so the run that needs it is the run
 * that commits it. These tests model that ordering against a real repo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { initGitFixtureRepo } from "../helpers/index.js";

const execAsync = promisify(execCb);

async function gitStatus(dir: string): Promise<string[]> {
  const { stdout } = await execAsync("git status --porcelain", { cwd: dir });
  return stdout.split("\n").map((l) => l.replace(/\r/g, "")).filter(Boolean);
}

describe("run-log .gitignore residue", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-runlog-residue-"));
    henchDir = join(projectDir, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    // A project whose .gitignore predates the `.run-logs/` entry — the exact
    // starting condition that produced the residue.
    await writeFile(join(projectDir, ".gitignore"), "node_modules/\n.hench/\n", "utf-8");
    await writeFile(join(projectDir, "src.ts"), "export const x = 1;\n", "utf-8");
    await execAsync("git add -A", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("leaves the tree clean after a run whose .gitignore lacked the entry", async () => {
    const { initRunRecord } = await import("../../src/agent/lifecycle/shared.js");
    const { persistRunLog } = await import("../../src/store/run-log.js");

    expect(await gitStatus(projectDir)).toEqual([]);

    // Run start — where the ignore entry is now claimed.
    const { run } = await initRunRecord({
      taskId: "task-1",
      taskTitle: "Test task",
      model: "claude-sonnet-5",
      henchDir,
      projectDir,
    });

    // The entry is in place BEFORE the run commits, so the run's own
    // `git add -A` picks it up like any other change it made.
    expect(await readFile(join(projectDir, ".gitignore"), "utf-8")).toContain(".run-logs/");

    await writeFile(join(projectDir, "src.ts"), "export const x = 2;\n", "utf-8");
    await execAsync("git add -A", { cwd: projectDir });
    await execAsync('git commit -m "feat: the run\'s work"', { cwd: projectDir });

    // Finalize writes the log itself, after the commit. It must add nothing
    // the commit could not have covered.
    await persistRunLog(projectDir, run.id, run.startedAt, ["some output"]);

    // Nothing left behind: the log directory is ignored, and the ignore entry
    // that makes it so was committed by the run that created it.
    expect(await gitStatus(projectDir)).toEqual([]);
  });

  it("leaves the tree clean on a second run, having already claimed the entry", async () => {
    const { initRunRecord } = await import("../../src/agent/lifecycle/shared.js");
    const { persistRunLog } = await import("../../src/store/run-log.js");

    const first = await initRunRecord({
      taskId: "task-1", taskTitle: "First", model: "m", henchDir, projectDir,
    });
    await execAsync("git add -A", { cwd: projectDir });
    await execAsync('git commit -m "run one"', { cwd: projectDir });
    await persistRunLog(projectDir, first.run.id, first.run.startedAt, ["one"]);

    expect(await gitStatus(projectDir)).toEqual([]);

    // The second run re-runs the same idempotent ensure. It must not re-dirty
    // the tree — this is the `--loop` / `--iterations` case, where run start
    // happens once per task rather than once per project.
    const second = await initRunRecord({
      taskId: "task-2", taskTitle: "Second", model: "m", henchDir, projectDir,
    });
    await persistRunLog(projectDir, second.run.id, second.run.startedAt, ["two"]);

    expect(await gitStatus(projectDir)).toEqual([]);
  });

  it("creates .gitignore when the project has none", async () => {
    const { initRunRecord } = await import("../../src/agent/lifecycle/shared.js");

    await execAsync("git rm --cached .gitignore", { cwd: projectDir });
    await rm(join(projectDir, ".gitignore"));
    await execAsync("git add -A", { cwd: projectDir });
    await execAsync('git commit -m "drop gitignore"', { cwd: projectDir });

    await initRunRecord({
      taskId: "task-1", taskTitle: "Test", model: "m", henchDir, projectDir,
    });

    expect(await readFile(join(projectDir, ".gitignore"), "utf-8")).toContain(".run-logs/");
  });
});

/**
 * Regression test for the defect this pairing fixes: the full-suite gate
 * skipped precisely when the adversarial review pass had changed code.
 *
 * Observed live in run 4b4526c5 — the executor wrote 2 files, the reviewer
 * edited 4, and the gate still printed "Skipped: No files modified in prior
 * phases". These tests reproduce the two shapes that caused it against a real
 * git repo, then assert the gate now receives a non-empty set and runs.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { initGitFixtureRepoSync } from "../helpers/index.js";
// These cases assert the gate actually RAN, which needs the `sh -c` that
// runTestGate spawns on every platform — so they are shell-dependent for real,
// not shape-only. See tests/shell-spawn-inventory.md.
import { itNeedsPosixShell } from "../helpers/posix-shell.js";
import { discoverChangedFiles } from "../../src/agent/analysis/changed-files.js";
import { runTestGate } from "../../src/tools/test-runner.js";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

describe("full-suite gate no longer skips changed runs", () => {
  let projectDir: string;
  let startingHead: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-changed-"));
    initGitFixtureRepoSync(projectDir);
    await writeFile(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "p", version: "1.0.0", scripts: { test: "exit 0" } }),
    );
    await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-m", "baseline");
    startingHead = git(projectDir, "rev-parse", "HEAD").trim();
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  itNeedsPosixShell("runs the gate when only the reviewer changed files after a self-committing executor", async () => {
    // The exact live sequence: executor commits its own work, then the
    // reviewer repairs in the working tree. Previously filesChanged was
    // empty here (model summary said nothing, `git diff HEAD` saw nothing
    // because the work was committed), so the gate skipped.
    await writeFile(join(projectDir, "src.ts"), "export const a = 2;\n");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-m", "feat: executor work");
    await writeFile(join(projectDir, "src.ts"), "export const a = 3; // reviewer repair\n");
    await writeFile(join(projectDir, "src.test.ts"), "regression test\n");

    const filesChanged = await discoverChangedFiles({ projectDir, startingHead });
    expect(filesChanged?.sort()).toEqual(["src.test.ts", "src.ts"]);

    const result = await runTestGate({ projectDir, filesChanged: filesChanged ?? [], testCommand: "exit 0" });
    expect(result.ran).toBe(true);
    expect(result.skipReason).toBeUndefined();
  });

  itNeedsPosixShell("runs the gate when the executor committed and nothing else touched the tree", async () => {
    await writeFile(join(projectDir, "src.ts"), "export const a = 2;\n");
    git(projectDir, "add", "-A");
    git(projectDir, "commit", "-m", "feat: executor work");

    const filesChanged = await discoverChangedFiles({ projectDir, startingHead });
    expect(filesChanged).toEqual(["src.ts"]);

    const result = await runTestGate({ projectDir, filesChanged: filesChanged ?? [], testCommand: "exit 0" });
    expect(result.ran).toBe(true);
  });

  // No guard: an empty changed set returns before any spawn, so this case
  // never reaches `sh`.
  it("still skips when the run genuinely changed nothing", async () => {
    const filesChanged = await discoverChangedFiles({ projectDir, startingHead });
    expect(filesChanged).toEqual([]);

    const result = await runTestGate({ projectDir, filesChanged: filesChanged ?? [], testCommand: "exit 0" });
    expect(result.ran).toBe(false);
    expect(result.skipReason).toBe("No files modified in prior phases");
  });
});

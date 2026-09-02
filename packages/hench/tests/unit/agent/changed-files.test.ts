/**
 * Tests for git-derived changed-file discovery.
 *
 * The full-suite gate skips when it believes nothing changed, so the set this
 * module returns decides whether a run's tests run at all. The cases that
 * matter are the ones the previous model-reported/`git diff HEAD` approach got
 * wrong: work the executor already committed (invisible to `git diff HEAD`),
 * repairs the reviewer made after the summary was parsed, and the user's
 * pre-existing untracked files, which are not this run's changes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { initGitFixtureRepoSync } from "../../helpers/index.js";
import { discoverChangedFiles } from "../../../src/agent/analysis/changed-files.js";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

describe("discoverChangedFiles", () => {
  let repoDir: string;
  let startingHead: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "hench-changed-files-"));
    initGitFixtureRepoSync(repoDir);
    await writeFile(join(repoDir, "base.ts"), "export const base = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-m", "baseline");
    startingHead = git(repoDir, "rev-parse", "HEAD").trim();
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("returns an empty list when nothing changed since the baseline", async () => {
    expect(await discoverChangedFiles({ projectDir: repoDir, startingHead })).toEqual([]);
  });

  it("sees uncommitted modifications", async () => {
    await writeFile(join(repoDir, "base.ts"), "export const base = 2;\n");

    expect(await discoverChangedFiles({ projectDir: repoDir, startingHead })).toEqual(["base.ts"]);
  });

  it("sees work the executor already committed — the git-diff-HEAD blind spot", async () => {
    // The autoCommit path has the executor commit its own work before the
    // gate runs, so `git diff HEAD` reports nothing and the gate skipped.
    await writeFile(join(repoDir, "work.ts"), "export const work = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-m", "feat: executor work");

    expect(await discoverChangedFiles({ projectDir: repoDir, startingHead })).toEqual(["work.ts"]);
  });

  it("sees committed work and a later uncommitted repair together", async () => {
    // Executor commits; the reviewer then repairs in the working tree. Both
    // must be in the set the gate tests.
    await writeFile(join(repoDir, "work.ts"), "export const work = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-m", "feat: executor work");
    await writeFile(join(repoDir, "work.ts"), "export const work = 2; // repaired\n");
    await writeFile(join(repoDir, "work.test.ts"), "regression test\n");

    const changed = await discoverChangedFiles({ projectDir: repoDir, startingHead });
    expect(changed.sort()).toEqual(["work.test.ts", "work.ts"]);
  });

  it("includes new untracked files the run created", async () => {
    await writeFile(join(repoDir, "created.ts"), "new file\n");

    expect(await discoverChangedFiles({ projectDir: repoDir, startingHead })).toEqual([
      "created.ts",
    ]);
  });

  it("excludes untracked files that existed before the run", async () => {
    await writeFile(join(repoDir, "user-scratch.ts"), "pre-existing\n");
    const baselineUntracked = ["user-scratch.ts"];
    await writeFile(join(repoDir, "created.ts"), "new file\n");

    const changed = await discoverChangedFiles({
      projectDir: repoDir,
      startingHead,
      baselineUntracked,
    });
    expect(changed).toEqual(["created.ts"]);
  });

  it("excludes files under a pre-existing untracked directory", async () => {
    // The rollback baseline records directories, not their contents, so a
    // directory-shaped baseline entry has to exclude what is inside it.
    await mkdir(join(repoDir, "scratch"), { recursive: true });
    await writeFile(join(repoDir, "scratch/notes.md"), "user's own\n");
    const baselineUntracked = ["scratch/"];
    await writeFile(join(repoDir, "created.ts"), "new file\n");

    const changed = await discoverChangedFiles({
      projectDir: repoDir,
      startingHead,
      baselineUntracked,
    });
    expect(changed).toEqual(["created.ts"]);
  });

  it("sees deletions", async () => {
    await unlink(join(repoDir, "base.ts"));

    expect(await discoverChangedFiles({ projectDir: repoDir, startingHead })).toEqual(["base.ts"]);
  });

  it("finds files inside newly created directories", async () => {
    await mkdir(join(repoDir, "src/deep"), { recursive: true });
    await writeFile(join(repoDir, "src/deep/mod.ts"), "nested\n");

    expect(await discoverChangedFiles({ projectDir: repoDir, startingHead })).toEqual([
      "src/deep/mod.ts",
    ]);
  });

  it("does not report the same path twice when it is both diffed and untracked-adjacent", async () => {
    await writeFile(join(repoDir, "base.ts"), "export const base = 2;\n");
    await writeFile(join(repoDir, "created.ts"), "new\n");

    const changed = await discoverChangedFiles({ projectDir: repoDir, startingHead });
    expect(changed.sort()).toEqual(["base.ts", "created.ts"]);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it("falls back to HEAD when no starting head was captured", async () => {
    await writeFile(join(repoDir, "base.ts"), "export const base = 2;\n");

    expect(await discoverChangedFiles({ projectDir: repoDir })).toEqual(["base.ts"]);
  });

  it("returns undefined outside a git repository, so the caller can tell it apart from 'nothing changed'", async () => {
    const notARepo = await mkdtemp(join(tmpdir(), "hench-not-a-repo-"));
    try {
      expect(await discoverChangedFiles({ projectDir: notARepo })).toBeUndefined();
    } finally {
      await rm(notARepo, { recursive: true, force: true });
    }
  });

  it("returns undefined for an unknown starting head rather than a misleading empty set", async () => {
    const changed = await discoverChangedFiles({
      projectDir: repoDir,
      startingHead: "0000000000000000000000000000000000000000",
    });
    expect(changed).toBeUndefined();
  });
});

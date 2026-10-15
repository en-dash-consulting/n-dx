/**
 * The fail-forward commit engine.
 *
 * The properties under test are the ones that make the mode safe to leave on:
 * it commits only what it was given, it refuses to touch work that belongs to
 * the operator or to an in-progress merge, it puts the index back when it
 * fails, and it never pushes. A bug in any of those turns a convenience into
 * a mode that quietly destroys work.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execSync } from "node:child_process";

import {
  commitFailForward,
  failForwardSubject,
} from "../../../../src/agent/lifecycle/fail-forward.js";
import {
  initGitFixtureRepoSync,
  commitGitFixtureBaseline,
  gitCommitTrailers,
} from "../../../helpers/index.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

describe("commitFailForward", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fail-forward-"));
    initGitFixtureRepoSync(dir);
    writeFileSync(join(dir, "kept.txt"), "v1\n");
    commitGitFixtureBaseline(dir, "init");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ── What it commits ────────────────────────────────────────────────

  it("commits nothing when given no paths, and reports no error", async () => {
    const before = git(dir, ["rev-parse", "HEAD"]).trim();
    const result = await commitFailForward(dir, [], "loop-leftover");
    expect(result).toEqual({ committed: false, paths: [], skipped: [] });
    expect(git(dir, ["rev-parse", "HEAD"]).trim()).toBe(before);
  });

  it("stages and commits exactly the paths it is given", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    writeFileSync(join(dir, "b.txt"), "also new\n");

    const result = await commitFailForward(dir, ["a.txt"], "loop-leftover");
    expect(result.committed).toBe(true);
    expect(result.paths).toEqual(["a.txt"]);

    const files = git(dir, ["show", "--name-only", "--pretty=", "HEAD"]);
    expect(files).toContain("a.txt");
    expect(files).not.toContain("b.txt");
    expect(git(dir, ["status", "--porcelain"])).toContain("b.txt");
  });

  it("commits a deletion as a deletion", async () => {
    rmSync(join(dir, "kept.txt"));
    const result = await commitFailForward(dir, ["kept.txt"], "loop-leftover");
    expect(result.committed).toBe(true);
    expect(git(dir, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("commits a file in a nested directory", async () => {
    mkdirSync(join(dir, "nested", "deep"), { recursive: true });
    writeFileSync(join(dir, "nested", "deep", "x.txt"), "new\n");
    const result = await commitFailForward(dir, ["nested/deep/x.txt"], "loop-leftover");
    expect(result.committed).toBe(true);
    expect(git(dir, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("treats a glob character in a filename literally, on both the add and the commit", async () => {
    // `report[1].txt` is a character class to git. Without :(literal) on the
    // *commit* pathspec too, it would also match `report1.txt` and take its
    // working-tree content. (`?` would read more clearly but is not a legal
    // filename character on Windows.)
    writeFileSync(join(dir, "report[1].txt"), "odd\n");
    writeFileSync(join(dir, "report1.txt"), "operator work\n");

    const result = await commitFailForward(dir, ["report[1].txt"], "loop-leftover");
    expect(result.committed).toBe(true);

    const files = git(dir, ["show", "--name-only", "--pretty=", "HEAD"]);
    expect(files).toContain("report[1].txt");
    expect(files).not.toContain("report1.txt");
    expect(git(dir, ["status", "--porcelain"])).toContain("report1.txt");
  });

  // ── What it refuses to touch ───────────────────────────────────────

  it("leaves a file the operator staged by hand alone", async () => {
    // The whole-file case: `git add` would be a no-op but the pathspec commit
    // would still commit their content under a fail-forward message.
    writeFileSync(join(dir, "kept.txt"), "operator edit\n");
    git(dir, ["add", "kept.txt"]);

    const result = await commitFailForward(dir, ["kept.txt"], "loop-leftover");
    expect(result.committed).toBe(false);
    expect(result.skipped).toEqual([{ path: "kept.txt", reason: "staged" }]);
    expect(git(dir, ["diff", "--cached", "--name-only"])).toContain("kept.txt");
  });

  it("leaves a git add -p hunk selection alone", async () => {
    // A partially staged file is MM in porcelain. `git add` would overwrite
    // the hunk selection with the whole working-tree file.
    writeFileSync(join(dir, "kept.txt"), "staged part\n");
    git(dir, ["add", "kept.txt"]);
    writeFileSync(join(dir, "kept.txt"), "staged part\nunstaged part\n");
    expect(git(dir, ["status", "--porcelain"])).toContain("MM");

    const result = await commitFailForward(dir, ["kept.txt"], "loop-leftover");
    expect(result.committed).toBe(false);
    expect(result.skipped).toEqual([{ path: "kept.txt", reason: "staged" }]);
    // The selection survives untouched.
    expect(git(dir, ["show", ":kept.txt"])).toBe("staged part\n");
  });

  it("commits the eligible paths and skips the operator's in one call", async () => {
    writeFileSync(join(dir, "run-output.txt"), "from the run\n");
    writeFileSync(join(dir, "kept.txt"), "operator edit\n");
    git(dir, ["add", "kept.txt"]);

    const result = await commitFailForward(
      dir, ["run-output.txt", "kept.txt"], "loop-leftover",
    );
    expect(result.committed).toBe(true);
    expect(result.paths).toEqual(["run-output.txt"]);
    expect(result.skipped).toEqual([{ path: "kept.txt", reason: "staged" }]);
  });

  it("refuses outright while a rebase is in progress", async () => {
    // Reproduced defect: `git add` on a conflicted path MARKS IT RESOLVED,
    // and mid-rebase there is no MERGE_HEAD to make the partial commit fail —
    // so without this guard the conflict markers are committed and the loop
    // continues on top of them.
    writeFileSync(join(dir, "f.txt"), "base\n");
    git(dir, ["add", "f.txt"]);
    git(dir, ["commit", "-m", "base"]);
    git(dir, ["checkout", "-qb", "feature"]);
    writeFileSync(join(dir, "f.txt"), "feature\n");
    git(dir, ["commit", "-qam", "feature"]);
    git(dir, ["checkout", "-q", "main"]);
    writeFileSync(join(dir, "f.txt"), "mainline\n");
    git(dir, ["commit", "-qam", "mainline"]);
    git(dir, ["checkout", "-q", "feature"]);
    try {
      execSync("git rebase main", { cwd: dir, stdio: "ignore" });
    } catch {
      // Expected: the rebase stops on the conflict.
    }
    expect(git(dir, ["status", "--porcelain"])).toContain("UU");
    const head = git(dir, ["rev-parse", "HEAD"]).trim();

    const result = await commitFailForward(dir, ["f.txt"], "loop-leftover");
    expect(result.committed).toBe(false);
    expect(result.error?.message).toMatch(/in progress/);

    // Nothing committed, and the conflict is still a conflict.
    expect(git(dir, ["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(git(dir, ["status", "--porcelain"])).toContain("UU");
    expect(readFileSync(join(dir, "f.txt"), "utf-8")).toContain("<<<<<<<");
  });

  // ── Failure behaviour ──────────────────────────────────────────────

  it("reports an error rather than throwing when a path does not exist", async () => {
    const result = await commitFailForward(dir, ["does-not-exist.txt"], "loop-leftover");
    expect(result.committed).toBe(false);
    // Not dirty and not present: nothing to do, nothing to blame.
    expect(result.paths).toEqual([]);
  });

  it("puts the index back when the commit fails part way", async () => {
    // Force the commit to fail *after* the add has already happened. A bogus
    // signing program does that on every platform, where a shell hook would
    // depend on sh being on PATH.
    git(dir, ["config", "commit.gpgsign", "true"]);
    git(dir, ["config", "gpg.program", "definitely-not-a-program"]);

    writeFileSync(join(dir, "a.txt"), "new\n");
    const result = await commitFailForward(dir, ["a.txt"], "loop-leftover");

    expect(result.committed).toBe(false);
    expect(result.error).toBeDefined();
    // Nothing left staged.
    expect(git(dir, ["diff", "--cached", "--name-only"]).trim()).toBe("");
  });

  // ── Message and trailers ───────────────────────────────────────────

  it("uses the constant subject for its kind", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "loop-leftover");
    expect(git(dir, ["log", "-1", "--pretty=%s"]).trim())
      .toBe(failForwardSubject("loop-leftover"));
  });

  it("names the producer exactly, so these commits are greppable by kind", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "loop-leftover");
    const trailers = gitCommitTrailers(dir);
    expect(trailers).toContainEqual(["N-DX", "fail-forward (loop boundary)"]);
    expect(trailers.map(([k]) => k)).toContain("Co-Authored-By");
  });

  it("names the PRD item when the work belongs to one", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "loop-leftover", "task-123");
    expect(gitCommitTrailers(dir)).toContainEqual(["N-DX-Item", "task-123"]);
  });

  it("omits the item trailer when there is no item", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "loop-leftover");
    expect(gitCommitTrailers(dir).map(([k]) => k)).not.toContain("N-DX-Item");
  });

  // ── The promise the module leads with ──────────────────────────────

  it("never pushes", async () => {
    // A bare repo as origin: if anything in here ever runs `git push`, the
    // remote moves and this fails.
    const remote = mkdtempSync(join(tmpdir(), "fail-forward-remote-"));
    try {
      execSync("git init -q --bare .", { cwd: remote, stdio: "ignore" });
      git(dir, ["remote", "add", "origin", remote]);
      git(dir, ["push", "-q", "origin", "HEAD:refs/heads/seed"]);
      const remoteBefore = execFileSync("git", ["rev-parse", "refs/heads/seed"], {
        cwd: remote, encoding: "utf-8",
      }).trim();

      writeFileSync(join(dir, "a.txt"), "new\n");
      expect((await commitFailForward(dir, ["a.txt"], "loop-leftover")).committed).toBe(true);

      const remoteAfter = execFileSync("git", ["rev-parse", "refs/heads/seed"], {
        cwd: remote, encoding: "utf-8",
      }).trim();
      expect(remoteAfter).toBe(remoteBefore);
    } finally {
      rmSync(remote, { recursive: true, force: true });
    }
  }, 30_000);
});

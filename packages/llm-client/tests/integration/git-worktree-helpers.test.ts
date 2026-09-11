import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getWorktreeRoot, getGitCommonDir } from "../../src/exec.js";

/**
 * getWorktreeRoot / getGitCommonDir against real repositories.
 *
 * These use real git rather than an injected seam because the distinction they
 * exist for is entirely git's: in a linked worktree `--show-toplevel` reports
 * that worktree's own root while `--git-common-dir` still reports the shared
 * `.git` of the main checkout. No mock can establish that relationship, and
 * getting it wrong is exactly the bug the callers guard against — a run that
 * commits into whichever worktree it happens to find.
 *
 * Argv shape and the null paths are covered by mocked cases in
 * tests/unit/exec.test.ts.
 */

/** git with an identity, so `commit` works on a machine with no global config. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.email=test@example.com",
      "-c",
      "user.name=Test",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/**
 * Realpath'd throughout: on macOS `os.tmpdir()` is `/var/folders/...`, itself
 * reached through the `/var` → `/private/var` symlink. The helpers resolve
 * symlinks, so the expected values must be resolved too or every assertion
 * fails on a difference that is not the one under test.
 */
let tmpRoot: string;
/** Main checkout. */
let repo: string;
/** Linked worktree of `repo`, created with `git worktree add`. */
let linked: string;
/** Plain directory, never a repository. */
let outside: string;

beforeAll(() => {
  // `.native`: on Windows os.tmpdir() hands back an 8.3 short name and only
  // the OS realpath expands it, which is the form the helpers return.
  tmpRoot = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-worktree-helpers-")));

  repo = join(tmpRoot, "main");
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "commit", "--allow-empty", "--quiet", "-m", "root");

  linked = join(tmpRoot, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);

  outside = join(tmpRoot, "outside");
  mkdirSync(outside);
});

afterAll(() => {
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("getWorktreeRoot against real repositories", () => {
  it("returns the checkout root from the checkout root", () => {
    expect(getWorktreeRoot(repo)).toBe(repo);
  });

  it("returns the checkout root from a subdirectory", () => {
    const nested = join(repo, "a", "b");
    mkdirSync(nested, { recursive: true });

    expect(getWorktreeRoot(nested)).toBe(repo);
  });

  it("returns the linked worktree's own root, not the main checkout's", () => {
    expect(getWorktreeRoot(linked)).toBe(linked);
    expect(getWorktreeRoot(linked)).not.toBe(repo);
  });

  it("returns null outside a repository", () => {
    expect(getWorktreeRoot(outside)).toBeNull();
  });
});

describe("getGitCommonDir against real repositories", () => {
  it("returns an absolute path from the main checkout", () => {
    expect(getGitCommonDir(repo)).toBe(join(repo, ".git"));
  });

  // The point of --git-common-dir over --git-dir: it is the identity of the
  // repository, shared by every worktree, so two worktrees of one repo can be
  // distinguished from two unrelated clones.
  it("is the same for the main checkout and a linked worktree", () => {
    expect(getGitCommonDir(linked)).toBe(getGitCommonDir(repo));
  });

  it("returns null outside a repository", () => {
    expect(getGitCommonDir(outside)).toBeNull();
  });
});

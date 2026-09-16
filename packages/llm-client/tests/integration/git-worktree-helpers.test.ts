import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getWorktreeRoot, getGitCommonDir, listWorktrees } from "../../src/exec.js";

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
/** Linked worktree of `repo` with a detached HEAD. */
let detached: string;
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

  detached = join(tmpRoot, "detached");
  git(repo, "worktree", "add", "--quiet", "--detach", detached);

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

describe("listWorktrees against real repositories", () => {
  // Only the main checkout's position is git's contract; the linked ones
  // follow in whatever order git chooses (by path in current versions).
  it("lists the main checkout first, then every linked worktree", async () => {
    const list = await listWorktrees(repo);

    expect(list[0]).toMatchObject({ path: repo, isMain: true });
    expect(list.slice(1).map((w) => w.path).sort()).toEqual([linked, detached].sort());
    expect(list.slice(1).every((w) => !w.isMain)).toBe(true);
  });

  it("reports each worktree's branch and HEAD", async () => {
    const list = await listWorktrees(repo);
    const head = git(repo, "rev-parse", "HEAD").trim();

    expect(list.find((w) => w.path === repo)).toMatchObject({ branch: "main", head, detached: false, bare: false });
    expect(list.find((w) => w.path === linked)).toMatchObject({ branch: "side", head, detached: false, bare: false });
  });

  it("a detached worktree has no branch", async () => {
    const wt = (await listWorktrees(repo)).find((w) => w.path === detached);

    expect(wt).toMatchObject({ branch: null, detached: true, isMain: false });
    expect(wt?.head).toBe(git(detached, "rev-parse", "HEAD").trim());
  });

  // The list describes the repository, not the caller's position in it.
  it("is the same from a linked worktree and from a subdirectory", async () => {
    const fromMain = await listWorktrees(repo);
    const nested = join(repo, "a", "b");
    mkdirSync(nested, { recursive: true });

    expect(await listWorktrees(linked)).toEqual(fromMain);
    expect(await listWorktrees(nested)).toEqual(fromMain);
  });

  it("paths compare equal to getWorktreeRoot for the same directory", async () => {
    const list = await listWorktrees(linked);

    expect(list.find((w) => w.path === getWorktreeRoot(linked))).toBeDefined();
  });

  it("a repository with no linked worktrees lists only itself", async () => {
    const solo = join(tmpRoot, "solo");
    mkdirSync(solo);
    git(solo, "init", "--quiet", "--initial-branch=main");
    git(solo, "commit", "--allow-empty", "--quiet", "-m", "root");

    expect(await listWorktrees(solo)).toEqual([
      {
        path: solo,
        branch: "main",
        head: git(solo, "rev-parse", "HEAD").trim(),
        isMain: true,
        detached: false,
        bare: false,
      },
    ]);
  });

  it("a bare repository is a single bare entry", async () => {
    const bare = join(tmpRoot, "bare.git");
    mkdirSync(bare);
    git(bare, "init", "--quiet", "--bare");

    expect(await listWorktrees(bare)).toEqual([
      { path: bare, branch: null, head: null, isMain: true, detached: false, bare: true },
    ]);
  });

  it("returns [] outside a repository", async () => {
    expect(await listWorktrees(outside)).toEqual([]);
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

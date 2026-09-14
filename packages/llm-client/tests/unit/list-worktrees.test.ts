/**
 * listWorktrees — enumerate a repository's checkouts via
 * `git worktree list --porcelain`.
 *
 * Exercised against real git repositories rather than canned porcelain: the
 * helper's contract includes what git actually prints (entry separators,
 * refs/heads/ stripping, the detached marker) and the realpath resolution of
 * the returned paths, neither of which a string fixture can regress. The
 * degraded answers — not a repo, git unreachable — are pinned as `[]`, never
 * a throw: callers ask "which worktrees" and must be able to take "none I
 * can name" without a try/catch.
 *
 * @see packages/llm-client/src/exec.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listWorktrees } from "../../src/exec.js";

function git(cwd: string, args: string[]): string {
  return execFileSync(
    "git",
    ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args],
    { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("listWorktrees", () => {
  let baseDir: string;
  let repo: string;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "llm-list-worktrees-"));
    repo = join(baseDir, "repo");
    execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
    await writeFile(join(repo, "a.txt"), "a\n", "utf-8");
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-m", "init"]);
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("lists the main worktree alone, marked as main, on its branch", async () => {
    const worktrees = await listWorktrees(repo);
    expect(worktrees).toHaveLength(1);
    const [main] = worktrees;
    expect(main!.isMain).toBe(true);
    expect(main!.branch).toBe("main");
    expect(main!.detached).toBe(false);
    expect(main!.bare).toBe(false);
    expect(main!.head).toMatch(/^[0-9a-f]{40}$/);
    expect(main!.path).toBe(realpathSync.native(repo));
  });

  it("lists linked and detached worktrees with the main entry first", async () => {
    const linked = join(baseDir, "wt-linked");
    const detached = join(baseDir, "wt-detached");
    const head = git(repo, ["rev-parse", "HEAD"]).trim();
    git(repo, ["worktree", "add", linked, "-b", "feature"]);
    git(repo, ["worktree", "add", "--detach", detached, head]);

    // Query from the LINKED worktree — the listing is repository-wide and
    // main must stay first regardless of where the question is asked from.
    const worktrees = await listWorktrees(linked);
    expect(worktrees.map((w) => w.isMain)).toEqual([true, false, false]);
    expect(worktrees[0]!.path).toBe(realpathSync.native(repo));

    const linkedEntry = worktrees.find((w) => w.path === realpathSync.native(linked));
    expect(linkedEntry).toBeDefined();
    expect(linkedEntry!.branch).toBe("feature");
    expect(linkedEntry!.detached).toBe(false);

    const detachedEntry = worktrees.find((w) => w.path === realpathSync.native(detached));
    expect(detachedEntry).toBeDefined();
    expect(detachedEntry!.branch).toBeNull();
    expect(detachedEntry!.detached).toBe(true);
    expect(detachedEntry!.head).toBe(head);
  });

  it("answers [] for a directory that is not a git repository", async () => {
    const plain = await mkdtemp(join(baseDir, "not-a-repo-"));
    expect(await listWorktrees(plain)).toEqual([]);
  });

  it("answers [] when git itself is unreachable", async () => {
    // An empty PATH makes the git spawn fail with ENOENT on every platform —
    // the closest portable stand-in for a machine without git.
    const savedPath = process.env.PATH;
    const savedPathWin = process.env.Path;
    try {
      delete process.env.PATH;
      delete process.env.Path;
      expect(await listWorktrees(repo)).toEqual([]);
    } finally {
      if (savedPath !== undefined) process.env.PATH = savedPath;
      if (savedPathWin !== undefined) process.env.Path = savedPathWin;
    }
  });
});

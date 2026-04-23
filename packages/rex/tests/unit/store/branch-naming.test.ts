import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  sanitizeBranchName,
  resolveGitBranch,
  getFirstCommitDate,
} from "../../../src/store/branch-naming.js";

// ---------------------------------------------------------------------------
// Pure-function tests (no git needed)
// ---------------------------------------------------------------------------

describe("sanitizeBranchName", () => {
  it("passes through simple branch names unchanged", () => {
    expect(sanitizeBranchName("main")).toBe("main");
    expect(sanitizeBranchName("develop")).toBe("develop");
  });

  it("replaces slashes with hyphens", () => {
    expect(sanitizeBranchName("feature/my-feature")).toBe("feature-my-feature");
    expect(sanitizeBranchName("user/name/topic")).toBe("user-name-topic");
  });

  it("replaces backslashes with hyphens", () => {
    expect(sanitizeBranchName("feature\\my-branch")).toBe("feature-my-branch");
  });

  it("replaces special characters with hyphens", () => {
    expect(sanitizeBranchName("feat:thing")).toBe("feat-thing");
    expect(sanitizeBranchName("a*b?c")).toBe("a-b-c");
    expect(sanitizeBranchName('name"quoted')).toBe("name-quoted");
    expect(sanitizeBranchName("a<b>c")).toBe("a-b-c");
    expect(sanitizeBranchName("a|b")).toBe("a-b");
  });

  it("replaces spaces and tildes", () => {
    expect(sanitizeBranchName("my branch")).toBe("my-branch");
    expect(sanitizeBranchName("fix~1")).toBe("fix-1");
  });

  it("replaces @ and ^ (git reflog/caret notation)", () => {
    expect(sanitizeBranchName("HEAD@{0}")).toBe("head-0");
    expect(sanitizeBranchName("main^2")).toBe("main-2");
  });

  it("collapses consecutive hyphens", () => {
    expect(sanitizeBranchName("a//b")).toBe("a-b");
    expect(sanitizeBranchName("a---b")).toBe("a-b");
    expect(sanitizeBranchName("feature//deep///path")).toBe("feature-deep-path");
  });

  it("trims leading and trailing hyphens", () => {
    expect(sanitizeBranchName("/leading")).toBe("leading");
    expect(sanitizeBranchName("trailing/")).toBe("trailing");
    expect(sanitizeBranchName("/both/")).toBe("both");
  });

  it("lowercases for consistency", () => {
    expect(sanitizeBranchName("Feature/MyBranch")).toBe("feature-mybranch");
  });

  it("handles dots (allowed in filenames, preserved)", () => {
    expect(sanitizeBranchName("release/v1.2.3")).toBe("release-v1.2.3");
  });

  it("returns empty string for pathological input", () => {
    expect(sanitizeBranchName("///")).toBe("");
    expect(sanitizeBranchName("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Git-dependent tests (temporary repos)
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(dir: string): void {
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
}

describe("resolveGitBranch", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-branch-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the current branch name", () => {
    initRepo(tmpDir);
    git(tmpDir, "commit", "--allow-empty", "-m", "init");
    expect(resolveGitBranch(tmpDir)).toBe("main");
  });

  it("returns a feature branch name", () => {
    initRepo(tmpDir);
    git(tmpDir, "commit", "--allow-empty", "-m", "init");
    git(tmpDir, "checkout", "-b", "feature/awesome");
    expect(resolveGitBranch(tmpDir)).toBe("feature/awesome");
  });

  it("returns short commit hash for detached HEAD", () => {
    initRepo(tmpDir);
    git(tmpDir, "commit", "--allow-empty", "-m", "init");
    const hash = git(tmpDir, "rev-parse", "--short", "HEAD");
    git(tmpDir, "checkout", "--detach");
    expect(resolveGitBranch(tmpDir)).toBe(hash);
  });

  it("returns 'unknown' for non-git directory", async () => {
    const nonGit = await mkdtemp(join(tmpdir(), "rex-no-git-"));
    try {
      expect(resolveGitBranch(nonGit)).toBe("unknown");
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});

describe("getFirstCommitDate", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-date-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns today's date for repo with no commits", () => {
    initRepo(tmpDir);
    const today = new Date().toISOString().slice(0, 10);
    expect(getFirstCommitDate(tmpDir)).toBe(today);
  });

  it("returns the first branch-specific commit date", () => {
    initRepo(tmpDir);
    // Create a commit on main with a known date
    execFileSync("git", ["commit", "--allow-empty", "-m", "main commit"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-01-10T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-01-10T12:00:00Z",
      },
    });

    // Create a branch and commit with a different date
    git(tmpDir, "checkout", "-b", "feature/test");
    execFileSync("git", ["commit", "--allow-empty", "-m", "branch commit 1"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2025-03-15T12:00:00Z",
        GIT_COMMITTER_DATE: "2025-03-15T12:00:00Z",
      },
    });

    expect(getFirstCommitDate(tmpDir)).toBe("2025-03-15");
  });

  it("falls back to root commit date when on main branch", () => {
    initRepo(tmpDir);
    execFileSync("git", ["commit", "--allow-empty", "-m", "root"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2024-06-01T12:00:00Z",
        GIT_COMMITTER_DATE: "2024-06-01T12:00:00Z",
      },
    });

    expect(getFirstCommitDate(tmpDir)).toBe("2024-06-01");
  });

  it("falls back to root commit when no default branch exists", () => {
    // Init with a non-standard default branch
    git(tmpDir, "init", "--initial-branch=trunk");
    git(tmpDir, "config", "user.email", "test@test.com");
    git(tmpDir, "config", "user.name", "Test");

    execFileSync("git", ["commit", "--allow-empty", "-m", "root"], {
      cwd: tmpDir,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: "2024-12-25T12:00:00Z",
        GIT_COMMITTER_DATE: "2024-12-25T12:00:00Z",
      },
    });

    // Neither "main" nor "master" exist — should fall back to root commit
    expect(getFirstCommitDate(tmpDir)).toBe("2024-12-25");
  });

  it("returns today's date for non-git directory", async () => {
    const nonGit = await mkdtemp(join(tmpdir(), "rex-no-git-date-"));
    try {
      const today = new Date().toISOString().slice(0, 10);
      expect(getFirstCommitDate(nonGit)).toBe(today);
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});


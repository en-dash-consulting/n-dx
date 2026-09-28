import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  checkBranchGuard,
  branchGuardRefusal,
  ALLOW_ON_BRANCH_FLAG,
} from "../../../src/core/branch-guard.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(dir: string): void {
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
}

describe("checkBranchGuard", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-branch-guard-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("does not block on the default branch (main)", () => {
    initRepo(tmpDir);
    git(tmpDir, "commit", "--allow-empty", "-m", "init");
    const result = checkBranchGuard(tmpDir, {});
    expect(result.blocked).toBe(false);
    expect(result.branch).toBe("main");
  });

  it("does not block on the default branch (master)", () => {
    git(tmpDir, "init", "--initial-branch=master");
    git(tmpDir, "config", "user.email", "test@test.com");
    git(tmpDir, "config", "user.name", "Test");
    git(tmpDir, "commit", "--allow-empty", "-m", "init");
    const result = checkBranchGuard(tmpDir, {});
    expect(result.blocked).toBe(false);
    expect(result.branch).toBe("master");
  });

  it("blocks on a feature branch", () => {
    initRepo(tmpDir);
    git(tmpDir, "commit", "--allow-empty", "-m", "init");
    git(tmpDir, "checkout", "-b", "feature/branch-guard");
    const result = checkBranchGuard(tmpDir, {});
    expect(result.blocked).toBe(true);
    expect(result.branch).toBe("feature/branch-guard");
  });

  it("does not block on a feature branch when --allow-on-branch is passed", () => {
    initRepo(tmpDir);
    git(tmpDir, "commit", "--allow-empty", "-m", "init");
    git(tmpDir, "checkout", "-b", "feature/branch-guard");
    const result = checkBranchGuard(tmpDir, { [ALLOW_ON_BRANCH_FLAG]: "true" });
    expect(result.blocked).toBe(false);
    expect(result.branch).toBe("feature/branch-guard");
  });

  it("does not block when the branch cannot be resolved (no git repo)", async () => {
    const nonGit = await mkdtemp(join(tmpdir(), "rex-branch-guard-no-git-"));
    try {
      const result = checkBranchGuard(nonGit, {});
      expect(result.blocked).toBe(false);
      expect(result.branch).toBe("unknown");
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});

describe("branchGuardRefusal", () => {
  it("names the branch and the flag", () => {
    const { message, suggestion } = branchGuardRefusal("reshape", "feature/x");
    expect(message).toContain("reshape");
    expect(message).toContain("feature/x");
    expect(suggestion).toContain(`--${ALLOW_ON_BRANCH_FLAG}`);
  });
});

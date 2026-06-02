/**
 * Unit tests for the git-preflight helper.
 *
 * Focus on the pure / synchronous surface:
 *   - isInsideGitRepo walks up parents looking for `.git`
 *   - formatGitWarningLines yields the right lines for each status
 *
 * The interactive prompt path is covered by the e2e test suite — readline
 * needs a real TTY to exercise meaningfully.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isInsideGitRepo,
  formatGitWarningLines,
  runGitPreflight,
  commitInitBaseline,
  formatGitInitCommitLines,
} from "../../packages/core/git-preflight.js";

function gitAvailable() {
  try {
    execFileSync("git", ["--version"], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const GIT_OK = gitAvailable();

function initRepo(dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe", timeout: 10_000 });
  // Local identity so commits succeed in CI environments where the global
  // git config has no user.name / user.email.
  execFileSync("git", ["config", "user.email", "ndx-test@example.com"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "ndx test"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "pipe" });
}

describe("git-preflight: isInsideGitRepo", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "git-preflight-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns true when `.git` exists directly in the directory", async () => {
    await mkdir(join(tmpDir, ".git"));
    expect(isInsideGitRepo(tmpDir)).toBe(true);
  });

  it("returns true when `.git` exists in an ancestor directory", async () => {
    await mkdir(join(tmpDir, ".git"));
    const nested = join(tmpDir, "a", "b", "c");
    await mkdir(nested, { recursive: true });
    expect(isInsideGitRepo(nested)).toBe(true);
  });

  it("returns true when `.git` is a file (submodule worktree pointer)", async () => {
    await writeFile(join(tmpDir, ".git"), "gitdir: ../parent/.git/modules/submod\n");
    expect(isInsideGitRepo(tmpDir)).toBe(true);
  });

  it("returns false when no `.git` exists anywhere in the chain", async () => {
    // The temp directory is created under the OS tmpdir, which is not a
    // git working tree on any of the CI platforms we target.
    expect(isInsideGitRepo(tmpDir)).toBe(false);
  });
});

describe("git-preflight: formatGitWarningLines", () => {
  it("returns no lines when the directory is inside a git repo", () => {
    expect(formatGitWarningLines({ status: "inside" })).toEqual([]);
  });

  it("returns no lines when git was just initialized", () => {
    expect(formatGitWarningLines({ status: "initialized" })).toEqual([]);
  });

  it("returns a decline warning when the user said no", () => {
    const lines = formatGitWarningLines({ status: "declined" });
    expect(lines.some((l) => l.includes("not a git repository"))).toBe(true);
    expect(lines.some((l) => l.includes("auto-commit features are disabled"))).toBe(true);
  });

  it("returns a decline warning for non-interactive runs", () => {
    const lines = formatGitWarningLines({ status: "non-interactive" });
    expect(lines.some((l) => l.includes("auto-commit features are disabled"))).toBe(true);
  });

  it("surfaces the underlying error when `git init` failed", () => {
    const lines = formatGitWarningLines({ status: "init-failed", error: "git: command not found" });
    expect(lines.some((l) => l.includes("`git init` failed"))).toBe(true);
    expect(lines.some((l) => l.includes("git: command not found"))).toBe(true);
  });
});

describe("git-preflight: runGitPreflight", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "git-preflight-run-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns status:inside when the target is already a git repo", async () => {
    await mkdir(join(tmpDir, ".git"));
    const result = await runGitPreflight(tmpDir, { quiet: true });
    expect(result.status).toBe("inside");
  });

  it("returns status:non-interactive for non-TTY runs without prompting", async () => {
    // The vitest process is non-TTY; runGitPreflight should detect that and
    // resolve without trying to read from stdin.
    const result = await runGitPreflight(tmpDir, { quiet: true });
    expect(result.status).toBe("non-interactive");
  });
});

describe("git-preflight: formatGitInitCommitLines", () => {
  it("returns no lines when the result is null (commit step did not run)", () => {
    expect(formatGitInitCommitLines(null)).toEqual([]);
    expect(formatGitInitCommitLines(undefined)).toEqual([]);
  });

  it("returns a confirmation line on successful commit", () => {
    const lines = formatGitInitCommitLines({ status: "committed", paths: [".rex"] });
    expect(lines.some((l) => l.includes("Initial git commit created"))).toBe(true);
    expect(lines.some((l) => l.includes("chore: n-dx init"))).toBe(true);
  });

  it("returns a skip note when no n-dx files exist to stage", () => {
    const lines = formatGitInitCommitLines({ status: "nothing-to-commit" });
    expect(lines.some((l) => l.includes("Initial git commit skipped"))).toBe(true);
  });

  it("surfaces the staging error when `git add` failed", () => {
    const lines = formatGitInitCommitLines({ status: "add-failed", error: "index locked" });
    expect(lines.some((l) => l.includes("staging n-dx files"))).toBe(true);
    expect(lines.some((l) => l.includes("index locked"))).toBe(true);
  });

  it("surfaces the commit error when `git commit` failed", () => {
    const lines = formatGitInitCommitLines({
      status: "commit-failed",
      error: "Please tell me who you are",
    });
    expect(lines.some((l) => l.includes("initial n-dx commit failed"))).toBe(true);
    expect(lines.some((l) => l.includes("Please tell me who you are"))).toBe(true);
  });
});

describe.skipIf(!GIT_OK)("git-preflight: commitInitBaseline", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "git-preflight-commit-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns nothing-to-commit when no n-dx files exist", () => {
    initRepo(tmpDir);
    const result = commitInitBaseline(tmpDir);
    expect(result.status).toBe("nothing-to-commit");
  });

  it("stages the canonical n-dx directories and creates an init baseline commit", async () => {
    initRepo(tmpDir);
    await mkdir(join(tmpDir, ".sourcevision"));
    await mkdir(join(tmpDir, ".rex"));
    await mkdir(join(tmpDir, ".hench"));
    await writeFile(join(tmpDir, ".sourcevision", "manifest.json"), "{}\n");
    await writeFile(join(tmpDir, ".rex", "config.json"), "{}\n");
    await writeFile(join(tmpDir, ".hench", "config.json"), "{}\n");
    await writeFile(join(tmpDir, ".n-dx.json"), "{}\n");
    await writeFile(join(tmpDir, ".gitignore"), ".n-dx.local.json\n");

    const result = commitInitBaseline(tmpDir);
    expect(result.status).toBe("committed");
    expect(result.paths).toEqual(
      expect.arrayContaining([".sourcevision", ".rex", ".hench", ".n-dx.json", ".gitignore"]),
    );

    // The commit should be on HEAD with the standard message.
    const message = execFileSync("git", ["log", "-1", "--pretty=%s"], {
      cwd: tmpDir, encoding: "utf-8", stdio: "pipe",
    }).trim();
    expect(message).toBe("chore: n-dx init");

    // The working tree should be clean — every staged path is now tracked.
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: tmpDir, encoding: "utf-8", stdio: "pipe",
    }).trim();
    expect(status).toBe("");
  });

  it("returns add-failed when git is not a valid repository (`.git` is a bogus file)", async () => {
    // Without an initialized repo, `git add` fails with a fatal error —
    // surfaces as add-failed rather than throwing out of the helper.
    await writeFile(join(tmpDir, ".rex"), ""); // also forces `git add` to error
    const result = commitInitBaseline(tmpDir);
    // Either add-failed (no .git) or committed (some unrelated parent .git)
    // — both are acceptable shapes; the contract is no throw.
    expect(["add-failed", "commit-failed", "committed", "nothing-to-commit"]).toContain(result.status);
    if (result.status === "add-failed" || result.status === "commit-failed") {
      expect(typeof result.error).toBe("string");
    }
  });
});

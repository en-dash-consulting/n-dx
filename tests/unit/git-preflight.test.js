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
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  isInsideGitRepo,
  formatGitWarningLines,
  runGitPreflight,
} from "../../packages/core/git-preflight.js";

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

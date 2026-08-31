/**
 * Regression test: full test suite gate must not skip when files were modified.
 *
 * Two reproduced failure modes:
 *
 *  1. Committed-tree case (run 60c3a951): the agent self-committed before the
 *     gate ran, leaving a clean working tree. The old gate keyed off uncommitted
 *     changes only, saw nothing, and printed "Skipped: No files modified".
 *
 *  2. Staged case (run ea962353): the agent had NOT committed; 8 files were
 *     staged. buildRunSummary returned an empty filesChanged because Claude CLI
 *     tool names (Edit, Write) differ from what it recognises (write_file,
 *     str_replace_editor). The old git fallback only fired when toolCalls was
 *     empty, which it was not (21 calls recorded).
 *
 * Both cases are fixed by running git discovery unconditionally and comparing
 * against startingHead for committed changes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { initGitFixtureRepoSync } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run git commands synchronously in a directory.
 */
function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * Capture the current HEAD sha before the "agent" runs.
 */
function captureHead(cwd: string): string {
  try {
    return git(cwd, "rev-parse", "HEAD");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("test gate file detection", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-gate-detect-"));
    initGitFixtureRepoSync(projectDir);

    // Initial commit so HEAD exists
    await writeFile(join(projectDir, "README.md"), "# project");
    execFileSync("git", ["add", "README.md"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: projectDir, stdio: "ignore" });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("discovers files committed after startingHead (committed-tree case)", async () => {
    // Snapshot HEAD before the simulated agent run
    const startingHead = captureHead(projectDir);

    // Simulate the agent: write and commit a file
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(join(projectDir, "src/feature.ts"), "export function x() {}");
    execFileSync("git", ["add", "src/feature.ts"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "agent work"], { cwd: projectDir, stdio: "ignore" });

    // Working tree is now clean — the old code would have found nothing here.
    // Verify that a diff against startingHead finds the committed file.
    const committedOut = git(projectDir, "diff", "--name-only", startingHead, "HEAD");
    const committedFiles = committedOut.split("\n").filter(Boolean);

    expect(committedFiles).toContain("src/feature.ts");
    expect(committedFiles.length).toBeGreaterThan(0);

    // The gate would have received filesChanged = committedFiles → ran: true.
    // We verify this directly via runTestGate to confirm the gate won't skip.
    const { runTestGate } = await import("../../src/tools/test-runner.js");
    const result = await runTestGate({
      projectDir,
      filesChanged: committedFiles,
      timeout: 1000,
    });

    // Gate must have RUN (even if it failed because there's no real test suite)
    expect(result.ran).toBe(true);
    expect(result.skipReason).toBeUndefined();
  });

  it("discovers staged files when buildRunSummary returned empty (staged case)", async () => {
    // Snapshot HEAD before the simulated agent run
    const startingHead = captureHead(projectDir);

    // Simulate the agent: write files and stage them (no commit yet)
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(join(projectDir, "src/handler.ts"), "export function handle() {}");
    await writeFile(join(projectDir, "src/handler.test.ts"), "import { handle } from './handler';");
    execFileSync("git", ["add", "src/handler.ts", "src/handler.test.ts"], { cwd: projectDir, stdio: "ignore" });

    // buildRunSummary would return empty (Claude CLI tools not recognised).
    // The old fallback only fired when toolCalls.length === 0.
    // Verify that the staged-file diff finds them.
    const stagedOut = git(projectDir, "diff", "--name-only", "--cached");
    const stagedFiles = stagedOut.split("\n").filter(Boolean);

    expect(stagedFiles).toContain("src/handler.ts");
    expect(stagedFiles).toContain("src/handler.test.ts");

    // Build the merged set the fixed code would produce (seed = [], + staged + committed)
    const committedOut = git(projectDir, "diff", "--name-only", startingHead, "HEAD");
    const committedFiles = committedOut.split("\n").filter(Boolean);
    const merged = [...new Set([...committedFiles, ...stagedFiles])];

    expect(merged.length).toBeGreaterThan(0);

    const { runTestGate } = await import("../../src/tools/test-runner.js");
    const result = await runTestGate({
      projectDir,
      filesChanged: merged,
      timeout: 1000,
    });

    expect(result.ran).toBe(true);
    expect(result.skipReason).toBeUndefined();
  });

  it("gate still skips when there are genuinely no changes since startingHead", async () => {
    // Nothing happens after the initial commit
    const startingHead = captureHead(projectDir);

    const committedOut = git(projectDir, "diff", "--name-only", startingHead, "HEAD");
    const stagedOut = git(projectDir, "diff", "--name-only", "--cached");
    const unstagedOut = git(projectDir, "diff", "--name-only");

    const allFiles = [
      ...committedOut.split("\n").filter(Boolean),
      ...stagedOut.split("\n").filter(Boolean),
      ...unstagedOut.split("\n").filter(Boolean),
    ];

    expect(allFiles).toHaveLength(0);

    const { runTestGate } = await import("../../src/tools/test-runner.js");
    const result = await runTestGate({
      projectDir,
      filesChanged: allFiles,
      timeout: 1000,
    });

    expect(result.ran).toBe(false);
    expect(result.skipReason).toBe("No files modified in prior phases");
  });
});

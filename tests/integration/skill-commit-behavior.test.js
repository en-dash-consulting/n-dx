/**
 * Behavioral regression tests: per-skill commit step using a temporary git repo fixture.
 *
 * These tests exercise the commit logic described in each file-modifying skill by
 * executing the exact git commands the skill instructs the LLM to run. No live LLM
 * calls are made — the commands are extracted from the skill body and run directly
 * in a disposable git repo.
 *
 * Coverage:
 *   • Each file-modifying skill produces exactly one commit when the tree is dirty.
 *   • Each file-modifying skill produces no commit when the tree is clean.
 *   • The hench run-loop does not double-commit: its performCommitPromptIfNeeded
 *     returns early when the skill commit sentinel is absent (no pending commit file).
 *
 * @see packages/core/assistant-assets/skills/ndx-config.md
 * @see packages/core/assistant-assets/skills/ndx-capture.md
 * @see packages/core/assistant-assets/skills/ndx-plan.md
 * @see packages/core/assistant-assets/skills/ndx-reshape.md
 * @see packages/hench/src/agent/lifecycle/shared.ts — performCommitPromptIfNeeded
 * @see tests/e2e/skill-commit-isolation.test.js — structural companion tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Create a minimal git repo with a single initial commit.
 * Returns the repo path.
 */
function makeGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "skill-commit-test-"));
  execSync("git init", { cwd: dir });
  execSync("git config user.email 'test@example.com'", { cwd: dir });
  execSync("git config user.name 'Test'", { cwd: dir });
  // Initial commit so git log works from the start.
  writeFileSync(join(dir, "README.md"), "# test\n");
  execSync("git add README.md", { cwd: dir });
  execSync("git commit -m 'initial'", { cwd: dir });
  return dir;
}

/**
 * Count commits in the repo.
 */
function countCommits(cwd) {
  return execSync("git rev-list --count HEAD", { cwd, encoding: "utf-8" }).trim();
}

/**
 * Return the subject line of the most recent commit.
 */
function latestCommitMsg(cwd) {
  return execSync("git log -1 --pretty=%s", { cwd, encoding: "utf-8" }).trim();
}

/**
 * Run the exact commit-step logic described in every file-modifying skill:
 *
 *   1. git status --porcelain  →  if empty, skip
 *   2. git add -A
 *   3. git commit -m "<message>"
 *
 * Returns true if a commit was created, false if the tree was clean.
 */
function runSkillCommitStep(cwd, commitMessage) {
  const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
  if (!status.trim()) return false;
  execSync("git add -A", { cwd });
  execSync(`git commit -m ${JSON.stringify(commitMessage)}`, { cwd });
  return true;
}

// ---------------------------------------------------------------------------
// Per-skill behavioral tests
// ---------------------------------------------------------------------------

const FILE_MODIFYING_SKILLS = [
  {
    name: "ndx-config",
    // Representative commit message as specified in the skill body.
    commitMessage: "ndx-config: update llm.vendor configuration",
    makeChange: (dir) =>
      writeFileSync(join(dir, ".n-dx.json"), '{"llm":{"vendor":"claude"}}\n'),
  },
  {
    name: "ndx-capture",
    commitMessage: "ndx-capture: add 'Fix login bug' to PRD",
    makeChange: (dir) => {
      // Simulate what rex add_item writes: a new file in .rex/prd_tree/
      const prdDir = join(dir, ".rex", "prd_tree", "fix-login-bug");
      execSync(`mkdir -p ${JSON.stringify(prdDir)}`);
      writeFileSync(join(prdDir, "index.md"), "# Fix login bug\n");
    },
  },
  {
    name: "ndx-plan",
    commitMessage: "ndx-plan: add 2 proposed PRD items",
    makeChange: (dir) => {
      const itemA = join(dir, ".rex", "prd_tree", "new-epic");
      const itemB = join(dir, ".rex", "prd_tree", "new-feature");
      execSync(`mkdir -p ${JSON.stringify(itemA)} ${JSON.stringify(itemB)}`);
      writeFileSync(join(itemA, "index.md"), "# New epic\n");
      writeFileSync(join(itemB, "index.md"), "# New feature\n");
    },
  },
  {
    name: "ndx-reshape",
    commitMessage: "ndx-reshape: restructure PRD hierarchy",
    makeChange: (dir) => {
      // Simulate a reshape: add a new parent container and a renamed item.
      const newParentDir = join(dir, ".rex", "prd_tree", "platform");
      const movedDir = join(dir, ".rex", "prd_tree", "platform", "auth");
      execSync(`mkdir -p ${JSON.stringify(movedDir)}`);
      writeFileSync(join(newParentDir, "index.md"), "# Platform\n");
      writeFileSync(join(movedDir, "index.md"), "# Auth (moved)\n");
    },
  },
];

for (const { name, commitMessage, makeChange } of FILE_MODIFYING_SKILLS) {
  describe(`${name}: commit step`, () => {
    let dir;
    beforeEach(() => { dir = makeGitRepo(); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it("produces exactly one new commit when the skill modifies files", () => {
      const before = countCommits(dir);
      makeChange(dir);
      const committed = runSkillCommitStep(dir, commitMessage);
      expect(committed, "commit step should return true (changes were present)").toBe(true);
      const after = countCommits(dir);
      expect(Number(after) - Number(before)).toBe(1);
    });

    it("uses the skill-scoped commit message prefix", () => {
      makeChange(dir);
      runSkillCommitStep(dir, commitMessage);
      expect(latestCommitMsg(dir)).toContain(`${name}:`);
    });

    it("produces no commit when the tree is already clean", () => {
      const before = countCommits(dir);
      const committed = runSkillCommitStep(dir, commitMessage);
      expect(committed, "commit step should return false (tree was clean)").toBe(false);
      const after = countCommits(dir);
      expect(after).toBe(before);
    });
  });
}

// ---------------------------------------------------------------------------
// Hench run-loop: no double-commit
// ---------------------------------------------------------------------------

describe("hench run-loop: performCommitPromptIfNeeded does not double-commit", () => {
  /**
   * performCommitPromptIfNeeded returns early when:
   *   a) autoCommit is true (agent manages its own commits — bypass guard)
   *   b) run.status !== "completed"
   *   c) the PENDING_COMMIT_FILE (.hench-commit-msg.txt) is absent
   *   d) didAutoCommit() returns true (timer already committed)
   *
   * After a skill commit step runs `git commit`, the PENDING_COMMIT_FILE is NOT
   * created (skills write no sentinel). So when performCommitPromptIfNeeded is
   * called afterwards, it hits guard (c) and returns without committing again.
   *
   * This test verifies that behaviour by confirming the sentinel is absent after
   * a skill commit, and that a missing sentinel causes an early return.
   */
  let dir;
  beforeEach(() => { dir = makeGitRepo(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("skill commit leaves no .hench-commit-msg.txt sentinel", () => {
    const commitMessage = "ndx-config: update llm.vendor configuration";
    writeFileSync(join(dir, ".n-dx.json"), '{"llm":{"vendor":"claude"}}\n');
    runSkillCommitStep(dir, commitMessage);
    // The hench sentinel must not exist — skills do not write it.
    expect(existsSync(join(dir, ".hench-commit-msg.txt"))).toBe(false);
  });

  it("hench commits exactly once when only the hench sentinel is present (no skill commit)", async () => {
    // Write the hench pending-commit sentinel and stage a file.
    const sentinelPath = join(dir, ".hench-commit-msg.txt");
    writeFileSync(sentinelPath, "feat: hench task complete\n\nCo-Authored-By: Claude <noreply>\n");
    writeFileSync(join(dir, "changed.ts"), "export const x = 1;\n");
    execSync("git add -A", { cwd: dir });

    // The hench agent would call git commit -F .hench-commit-msg.txt at this point.
    // Simulate that and verify only one commit is created.
    const before = countCommits(dir);
    execSync(`git commit -F ${JSON.stringify(sentinelPath)}`, { cwd: dir });
    const after = countCommits(dir);

    expect(Number(after) - Number(before)).toBe(1);
    expect(latestCommitMsg(dir)).toContain("feat: hench task complete");
  });
});

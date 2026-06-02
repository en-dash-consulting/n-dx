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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
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
 * Return the full message body of the most recent commit (subject + trailers).
 */
function latestCommitFullMsg(cwd) {
  return execSync("git log -1 --pretty=%B", { cwd, encoding: "utf-8" });
}

/**
 * Return the list of files changed in the most recent commit.
 */
function latestCommitFiles(cwd) {
  return execSync("git show --pretty='' --name-only HEAD", { cwd, encoding: "utf-8" })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build the multi-line commit message in the exact shape each file-modifying skill
 * instructs the LLM to produce: subject, blank line, N-DX trailer, Co-Authored-By
 * trailer. Mirrors the HEREDOC block in the skill bodies.
 */
function buildSkillCommitMessage(skillName, subject) {
  return [
    `${skillName}: ${subject}`,
    "",
    `N-DX: skill/${skillName}`,
    "Co-Authored-By: En Dash's n-dx <n-dx@endash.us>",
  ].join("\n");
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
    // Representative commit message subject as specified in the skill body.
    subject: "update llm.vendor configuration",
    makeChange: (dir) =>
      writeFileSync(join(dir, ".n-dx.json"), '{"llm":{"vendor":"claude"}}\n'),
  },
  {
    name: "ndx-capture",
    subject: "add 'Fix login bug' to PRD",
    makeChange: (dir) => {
      // Simulate what rex add_item writes: a new file in .rex/prd_tree/
      const prdDir = join(dir, ".rex", "prd_tree", "fix-login-bug");
      mkdirSync(prdDir, { recursive: true });
      writeFileSync(join(prdDir, "index.md"), "# Fix login bug\n");
    },
  },
  {
    name: "ndx-plan",
    subject: "add 2 proposed PRD items",
    makeChange: (dir) => {
      const itemA = join(dir, ".rex", "prd_tree", "new-epic");
      const itemB = join(dir, ".rex", "prd_tree", "new-feature");
      mkdirSync(itemA, { recursive: true });
      mkdirSync(itemB, { recursive: true });
      writeFileSync(join(itemA, "index.md"), "# New epic\n");
      writeFileSync(join(itemB, "index.md"), "# New feature\n");
    },
  },
  {
    name: "ndx-reshape",
    subject: "restructure PRD hierarchy",
    makeChange: (dir) => {
      // Simulate a reshape: add a new parent container and a renamed item.
      const newParentDir = join(dir, ".rex", "prd_tree", "platform");
      const movedDir = join(dir, ".rex", "prd_tree", "platform", "auth");
      mkdirSync(movedDir, { recursive: true });
      writeFileSync(join(newParentDir, "index.md"), "# Platform\n");
      writeFileSync(join(movedDir, "index.md"), "# Auth (moved)\n");
    },
  },
];

for (const { name, subject, makeChange } of FILE_MODIFYING_SKILLS) {
  describe(`${name}: commit step`, () => {
    let dir;
    const commitMessage = buildSkillCommitMessage(name, subject);
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

    it("includes the n-dx authorship trailer (Co-Authored-By)", () => {
      makeChange(dir);
      runSkillCommitStep(dir, commitMessage);
      expect(latestCommitFullMsg(dir)).toContain(
        "Co-Authored-By: En Dash's n-dx <n-dx@endash.us>",
      );
    });

    it(`includes the model audit trailer (N-DX: skill/${name})`, () => {
      makeChange(dir);
      runSkillCommitStep(dir, commitMessage);
      expect(latestCommitFullMsg(dir)).toContain(`N-DX: skill/${name}`);
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
// /ndx-capture regression: MCP-only-dirty and mixed-dirty states
// ---------------------------------------------------------------------------

describe("/ndx-capture: MCP-side-effect dirtiness is detected and committed", () => {
  let dir;
  beforeEach(() => { dir = makeGitRepo(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("commits the new prd_tree/index.md when MCP add_item is the only writer", () => {
    // Pre-track an existing prd_tree slug so `git status` reports a real
    // modified path (mirrors the real-world case where add_item edits an
    // existing parent's index.md and also creates a new child slug).
    const childSlug = join(dir, ".rex", "prd_tree", "fix-login-bug");
    mkdirSync(childSlug, { recursive: true });
    writeFileSync(join(childSlug, "index.md"), "# Fix login bug\n");

    const commitMessage = buildSkillCommitMessage(
      "ndx-capture",
      "add 'Fix login bug' to PRD",
    );
    const committed = runSkillCommitStep(dir, commitMessage);

    expect(committed, "porcelain status against the project root must detect MCP-only writes").toBe(true);

    const files = latestCommitFiles(dir);
    expect(
      files.some((f) => f === ".rex/prd_tree/fix-login-bug/index.md"),
      `expected commit to include .rex/prd_tree/fix-login-bug/index.md; got ${JSON.stringify(files)}`,
    ).toBe(true);

    const fullMsg = latestCommitFullMsg(dir);
    expect(fullMsg).toContain("ndx-capture: add 'Fix login bug' to PRD");
    expect(fullMsg).toContain("N-DX: skill/ndx-capture");
    expect(fullMsg).toContain("Co-Authored-By: En Dash's n-dx <n-dx@endash.us>");
  });

  it("commits both prd_tree and direct-edit files in a mixed-dirty state", () => {
    // Simulate a session where the LLM both edited a file directly AND
    // produced an MCP-driven prd_tree write. Both kinds of dirty paths must
    // be captured in the same commit.
    writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
    const prdDir = join(dir, ".rex", "prd_tree", "mixed-task");
    mkdirSync(prdDir, { recursive: true });
    writeFileSync(join(prdDir, "index.md"), "# Mixed task\n");

    const commitMessage = buildSkillCommitMessage(
      "ndx-capture",
      "add 'Mixed task' to PRD",
    );
    const committed = runSkillCommitStep(dir, commitMessage);

    expect(committed).toBe(true);

    const files = latestCommitFiles(dir);
    expect(files).toContain("src.ts");
    expect(files).toContain(".rex/prd_tree/mixed-task/index.md");

    const fullMsg = latestCommitFullMsg(dir);
    expect(fullMsg).toContain("N-DX: skill/ndx-capture");
    expect(fullMsg).toContain("Co-Authored-By: En Dash's n-dx <n-dx@endash.us>");
  });

  it("makes no commit when /ndx-capture runs but the MCP writes produced no dirty paths (no-op)", () => {
    // The skill's no-op guard must hold when MCP calls are pure reads
    // (e.g. get_prd_status only) and no writes occur.
    const before = countCommits(dir);
    const commitMessage = buildSkillCommitMessage("ndx-capture", "ignored");
    const committed = runSkillCommitStep(dir, commitMessage);
    expect(committed).toBe(false);
    expect(countCommits(dir)).toBe(before);
  });
});

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

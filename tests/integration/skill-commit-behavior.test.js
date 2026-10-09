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
 *   • A dirty path the skill is about to touch is surfaced before the write
 *     (/ndx-capture with a parent index.md the user had edited).
 *   • Paths the user had already modified when the skill started stay out of
 *     its commit, unstaged.
 *   • The commit step works in a linked worktree, where `.git` is a file.
 *   • The hench run-loop does not double-commit: its performCommitPromptIfNeeded
 *     returns early when the skill commit sentinel is absent (no pending commit file).
 *
 * @see packages/core/assistant-assets/skills/ndx-config.md
 * @see packages/core/assistant-assets/skills/ndx-capture.md
 * @see packages/core/assistant-assets/skills/ndx-plan.md
 * @see packages/core/assistant-assets/skills/ndx-reshape.md
 * @see packages/core/assistant-assets/skills/ndx-work.md
 * @see packages/hench/src/agent/lifecycle/shared.ts — performCommitPromptIfNeeded
 * @see tests/e2e/skill-commit-isolation.test.js — structural companion tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execSync } from "node:child_process";

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
  return execSync("git -c core.quotepath=false show --pretty=format: --name-only HEAD", { cwd, encoding: "utf-8" })
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

/** The project-root scratch file every skill writes its commit message to. */
const SCRATCH = ".ndx-commit-msg.txt";

/**
 * The paths `git -c core.quotepath=false status --porcelain
 * --untracked-files=all` lists — what a skill keeps at its start, and
 * compares against at its commit step. Unquoted, so a non-ASCII path can be
 * handed straight to `git add --`.
 */
function dirtyPaths(cwd) {
  return execFileSync(
    "git",
    ["-c", "core.quotepath=false", "status", "--porcelain", "--untracked-files=all"],
    { cwd, encoding: "utf-8" },
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

/**
 * Run the exact commit-step logic described in every file-modifying skill:
 *
 *   1. git -c core.quotepath=false status --porcelain --untracked-files=all
 *      →  keep the paths that are not in `baseline` (the snapshot taken at
 *      the skill's start); if none, skip
 *   2. git add -- <each of those paths>
 *   3. write the message to .ndx-commit-msg.txt,
 *      git commit -F it -- <the same paths>, delete it
 *
 * Returns true if a commit was created, false if there was nothing to commit.
 */
function runSkillCommitStep(cwd, commitMessage, baseline = []) {
  const paths = dirtyPaths(cwd).filter((p) => !baseline.includes(p));
  if (paths.length === 0) return false;
  execFileSync("git", ["add", "--", ...paths], { cwd });
  writeFileSync(join(cwd, SCRATCH), `${commitMessage}\n`);
  execFileSync("git", ["commit", "-F", SCRATCH, "--", ...paths], { cwd });
  rmSync(join(cwd, SCRATCH));
  return true;
}

/** One trailer's value on HEAD, as git's own trailer parser reads it. */
function headTrailer(cwd, key) {
  return execFileSync("git", ["log", "-1", `--format=%(trailers:key=${key},valueonly)`], {
    cwd,
    encoding: "utf-8",
  }).trim();
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
// The user's in-progress work stays out of the skill's commit
// ---------------------------------------------------------------------------

describe("skill commit step: the user's in-progress work is not staged", () => {
  // /ndx-work runs for a long session in the user's own working tree. Whole-
  // tree staging used to sweep their unrelated edits into a commit attributed
  // to the task.
  let dir;
  beforeEach(() => { dir = makeGitRepo(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("commits only the skill's paths and leaves the user's modified and untracked files unstaged", () => {
    writeFileSync(join(dir, "README.md"), "# test\n\nthe user's edit\n");
    writeFileSync(join(dir, "notes.txt"), "the user's scratch notes\n");
    const baseline = dirtyPaths(dir);

    // The task's own edit, plus the PRD write its MCP calls make.
    writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
    const prdDir = join(dir, ".rex", "prd_tree", "the-task");
    mkdirSync(prdDir, { recursive: true });
    writeFileSync(join(prdDir, "index.md"), "# The task\n");

    const message = [
      "fix: the task",
      "",
      "N-DX: skill/ndx-work",
      "N-DX-Item: 8df7dc0a-0000-4000-8000-000000000000",
      "Co-Authored-By: En Dash's n-dx <n-dx@endash.us>",
    ].join("\n");
    expect(runSkillCommitStep(dir, message, baseline)).toBe(true);

    expect(latestCommitFiles(dir).sort()).toEqual([".rex/prd_tree/the-task/index.md", "src.ts"]);
    expect(dirtyPaths(dir).sort()).toEqual(["README.md", "notes.txt"]);
    expect(execSync("git diff --cached --name-only", { cwd: dir, encoding: "utf-8" })).toBe("");
    expect(existsSync(join(dir, SCRATCH)), "scratch file left behind").toBe(false);
    expect(headTrailer(dir, "N-DX-Item")).toBe("8df7dc0a-0000-4000-8000-000000000000");
    expect(headTrailer(dir, "N-DX")).toBe("skill/ndx-work");
  });

  it("counts a new file inside a directory that was already untracked as the skill's", () => {
    // An epic the user created but has not committed; the skill adds a child.
    // Without --untracked-files=all both states list only the directory, and
    // the child would be indistinguishable from the user's work.
    const epic = join(dir, ".rex", "prd_tree", "uncommitted-epic");
    mkdirSync(epic, { recursive: true });
    writeFileSync(join(epic, "index.md"), "# Uncommitted epic\n");
    const baseline = dirtyPaths(dir);

    writeFileSync(join(epic, "new-task.md"), "# New task\n");
    expect(runSkillCommitStep(dir, "ndx-capture: add 'New task' to PRD", baseline)).toBe(true);

    expect(latestCommitFiles(dir)).toEqual([".rex/prd_tree/uncommitted-epic/new-task.md"]);
    expect(dirtyPaths(dir)).toEqual([".rex/prd_tree/uncommitted-epic/index.md"]);
  });

  it("makes no commit when every dirty path was already dirty at the start", () => {
    writeFileSync(join(dir, "README.md"), "# test\n\nthe user's edit\n");
    const baseline = dirtyPaths(dir);
    const before = countCommits(dir);
    expect(runSkillCommitStep(dir, "ndx-config: update llm.vendor configuration", baseline)).toBe(false);
    expect(countCommits(dir)).toBe(before);
  });

  it("keeps work the user had already staged out of the commit, and still staged", () => {
    // `git commit` without a pathspec would take the whole index.
    writeFileSync(join(dir, "README.md"), "# test\n\nthe user's staged edit\n");
    writeFileSync(join(dir, "user-notes.txt"), "the user's staged notes\n");
    execFileSync("git", ["add", "--", "README.md", "user-notes.txt"], { cwd: dir });
    const baseline = dirtyPaths(dir);

    const prdDir = join(dir, ".rex", "prd_tree", "the-task");
    mkdirSync(prdDir, { recursive: true });
    writeFileSync(join(prdDir, "index.md"), "# The task\n");
    expect(runSkillCommitStep(dir, "ndx-capture: add 'The task' to PRD", baseline)).toBe(true);

    expect(latestCommitFiles(dir)).toEqual([".rex/prd_tree/the-task/index.md"]);
    expect(execSync("git diff --cached --name-only", { cwd: dir, encoding: "utf-8" }).split("\n").filter(Boolean).sort())
      .toEqual(["README.md", "user-notes.txt"]);
  });

  it("stages and commits a file with a non-ASCII name", () => {
    // Quoted porcelain output ("caf\303\251.md") does not match as a pathspec.
    writeFileSync(join(dir, "café.md"), "# Café\n");
    expect(runSkillCommitStep(dir, "fix: add the café notes")).toBe(true);
    expect(latestCommitFiles(dir)).toEqual(["café.md"]);
    expect(dirtyPaths(dir)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The overlap check: a dirty path the skill is about to touch
// ---------------------------------------------------------------------------

/**
 * The overlap check a PRD-writing skill runs before its first write: the
 * already-dirty paths under `.rex/prd_tree/`, which rex may rewrite (it
 * updates the parent's and ancestors' Children tables).
 */
function prdOverlap(baseline) {
  return baseline.filter((p) => p.startsWith(".rex/prd_tree/"));
}

describe("/ndx-capture: a parent index.md the user had already edited", () => {
  // Without the check, explicit-path staging committed the new task file but
  // left out the parent's Children row, because the parent was already dirty.
  const PARENT = ".rex/prd_tree/feature/index.md";
  const TASK = ".rex/prd_tree/feature/new-task.md";
  let dir;
  beforeEach(() => {
    dir = makeGitRepo();
    mkdirSync(join(dir, ".rex", "prd_tree", "feature"), { recursive: true });
    writeFileSync(join(dir, PARENT), "# Feature\n\n## Children\n");
    execFileSync("git", ["add", "--", PARENT], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "feature"], { cwd: dir });
    // The user's own uncommitted edit to the parent.
    writeFileSync(join(dir, PARENT), "# Feature\n\nThe user's edit.\n\n## Children\n");
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  /** What add_item writes: the task file and a Children row in its parent. */
  function addItem() {
    writeFileSync(join(dir, TASK), "# New task\n");
    writeFileSync(
      join(dir, PARENT),
      "# Feature\n\nThe user's edit.\n\n## Children\n\n| [New task](./new-task.md) | pending |\n",
    );
  }

  it("surfaces the parent before the write, and once the user commits it the skill's commit holds its whole change", () => {
    let baseline = dirtyPaths(dir);
    expect(prdOverlap(baseline)).toEqual([PARENT]);

    // The user commits their edit; the skill takes the snapshot again.
    execFileSync("git", ["commit", "-q", "-am", "the user's edit"], { cwd: dir });
    baseline = dirtyPaths(dir);
    expect(prdOverlap(baseline)).toEqual([]);

    addItem();
    expect(runSkillCommitStep(dir, "ndx-capture: add 'New task' to PRD", baseline)).toBe(true);
    expect(latestCommitFiles(dir).sort()).toEqual([PARENT, TASK]);
    expect(dirtyPaths(dir)).toEqual([]);
  });

  it("when the user declines, commits only the skill's own paths and leaves the parent out, still dirty", () => {
    const baseline = dirtyPaths(dir);
    expect(prdOverlap(baseline)).toEqual([PARENT]);

    addItem();
    expect(runSkillCommitStep(dir, "ndx-capture: add 'New task' to PRD", baseline)).toBe(true);
    expect(latestCommitFiles(dir)).toEqual([TASK]);
    // What the summary must name: paths still on the list.
    expect(dirtyPaths(dir).filter((p) => baseline.includes(p))).toEqual([PARENT]);
  });
});

// ---------------------------------------------------------------------------
// Linked worktrees: `.git` is a file
// ---------------------------------------------------------------------------

describe("skill commit step: works in a linked worktree", () => {
  let dir;
  let worktree;
  beforeEach(() => {
    dir = makeGitRepo();
    worktree = mkdtempSync(join(tmpdir(), "skill-commit-worktree-"));
    rmSync(worktree, { recursive: true, force: true });
    execFileSync("git", ["worktree", "add", "-q", "-b", "skill-branch", worktree], { cwd: dir });
  });
  afterEach(() => {
    rmSync(worktree, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("commits from the project-root scratch file where a .git/ scratch path cannot be written", () => {
    // The old scratch path: `.git` is a file here, so this write fails.
    expect(() => writeFileSync(join(worktree, ".git", "NDX_COMMIT_MSG"), "x")).toThrow();

    writeFileSync(join(worktree, ".n-dx.json"), '{"llm":{"vendor":"claude"}}\n');
    const message = buildSkillCommitMessage("ndx-config", "update llm.vendor configuration");
    expect(runSkillCommitStep(worktree, message)).toBe(true);

    expect(latestCommitFiles(worktree)).toEqual([".n-dx.json"]);
    expect(headTrailer(worktree, "N-DX")).toBe("skill/ndx-config");
    expect(existsSync(join(worktree, SCRATCH)), "scratch file left behind").toBe(false);
    expect(dirtyPaths(worktree)).toEqual([]);
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

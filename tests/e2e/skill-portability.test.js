/**
 * Structural tests: skills do not assume one environment.
 *
 * Skill bodies are installed by `ndx init` into arbitrary repositories, so an
 * instruction that works here is not automatically an instruction that works.
 * Two assumptions have shipped already and are guarded below:
 *
 *   1. A hardcoded default branch. `git diff main...HEAD` exits with
 *      "fatal: ambiguous argument 'main'" in a repo on `master`, `develop`, or
 *      `trunk`, leaving the skill's entry mode with no target.
 *   2. A POSIX-only timestamp command. `date -Is` does not exist in PowerShell,
 *      so naming it alone strands Windows users — and n-dx is developed on
 *      Windows.
 *
 * The skill list is derived from the manifest, so a NEW skill is covered the
 * moment it is added.
 *
 * @see packages/core/assistant-assets/skills/ — the bodies under test
 */

import { describe, it, expect } from "vitest";
import { getSkillNames, getSkillBody } from "../../packages/core/assistant-assets.js";

const SKILLS = getSkillNames();

// ── Default branch must be resolved, not named ───────────────────────────────

/**
 * A git revision range naming a conventional default branch, e.g.
 * `git diff main...HEAD` or `git log master..HEAD`. Matches the branch name
 * only when it sits inside a git command, so prose mentioning "the main
 * branch" does not trip the guard.
 */
const HARDCODED_BRANCH_IN_GIT_CMD =
  /git\s+(?:diff|log|merge-base|rev-list)[^\n`]*\b(?:main|master|develop|trunk)\b/;

describe("skills resolve the default branch instead of hardcoding it", () => {
  it("at least one skill exists (guards against a vacuous suite)", () => {
    expect(SKILLS.length).toBeGreaterThan(0);
  });

  for (const name of SKILLS) {
    it(`${name}: names no default branch inside a git command`, () => {
      const body = getSkillBody(name);
      const match = body.match(HARDCODED_BRANCH_IN_GIT_CMD);
      expect(
        match?.[0] ?? null,
        `${name} hardcodes a branch name in a git command. It ships to repos ` +
          `whose default branch is not that, where the command fails with ` +
          `"fatal: ambiguous argument". Resolve it with ` +
          `\`git symbolic-ref --short refs/remotes/origin/HEAD\` and ask the ` +
          `user when that cannot resolve.`,
      ).toBeNull();
    });
  }
});

// ── Timestamp instructions must not be POSIX-only ────────────────────────────

describe("timestamp instructions are platform-neutral", () => {
  for (const name of SKILLS) {
    it(`${name}: does not prescribe a POSIX-only timestamp command`, () => {
      const body = getSkillBody(name);
      if (!body.includes("date -Is")) return; // nothing to check

      // `date -Is` does not exist in PowerShell. Naming it is fine as one
      // example among several; naming it alone strands Windows users.
      expect(
        body,
        `${name} prescribes 'date -Is', which does not exist in PowerShell, ` +
          `without offering a non-POSIX alternative. Name it as one example ` +
          `alongside 'Get-Date -Format o' rather than as the instruction.`,
      ).toMatch(/Get-Date/);
    });
  }
});

// ── Commit steps must not be POSIX-only ──────────────────────────────────────

describe("commit-message construction is shell-neutral", () => {
  for (const name of SKILLS) {
    it(`${name}: builds no commit message with a heredoc or command substitution`, () => {
      const body = getSkillBody(name);

      // `cat <<'EOF'` and `$(...)` do not exist in PowerShell or cmd.exe, and
      // Git Bash is not part of Windows — it arrives only with Git for
      // Windows, whose usr/bin is NOT on PATH outside Git Bash itself. A
      // heredoc commit step therefore fails at the LAST step of the skill,
      // after all real work is done, on a stock Windows shell. Worse, an
      // assistant improvising around the parse error can drop the trailer
      // block, and a missing Co-Authored-By fails silently (the commit lands
      // but vanishes from the dashboard merge graph). Build the message with
      // the assistant's file-writing tool and `git commit -F <file>` instead.
      expect(
        body,
        `${name} uses a heredoc ('cat <<') to build a commit message — ` +
          `POSIX-only, fails in PowerShell/cmd.exe. Write the message to a ` +
          `scratch file with the file-writing tool and use 'git commit -F'.`,
      ).not.toMatch(/cat <</);
      expect(
        body,
        `${name} uses '$(...)' command substitution in a commit step — ` +
          `POSIX-only, fails in PowerShell/cmd.exe.`,
      ).not.toMatch(/\$\(cat/);
    });
  }
});

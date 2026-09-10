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
 * The skill list covers both the manifest skills and the repo-local ones, and
 * is derived rather than written down, so a NEW skill of either kind is covered
 * the moment it is added. Repo-local skills matter here even though `ndx init`
 * does not install them: the repo is developed on Windows, so a POSIX-only
 * instruction strands its own authors.
 *
 * @see packages/core/assistant-assets/skills/ — the shipped bodies under test
 * @see tests/helpers/all-skills.js — how both kinds are enumerated
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allSkills } from "../helpers/all-skills.js";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Every skill, not just the ten in the manifest.
 *
 * This suite used to derive its list from `getSkillNames()`, which exempted the
 * three repo-local skills (`iso-map`, `triage`, `dev-link`) from every guard
 * below — silently, because the suite still passed. The rules here exist
 * because bad assumptions shipped twice already; there is no reason a
 * repo-local skill should be free to ship a third.
 */
const SKILLS = allSkills();

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

  for (const { name, body } of SKILLS) {
    it(`${name}: names no default branch inside a git command`, () => {
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
  for (const { name, body } of SKILLS) {
    it(`${name}: does not prescribe a POSIX-only timestamp command`, () => {
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
  for (const { name, body } of SKILLS) {
    it(`${name}: builds no commit message with a heredoc or command substitution`, () => {

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

// ── The authoring reference must teach the rule it is enforcing ──────────────

describe("SKILLS.md prescribes the commit pattern the guard allows", () => {
  /**
   * The reference every new skill is written from.
   *
   * Checking the skills alone left a gap wide enough to reintroduce the bug on
   * the next skill anyone wrote: `SKILLS.md` documented the required commit
   * step as `git commit -m "$(cat <<'EOF' ... EOF)"` — exactly the construction
   * the assertions above reject — so following the documentation produced a
   * skill that failed CI, and the two disagreed with no test able to notice.
   */
  const REFERENCE = join(ROOT, "packages/core/assistant-assets/SKILLS.md");
  const body = readFileSync(REFERENCE, "utf-8");

  it("does not teach a heredoc commit step", () => {
    expect(
      body,
      "SKILLS.md prescribes a heredoc for the commit message, which the rule " +
        "above forbids in the skills themselves. A skill author following the " +
        "reference writes a skill that fails this suite.",
    ).not.toMatch(/cat <</);
  });

  it("does not teach command substitution in a commit step", () => {
    expect(body).not.toMatch(/\$\(cat/);
  });

  it("teaches the file-based form the skills actually use", () => {
    expect(
      body,
      "SKILLS.md should prescribe writing the message to a scratch file and " +
        "committing with 'git commit -F <file>'.",
    ).toMatch(/git commit -F/);
  });

  it("still requires both trailer lines", () => {
    // The reason the commit step is prescribed at all: a commit missing
    // Co-Authored-By lands fine and vanishes from the dashboard merge graph.
    expect(body).toContain("N-DX:");
    expect(body).toContain("Co-Authored-By:");
  });
});

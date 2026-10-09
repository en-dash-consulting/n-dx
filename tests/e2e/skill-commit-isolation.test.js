/**
 * Structural tests: per-skill commit step format and hench path isolation.
 *
 * These tests are static (no git operations, no LLM calls). They verify:
 *   1. Each file-modifying skill contains the required commit instructions
 *      in the correct format (guard → stage → commit with skill-scoped message).
 *   2. Read-only skills do not contain git commit instructions.
 *   3. The hench run-loop commit pathway (shared.ts) is not modified by
 *      skill-level commit additions — no skill-specific commit messages appear
 *      in the hench agent lifecycle, and the key hench commit infrastructure
 *      (PENDING_COMMIT_FILE, performCommitPromptIfNeeded, didAutoCommit) remains intact.
 *
 * Companion behavioral tests that use a live git repo fixture live in:
 *   tests/integration/skill-commit-behavior.test.js
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getSkillBody,
  getSkillNames,
  getManifest,
} from "../../packages/core/assistant-assets.js";
import { CO_AUTHORED_BY_TRAILER } from "../../packages/core/commit-trailers.js";

const ROOT = join(import.meta.dirname, "../..");

// Both lists come from the manifest's `commits` flag rather than from scanning
// the bodies for "git commit". Deriving them from body content would make the
// read-only assertion tautological — it would assert exactly the criterion that
// selected the skill, and pass forever without checking anything. Reading the
// declared intent instead means a skill that commits without declaring it fails
// the read-only assertion, which is the case worth catching.
const SKILL_META = getManifest().skills;

/** Skills that declare they commit, and must include a commit step. */
const FILE_MODIFYING_SKILLS = getSkillNames().filter((n) => SKILL_META[n].commits === true);

/** Skills that declare no commit, and must NOT include git commit instructions. */
const READ_ONLY_SKILLS = getSkillNames().filter((n) => SKILL_META[n].commits !== true);

// ── File-modifying skill commit step format ──────────────────────────────────

describe("file-modifying skills: commit step presence", () => {
  for (const skill of FILE_MODIFYING_SKILLS) {
    it(`${skill}: contains no-op guard (git status --porcelain)`, () => {
      const body = getSkillBody(skill);
      expect(body).toContain("git status --porcelain");
    });

    // ndx-adversarial-review's diff mode takes the dirty working tree as its
    // review subject, so it must stage only the PRD tree it wrote — `git add -A`
    // there would commit the very work under review. Every other committing
    // skill has no uncommitted subject and stages everything.
    const expectedStage =
      skill === "ndx-adversarial-review" ? "git add .rex/prd_tree/" : "git add -A";

    it(`${skill}: stages its changes before committing (${expectedStage})`, () => {
      const body = getSkillBody(skill);
      expect(body).toContain(expectedStage);
      if (skill === "ndx-adversarial-review") {
        // The body may only mention `git add -A` to prohibit it.
        expect(body).toContain("never `git add -A`");
      }
    });

    // ndx-work's commit is the *task's* work, not the skill's own bookkeeping,
    // so its subject follows the project's commit convention (`feat(rex): …`)
    // and an `ndx-work:` prefix would be wrong. `N-DX: skill/ndx-work`, asserted
    // below, carries the attribution instead. Every other committing skill
    // writes only its own PRD/config change and names itself in the subject.
    if (skill === "ndx-work") {
      it(`${skill}: defers the subject to the project's commit convention`, () => {
        const body = getSkillBody(skill);
        expect(body).toMatch(/commit convention the project's workflow asks for/);
        // Asserting the absence of the prefix would be satisfied by the
        // sentence that forbids it, so check the template instead: the fenced
        // message block must open with the placeholder, not with the skill name.
        expect(body).toMatch(/```\n\s*<subject>\n/);
      });
    } else {
      it(`${skill}: uses skill-scoped commit message prefix`, () => {
        const body = getSkillBody(skill);
        // The commit message must start with the skill name so commits are attributable.
        expect(body).toContain(`${skill}:`);
      });
    }

    it(`${skill}: commit step is conditional — skip when tree is clean`, () => {
      const body = getSkillBody(skill);
      // Must mention the "empty → stop" guard so the skill is a no-op on a clean tree.
      expect(body).toMatch(/if.*empty.*stop|nothing to commit|Working tree clean/i);
    });

    it(`${skill}: commit message includes n-dx authorship trailer`, () => {
      const body = getSkillBody(skill);
      // Co-Authored-By trailer routes commits to the n-dx GitHub identity.
      expect(body).toContain("Co-Authored-By: En Dash's n-dx <n-dx@endash.us>");
    });

    it(`${skill}: commit message includes model audit trailer (N-DX: skill/<name>)`, () => {
      const body = getSkillBody(skill);
      // N-DX trailer identifies which skill produced the commit — the model audit trail.
      expect(body).toContain(`N-DX: skill/${skill}`);
    });

    it(`${skill}: runs git status --porcelain against project root (catches MCP side-effects)`, () => {
      const body = getSkillBody(skill);
      // The body must call out that porcelain status detects MCP-side-effect writes,
      // not just direct file edits — that's the regression we're guarding against.
      expect(body.toLowerCase()).toMatch(/mcp|prd_tree|side-effect|project root/);
    });
  }
});

// ── The item trailer: emitted when the commit is for exactly one item ───────

/**
 * Committing skills whose commit is for exactly one PRD item, and must
 * therefore carry `N-DX-Item`.
 *
 * The rule (stated once in `packages/core/commit-trailers.js`): a commit emits
 * `N-DX-Item` when it is for exactly one item. `ndx-work` commits the task it
 * implemented; `ndx-capture` commits the single item it created. The others
 * span a batch — `ndx-plan` and `ndx-adversarial-review` create several items,
 * `ndx-reshape` restructures several — and naming one of the N would attribute
 * the whole commit to it in rex's realized-by edge. `ndx-config` writes config
 * and is for no item at all.
 *
 * Written down rather than derived: which skills are single-item is a product
 * decision, and deriving it from the bodies would make both assertions below
 * restate whatever the bodies happen to say.
 */
const SINGLE_ITEM_SKILLS = new Set(["ndx-work", "ndx-capture"]);

describe("item trailer: N-DX-Item names the item a skill's commit is for", () => {
  it("the single-item set is a subset of the committing skills", () => {
    // Catches a renamed or un-flagged skill, which would otherwise silently
    // drop out of the assertions below.
    for (const skill of SINGLE_ITEM_SKILLS) {
      expect(FILE_MODIFYING_SKILLS, `${skill} is not a committing skill`).toContain(skill);
    }
  });

  for (const skill of FILE_MODIFYING_SKILLS) {
    if (SINGLE_ITEM_SKILLS.has(skill)) {
      it(`${skill}: commit message carries N-DX-Item`, () => {
        const body = getSkillBody(skill);
        expect(
          body,
          `${skill} commits for exactly one PRD item, so its trailer block must ` +
            `include "N-DX-Item: <id>" — it is the only thing tying the commit to ` +
            `the item (rex's realized-by edge reads the trailer, never the subject).`,
        ).toContain("N-DX-Item: <id>");
      });

      it(`${skill}: tells the author to use the bare id, not a dashboard URL`, () => {
        // The trailer used to carry `<publicUrl>/#/rex/item/<id>`, which baked
        // the writer's host into permanent history. Readers still unwrap that
        // form, but nothing should emit it.
        expect(getSkillBody(skill).toLowerCase()).toMatch(/bare.*never a dashboard url|never a dashboard url/);
      });
    } else {
      it(`${skill}: emits no N-DX-Item — its commit spans more than one item`, () => {
        const body = getSkillBody(skill);
        expect(
          body,
          `${skill}'s commit is not for a single item, so it must not emit ` +
            `N-DX-Item. Add it to SINGLE_ITEM_SKILLS only if the skill's commit ` +
            `is for exactly one item.`,
        ).not.toContain("N-DX-Item:");
      });
    }
  }
});

// ── Read-only skills must not commit ────────────────────────────────────────

describe("read-only skills: no commit step", () => {
  it("both classifications are non-empty (guards against a vacuous suite)", () => {
    expect(FILE_MODIFYING_SKILLS.length).toBeGreaterThan(0);
    expect(READ_ONLY_SKILLS.length).toBeGreaterThan(0);
  });

  for (const skill of READ_ONLY_SKILLS) {
    it(`${skill}: does not contain git commit instructions`, () => {
      const body = getSkillBody(skill);
      expect(
        body,
        `${skill} contains git commit instructions but does not declare ` +
          `"commits": true in packages/core/assistant-assets/manifest.json. ` +
          `Either declare it — and then it must carry the full commit step with ` +
          `both trailers — or remove the commit instructions.`,
      ).not.toContain("git commit");
    });
  }
});

// ── Trailer string parity across the tier boundary ───────────────────────────

describe("co-authorship trailer: core and hench copies agree", () => {
  // core is the orchestration tier and must not import from packages, so the
  // trailer string is necessarily duplicated. This asserts the copies are
  // byte-identical, so the duplication cannot drift silently — a commit written
  // with a mismatched trailer would still succeed and just never be attributed.
  it("core's CO_AUTHORED_BY_TRAILER matches hench's buildCoAuthoredByTrailerLine()", () => {
    const henchSrc = readFileSync(
      join(ROOT, "packages/hench/src/agent/lifecycle/shared.ts"),
      "utf-8",
    );
    expect(
      henchSrc,
      `hench's trailer literal no longer matches core's CO_AUTHORED_BY_TRAILER ` +
        `("${CO_AUTHORED_BY_TRAILER}"). Update packages/core/commit-trailers.js ` +
        `and hench's buildCoAuthoredByTrailerLine() together.`,
    ).toContain(`return "${CO_AUTHORED_BY_TRAILER}";`);
  });

  it("every skill that commits uses the same trailer string", () => {
    for (const skill of FILE_MODIFYING_SKILLS) {
      expect(getSkillBody(skill), `${skill} uses a different trailer string`).toContain(
        CO_AUTHORED_BY_TRAILER,
      );
    }
  });
});

// ── Hench run-loop isolation ─────────────────────────────────────────────────

describe("hench run-loop: commit pathway is unmodified", () => {
  const sharedSrc = readFileSync(
    join(ROOT, "packages/hench/src/agent/lifecycle/shared.ts"),
    "utf-8",
  );

  it("performCommitPromptIfNeeded is present (hench commit pathway intact)", () => {
    expect(sharedSrc).toContain("performCommitPromptIfNeeded");
  });

  it("PENDING_COMMIT_FILE sentinel is present (hench commit file convention intact)", () => {
    expect(sharedSrc).toContain("PENDING_COMMIT_FILE");
  });

  it("didAutoCommit guard is present (timer-expiry stall-recovery intact)", () => {
    expect(sharedSrc).toContain("didAutoCommit");
  });

  it("hench commit pathway does not reference ndx-config commit message", () => {
    expect(sharedSrc).not.toContain("ndx-config:");
  });

  it("hench commit pathway does not reference ndx-capture commit message", () => {
    expect(sharedSrc).not.toContain("ndx-capture:");
  });

  it("hench commit pathway does not reference ndx-plan commit message", () => {
    expect(sharedSrc).not.toContain("ndx-plan:");
  });

  it("hench commit pathway does not reference ndx-reshape commit message", () => {
    expect(sharedSrc).not.toContain("ndx-reshape:");
  });
});

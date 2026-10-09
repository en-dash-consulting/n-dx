/**
 * Structural tests: per-skill commit step format and hench path isolation.
 *
 * These tests are static (no git operations, no LLM calls). They verify:
 *   1. Each file-modifying skill contains the required commit instructions
 *      in the correct format (snapshot → guard → explicit-path stage → commit
 *      from a project-root message file, with a skill-scoped message).
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
import { existsSync, readFileSync } from "node:fs";
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

/** The snapshot of already-dirty paths a committing skill takes at its start. */
// core.quotepath=false: porcelain otherwise quotes non-ASCII paths, and `git add --`
// does not match the quoted form.
const SNAPSHOT_COMMAND = "git -c core.quotepath=false status --porcelain --untracked-files=all";

/** The commit names the paths it staged, so the user's pre-staged work stays out. */
const SCOPED_COMMIT = "git commit -F .ndx-commit-msg.txt -- <the same paths>";

/** What the overlap check asks of the user, and how the skill resumes after. */
const OVERLAP_ASK = "ask the user to commit or stash";
const RESNAPSHOT = "again and keep that output as the list instead";

/** The paragraph (or list item) of `text` containing the index `at`. */
function paragraphAt(text, at) {
  const start = text.lastIndexOf("\n", at) + 1;
  const end = text.indexOf("\n", at);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The one sentence that may name whole-tree staging: the one forbidding it. */
const STAGING_PROHIBITION = "Never `git add -A` or `git add .`";

/**
 * Every `git add` in `text` that stages the whole tree, once the prohibition
 * sentence is set aside. Covers `-A`, `--all` and a bare `.` (not `.rex/…`).
 */
function wholeTreeStaging(text) {
  return [
    ...text
      .replaceAll(STAGING_PROHIBITION, "")
      .matchAll(/git add (?:-A|--all|\.(?![\w/-]))/g),
  ].map((m) => m[0]);
}

/** Every `git commit -F <file>` in `text` not followed by a `--` pathspec. */
function unscopedCommits(text) {
  return [...text.matchAll(/git commit -F \S+(?:\s+--\s)?/g)]
    .map((m) => m[0])
    .filter((cmd) => !/\s--\s$/.test(cmd));
}

/** Every path under `.git/` that `text` names, such as `.git/NDX_COMMIT_MSG`. */
function pathsUnderDotGit(text) {
  return [...text.matchAll(/\.git\/[\w.-]+/g)].map((m) => m[0]);
}

/**
 * Every text that teaches a commit step: the canonical skill sources, each
 * vendor's generated copies, and the skill-author template. A generated copy
 * that drifted from its source is skill-sync's to catch; this guards the rule
 * in whichever copy an assistant actually reads.
 */
function commitStepTexts() {
  const texts = getSkillNames().map((name) => ({
    label: `assistant-assets/skills/${name}.md`,
    text: getSkillBody(name),
  }));
  for (const skillDir of [".claude/skills", ".agents/skills"]) {
    for (const name of getSkillNames()) {
      const file = join(ROOT, skillDir, name, "SKILL.md");
      if (existsSync(file)) {
        texts.push({ label: `${skillDir}/${name}/SKILL.md`, text: readFileSync(file, "utf-8") });
      }
    }
  }
  texts.push({
    label: "assistant-assets/SKILLS.md",
    text: readFileSync(join(ROOT, "packages/core/assistant-assets/SKILLS.md"), "utf-8"),
  });
  return texts;
}

// ── File-modifying skill commit step format ──────────────────────────────────

describe("file-modifying skills: commit step presence", () => {
  for (const skill of FILE_MODIFYING_SKILLS) {
    it(`${skill}: contains no-op guard (status --porcelain)`, () => {
      const body = getSkillBody(skill);
      expect(body).toContain("status --porcelain");
    });

    // A skill runs in the user's working tree, which can hold their unrelated
    // in-progress work — for /ndx-work, across a long session. The commit step
    // stages only paths that were not dirty when the skill started, so the
    // skill must take that snapshot before its first write.
    it(`${skill}: notes the already-dirty paths before it writes anything`, () => {
      const body = getSkillBody(skill);
      const snapshot = body.indexOf(SNAPSHOT_COMMAND);
      expect(snapshot, `no \`${SNAPSHOT_COMMAND}\` snapshot`).toBeGreaterThan(-1);
      expect(body).toMatch(/keep its output/);
      expect(snapshot, "the snapshot must come before the commit step").toBeLessThan(
        body.indexOf("git commit -F"),
      );
    });

    // Explicit-path staging alone keeps an already-dirty path out of the
    // commit even when the skill changed it — /ndx-capture would commit a task
    // file without its parent's Children row. So before the first write the
    // skill asks the user to commit or stash any dirty path it will touch.
    it(`${skill}: checks for overlap with the dirty paths before its first write`, () => {
      const body = getSkillBody(skill);
      const check = body.indexOf(OVERLAP_ASK);
      expect(check, `no "${OVERLAP_ASK}" overlap check`).toBeGreaterThan(-1);
      expect(check, "the check must follow the snapshot").toBeGreaterThan(body.indexOf(SNAPSHOT_COMMAND));
      expect(check, "the check must come before the commit step").toBeLessThan(body.indexOf("git commit -F"));
      const sentence = paragraphAt(body, check);
      expect(sentence).toContain(RESNAPSHOT);
      if (skill !== "ndx-config") {
        // rex rewrites ancestors' index.md, so any dirty PRD path overlaps.
        expect(sentence).toContain("`.rex/prd_tree/`");
      }
    });

    it(`${skill}: stages by explicit path, never the whole tree`, () => {
      const body = getSkillBody(skill);
      expect(body).toContain("git add -- <path> <path> …");
      expect(body).toMatch(/not on the list you kept/);
      expect(wholeTreeStaging(body), "stages the whole tree").toEqual([]);
    });

    it(`${skill}: writes the commit message to .ndx-commit-msg.txt at the project root`, () => {
      const body = getSkillBody(skill);
      expect(body).toContain("`.ndx-commit-msg.txt` at the project root");
      expect(body).toContain(SCOPED_COMMIT);
      expect(body).toContain("delete `.ndx-commit-msg.txt`");
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

// ── Every copy of the commit step: worktree-safe and scoped ──────────────────

describe("commit-step texts: no whole-tree staging, no scratch file under .git/", () => {
  // In a linked worktree `.git` is a file, not a directory, so a scratch file
  // such as `.git/NDX_COMMIT_MSG` fails with "not a directory" at the last
  // step of the skill. Whole-tree staging sweeps the user's in-progress work
  // into a commit attributed to the skill.
  for (const { label, text } of commitStepTexts()) {
    it(`${label}: names no path under .git/`, () => {
      expect(pathsUnderDotGit(text)).toEqual([]);
    });

    it(`${label}: never stages the whole tree`, () => {
      expect(wholeTreeStaging(text)).toEqual([]);
    });

    // `git commit` without a pathspec commits the whole index, including
    // anything the user had already `git add`-ed before the skill ran.
    it(`${label}: every commit names the paths it commits`, () => {
      expect(unscopedCommits(text)).toEqual([]);
    });

    it(`${label}: reads git status with unquoted paths`, () => {
      expect(text).not.toMatch(/git status --porcelain/);
    });
  }

  it("the scan covers each vendor's generated copies (guards against a vacuous suite)", () => {
    const labels = commitStepTexts().map((t) => t.label);
    expect(labels).toContain(".claude/skills/ndx-work/SKILL.md");
    expect(labels).toContain(".agents/skills/ndx-work/SKILL.md");
  });

  it("the skill-author template teaches the snapshot, the overlap check, explicit-path staging and the root scratch file", () => {
    const template = readFileSync(join(ROOT, "packages/core/assistant-assets/SKILLS.md"), "utf-8");
    expect(template).toContain(SNAPSHOT_COMMAND);
    // The template's code block wraps lines, so match across the wrap.
    expect(template.replace(/\s+/g, " ")).toContain(OVERLAP_ASK);
    expect(template.replace(/\s+/g, " ")).toContain(RESNAPSHOT);
    expect(template).toContain("git add -- <path> <path> …");
    expect(template).toContain(STAGING_PROHIBITION);
    expect(template).toContain(SCOPED_COMMIT);
  });
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

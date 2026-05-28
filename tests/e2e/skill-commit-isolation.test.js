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
import { getSkillBody } from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");

// Skills that modify files and must include a commit step.
const FILE_MODIFYING_SKILLS = ["ndx-config", "ndx-capture", "ndx-plan", "ndx-reshape"];

// Skills that are read-only and must NOT include git commit instructions.
const READ_ONLY_SKILLS = ["ndx-status", "ndx-zone", "ndx-feedback", "no-plan-mode", "ndx-work"];

// ── File-modifying skill commit step format ──────────────────────────────────

describe("file-modifying skills: commit step presence", () => {
  for (const skill of FILE_MODIFYING_SKILLS) {
    it(`${skill}: contains no-op guard (git status --porcelain)`, () => {
      const body = getSkillBody(skill);
      expect(body).toContain("git status --porcelain");
    });

    it(`${skill}: stages all changes before committing (git add -A)`, () => {
      const body = getSkillBody(skill);
      expect(body).toContain("git add -A");
    });

    it(`${skill}: uses skill-scoped commit message prefix`, () => {
      const body = getSkillBody(skill);
      // The commit message must start with the skill name so commits are attributable.
      expect(body).toContain(`"${skill}:`);
    });

    it(`${skill}: commit step is conditional — skip when tree is clean`, () => {
      const body = getSkillBody(skill);
      // Must mention the "empty → stop" guard so the skill is a no-op on a clean tree.
      expect(body).toMatch(/if.*empty.*stop|nothing to commit|Working tree clean/i);
    });
  }
});

// ── Read-only skills must not commit ────────────────────────────────────────

describe("read-only skills: no commit step", () => {
  for (const skill of READ_ONLY_SKILLS) {
    it(`${skill}: does not contain git commit instructions`, () => {
      const body = getSkillBody(skill);
      expect(body).not.toContain("git commit");
    });
  }
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

/**
 * Validates that skill definitions stay in sync across three locations:
 *
 *   1. `assistant-assets/` — the vendor-neutral canonical source
 *      (registry.json + skills/*.md)
 *   2. `.claude/skills/` — the Claude Code output
 *      (rendered from assistant-assets/ via renderClaudeSkill)
 *   3. `claude-integration.js` — the init module that writes (2)
 *      (must import from assistant-assets/, not define skills inline)
 *
 * When a skill is added, renamed, or modified in one place but not the
 * others, these tests fail with a diff showing what's out of sync.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  getRegistry,
  getSkillNames,
  getSkillBody,
  listSkillFiles,
  renderClaudeSkill,
} from "../../assistant-assets/index.js";

const ROOT = join(import.meta.dirname, "../..");

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize whitespace so trivial formatting differences don't break sync. */
const normalize = (s) =>
  s.replace(/→/g, "->").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();

/**
 * Read all local Claude skill files from .claude/skills/.
 * Returns a Map of skill name → content string.
 */
function readClaudeSkills() {
  const skillsDir = join(ROOT, ".claude", "skills");
  if (!existsSync(skillsDir)) return new Map();

  const skills = new Map();
  for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillFile = join(skillsDir, dir.name, "SKILL.md");
    if (existsSync(skillFile)) {
      skills.set(dir.name, readFileSync(skillFile, "utf-8").trim());
    }
  }

  return skills;
}

// ── Canonical source integrity (assistant-assets/) ──────────────────────────

describe("assistant-assets canonical source", () => {
  const registry = getRegistry();
  const registryNames = Object.keys(registry.skills).sort();
  const fileNames = listSkillFiles();

  it("registry.json has an entry for every skill file", () => {
    const missing = fileNames.filter((f) => !registry.skills[f]);
    if (missing.length > 0) {
      expect.fail(
        `Skill files without registry entries: ${missing.join(", ")}\n` +
        "Add entries to assistant-assets/registry.json.",
      );
    }
  });

  it("every registry entry has a corresponding skill file", () => {
    const missing = registryNames.filter((n) => !fileNames.includes(n));
    if (missing.length > 0) {
      expect.fail(
        `Registry entries without skill files: ${missing.join(", ")}\n` +
        "Create matching assistant-assets/skills/<name>.md files.",
      );
    }
  });

  it("every registry entry has a non-empty description", () => {
    const bad = registryNames.filter((n) => !registry.skills[n].description);
    if (bad.length > 0) {
      expect.fail(
        `Registry entries missing description: ${bad.join(", ")}`,
      );
    }
  });

  it("every skill body is non-empty", () => {
    const empty = [];
    for (const name of getSkillNames()) {
      const body = getSkillBody(name);
      if (body.trim().length === 0) {
        empty.push(name);
      }
    }
    if (empty.length > 0) {
      expect.fail(`Empty skill bodies: ${empty.join(", ")}`);
    }
  });
});

// ── Claude output sync (.claude/skills/ ↔ assistant-assets/) ────────────────

describe("claude skill file sync", () => {
  const claudeSkills = readClaudeSkills();
  const skillNames = getSkillNames();

  it("local .claude/skills/ has entries for all canonical skills", () => {
    const missing = skillNames.filter((n) => !claudeSkills.has(n));
    if (missing.length > 0) {
      expect.fail(
        `Canonical skills not in .claude/skills/: ${missing.join(", ")}\n` +
        "Run `ndx init .` to regenerate, or create matching " +
        ".claude/skills/<name>/SKILL.md files.",
      );
    }
  });

  it("local .claude/skills/ has no extra skills beyond the canonical set", () => {
    const nameSet = new Set(skillNames);
    const extra = [...claudeSkills.keys()].filter((n) => !nameSet.has(n));
    if (extra.length > 0) {
      expect.fail(
        `Extra skills in .claude/skills/ not in canonical source: ${extra.join(", ")}\n` +
        "Add them to assistant-assets/ or remove from .claude/skills/.",
      );
    }
  });

  for (const name of skillNames) {
    it(`"${name}" Claude output matches canonical render`, () => {
      const local = claudeSkills.get(name);
      if (!local) return; // covered by the "has entries" test above

      const expected = renderClaudeSkill(name);

      if (normalize(local) !== normalize(expected)) {
        const localLines = normalize(local).split("\n");
        const expectedLines = normalize(expected).split("\n");
        let diffLine = -1;
        for (let i = 0; i < Math.max(localLines.length, expectedLines.length); i++) {
          if (localLines[i] !== expectedLines[i]) {
            diffLine = i + 1;
            break;
          }
        }
        expect.fail(
          `Skill "${name}" is out of sync (first difference at line ${diffLine}).\n` +
          "Update assistant-assets/skills/" + name + ".md (canonical source), " +
          "then run `ndx init .` to regenerate .claude/skills/.",
        );
      }
    });
  }
});

// ── claude-integration.js uses canonical source ─────────────────────────────

describe("claude-integration.js uses canonical source", () => {
  const src = readFileSync(join(ROOT, "claude-integration.js"), "utf-8");

  it("imports from assistant-assets/", () => {
    expect(src).toContain("from \"./assistant-assets/index.js\"");
  });

  it("does not contain inline SKILLS object", () => {
    // The old pattern was `const SKILLS = {` with template literals.
    // The new pattern uses a lazy getter wrapping renderAllClaudeSkills().
    if (/^const SKILLS\s*=\s*\{/m.test(src)) {
      expect.fail(
        "claude-integration.js still contains an inline SKILLS object.\n" +
        "It should import skills from assistant-assets/ instead.",
      );
    }
  });
});

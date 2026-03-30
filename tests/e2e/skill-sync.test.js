/**
 * Validates that skill definitions in claude-integration.js stay in sync
 * with the local .claude/skills/ files.
 *
 * When a skill is updated in one place but not the other, this test fails
 * with a diff showing what's out of sync.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Extract the SKILLS object entries from claude-integration.js.
 * Evaluates the SKILLS constant to get properly rendered content.
 * Returns a Map of skill name → content string.
 */
function extractSkillsFromCI() {
  const src = readFileSync(join(ROOT, "packages/core/claude-integration.js"), "utf-8");

  const start = src.indexOf("const SKILLS = {");
  if (start === -1) throw new Error("Could not find SKILLS object in claude-integration.js");

  // Find the closing `};` for the SKILLS object
  const end = src.indexOf("\n};", start) + 3;
  const skillsSrc = src.substring(start, end);

  // Evaluate to get rendered content (template literals resolved)
  const SKILLS = new Function(skillsSrc.replace("const SKILLS =", "return"))();

  const skills = new Map();
  for (const [name, content] of Object.entries(SKILLS)) {
    skills.set(name, String(content).trim());
  }

  return skills;
}

/**
 * Read all local skill files from .claude/skills/.
 * Returns a Map of skill name → content string.
 */
function readLocalSkills() {
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

describe("skill file sync", () => {
  const ciSkills = extractSkillsFromCI();
  const localSkills = readLocalSkills();

  it("claude-integration.js has entries for all local skills", () => {
    const missing = [];
    for (const name of localSkills.keys()) {
      if (!ciSkills.has(name)) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      expect.fail(
        `Local skills not in claude-integration.js: ${missing.join(", ")}\n` +
        "Add them to the SKILLS object so ndx init installs them for all users.",
      );
    }
  });

  it("local skills exist for all claude-integration.js entries", () => {
    const missing = [];
    for (const name of ciSkills.keys()) {
      if (!localSkills.has(name)) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      expect.fail(
        `Skills in claude-integration.js but not in .claude/skills/: ${missing.join(", ")}\n` +
        "Create matching .claude/skills/<name>/SKILL.md files.",
      );
    }
  });

  for (const [name] of localSkills) {
    if (!ciSkills.has(name)) continue;

    it(`"${name}" content matches between local and claude-integration.js`, () => {
      const local = localSkills.get(name);
      const ci = ciSkills.get(name);

      // Normalize: arrow characters (→ vs ->), line endings, trailing whitespace
      const normalize = (s) => s.replace(/→/g, "->").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");

      if (normalize(local) !== normalize(ci)) {
        // Find first difference for a useful error
        const localLines = normalize(local).split("\n");
        const ciLines = normalize(ci).split("\n");
        let diffLine = -1;
        for (let i = 0; i < Math.max(localLines.length, ciLines.length); i++) {
          if (localLines[i] !== ciLines[i]) {
            diffLine = i + 1;
            break;
          }
        }
        expect.fail(
          `Skill "${name}" is out of sync (first difference at line ${diffLine}).\n` +
          `Update claude-integration.js or .claude/skills/${name}/SKILL.md to match.`,
        );
      }
    });
  }
});

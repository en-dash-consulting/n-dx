/**
 * Validates that skill definitions in the assistant-assets manifest stay in sync
 * with the local .claude/skills/ files.
 *
 * When a skill is updated in one place but not the other, this test fails
 * with a diff showing what's out of sync.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  getManifest,
  getSkillNames,
  getSkillBody,
} from "../../assistant-assets/index.js";

const ROOT = join(import.meta.dirname, "../..");

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

/**
 * List skill file names from the assistant-assets/skills/ directory.
 */
function listSkillFiles() {
  const skillsDir = join(ROOT, "assistant-assets", "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

// ── Manifest structure validation ───────────────────────────────────────────

describe("assistant-assets manifest structure", () => {
  const manifest = getManifest();

  it("manifest has required top-level keys", () => {
    expect(manifest).toHaveProperty("skills");
    expect(manifest).toHaveProperty("mcpServers");
    expect(manifest).toHaveProperty("vendors");
  });

  it("skills section has at least one entry", () => {
    expect(Object.keys(manifest.skills).length).toBeGreaterThan(0);
  });

  it("every skill has a non-empty description", () => {
    const bad = Object.entries(manifest.skills)
      .filter(([, meta]) => !meta.description || meta.description.trim() === "")
      .map(([name]) => name);
    if (bad.length > 0) {
      expect.fail(`Skills missing description: ${bad.join(", ")}`);
    }
  });

  it("every skill body file exists and is non-empty", () => {
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

  it("every skill file has a manifest entry", () => {
    const fileNames = listSkillFiles();
    const missing = fileNames.filter((f) => !manifest.skills[f]);
    if (missing.length > 0) {
      expect.fail(
        `Skill files without manifest entries: ${missing.join(", ")}\n` +
        "Add entries to assistant-assets/manifest.json.",
      );
    }
  });
});

describe("skill file sync", () => {
  const localSkills = readLocalSkills();
  const manifestSkillNames = new Set(getSkillNames());

  it("local skills exist for all manifest entries", () => {
    const missing = [];
    for (const name of manifestSkillNames) {
      if (!localSkills.has(name)) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      expect.fail(
        `Skills in manifest but not in .claude/skills/: ${missing.join(", ")}\n` +
        "Create matching .claude/skills/<name>/SKILL.md files.",
      );
    }
  });

  it("manifest has entries for all local ndx skills", () => {
    const missing = [];
    for (const name of localSkills.keys()) {
      if (!manifestSkillNames.has(name) && name.includes("ndx")) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      expect.fail(
        `Local skills not in manifest: ${missing.join(", ")}\n` +
        "Add them to assistant-assets/manifest.json so ndx init installs them for all users.",
      );
    }
  });
});

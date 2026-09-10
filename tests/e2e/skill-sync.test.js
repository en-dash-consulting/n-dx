/**
 * Validates that skill definitions in the assistant-assets manifest stay in sync
 * with the local .claude/skills/ files.
 *
 * When a skill is updated in one place but not the other, this test fails
 * with a diff showing what's out of sync.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  getManifest,
  getSkillNames,
  getSkillBody,
} from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");

/**
 * List skill names from the assistant-assets/skills/ directory.
 * Skills are stored as flat <name>.md files (e.g., ndx-plan.md).
 */
function listSkillFiles() {
  const skillsDir = join(ROOT, "packages/core/assistant-assets", "skills");
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => d.name.replace(/\.md$/, ""));
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
  const canonicalSkills = new Set(listSkillFiles());
  const manifestSkillNames = new Set(getSkillNames());

  it("canonical skill files exist for all manifest entries", () => {
    const missing = [];
    for (const name of manifestSkillNames) {
      if (!canonicalSkills.has(name)) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      expect.fail(
        `Skills in manifest but not in assistant-assets/skills/: ${missing.join(", ")}\n` +
        "Create matching assistant-assets/skills/<name>.md files.",
      );
    }
  });

  it("manifest has entries for all canonical skill files", () => {
    const missing = [];
    for (const name of canonicalSkills) {
      if (!manifestSkillNames.has(name)) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      expect.fail(
        `Canonical skill files not in manifest: ${missing.join(", ")}\n` +
        "Add them to assistant-assets/manifest.json so ndx init installs them for all users.",
      );
    }
  });
});

// ── The shipped copy differs from the source by frontmatter and nothing else ──

describe("shipped skills differ from their source only by frontmatter", () => {
  /**
   * The one permitted difference, asserted rather than assumed.
   *
   * `.claude/skills/<name>/SKILL.md` is generated as YAML frontmatter followed
   * by the canonical body verbatim, which is why its line count runs a few
   * higher than `assistant-assets/skills/<name>.md`. That gap has been read as
   * drift before now; it is not.
   *
   * `assistant-body-drift.test.js` compares the committed artifact against what
   * the generator produces today, so the two always agree — including when the
   * generator is what is wrong. Nothing compared the generated *body* against
   * the canonical source, so a renderer that dropped or reordered a section
   * would keep both suites green while shipping a skill that no longer matched
   * the file its authors edit.
   */
  const normalize = (s) => s.replace(/\r\n/g, "\n");

  /** Split a generated skill into its frontmatter block and its body. */
  function splitGenerated(text) {
    const match = /^---\n[\s\S]*?\n---\n\n/.exec(normalize(text));
    return match
      ? { frontmatter: match[0], body: normalize(text).slice(match[0].length) }
      : { frontmatter: "", body: normalize(text) };
  }

  for (const name of getSkillNames()) {
    const installed = join(ROOT, ".claude", "skills", name, "SKILL.md");

    it(`${name}: body is byte-identical to the canonical source`, () => {
      expect(existsSync(installed), `${installed} not generated`).toBe(true);
      const { body } = splitGenerated(readFileSync(installed, "utf-8"));
      expect(body).toBe(normalize(getSkillBody(name)));
    });

    it(`${name}: adds YAML frontmatter and nothing else`, () => {
      const { frontmatter } = splitGenerated(readFileSync(installed, "utf-8"));
      expect(frontmatter, "generated skill has no frontmatter block").not.toBe("");
      // Only the keys the renderer is documented to emit. A new key here is a
      // real change to what ships and should be a deliberate edit, not a
      // surprise found later.
      const keys = [...frontmatter.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
      expect(keys.every((k) => ["name", "description", "argument-hint"].includes(k))).toBe(true);
      expect(keys).toContain("name");
      expect(keys).toContain("description");
    });
  }
});

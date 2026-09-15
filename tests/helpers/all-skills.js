/**
 * Every skill body in the repo, whether or not it ships to consumer projects.
 *
 * Tests that check skill *content* kept deriving their list from
 * `getSkillNames()`, which reads the assistant-assets manifest. That manifest
 * holds only the ten skills `ndx init` installs elsewhere. Three more —
 * `iso-map`, `triage`, `dev-link` — live solely in `.claude/skills/` and were
 * therefore exempt from every content guard, including the portability rules
 * that exist because a bad assumption had already shipped twice.
 *
 * The exemption was invisible: those suites passed, named a skill count nobody
 * checked, and would have kept passing if a fourth repo-local skill arrived
 * with a hardcoded branch in it.
 *
 * Manifest skills are read from `packages/core/assistant-assets/skills/` — the
 * source of truth that `.claude/` and `.agents/` are generated from — so a
 * guard failure points at the file that needs editing rather than at a build
 * artifact. Repo-local skills are read from `.claude/skills/<name>/SKILL.md`
 * with their YAML frontmatter stripped, so both kinds present as plain bodies.
 *
 * @see tests/e2e/skill-portability.test.js — the guards this feeds
 * @see packages/core/assistant-assets.js — the manifest side
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getSkillNames, getSkillBody } from "../../packages/core/assistant-assets.js";

const ROOT = join(import.meta.dirname, "../..");
const CLAUDE_SKILLS = join(ROOT, ".claude", "skills");

/** Strip a leading `---`-delimited YAML frontmatter block, if present. */
function stripFrontmatter(text) {
  if (!text.startsWith("---")) return text;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? text : text.slice(text.indexOf("\n", end + 1) + 1);
}

/**
 * Skills that exist only in `.claude/skills/`, i.e. are not in the manifest.
 *
 * Derived by subtraction rather than hardcoded, so a new repo-local skill is
 * covered the moment its directory appears.
 */
export function getLocalSkillNames() {
  if (!existsSync(CLAUDE_SKILLS)) return [];
  const shipped = new Set(getSkillNames());
  return readdirSync(CLAUDE_SKILLS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !shipped.has(d.name))
    .filter((d) => existsSync(join(CLAUDE_SKILLS, d.name, "SKILL.md")))
    .map((d) => d.name)
    .sort();
}

/** Body of a repo-local skill, frontmatter removed. */
export function getLocalSkillBody(name) {
  return stripFrontmatter(
    readFileSync(join(CLAUDE_SKILLS, name, "SKILL.md"), "utf-8"),
  );
}

/**
 * Every skill: the ten shipped via the manifest plus the repo-local ones.
 *
 * @returns {{name: string, body: string, shipped: boolean, file: string}[]}
 */
export function allSkills() {
  const shipped = getSkillNames()
    .sort()
    .map((name) => ({
      name,
      body: getSkillBody(name),
      shipped: true,
      file: `packages/core/assistant-assets/skills/${name}.md`,
    }));

  const local = getLocalSkillNames().map((name) => ({
    name,
    body: getLocalSkillBody(name),
    shipped: false,
    file: `.claude/skills/${name}/SKILL.md`,
  }));

  return [...shipped, ...local];
}

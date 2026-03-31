/**
 * Vendor-neutral assistant asset registry.
 *
 * This module is the programmatic entry point for the canonical skill
 * definitions stored in `assistant-assets/skills/`.  It provides read-only
 * access to skill bodies and metadata so that vendor-specific integration
 * modules (claude-integration.js, future codex-integration.js) can render
 * assistant artifacts from one shared source of truth.
 *
 * @module assistant-assets
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Registry ────────────────────────────────────────────────────────────────

/** @type {import('./types').Registry | null} */
let _registryCache = null;

/**
 * Load the skill registry from `registry.json`.
 *
 * @returns {{ skills: Record<string, { description: string, argumentHint?: string }> }}
 */
export function getRegistry() {
  if (!_registryCache) {
    _registryCache = JSON.parse(
      readFileSync(join(__dir, "registry.json"), "utf-8"),
    );
  }
  return _registryCache;
}

// ── Skill enumeration ───────────────────────────────────────────────────────

/**
 * Return the ordered list of registered skill names.
 *
 * @returns {string[]}
 */
export function getSkillNames() {
  return Object.keys(getRegistry().skills);
}

// ── Skill body access ───────────────────────────────────────────────────────

/**
 * Read the markdown body for a single skill.
 *
 * @param {string} name  Skill name (e.g. "ndx-plan")
 * @returns {string}     Markdown body (no vendor-specific frontmatter)
 * @throws {Error}       If the skill file does not exist
 */
export function getSkillBody(name) {
  const file = join(__dir, "skills", `${name}.md`);
  if (!existsSync(file)) {
    throw new Error(`Skill body not found: ${file}`);
  }
  return readFileSync(file, "utf-8");
}

/**
 * Read all skill bodies keyed by name.
 *
 * @returns {Map<string, string>}  skill name → markdown body
 */
export function getAllSkillBodies() {
  const bodies = new Map();
  for (const name of getSkillNames()) {
    bodies.set(name, getSkillBody(name));
  }
  return bodies;
}

// ── Claude rendering ────────────────────────────────────────────────────────

/**
 * Render a skill as a Claude Code SKILL.md (YAML frontmatter + body).
 *
 * @param {string} name  Skill name
 * @returns {string}     Complete SKILL.md content
 */
export function renderClaudeSkill(name) {
  const meta = getRegistry().skills[name];
  if (!meta) {
    throw new Error(`Skill not in registry: ${name}`);
  }

  const body = getSkillBody(name);

  // Build YAML frontmatter
  const lines = ["---", `name: ${name}`, `description: ${meta.description}`];
  if (meta.argumentHint) {
    lines.push(`argument-hint: "${meta.argumentHint}"`);
  }
  lines.push("---");

  // Blank line separates YAML frontmatter from body (standard convention)
  return lines.join("\n") + "\n\n" + body;
}

/**
 * Render all skills as Claude Code SKILL.md content.
 *
 * @returns {Record<string, string>}  skill name → SKILL.md content
 */
export function renderAllClaudeSkills() {
  const result = {};
  for (const name of getSkillNames()) {
    result[name] = renderClaudeSkill(name);
  }
  return result;
}

// ── File-system discovery (for test validation) ─────────────────────────────

/**
 * List all `.md` files present in `skills/`, returning their base names
 * (without extension).  This is useful for tests that need to verify the
 * directory contents match the registry.
 *
 * @returns {string[]}
 */
export function listSkillFiles() {
  const dir = join(__dir, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

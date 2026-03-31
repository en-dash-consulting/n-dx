/**
 * Vendor-neutral assistant asset manifest and render contract.
 *
 * This module is the programmatic entry point for the canonical asset
 * definitions stored in `assistant-assets/`.  It provides read-only access
 * to skill bodies, MCP server descriptors, and vendor delivery targets so
 * that vendor-specific integration modules (claude-integration.js, future
 * codex-integration.js) can render assistant artifacts from one shared
 * source of truth.
 *
 * ## Render contract
 *
 * Vendor adapters call {@link renderSkill} or {@link renderAllSkills} with
 * a vendor id ("claude" or "codex").  The manifest defines the shared
 * meaning (skill metadata, MCP tool classification, delivery paths); vendor
 * adapters only adapt file locations and wrapper formatting.
 *
 * @module assistant-assets
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── Manifest ─────────────────────────────────────────────────────────────────

/** @type {object | null} */
let _manifestCache = null;

/**
 * Load the full asset manifest from `manifest.json`.
 *
 * The manifest is the single source of truth for skills, MCP server
 * descriptors, and vendor delivery targets.
 *
 * @returns {{ skills: Record<string, { description: string, argumentHint?: string }>,
 *             mcpServers: Record<string, object>,
 *             vendors: Record<string, object> }}
 */
export function getManifest() {
  if (!_manifestCache) {
    _manifestCache = JSON.parse(
      readFileSync(join(__dir, "manifest.json"), "utf-8"),
    );
  }
  return _manifestCache;
}

/**
 * Load the skill registry (backward-compatible view of the manifest).
 *
 * Returns the same `{ skills: ... }` shape that registry.json provided.
 * Existing callers that used `getRegistry().skills[name]` continue to work.
 *
 * @returns {{ skills: Record<string, { description: string, argumentHint?: string }> }}
 */
export function getRegistry() {
  const { skills } = getManifest();
  return { skills };
}

// ── Skill enumeration ───────────────────────────────────────────────────────

/**
 * Return the ordered list of registered skill names.
 *
 * @returns {string[]}
 */
export function getSkillNames() {
  return Object.keys(getManifest().skills);
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
 * @returns {Map<string, string>}  skill name -> markdown body
 */
export function getAllSkillBodies() {
  const bodies = new Map();
  for (const name of getSkillNames()) {
    bodies.set(name, getSkillBody(name));
  }
  return bodies;
}

// ── MCP server descriptors ──────────────────────────────────────────────────

/**
 * Return the MCP server descriptors from the manifest.
 *
 * Each descriptor contains package location, npm name, CLI entrypoint,
 * and tool lists categorized as `read` (safe to auto-approve) or `write`
 * (require user confirmation).
 *
 * @returns {Record<string, { package: string, npmName: string, entrypoint: string,
 *                            mcpCommand: string, tools: { read: string[], write: string[] } }>}
 */
export function getMcpServers() {
  return getManifest().mcpServers;
}

/**
 * Return a single MCP server descriptor by name.
 *
 * @param {string} name  Server name (e.g. "rex", "sourcevision")
 * @returns {{ package: string, npmName: string, entrypoint: string,
 *             mcpCommand: string, tools: { read: string[], write: string[] } }}
 * @throws {Error}  If the server is not in the manifest
 */
export function getMcpServer(name) {
  const servers = getMcpServers();
  if (!servers[name]) {
    throw new Error(`MCP server not in manifest: ${name}`);
  }
  return servers[name];
}

// ── Codex config rendering ───────────────────────────────────────────────────

/**
 * Render a `.codex/config.toml` file with stdio MCP server definitions.
 *
 * Uses the manifest's MCP server descriptors to produce a TOML config that
 * Codex can read without requiring `ndx start`.  Each server is defined as
 * a `[mcp_servers.<name>]` table with `command` and `args` keys.
 *
 * @param {string} projectDir  Absolute path to the project root (used to
 *                             resolve sub-package CLI paths)
 * @param {(pkgDir: string, npmName: string) => string} resolveCli
 *   Function that resolves the absolute path to a sub-package CLI entry
 *   point, given its relative package directory and npm name.
 * @returns {string}  Complete TOML file content
 */
export function renderCodexConfigToml(projectDir, resolveCli) {
  const servers = getMcpServers();
  const lines = [
    "# Generated by ndx init — do not edit manually.",
    "# Re-run `ndx init` to regenerate.",
    "",
  ];

  for (const [name, descriptor] of Object.entries(servers)) {
    const absEntrypoint = resolveCli(descriptor.package, descriptor.npmName);
    lines.push(`[mcp_servers.${name}]`);
    lines.push(`command = "node"`);
    lines.push(`args = [${tomlStringArray([absEntrypoint, descriptor.mcpCommand, projectDir])}]`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format an array of strings as a TOML inline array.
 *
 * @param {string[]} items
 * @returns {string}  e.g. `"a", "b", "c"`
 */
function tomlStringArray(items) {
  return items.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(", ");
}

// ── Vendor delivery targets ─────────────────────────────────────────────────

/**
 * Return all vendor delivery target descriptors.
 *
 * @returns {Record<string, { skillDir: string, skillFile: string, skillWrapper: string,
 *                            toolPrefix: string | null, instructionFile: string }>}
 */
export function getVendors() {
  return getManifest().vendors;
}

/**
 * Return the delivery target descriptor for a specific vendor.
 *
 * @param {string} vendor  Vendor id ("claude" or "codex")
 * @returns {{ skillDir: string, skillFile: string, skillWrapper: string,
 *             toolPrefix: string | null, instructionFile: string }}
 * @throws {Error}  If the vendor is not in the manifest
 */
export function getVendorTarget(vendor) {
  const vendors = getVendors();
  if (!vendors[vendor]) {
    throw new Error(`Vendor not in manifest: ${vendor}`);
  }
  return vendors[vendor];
}

// ── Tool ID derivation ──────────────────────────────────────────────────────

/**
 * Derive the vendor-prefixed tool IDs for a given tier (read or write).
 *
 * For Claude, read tools become `["mcp__rex__get_prd_status", ...]`.
 * For vendors without a prefix (e.g. codex), bare tool names are returned.
 *
 * @param {string} vendor  Vendor id
 * @param {"read" | "write"} tier  Tool tier
 * @returns {string[]}  Vendor-prefixed (or bare) tool IDs
 */
export function getToolIds(vendor, tier) {
  const vendorTarget = getVendorTarget(vendor);
  const servers = getMcpServers();
  const ids = [];

  for (const [serverName, descriptor] of Object.entries(servers)) {
    const tools = descriptor.tools[tier] ?? [];
    for (const tool of tools) {
      if (vendorTarget.toolPrefix) {
        ids.push(vendorTarget.toolPrefix.replace("{server}", serverName) + tool);
      } else {
        ids.push(tool);
      }
    }
  }

  return ids;
}

/**
 * Derive the vendor-prefixed read-only tool IDs (suitable for auto-approval).
 *
 * Convenience wrapper around `getToolIds(vendor, "read")`.
 *
 * @param {string} vendor  Vendor id
 * @returns {string[]}
 */
export function getAutoApprovedToolIds(vendor) {
  return getToolIds(vendor, "read");
}

// ── Skill rendering (vendor-neutral contract) ───────────────────────────────

/**
 * Render a single skill for a specific vendor.
 *
 * This is the primary render contract function.  Vendor adapters call this
 * instead of building skill content themselves.  The manifest controls the
 * wrapper format; vendor adapters only write the returned string to disk.
 *
 * Supported wrappers:
 * - `"yaml-frontmatter"` (Claude): YAML block with name/description/argument-hint + body
 * - `"plain"` (Codex): raw markdown body (no wrapper)
 *
 * @param {string} name    Skill name (e.g. "ndx-plan")
 * @param {string} vendor  Vendor id ("claude" or "codex")
 * @returns {string}       Fully rendered skill content
 */
export function renderSkill(name, vendor) {
  const vendorTarget = getVendorTarget(vendor);
  const meta = getManifest().skills[name];
  if (!meta) {
    throw new Error(`Skill not in manifest: ${name}`);
  }

  const body = getSkillBody(name);

  switch (vendorTarget.skillWrapper) {
    case "yaml-frontmatter":
      return renderYamlFrontmatter(name, meta, body);
    case "plain":
      return body;
    default:
      throw new Error(
        `Unknown skill wrapper "${vendorTarget.skillWrapper}" for vendor "${vendor}"`,
      );
  }
}

/**
 * Render all skills for a specific vendor.
 *
 * @param {string} vendor  Vendor id ("claude" or "codex")
 * @returns {Record<string, string>}  skill name -> rendered content
 */
export function renderAllSkills(vendor) {
  const result = {};
  for (const name of getSkillNames()) {
    result[name] = renderSkill(name, vendor);
  }
  return result;
}

// ── Vendor skill writer ──────────────────────────────────────────────────────

/**
 * Write all rendered skills to disk for a given vendor.
 *
 * This is the canonical generation function — both Claude and Codex init
 * paths should call this instead of reimplementing skill file I/O.  The
 * manifest's vendor delivery target determines the output directory
 * structure and file naming.
 *
 * Output layout:
 *   {projectDir}/{vendorTarget.skillDir}/{skillName}/{vendorTarget.skillFile}
 *
 * @param {string} vendor     Vendor id ("claude" or "codex")
 * @param {string} projectDir Absolute path to the project root
 * @returns {{ written: number, dir: string }}
 */
export function writeVendorSkills(vendor, projectDir) {
  const vendorTarget = getVendorTarget(vendor);
  const skillsDir = join(projectDir, vendorTarget.skillDir);
  mkdirSync(skillsDir, { recursive: true });

  const rendered = renderAllSkills(vendor);
  let written = 0;

  for (const [name, content] of Object.entries(rendered)) {
    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, vendorTarget.skillFile), content);
    written++;
  }

  return { written, dir: skillsDir };
}

// ── Claude-specific aliases (backward compatibility) ────────────────────────

/**
 * Render a skill as a Claude Code SKILL.md (YAML frontmatter + body).
 *
 * Equivalent to `renderSkill(name, "claude")`.  Kept for backward
 * compatibility with existing callers and tests.
 *
 * @param {string} name  Skill name
 * @returns {string}     Complete SKILL.md content
 */
export function renderClaudeSkill(name) {
  return renderSkill(name, "claude");
}

/**
 * Render all skills as Claude Code SKILL.md content.
 *
 * Equivalent to `renderAllSkills("claude")`.  Kept for backward
 * compatibility with existing callers and tests.
 *
 * @returns {Record<string, string>}  skill name -> SKILL.md content
 */
export function renderAllClaudeSkills() {
  return renderAllSkills("claude");
}

// ── Internal renderers ──────────────────────────────────────────────────────

/**
 * Build YAML frontmatter + body for a skill.
 *
 * @param {string} name                   Skill name
 * @param {{ description: string, argumentHint?: string }} meta  Skill metadata
 * @param {string} body                   Markdown body
 * @returns {string}
 */
function renderYamlFrontmatter(name, meta, body) {
  const lines = ["---", `name: ${name}`, `description: ${meta.description}`];
  if (meta.argumentHint) {
    lines.push(`argument-hint: "${meta.argumentHint}"`);
  }
  lines.push("---");

  // Blank line separates YAML frontmatter from body (standard convention)
  return lines.join("\n") + "\n\n" + body;
}

// ── File-system discovery (for test validation) ─────────────────────────────

/**
 * List all `.md` files present in `skills/`, returning their base names
 * (without extension).  This is useful for tests that need to verify the
 * directory contents match the manifest.
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

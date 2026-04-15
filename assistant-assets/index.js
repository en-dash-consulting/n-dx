/**
 * Vendor-neutral assistant asset manifest and render contract.
 *
 * This module is the programmatic entry point for the canonical asset
 * definitions stored in `assistant-assets/`.  It provides read-only access
 * to skill bodies, MCP server descriptors, vendor delivery targets, and
 * shared project guidance so that vendor-specific integration modules
 * (claude-integration.js, codex-integration.js) can render assistant
 * artifacts from one shared source of truth.
 *
 * ## Render contract
 *
 * Vendor adapters call {@link renderSkill} or {@link renderAllSkills} with
 * a vendor id ("claude" or "codex").  The manifest defines the shared
 * meaning (skill metadata, MCP tool classification, delivery paths); vendor
 * adapters only adapt file locations and wrapper formatting.
 *
 * ## Instruction file contract
 *
 * Both CLAUDE.md and AGENTS.md are generated from a shared project guidance
 * template (`project-guidance.md`) plus vendor-specific addenda.  This
 * eliminates manual SYNC NOTICE maintenance and ensures both vendors start
 * runs from equivalent repo instructions.
 *
 * - {@link renderClaudeMd} — shared guidance + Claude-specific addendum
 * - {@link renderAgentsMd} — shared guidance + manifest-derived operational
 *   sections + Codex troubleshooting
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

// ── Shared project guidance ──────────────────────────────────────────────────

/**
 * Read the shared project guidance template.
 *
 * This is the single source of truth for project documentation sections
 * (Packages, Architecture, Commands, MCP, Key Files, etc.) that both
 * CLAUDE.md and AGENTS.md need.  Contains a `<!-- ADDENDUM -->` marker
 * where Claude-specific deep sections are inserted.
 *
 * @returns {string}  Raw markdown content of project-guidance.md
 */
export function getProjectGuidance() {
  return readFileSync(join(__dir, "project-guidance.md"), "utf-8");
}

/**
 * Read the Claude-specific addendum (zone governance, gateway details,
 * injection seams, concurrency contract).
 *
 * Inserted at the `<!-- ADDENDUM -->` marker in project-guidance.md when
 * rendering CLAUDE.md.
 *
 * @returns {string}  Raw markdown content of claude-addendum.md
 */
export function getClaudeAddendum() {
  return readFileSync(join(__dir, "claude-addendum.md"), "utf-8");
}

/**
 * Read the Codex troubleshooting section.
 *
 * Appended to AGENTS.md after the manifest-derived operational sections.
 *
 * @returns {string}  Raw markdown content of codex-troubleshooting.md
 */
export function getCodexTroubleshooting() {
  return readFileSync(join(__dir, "codex-troubleshooting.md"), "utf-8");
}

// ── Section filtering ────────────────────────────────────────────────────────

/**
 * Filter a markdown document to exclude top-level sections (## headings)
 * whose names appear in `exclude`.
 *
 * A "section" begins at a `## ` heading and runs until the next `## `
 * heading or end of file.  Sub-headings (###, ####) within a section are
 * included or excluded with their parent.
 *
 * @param {string} content     Markdown content
 * @param {Set<string>} exclude  Set of heading texts to exclude (without the `## ` prefix)
 * @returns {string}  Filtered markdown
 */
function filterSections(content, exclude) {
  const lines = content.split("\n");
  const result = [];
  let skipping = false;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const heading = line.slice(3).trim();
      skipping = exclude.has(heading);
    }
    if (!skipping) {
      result.push(line);
    }
  }

  return result.join("\n");
}

// ── CLAUDE.md rendering ──────────────────────────────────────────────────────

/**
 * Render the project-local `CLAUDE.md` instruction file.
 *
 * Combines the shared project guidance with the Claude-specific addendum
 * (zone governance, gateway details, injection seams, concurrency contract).
 * The `<!-- ADDENDUM -->` marker in project-guidance.md is replaced with
 * the claude-addendum.md content.
 *
 * The generated file is the Claude-facing surface that Claude Code loads
 * automatically on startup.  It mirrors the same base project guidance
 * that AGENTS.md delivers to Codex, plus Claude-specific deep sections.
 *
 * @returns {string}  Complete CLAUDE.md content
 */
export function renderClaudeMd() {
  const guidance = getProjectGuidance();
  const addendum = getClaudeAddendum();

  const body = guidance.replace("<!-- ADDENDUM -->\n", addendum + "\n");

  return (
    "<!-- Generated by ndx init — do not edit manually. Re-run `ndx init` to regenerate. -->\n" +
    body
  );
}

// ── AGENTS.md rendering ─────────────────────────────────────────────────────

/**
 * Render a project-local `AGENTS.md` for Codex.
 *
 * Combines the shared project guidance (filtering out MCP Servers and
 * Development Workflow — replaced by manifest-derived versions) with
 * manifest-derived operational sections (Workflow, Skills, MCP tool
 * reference, usage guidance) and Codex troubleshooting.
 *
 * The shared guidance ensures Codex receives the same base project
 * documentation (Packages, Architecture, Commands, Key Files) that
 * CLAUDE.md delivers to Claude, eliminating instruction drift between
 * the two assistant surfaces.
 *
 * @returns {string}  Complete AGENTS.md content
 */
export function renderAgentsMd() {
  const manifest = getManifest();
  const skills = manifest.skills;
  const servers = manifest.mcpServers;

  // Start with shared project guidance, filtering out sections that are
  // replaced by manifest-derived equivalents below.
  const guidance = getProjectGuidance();
  const filteredGuidance = filterSections(
    guidance.replace("<!-- ADDENDUM -->\n", ""),
    new Set(["MCP Servers", "Development Workflow"]),
  );

  const sections = [];

  // ── Header ──────────────────────────────────────────────────────────
  sections.push(
    "<!-- Generated by ndx init — do not edit manually. Re-run `ndx init` to regenerate. -->",
    "",
  );

  // ── Shared project guidance (filtered) ─────────────────────────────
  sections.push(filteredGuidance.trim(), "");

  // ── Workflow ─────────────────────────────────────────────────────────
  sections.push(
    "## Workflow",
    "",
    "Follow `.rex/workflow.md` for task execution discipline. Key steps:",
    "",
    "1. Run the project's validation command to ensure a clean state.",
    "2. Call `get_next_task` to pick up an actionable task.",
    "3. Read the task's full context: parent chain, description, acceptance criteria.",
    "4. Implement using TDD where possible: failing test → green → refactor.",
    "5. Run validation and tests.",
    "6. Call `update_task_status` to mark the task complete.",
    "7. Call `append_log` with what was done, decisions made, and issues encountered.",
    "8. Commit changes.",
    "9. Exit after one task. One task per execution, no exceptions.",
    "",
  );

  // ── Skills ──────────────────────────────────────────────────────────
  sections.push(
    "## Available Skills",
    "",
    "The following skills are installed in `.agents/skills/`. " +
      "Each skill directory contains a `SKILL.md` with detailed instructions.",
    "",
  );

  for (const [name, meta] of Object.entries(skills)) {
    const hint = meta.argumentHint ? ` \`${meta.argumentHint}\`` : "";
    sections.push(`- **${name}**${hint} — ${meta.description}`);
  }
  sections.push("");

  // ── MCP servers ─────────────────────────────────────────────────────
  sections.push(
    "## MCP Servers",
    "",
    "Two MCP servers provide structured access to project data. " +
      "They are configured in `.codex/config.toml` (stdio transport).",
    "",
  );

  for (const [serverName, descriptor] of Object.entries(servers)) {
    sections.push(`### ${serverName}`, "");

    // Read tools
    if (descriptor.tools.read.length > 0) {
      sections.push(
        "**Read tools** (safe to call frequently, no side effects):",
        "",
      );
      for (const tool of descriptor.tools.read) {
        sections.push(`- \`${tool}\``);
      }
      sections.push("");
    }

    // Write tools
    if (descriptor.tools.write.length > 0) {
      sections.push("**Write tools** (modify project state, use with care):", "");
      for (const tool of descriptor.tools.write) {
        sections.push(`- \`${tool}\``);
      }
      sections.push("");
    }
  }

  // ── When to use each server ─────────────────────────────────────────
  sections.push(
    "## When to Use Each Server",
    "",
    "**Rex** — PRD and task management. Use rex tools when you need to:",
    "",
    "- Find out what to work on next (`get_next_task`)",
    "- Read task details and acceptance criteria (`get_item`)",
    "- Update task status as you work (`update_task_status`)",
    "- Log what you did (`append_log`)",
    "- Check overall project progress (`get_prd_status`)",
    "",
    "**SourceVision** — Codebase analysis. Use sourcevision tools when you need to:",
    "",
    "- Understand a file's role and dependencies (`get_file_info`, `get_imports`)",
    "- Find files related to a feature or module (`search_files`)",
    "- Understand architectural zones (`get_zone`, `get_overview`)",
    "- Check for known issues before modifying code (`get_findings`)",
    "",
  );

  // ── Codex troubleshooting ──────────────────────────────────────────
  const troubleshooting = getCodexTroubleshooting();
  sections.push(troubleshooting.trim(), "");

  return sections.join("\n");
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

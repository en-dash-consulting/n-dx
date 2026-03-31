/**
 * Claude Code integration — auto-configures MCP servers, skills, and permissions
 * when `ndx init` is run.
 *
 * This module is called by cli.js during init (unless --no-claude is passed).
 * It writes:
 *   1. `.claude/settings.local.json` — MCP tool permissions (merged, not overwritten)
 *   2. `.claude/skills/` — workflow skill files (overwritten on each init)
 *   3. MCP server registration via `claude mcp add` (best-effort)
 *
 * Skill content is sourced from `assistant-assets/` — the vendor-neutral
 * canonical location.  This module renders Claude-specific SKILL.md files
 * (YAML frontmatter + body) from that shared source.
 *
 * @module n-dx/claude-integration
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmdirSync, unlinkSync } from "fs";
import { createRequire } from "module";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { renderAllClaudeSkills, getSkillNames } from "./assistant-assets/index.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const _require = createRequire(import.meta.url);

/**
 * Resolve a sub-package CLI path — monorepo first, then node_modules.
 */
function resolveSubPackageCli(pkgDir, npmName) {
  const monoPath = resolve(__dir, pkgDir, "dist/cli/index.js");
  if (existsSync(monoPath)) return monoPath;
  try {
    return _require.resolve(npmName + "/dist/cli/index.js");
  } catch {
    return monoPath; // fallback — will fail with a clear error
  }
}

// ── Permission tiers ──────────────────────────────────────────────────────────

/** Read-only MCP tools — auto-approved without user confirmation. */
const AUTO_APPROVED_TOOLS = [
  // Sourcevision read tools
  "mcp__sourcevision__get_overview",
  "mcp__sourcevision__get_zone",
  "mcp__sourcevision__get_file_info",
  "mcp__sourcevision__get_imports",
  "mcp__sourcevision__search_files",
  "mcp__sourcevision__get_findings",
  "mcp__sourcevision__get_classifications",
  "mcp__sourcevision__get_next_steps",
  "mcp__sourcevision__get_route_tree",
  // Rex read tools
  "mcp__rex__get_prd_status",
  "mcp__rex__get_next_task",
  "mcp__rex__get_item",
  "mcp__rex__get_capabilities",
  "mcp__rex__get_recommendations",
  "mcp__rex__health",
  "mcp__rex__facets",
];

// Write tools are intentionally omitted — they require user approval by default.
// This includes: add_item, update_task_status, move_item, merge_items,
// set_file_archetype, reorganize, append_log, verify_criteria, sync_with_remote

// ── Skills ────────────────────────────────────────────────────────────────────

/**
 * Skills are rendered from the canonical `assistant-assets/` directory.
 * Claude-specific YAML frontmatter is added by `renderAllClaudeSkills()`.
 *
 * The SKILLS object is lazily populated on first access so the module can
 * still be imported without side effects at parse time.
 */
let _skillsCache = null;

function getSkills() {
  if (!_skillsCache) {
    _skillsCache = renderAllClaudeSkills();
  }
  return _skillsCache;
}

// ── Settings merge ────────────────────────────────────────────────────────────

/**
 * Merge n-dx auto-approved tools into existing settings.local.json.
 * Preserves all existing user permissions — only adds missing entries.
 */
function mergeSettings(dir) {
  const claudeDir = join(dir, ".claude");
  const settingsPath = join(claudeDir, "settings.local.json");

  let existing = { permissions: { allow: [] } };
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // Corrupted — start fresh but preserve the file structure
    }
  }

  if (!existing.permissions) existing.permissions = {};
  if (!Array.isArray(existing.permissions.allow)) existing.permissions.allow = [];

  const currentSet = new Set(existing.permissions.allow);
  let added = 0;

  for (const tool of AUTO_APPROVED_TOOLS) {
    if (!currentSet.has(tool)) {
      existing.permissions.allow.push(tool);
      added++;
    }
  }

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + "\n");

  return { added, total: AUTO_APPROVED_TOOLS.length };
}

// ── Skill writing ─────────────────────────────────────────────────────────────

/**
 * Write all skill files to `.claude/skills/<name>/SKILL.md`.
 * Overwrites existing skill files (they're n-dx-managed).
 * Also cleans up old flat-file format (`.claude/skills/<name>.md`).
 */
/** Old unprefixed skill names — removed on init to avoid duplicates. */
const LEGACY_SKILL_NAMES = ["plan", "status", "capture", "zone", "work", "configure"];

function writeSkills(dir) {
  const skillsDir = join(dir, ".claude", "skills");
  mkdirSync(skillsDir, { recursive: true });

  // Clean up legacy unprefixed skill directories
  for (const old of LEGACY_SKILL_NAMES) {
    const oldDir = join(skillsDir, old);
    if (existsSync(join(oldDir, "SKILL.md"))) {
      try { unlinkSync(join(oldDir, "SKILL.md")); } catch { /* ignore */ }
      try { rmdirSync(oldDir); } catch { /* ignore — may have user files */ }
    }
    // Also clean up old flat-file format
    const oldFlat = join(skillsDir, `${old}.md`);
    if (existsSync(oldFlat)) {
      try { unlinkSync(oldFlat); } catch { /* ignore */ }
    }
  }

  const skills = getSkills();
  let written = 0;
  for (const [name, content] of Object.entries(skills)) {
    // Clean up old flat-file format if it exists
    const oldPath = join(skillsDir, `${name}.md`);
    if (existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch { /* ignore */ }
    }

    const skillDir = join(skillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content);
    written++;
  }

  return { written };
}

// ── MCP registration ──────────────────────────────────────────────────────────

/**
 * Register MCP servers with Claude Code CLI (best-effort).
 * Prefers HTTP transport if the web server is running, falls back to stdio.
 */
function registerMcpServers(dir) {
  const hasClaude = hasClaudeCli();
  if (!hasClaude) {
    return { registered: false, reason: "claude CLI not found" };
  }

  const results = [];

  // Always use stdio — it doesn't require a running server
  const rexBin = resolveSubPackageCli("packages/rex", "@n-dx/rex");
  const svBin = resolveSubPackageCli("packages/sourcevision", "@n-dx/sourcevision");
  const absDir = resolve(dir);

  try {
    execSync(
      `claude mcp add rex -- node "${rexBin}" mcp "${absDir}"`,
      { stdio: "ignore", timeout: 10_000 },
    );
    results.push({ name: "rex", transport: "stdio", ok: true });
  } catch {
    results.push({ name: "rex", transport: "stdio", ok: false });
  }

  try {
    execSync(
      `claude mcp add sourcevision -- node "${svBin}" mcp "${absDir}"`,
      { stdio: "ignore", timeout: 10_000 },
    );
    results.push({ name: "sourcevision", transport: "stdio", ok: true });
  } catch {
    results.push({ name: "sourcevision", transport: "stdio", ok: false });
  }

  return { registered: true, servers: results };
}

function hasClaudeCli() {
  try {
    execSync("claude --version", { stdio: "ignore", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the full Claude Code integration setup.
 *
 * @param {string} dir  Project root directory
 * @returns {{ settings: object, skills: object, mcp: object }}
 */
export function setupClaudeIntegration(dir) {
  const absDir = resolve(dir);

  const settings = mergeSettings(absDir);
  const skills = writeSkills(absDir);
  const mcp = registerMcpServers(absDir);

  return { settings, skills, mcp };
}

/**
 * Print a summary of what was configured.
 */
export function printClaudeSetupSummary(result) {
  console.log("");
  console.log("Claude Code integration:");

  // Settings
  if (result.settings.added > 0) {
    console.log(`  Settings: added ${result.settings.added} auto-approved tool permissions`);
  } else {
    console.log(`  Settings: all ${result.settings.total} tool permissions already present`);
  }

  // Skills
  const skillList = getSkillNames().map((n) => `/${n}`).join(", ");
  console.log(`  Skills: wrote ${result.skills.written} workflow skills (${skillList})`);

  // MCP
  if (!result.mcp.registered) {
    console.log(`  MCP servers: skipped (${result.mcp.reason})`);
    console.log("  To register manually, see: ndx --help init");
  } else {
    const ok = result.mcp.servers.filter((s) => s.ok);
    const failed = result.mcp.servers.filter((s) => !s.ok);
    if (ok.length > 0) {
      console.log(`  MCP servers: registered ${ok.map((s) => s.name).join(", ")} (${ok[0].transport})`);
    }
    if (failed.length > 0) {
      console.log(`  MCP servers: failed to register ${failed.map((s) => s.name).join(", ")}`);
    }
  }
}

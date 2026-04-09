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
 * canonical location.  Skill writing is delegated to the shared
 * `writeVendorSkills()` function so Claude and Codex use the same
 * generation path.
 *
 * @module n-dx/claude-integration
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmdirSync, unlinkSync } from "fs";
import { createRequire } from "module";
import { join, resolve } from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  getSkillNames,
  getAutoApprovedToolIds,
  getMcpServers,
  writeVendorSkills,
  renderClaudeMd,
} from "../../assistant-assets/index.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dir, "../..");
const _require = createRequire(import.meta.url);

/**
 * Resolve a sub-package CLI path — monorepo first, then node_modules.
 */
function resolveSubPackageCli(pkgDir, npmName) {
  const monoPath = resolve(MONOREPO_ROOT, pkgDir, "dist/cli/index.js");
  if (existsSync(monoPath)) return monoPath;
  try {
    return _require.resolve(npmName + "/dist/cli/index.js");
  } catch {
    return monoPath; // fallback — will fail with a clear error
  }
}

// ── Permission tiers ──────────────────────────────────────────────────────────

/**
 * Read-only MCP tools — auto-approved without user confirmation.
 *
 * Derived from the manifest's MCP server descriptors + Claude vendor prefix.
 * Write tools are intentionally omitted — they require user approval by default.
 */
const AUTO_APPROVED_TOOLS = getAutoApprovedToolIds("claude");

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
 * Write all skill files via the canonical vendor-neutral writer, after
 * cleaning up legacy Claude-specific skill layouts.
 *
 * Legacy cleanup is a Claude-only migration concern — the shared
 * `writeVendorSkills()` handles the actual generation.
 */
/** Old unprefixed skill names — removed on init to avoid duplicates. */
const LEGACY_SKILL_NAMES = ["plan", "status", "capture", "zone", "work", "configure"];

function writeSkills(dir) {
  const skillsDir = join(dir, ".claude", "skills");

  // Clean up legacy unprefixed skill directories (Claude-specific migration)
  for (const old of LEGACY_SKILL_NAMES) {
    const oldDir = join(skillsDir, old);
    if (existsSync(join(oldDir, "SKILL.md"))) {
      try { unlinkSync(join(oldDir, "SKILL.md")); } catch { /* ignore */ }
      try { rmdirSync(oldDir); } catch { /* ignore — may have user files */ }
    }
    const oldFlat = join(skillsDir, `${old}.md`);
    if (existsSync(oldFlat)) {
      try { unlinkSync(oldFlat); } catch { /* ignore */ }
    }
  }

  // Clean up old flat-file format for current skill names
  for (const name of getSkillNames()) {
    const oldPath = join(skillsDir, `${name}.md`);
    if (existsSync(oldPath)) {
      try { unlinkSync(oldPath); } catch { /* ignore */ }
    }
  }

  // Delegate to the shared vendor-neutral writer
  return writeVendorSkills("claude", dir);
}

// ── CLAUDE.md writing ─────────────────────────────────────────────────────────

/**
 * Write `CLAUDE.md` to the project root.
 *
 * The content is generated from the shared project guidance template plus
 * the Claude-specific addendum, so that CLAUDE.md stays in sync with
 * AGENTS.md's shared sections automatically.
 *
 * @param {string} dir  Absolute project root directory
 * @returns {{ written: boolean, path: string }}
 */
function writeClaudeMd(dir) {
  const claudePath = join(dir, "CLAUDE.md");
  const content = renderClaudeMd();
  writeFileSync(claudePath, content);
  return { written: true, path: claudePath };
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
  const absDir = resolve(dir);
  const servers = getMcpServers();

  // Register each MCP server defined in the manifest via stdio transport
  for (const [name, descriptor] of Object.entries(servers)) {
    const bin = resolveSubPackageCli(descriptor.package, descriptor.npmName);
    // Remove existing registration first to make init idempotent —
    // `claude mcp add` fails if the server already exists.
    try {
      execSync(`claude mcp remove ${name}`, { stdio: "ignore", timeout: 5_000 });
    } catch {
      // Server may not exist yet — that's fine on first init.
    }
    try {
      execSync(
        `claude mcp add ${name} -- node "${bin}" ${descriptor.mcpCommand} "${absDir}"`,
        { stdio: "ignore", timeout: 10_000 },
      );
      results.push({ name, transport: "stdio", ok: true });
    } catch {
      results.push({ name, transport: "stdio", ok: false });
    }
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
 * @returns {{ settings: object, skills: object, mcp: object, instructions: object }}
 */
export function setupClaudeIntegration(dir) {
  const absDir = resolve(dir);

  const settings = mergeSettings(absDir);
  const skills = writeSkills(absDir);
  const mcp = registerMcpServers(absDir);
  const instructions = writeClaudeMd(absDir);

  return { settings, skills, mcp, instructions };
}

/**
 * Print a summary of what was configured.
 *
 * @deprecated Use `formatInitReport()` from `assistant-integration.js` instead.
 * This function is retained for backward compatibility with external callers
 * and will be removed in a future major release.
 */
export function printClaudeSetupSummary(result) {
  console.log("");
  console.log("Claude Code integration:");

  // Instructions
  if (result.instructions && result.instructions.written) {
    console.log("  CLAUDE.md: wrote project instructions");
  }

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

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

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmdirSync, unlinkSync, readdirSync } from "fs";
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
import { homedir } from "os";

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
 * Extract a concise, human-readable error message from an execSync failure.
 *
 * Prefers stderr (the most informative source for CLI failures), then falls
 * back to the first line of the exception message.
 */
function extractExecError(err) {
  if (err.stderr && err.stderr.length > 0) {
    const msg = err.stderr.toString().trim();
    // Return first non-empty line — avoids multi-line stack traces
    const firstLine = msg.split("\n").find((l) => l.trim()) || msg;
    return firstLine;
  }
  if (err.message) {
    return err.message.split("\n")[0];
  }
  return "unknown error";
}

/**
 * Register MCP servers with Claude Code CLI (best-effort).
 * Prefers HTTP transport if the web server is running, falls back to stdio.
 */
function registerMcpServers(dir) {
  const discovery = discoverClaudeCli(dir);
  if (!discovery.found) {
    return { registered: false, reason: "claude CLI not found", searched: discovery.searched };
  }

  const claudeCmd = discovery.path;
  const results = [];
  const absDir = resolve(dir);
  const servers = getMcpServers();

  // Register each MCP server defined in the manifest via stdio transport
  for (const [name, descriptor] of Object.entries(servers)) {
    const bin = resolveSubPackageCli(descriptor.package, descriptor.npmName);
    // Remove existing registration(s) first to make init idempotent —
    // `claude mcp add` fails if the server already exists in any scope.
    for (const scope of ["local", "project", "user"]) {
      try {
        execSync(`claude mcp remove --scope ${scope} ${name}`, { stdio: "ignore", timeout: 5_000 });
      } catch {
        // Server may not exist in this scope — continue cleanup.
      }
    }
    try {
      execSync(
        `claude mcp add ${name} -- node "${bin}" ${descriptor.mcpCommand} "${absDir}"`,
        { stdio: "pipe", timeout: 10_000 },
      );
      results.push({ name, transport: "stdio", ok: true });
    } catch (e) {
      results.push({ name, transport: "stdio", ok: false, error: extractExecError(e) });
    }
  }

  return { registered: true, servers: results };
}

/**
 * Read cli.claudePath from .n-dx.json in the given project root.
 * Returns undefined if not set.
 * @param {string|null} dir
 * @returns {string|undefined}
 */
function readConfiguredClaudePath(dir) {
  if (!dir) return undefined;
  try {
    const raw = readFileSync(join(dir, ".n-dx.json"), "utf-8");
    const cfg = JSON.parse(raw);
    const p = cfg?.cli?.claudePath;
    return typeof p === "string" && p.length > 0 ? p : undefined;
  } catch { return undefined; }
}

/**
 * Persist the discovered claude CLI path to .hench/config.json so
 * subsequent hench invocations reuse it without re-discovering.
 * Silently skips if the config file doesn't exist yet.
 * @param {string|null} dir  Project root
 * @param {string} resolvedPath
 */
function persistDiscoveredClaudePath(dir, resolvedPath) {
  if (!dir) return;
  const configPath = join(dir, ".hench", "config.json");
  if (!existsSync(configPath)) return;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config.claudePath === resolvedPath) return; // already correct
    config.claudePath = resolvedPath;
    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  } catch { /* skip — non-critical */ }
}

/**
 * Build the list of well-known install location candidates for claude CLI.
 * @returns {string[]}
 */
function buildClaudeWellKnownCandidates() {
  const home = homedir();
  const platform = process.platform;
  const candidates = [];

  // Claude desktop app local install (all platforms)
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    candidates.push(join(appData, "npm", "claude.cmd"));
    candidates.push(join(appData, "Claude", "claude.exe"));
  } else {
    candidates.push(join(home, ".claude", "local", "claude"));
    if (platform === "darwin") {
      candidates.push("/usr/local/bin/claude", "/opt/homebrew/bin/claude");
    }
    candidates.push(join(home, ".npm-global", "bin", "claude"));

    // nvm-managed node versions
    const nvmVersionsDir = join(home, ".nvm", "versions", "node");
    if (existsSync(nvmVersionsDir)) {
      try {
        const versions = readdirSync(nvmVersionsDir);
        for (const v of versions) {
          candidates.push(join(nvmVersionsDir, v, "bin", "claude"));
        }
      } catch { /* skip */ }
    }
  }

  return candidates;
}

/**
 * Discover the claude CLI binary.
 *
 * Discovery order:
 *  1. CLAUDE_CLI_PATH env var (exclusive — no fallback when set)
 *  2. cli.claudePath in .n-dx.json (exclusive — no fallback when set)
 *  3. System PATH
 *  4. Well-known install locations (~/.claude/local/claude, nvm, Homebrew, etc.)
 *
 * When a path is found via (3) or (4) it is persisted to .hench/config.json
 * so subsequent hench invocations reuse it without re-discovering.
 *
 * @param {string|null} [dir=null]  Project root (used to read .n-dx.json and write .hench/config.json)
 * @returns {{ found: true, path: string } | { found: false, searched: string[] }}
 */
export function discoverClaudeCli(dir = null) {
  const searched = [];

  // 1. CLAUDE_CLI_PATH env var — exclusive if set
  const envPath = process.env.CLAUDE_CLI_PATH;
  if (envPath) {
    searched.push(`${envPath} (CLAUDE_CLI_PATH)`);
    if (existsSync(envPath)) {
      try {
        execSync(`"${envPath}" --version`, { stdio: "ignore", timeout: 5_000 });
        return { found: true, path: envPath };
      } catch { /* not executable */ }
    }
    return { found: false, searched };
  }

  // 2. cli.claudePath from .n-dx.json — exclusive if set
  const configPath = readConfiguredClaudePath(dir);
  if (configPath) {
    searched.push(`${configPath} (cli.claudePath)`);
    if (existsSync(configPath)) {
      try {
        execSync(`"${configPath}" --version`, { stdio: "ignore", timeout: 5_000 });
        return { found: true, path: configPath };
      } catch { /* not executable */ }
    }
    return { found: false, searched };
  }

  // 3. System PATH
  searched.push("claude (PATH)");
  try {
    execSync("claude --version", { stdio: "ignore", timeout: 5_000 });
    persistDiscoveredClaudePath(dir, "claude");
    return { found: true, path: "claude" };
  } catch { /* not in PATH */ }

  // 4. Well-known install locations
  for (const p of buildClaudeWellKnownCandidates()) {
    searched.push(p);
    if (existsSync(p)) {
      try {
        execSync(`"${p}" --version`, { stdio: "ignore", timeout: 5_000 });
        persistDiscoveredClaudePath(dir, p);
        return { found: true, path: p };
      } catch { /* not executable */ }
    }
  }

  return { found: false, searched };
}

/**
 * Format a structured error message when claude CLI cannot be located.
 * @param {string[]} searched  Paths that were checked, in order.
 * @returns {string}
 */
export function formatClaudeCliNotFoundError(searched) {
  const installCmd = process.platform === "darwin"
    ? "brew install claude"
    : "npm install -g claude";
  return [
    "Error: claude CLI not found.",
    "Searched:",
    ...searched.map((p) => `  ${p}`),
    "",
    `Install: ${installCmd}`,
    "Download: https://claude.ai/download",
    "",
    "After installing, re-run 'ndx init'.",
    "To skip Claude Code integration: ndx init --no-claude",
  ].join("\n");
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
      const detail = failed
        .map((s) => (s.error ? `${s.name} (${s.error})` : s.name))
        .join(", ");
      console.log(`  MCP servers: failed to register ${detail}`);
    }
  }
}

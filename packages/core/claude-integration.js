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

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmdirSync, unlinkSync, readdirSync, realpathSync } from "fs";
import { createRequire } from "module";
import { join, resolve } from "path";
// execFileSyncCli, not execSync: every argument here is a filesystem path
// (the claude binary, the resolved MCP entrypoint, the project dir). Building a
// cmd.exe command line by hand around those broke on `&`, `^`, `(`, `)`, `!` and
// on a trailing backslash — and worst of all could exit 0 having registered a
// truncated command. win-spawn.js applies quoteWindowsToken/ArgvQuote rules and
// logs each invocation itself.
import { execFileSyncCli } from "./win-spawn.js";
import { fileURLToPath } from "url";
import { dirname } from "path";
import {
  getSkillNames,
  getAutoApprovedToolIds,
  getMcpServers,
  writeVendorSkills,
  renderClaudeMd,
} from "./assistant-assets.js";
import { getCliName } from "./cli-identity.js";
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
 * Extract a concise, human-readable error message from a failed CLI invocation.
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
 * Resolve the path to Claude Code's global config file, where `claude mcp
 * add --scope local` stores its per-directory server map. Honors
 * `CLAUDE_CONFIG_DIR` the same way the CLI itself does; defaults to the
 * user's home directory.
 * @returns {string}
 */
function claudeGlobalConfigPath() {
  const configDir = process.env.CLAUDE_CONFIG_DIR || homedir();
  return join(configDir, ".claude.json");
}

/**
 * Candidate keys under which a project's local-scope entry might be stored:
 * the literal resolved dir, plus its realpath (Claude Code resolves through
 * symlinks when recording the project key, which matters for e.g. macOS
 * `/var` → `/private/var` temp dirs).
 * @param {string} absDir
 * @returns {string[]}
 */
function projectConfigKeyCandidates(absDir) {
  const candidates = [absDir];
  try {
    const real = realpathSync(absDir);
    if (real !== absDir) candidates.push(real);
  } catch {
    // Directory may not exist (tests) — literal key is still tried.
  }
  return candidates;
}

/**
 * Read the local-scope `mcpServers` map Claude Code has on file for this
 * project, if any. Returns undefined when the config file is missing,
 * unparsable, or holds no entry for this project.
 * @param {string} absDir
 * @returns {Record<string, { args?: string[] }> | undefined}
 */
function readLocalMcpServers(absDir) {
  let config;
  try {
    config = JSON.parse(readFileSync(claudeGlobalConfigPath(), "utf-8"));
  } catch {
    return undefined;
  }
  for (const key of projectConfigKeyCandidates(absDir)) {
    const servers = config?.projects?.[key]?.mcpServers;
    if (servers) return servers;
  }
  return undefined;
}

/**
 * True only when Claude Code has a local-scope entry named `name` under this
 * project AND that entry's own recorded args target this directory (its last
 * arg — the project dir positional in the `mcp add` command below — equals
 * `absDir`). Local scope is already keyed per-directory, but this extra
 * check guards against removing an entry that merely happens to share a
 * project key without actually pointing here.
 * @param {string} absDir
 * @param {string} name
 * @returns {boolean}
 */
function localEntryTargetsProject(absDir, name) {
  const servers = readLocalMcpServers(absDir);
  const args = servers?.[name]?.args;
  return Array.isArray(args) && args.length > 0 && args[args.length - 1] === absDir;
}

/**
 * Register MCP servers with Claude Code CLI (best-effort).
 *
 * Defaults to leaving registration to the tracked `.mcp.json` written by
 * `writeMcpJson()` — no `claude mcp add` call is made. Pass
 * `{ mcpScope: "local" }` to restore the legacy behaviour of registering via
 * `claude mcp add --scope local`, for people who cannot rely on `.mcp.json`
 * being picked up (e.g. Claude Code versions predating project-scope stdio
 * servers).
 *
 * Either way, a stale local-scope entry from a prior run is cleaned up first
 * so re-running init (in either mode) doesn't leave a dangling local
 * registration behind. Only "local" scope is ever touched: "project" scope
 * is `.mcp.json` itself (owned by `writeMcpJson()`, not the CLI), and "user"
 * scope is global — removing it would strip a registration that has nothing
 * to do with this project.
 *
 * @param {string} dir
 * @param {{ mcpScope?: "local" }} [opts]
 */
function registerMcpServers(dir, opts = {}) {
  const useLocalScope = opts.mcpScope === "local";
  const discovery = discoverClaudeCli(dir);
  if (!discovery.found) {
    return { registered: false, reason: "claude CLI not found", searched: discovery.searched, mode: useLocalScope ? "local" : "tracked" };
  }

  const claudeCmd = discovery.path;
  const absDir = resolve(dir);
  const servers = getMcpServers();

  // Clean up any stale local-scope entry left by a prior run — but only one
  // that actually targets this project (see localEntryTargetsProject above).
  for (const name of Object.keys(servers)) {
    if (!localEntryTargetsProject(absDir, name)) continue;
    try {
      execFileSyncCli(claudeCmd, ["mcp", "remove", "--scope", "local", name], {
        stdio: "ignore",
        timeout: 5_000,
        cwd: absDir,
      });
    } catch {
      // Already gone — fine.
    }
  }

  if (!useLocalScope) {
    return {
      registered: false,
      reason: "using tracked .mcp.json (pass --mcp-scope=local to register local scope instead)",
      mode: "tracked",
    };
  }

  const results = [];
  for (const [name, descriptor] of Object.entries(servers)) {
    const bin = resolveSubPackageCli(descriptor.package, descriptor.npmName);
    try {
      // `claude mcp add --scope local` — the flag-gated legacy path.
      execFileSyncCli(
        claudeCmd,
        ["mcp", "add", "--scope", "local", name, "--", "node", bin, descriptor.mcpCommand, absDir],
        { stdio: "pipe", timeout: 10_000, cwd: absDir },
      );
      results.push({ name, transport: "stdio", ok: true });
    } catch (e) {
      results.push({ name, transport: "stdio", ok: false, error: extractExecError(e) });
    }
  }

  return { registered: true, servers: results, mode: "local" };
}

// ── Tracked .mcp.json ─────────────────────────────────────────────────────────

/**
 * Build the .mcp.json server entry map for the current manifest, using
 * cwd-relative commands (`<cliName> <cliCommand> mcp .`) instead of the
 * absolute paths `registerMcpServers` uses. Claude Code launches
 * project-scope stdio servers with cwd at the checkout root, so a command
 * like `ndx rex mcp .` resolves correctly from any worktree or teammate
 * clone without embedding a machine-specific path.
 *
 * @param {string} cliName  Resolved CLI command name (see cli-identity.js)
 * @returns {Record<string, { command: string, args: string[] }>}
 */
function buildTrackedMcpServers(cliName) {
  const servers = getMcpServers();
  const entries = {};
  for (const [name, descriptor] of Object.entries(servers)) {
    const subcommand = descriptor.cliCommand ?? name;
    entries[name] = { command: cliName, args: [subcommand, descriptor.mcpCommand, "."] };
  }
  return entries;
}

/**
 * Write (or merge into) `<dir>/.mcp.json` — a tracked, cwd-relative MCP
 * server registration for Claude Code.
 *
 * Unlike `registerMcpServers()` (local scope, absolute paths, keyed by
 * directory in `~/.claude.json`), this file is committed to the repo: every
 * worktree and teammate gets the same two entries, resolved relative to
 * whichever directory Claude Code launches the stdio server from — no
 * absolute paths, so it survives the install moving or a dev-link toggle.
 *
 * Existing entries not defined in the n-dx manifest (a project's own MCP
 * servers) are preserved untouched — only the manifest's own server names
 * are (re)written each run, so re-running init is idempotent and merges
 * safely instead of clobbering the file.
 *
 * @param {string} dir  Absolute project root directory
 * @returns {{ written: boolean, path: string, servers: string[] }}
 */
function writeMcpJson(dir) {
  const mcpJsonPath = join(dir, ".mcp.json");

  let existing = {};
  if (existsSync(mcpJsonPath)) {
    try {
      existing = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      // Corrupted or unparseable — start fresh rather than fail init.
      existing = {};
    }
  }
  if (existing === null || typeof existing !== "object" || Array.isArray(existing)) {
    existing = {};
  }
  if (!existing.mcpServers || typeof existing.mcpServers !== "object" || Array.isArray(existing.mcpServers)) {
    existing.mcpServers = {};
  }

  const cliName = getCliName(dir);
  const managed = buildTrackedMcpServers(cliName);
  for (const [name, entry] of Object.entries(managed)) {
    existing.mcpServers[name] = entry;
  }

  writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n");

  return { written: true, path: mcpJsonPath, servers: Object.keys(managed) };
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
        execFileSyncCli(envPath, ["--version"], { stdio: "ignore", timeout: 5_000 });
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
        execFileSyncCli(configPath, ["--version"], { stdio: "ignore", timeout: 5_000 });
        return { found: true, path: configPath };
      } catch { /* not executable */ }
    }
    return { found: false, searched };
  }

  // 3. System PATH
  searched.push("claude (PATH)");
  try {
    execFileSyncCli("claude", ["--version"], { stdio: "ignore", timeout: 5_000 });
    persistDiscoveredClaudePath(dir, "claude");
    return { found: true, path: "claude" };
  } catch { /* not in PATH */ }

  // 4. Well-known install locations
  for (const p of buildClaudeWellKnownCandidates()) {
    searched.push(p);
    if (existsSync(p)) {
      try {
        execFileSyncCli(p, ["--version"], { stdio: "ignore", timeout: 5_000 });
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
 * @param {{ mcpScope?: "local" }} [opts]  Pass `{ mcpScope: "local" }` to
 *   register MCP servers via `claude mcp add --scope local` instead of
 *   relying on the tracked `.mcp.json` (the default).
 * @returns {{ settings: object, skills: object, mcp: object, mcpJson: object, instructions: object }}
 */
export function setupClaudeIntegration(dir, opts = {}) {
  const absDir = resolve(dir);

  const settings = mergeSettings(absDir);
  const skills = writeSkills(absDir);
  const mcp = registerMcpServers(absDir, opts);
  const mcpJson = writeMcpJson(absDir);
  const instructions = writeClaudeMd(absDir);

  return { settings, skills, mcp, mcpJson, instructions };
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
  if (result.mcp.mode === "tracked") {
    console.log(`  MCP servers: ${result.mcp.reason}`);
  } else if (!result.mcp.registered) {
    console.log(`  MCP servers: skipped (${result.mcp.reason})`);
    console.log("  To register manually, see: ndx --help init");
  } else {
    const ok = result.mcp.servers.filter((s) => s.ok);
    const failed = result.mcp.servers.filter((s) => !s.ok);
    if (ok.length > 0) {
      console.log(`  MCP servers: registered ${ok.map((s) => s.name).join(", ")} (local scope, ${ok[0].transport})`);
    }
    if (failed.length > 0) {
      const detail = failed
        .map((s) => (s.error ? `${s.name} (${s.error})` : s.name))
        .join(", ");
      console.log(`  MCP servers: failed to register ${detail}`);
    }
  }

  // Tracked .mcp.json
  if (result.mcpJson && result.mcpJson.written) {
    console.log(`  .mcp.json: tracked, cwd-relative entries for ${result.mcpJson.servers.join(", ")}`);
  }
}

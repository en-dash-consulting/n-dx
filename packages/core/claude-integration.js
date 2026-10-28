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
import { basename, isAbsolute, join, relative, resolve } from "path";
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
import { resolveLayout } from "./layout.js";
import { homedir } from "os";

const __dir = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dir, "../..");
const _require = createRequire(import.meta.url);

/**
 * The project-directory positional every MCP server registration records.
 *
 * Deliberately cwd-relative. A registration is re-run by every session Claude
 * Code applies it to, and it applies a repository's local-scope entry to
 * sessions started in that repository's other linked worktrees. An absolute
 * directory therefore pins all of them to one checkout: a run in a worktree
 * got a rex server writing to the main checkout, and its `update_task_status`
 * landed there, on whatever branch that checkout had out. `.` resolves against
 * the session's own cwd, so each worktree reaches its own `.rex/`.
 */
const MCP_PROJECT_ARG = ".";

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
 * project AND that entry's own recorded args target this directory. Local
 * scope is already keyed per-directory, but this extra check guards against
 * removing an entry that merely happens to share a project key without
 * actually pointing here.
 *
 * Two shapes count as targeting this project: the cwd-relative `.` this
 * function's caller writes today, and the absolute `absDir` it used to write.
 * Recognising the legacy shape is what makes re-running `ndx init` repair a
 * pinned registration rather than leave it in place.
 *
 * @param {string} absDir
 * @param {string} name
 * @returns {boolean}
 */
function localEntryTargetsProject(absDir, name) {
  const servers = readLocalMcpServers(absDir);
  const args = servers?.[name]?.args;
  if (!Array.isArray(args) || args.length === 0) return false;
  const target = args[args.length - 1];
  return target === MCP_PROJECT_ARG || projectConfigKeyCandidates(absDir).includes(target);
}

/**
 * Local-scope entries that record an **absolute** project directory.
 *
 * An absolute directory is the defect: Claude Code applies a repository's
 * local-scope entry to sessions started in that repository's other linked
 * worktrees, so an entry naming one checkout redirects every MCP call made
 * from any of them — including an autonomous run's PRD writes, which then land
 * in the wrong checkout on whatever branch it has out.
 *
 * @param {string} absDir
 * @returns {{ name: string, pinnedDir: string }[]}
 */
function findPinnedLocalEntries(absDir) {
  const servers = readLocalMcpServers(absDir);
  if (!servers) return [];

  const pinned = [];
  for (const name of Object.keys(getMcpServers())) {
    const args = servers[name]?.args;
    if (!Array.isArray(args) || args.length === 0) continue;
    const target = args[args.length - 1];
    if (typeof target !== "string" || !isAbsolute(target)) continue;
    pinned.push({ name, pinnedDir: target });
  }
  return pinned;
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
 * Neither mode writes an absolute project directory any more — see
 * {@link MCP_PROJECT_ARG}. Entries left behind by a build that did are
 * reported in `pinned` so the caller can surface them even when they could not
 * be removed (no `claude` on PATH, or a removal that failed).
 *
 * @param {string} dir
 * @param {{ mcpScope?: "local" }} [opts]
 */
function registerMcpServers(dir, opts = {}) {
  const useLocalScope = opts.mcpScope === "local";
  const absDir = resolve(dir);

  // Read before anything is removed, and before the `claude` lookup can bail:
  // a missing CLI is precisely the case where init cannot clean up and the
  // operator has to be told the command.
  const pinned = findPinnedLocalEntries(absDir);

  const discovery = discoverClaudeCli(dir);
  if (!discovery.found) {
    return {
      registered: false,
      reason: "claude CLI not found",
      searched: discovery.searched,
      mode: useLocalScope ? "local" : "tracked",
      pinned,
    };
  }

  const claudeCmd = discovery.path;
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

  // What the sweep above could not reach: an entry pinning some *other*
  // directory. `claude mcp remove --scope local` is cwd-scoped, so it only
  // retires entries that name this project — which the loop just did.
  const keys = projectConfigKeyCandidates(absDir);
  const unresolved = pinned.filter((p) => !keys.includes(p.pinnedDir));

  if (!useLocalScope) {
    return {
      registered: false,
      reason: "using tracked .mcp.json (pass --mcp-scope=local to register local scope instead)",
      mode: "tracked",
      pinned: unresolved,
    };
  }

  const results = [];
  for (const [name, descriptor] of Object.entries(servers)) {
    const bin = resolveSubPackageCli(descriptor.package, descriptor.npmName);
    try {
      // `claude mcp add --scope local` — the flag-gated legacy path.
      // MCP_PROJECT_ARG, never absDir: the recorded argv is re-run by every
      // session Claude Code applies this entry to, including sessions in the
      // repository's other worktrees.
      execFileSyncCli(
        claudeCmd,
        ["mcp", "add", "--scope", "local", name, "--", "node", bin, descriptor.mcpCommand, MCP_PROJECT_ARG],
        { stdio: "pipe", timeout: 10_000, cwd: absDir },
      );
      results.push({ name, transport: "stdio", ok: true });
    } catch (e) {
      results.push({ name, transport: "stdio", ok: false, error: extractExecError(e) });
    }
  }

  return { registered: true, servers: results, mode: "local", pinned: unresolved };
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
    entries[name] = { command: cliName, args: [subcommand, descriptor.mcpCommand, MCP_PROJECT_ARG] };
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
 * Read cli.claudePath from the machine-local `.n-dx.local.json`.
 *
 * Never from the shared `.n-dx.json`: init probes this binary before the trust
 * review, so a path the repository ships would run its own script with the
 * user's environment. llm-client's trust review flags a shared one
 * (`vendor-cli-path`), and `ndx config cli.claudePath` writes the local file.
 * A local file the repository ships is the repository's too
 * (`local-config-tracked`), so it is not read either — see
 * {@link localConfigIsRepositoryConfig}.
 * Returns undefined if not set.
 * @param {string|null} dir
 * @returns {string|undefined}
 */
function readConfiguredClaudePath(dir) {
  if (!dir) return undefined;
  const layout = resolveLayout(dir);
  if (!existsSync(layout.localConfigFile) || localConfigIsRepositoryConfig(layout.root)) {
    return undefined;
  }
  try {
    const raw = readFileSync(layout.localConfigFile, "utf-8");
    const cfg = JSON.parse(raw);
    const p = cfg?.cli?.claudePath;
    return typeof p === "string" && p.length > 0 ? p : undefined;
  } catch { return undefined; }
}

/**
 * Does the repository ship the machine-local config file? llm-client's
 * `isLocalConfigTracked` decides (a case variant, a symlinked `.ndx`, git
 * unable to answer inside a work tree); core spawns rather than imports, so
 * it asks through `hench trust status`, the route `ndx init`'s trust review
 * already takes. No answer counts as shipped: the file then waits for trust
 * rather than choosing a binary.
 * @param {string} root
 * @returns {boolean}
 */
function localConfigIsRepositoryConfig(root) {
  try {
    const out = execFileSyncCli(
      process.execPath,
      [resolveSubPackageCli("packages/hench", "@n-dx/hench"), "trust", "status", "--format=json", root],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
    );
    return JSON.parse(String(out))?.config?.localConfigTracked !== false;
  } catch {
    return true;
  }
}

/**
 * The note for a shared cli.claudePath that {@link discoverClaudeCli} skips:
 * set in the project config while neither CLAUDE_CLI_PATH nor a local one
 * takes precedence. Older `ndx config` wrote it there. Reads the shared file
 * for presence only; the value is never run and never echoed.
 * @param {string|null} dir
 * @returns {string|undefined}
 */
function ignoredSharedClaudePathNote(dir) {
  if (!dir || process.env.CLAUDE_CLI_PATH || readConfiguredClaudePath(dir)) return undefined;
  const layout = resolveLayout(dir);
  const p = readJsonObject(layout.configFile)?.cli;
  if (!isPlainObject(p) || typeof p.claudePath !== "string" || p.claudePath.length === 0) return undefined;
  const shared = relative(layout.root, layout.configFile);
  const local = relative(layout.root, layout.localConfigFile);
  return `cli.claudePath in ${shared} is not run (a repository's config cannot choose the Claude binary); move it to ${local}`;
}

/**
 * Move a `claudePath` an older init wrote into `.hench/config.json` to
 * `hench.claudePath` in the machine-local config (`.n-dx.local.json`).
 *
 * Older inits persisted a discovered path there, where it now reads as a
 * repository-chosen binary (`vendor-cli-path`) and leaves the user's own
 * checkout untrusted. Only a discovery candidate moves; any other value was
 * set by hand and is left alone. A local `hench.claudePath` is never
 * overridden. `ndx init` runs this whichever way it finds Claude, and with
 * Claude integration off.
 *
 * Skips when either config file is missing, unreadable or not an object.
 * @param {string} dir  Project root
 */
export function moveDiscoveredClaudePath(dir) {
  const layout = resolveLayout(dir);
  const henchConfigFile = join(layout.henchDir, "config.json");
  const henchConfig = readJsonObject(henchConfigFile);
  const stale = henchConfig?.claudePath;
  if (typeof stale !== "string" || !isClaudeDiscoveryCandidate(stale)) return;
  const local = existsSync(layout.localConfigFile) ? readJsonObject(layout.localConfigFile) : {};
  if (!local) return;
  try {
    const hench = isPlainObject(local.hench) ? local.hench : {};
    if (!hench.claudePath) {
      local.hench = { ...hench, claudePath: stale };
      writeFileSync(layout.localConfigFile, JSON.stringify(local, null, 2) + "\n", "utf-8");
    }
    // Removed only after the local write, so a failure there loses nothing.
    delete henchConfig.claudePath;
    writeFileSync(henchConfigFile, JSON.stringify(henchConfig, null, 2) + "\n", "utf-8");
  } catch { /* skip — non-critical: `ndx trust accept .` or a manual move clears the finding */ }
}

/**
 * Persist a claude CLI path found at a well-known location as
 * `hench.claudePath` in the machine-local config (`.n-dx.local.json`), so
 * subsequent hench invocations reuse it without re-discovering. Machine-local
 * because the path is this machine's, and because hench honours a
 * `claudePath` the repository ships (`.hench/config.json`) only once the
 * repository is trusted. A path found now replaces a local one.
 *
 * Skips when hench is not initialized or the local config is unreadable.
 * @param {string|null} dir  Project root
 * @param {string} resolvedPath
 */
function persistDiscoveredClaudePath(dir, resolvedPath) {
  if (!dir) return;
  const layout = resolveLayout(dir);
  if (!existsSync(join(layout.henchDir, "config.json"))) return;
  const local = existsSync(layout.localConfigFile) ? readJsonObject(layout.localConfigFile) : {};
  if (!local) return;
  const hench = isPlainObject(local.hench) ? local.hench : {};
  if (hench.claudePath === resolvedPath) return;
  local.hench = { ...hench, claudePath: resolvedPath };
  try {
    writeFileSync(layout.localConfigFile, JSON.stringify(local, null, 2) + "\n", "utf-8");
  } catch { /* skip — non-critical: hench falls back to `claude` on PATH */ }
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @param {string} path
 * @returns {Record<string, unknown> | null}  null when missing, malformed or not an object
 */
function readJsonObject(path) {
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
  return isPlainObject(parsed) ? parsed : null;
}

/**
 * Whether `p` is a path {@link discoverClaudeCli} could have found in step 4.
 * Any nvm version counts, including one since uninstalled.
 * @param {string} p
 */
function isClaudeDiscoveryCandidate(p) {
  if (buildClaudeWellKnownCandidates().includes(p)) return true;
  const nvmVersionsDir = join(homedir(), ".nvm", "versions", "node");
  const binDir = dirname(p);
  return process.platform !== "win32"
    && basename(p) === "claude"
    && basename(binDir) === "bin"
    && dirname(dirname(binDir)) === nvmVersionsDir;
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
 *  2. cli.claudePath in .n-dx.local.json (exclusive — no fallback when set;
 *     the shared .n-dx.json is not read, see {@link readConfiguredClaudePath})
 *  3. System PATH
 *  4. Well-known install locations (~/.claude/local/claude, nvm, Homebrew, etc.)
 *
 * When a path is found via (4) it is persisted as `hench.claudePath` in
 * .n-dx.local.json so subsequent hench invocations reuse it without
 * re-discovering (see {@link persistDiscoveredClaudePath}). A path an older
 * init wrote into `.hench/config.json` is moved by `ndx init` itself, not
 * here (see {@link moveDiscoveredClaudePath}).
 *
 * @param {string|null} [dir=null]  Project root (used to read and write .n-dx.local.json)
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

  // 2. cli.claudePath from .n-dx.local.json — exclusive if set
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

  const ignored = ignoredSharedClaudePathNote(dir);
  if (ignored) searched.push(ignored);
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
  const claudePathNote = ignoredSharedClaudePathNote(absDir);

  return { settings, skills, mcp, mcpJson, instructions, ...(claudePathNote && { claudePathNote }) };
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

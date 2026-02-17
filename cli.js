#!/usr/bin/env node

/**
 * n-dx CLI orchestrator — top-level entry point for all commands.
 *
 * ## Architectural layering
 *
 * The monorepo follows a strict four-tier dependency hierarchy:
 *
 * ```
 *   Orchestration  cli.js, web.js, ci.js
 *        ↓
 *   Execution      hench (autonomous agent)
 *        ↓
 *   Domain         rex (PRD management) · sourcevision (static analysis)
 *        ↓
 *   Foundation     @n-dx/claude-client (shared types, API abstraction)
 * ```
 *
 * Each layer only imports from the layer directly below it:
 * - **Orchestration** spawns tool CLIs as child processes (no library imports).
 * - **Execution** (hench) imports rex for task management via a single
 *   gateway module (`hench/src/prd/ops.ts`), keeping the cross-package
 *   surface explicit.
 * - **Domain** packages (rex, sourcevision) are fully independent —
 *   they never import each other and share data only through the
 *   orchestration or web layer.
 * - **Foundation** (`@n-dx/claude-client`) provides the shared type
 *   contracts and API client that prevent circular dependencies.
 *
 * This layering ensures the import graph remains a DAG with zero
 * circular dependencies, enabling independent builds and testing.
 *
 * @module n-dx/cli
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { runConfig } from "./config.js";
import { runCI } from "./ci.js";
import { runWeb } from "./web.js";

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a package's CLI entry point from its package.json bin field.
 * Falls back to the conventional dist/cli/index.js path if bin is missing.
 */
function resolveToolPath(pkgDir) {
  const pkgPath = join(__dir, pkgDir, "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.bin === "string") {
      return join(pkgDir, pkg.bin);
    }
    if (pkg.bin && typeof pkg.bin === "object") {
      // Use the first bin entry
      const first = Object.values(pkg.bin)[0];
      if (first) return join(pkgDir, first);
    }
  } catch {
    // package.json unreadable — fall through
  }
  return join(pkgDir, "dist/cli/index.js");
}

/**
 * Known error patterns mapped to user-friendly suggestions.
 * Each entry: [regex to match against the message, suggestion text].
 */
const ERROR_HINTS = [
  [/ENOENT.*\.(rex|hench|sourcevision)/, "Run 'ndx init' to set up the project."],
  [/ENOENT.*prd\.json/, "Run 'ndx init' to create the initial PRD."],
  [/ENOENT.*config\.json/, "Run 'ndx init' to create default configuration."],
  [/EACCES/, "Check file permissions for the project directory."],
  [/Unexpected token/, "A JSON file may be corrupted. Check for syntax errors or re-initialize with 'ndx init'."],
  [/EADDRINUSE/, "The port is already in use. Try a different port with --port=N."],
];

/**
 * Format an error for CLI output — user-friendly with optional hint.
 * Never shows stack traces.
 */
function formatError(err) {
  const message = err instanceof Error ? err.message : String(err);
  // If the error already has a suggestion (e.g. from a CLIError-like object), use it
  if (err && err.suggestion) {
    return `Error: ${message}\nHint: ${err.suggestion}`;
  }
  for (const [pattern, suggestion] of ERROR_HINTS) {
    if (pattern.test(message)) {
      return `Error: ${message}\nHint: ${suggestion}`;
    }
  }
  return `Error: ${message}`;
}

// Catch unhandled errors at the top level — never show stack traces
process.on("uncaughtException", (err) => {
  console.error(formatError(err));
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(formatError(err));
  process.exit(1);
});

const tools = {
  rex: resolveToolPath("packages/rex"),
  hench: resolveToolPath("packages/hench"),
  sourcevision: resolveToolPath("packages/sourcevision"),
  sv: resolveToolPath("packages/sourcevision"),
  web: resolveToolPath("packages/web"),
};

function run(script, args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [resolve(__dir, script), ...args], {
      stdio: "inherit",
    });
    child.on("close", (code) => res(code ?? 1));
  });
}

async function runOrDie(script, args) {
  const code = await run(script, args);
  if (code !== 0) process.exit(code);
}

function resolveDir(args) {
  for (let i = args.length - 1; i >= 0; i--) {
    if (!args[i].startsWith("-")) return args[i];
  }
  return process.cwd();
}

function extractFlags(args) {
  return args.filter((a) => a.startsWith("-"));
}

/**
 * Check that required directories exist before running orchestration commands.
 * Provides a clear, actionable error message suggesting `ndx init`.
 */
function requireInit(dir, dirs) {
  const missing = dirs.filter((d) => !existsSync(join(dir, d)));
  if (missing.length > 0) {
    console.error(`Error: Missing ${missing.join(", ")} in ${dir}`);
    console.error(`Hint: Run 'ndx init ${dir === process.cwd() ? "" : dir}' to set up the project.`.trimEnd());
    process.exit(1);
  }
}

// ── Per-command help for orchestration commands ─────────────────────────────

const ORCHESTRATION_HELP = {
  init: `ndx init — initialize all tools

Usage: ndx init [options] [dir]

Sets up .sourcevision/, .rex/, and .hench/ in the target directory.
Runs sourcevision init → rex init → hench init in sequence.

Options:
  --project=<name>    Project name for config (default: directory basename)
  --analyze           Also run SourceVision analysis after init

Examples:
  ndx init                         Initialize in current directory
  ndx init ./my-project            Initialize in a specific directory
  ndx init --analyze .             Initialize and analyze codebase`,

  plan: `ndx plan — analyze codebase and generate PRD proposals

Usage: ndx plan [options] [dir]

Runs SourceVision analysis then Rex analyze to scan the codebase and
generate PRD proposals. Proposals are reviewed interactively unless
--accept is passed.

Options:
  --accept              Accept all proposals without review
  --guided              Interactive spec builder for new projects
  --file=<path>         Import from a document (skip SourceVision scan)
  --lite                File-name-only scan (faster, less detail)
  --no-llm              Force algorithmic pipeline, skip LLM
  --model=<name>        Override LLM model
  --chunk-size=<n>      Proposals per page in interactive review
  --quiet, -q           Suppress informational output

Examples:
  ndx plan                         Analyze and review proposals interactively
  ndx plan --accept .              Auto-accept all proposals
  ndx plan --file=spec.md .        Generate PRD from a spec document
  ndx plan --guided .              Guided setup for a new project`,

  work: `ndx work — execute the next task autonomously

Usage: ndx work [options] [dir]

Picks the next actionable task from the PRD and runs an autonomous
agent (hench) to implement it. Delegates to 'hench run'.

Options:
  --task=<id>           Target a specific Rex task ID
  --epic=<id|title>     Only consider tasks within the specified epic
  --epic-by-epic        Process epics sequentially
  --auto                Skip interactive selection, autoselect by priority
  --iterations=<n>      Run multiple tasks sequentially
  --loop                Run continuously until all tasks complete or Ctrl+C
  --dry-run             Print the task brief without calling Claude
  --review              Show proposed changes and prompt for approval
  --max-turns=<n>       Override max agent turns per task
  --token-budget=<n>    Cap total tokens per run (0 = unlimited)
  --model=<model>       Override the Claude model

Examples:
  ndx work                         Run next task interactively
  ndx work --task=abc123 .         Run a specific task
  ndx work --auto --loop .         Continuously auto-run tasks
  ndx work --dry-run .             Preview the brief without execution`,

  status: `ndx status — show PRD status tree

Usage: ndx status [options] [dir]

Displays the PRD hierarchy with status icons and completion stats.
Delegates to 'rex status'. Completed items are hidden by default.

Options:
  --all               Show all items including completed
  --coverage          Show test coverage per task
  --tokens=false      Hide token usage summary
  --since=<ISO>       Filter token usage after timestamp
  --until=<ISO>       Filter token usage before timestamp
  --format=tree|json  Output format (default: tree)

Examples:
  ndx status                       Show PRD tree
  ndx status --all                 Include completed items
  ndx status --format=json .       JSON output for scripting`,

  usage: `ndx usage — token usage analytics

Usage: ndx usage [options] [dir]

Shows token consumption and cost estimates across all LLM operations.
Delegates to 'rex usage'.

Options:
  --group=day|week|month  Group usage by time period
  --since=<ISO>           Filter usage after timestamp
  --until=<ISO>           Filter usage before timestamp
  --format=tree|json      Output format (default: tree)

Examples:
  ndx usage                        Show total token usage
  ndx usage --group=week           Usage grouped by week
  ndx usage --format=json .        Machine-readable output`,

  sync: `ndx sync — sync local PRD with remote adapter

Usage: ndx sync [options] [dir]

Bidirectional sync between local .rex/prd.json and a remote service.
Delegates to 'rex sync'.

Options:
  --push              Push local changes to remote only
  --pull              Pull remote changes to local only
  --adapter=<name>    Adapter name (default: notion)
  --dry-run           Preview sync without writing

Examples:
  ndx sync                         Full bidirectional sync
  ndx sync --push .                Push local changes to Notion
  ndx sync --pull .                Pull remote changes down`,

  start: `ndx start — start the dashboard and MCP server

Usage: ndx start [subcommand] [options] [dir]

Starts the unified web server serving both the dashboard UI and
MCP HTTP endpoints for Rex and SourceVision.

Subcommands:
  (none)              Start the server (foreground)
  stop                Stop a background server
  status              Check if a background server is running

Options:
  --port=<N>          Server port (default: 3117)
  --background        Run as a background daemon

Examples:
  ndx start .                      Start server in foreground
  ndx start --background .         Start as background daemon
  ndx start status .               Check if server is running
  ndx start stop .                 Stop background server`,

  web: `ndx web — alias for 'ndx start'

Usage: ndx web [subcommand] [options] [dir]

Legacy alias for 'ndx start'. See 'ndx start --help' for full details.

Examples:
  ndx web .                        Start server
  ndx web --background .           Start as background daemon`,

  ci: `ndx ci — run analysis pipeline and validate PRD health

Usage: ndx ci [options] [dir]

Runs the full CI pipeline: SourceVision analysis followed by PRD
validation. Reports pass/fail status suitable for CI systems.

Options:
  --format=json       Machine-readable JSON output

Examples:
  ndx ci                           Run CI pipeline
  ndx ci --format=json .           JSON output for CI integration`,

  dev: `ndx dev — start dev server with live reload

Usage: ndx dev [options] [dir]

Starts the development server with hot module replacement for the
web dashboard. Requires .sourcevision/ to exist.

Options:
  --port=<N>          Server port (default: 3117)
  --scope=<pkg>       Limit to a specific package

Examples:
  ndx dev .                        Start dev server
  ndx dev --port=8080 .            Custom port`,

  // config is excluded: config.js has its own comprehensive --help handler
  // that documents all per-package keys, types, and examples.
};

/**
 * Show per-command help for an orchestration command.
 * Returns true if help was shown, false otherwise.
 */
function showCommandHelp(cmd) {
  const text = ORCHESTRATION_HELP[cmd];
  if (!text) return false;
  console.log(text);
  return true;
}

const [command, ...rest] = process.argv.slice(2);

// ── Per-command --help ──────────────────────────────────────────────────────

const hasHelp = rest.some((a) => a === "--help" || a === "-h");
if (hasHelp && command && showCommandHelp(command)) {
  process.exit(0);
}

// --- Orchestration commands ---

if (command === "init") {
  const dir = resolveDir(rest);
  const flags = extractFlags(rest);
  await runOrDie(tools.sourcevision, ["init", ...flags, dir]);
  await runOrDie(tools.rex, ["init", ...flags, dir]);
  await runOrDie(tools.hench, ["init", ...flags, dir]);
  process.exit(0);
}

if (command === "plan") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  const hasFile = flags.some((f) => f.startsWith("--file=") || f === "--file");

  // Skip sourcevision when importing from a specific file
  if (!hasFile) {
    await runOrDie(tools.sourcevision, ["analyze", ...flags.filter((f) => f === "--quiet" || f === "-q"), dir]);
  }

  await runOrDie(tools.rex, ["analyze", ...flags, dir]);
  process.exit(0);
}

if (command === "work") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex", ".hench"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.hench, ["run", ...flags, dir]);
  process.exit(0);
}

if (command === "status") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["status", ...flags, dir]);
  process.exit(0);
}

if (command === "usage") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["usage", ...flags, dir]);
  process.exit(0);
}

if (command === "sync") {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["sync", ...flags, dir]);
  process.exit(0);
}

if (command === "ci") {
  const dir = resolveDir(rest);
  const flags = extractFlags(rest);
  const isJSON = flags.some((f) => f === "--format=json");

  // For JSON mode, let runCI handle missing dirs so it can produce structured output.
  // For text mode, use the standard requireInit guard.
  if (!isJSON) {
    requireInit(dir, [".rex", ".sourcevision"]);
  }

  try {
    const ok = await runCI(dir, flags, { run, tools });
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }
}

if (command === "dev") {
  const dir = resolveDir(rest);
  requireInit(dir, [".sourcevision"]);
  const flags = extractFlags(rest);
  const code = await run("packages/web/dev.js", [...flags, dir]);
  process.exit(code);
}

if (command === "start") {
  const dir = resolveDir(rest);
  try {
    const code = await runWeb(dir, rest, { run, tools, __dir, commandName: "start" });
    process.exit(code);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }
}

if (command === "web") {
  const dir = resolveDir(rest);
  try {
    const code = await runWeb(dir, rest, { run, tools, __dir });
    process.exit(code);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }
}

if (command === "config") {
  try {
    await runConfig(rest);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }
  process.exit(0);
}

// --- Delegation commands ---

if (tools[command]) {
  const code = await run(tools[command], rest);
  process.exit(code);
}

// --- Help ---

console.log(`n-dx — AI-powered development toolkit

Orchestration:
  init [dir]            Initialize all tools (sourcevision + rex + hench)
  plan [dir]            Analyze codebase and show PRD proposals (--guided for new projects)
  plan --accept [dir]   Analyze and accept proposals into PRD
  work [dir]            Run next task (--task=ID, --epic=ID, --epic-by-epic, --auto)
  status [dir]          Show PRD status (--format=json, --since, --until)
  usage [dir]           Token usage analytics (--format=json, --group=day|week|month)
  sync [dir]            Sync local PRD with remote adapter (--push, --pull)
  start [dir]           Start server: dashboard + MCP (--port=N, --background, stop, status)
  dev [dir]             Start dev server with live reload (--port=N, --scope=<pkg>)
  web [dir]             Alias for start (--port=N, --background, stop, status)
  ci [dir]              Run analysis pipeline and validate PRD health
  config [key] [value]  View and edit settings (--json, --help)

Tools (via orchestrator or standalone):
  rex ...               PRD management and task tracking
  hench ...             Autonomous agent for task execution
  sourcevision ...      Codebase analysis and visualization
  sv ...                Alias for sourcevision

Global Options:
  --quiet, -q           Suppress informational output (for scripting)

Usage: ndx <command> [args...]
       n-dx <command> [args...]

Standalone binaries (rex, hench, sourcevision, sv) are also available after install.`);
if (command) {
  console.error(`\nError: Unknown command: ${command}`);
  console.error("Hint: Run 'ndx --help' to see available commands.");
}
process.exit(command ? 1 : 0);

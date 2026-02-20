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
import {
  formatTypoSuggestion,
  getOrchestratorCommands,
  searchHelp,
  formatSearchResults,
  formatToolHelp,
  formatMainHelp,
  formatOrchestratorCommandHelp,
} from "./help.js";

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
 * Read active LLM vendor from .n-dx.json.
 * Returns undefined when unset or config file is missing/invalid.
 */
function readLLMVendor(dir) {
  const configPath = join(dir, ".n-dx.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(configPath, "utf-8"));
    const vendor = data?.llm?.vendor;
    return vendor === "claude" || vendor === "codex" ? vendor : undefined;
  } catch {
    return undefined;
  }
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

// config is excluded from orchestrator help: config.js has its own
// comprehensive --help handler that documents all per-package keys, types,
// and examples.

/**
 * Show per-command help for an orchestration command.
 * Returns true if help was shown, false otherwise.
 */
function showCommandHelp(command) {
  const text = formatOrchestratorCommandHelp(command);
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

// ── ndx help [keyword|tool] — search and navigation ────────────────────────

if (command === "help") {
  const query = rest.filter((a) => !a.startsWith("-")).join(" ");
  if (!query) {
    // No keyword — show main help
    showMainHelp();
    process.exit(0);
  }
  // If query is a tool name, show its subcommand summary with navigation hints
  const toolHelp = formatToolHelp(query);
  if (toolHelp) {
    console.log(toolHelp);
    process.exit(0);
  }
  // If query matches an orchestration command, show its help
  if (showCommandHelp(query)) {
    process.exit(0);
  }
  // Otherwise search across all help content
  const results = searchHelp(query);
  console.log(formatSearchResults(results, query));
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

  // Require explicit vendor selection for n-dx orchestration.
  // This avoids implicit use of whichever local CLI session happens to be active.
  const isDryRun = flags.includes("--dry-run");
  if (!isDryRun) {
    const vendor = readLLMVendor(dir);
    if (!vendor) {
      console.error("Error: No LLM vendor configured for this project.");
      console.error("Hint: Run 'n-dx config llm.vendor claude' (or codex when supported).");
      process.exit(1);
    }
  }

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

// --- Help or unknown command ---

if (command) {
  // Unknown command — suggest similar commands
  const allCommands = [...getOrchestratorCommands(), "help"];
  const typoHint = formatTypoSuggestion(command, allCommands, "ndx ");
  console.error(`Error: Unknown command: ${command}`);
  if (typoHint) {
    console.error(`Hint: ${typoHint}`);
  } else {
    console.error("Hint: Run 'ndx --help' to see available commands, or 'ndx help <keyword>' to search.");
  }
  process.exit(1);
}

showMainHelp();
process.exit(0);

function showMainHelp() {
  console.log(formatMainHelp());
}

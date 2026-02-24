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
import { createInterface } from "readline/promises";
import { runConfig } from "./config.js";
import { runCI } from "./ci.js";
import { runWeb } from "./web.js";
import { buildRefreshPlan, RefreshPlanError } from "./refresh-plan.js";
import { refreshSourcevisionDashboardArtifacts } from "./refresh-artifacts.js";
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
const SUPPORTED_PROVIDERS = ["codex", "claude"];
const INIT_BANNER_LINES = [
  "┌──────────────────────────────────────────────┐",
  "│                   n-dx init                  │",
  "│        Guided project setup is starting      │",
  "└──────────────────────────────────────────────┘",
];

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

function extractInitProvider(args) {
  const providerFlag = args.find((a) => a.startsWith("--provider="));
  if (!providerFlag) return undefined;
  const value = providerFlag.slice("--provider=".length).trim().toLowerCase();
  return value;
}

function stripInitProviderFlag(args) {
  return args.filter((a) => !a.startsWith("--provider="));
}

function shouldShowInitBanner(providerFromFlag) {
  return providerFromFlag === undefined;
}

function showInitBanner() {
  console.log(INIT_BANNER_LINES.join("\n"));
  console.log("");
}

async function promptInitProvider() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const abort = new AbortController();
  const onSigint = () => abort.abort();
  process.once("SIGINT", onSigint);

  try {
    console.log("Select active LLM provider:");
    console.log("  1) codex");
    console.log("  2) claude");
    console.log("");

    while (true) {
      const answer = (await rl.question("Enter choice [1-2]: ", { signal: abort.signal }))
        .trim()
        .toLowerCase();

      if (!answer) return undefined;
      if (answer === "1" || answer === "codex") return "codex";
      if (answer === "2" || answer === "claude") return "claude";

      console.error("Invalid selection. Choose 'codex' or 'claude'.");
    }
  } catch (err) {
    if (err && typeof err === "object" && err.name === "AbortError") {
      return undefined;
    }
    throw err;
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
  }
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

const REFRESH_STEP_ORDER = {
  "sourcevision-analyze": 1,
  "sourcevision-dashboard-artifacts": 2,
  "sourcevision-pr-markdown": 3,
  "web-build": 4,
};
const WEB_PORT_FILE = ".n-dx-web.port";

function printRefreshStepTransition(kind, status, detail) {
  if (status === "skipped") {
    console.log(`Refresh step: ${kind} -> skipped (${detail})`);
    return;
  }
  if (status === "failed") {
    console.log(`Refresh step: ${kind} -> failed (${detail})`);
    return;
  }
  console.log(`Refresh step: ${kind} -> ${status}`);
}

function printRefreshStepSummary(stepStatuses) {
  const combined = [...stepStatuses]
    .sort((a, b) => (REFRESH_STEP_ORDER[a.kind] ?? 99) - (REFRESH_STEP_ORDER[b.kind] ?? 99));

  console.log("Refresh step summary:");
  for (const step of combined) {
    if (step.status === "succeeded") {
      console.log(`- ${step.kind}: succeeded`);
      continue;
    }
    if (step.status === "failed") {
      console.log(`- ${step.kind}: failed (${step.detail})`);
      continue;
    }
    console.log(`- ${step.kind}: skipped (${step.detail})`);
  }
}

function readRunningServerPort(dir) {
  const portPath = join(dir, WEB_PORT_FILE);
  if (!existsSync(portPath)) return null;
  try {
    const raw = readFileSync(portPath, "utf-8");
    const port = parseInt(raw.trim(), 10);
    if (isNaN(port) || port < 1 || port > 65535) return null;
    return port;
  } catch {
    return null;
  }
}

async function signalLiveReload(dir) {
  const port = readRunningServerPort(dir);
  if (!port) {
    return {
      attempted: false,
      success: false,
      message: "Live reload: skipped (no running dashboard server detected).",
    };
  }
  const restartCommand = `ndx start stop "${resolve(dir)}" && ndx start "${resolve(dir)}"`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/reload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "ndx refresh" }),
      signal: controller.signal,
    });

    if (res.status === 404 || res.status === 405) {
      return {
        attempted: true,
        success: false,
        message:
          `Live reload: unavailable on :${port} (server does not support reload signaling).\n`
          + `Restart required: ${restartCommand}`,
      };
    }

    if (!res.ok) {
      return {
        attempted: true,
        success: false,
        message:
          `Live reload: unavailable on :${port} (signaling failed: HTTP ${res.status}).\n`
          + `Restart required: ${restartCommand}`,
      };
    }

    let wsClients = null;
    try {
      const data = await res.json();
      wsClients = typeof data?.websocketClients === "number" ? data.websocketClients : null;
    } catch {
      // ignore malformed success payload
    }

    return {
      attempted: true,
      success: true,
      message: wsClients === null
        ? `Live reload: attempted on :${port} and succeeded.`
        : `Live reload: attempted on :${port} and succeeded (${wsClients} WebSocket client${wsClients === 1 ? "" : "s"} notified).`,
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      success: false,
      message: `Live reload: unavailable on :${port} (signaling failed: ${detail}).\nRestart required: ${restartCommand}`,
    };
  } finally {
    clearTimeout(timeout);
  }
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
  const providerFromFlag = extractInitProvider(rest);
  if (providerFromFlag !== undefined && !SUPPORTED_PROVIDERS.includes(providerFromFlag)) {
    console.error(`Error: Invalid provider "${providerFromFlag}". Expected one of: codex, claude.`);
    process.exit(1);
  }

  const initArgs = stripInitProviderFlag(rest);
  const dir = resolveDir(initArgs);
  const flags = extractFlags(initArgs);

  if (shouldShowInitBanner(providerFromFlag)) {
    showInitBanner();
  }

  const selectedProvider = providerFromFlag ?? await promptInitProvider();
  if (!selectedProvider) {
    console.error("Init cancelled: no provider selected. Re-run 'ndx init' and choose 'codex' or 'claude'.");
    process.exit(1);
  }

  await runOrDie(tools.sourcevision, ["init", ...flags, dir]);
  await runOrDie(tools.rex, ["init", ...flags, dir]);
  await runOrDie(tools.hench, ["init", ...flags, dir]);
  await runConfig(["llm.vendor", selectedProvider, dir]);

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

if (command === "refresh") {
  const dir = resolveDir(rest);
  const flags = extractFlags(rest);
  let plan;
  try {
    plan = buildRefreshPlan(flags);
  } catch (err) {
    if (err instanceof RefreshPlanError) {
      console.error(`Error: ${err.message}`);
      if (err.suggestion) console.error(`Hint: ${err.suggestion}`);
      process.exit(1);
    }
    throw err;
  }

  if (plan.needsSourcevisionDir) {
    requireInit(dir, [".sourcevision"]);
  }
  const stepStatuses = [];
  for (const note of plan.notes) {
    console.log(note);
  }
  for (const skippedStep of plan.skippedSteps ?? []) {
    printRefreshStepTransition(skippedStep.kind, "skipped", skippedStep.reason);
    stepStatuses.push({ kind: skippedStep.kind, status: "skipped", detail: skippedStep.reason });
  }

  for (const step of plan.steps) {
    printRefreshStepTransition(step.kind, "started");
    try {
      if (step.kind === "sourcevision-analyze") {
        const code = await run(tools.sourcevision, ["analyze", ...plan.quietFlags, dir]);
        if (code !== 0) {
          const detail = `exit code ${code}`;
          printRefreshStepTransition(step.kind, "failed", detail);
          stepStatuses.push({ kind: step.kind, status: "failed", detail });
          printRefreshStepSummary(stepStatuses);
          process.exit(code);
        }
        printRefreshStepTransition(step.kind, "succeeded");
        stepStatuses.push({ kind: step.kind, status: "succeeded" });
        continue;
      }
      if (step.kind === "sourcevision-pr-markdown") {
        const code = await run(tools.sourcevision, ["pr-markdown", ...plan.quietFlags, dir]);
        if (code !== 0) {
          const detail = `exit code ${code}`;
          printRefreshStepTransition(step.kind, "failed", detail);
          stepStatuses.push({ kind: step.kind, status: "failed", detail });
          printRefreshStepSummary(stepStatuses);
          process.exit(code);
        }
        printRefreshStepTransition(step.kind, "succeeded");
        stepStatuses.push({ kind: step.kind, status: "succeeded" });
        continue;
      }
      if (step.kind === "sourcevision-dashboard-artifacts") {
        refreshSourcevisionDashboardArtifacts(dir);
        printRefreshStepTransition(step.kind, "succeeded");
        stepStatuses.push({ kind: step.kind, status: "succeeded" });
        continue;
      }
      if (step.kind === "web-build") {
        const code = await run("packages/web/build.js", []);
        if (code !== 0) {
          const detail = `exit code ${code}`;
          printRefreshStepTransition(step.kind, "failed", detail);
          stepStatuses.push({ kind: step.kind, status: "failed", detail });
          printRefreshStepSummary(stepStatuses);
          process.exit(code);
        }
        printRefreshStepTransition(step.kind, "succeeded");
        stepStatuses.push({ kind: step.kind, status: "succeeded" });
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      printRefreshStepTransition(step.kind, "failed", detail);
      stepStatuses.push({ kind: step.kind, status: "failed", detail });
      printRefreshStepSummary(stepStatuses);
      process.exit(1);
    }
  }
  printRefreshStepSummary(stepStatuses);
  const reload = await signalLiveReload(dir);
  console.log(reload.message);

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

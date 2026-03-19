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
 *   Foundation     @n-dx/llm-client (shared types, API abstraction)
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
 * - **Foundation** (`@n-dx/llm-client`) provides the shared type
 *   contracts and API client that prevent circular dependencies.
 *
 * This layering ensures the import graph remains a DAG with zero
 * circular dependencies, enabling independent builds and testing.
 *
 * @module n-dx/cli
 */

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline/promises";
import { runConfig } from "./config.js";
import { runCI } from "./ci.js";
import {
  runWeb,
  isProcessRunning,
  readPidFile,
  removePidFile,
  removePortFile,
  waitForProcessExit,
} from "./web.js";
import { buildRefreshPlan, RefreshPlanError } from "./refresh-plan.js";
import { refreshSourcevisionDashboardArtifacts } from "./refresh-artifacts.js";
import {
  snapshotRefreshState,
  validateRefreshCompletion,
  rollbackRefreshState,
} from "./refresh-validate.js";
import {
  formatTypoSuggestion,
  getOrchestratorCommands,
  searchHelp,
  formatSearchResults,
  formatToolHelp,
  formatMainHelp,
  formatOrchestratorCommandHelp,
} from "./help.js";
import { setupClaudeIntegration, printClaudeSetupSummary } from "./claude-integration.js";
import { runExport } from "./export.js";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Map monorepo directory names to npm package names. */
const PKG_NAMES = {
  "packages/rex": "@n-dx/rex",
  "packages/hench": "@n-dx/hench",
  "packages/sourcevision": "@n-dx/sourcevision",
  "packages/web": "@n-dx/web",
};

const _require = createRequire(import.meta.url);

/**
 * Resolve a package's CLI entry point.
 *
 * Strategy:
 * 1. Try the monorepo path (packages/<name>/package.json → bin field).
 *    This is the development / source-checkout path.
 * 2. Fall back to node_modules resolution (npm install path).
 *    Uses require.resolve to find the installed package's CLI entry.
 */
function resolveToolPath(pkgDir) {
  // 1. Monorepo path — works when running from source checkout
  const pkgPath = join(__dir, pkgDir, "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.bin === "string") {
      return join(pkgDir, pkg.bin);
    }
    if (pkg.bin && typeof pkg.bin === "object") {
      const first = Object.values(pkg.bin)[0];
      if (first) return join(pkgDir, first);
    }
  } catch {
    // Not in monorepo — fall through to node_modules resolution
  }

  // 2. node_modules resolution — works when installed from npm
  const npmName = PKG_NAMES[pkgDir];
  if (npmName) {
    try {
      return _require.resolve(npmName + "/dist/cli/index.js");
    } catch {
      // Not installed either — fall through
    }
  }

  return join(pkgDir, "dist/cli/index.js");
}

/**
 * Resolve an arbitrary file within a package — monorepo path first,
 * then node_modules. Used for non-CLI entry points (build.js, dev.js).
 */
function resolvePackageFile(pkgDir, file) {
  const monoPath = join(__dir, pkgDir, file);
  if (existsSync(monoPath)) return join(pkgDir, file);

  const npmName = PKG_NAMES[pkgDir];
  if (npmName) {
    try {
      return _require.resolve(npmName + "/" + file);
    } catch {
      // Not resolvable — fall through
    }
  }

  return join(pkgDir, file);
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

function run(script, args) {
  const scriptPath = isAbsolute(script) ? script : resolve(__dir, script);
  return new Promise((res) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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

/**
 * Detect and cleanly terminate any running dashboard process before refresh.
 *
 * Reads the `.n-dx-web.pid` file, checks if the recorded process is alive, and
 * terminates it gracefully (SIGTERM → SIGKILL fallback) so the refresh does not
 * race against a live server that is serving the files being rebuilt.
 *
 * @param {string} absDir  Absolute project directory (contains `.n-dx-web.pid`)
 * @returns {Promise<{status:"none"|"stale"|"stopped"|"stop-failed", pid?: number, port?: number}>}
 */
async function detectAndCleanConflictingDashboard(absDir) {
  const info = await readPidFile(absDir);
  if (!info) {
    return { status: "none" };
  }

  if (!isProcessRunning(info.pid)) {
    // Stale PID file from a previously crashed/killed server — clean up silently.
    await removePidFile(absDir);
    await removePortFile(absDir);
    return { status: "stale", pid: info.pid, port: info.port };
  }

  // Live process — terminate gracefully.
  const gracePeriodMs = Number(process.env.N_DX_STOP_GRACE_MS ?? 2_000);

  try {
    process.kill(info.pid, "SIGTERM");
  } catch (err) {
    if (err?.code === "EPERM") {
      // No permission to signal the process.
      return { status: "stop-failed", pid: info.pid, port: info.port };
    }
    // ESRCH: process exited between the running-check and the kill — treat as stopped.
    await removePidFile(absDir);
    await removePortFile(absDir);
    return { status: "stopped", pid: info.pid, port: info.port };
  }

  // Wait for graceful exit up to the grace period.
  await waitForProcessExit(info.pid, gracePeriodMs);

  // Escalate to SIGKILL regardless of whether waitForProcessExit timed out.
  // kill(pid, 0) returns success for zombie processes (exited but not yet reaped
  // by their parent), so waitForProcessExit may report a timeout even when the
  // process has effectively exited.  After SIGKILL, a short settle is sufficient —
  // we do not poll again because SIGKILL is unblockable and zombies are already done.
  try {
    process.kill(info.pid, "SIGKILL");
  } catch {
    // Ignore: process is already gone or is a zombie — both are effectively stopped.
  }
  await new Promise((r) => setTimeout(r, 100));

  await removePidFile(absDir);
  await removePortFile(absDir);
  return { status: "stopped", pid: info.pid, port: info.port };
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

// ── Command handlers ─────────────────────────────────────────────────────────

async function handleInit(rest) {
  const providerFromFlag = extractInitProvider(rest);
  if (providerFromFlag !== undefined && !SUPPORTED_PROVIDERS.includes(providerFromFlag)) {
    console.error(`Error: Invalid provider "${providerFromFlag}". Expected one of: codex, claude.`);
    process.exit(1);
  }

  const noClaude = rest.includes("--no-claude");
  const initArgs = stripInitProviderFlag(rest).filter((a) => a !== "--no-claude");
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

  // Claude Code integration (settings, skills, MCP servers)
  if (!noClaude) {
    try {
      const result = setupClaudeIntegration(dir);
      printClaudeSetupSummary(result);
    } catch (err) {
      // Non-fatal — init succeeded even if Claude integration fails
      console.log("");
      console.log(`Claude Code integration: skipped (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  process.exit(0);
}

async function handleAnalyze(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".sourcevision"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.sourcevision, ["analyze", ...flags, dir]);
  process.exit(0);
}

async function handleRecommend(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex", ".sourcevision"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["recommend", ...flags, dir]);
  process.exit(0);
}

async function handleAdd(rest) {
  // Unlike other commands, add's positional args are descriptions, not dirs.
  // Rex's dispatchAdd handles dir resolution internally (resolveSmartAddArgs
  // checks whether the last positional is an existing directory).
  requireInit(process.cwd(), [".rex"]);
  await runOrDie(tools.rex, ["add", ...rest]);
  process.exit(0);
}

async function handlePlan(rest) {
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

/** Execute one refresh pipeline step; returns true on success, false on failure. */
async function runRefreshStep(step, plan, dir, stepStatuses) {
  if (step.kind === "sourcevision-analyze") {
    const code = await run(tools.sourcevision, ["analyze", ...plan.quietFlags, dir]);
    if (code !== 0) {
      const detail = `exit code ${code}`;
      printRefreshStepTransition(step.kind, "failed", detail);
      stepStatuses.push({ kind: step.kind, status: "failed", detail });
      return false;
    }
    printRefreshStepTransition(step.kind, "succeeded");
    stepStatuses.push({ kind: step.kind, status: "succeeded" });
    return true;
  }
  if (step.kind === "sourcevision-pr-markdown") {
    const code = await run(tools.sourcevision, ["pr-markdown", ...plan.quietFlags, dir]);
    if (code !== 0) {
      const detail = `exit code ${code}`;
      printRefreshStepTransition(step.kind, "failed", detail);
      stepStatuses.push({ kind: step.kind, status: "failed", detail });
      return false;
    }
    printRefreshStepTransition(step.kind, "succeeded");
    stepStatuses.push({ kind: step.kind, status: "succeeded" });
    return true;
  }
  if (step.kind === "sourcevision-dashboard-artifacts") {
    refreshSourcevisionDashboardArtifacts(dir);
    printRefreshStepTransition(step.kind, "succeeded");
    stepStatuses.push({ kind: step.kind, status: "succeeded" });
    return true;
  }
  if (step.kind === "web-build") {
    const code = await run(resolvePackageFile("packages/web", "build.js"), []);
    if (code !== 0) {
      const detail = `exit code ${code}`;
      printRefreshStepTransition(step.kind, "failed", detail);
      stepStatuses.push({ kind: step.kind, status: "failed", detail });
      return false;
    }
    printRefreshStepTransition(step.kind, "succeeded");
    stepStatuses.push({ kind: step.kind, status: "succeeded" });
    return true;
  }
  return true;
}

async function handleRefresh(rest) {
  const dir = resolveDir(rest);
  const absDir = resolve(dir);
  const flags = extractFlags(rest);

  // Pre-refresh: detect and stop any conflicting dashboard process so the
  // refresh does not race against a running server rebuilding its own assets.
  const conflict = await detectAndCleanConflictingDashboard(absDir);
  if (conflict.status === "stopped") {
    console.log(
      `Pre-refresh: detected running dashboard (PID ${conflict.pid}, port ${conflict.port}); stopped.`,
    );
  } else if (conflict.status === "stop-failed") {
    console.error(
      `Error: Dashboard server (PID ${conflict.pid}) is running and could not be stopped automatically.`,
    );
    console.error(`Stop it manually: ndx start stop "${absDir}"`);
    process.exit(1);
  }

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

  const stepCount = plan.steps.length;
  console.log(`[refresh] starting — ${stepCount} step${stepCount === 1 ? "" : "s"} planned`);

  // Snapshot current sourcevision state for potential rollback on failure.
  const snapshot = await snapshotRefreshState(dir, plan);
  if (snapshot.fileCount > 0) {
    console.log(
      `[refresh] state snapshot captured (${snapshot.fileCount} file${snapshot.fileCount === 1 ? "" : "s"})`,
    );
  }

  /** Restore snapshotted files and report the outcome to stdout/stderr. */
  async function performRollback() {
    if (snapshot.fileCount === 0) return;
    console.log(
      `[refresh] rollback — restoring pre-refresh state (${snapshot.fileCount} file${snapshot.fileCount === 1 ? "" : "s"})`,
    );
    const result = await rollbackRefreshState(snapshot);
    if (result.restored > 0) {
      console.log(
        `[refresh] rollback complete — ${result.restored} file${result.restored === 1 ? "" : "s"} restored`,
      );
    }
    if (result.failed > 0) {
      console.error(
        `[refresh] rollback partial — ${result.failed} file${result.failed === 1 ? "" : "s"} could not be restored`,
      );
      for (const err of result.errors) {
        console.error(`  ${err}`);
      }
    }
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
      const succeeded = await runRefreshStep(step, plan, dir, stepStatuses);
      if (!succeeded) {
        await performRollback();
        printRefreshStepSummary(stepStatuses);
        process.exit(1);
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      printRefreshStepTransition(step.kind, "failed", detail);
      stepStatuses.push({ kind: step.kind, status: "failed", detail });
      await performRollback();
      printRefreshStepSummary(stepStatuses);
      process.exit(1);
    }
  }

  // Validate all step outputs before marking the operation complete.
  console.log(`[refresh] validating — confirming all outputs are present`);
  const validation = validateRefreshCompletion(dir, plan);
  if (!validation.valid) {
    console.error(`[refresh] validation failed — outputs incomplete or invalid:`);
    for (const issue of validation.issues) {
      console.error(`  ${issue}`);
    }
    await performRollback();
    printRefreshStepSummary(stepStatuses);
    process.exit(1);
  }

  printRefreshStepSummary(stepStatuses);
  console.log(`[refresh] completed — all outputs validated`);
  const reload = await signalLiveReload(dir);
  console.log(reload.message);
  process.exit(0);
}

async function handleWork(rest) {
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
      console.error("Hint: Run 'ndx config llm.vendor claude' or 'ndx config llm.vendor codex' to configure a vendor.");
      process.exit(1);
    }
  }

  await runOrDie(tools.hench, ["run", ...flags, dir]);
  process.exit(0);
}

async function handleStatus(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["status", ...flags, dir]);
  process.exit(0);
}

async function handleUsage(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["usage", ...flags, dir]);
  process.exit(0);
}

async function handleSync(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["sync", ...flags, dir]);
  process.exit(0);
}

async function handleCI(rest) {
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

async function handleDev(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".sourcevision"]);
  const flags = extractFlags(rest);
  const code = await run(resolvePackageFile("packages/web", "dev.js"), [...flags, dir]);
  process.exit(code);
}

async function handleStart(rest, commandName = "start") {
  const dir = resolveDir(rest);
  try {
    const code = await runWeb(dir, rest, { run, tools, __dir, commandName });
    process.exit(code);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }
}

/**
 * Spawn a tool and capture its stdout (instead of inheriting it).
 * Returns { code, stdout }.
 */
function runCapture(script, args) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [resolve(__dir, script), ...args], {
      stdio: ["inherit", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => res({ code: code ?? 1, stdout }));
  });
}

async function handleSelfHeal(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex", ".hench", ".sourcevision"]);

  const vendor = readLLMVendor(dir);
  if (!vendor) {
    console.error("Error: No LLM vendor configured for this project.");
    console.error("Hint: Run 'ndx config llm.vendor claude' or 'ndx config llm.vendor codex' to configure a vendor.");
    process.exit(1);
  }

  // Parse iteration count from positional args (e.g. `ndx self-heal 3 .` or `ndx self-heal . 3`)
  const positionals = rest.filter((a) => !a.startsWith("-"));
  const iterCount = positionals.reduce((found, arg) => {
    const n = parseInt(arg, 10);
    return !isNaN(n) && n > 0 ? n : found;
  }, 1);

  console.log(`[self-heal] starting ${iterCount} iteration${iterCount === 1 ? "" : "s"}`);

  let prevFindingCount = Infinity;

  for (let i = 1; i <= iterCount; i++) {
    console.log(`\n[self-heal] ── iteration ${i}/${iterCount} ──\n`);

    console.log("[self-heal] step 1/5: sourcevision analyze --deep --full");
    await runOrDie(tools.sourcevision, ["analyze", "--deep", "--full", dir]);

    console.log("\n[self-heal] step 2/5: rex recommend --actionable-only");
    await runOrDie(tools.rex, ["recommend", "--actionable-only", dir]);

    console.log("\n[self-heal] step 3/5: rex recommend --actionable-only --accept");
    await runOrDie(tools.rex, ["recommend", "--actionable-only", "--accept", dir]);

    console.log("\n[self-heal] step 4/5: hench run --auto --loop --self-heal");
    await runOrDie(tools.hench, ["run", "--auto", "--loop", "--self-heal", dir]);

    console.log("\n[self-heal] step 5/5: acknowledge completed findings");
    await runOrDie(tools.rex, ["recommend", "--acknowledge-completed", dir]);

    // Check progress: count remaining findings
    const { code, stdout } = await runCapture(tools.rex, ["recommend", "--actionable-only", "--format=json", dir]);
    if (code === 0 && stdout.trim()) {
      try {
        const remaining = JSON.parse(stdout.trim());
        const currentCount = remaining.filter(r => r.level === "task").reduce((sum, r) => sum + (r.meta?.findingCount ?? 0), 0);

        if (currentCount === 0) {
          console.log(`\n[self-heal] all findings resolved after iteration ${i}.`);
          break;
        }
        if (currentCount >= prevFindingCount) {
          console.log(`\n[self-heal] no improvement after iteration ${i} (${currentCount} findings remaining). Stopping.`);
          break;
        }
        console.log(`\n[self-heal] ${currentCount} findings remaining (was ${prevFindingCount === Infinity ? "unknown" : prevFindingCount}).`);
        prevFindingCount = currentCount;
      } catch {
        // JSON parse failed — continue without progress tracking
      }
    }
  }

  console.log(`\n[self-heal] completed`);
  process.exit(0);
}

async function handleExport(rest) {
  try {
    const code = await runExport(rest);
    process.exit(code);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }
}

async function handleConfig(rest) {
  try {
    await runConfig(rest);
  } catch (err) {
    console.error(formatError(err));
    process.exit(1);
  }
}

function handleHelp(rest) {
  const query = rest.filter((a) => !a.startsWith("-")).join(" ");
  if (!query) {
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

function handleUnknownCommand(command) {
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

function showMainHelp() {
  console.log(formatMainHelp());
}

// ── Module-level setup ───────────────────────────────────────────────────────

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

// Catch unhandled errors at the top level — never show stack traces
process.on("uncaughtException", (err) => {
  console.error(formatError(err));
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error(formatError(err));
  process.exit(1);
});

// ── Main dispatch ────────────────────────────────────────────────────────────

await main();

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  // ── Per-command --help ──────────────────────────────────────────────────
  const hasHelp = rest.some((a) => a === "--help" || a === "-h");
  if (hasHelp && command && showCommandHelp(command)) {
    process.exit(0);
  }

  // ── Dispatch to command handler ─────────────────────────────────────────
  switch (command) {
    case "help":      return handleHelp(rest);
    case "init":      return handleInit(rest);
    case "analyze":   return handleAnalyze(rest);
    case "recommend": return handleRecommend(rest);
    case "plan":      return handlePlan(rest);
    case "add":       return handleAdd(rest);
    case "refresh":   return handleRefresh(rest);
    case "work":      return handleWork(rest);
    case "status":  return handleStatus(rest);
    case "usage":   return handleUsage(rest);
    case "sync":    return handleSync(rest);
    case "ci":      return handleCI(rest);
    case "dev":     return handleDev(rest);
    case "start":   return handleStart(rest, "start");
    case "web":     return handleStart(rest, "web");
    case "export":    return handleExport(rest);
    case "config":    return handleConfig(rest);
    case "self-heal": return handleSelfHeal(rest);
  }

  // ── Tool delegation ───────────────────────────────────────────────────────
  if (tools[command]) {
    const code = await run(tools[command], rest);
    process.exit(code);
  }

  // ── Unknown command or no command ─────────────────────────────────────────
  if (command) {
    return handleUnknownCommand(command);
  }

  showMainHelp();
  process.exit(0);
}

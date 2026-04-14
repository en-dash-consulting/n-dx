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
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { dirname, isAbsolute, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline/promises";
import { runConfig, loadProjectConfig, repairProjectConfig } from "./config.js";
import { resolveCommandTimeout, withCommandTimeout } from "./cli-timeout.js";
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

const CLI_ERROR_CODES = Object.freeze({
  NOT_INITIALIZED: "NDX_CLI_NOT_INITIALIZED",
  UNKNOWN_COMMAND: "NDX_CLI_UNKNOWN_COMMAND",
});
import {
  formatTypoSuggestion,
  getOrchestratorCommands,
  searchHelp,
  formatSearchResults,
  formatToolHelp,
  formatMainHelp,
  formatOrchestratorCommandHelp,
} from "./help.js";
import { setupClaudeIntegration, printClaudeSetupSummary, formatClaudeCliNotFoundError } from "./claude-integration.js";
import {
  formatInitBanner,
  formatRecap,
  createSpinner,
  INIT_PHASES,
} from "./cli-brand.js";
import { runExport } from "./export.js";
import {
  createChildProcessTracker,
  installTrackedChildProcessHandlers,
} from "./child-lifecycle.js";
import { startUpdateCheck, formatUpdateNotice } from "./update-check.js";
import { checkProjectStaleness, formatStalenessNotice } from "./stale-check.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dir, "../..");

/** Map monorepo directory names to npm package names. */
const PKG_NAMES = {
  "packages/rex": "@n-dx/rex",
  "packages/hench": "@n-dx/hench",
  "packages/sourcevision": "@n-dx/sourcevision",
  "packages/web": "@n-dx/web",
};

const _require = createRequire(import.meta.url);

const SILENCED_DEPRECATION_CODES = new Set(["DEP0040"]);
const FILTER_INSTALLED = Symbol.for("n-dx.core.suppressKnownDeprecations.installed");

function suppressKnownDeprecations() {
  if (process[FILTER_INSTALLED]) {
    return;
  }

  const original = process.emitWarning;
  process.emitWarning = function filteredEmitWarning(warning, typeOrOptions, code, ctor) {
    let effectiveCode;
    let effectiveType;

    if (typeOrOptions && typeof typeOrOptions === "object") {
      effectiveCode = typeOrOptions.code;
      effectiveType = typeOrOptions.type;
    } else {
      effectiveType = typeof typeOrOptions === "string" ? typeOrOptions : undefined;
      effectiveCode = code;
    }

    if (
      effectiveType === "DeprecationWarning" &&
      effectiveCode !== undefined &&
      SILENCED_DEPRECATION_CODES.has(effectiveCode)
    ) {
      return;
    }

    Reflect.apply(original, process, [warning, typeOrOptions, code, ctor]);
  };

  process[FILTER_INSTALLED] = true;
}

let colorEnabled = null;

function supportsColor() {
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0") {
    return true;
  }
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") {
    return false;
  }
  return Boolean(process.stdout && process.stdout.isTTY);
}

function isColorEnabled() {
  if (colorEnabled === null) {
    colorEnabled = supportsColor();
  }
  return colorEnabled;
}

function ansi(code, text, reset) {
  if (!isColorEnabled()) return text;
  return `\x1b[${code}m${text}\x1b[${reset}m`;
}

function bold(text) {
  return ansi("1", text, "22");
}

function dim(text) {
  return ansi("2", text, "22");
}

function cyan(text) {
  return ansi("36", text, "39");
}

function yellow(text) {
  return ansi("33", text, "39");
}

function green(text) {
  return ansi("32", text, "39");
}

function red(text) {
  return ansi("31", text, "39");
}

suppressKnownDeprecations();

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
  // 1. Monorepo path — works when running from source checkout or npm link
  const pkgPath = join(MONOREPO_ROOT, pkgDir, "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.bin === "string") {
      return join(MONOREPO_ROOT, pkgDir, pkg.bin);
    }
    if (pkg.bin && typeof pkg.bin === "object") {
      const first = Object.values(pkg.bin)[0];
      if (first) return join(MONOREPO_ROOT, pkgDir, first);
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

  return join(MONOREPO_ROOT, pkgDir, "dist/cli/index.js");
}

/**
 * Resolve an arbitrary file within a package — monorepo path first,
 * then node_modules. Used for non-CLI entry points (build.js, dev.js).
 */
function resolvePackageFile(pkgDir, file) {
  const monoPath = join(MONOREPO_ROOT, pkgDir, file);
  if (existsSync(monoPath)) return monoPath;

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
  const errorLabel = red("Error:");
  // If the error already has a suggestion (e.g. from a CLIError-like object), use it
  if (err && err.suggestion) {
    return `${errorLabel} ${message}\nHint: ${err.suggestion}`;
  }
  for (const [pattern, suggestion] of ERROR_HINTS) {
    if (pattern.test(message)) {
      return `${errorLabel} ${message}\nHint: ${suggestion}`;
    }
  }
  return `${errorLabel} ${message}`;
}

class ExitRequest extends Error {
  constructor(code) {
    super(`Exit requested with code ${code}`);
    this.code = code;
  }
}

const childTracker = createChildProcessTracker({ processGroups: true });
let exitPromise = null;

/**
 * Background update-check promise started early in main(). flushAndExit()
 * races it against a short timeout to display the notice without delaying exit.
 */
let pendingUpdateCheck = null;

/** True when the user passed --quiet / -q — update notice is suppressed. */
let updateCheckQuiet = false;

/**
 * Stale-check result set before command dispatch.
 * null = check not run (init/help/version commands, or quiet mode).
 * @type {import("./stale-check.js").StaleDetail[] | null}
 */
let staleCheckResult = null;

/**
 * The n-dx version recorded in .n-dx.json at last init, if available.
 * Used to display "initialized with n-dx X.Y" in the staleness notice.
 * @type {string | null}
 */
let staleCheckInitVersion = null;

/**
 * Commands that skip the stale check — either they have no project context
 * (help, version) or they are about to fix staleness (init).
 */
const STALE_CHECK_SKIP_COMMANDS = new Set(["init", "help", "version"]);

/**
 * On POSIX systems, spawn each child with `detached: true` so it becomes the
 * leader of a new process group.  This lets the process-group-aware tracker
 * kill grandchildren (spawned by the child) by signalling `-pgid` instead of
 * only the direct child PID.  On Windows the flag is omitted — process groups
 * are not supported and detached mode has different semantics there.
 */
const SPAWN_DETACHED = process.platform !== "win32" ? { detached: true } : {};

function spawnTracked(command, args, options) {
  return childTracker.register(spawn(command, args, { ...SPAWN_DETACHED, ...options }));
}

function exitWithCleanup(code = 0) {
  throw new ExitRequest(code);
}

async function flushAndExit(code = 0) {
  if (!exitPromise) {
    exitPromise = (async () => {
      signalHandlers.dispose();
      await childTracker.cleanup();

      // Show update notice when a newer version is available.
      // Race against 500 ms so a slow or firewalled network never delays exit.
      // Written to stderr so JSON stdout output stays machine-parseable.
      if (code === 0 && !updateCheckQuiet && pendingUpdateCheck) {
        try {
          const updateInfo = await Promise.race([
            pendingUpdateCheck,
            new Promise((r) => setTimeout(() => r(null), 500)),
          ]);
          if (updateInfo) {
            process.stderr.write(formatUpdateNotice(updateInfo) + "\n");
          }
        } catch {
          // Never block exit for update-check errors.
        }
      }

      // Show staleness notice when the project setup is incomplete or outdated.
      // Written to stderr so JSON stdout output stays machine-parseable.
      if (code === 0 && !updateCheckQuiet && staleCheckResult && staleCheckResult.length > 0) {
        try {
          process.stderr.write(
            formatStalenessNotice(staleCheckResult, { initVersion: staleCheckInitVersion }) + "\n",
          );
        } catch {
          // Never block exit for stale-check display errors.
        }
      }

      // Drain stdout/stderr before exiting so piped output isn't truncated
      await new Promise((resolve) => {
        const done = () => { if (--pending === 0) resolve(); };
        let pending = 2;
        if (process.stdout.writableFinished) done(); else process.stdout.end(done);
        if (process.stderr.writableFinished) done(); else process.stderr.end(done);
      });
      process.exit(code);
    })();
  }

  return exitPromise;
}

function run(script, args) {
  const scriptPath = isAbsolute(script) ? script : resolve(MONOREPO_ROOT, script);
  return new Promise((res) => {
    const child = spawnTracked(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
    });
    child.on("close", (code) => res(code ?? 1));
  });
}

async function runOrDie(script, args) {
  const code = await run(script, args);
  if (code !== 0) exitWithCleanup(code);
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

// showInitBanner is now handled by createInitUI().printBanner()

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
 * Record the current @n-dx/core version in .n-dx.json as `_initVersion`.
 * Called at the end of `ndx init` so subsequent stale-check runs can
 * report which version the project was initialized with.
 * Errors are silently ignored — this is best-effort metadata.
 *
 * @param {string} dir  Project root directory.
 * @param {string} version  Current @n-dx/core version string.
 */
function recordInitVersion(dir, version) {
  const configPath = join(dir, ".n-dx.json");
  try {
    let data = {};
    if (existsSync(configPath)) {
      try { data = JSON.parse(readFileSync(configPath, "utf-8")); } catch { /* ignore */ }
    }
    data._initVersion = version;
    writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal — failure to record version doesn't affect init outcome.
  }
}

/**
 * Check that required directories exist before running orchestration commands.
 * Provides a clear, actionable error message suggesting `ndx init`.
 */
function requireInit(dir, dirs) {
  const missing = dirs.filter((d) => !existsSync(join(dir, d)));
  if (missing.length > 0) {
    console.error(`Error: [${CLI_ERROR_CODES.NOT_INITIALIZED}] Missing ${missing.join(", ")} in ${dir}`);
    console.error(`Hint: Run 'ndx init ${dir === process.cwd() ? "" : dir}' to set up the project.`.trimEnd());
    exitWithCleanup(1);
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
  const prefix = `${cyan("[refresh]")} ${bold(kind)} ->`;
  if (status === "skipped") {
    console.log(`${prefix} ${dim(`skipped (${detail})`)}`);
    return;
  }
  if (status === "failed") {
    console.log(`${prefix} ${red(`failed (${detail})`)}`);
    return;
  }
  console.log(`${prefix} ${status}`);
}

function printRefreshStepSummary(stepStatuses) {
  const combined = [...stepStatuses]
    .sort((a, b) => (REFRESH_STEP_ORDER[a.kind] ?? 99) - (REFRESH_STEP_ORDER[b.kind] ?? 99));

  console.log(bold("Refresh step summary:"));
  for (const step of combined) {
    if (step.status === "succeeded") {
      console.log(`- ${step.kind}: ${green("succeeded")}`);
      continue;
    }
    if (step.status === "failed") {
      console.log(`- ${step.kind}: ${red(`failed (${step.detail})`)}`);
      continue;
    }
    console.log(`- ${step.kind}: ${dim(`skipped (${step.detail})`)}`);
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

function handleVersion(rest) {
  const { version } = JSON.parse(readFileSync(join(__dir, "package.json"), "utf-8"));
  if (rest.includes("--json")) {
    console.log(JSON.stringify({ version }));
  } else {
    console.log(version);
  }
  exitWithCleanup(0);
}

/**
 * Run a sub-package init command, capturing output instead of streaming it.
 * Returns { code, stdout, stderr }.
 */
function runInitCapture(toolPath, args) {
  return new Promise((resolve) => {
    const child = spawnTracked("node", [toolPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function handleInit(rest) {
  const providerFromFlag = extractInitProvider(rest);
  if (providerFromFlag !== undefined && !SUPPORTED_PROVIDERS.includes(providerFromFlag)) {
    console.error(`Error: Invalid provider "${providerFromFlag}". Expected one of: codex, claude.`);
    exitWithCleanup(1);
  }

  const noClaude = rest.includes("--no-claude");
  const initArgs = stripInitProviderFlag(rest).filter((a) => a !== "--no-claude");
  const dir = resolveDir(initArgs);
  const flags = extractFlags(initArgs);
  const quiet = flags.includes("--quiet") || flags.includes("-q");

  // Repair known-numeric config values that may have been stored as strings
  // by earlier versions (e.g. cli.timeouts.work = "14400000"). Runs before
  // anything reads the config so sub-package inits see well-typed values.
  try {
    const { repairs } = await repairProjectConfig(dir);
    if (repairs.length > 0 && !quiet) {
      console.log(`Repaired ${repairs.length} config value${repairs.length === 1 ? "" : "s"} in .n-dx.json:`);
      for (const { path, from, to } of repairs) {
        console.log(`  ${path}: "${from}" → ${to}`);
      }
    }
  } catch {
    // Non-fatal — repair failure never blocks init.
  }

  // Check for existing provider config before prompting
  const existingVendor = readLLMVendor(dir);
  let selectedProvider;
  let providerSource;

  if (providerFromFlag) {
    selectedProvider = providerFromFlag;
    providerSource = "from --provider flag";
  } else if (existingVendor) {
    selectedProvider = existingVendor;
    providerSource = "from existing config";
  } else {
    // First run — show static banner and prompt for provider
    console.log(formatInitBanner());
    selectedProvider = await promptInitProvider();
    providerSource = "selected";
  }

  if (!selectedProvider) {
    console.error("Init cancelled: no provider selected. Re-run 'ndx init' and choose 'codex' or 'claude'.");
    exitWithCleanup(1);
  }

  // ── Ink animated UI (TTY) vs static fallback (non-TTY / quiet) ────
  const useTUI = !quiet && process.stdout.isTTY;

  if (useTUI) {
    let inkResult;
    try {
      const { renderInit } = await import("./cli-ink.js");
      inkResult = await renderInit({
        dir,
        flags,
        provider: selectedProvider,
        providerSource,
        noClaude,
        tools,
        runInitCapture,
        runConfig,
        setupClaudeIntegration,
      });
    } catch (err) {
      // Ink failed — fall through to static fallback
      console.error(err.message || err);
    }
    if (inkResult) {
      if (inkResult.code !== 0) {
        if (inkResult.error) console.error(inkResult.error);
        exitWithCleanup(1);
      }
      try {
        const { version } = JSON.parse(readFileSync(join(__dir, "package.json"), "utf-8"));
        recordInitVersion(dir, version);
      } catch { /* non-fatal */ }
      exitWithCleanup(0);
    }
  }

  // ── Static fallback (non-TTY or --quiet) ──────────────────────────
  const svExists = existsSync(join(dir, ".sourcevision"));
  const rexExists = existsSync(join(dir, ".rex"));
  const henchExists = existsSync(join(dir, ".hench"));

  async function staticPhase(name, work, detail) {
    const phase = INIT_PHASES[name];
    if (!quiet) {
      const spinner = createSpinner(phase.spinner);
      spinner.start();
      const result = await work();
      if (result.code !== 0) {
        spinner.fail(`${name} failed`);
        console.error(result.stderr || result.stdout);
        exitWithCleanup(1);
      }
      spinner.success(phase.success, detail);
    } else {
      const result = await work();
      if (result.code !== 0) {
        console.error(result.stderr || result.stdout);
        exitWithCleanup(1);
      }
    }
  }

  await staticPhase("sourcevision",
    async () => {
      const initResult = await runInitCapture(tools.sourcevision, ["init", ...flags, dir]);
      if (initResult.code !== 0) return initResult;
      return runInitCapture(tools.sourcevision, ["analyze", "--fast", ...flags, dir]);
    },
    svExists ? "reused — .sourcevision/ already present" : undefined);
  await staticPhase("rex",
    () => runInitCapture(tools.rex, ["init", ...flags, dir]),
    rexExists ? "reused — .rex/ already present" : undefined);
  await staticPhase("hench",
    () => runInitCapture(tools.hench, ["init", ...flags, dir]),
    henchExists ? "reused — .hench/ already present" : undefined);

  const origLog = console.log;
  console.log = () => {};
  try { await runConfig(["llm.vendor", selectedProvider, dir]); } finally { console.log = origLog; }

  let claudeSummary = "skipped";
  if (!noClaude) {
    let claudeResult;
    try {
      claudeResult = setupClaudeIntegration(dir);
    } catch (err) {
      console.error(formatError(err));
      exitWithCleanup(1);
    }
    if (!claudeResult.mcp.registered && claudeResult.mcp.searched) {
      console.error(formatClaudeCliNotFoundError(claudeResult.mcp.searched));
      exitWithCleanup(1);
    }
    claudeSummary = `${claudeResult.skills.written} skills, ${claudeResult.settings.total} permissions`;
  }

  // Record the current n-dx version so future stale-check runs can report it.
  try {
    const { version } = JSON.parse(readFileSync(join(__dir, "package.json"), "utf-8"));
    recordInitVersion(dir, version);
  } catch { /* non-fatal */ }

  if (quiet) {
    console.log("n-dx initialized");
  } else {
    console.log(formatRecap({
      sourcevision: svExists ? "already exists (reused)" : "created",
      rex: rexExists ? "already exists (reused)" : "created",
      hench: henchExists ? "already exists (reused)" : "created",
      provider: `${selectedProvider} (${providerSource})`,
      claudeCode: claudeSummary,
    }));
  }

  exitWithCleanup(0);
}

async function handleAnalyze(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".sourcevision"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.sourcevision, ["analyze", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleRecommend(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex", ".sourcevision"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["recommend", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleAdd(rest) {
  // Unlike other commands, add's positional args are descriptions, not dirs.
  // Rex's dispatchAdd handles dir resolution internally (resolveSmartAddArgs
  // checks whether the last positional is an existing directory).
  requireInit(process.cwd(), [".rex"]);
  await runOrDie(tools.rex, ["add", ...rest]);
  exitWithCleanup(0);
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
  exitWithCleanup(0);
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
    exitWithCleanup(1);
  }

  let plan;
  try {
    plan = buildRefreshPlan(flags);
  } catch (err) {
    if (err instanceof RefreshPlanError) {
      console.error(`Error: ${err.message}`);
      if (err.suggestion) console.error(`Hint: ${err.suggestion}`);
      exitWithCleanup(1);
    }
    throw err;
  }

  if (plan.needsSourcevisionDir) {
    requireInit(dir, [".sourcevision"]);
  }

  const rfTag = cyan("[refresh]");
  const stepCount = plan.steps.length;
  console.log(`${rfTag} starting — ${bold(String(stepCount))} step${stepCount === 1 ? "" : "s"} planned`);

  // Snapshot current sourcevision state for potential rollback on failure.
  const snapshot = await snapshotRefreshState(dir, plan);
  if (snapshot.fileCount > 0) {
    console.log(
      `${rfTag} state snapshot captured (${snapshot.fileCount} file${snapshot.fileCount === 1 ? "" : "s"})`,
    );
  }

  /** Restore snapshotted files and report the outcome to stdout/stderr. */
  async function performRollback() {
    if (snapshot.fileCount === 0) return;
    console.log(
      `${rfTag} ${yellow("rollback")} — restoring pre-refresh state (${snapshot.fileCount} file${snapshot.fileCount === 1 ? "" : "s"})`,
    );
    const result = await rollbackRefreshState(snapshot);
    if (result.restored > 0) {
      console.log(
        `${rfTag} rollback complete — ${green(`${result.restored} file${result.restored === 1 ? "" : "s"} restored`)}`,
      );
    }
    if (result.failed > 0) {
      console.error(
        `${rfTag} ${red(`rollback partial — ${result.failed} file${result.failed === 1 ? "" : "s"} could not be restored`)}`,
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
        exitWithCleanup(1);
      }
    } catch (err) {
      if (err instanceof ExitRequest) throw err;
      const detail = err instanceof Error ? err.message : String(err);
      printRefreshStepTransition(step.kind, "failed", detail);
      stepStatuses.push({ kind: step.kind, status: "failed", detail });
      await performRollback();
      printRefreshStepSummary(stepStatuses);
      exitWithCleanup(1);
    }
  }

  // Validate all step outputs before marking the operation complete.
  console.log(`${rfTag} validating — confirming all outputs are present`);
  const validation = validateRefreshCompletion(dir, plan);
  if (!validation.valid) {
    console.error(`${rfTag} ${red("validation failed")} — outputs incomplete or invalid:`);
    for (const issue of validation.issues) {
      console.error(`  ${issue}`);
    }
    await performRollback();
    printRefreshStepSummary(stepStatuses);
    exitWithCleanup(1);
  }

  printRefreshStepSummary(stepStatuses);
  console.log(`${rfTag} ${green("completed")} — all outputs validated`);
  const reload = await signalLiveReload(dir);
  console.log(reload.message);
  exitWithCleanup(0);
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
      exitWithCleanup(1);
    }
  }

  await runOrDie(tools.hench, ["run", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleStatus(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["status", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleUsage(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["usage", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleSync(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["sync", ...flags, dir]);
  exitWithCleanup(0);
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
    const ok = await runCI(dir, flags, { run, tools, spawnTracked });
    exitWithCleanup(ok ? 0 : 1);
  } catch (err) {
    if (err instanceof ExitRequest) throw err;
    console.error(formatError(err));
    exitWithCleanup(1);
  }
}

async function handleDev(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".sourcevision"]);
  const flags = extractFlags(rest);
  const code = await run(resolvePackageFile("packages/web", "dev.js"), [...flags, dir]);
  exitWithCleanup(code);
}

async function handleStart(rest, commandName = "start") {
  const dir = resolveDir(rest);
  try {
    const code = await runWeb(dir, rest, {
      exit: exitWithCleanup,
      flushExit: flushAndExit,
      run,
      tools,
      __dir: MONOREPO_ROOT,
      commandName,
    });
    exitWithCleanup(code);
  } catch (err) {
    if (err instanceof ExitRequest) throw err;
    console.error(formatError(err));
    exitWithCleanup(1);
  }
}

/**
 * Spawn a tool and capture its stdout (instead of inheriting it).
 * Returns { code, stdout }.
 */
function runCapture(script, args) {
  return new Promise((res) => {
    const child = spawnTracked(process.execPath, [resolve(MONOREPO_ROOT, script), ...args], {
      stdio: ["inherit", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => res({ code: code ?? 1, stdout }));
  });
}

/**
 * Read file-level code health metrics for self-heal regression detection.
 * These are zone-independent signals that don't fluctuate with zone reassignment.
 */
function readCodeHealthMetrics(dir) {
  try {
    const svDir = resolve(dir, ".sourcevision");
    let circularDeps = 0;
    let codeFindingCount = 0;
    let unusedExports = 0;

    // Circular dependency count from imports.json
    try {
      const importsData = JSON.parse(readFileSync(resolve(svDir, "imports.json"), "utf-8"));
      circularDeps = importsData.summary?.circularCount ?? 0;
    } catch { /* imports.json may not exist */ }

    // Code-category finding count from zones.json
    try {
      const zonesData = JSON.parse(readFileSync(resolve(svDir, "zones.json"), "utf-8"));
      const findings = zonesData.findings ?? [];
      codeFindingCount = findings.filter(
        (f) => f.category === "code" && (f.severity === "warning" || f.severity === "critical")
      ).length;
    } catch { /* zones.json may not exist */ }

    // Unused export count from callgraph.json
    try {
      const callgraphData = JSON.parse(readFileSync(resolve(svDir, "callgraph.json"), "utf-8"));
      unusedExports = callgraphData.summary?.unusedExportCount ?? 0;
    } catch { /* callgraph.json may not exist */ }

    return { circularDeps, codeFindingCount, unusedExports };
  } catch {
    return null;
  }
}

/**
 * Read zone metrics for informational logging (not used as termination signals).
 */
function readZoneMetrics(dir) {
  try {
    const zonesPath = resolve(dir, ".sourcevision", "zones.json");
    const data = JSON.parse(readFileSync(zonesPath, "utf-8"));
    const zones = data.zones ?? [];
    if (zones.length === 0) return null;

    let totalFiles = 0;
    let weightedCohesion = 0;
    for (const z of zones) {
      const fileCount = z.files?.length ?? 0;
      totalFiles += fileCount;
      weightedCohesion += (z.cohesion ?? 0) * fileCount;
    }

    return {
      weightedCohesion: totalFiles > 0 ? Math.round((weightedCohesion / totalFiles) * 1000) / 1000 : 0,
      zoneCount: zones.length,
    };
  } catch {
    return null;
  }
}

async function handleSelfHeal(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex", ".hench", ".sourcevision"]);

  const vendor = readLLMVendor(dir);
  if (!vendor) {
    console.error("Error: No LLM vendor configured for this project.");
    console.error("Hint: Run 'ndx config llm.vendor claude' or 'ndx config llm.vendor codex' to configure a vendor.");
    exitWithCleanup(1);
  }

  // Parse iteration count from positional args (e.g. `ndx self-heal 3 .` or `ndx self-heal . 3`)
  const positionals = rest.filter((a) => !a.startsWith("-"));
  const iterCount = positionals.reduce((found, arg) => {
    const n = parseInt(arg, 10);
    return !isNaN(n) && n > 0 ? n : found;
  }, 1);

  // --include-structural opts in to structural findings; excluded by default
  const includeStructural = rest.includes("--include-structural");
  const structuralFlag = includeStructural ? [] : ["--exclude-structural"];

  const shTag = cyan("[self-heal]");
  console.log(`${shTag} starting ${bold(String(iterCount))} iteration${iterCount === 1 ? "" : "s"}${includeStructural ? "" : dim(" (excluding structural findings)")}`);

  let prevFindingCount = Infinity;
  let baselineHealth = readCodeHealthMetrics(dir);

  for (let i = 1; i <= iterCount; i++) {
    console.log(`\n${shTag} ${bold(`── iteration ${i}/${iterCount} ──`)}\n`);

    console.log(`${shTag} step 1/5: sourcevision analyze --deep --full`);
    await runOrDie(tools.sourcevision, ["analyze", "--deep", "--full", dir]);

    // Regression guard: compare file-level code health metrics to baseline
    const currentHealth = readCodeHealthMetrics(dir);
    if (baselineHealth && currentHealth && i > 1) {
      const circularDelta = currentHealth.circularDeps - baselineHealth.circularDeps;
      const codeFindingDelta = currentHealth.codeFindingCount - baselineHealth.codeFindingCount;
      const totalBefore = baselineHealth.circularDeps + baselineHealth.codeFindingCount + baselineHealth.unusedExports;
      const totalAfter = currentHealth.circularDeps + currentHealth.codeFindingCount + currentHealth.unusedExports;

      if (circularDelta > 0) {
        console.log(`\n${shTag} ${red(`REGRESSION DETECTED after iteration ${i}:`)}`);
        console.log(`  circular deps: ${baselineHealth.circularDeps} → ${currentHealth.circularDeps} (+${circularDelta})`);
        console.log(`  code findings: ${baselineHealth.codeFindingCount} → ${currentHealth.codeFindingCount}`);
        console.log(`  ${red("Aborting self-heal — new circular dependencies introduced.")}`);
        break;
      }

      if (totalAfter > totalBefore) {
        console.log(`\n${shTag} ${red(`REGRESSION DETECTED after iteration ${i}:`)}`);
        console.log(`  code health issues: ${totalBefore} → ${totalAfter} (+${totalAfter - totalBefore})`);
        console.log(`    circular deps:  ${baselineHealth.circularDeps} → ${currentHealth.circularDeps}`);
        console.log(`    code findings:  ${baselineHealth.codeFindingCount} → ${currentHealth.codeFindingCount}`);
        console.log(`    unused exports: ${baselineHealth.unusedExports} → ${currentHealth.unusedExports}`);
        console.log(`  ${red("Aborting self-heal — code health degraded instead of improving.")}`);
        break;
      }

      // Log zone metrics for information (not used as termination signals)
      const zoneInfo = readZoneMetrics(dir);
      const zoneStr = zoneInfo ? `, zones: ${zoneInfo.zoneCount} (cohesion ${zoneInfo.weightedCohesion})` : "";
      console.log(`${shTag} code health: ${totalBefore} → ${totalAfter} issues (circular: ${currentHealth.circularDeps}, findings: ${currentHealth.codeFindingCount}, unused: ${currentHealth.unusedExports})${zoneStr}`);
    }
    // Update baseline for next iteration
    if (currentHealth) baselineHealth = currentHealth;

    console.log(`\n${shTag} step 2/5: rex recommend --actionable-only`);
    await runOrDie(tools.rex, ["recommend", "--actionable-only", ...structuralFlag, dir]);

    console.log(`\n${shTag} step 3/5: rex recommend --actionable-only --accept`);
    await runOrDie(tools.rex, ["recommend", "--actionable-only", "--accept", ...structuralFlag, dir]);

    console.log(`\n${shTag} step 4/5: hench run --auto --loop --self-heal`);
    await runOrDie(tools.hench, ["run", "--auto", "--loop", "--self-heal", dir]);

    console.log(`\n${shTag} step 5/5: acknowledge completed findings`);
    await runOrDie(tools.rex, ["recommend", "--acknowledge-completed", dir]);

    // Check progress: count remaining findings (same filter as accept step)
    const { code, stdout } = await runCapture(tools.rex, ["recommend", "--actionable-only", ...structuralFlag, "--format=json", dir]);
    if (code === 0 && stdout.trim()) {
      try {
        const remaining = JSON.parse(stdout.trim());
        const currentCount = remaining.filter(r => r.level === "task").reduce((sum, r) => sum + (r.meta?.findingCount ?? 0), 0);

        if (currentCount === 0) {
          console.log(`\n${shTag} ${green("all findings resolved")} after iteration ${i}.`);
          break;
        }
        if (currentCount >= prevFindingCount) {
          console.log(`\n${shTag} ${yellow(`no improvement after iteration ${i} (${currentCount} findings remaining). Stopping.`)}`);
          break;
        }
        console.log(`\n${shTag} ${currentCount} findings remaining (was ${prevFindingCount === Infinity ? "unknown" : prevFindingCount}).`);
        prevFindingCount = currentCount;
      } catch {
        // JSON parse failed — continue without progress tracking
      }
    }
  }

  console.log(`\n${shTag} ${green("completed")}`);
  exitWithCleanup(0);
}

async function handleExport(rest) {
  try {
    const code = await runExport(rest);
    exitWithCleanup(code);
  } catch (err) {
    if (err instanceof ExitRequest) throw err;
    console.error(formatError(err));
    exitWithCleanup(1);
  }
}

async function handleConfig(rest) {
  try {
    await runConfig(rest);
  } catch (err) {
    console.error(formatError(err));
    exitWithCleanup(1);
  }
}

// ── Delegated rex commands ────────────────────────────────────────────────────

async function handleValidate(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["validate", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleFix(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["fix", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleHealth(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["health", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleReport(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["report", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleVerify(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["verify", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleUpdate(rest) {
  // First positional arg is the item ID, not a dir
  requireInit(process.cwd(), [".rex"]);
  await runOrDie(tools.rex, ["update", ...rest]);
  exitWithCleanup(0);
}

async function handleRemove(rest) {
  // First positional arg is the item ID (or level), not a dir
  requireInit(process.cwd(), [".rex"]);
  await runOrDie(tools.rex, ["remove", ...rest]);
  exitWithCleanup(0);
}

async function handleMove(rest) {
  // First positional arg is the item ID, not a dir
  requireInit(process.cwd(), [".rex"]);
  await runOrDie(tools.rex, ["move", ...rest]);
  exitWithCleanup(0);
}

async function handleReshape(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["reshape", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleReorganize(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["reorganize", ...flags, dir]);
  exitWithCleanup(0);
}

async function handlePrune(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["prune", ...flags, dir]);
  exitWithCleanup(0);
}

async function handleNext(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".rex"]);
  const flags = extractFlags(rest);
  await runOrDie(tools.rex, ["next", ...flags, dir]);
  exitWithCleanup(0);
}

// ── Delegated sourcevision commands ───────────────────────────────────────────

async function handleReset(rest) {
  const dir = resolveDir(rest);
  requireInit(dir, [".sourcevision"]);
  await runOrDie(tools.sourcevision, ["reset", dir]);
  exitWithCleanup(0);
}

// ── Delegated hench commands ─────────────────────────────────────────────────

async function handleShow(rest) {
  // First positional arg is the run ID, not a dir
  requireInit(process.cwd(), [".hench"]);
  await runOrDie(tools.hench, ["show", ...rest]);
  exitWithCleanup(0);
}

function handleHelp(rest) {
  const query = rest.filter((a) => !a.startsWith("-")).join(" ");
  if (!query) {
    showMainHelp();
    exitWithCleanup(0);
  }
  // If query is a tool name, show its subcommand summary with navigation hints
  const toolHelp = formatToolHelp(query);
  if (toolHelp) {
    console.log(toolHelp);
    exitWithCleanup(0);
  }
  // If query matches an orchestration command, show its help
  if (showCommandHelp(query)) {
    exitWithCleanup(0);
  }
  // Otherwise search across all help content
  const results = searchHelp(query);
  console.log(formatSearchResults(results, query));
  exitWithCleanup(0);
}

function handleUnknownCommand(command) {
  const allCommands = [...getOrchestratorCommands(), "help"];
  const typoHint = formatTypoSuggestion(command, allCommands, "ndx ");
  console.error(`Error: [${CLI_ERROR_CODES.UNKNOWN_COMMAND}] Unknown command: ${command}`);
  if (typoHint) {
    console.error(`Hint: ${typoHint}`);
  } else {
    console.error("Hint: Run 'ndx --help' to see available commands, or 'ndx help <keyword>' to search.");
  }
  exitWithCleanup(1);
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
// Init banner lives in cli-brand.js (formatInitBanner)
const signalHandlers = installTrackedChildProcessHandlers({
  tracker: childTracker,
  signals: ["SIGINT", "SIGTERM", "SIGHUP"],
  onSignal: async (signal) => {
    const signalExitCode = signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : 143;
    await flushAndExit(signalExitCode);
  },
});

// Catch unhandled errors at the top level — never show stack traces
process.on("uncaughtException", (err) => {
  if (err instanceof ExitRequest) {
    void flushAndExit(err.code);
    return;
  }
  console.error(formatError(err));
  void flushAndExit(1);
});
process.on("unhandledRejection", (err) => {
  if (err instanceof ExitRequest) {
    void flushAndExit(err.code);
    return;
  }
  console.error(formatError(err));
  void flushAndExit(1);
});

// ── Main dispatch ────────────────────────────────────────────────────────────

try {
  await main();
  await flushAndExit(0);
} catch (err) {
  if (err instanceof ExitRequest) {
    await flushAndExit(err.code);
  } else {
    console.error(formatError(err));
    await flushAndExit(1);
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  // ── Update check (non-blocking) ─────────────────────────────────────────
  // Detect quiet mode early so the notice can be suppressed if needed.
  // The check runs as a background Promise concurrently with command
  // execution; flushAndExit() races it against a 500 ms timeout.
  updateCheckQuiet = rest.some((a) => a === "--quiet" || a === "-q");
  if (!updateCheckQuiet) {
    try {
      const { version: currentVersion } = JSON.parse(
        readFileSync(join(__dir, "package.json"), "utf-8"),
      );
      pendingUpdateCheck = startUpdateCheck({ currentVersion });
    } catch {
      // Non-fatal — update check skipped if we can't read our own version.
    }
  }

  // Handle standard top-level version flags before normal command parsing.
  if (command === "-v" || command === "--version") {
    handleVersion(rest);
  }

  // ── Per-command --help ──────────────────────────────────────────────────
  const hasHelp = rest.some((a) => a === "--help" || a === "-h");
  if (hasHelp && command && showCommandHelp(command)) {
    exitWithCleanup(0);
  }

  // ── Resolve command timeout from project config ─────────────────────────
  // Load project config from the directory inferred from args (best-effort:
  // failure is silently ignored so a missing .n-dx.json never blocks startup).
  const dir = resolveDir(rest);
  const projectConfig = await loadProjectConfig(dir).catch(() => ({}));
  const timeoutMs = resolveCommandTimeout(command ?? "", projectConfig);

  // ── Stale-project detection (synchronous) ───────────────────────────────
  // Run before command dispatch so the notice can be shown after output.
  // Skipped for init (about to fix staleness), help, version, and quiet mode.
  if (!updateCheckQuiet && command && !STALE_CHECK_SKIP_COMMANDS.has(command) && !hasHelp) {
    try {
      staleCheckResult = checkProjectStaleness(dir);
      // Read the recorded init version from .n-dx.json for the notice message.
      try {
        const ndxConfig = join(dir, ".n-dx.json");
        if (existsSync(ndxConfig)) {
          const cfg = JSON.parse(readFileSync(ndxConfig, "utf-8"));
          staleCheckInitVersion = typeof cfg._initVersion === "string" ? cfg._initVersion : null;
        }
      } catch { /* ignore */ }
    } catch {
      // Non-fatal — stale check failure never blocks command execution.
    }
  }

  // ── Dispatch to command handler ─────────────────────────────────────────
  const runCommand = async () => {
    switch (command) {
      case "version":   return handleVersion(rest);
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

      // ── Delegated rex commands ──
      case "validate":    return handleValidate(rest);
      case "fix":         return handleFix(rest);
      case "health":      return handleHealth(rest);
      case "report":      return handleReport(rest);
      case "verify":      return handleVerify(rest);
      case "update":      return handleUpdate(rest);
      case "remove":      return handleRemove(rest);
      case "move":        return handleMove(rest);
      case "reshape":     return handleReshape(rest);
      case "reorganize":  return handleReorganize(rest);
      case "prune":       return handlePrune(rest);
      case "next":        return handleNext(rest);

      // ── Delegated sourcevision commands ──
      case "reset":       return handleReset(rest);

      // ── Delegated hench commands ──
      case "show":        return handleShow(rest);
    }

    // ── Tool delegation ─────────────────────────────────────────────────────
    if (tools[command]) {
      const code = await run(tools[command], rest);
      exitWithCleanup(code);
    }

    // ── Unknown command or no command ───────────────────────────────────────
    if (command) {
      return handleUnknownCommand(command);
    }

    showMainHelp();
    exitWithCleanup(0);
  };

  if (timeoutMs > 0) {
    await withCommandTimeout(command ?? "", timeoutMs, runCommand);
  } else {
    await runCommand();
  }
}

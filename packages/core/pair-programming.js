/**
 * Pair-programming cross-vendor review helpers.
 *
 * After the primary vendor completes its work step, the opposite vendor
 * acts as a reviewer: it runs the project's configured test command and
 * reports a pass/fail verdict. This creates a "bickering pair" dynamic
 * where one vendor does the work and the other checks it.
 *
 * Design notes:
 * - The reviewer's availability is checked via a --version probe. If the
 *   binary is not installed or not on PATH, the review step is skipped with
 *   a warning rather than crashing the overall command.
 * - The test command is run as a shell command (not via the LLM itself),
 *   and the output is attributed to the reviewer vendor in the UI.
 * - All exported functions are pure or side-effect-isolated so this module
 *   can be tested independently from cli.js.
 *
 * @module n-dx/pair-programming
 */

import { spawn, execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

/**
 * Read the test command from .rex/config.json → `test` field.
 * Returns undefined when the file is absent, malformed, or the field unset.
 *
 * @param {string} dir  Project root directory.
 * @returns {string | undefined}
 */
export function readRexTestCommand(dir) {
  const configPath = join(dir, ".rex", "config.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const data = JSON.parse(readFileSync(configPath, "utf-8"));
    const cmd = data?.test;
    return typeof cmd === "string" && cmd.trim().length > 0 ? cmd.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determine which vendor should act as reviewer given the primary vendor.
 *
 * @param {"claude" | "codex"} primaryVendor
 * @returns {"claude" | "codex"}
 */
export function resolveReviewerVendor(primaryVendor) {
  return primaryVendor === "claude" ? "codex" : "claude";
}

/**
 * Resolve the CLI binary path for a given vendor.
 * Reads from .n-dx.json (llm.<vendor>.cli_path) and falls back to
 * the bare vendor name (resolved by PATH lookup).
 *
 * @param {string} dir  Project root directory.
 * @param {"claude" | "codex"} vendor
 * @returns {string}  CLI binary path or name.
 */
export function resolveVendorCliPath(dir, vendor) {
  const configPath = join(dir, ".n-dx.json");
  try {
    if (existsSync(configPath)) {
      const data = JSON.parse(readFileSync(configPath, "utf-8"));
      const configured = data?.llm?.[vendor]?.cli_path;
      if (typeof configured === "string" && configured.trim().length > 0) {
        return configured.trim();
      }
      // Legacy claude.cli_path key
      if (vendor === "claude") {
        const legacy = data?.claude?.cli_path;
        if (typeof legacy === "string" && legacy.trim().length > 0) {
          return legacy.trim();
        }
      }
    }
  } catch {
    /* ignore — fall through to default */
  }
  return vendor; // "claude" or "codex" — resolved via PATH
}

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

/**
 * Check whether a vendor CLI binary is accessible.
 * Uses a --version probe with a short timeout to avoid blocking.
 *
 * @param {string} cliPath  Binary path or name.
 * @returns {{ available: boolean }}
 */
export function checkReviewerAvailability(cliPath) {
  try {
    execFileSync(cliPath, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
      shell: process.platform === "win32",
    });
    return { available: true };
  } catch {
    return { available: false };
  }
}

// ---------------------------------------------------------------------------
// Test command runner
// ---------------------------------------------------------------------------

/**
 * Run a shell test command and capture combined stdout + stderr.
 * Always spawns via the system shell so quoted arguments and compound
 * commands (e.g. "pnpm -r test") are handled correctly.
 *
 * @param {string} testCommand  Full shell command (e.g. "pnpm test").
 * @param {string} dir          Working directory.
 * @param {number} [timeout=120000]  Max run time in ms.
 * @returns {Promise<{ exitCode: number; output: string }>}
 */
export function runShellTestCommand(testCommand, dir, timeout = 120_000) {
  return new Promise((resolve) => {
    const child = spawn(testCommand, [], {
      cwd: dir,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ exitCode: 1, output: output + "\n[pair-programming review: test command timed out]" });
    }, timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, output });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `[pair-programming review: could not start test command — ${err.message}]` });
    });
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ReviewResult
 * @property {boolean} skipped         True when the review step was not executed.
 * @property {string}  [reason]        Human-readable reason for skipping.
 * @property {boolean} [passed]        True when tests passed. Present only when !skipped.
 * @property {string}  [command]       The test command that was run.
 * @property {string}  [output]        Combined stdout + stderr of the test run.
 * @property {number}  [exitCode]      Exit code of the test command.
 */

/**
 * Run the cross-vendor review step.
 *
 * 1. Resolve the reviewer's CLI binary.
 * 2. If the binary is unavailable, skip with a warning-level result.
 * 3. If no test command is configured, skip with a warning-level result.
 * 4. Run the test command and return a structured verdict.
 *
 * @param {{
 *   dir: string;
 *   reviewer: "claude" | "codex";
 *   testCommand?: string;
 *   timeout?: number;
 * }} options
 * @returns {Promise<ReviewResult>}
 */
export async function runCrossVendorReview({ dir, reviewer, testCommand, timeout }) {
  const cliPath = resolveVendorCliPath(dir, reviewer);
  const { available } = checkReviewerAvailability(cliPath);

  if (!available) {
    return {
      skipped: true,
      reason: `${reviewer} CLI not found (tried: ${cliPath}). Install or configure llm.${reviewer}.cli_path.`,
    };
  }

  if (!testCommand) {
    return {
      skipped: true,
      reason: "no test command configured in .rex/config.json (set the `test` field to enable review)",
    };
  }

  const { exitCode, output } = await runShellTestCommand(testCommand, dir, timeout);
  return {
    skipped: false,
    passed: exitCode === 0,
    command: testCommand,
    output,
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

const BORDER = "─".repeat(60);

/**
 * Format a ReviewResult for terminal display.
 *
 * @param {"claude" | "codex"} reviewer
 * @param {ReviewResult} result
 * @returns {string}
 */
export function formatReviewBanner(reviewer, result) {
  const lines = [
    "",
    BORDER,
    `Reviewer (${reviewer})`,
    BORDER,
  ];

  if (result.skipped) {
    lines.push(`⚠  Review skipped: ${result.reason}`);
  } else if (result.passed) {
    lines.push("✓  All tests passed");
    if (result.command) lines.push(`   Command: ${result.command}`);
  } else {
    lines.push("✗  Tests failed");
    if (result.command) lines.push(`   Command: ${result.command}`);
    if (result.output?.trim()) {
      lines.push("");
      lines.push(result.output.trim());
    }
  }

  lines.push(BORDER);
  return lines.join("\n");
}

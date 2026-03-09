/**
 * PR validation pipeline for n-dx.
 *
 * Runs build checks and PRD validation to prevent broken or incomplete
 * work from being merged. Designed for CI/PR gate integration.
 *
 * Steps:
 *   1. pnpm build             (TypeScript compilation across all packages)
 *   2. rex validate            (PRD integrity: orphaned items, schema errors)
 *
 * Exits 0 if all steps pass, 1 otherwise.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Run a subprocess and capture its stdout/stderr.
 * Returns { code, stdout, stderr }.
 */
function runCapture(command, args, opts = {}) {
  return new Promise((res) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => res({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Run the PR check pipeline. Returns true if all steps pass.
 *
 * @param {string} dir        Project directory
 * @param {string[]} flags    CLI flags (--format=json, --quiet, -q)
 * @param {{ rexCli: string }}  Injected dependencies
 * @returns {Promise<boolean>}
 */
export async function runPRCheck(dir, flags, { rexCli }) {
  const isQuiet = flags.includes("--quiet") || flags.includes("-q");
  const isJSON = flags.some((f) => f === "--format=json");

  const steps = [];
  let allOk = true;

  function info(...args) {
    if (!isQuiet && !isJSON) console.log(...args);
  }

  // ── Step 1: pnpm build ──────────────────────────────────────────────────
  info("── build ──");
  const build = await runCapture("pnpm", ["build"], {
    cwd: dir,
    shell: process.platform === "win32",
  });
  const buildOk = build.code === 0;
  if (!buildOk) allOk = false;

  steps.push({
    name: "build",
    ok: buildOk,
    detail: buildOk
      ? "TypeScript compilation succeeded"
      : trimOutput(build.stderr || build.stdout),
  });

  if (buildOk) {
    info("  \u2713 build");
  } else {
    info("  \u2717 build");
    if (!isJSON) printIndented(build.stderr || build.stdout, info);
  }

  // ── Step 2: rex validate ────────────────────────────────────────────────
  // Only run rex validate if .rex directory exists — a project may not have
  // a PRD yet, and build-only validation is still valuable.
  const hasRex = existsSync(join(dir, ".rex"));

  if (hasRex) {
    info("── rex validate ──");
    const rexValidate = await runCapture(
      process.execPath,
      [resolve(__dir, rexCli), "validate", "--format=json", dir],
    );

    let validateChecks = [];
    try {
      const parsed = JSON.parse(rexValidate.stdout);
      if (parsed && typeof parsed === "object" && "checks" in parsed) {
        validateChecks = parsed.checks;
      } else if (Array.isArray(parsed)) {
        validateChecks = parsed;
      }
    } catch {
      // Could not parse — treat as opaque output
    }

    const rexValOk = rexValidate.code === 0;
    if (!rexValOk) allOk = false;

    steps.push({
      name: "rex-validate",
      ok: rexValOk,
      checks: validateChecks,
      detail: rexValOk
        ? `${validateChecks.length} checks passed`
        : trimOutput(rexValidate.stdout || rexValidate.stderr),
    });

    if (rexValOk) {
      info(`  \u2713 rex validate (${validateChecks.length} checks passed)`);
    } else {
      info("  \u2717 rex validate");
      if (!isJSON) {
        for (const check of validateChecks) {
          if (!check.pass && check.severity !== "warn") {
            info(`    \u2717 ${check.name}`);
            for (const err of check.errors) {
              info(`      ${err}`);
            }
          }
        }
      }
    }
  } else {
    steps.push({
      name: "rex-validate",
      ok: true,
      detail: "Skipped (no .rex directory)",
    });
    info("── rex validate ──");
    info("  - skipped (no .rex directory)");
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const report = {
    timestamp: new Date().toISOString(),
    ok: allOk,
    steps,
  };

  if (isJSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    info("");
    if (allOk) {
      info("PR check passed.");
    } else {
      info("PR check failed.");
    }
  }

  return allOk;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Trim output to a reasonable length for report detail fields. */
function trimOutput(str) {
  if (!str) return "";
  const trimmed = str.trim();
  if (trimmed.length <= 500) return trimmed;
  return trimmed.slice(0, 500) + "\u2026";
}

/** Print multiline output with indentation. */
function printIndented(str, logFn) {
  if (!str) return;
  for (const line of str.trim().split("\n").slice(0, 10)) {
    logFn(`    ${line}`);
  }
}

// ── CLI entry point ─────────────────────────────────────────────────────────

const isMain = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("-"));
  const positional = args.filter((a) => !a.startsWith("-"));
  const dir = positional[0] || process.cwd();

  // Resolve rex CLI path
  const rexCli = join("packages/rex/dist/cli/index.js");

  try {
    const ok = await runPRCheck(dir, flags, { rexCli });
    process.exit(ok ? 0 : 1);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

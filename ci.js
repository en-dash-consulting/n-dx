/**
 * CI pipeline for n-dx.
 *
 * Runs the full analysis pipeline, validates PRD health, and generates
 * a comprehensive report. Designed for CI environments.
 *
 * Steps:
 *   1. sourcevision analyze --fast  (codebase analysis, no AI enrichment)
 *   2. sourcevision validate        (schema checks on analysis output)
 *   3. rex validate --format=json   (PRD health checks)
 *   4. rex status --format=json     (completion stats)
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
function runCapture(script, args) {
  return new Promise((res) => {
    const child = spawn(
      process.execPath,
      [resolve(__dir, script), ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => res({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Run the CI pipeline. Returns true if all steps pass.
 *
 * @param {string} dir        Project directory
 * @param {string[]} flags    CLI flags (--format=json, --quiet, -q)
 * @param {{ run, tools }}    Injected dependencies from cli.js
 * @returns {Promise<boolean>}
 */
export async function runCI(dir, flags, { run, tools }) {
  const isQuiet = flags.includes("--quiet") || flags.includes("-q");
  const isJSON = flags.some((f) => f === "--format=json");

  // ── Pre-flight: check required directories ──────────────────────────────
  const requiredDirs = [".rex", ".sourcevision"];
  const missingDirs = requiredDirs.filter((d) => !existsSync(join(dir, d)));
  if (missingDirs.length > 0) {
    const error = `Missing ${missingDirs.join(", ")} in ${dir}`;
    const hint = `Run 'ndx init${dir === process.cwd() ? "" : " " + dir}' to set up the project.`;
    if (isJSON) {
      const report = {
        timestamp: new Date().toISOString(),
        ok: false,
        error,
        hint,
        steps: [],
      };
      console.log(JSON.stringify(report, null, 2));
      return false;
    }
    // Text mode: the caller (cli.js) handles this via requireInit
    throw new Error(error);
  }

  const steps = [];
  let allOk = true;

  function info(...args) {
    if (!isQuiet && !isJSON) console.log(...args);
  }

  // ── Step 1: sourcevision analyze ────────────────────────────────────────
  info("── sourcevision analyze ──");
  const svAnalyze = await runCapture(tools.sourcevision, ["analyze", "--fast", "--quiet", dir]);
  const svOk = svAnalyze.code === 0;
  if (!svOk) allOk = false;

  steps.push({
    name: "sourcevision",
    ok: svOk,
    detail: svOk ? "Analysis complete" : trimOutput(svAnalyze.stderr || svAnalyze.stdout),
  });

  if (svOk) {
    info("  ✓ sourcevision analyze");
  } else {
    info(`  ✗ sourcevision analyze`);
    if (!isJSON) printIndented(svAnalyze.stderr || svAnalyze.stdout);
  }

  // ── Step 2: sourcevision validate ───────────────────────────────────────
  info("── sourcevision validate ──");
  const svValidate = await runCapture(tools.sourcevision, ["validate", "--quiet", dir]);
  const svValOk = svValidate.code === 0;
  if (!svValOk) allOk = false;

  steps.push({
    name: "sourcevision-validate",
    ok: svValOk,
    detail: svValOk
      ? "All modules valid"
      : trimOutput(svValidate.stdout || svValidate.stderr),
  });

  if (svValOk) {
    info("  ✓ sourcevision validate");
  } else {
    info(`  ✗ sourcevision validate`);
    if (!isJSON) printIndented(svValidate.stdout || svValidate.stderr);
  }

  // ── Step 3: rex validate ────────────────────────────────────────────────
  info("── rex validate ──");
  const rexValidate = await runCapture(tools.rex, ["validate", "--format=json", dir]);

  let validateChecks = [];
  let validateReport = null;
  try {
    const parsed = JSON.parse(rexValidate.stdout);
    // Handle structured report format (has .ok and .checks) or bare array
    if (parsed && typeof parsed === "object" && "checks" in parsed) {
      validateReport = parsed;
      validateChecks = parsed.checks;
    } else if (Array.isArray(parsed)) {
      validateChecks = parsed;
    }
  } catch {
    // Could not parse — treat as opaque output
  }

  // rex validate --format=json now exits non-zero on failure.
  // Use exit code as primary signal; fall back to check analysis.
  const rexValOk = rexValidate.code === 0;
  if (!rexValOk) allOk = false;

  steps.push({
    name: "validate",
    ok: rexValOk,
    checks: validateChecks,
    detail: rexValOk
      ? `${validateChecks.length} checks passed`
      : trimOutput(rexValidate.stdout || rexValidate.stderr),
  });

  if (rexValOk) {
    info(`  ✓ rex validate (${validateChecks.length} checks passed)`);
  } else {
    info(`  ✗ rex validate`);
    if (!isJSON) {
      for (const check of validateChecks) {
        if (!check.pass && check.severity !== "warn") {
          console.log(`    ✗ ${check.name}`);
          for (const err of check.errors) {
            console.log(`      ${err}`);
          }
        }
      }
    }
  }

  // ── Step 4: rex status ──────────────────────────────────────────────────
  info("── rex status ──");
  const rexStatus = await runCapture(tools.rex, ["status", "--format=json", dir]);
  const statusOk = rexStatus.code === 0;

  let statusData = null;
  try {
    statusData = JSON.parse(rexStatus.stdout);
  } catch {
    // Could not parse
  }

  // Compute stats from status data
  let stats = null;
  if (statusData && statusData.items) {
    stats = computeStats(statusData.items);
  }

  steps.push({
    name: "status",
    ok: statusOk,
    data: stats,
    detail: stats
      ? `${stats.completed}/${stats.total} complete (${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%)`
      : trimOutput(rexStatus.stderr || rexStatus.stdout),
  });

  if (stats) {
    const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    info(`  ${pct}% complete (${stats.completed}/${stats.total})`);
    if (stats.inProgress > 0) info(`  ${stats.inProgress} in progress`);
    if (stats.blocked > 0) info(`  ${stats.blocked} blocked`);
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
      info("CI pipeline passed.");
    } else {
      info("CI pipeline failed.");
    }
  }

  return allOk;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Walk a PRD item tree and compute aggregate stats. */
function computeStats(items) {
  const stats = { total: 0, completed: 0, inProgress: 0, pending: 0, deferred: 0, blocked: 0, deleted: 0 };
  function walk(list) {
    for (const item of list) {
      // Deleted items are tracked separately and excluded from total
      if (item.status === "deleted") {
        stats.deleted++;
        if (item.children) walk(item.children);
        continue;
      }
      stats.total++;
      switch (item.status) {
        case "completed": stats.completed++; break;
        case "in_progress": stats.inProgress++; break;
        case "pending": stats.pending++; break;
        case "deferred": stats.deferred++; break;
        case "blocked": stats.blocked++; break;
      }
      if (item.children) walk(item.children);
    }
  }
  walk(items);
  return stats;
}

/** Trim output to a reasonable length for report detail fields. */
function trimOutput(str) {
  if (!str) return "";
  const trimmed = str.trim();
  if (trimmed.length <= 500) return trimmed;
  return trimmed.slice(0, 500) + "…";
}

/** Print multiline output with indentation. */
function printIndented(str) {
  if (!str) return;
  for (const line of str.trim().split("\n").slice(0, 10)) {
    console.log(`    ${line}`);
  }
}

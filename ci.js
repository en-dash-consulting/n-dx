/**
 * CI pipeline for n-dx.
 *
 * Runs the full analysis pipeline, validates PRD health, and generates
 * a comprehensive report. Designed for CI environments.
 *
 * Steps:
 *   1. sourcevision analyze --fast  (codebase analysis, no AI enrichment)
 *   2. sourcevision validate        (schema checks on analysis output)
 *   3. zone health check            (cohesion/coupling threshold assertions)
 *   3b. gateway import boundary     (cross-package imports must use gateways)
 *   4. rex validate --format=json   (PRD health checks)
 *   5. rex status --format=json     (completion stats)
 *
 * Exits 0 if all steps pass, 1 otherwise.
 */

import { spawn } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve, relative } from "path";
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
    if (!isJSON) printIndented(svAnalyze.stderr || svAnalyze.stdout, info);
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
    if (!isJSON) printIndented(svValidate.stdout || svValidate.stderr, info);
  }

  // ── Step 3: zone health check ───────────────────────────────────────────
  info("── zone health ──");
  const zoneHealth = checkZoneHealth(dir);
  if (!zoneHealth.ok) allOk = false;

  steps.push({
    name: "zone-health",
    ok: zoneHealth.ok,
    detail: zoneHealth.ok
      ? `${zoneHealth.checked} zones checked, all within thresholds`
      : `${zoneHealth.violations.length} zone(s) exceed health thresholds`,
    ...(zoneHealth.violations.length > 0 ? { violations: zoneHealth.violations } : {}),
  });

  if (zoneHealth.ok) {
    info(`  ✓ zone health (${zoneHealth.checked} zones checked)`);
  } else {
    info(`  ✗ zone health`);
    if (!isJSON) {
      for (const v of zoneHealth.violations) {
        info(`    ✗ ${v.id}: cohesion=${v.cohesion.toFixed(2)}, coupling=${v.coupling.toFixed(2)}`);
      }
    }
  }

  // ── Step 3b: gateway import boundary ────────────────────────────────────
  info("── gateway imports ──");
  const gatewayResult = checkGatewayImports(dir);
  if (!gatewayResult.ok) allOk = false;

  steps.push({
    name: "gateway-imports",
    ok: gatewayResult.ok,
    detail: gatewayResult.ok
      ? `${gatewayResult.checked} files checked, all cross-package imports use gateways`
      : `${gatewayResult.violations.length} file(s) bypass gateway pattern`,
    ...(gatewayResult.violations.length > 0 ? { violations: gatewayResult.violations } : {}),
  });

  if (gatewayResult.ok) {
    info(`  ✓ gateway imports (${gatewayResult.checked} files checked)`);
  } else {
    info(`  ✗ gateway imports`);
    if (!isJSON) {
      for (const v of gatewayResult.violations) {
        info(`    ✗ ${v.file}:${v.line} — ${v.message}`);
      }
    }
  }

  // ── Step 4: rex validate ────────────────────────────────────────────────
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
          info(`    ✗ ${check.name}`);
          for (const err of check.errors) {
            info(`      ${err}`);
          }
        }
      }
    }
  }

  // ── Step 5: rex status ──────────────────────────────────────────────────
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
function printIndented(str, logFn) {
  if (!str) return;
  for (const line of str.trim().split("\n").slice(0, 10)) {
    logFn(`    ${line}`);
  }
}

// ── Zone health thresholds ──────────────────────────────────────────────────

/** Cohesion below this threshold triggers a warning. */
const MIN_COHESION = 0.5;
/** Coupling above this threshold triggers a warning. */
const MAX_COUPLING = 0.25;

/** Roles exempt from zone health checks (no semantic signal). */
const EXEMPT_ROLES = new Set(["asset", "config", "other"]);

/**
 * Check zone health by reading zones.json and asserting cohesion/coupling
 * thresholds. Returns violations for non-asset zones that exceed thresholds.
 */
function checkZoneHealth(dir) {
  const zonesPath = join(dir, ".sourcevision", "zones.json");
  if (!existsSync(zonesPath)) {
    return { ok: true, checked: 0, violations: [] };
  }

  let zonesData;
  try {
    zonesData = JSON.parse(readFileSync(zonesPath, "utf-8"));
  } catch {
    return { ok: true, checked: 0, violations: [] };
  }

  const zones = zonesData.zones ?? [];
  const violations = [];
  let checked = 0;

  function walkZones(zoneList) {
    for (const zone of zoneList) {
      // Skip zones with fewer than 3 files (metrics are unreliable)
      if (!zone.files || zone.files.length < 3) continue;

      // Skip asset/config-only zones
      if (zone.files.every((f) => {
        const ext = f.split(".").pop()?.toLowerCase();
        return EXEMPT_ROLES.has(ext) || f.endsWith(".json") || f.endsWith(".md") || f.endsWith(".png") || f.endsWith(".svg");
      })) continue;

      checked++;

      if (
        (zone.cohesion != null && zone.cohesion < MIN_COHESION) ||
        (zone.coupling != null && zone.coupling > MAX_COUPLING)
      ) {
        violations.push({
          id: zone.id,
          name: zone.name,
          cohesion: zone.cohesion ?? 0,
          coupling: zone.coupling ?? 0,
          fileCount: zone.files.length,
        });
      }

      // Check subzones recursively
      if (zone.subZones) {
        walkZones(zone.subZones);
      }
    }
  }

  walkZones(zones);

  return {
    ok: violations.length === 0,
    checked,
    violations,
  };
}

// ── Gateway import boundary ─────────────────────────────────────────────────

/**
 * Gateway import boundary rules.
 *
 * Each entry defines: which package directory to scan, which external package
 * names require gateway routing, and which file(s) are the designated gateways.
 *
 * Additionally, the `boundaryRules` array enforces intra-package import
 * direction (e.g. server cannot import from viewer).
 */
const GATEWAY_RULES = [
  {
    // hench → rex: only rex-gateway.ts may have runtime imports
    packageDir: "packages/hench/src",
    externalPkg: "rex",
    gatewayFiles: new Set(["packages/hench/src/prd/rex-gateway.ts"]),
  },
  {
    // web → rex: only rex-gateway.ts may have runtime imports
    packageDir: "packages/web/src",
    externalPkg: "rex",
    gatewayFiles: new Set(["packages/web/src/server/rex-gateway.ts"]),
  },
  {
    // web → sourcevision: only domain-gateway.ts may have runtime imports
    packageDir: "packages/web/src",
    externalPkg: "sourcevision",
    gatewayFiles: new Set(["packages/web/src/server/domain-gateway.ts"]),
  },
];

/**
 * Intra-package import direction rules.
 *
 * Prevents server-side code from importing browser-side modules.
 */
const BOUNDARY_RULES = [
  {
    // server/ must not import from viewer/
    sourceDir: "packages/web/src/server",
    forbiddenPattern: /from\s+["']\.\.\/viewer\//,
    message: "server/ must not import from viewer/ (use gateway or shared types)",
  },
];

/**
 * Regex to detect runtime (non-type) imports from a specific package.
 *
 * Matches:
 *   import { foo } from "pkg"
 *   export { foo } from "pkg"
 *   import foo from "pkg"
 *
 * Does NOT match:
 *   import type { Foo } from "pkg"
 *   export type { Foo } from "pkg"
 *
 * @param {string} pkg  Package name (e.g. "rex", "sourcevision")
 * @returns {RegExp}
 */
function runtimeImportRegex(pkg) {
  // Matches import/export that is NOT followed by "type" before the from clause.
  // Uses negative lookahead to exclude type-only imports.
  return new RegExp(
    `(?:^|\\n)\\s*(?:import|export)\\s+(?!type\\s).*?from\\s+["']${pkg}["']`,
  );
}

/**
 * Recursively collect all .ts files under a directory.
 * Skips node_modules and dist directories.
 *
 * @param {string} dir  Directory to scan
 * @returns {string[]}  Array of relative file paths (from project root)
 */
function collectTsFiles(dir) {
  const results = [];

  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(d, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Check that all cross-package runtime imports pass through designated
 * gateway modules, and that intra-package import boundaries are respected.
 *
 * @param {string} dir  Project root directory
 * @returns {{ ok: boolean, checked: number, violations: Array<{ file: string, line: number, message: string }> }}
 */
function checkGatewayImports(dir) {
  const violations = [];
  let checked = 0;

  // ── Cross-package gateway checks ────────────────────────────────────────
  for (const rule of GATEWAY_RULES) {
    const pkgDir = join(dir, rule.packageDir);
    if (!existsSync(pkgDir)) continue;

    const regex = runtimeImportRegex(rule.externalPkg);
    const files = collectTsFiles(pkgDir);

    for (const filePath of files) {
      checked++;
      const relPath = relative(dir, filePath);

      // Skip if this file IS a designated gateway
      if (rule.gatewayFiles.has(relPath)) continue;

      let content;
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Quick pre-filter: skip lines that don't mention the package
        if (!line.includes(`"${rule.externalPkg}"`) && !line.includes(`'${rule.externalPkg}'`)) continue;

        // Check for runtime (non-type) import/export
        if (regex.test(line)) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: `runtime import from "${rule.externalPkg}" must go through gateway (${[...rule.gatewayFiles][0]})`,
          });
        }
      }
    }
  }

  // ── Intra-package boundary checks ──────────────────────────────────────
  for (const rule of BOUNDARY_RULES) {
    const srcDir = join(dir, rule.sourceDir);
    if (!existsSync(srcDir)) continue;

    const files = collectTsFiles(srcDir);

    for (const filePath of files) {
      checked++;
      const relPath = relative(dir, filePath);

      let content;
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (rule.forbiddenPattern.test(lines[i])) {
          violations.push({
            file: relPath,
            line: i + 1,
            message: rule.message,
          });
        }
      }
    }
  }

  return {
    ok: violations.length === 0,
    checked,
    violations,
  };
}

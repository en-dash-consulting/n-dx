/**
 * CI pipeline for n-dx.
 *
 * Runs the full analysis pipeline, validates PRD health, and generates
 * a comprehensive report. Designed for CI environments.
 *
 * Steps:
 *   0. community files check        (CODE_OF_CONDUCT.md exists and is non-empty)
 *   0a. architecture docs freshness (docs/architecture/ staleness check)
 *   1. sourcevision analyze --fast  (codebase analysis, no AI enrichment)
 *   2. sourcevision validate        (schema checks on analysis output)
 *   3. zone health check            (cohesion/coupling threshold assertions)
 *   3a. zone ID consistency         (zones.json ↔ zone output directories)
 *   3b. gateway import boundary     (cross-package imports must use gateways)
 *   4. rex validate --format=json   (PRD health checks)
 *   5. rex status --format=json     (completion stats)
 *
 * Exits 0 if all steps pass, 1 otherwise.
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, join, resolve, relative } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = resolve(__dir, "../..");

/**
 * Run a subprocess and capture its stdout/stderr.
 * Returns { code, stdout, stderr }.
 *
 * @param {string}   script    Path to the Node.js script to run.
 * @param {string[]} args      Arguments forwarded to the script.
 * @param {Function} spawnFn  spawn-compatible function used to create the
 *   child process.  Callers pass a tracked wrapper so the child is
 *   registered with the global cleanup gate and terminated on SIGINT/SIGTERM.
 */
function runCapture(script, args, spawnFn) {
  return new Promise((res) => {
    const child = spawnFn(
      process.execPath,
      [resolve(MONOREPO_ROOT, script), ...args],
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
export async function runCI(dir, flags, { run, tools, spawnTracked = spawn }) {
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

  // ── Step 0: community files check ─────────────────────────────────────
  // Verify that required community files (CODE_OF_CONDUCT.md) exist and are
  // non-empty. Prevents accidental deletion of governance documents.
  info("── community files ──");
  const communityResult = checkCommunityFiles(dir);
  if (!communityResult.ok) allOk = false;

  steps.push({
    name: "community-files",
    ok: communityResult.ok,
    detail: communityResult.ok
      ? `${communityResult.checked} community file(s) present`
      : `${communityResult.missing.length} required community file(s) missing or empty`,
    ...(communityResult.missing.length > 0 ? { missing: communityResult.missing } : {}),
  });

  if (communityResult.ok) {
    info(`  ✓ community files (${communityResult.checked} checked)`);
  } else {
    info(`  ✗ community files`);
    if (!isJSON) {
      for (const m of communityResult.missing) {
        info(`    ✗ ${m}`);
      }
    }
  }

  // ── Step 0a: architecture docs freshness ────────────────────────────────
  // Detects docs/architecture/ files that haven't been updated since the
  // source-of-truth files they document (CLAUDE.md, gateway-rules.json)
  // were last changed. Warns-only — does not fail the pipeline.
  info("── architecture docs freshness ──");
  const archDocsResult = checkArchitectureDocsFreshness(dir);

  steps.push({
    name: "architecture-docs-freshness",
    ok: true, // warn-only, never fails the pipeline
    detail: archDocsResult.stale.length === 0
      ? `${archDocsResult.checked} architecture doc(s) up to date`
      : `${archDocsResult.stale.length} architecture doc(s) may be stale`,
    ...(archDocsResult.stale.length > 0 ? { stale: archDocsResult.stale } : {}),
  });

  if (archDocsResult.stale.length === 0) {
    info(`  ✓ architecture docs freshness (${archDocsResult.checked} checked)`);
  } else {
    info(`  ⚠ architecture docs freshness`);
    if (!isJSON) {
      for (const s of archDocsResult.stale) {
        info(`    ⚠ ${s}`);
      }
    }
  }

  // ── Step 0b: guide docs freshness ─────────────────────────────────────
  // Detects docs/guide/ files that haven't been updated since CLI source
  // files (cli.js, help.js, CLAUDE.md) were last changed.
  info("── guide docs freshness ──");
  const guideDocsResult = checkDocsFreshness(dir, "guide", GUIDE_SOURCE_FILES);

  steps.push({
    name: "guide-docs-freshness",
    ok: true, // warn-only, never fails the pipeline
    detail: guideDocsResult.stale.length === 0
      ? `${guideDocsResult.checked} guide doc(s) up to date`
      : `${guideDocsResult.stale.length} guide doc(s) may be stale`,
    ...(guideDocsResult.stale.length > 0 ? { stale: guideDocsResult.stale } : {}),
  });

  if (guideDocsResult.stale.length === 0) {
    info(`  ✓ guide docs freshness (${guideDocsResult.checked} checked)`);
  } else {
    info(`  ⚠ guide docs freshness`);
    if (!isJSON) {
      for (const s of guideDocsResult.stale) {
        info(`    ⚠ ${s}`);
      }
    }
  }

  // ── Step 0c: docs build ────────────────────────────────────────────────
  // Verifies the VitePress docs site builds without errors (dead links,
  // broken markdown, etc.). Catches documentation regressions before merge.
  info("── docs build ──");
  const docsBuild = await new Promise((res) => {
    const child = spawnTracked("pnpm", ["docs:build"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("close", (code) => res({ code: code ?? 1, stdout, stderr }));
  });
  const docsBuildOk = docsBuild.code === 0;

  steps.push({
    name: "docs-build",
    ok: docsBuildOk,
    detail: docsBuildOk ? "docs site builds successfully" : "docs build failed",
    ...(docsBuildOk ? {} : { stderr: docsBuild.stderr.slice(-500) }),
  });

  if (docsBuildOk) {
    info("  ✓ docs build");
  } else {
    info("  ✗ docs build failed");
    if (!isJSON) {
      const lines = docsBuild.stderr.split("\n").filter((l) => l.includes("dead link") || l.includes("error"));
      for (const l of lines.slice(0, 10)) {
        info(`    ${l.trim()}`);
      }
    }
  }

  // ── Step 1: sourcevision analyze ────────────────────────────────────────
  info("── sourcevision analyze ──");
  const svAnalyze = await runCapture(tools.sourcevision, ["analyze", "--fast", "--quiet", dir], spawnTracked);
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
  const svValidate = await runCapture(tools.sourcevision, ["validate", "--quiet", dir], spawnTracked);
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
    const phantomNote = zoneHealth.phantomSkipped > 0 ? `, ${zoneHealth.phantomSkipped} phantom zone(s) excluded` : "";
    info(`  ✓ zone health (${zoneHealth.checked} zones checked${phantomNote})`);
  } else {
    info(`  ✗ zone health`);
    if (!isJSON) {
      for (const v of zoneHealth.violations) {
        info(`    ✗ ${v.id}: cohesion=${v.cohesion.toFixed(2)}, coupling=${v.coupling.toFixed(2)}`);
      }
    }
  }

  // ── Step 3a: zone ID consistency ─────────────────────────────────────────
  info("── zone ID consistency ──");
  const zoneConsistency = checkZoneIdConsistency(dir);
  if (!zoneConsistency.ok) allOk = false;

  steps.push({
    name: "zone-id-consistency",
    ok: zoneConsistency.ok,
    detail: zoneConsistency.ok
      ? `${zoneConsistency.checked} zone IDs consistent across zones.json and zone output directories`
      : `${zoneConsistency.mismatches.length} zone ID inconsistency(ies) found`,
    ...(zoneConsistency.mismatches.length > 0 ? { mismatches: zoneConsistency.mismatches } : {}),
  });

  if (zoneConsistency.ok) {
    info(`  ✓ zone ID consistency (${zoneConsistency.checked} zones checked)`);
  } else {
    info(`  ✗ zone ID consistency`);
    if (!isJSON) {
      for (const m of zoneConsistency.mismatches) {
        info(`    ✗ ${m}`);
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

  // ── Step 3c: architecture policy (redundant enforcement) ───────────────
  // Enforces the four-tier hierarchy's child_process restriction directly
  // in CI, providing a redundant check alongside architecture-policy.test.js.
  // If the test file is skipped or broken, this CI step still catches violations.
  info("── architecture policy ──");
  const archResult = checkArchitecturePolicy(dir);
  if (!archResult.ok) allOk = false;

  steps.push({
    name: "architecture-policy",
    ok: archResult.ok,
    detail: archResult.ok
      ? `${archResult.checked} files checked, no unauthorized child_process imports`
      : `${archResult.violations.length} unauthorized child_process import(s) found`,
    ...(archResult.violations.length > 0 ? { violations: archResult.violations } : {}),
  });

  if (archResult.ok) {
    info(`  ✓ architecture policy (${archResult.checked} files checked)`);
  } else {
    info(`  ✗ architecture policy`);
    if (!isJSON) {
      for (const v of archResult.violations) {
        info(`    ✗ ${v}`);
      }
    }
  }

  // ── Step 3d: data-layer contract ────────────────────────────────────────
  // Enforces that no source file imports from the .rex/ data directory at
  // runtime. The .rex/ directory is a data layer (JSON state files read/written
  // via CLI or filesystem I/O) — direct module imports would create a fragile
  // coupling between source code and on-disk state layout.
  info("── data-layer contract ──");
  const dataLayerResult = checkDataLayerContract(dir);
  if (!dataLayerResult.ok) allOk = false;

  steps.push({
    name: "data-layer-contract",
    ok: dataLayerResult.ok,
    detail: dataLayerResult.ok
      ? `${dataLayerResult.checked} files checked, no imports from data directories`
      : `${dataLayerResult.violations.length} file(s) import from data directories`,
    ...(dataLayerResult.violations.length > 0 ? { violations: dataLayerResult.violations } : {}),
  });

  if (dataLayerResult.ok) {
    info(`  ✓ data-layer contract (${dataLayerResult.checked} files checked)`);
  } else {
    info(`  ✗ data-layer contract`);
    if (!isJSON) {
      for (const v of dataLayerResult.violations) {
        info(`    ✗ ${v.file}:${v.line} — ${v.message}`);
      }
    }
  }

  // ── Step 4: rex validate ────────────────────────────────────────────────
  info("── rex validate ──");
  const rexValidate = await runCapture(tools.rex, ["validate", "--format=json", dir], spawnTracked);

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

  // ── Step 4b: structure health ─────────────────────────────────────────
  info("── structure health ──");
  const rexHealth = await runCapture(tools.rex, ["health", "--format=json", dir], spawnTracked);
  let healthOk = rexHealth.code === 0;
  let healthData = null;
  try {
    healthData = JSON.parse(rexHealth.stdout);
    // Fail if overall health score is critically low
    if (healthData && healthData.overall < 50) {
      healthOk = false;
    }
  } catch {
    // Could not parse
  }

  if (!healthOk) allOk = false;

  steps.push({
    name: "structure-health",
    ok: healthOk,
    detail: healthData
      ? `score: ${healthData.overall}/100${healthData.suggestions?.length ? ` (${healthData.suggestions.length} suggestions)` : ""}`
      : trimOutput(rexHealth.stdout || rexHealth.stderr),
  });

  if (healthOk) {
    info(`  ✓ structure health (score: ${healthData?.overall ?? "?"})`);
  } else {
    info(`  ✗ structure health (score: ${healthData?.overall ?? "?"} — below threshold)`);
    if (!isJSON && healthData?.suggestions) {
      for (const s of healthData.suggestions) {
        info(`    ⚠ ${s}`);
      }
    }
  }

  // ── Step 5: rex status ──────────────────────────────────────────────────
  info("── rex status ──");
  const rexStatus = await runCapture(tools.rex, ["status", "--format=json", dir], spawnTracked);
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

// ── Community files check ────────────────────────────────────────────────────

/** Required community/governance files that must exist and be non-empty. */
const REQUIRED_COMMUNITY_FILES = ["CODE_OF_CONDUCT.md"];

/**
 * Verify that required community files exist and are non-empty.
 * Prevents accidental deletion of governance documents.
 *
 * @param {string} dir  Project root directory
 * @returns {{ ok: boolean, checked: number, missing: string[] }}
 */
function checkCommunityFiles(dir) {
  const missing = [];

  for (const file of REQUIRED_COMMUNITY_FILES) {
    const filePath = join(dir, file);
    if (!existsSync(filePath)) {
      missing.push(`${file} is missing`);
      continue;
    }
    try {
      const stat = statSync(filePath);
      if (stat.size === 0) {
        missing.push(`${file} is empty`);
      }
    } catch {
      missing.push(`${file} is unreadable`);
    }
  }

  return {
    ok: missing.length === 0,
    checked: REQUIRED_COMMUNITY_FILES.length,
    missing,
  };
}

// ── Zone health thresholds ──────────────────────────────────────────────────

/** Cohesion below this threshold triggers a warning. */
const MIN_COHESION = 0.5;
/** Coupling above this threshold triggers a warning. */
const MAX_COUPLING = 0.25;

/** Roles exempt from zone health checks (no semantic signal). */
const EXEMPT_ROLES = new Set(["asset", "config", "other"]);

/**
 * Detect phantom zones — community-detection artifacts that group files
 * from multiple packages into a single zone. These have no architectural
 * meaning and their coupling scores (often very high) pollute aggregate
 * health metrics with false signals.
 *
 * A zone is phantom if its files span more than one top-level package
 * directory (e.g. files from both packages/hench/ and packages/web/).
 */
function isPhantomZone(zone) {
  if (!zone.files || zone.files.length === 0) return false;
  const packages = new Set();
  for (const f of zone.files) {
    // Extract top-level package: "packages/web/src/..." → "packages/web"
    const match = f.match(/^(packages\/[^/]+)\//);
    if (match) {
      packages.add(match[1]);
    }
  }
  return packages.size > 1;
}

/**
 * Check zone health by reading zones.json and asserting cohesion/coupling
 * thresholds. Returns violations for non-asset zones that exceed thresholds.
 *
 * Phantom zones (community-detection artifacts spanning multiple packages)
 * are excluded from health checks to prevent false-positive violations.
 */
function checkZoneHealth(dir) {
  const zonesPath = join(dir, ".sourcevision", "zones.json");
  if (!existsSync(zonesPath)) {
    return { ok: true, checked: 0, violations: [], phantomSkipped: 0 };
  }

  let zonesData;
  try {
    zonesData = JSON.parse(readFileSync(zonesPath, "utf-8"));
  } catch {
    return { ok: true, checked: 0, violations: [], phantomSkipped: 0 };
  }

  const zones = zonesData.zones ?? [];
  const violations = [];
  let checked = 0;
  let phantomSkipped = 0;

  function walkZones(zoneList) {
    for (const zone of zoneList) {
      // Skip zones with fewer than 3 files (metrics are unreliable)
      if (!zone.files || zone.files.length < 3) continue;

      // Skip asset/config-only zones
      if (zone.files.every((f) => {
        const ext = f.split(".").pop()?.toLowerCase();
        return EXEMPT_ROLES.has(ext) || f.endsWith(".json") || f.endsWith(".md") || f.endsWith(".png") || f.endsWith(".svg");
      })) continue;

      // Skip phantom zones — community-detection artifacts that span
      // multiple packages. Their high coupling scores are false signals
      // from file misclassification, not real architectural problems.
      if (isPhantomZone(zone)) {
        phantomSkipped++;
        continue;
      }

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
    phantomSkipped,
  };
}

// ── Zone ID consistency ─────────────────────────────────────────────────────

/**
 * Convert a zone ID to the directory name used by zone-output.ts.
 *
 * Zone IDs may contain ":" (sub-analysis separator) which gets replaced
 * with "-" in directory names because ":" is invalid on Windows.
 * For nested zones with "/" separators, only the last segment is used.
 */
function zoneIdToDirName(id) {
  const segment = id.includes("/") ? id.split("/").pop() : id;
  return segment.replace(/:/g, "-");
}

/**
 * Check that zone IDs in zones.json are consistent with the zone output
 * directories in .sourcevision/zones/.
 *
 * Detects:
 *   - Top-level zones in zones.json that have no corresponding output directory
 *   - Output directories that correspond to no zone in zones.json
 *
 * Only checks top-level zones (sub-zones live inside their parent's directory).
 */
function checkZoneIdConsistency(dir) {
  const zonesJsonPath = join(dir, ".sourcevision", "zones.json");
  const zonesDir = join(dir, ".sourcevision", "zones");

  if (!existsSync(zonesJsonPath) || !existsSync(zonesDir)) {
    return { ok: true, checked: 0, mismatches: [] };
  }

  let zonesData;
  try {
    zonesData = JSON.parse(readFileSync(zonesJsonPath, "utf-8"));
  } catch {
    return { ok: true, checked: 0, mismatches: [] };
  }

  const topLevelZones = zonesData.zones ?? [];
  const mismatches = [];

  // Build set of expected directory names from zones.json (top-level only)
  const expectedDirs = new Map();
  for (const zone of topLevelZones) {
    const dirName = zoneIdToDirName(zone.id);
    expectedDirs.set(dirName, zone.id);
  }

  // Build set of actual directories
  let actualDirs;
  try {
    actualDirs = new Set(
      readdirSync(zonesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    );
  } catch {
    return { ok: true, checked: 0, mismatches: [] };
  }

  // Check for zones.json entries missing from directories
  for (const [dirName, zoneId] of expectedDirs) {
    if (!actualDirs.has(dirName)) {
      mismatches.push(
        `zone "${zoneId}" (expected dir "${dirName}") exists in zones.json but has no output directory`,
      );
    }
  }

  // Check for orphan directories not in zones.json
  for (const dirName of actualDirs) {
    if (!expectedDirs.has(dirName)) {
      mismatches.push(
        `directory "${dirName}" exists in .sourcevision/zones/ but has no matching zone in zones.json`,
      );
    }
  }

  return {
    ok: mismatches.length === 0,
    checked: expectedDirs.size,
    mismatches,
  };
}

// ── Gateway import boundary ─────────────────────────────────────────────────

/**
 * Gateway import boundary rules — loaded from gateway-rules.json.
 *
 * The JSON file is the single source of truth shared by ci.js and
 * domain-isolation.test.js, eliminating silent divergence between
 * enforcement mechanisms.
 */
const _gatewayConfig = JSON.parse(readFileSync(join(__dir, "gateway-rules.json"), "utf-8"));

const GATEWAY_RULES = _gatewayConfig.gateways.map((g) => ({
  packageDir: g.consumer,
  externalPkg: g.externalPackage,
  gatewayFiles: new Set(g.gatewayFiles),
}));

const BOUNDARY_RULES = _gatewayConfig.boundaries.map((b) => ({
  sourceDir: b.sourceDir,
  forbiddenPattern: new RegExp(b.forbiddenImportPattern),
  message: b.message,
}));

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

// ── Architecture policy (redundant enforcement) ──────────────────────────────

/**
 * Files allowed to import from node:child_process directly.
 * Mirrors architecture-policy.test.js ALLOWED set for redundant enforcement.
 *
 * This list is intentionally maintained separately from the test file to
 * provide independent verification — if either list drifts, the stricter
 * one catches the violation.
 */
const CHILD_PROCESS_ALLOWED = new Set([
  // Foundation abstraction
  "packages/llm-client/src/exec.ts",
  // CLI streaming providers
  "packages/llm-client/src/cli-provider.ts",
  "packages/llm-client/src/codex-cli-provider.ts",
  "packages/hench/src/agent/lifecycle/cli-loop.ts",
  // Orchestration layer
  "cli.js",
  "ci.js",
  "web.js",
  "config.js",
  "pr-check.js",
  // Development scripts
  "packages/web/dev.js",
  // System monitoring
  "packages/hench/src/process/memory-monitor.ts",
  // Git operations
  "packages/sourcevision/src/analyzers/branch-work-collector.ts",
  "packages/sourcevision/src/analyzers/branch-work-filter.ts",
  "packages/sourcevision/src/cli/commands/git-credential-helper.ts",
  "packages/sourcevision/src/cli/commands/prd-epic-resolver.ts",
  // Web server routes
  "packages/web/src/server/routes-hench.ts",
  "packages/web/src/server/routes-sourcevision.ts",
  // Claude Code integration
  "claude-integration.js",
]);

/**
 * Check that no source files import from node:child_process outside the
 * allowed list. This is a redundant enforcement of the four-tier hierarchy's
 * process execution policy, complementing architecture-policy.test.js.
 *
 * If the test file is ever skipped, broken, or omitted from a CI run,
 * this check still catches violations.
 */
function checkArchitecturePolicy(dir) {
  const violations = [];
  let checked = 0;

  const skipDirs = new Set(["node_modules", "dist", ".git", ".hench", ".rex", ".sourcevision"]);
  const childProcessPattern = /(?:from\s+["'](?:node:)?child_process["']|require\(["'](?:node:)?child_process["']\))/;

  function walkSrc(d) {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(d, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walkSrc(full);
      } else if (/\.(ts|js|mjs)$/.test(entry) && !entry.endsWith(".d.ts")) {
        const rel = relative(dir, full).replace(/\\/g, "/");

        // Skip allowed files and test files
        if (CHILD_PROCESS_ALLOWED.has(rel)) continue;
        if (/\.test\.(ts|js|mjs)$/.test(rel) || /(?:^|[/\\])tests?[/\\]/.test(rel)) continue;

        checked++;

        let content;
        try {
          content = readFileSync(full, "utf-8");
        } catch {
          continue;
        }

        if (childProcessPattern.test(content)) {
          violations.push(rel);
        }
      }
    }
  }

  walkSrc(dir);

  return {
    ok: violations.length === 0,
    checked,
    violations,
  };
}

// ── Data-layer contract ───────────────────────────────────────────────────────

/**
 * Data directories that must never be imported as modules.
 * These directories contain JSON state files managed via CLI or filesystem I/O.
 * Direct module imports (import/require) would create fragile coupling between
 * source code and on-disk state layout.
 */
const DATA_DIRECTORIES = [".rex", ".sourcevision", ".hench"];

/**
 * Check that no source files contain import/require paths resolving into
 * data directories (.rex/, .sourcevision/, .hench/).
 *
 * These directories are data layers — their contents are JSON state files
 * read/written via CLI or filesystem I/O. Module imports would create a
 * fragile coupling that bypasses the proper abstraction layers.
 *
 * This check complements the convention documented in CLAUDE.md and makes
 * the contract machine-enforceable.
 *
 * @param {string} dir  Project root directory
 * @returns {{ ok: boolean, checked: number, violations: Array<{ file: string, line: number, message: string }> }}
 */
function checkDataLayerContract(dir) {
  const violations = [];
  let checked = 0;

  const skipDirs = new Set(["node_modules", "dist", ".git", ".hench", ".rex", ".sourcevision"]);

  // Match import/require paths that resolve into data directories.
  // Catches patterns like:
  //   import x from ".rex/prd.json"
  //   import x from "../.rex/config.json"
  //   require("./.rex/prd.json")
  //   from "../../.hench/config.json"
  // Does NOT match filesystem reads (readFileSync, fs.readFile, etc.)
  const dataImportPatterns = DATA_DIRECTORIES.map((d) => {
    const escaped = d.replace(".", "\\.");
    return new RegExp(
      `(?:from\\s+["'][^"']*\\/${escaped}\\/|from\\s+["']${escaped}\\/|require\\(["'][^"']*\\/${escaped}\\/|require\\(["']${escaped}\\/)`,
    );
  });

  function walkSrc(d) {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipDirs.has(entry)) continue;
      const full = join(d, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walkSrc(full);
      } else if (/\.(ts|js|mjs)$/.test(entry) && !entry.endsWith(".d.ts")) {
        const rel = relative(dir, full).replace(/\\/g, "/");

        // Skip test files — they may legitimately reference data directories in fixtures
        if (/\.test\.(ts|js|mjs)$/.test(rel) || /(?:^|[/\\])tests?[/\\]/.test(rel)) continue;

        checked++;

        let content;
        try {
          content = readFileSync(full, "utf-8");
        } catch {
          continue;
        }

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment lines
          if (/^\s*(?:\/\/|\*)/.test(line)) continue;

          for (let p = 0; p < dataImportPatterns.length; p++) {
            if (dataImportPatterns[p].test(line)) {
              violations.push({
                file: rel,
                line: i + 1,
                message: `module import resolves into ${DATA_DIRECTORIES[p]}/ — use filesystem I/O (readFileSync/writeFileSync) instead of import/require`,
              });
            }
          }
        }
      }
    }
  }

  walkSrc(dir);

  return {
    ok: violations.length === 0,
    checked,
    violations,
  };
}

// ── Architecture docs freshness ──────────────────────────────────────────────

/**
 * Source-of-truth files whose changes should trigger architecture doc review.
 * If any of these files were committed more recently than an architecture doc,
 * the doc is flagged as potentially stale.
 */
const ARCHITECTURE_SOURCE_FILES = ["CLAUDE.md", "gateway-rules.json", "PACKAGE_GUIDELINES.md"];

/**
 * Guide docs source-of-truth files. Changes to CLI commands, help text,
 * or orchestration scripts should trigger guide doc review.
 */
const GUIDE_SOURCE_FILES = ["cli.js", "help.js", "CLAUDE.md"];

/**
 * Get the Unix timestamp of the most recent git commit that touched a file.
 * Returns 0 if the file is untracked or git is unavailable.
 *
 * @param {string} filePath  Absolute path to the file
 * @param {string} cwd       Working directory for git commands
 * @returns {number}         Unix timestamp (seconds since epoch), or 0
 */
function gitLastCommitTime(filePath, cwd) {
  try {
    const result = spawnSync("git", ["log", "-1", "--format=%ct", "--", filePath], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return parseInt(result.stdout.trim(), 10) || 0;
    }
  } catch {
    // git not available or not a git repo — skip
  }
  return 0;
}

/**
 * Check whether markdown files in a docs subdirectory are stale relative
 * to their source-of-truth files.
 *
 * Uses git commit timestamps: if a source-of-truth file was committed
 * more recently than a doc, the doc is flagged as potentially stale.
 *
 * This is a heuristic — not all source-of-truth changes invalidate every
 * doc — but it provides an automated signal that was previously missing.
 *
 * @param {string} dir          Project root directory
 * @param {string} docsSubdir   Subdirectory under docs/ to check (e.g. "architecture", "guide")
 * @param {string[]} sourceFiles  Source-of-truth files (relative to project root)
 * @returns {{ checked: number, stale: string[] }}
 */
function checkDocsFreshness(dir, docsSubdir, sourceFiles) {
  const docsDir = join(dir, "docs", docsSubdir);
  const stale = [];

  if (!existsSync(docsDir)) {
    return { checked: 0, stale: [] };
  }

  // Find the most recent commit time among source-of-truth files
  let latestSourceTime = 0;
  let latestSourceFile = "";
  for (const srcFile of sourceFiles) {
    const srcPath = join(dir, srcFile);
    if (!existsSync(srcPath)) continue;
    const t = gitLastCommitTime(srcPath, dir);
    if (t > latestSourceTime) {
      latestSourceTime = t;
      latestSourceFile = srcFile;
    }
  }

  // If no source files have git history (e.g. fresh clone, no git), skip
  if (latestSourceTime === 0) {
    return { checked: 0, stale: [] };
  }

  // Check each doc
  let docFiles;
  try {
    docFiles = readdirSync(docsDir).filter((f) => f.endsWith(".md"));
  } catch {
    return { checked: 0, stale: [] };
  }

  let checked = 0;
  for (const file of docFiles) {
    const docPath = join(docsDir, file);
    const docTime = gitLastCommitTime(docPath, dir);
    if (docTime === 0) continue; // untracked or no history
    checked++;

    if (docTime < latestSourceTime) {
      stale.push(`${file} (last updated before ${latestSourceFile})`);
    }
  }

  return { checked, stale };
}

/** @deprecated Use checkDocsFreshness(dir, "architecture", ARCHITECTURE_SOURCE_FILES) */
function checkArchitectureDocsFreshness(dir) {
  return checkDocsFreshness(dir, "architecture", ARCHITECTURE_SOURCE_FILES);
}

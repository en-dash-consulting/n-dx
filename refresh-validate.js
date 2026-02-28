import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";

/**
 * Sourcevision output files captured before a refresh for potential rollback.
 * These are the files written by the sourcevision-analyze and
 * sourcevision-dashboard-artifacts steps.
 */
const SOURCEVISION_SNAPSHOT_FILES = [
  "manifest.json",
  "CONTEXT.md",
  "inventory.json",
  "imports.json",
  "zones.json",
  "components.json",
  "callgraph.json",
  "dashboard-artifacts.json",
];

/**
 * Key output files to verify after each step kind completes successfully.
 * An empty array means no post-step file validation is performed for that step.
 */
const STEP_OUTPUT_FILES = {
  "sourcevision-analyze": ["manifest.json"],
  "sourcevision-dashboard-artifacts": ["dashboard-artifacts.json"],
  "sourcevision-pr-markdown": [],
  "web-build": [],
};

/**
 * Capture the current contents of sourcevision output files so they can be
 * restored if a subsequent refresh step fails.
 *
 * Only files in the `.sourcevision/` directory are snapshotted; `web-build`
 * output is not included because build artifact restoration is unreliable and
 * a failed build does not leave the previous build in a worse state.
 *
 * @param {string} dir   Project directory (absolute or relative)
 * @param {object} plan  Refresh plan returned by buildRefreshPlan
 * @returns {Promise<{absDir: string, svDir: string, files: object, capturedAt: number, fileCount: number}>}
 */
export async function snapshotRefreshState(dir, plan) {
  const absDir = resolve(dir);
  const svDir = join(absDir, ".sourcevision");

  const stepsToRun = new Set((plan.steps ?? []).map((s) => s.kind));
  const shouldSnapshot =
    stepsToRun.has("sourcevision-analyze") ||
    stepsToRun.has("sourcevision-dashboard-artifacts") ||
    stepsToRun.has("sourcevision-pr-markdown");

  const files = {};

  if (shouldSnapshot && existsSync(svDir)) {
    for (const name of SOURCEVISION_SNAPSHOT_FILES) {
      const filePath = join(svDir, name);
      if (existsSync(filePath)) {
        try {
          // Store as Buffer so binary-safe restoration is possible
          files[name] = readFileSync(filePath);
        } catch {
          // best-effort: skip files that cannot be read
        }
      }
    }
  }

  return {
    absDir,
    svDir,
    files,
    capturedAt: Date.now(),
    fileCount: Object.keys(files).length,
  };
}

/**
 * Validate that the expected output files for a single step exist and contain
 * parseable content. Called after each step reports success as a belt-and-
 * suspenders check that the CLI actually produced its outputs.
 *
 * @param {string} stepKind  Step kind identifier (e.g. "sourcevision-analyze")
 * @param {string} dir       Project directory
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateRefreshStep(stepKind, dir) {
  const absDir = resolve(dir);
  const svDir = join(absDir, ".sourcevision");
  const outputFiles = STEP_OUTPUT_FILES[stepKind] ?? [];
  const issues = [];

  for (const name of outputFiles) {
    const filePath = join(svDir, name);
    if (!existsSync(filePath)) {
      issues.push(`missing expected output: .sourcevision/${name}`);
      continue;
    }
    // Validate JSON files can be parsed — a corrupt JSON file means the step
    // produced an incomplete result even though it exited with code 0.
    if (name.endsWith(".json")) {
      try {
        JSON.parse(readFileSync(filePath, "utf-8"));
      } catch {
        issues.push(`.sourcevision/${name} exists but contains invalid JSON`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Validate that all planned steps produced their expected outputs.
 * Called after every step reports success, before the operation is marked
 * complete, to confirm that the refresh fully succeeded.
 *
 * @param {string} dir   Project directory
 * @param {object} plan  Refresh plan (contains `steps` array)
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateRefreshCompletion(dir, plan) {
  const allIssues = [];

  for (const step of plan.steps ?? []) {
    const { issues } = validateRefreshStep(step.kind, dir);
    for (const issue of issues) {
      allIssues.push(`[${step.kind}] ${issue}`);
    }
  }

  return { valid: allIssues.length === 0, issues: allIssues };
}

/**
 * Restore sourcevision files from a pre-refresh snapshot.
 * Called when a refresh step fails or completion validation fails, to return
 * the project to a consistent state.
 *
 * @param {object} snapshot  Snapshot returned by snapshotRefreshState
 * @returns {Promise<{restored: number, failed: number, errors: string[]}>}
 */
export async function rollbackRefreshState(snapshot) {
  if (!snapshot || Object.keys(snapshot.files).length === 0) {
    return { restored: 0, failed: 0, errors: [] };
  }

  const errors = [];
  let restored = 0;
  let failed = 0;

  try {
    mkdirSync(snapshot.svDir, { recursive: true });
  } catch (err) {
    const count = Object.keys(snapshot.files).length;
    return {
      restored: 0,
      failed: count,
      errors: [`Cannot recreate .sourcevision directory: ${err.message}`],
    };
  }

  for (const [name, content] of Object.entries(snapshot.files)) {
    const filePath = join(snapshot.svDir, name);
    try {
      writeFileSync(filePath, content);
      restored++;
    } catch (err) {
      errors.push(`Failed to restore ${name}: ${err.message}`);
      failed++;
    }
  }

  return { restored, failed, errors };
}

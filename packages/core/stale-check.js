/**
 * Synchronous stale-project detection.
 *
 * Returns a notice string when the project's n-dx setup is incomplete or
 * out-of-date, or null when everything looks current.
 *
 * Usage:
 *   import { getStaleNotice } from "./stale-check.js";
 *   const notice = getStaleNotice(dir);
 *   if (notice) process.stdout.write(notice + "\n");
 *
 * Design:
 * - `getStaleNotice` is fully synchronous — it reads from disk and returns
 *   immediately, never awaiting I/O.
 * - Never throws. All file I/O errors are silently ignored; a missing or
 *   corrupt file is treated as "check not performed", not as "stale".
 *
 * Checks performed (in order):
 * 1. Missing .sourcevision/, .rex/, .hench/ directories
 * 2. Schema version mismatch in manifest.json or prd.json
 * 3. Missing required config keys in .hench/config.json
 *
 * @module stale-check
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Expected schema versions for each tool's config files. */
export const EXPECTED_REX_SCHEMA = "rex/v1";
export const EXPECTED_SV_SCHEMA = "1.0.0";
export const EXPECTED_HENCH_SCHEMA = "hench/v1";

/**
 * The three directories that `ndx init` creates.
 * Any missing directory indicates an incomplete or never-initialized project.
 */
export const INIT_DIRS = [".sourcevision", ".rex", ".hench"];

/**
 * Required top-level keys in .hench/config.json.
 *
 * Keys absent from an existing config indicate it was created before those
 * fields were introduced and the project needs re-initialization to pick up
 * the new defaults.
 */
export const REQUIRED_HENCH_KEYS = [
  "schema",
  "provider",
  "model",
  "maxTurns",
  "maxTokens",
  "tokenBudget",
  "rexDir",
  "apiKeyEnv",
  "guard",
  "retry",
  "loopPauseMs",
  "maxFailedAttempts",
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check whether the project in `dir` has a complete and up-to-date n-dx
 * setup. Returns a human-readable notice string when action is needed,
 * or null when the project appears current.
 *
 * @param {string} dir - Project directory to check
 * @param {object} [opts] - Test overrides
 * @param {string} [opts.expectedRexSchema]   - Override expected rex schema
 * @param {string} [opts.expectedSvSchema]    - Override expected sourcevision schema
 * @param {string} [opts.expectedHenchSchema] - Override expected hench schema
 * @returns {string | null}
 */
export function getStaleNotice(dir, opts = {}) {
  const expectedRexSchema = opts.expectedRexSchema ?? EXPECTED_REX_SCHEMA;
  const expectedSvSchema = opts.expectedSvSchema ?? EXPECTED_SV_SCHEMA;
  const expectedHenchSchema = opts.expectedHenchSchema ?? EXPECTED_HENCH_SCHEMA;

  const issues = [];
  let initVersion = null;

  // 1. Check for missing initialization directories
  const missingDirs = INIT_DIRS.filter((d) => !existsSync(join(dir, d)));
  if (missingDirs.length > 0) {
    issues.push({ kind: "missing-dirs", dirs: missingDirs });
  }

  // 2. Check sourcevision manifest schema version
  try {
    const raw = readFileSync(join(dir, ".sourcevision", "manifest.json"), "utf-8");
    const manifest = JSON.parse(raw);
    if (typeof manifest.toolVersion === "string") {
      initVersion = manifest.toolVersion;
    }
    if (
      typeof manifest.schemaVersion === "string" &&
      manifest.schemaVersion !== expectedSvSchema
    ) {
      issues.push({ kind: "schema-mismatch", file: ".sourcevision/manifest.json" });
    }
  } catch {
    // Missing or corrupt — silently skip
  }

  // 3. Check rex PRD schema version
  try {
    const raw = readFileSync(join(dir, ".rex", "prd.json"), "utf-8");
    const prd = JSON.parse(raw);
    if (
      typeof prd.schema === "string" &&
      prd.schema !== expectedRexSchema
    ) {
      issues.push({ kind: "schema-mismatch", file: ".rex/prd.json" });
    }
  } catch {
    // Missing or corrupt — silently skip
  }

  // 4. Check hench config schema and required keys
  try {
    const raw = readFileSync(join(dir, ".hench", "config.json"), "utf-8");
    const henchConfig = JSON.parse(raw);
    if (
      typeof henchConfig.schema === "string" &&
      henchConfig.schema !== expectedHenchSchema
    ) {
      issues.push({ kind: "schema-mismatch", file: ".hench/config.json" });
    }
    const missingKeys = REQUIRED_HENCH_KEYS.filter((k) => !(k in henchConfig));
    if (missingKeys.length > 0) {
      issues.push({ kind: "missing-config-keys", file: ".hench/config.json", keys: missingKeys });
    }
  } catch {
    // Missing or corrupt — silently skip
  }

  if (issues.length === 0) return null;
  return formatNotice(initVersion);
}

// ── Internals ─────────────────────────────────────────────────────────────────

/**
 * Format the human-readable stale-project notification.
 *
 * @param {string | null} initVersion - The n-dx version used to initialize the project
 * @returns {string}
 */
function formatNotice(initVersion) {
  if (initVersion) {
    return `\n  Project was initialized with n-dx ${initVersion} — run ndx init to update`;
  }
  return `\n  Project setup may be out of date — run ndx init to update`;
}

/**
 * Auto re-init detection — checks whether a project's n-dx setup is stale or
 * incomplete and suggests re-initialization.
 *
 * Non-blocking: the check runs synchronously against local files only (no
 * network I/O).  It reads .sourcevision/manifest.json, .rex/prd.json, and
 * .hench/config.json to detect missing directories, schema version mismatches,
 * and missing required config keys.
 *
 * Silent: all errors are swallowed — missing files, parse errors, and
 * permission issues never surface to users beyond the suggestion message.
 *
 * @module n-dx/staleness-check
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Expected schema versions ─────────────────────────────────────────────────
// These must be kept in sync with the schema definitions in each package.
// When a package bumps its schema version, update the corresponding constant
// here to avoid false-positive staleness warnings.

/** Rex PRD schema version prefix (forward-compatible: "rex/v1.x" matches). */
const REX_SCHEMA_PREFIX = "rex/v1";

/** Sourcevision manifest schema version (exact major match). */
const SV_SCHEMA_MAJOR = "1";

/** Hench config schema version prefix (forward-compatible: "hench/v1.x" matches). */
const HENCH_SCHEMA_PREFIX = "hench/v1";

// ── Required directories ─────────────────────────────────────────────────────

const REQUIRED_DIRS = [".sourcevision", ".rex", ".hench"];

// ── Required config keys ─────────────────────────────────────────────────────
// Keys that must exist in .n-dx.json for a fully-configured project.
// When new required keys are added to the config schema, add them here.

const REQUIRED_N_DX_CONFIG_KEYS = ["llm.vendor"];

// ── Exports (for testing) ────────────────────────────────────────────────────

export {
  REX_SCHEMA_PREFIX,
  SV_SCHEMA_MAJOR,
  HENCH_SCHEMA_PREFIX,
  REQUIRED_DIRS,
  REQUIRED_N_DX_CONFIG_KEYS,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Safely read and parse a JSON file. Returns null on any failure.
 * @param {string} filePath
 * @returns {object | null}
 */
function safeReadJSON(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Check whether a schema string is compatible with a known prefix.
 * Matches exact prefix or prefix followed by "." (forward-compatible minor).
 * E.g. "rex/v1" and "rex/v1.2" both match prefix "rex/v1".
 *
 * @param {string | undefined} version
 * @param {string} prefix
 * @returns {boolean}
 */
function isCompatibleSchemaPrefix(version, prefix) {
  if (!version || typeof version !== "string") return false;
  return version === prefix || version.startsWith(prefix + ".");
}

/**
 * Check whether a semver string has the expected major version.
 * E.g. "1.0.0" and "1.2.3" both match major "1".
 *
 * @param {string | undefined} version
 * @param {string} expectedMajor
 * @returns {boolean}
 */
function isCompatibleSemverMajor(version, expectedMajor) {
  if (!version || typeof version !== "string") return false;
  const major = version.split(".")[0];
  return major === expectedMajor;
}

/**
 * Resolve a dotted key path against a nested object.
 * E.g. resolveKeyPath({ llm: { vendor: "claude" } }, "llm.vendor") → "claude"
 *
 * @param {object} obj
 * @param {string} keyPath  Dot-separated path, e.g. "llm.vendor"
 * @returns {*} The value, or undefined if any segment is missing.
 */
function resolveKeyPath(obj, keyPath) {
  let current = obj;
  for (const segment of keyPath.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

// ── Main check ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} StalenessIssue
 * @property {"missing-dir" | "schema-mismatch" | "missing-config-key"} type
 * @property {string} detail  Human-readable detail string.
 */

/**
 * @typedef {object} StalenessResult
 * @property {boolean} isStale        True when at least one issue was found.
 * @property {StalenessIssue[]} issues  List of detected issues.
 * @property {string | undefined} initVersion  The n-dx version from .n-dx.json (if available).
 */

/**
 * Check a project directory for staleness signals.
 *
 * Staleness signals:
 * 1. Missing required directories (.sourcevision/, .rex/, .hench/)
 * 2. Schema version mismatch in manifest.json, prd.json, or hench config.json
 * 3. Missing required config keys in .n-dx.json
 *
 * @param {string} dir  Absolute path to the project directory.
 * @returns {StalenessResult}
 */
export function checkProjectStaleness(dir) {
  /** @type {StalenessIssue[]} */
  const issues = [];

  // ── 1. Missing directories ──────────────────────────────────────────────
  for (const requiredDir of REQUIRED_DIRS) {
    if (!existsSync(join(dir, requiredDir))) {
      issues.push({
        type: "missing-dir",
        detail: `Missing ${requiredDir}/ directory`,
      });
    }
  }

  // ── 2. Schema version mismatches ────────────────────────────────────────

  // Rex PRD
  const prd = safeReadJSON(join(dir, ".rex", "prd.json"));
  if (prd !== null && !isCompatibleSchemaPrefix(prd.schema, REX_SCHEMA_PREFIX)) {
    issues.push({
      type: "schema-mismatch",
      detail: `prd.json schema "${prd.schema ?? "missing"}" — expected "${REX_SCHEMA_PREFIX}"`,
    });
  }

  // Sourcevision manifest
  const manifest = safeReadJSON(join(dir, ".sourcevision", "manifest.json"));
  if (manifest !== null && !isCompatibleSemverMajor(manifest.schemaVersion, SV_SCHEMA_MAJOR)) {
    issues.push({
      type: "schema-mismatch",
      detail: `manifest.json schemaVersion "${manifest.schemaVersion ?? "missing"}" — expected major ${SV_SCHEMA_MAJOR}`,
    });
  }

  // Hench config
  const henchConfig = safeReadJSON(join(dir, ".hench", "config.json"));
  if (henchConfig !== null && !isCompatibleSchemaPrefix(henchConfig.schema, HENCH_SCHEMA_PREFIX)) {
    issues.push({
      type: "schema-mismatch",
      detail: `hench config schema "${henchConfig.schema ?? "missing"}" — expected "${HENCH_SCHEMA_PREFIX}"`,
    });
  }

  // ── 3. Missing required config keys ─────────────────────────────────────

  const ndxConfig = safeReadJSON(join(dir, ".n-dx.json"));
  if (ndxConfig !== null) {
    for (const keyPath of REQUIRED_N_DX_CONFIG_KEYS) {
      const value = resolveKeyPath(ndxConfig, keyPath);
      if (value === undefined || value === null || value === "") {
        issues.push({
          type: "missing-config-key",
          detail: `Missing config key "${keyPath}" in .n-dx.json`,
        });
      }
    }
  }

  // ── Resolve init version for display ────────────────────────────────────
  const initVersion = ndxConfig?._initVersion ?? undefined;

  return {
    isStale: issues.length > 0,
    issues,
    initVersion: typeof initVersion === "string" ? initVersion : undefined,
  };
}

// ── Display ──────────────────────────────────────────────────────────────────

/**
 * Format the staleness notice as a concise, non-intrusive message.
 * Returns plain text — the caller applies ANSI styling (e.g. dim()).
 *
 * @param {StalenessResult} result
 * @param {string} currentVersion  The running @n-dx/core version.
 * @returns {string}
 */
export function formatStalenessNotice(result, currentVersion) {
  if (result.initVersion) {
    return `Project was initialized with n-dx ${result.initVersion} — run \`ndx init\` to update`;
  }
  return `Project setup may be incomplete — run \`ndx init\` to update`;
}

// ── Suppression ──────────────────────────────────────────────────────────────

/**
 * Determine whether the staleness notice should be suppressed.
 *
 * Suppressed when:
 * - The command is "init" itself (user is already re-initializing)
 * - The command exited with an error (user has bigger problems)
 * - stdout is not a TTY (piped / CI / non-interactive)
 * - --quiet / -q was passed
 * - JSON output mode (--json, --format=json)
 *
 * @param {string[]} args    CLI arguments (process.argv.slice(2)).
 * @param {number}   exitCode  The command's exit code.
 * @returns {boolean}
 */
export function shouldSuppressStaleness(args, exitCode) {
  // Suppress during init — user is already fixing things
  const command = args[0];
  if (command === "init") return true;
  // Suppress for help/version (no project context needed)
  if (command === "help" || command === "version" || command === "-v" || command === "--version") return true;
  if (args.includes("--help") || args.includes("-h")) return true;

  if (exitCode !== 0) return true;
  if (!process.stdout.isTTY) return true;
  if (args.includes("--quiet") || args.includes("-q")) return true;
  if (args.includes("--json")) return true;
  if (args.some((a) => a === "--format=json")) return true;
  return false;
}

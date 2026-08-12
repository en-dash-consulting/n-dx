/**
 * Project CLI identity resolution.
 *
 * n-dx can be embedded in any project under any binary name. The resolver
 * reads the target project's package.json `bin` field to determine the
 * installed command name and persists it as `cli.name` in .n-dx.json, where
 * all surfaces that display or execute CLI commands can read it. A manually
 * configured `cli.name` (via `ndx config cli.name <value>` or a direct edit)
 * always wins over auto-detection.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Fallback command name when no bin field (or no package.json) exists. */
export const DEFAULT_CLI_NAME = "ndx";

/**
 * Resolve the installed CLI command name from a parsed package.json object.
 *
 * npm semantics:
 * - `bin` object: keys are the command names — the first key wins.
 * - `bin` string: the command name is the package name (scope stripped).
 * - No usable `bin`: falls back to DEFAULT_CLI_NAME.
 *
 * Pure function — no filesystem access.
 *
 * @param {object|null|undefined} pkg  Parsed package.json contents.
 * @returns {string} The resolved command name.
 */
export function resolveCliName(pkg) {
  if (pkg == null || typeof pkg !== "object") return DEFAULT_CLI_NAME;
  const bin = pkg.bin;
  if (typeof bin === "string" && bin.length > 0) {
    if (typeof pkg.name === "string" && pkg.name.length > 0) {
      const name = pkg.name.startsWith("@")
        ? pkg.name.split("/")[1] ?? ""
        : pkg.name;
      if (name.length > 0) return name;
    }
    return DEFAULT_CLI_NAME;
  }
  if (bin != null && typeof bin === "object" && !Array.isArray(bin)) {
    const first = Object.keys(bin)[0];
    if (first) return first;
  }
  return DEFAULT_CLI_NAME;
}

/**
 * Detect the CLI command name for a project by reading its root package.json.
 * Returns DEFAULT_CLI_NAME when the file is missing or unparseable.
 *
 * @param {string} dir  Project root directory.
 * @returns {string} The detected command name.
 */
export function detectCliName(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return DEFAULT_CLI_NAME;
  try {
    return resolveCliName(JSON.parse(readFileSync(pkgPath, "utf-8")));
  } catch {
    return DEFAULT_CLI_NAME;
  }
}

/**
 * Persist the detected CLI name as `cli.name` in .n-dx.json.
 * Called at the end of `ndx init` alongside recordInitVersion.
 *
 * An existing `cli.name` is a manual override and is never replaced.
 * Errors are silently ignored — this is best-effort metadata.
 *
 * @param {string} dir  Project root directory.
 */
export function recordCliName(dir) {
  const configPath = join(dir, ".n-dx.json");
  try {
    let data = {};
    if (existsSync(configPath)) {
      try { data = JSON.parse(readFileSync(configPath, "utf-8")); } catch { /* ignore */ }
    }
    if (typeof data.cli?.name === "string" && data.cli.name.length > 0) return;
    data.cli = { ...data.cli, name: detectCliName(dir) };
    writeFileSync(configPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch {
    // Non-fatal — failure to record the CLI name doesn't affect init outcome.
  }
}

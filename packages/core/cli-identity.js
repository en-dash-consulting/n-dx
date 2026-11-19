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
import { basename, join } from "node:path";
import { resolveLayout } from "./layout.js";

/** Fallback command name when no bin field (or no package.json) exists. */
export const DEFAULT_CLI_NAME = "n-dx";

/**
 * Resolve the installed CLI command name from a parsed package.json object.
 *
 * npm semantics:
 * - `bin` object: keys are the command names — the first key wins.
 * - `bin` string: the command name is the package name (scope stripped).
 * - No usable `bin`: falls back to `fallback`.
 *
 * Pure function — no filesystem access.
 *
 * @param {object|null|undefined} pkg  Parsed package.json contents.
 * @param {string} [fallback]  Name to use without a usable `bin` (DEFAULT_CLI_NAME).
 * @returns {string} The resolved command name.
 */
export function resolveCliName(pkg, fallback = DEFAULT_CLI_NAME) {
  if (pkg == null || typeof pkg !== "object") return fallback;
  const bin = pkg.bin;
  if (typeof bin === "string" && bin.length > 0) {
    if (typeof pkg.name === "string" && pkg.name.length > 0) {
      const name = pkg.name.startsWith("@")
        ? pkg.name.split("/")[1] ?? ""
        : pkg.name;
      if (name.length > 0) return name;
    }
    return fallback;
  }
  if (bin != null && typeof bin === "object" && !Array.isArray(bin)) {
    const first = Object.keys(bin)[0];
    if (first) return first;
  }
  return fallback;
}

/**
 * The command name of the standalone executable running this process
 * (scripts/build-exe.mjs), when it is a name n-dx answers to.
 *
 * An npm install puts both `ndx` and `n-dx` on PATH, so DEFAULT_CLI_NAME
 * always resolves there. A standalone executable is one file under one name,
 * usually `ndx`; a `.mcp.json` that names `n-dx` would not start. The
 * launcher exports its own path as `NDX_STANDALONE_EXE`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {"ndx" | "n-dx" | null}
 */
export function standaloneCliName(env = process.env) {
  const exe = env.NDX_STANDALONE_EXE;
  if (!exe) return null;
  const name = basename(exe).replace(/\.exe$/i, "").toLowerCase();
  return name === "ndx" || name === "n-dx" ? name : null;
}

/**
 * Detect the CLI command name for a project by reading its root package.json.
 * Without a usable `bin` (or a readable package.json) it is the standalone
 * executable's name when one is running, else DEFAULT_CLI_NAME.
 *
 * @param {string} dir  Project root directory.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} The detected command name.
 */
export function detectCliName(dir, env = process.env) {
  const fallback = standaloneCliName(env) ?? DEFAULT_CLI_NAME;
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return fallback;
  try {
    return resolveCliName(JSON.parse(readFileSync(pkgPath, "utf-8")), fallback);
  } catch {
    return fallback;
  }
}

/**
 * Resolve the CLI command name to use for a project: a manually configured
 * (or previously recorded) `cli.name` in .n-dx.json always wins; otherwise
 * falls back to bin-field auto-detection via {@link detectCliName}.
 *
 * This is the read-side counterpart to `recordCliName` — callers that need
 * the resolved name without persisting anything (e.g. rendering a tracked
 * `.mcp.json`) should use this instead of duplicating the .n-dx.json read.
 *
 * @param {string} dir  Project root directory.
 * @returns {string} The resolved command name.
 */
export function getCliName(dir) {
  const configPath = resolveLayout(dir).configFile;
  if (existsSync(configPath)) {
    try {
      const data = JSON.parse(readFileSync(configPath, "utf-8"));
      const name = data.cli?.name;
      if (typeof name === "string" && name.length > 0) return name;
    } catch { /* fall through to detection */ }
  }
  return detectCliName(dir);
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
  const configPath = resolveLayout(dir).configFile;
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

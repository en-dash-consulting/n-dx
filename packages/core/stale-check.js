/**
 * Detect incomplete n-dx project initialization.
 *
 * Trigger: one or more of the three tool directories (.sourcevision, .rex,
 * .hench) is absent from the project root.  Manifest age, schema version
 * drift, and config key presence are deliberately NOT checked — they produce
 * false positives on healthy, fully-initialized projects.
 *
 * Design goals:
 *  - Synchronous filesystem probe only — never blocks command execution.
 *  - Never throws — errors are silently swallowed.
 *  - Returns structured details for flexible formatting.
 *
 * @module n-dx/stale-check
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

// ── Required directories ──────────────────────────────────────────────────────

/** The three tool directories that must exist for a fully-initialized project. */
const REQUIRED_DIRS = [".sourcevision", ".rex", ".hench"];

export { REQUIRED_DIRS };

// ── Main detection ────────────────────────────────────────────────────────────

/**
 * @typedef {{ kind: "missing-dir", dir: string }} StaleDetail
 */

/**
 * Check whether the project's n-dx setup is incomplete.
 * Returns an entry for each missing tool directory, empty when all are present.
 *
 * @param {string} dir  Project root directory.
 * @returns {StaleDetail[]}
 */
export function checkProjectStaleness(dir) {
  /** @type {StaleDetail[]} */
  const details = [];
  try {
    for (const sub of REQUIRED_DIRS) {
      if (!existsSync(join(dir, sub))) {
        details.push({ kind: "missing-dir", dir: sub });
      }
    }
  } catch { /* outer safety net */ }
  return details;
}

// ── Formatting ────────────────────────────────────────────────────────────────

/**
 * Format a staleness notice for display after command output.
 * Written to stderr so JSON stdout output stays machine-parseable.
 *
 * @param {StaleDetail[]} details
 * @returns {string}
 */
export function formatStalenessNotice(details) {
  const dim = (t) => `\x1b[2m${t}\x1b[22m`;
  const bold = (t) => `\x1b[1m${t}\x1b[22m`;
  const yellow = (t) => `\x1b[33m${t}\x1b[39m`;

  const missing = details.map((d) => d.dir).join(", ");
  return (
    `\n  ${yellow("Project setup incomplete")} — ${dim(missing + " not found")} — run ${bold("ndx init")} to initialize`
  );
}

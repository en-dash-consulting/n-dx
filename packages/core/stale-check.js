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

import { relativeToRoot, resolveLayout } from "./layout.js";

// ── Required directories ──────────────────────────────────────────────────────

/**
 * The three tool directories that must exist for a fully-initialized project,
 * named the way `dir`'s own layout spells them.
 *
 * A *reader* of one project, so it resolves that project's layout rather than
 * accepting both: a `.ndx/` project is not missing `.sourcevision/`, and
 * reporting it as such would tell the operator to re-run `ndx init` on a
 * project that is already complete.
 *
 * @param {string} dir  Project root directory.
 * @returns {string[]}  Root-relative directory names, forward slashes.
 */
export function requiredDirs(dir) {
  const layout = resolveLayout(dir);
  return [layout.sourcevisionDir, layout.rexDir, layout.henchDir].map((p) =>
    relativeToRoot(layout, p),
  );
}

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
    const layout = resolveLayout(dir);
    for (const sub of [layout.sourcevisionDir, layout.rexDir, layout.henchDir]) {
      if (!existsSync(sub)) {
        details.push({ kind: "missing-dir", dir: relativeToRoot(layout, sub) });
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

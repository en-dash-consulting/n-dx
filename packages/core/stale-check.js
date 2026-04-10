/**
 * Detect stale or incomplete n-dx project initialization.
 *
 * Checks:
 * 1. Missing directories (.sourcevision/, .rex/, .hench/)
 * 2. Schema version mismatches in manifest.json, prd.json, or config.json
 * 3. Missing required config keys added in newer n-dx versions
 *
 * Design goals:
 *  - Synchronous file reads only — never blocks command execution.
 *  - Never throws — errors are silently swallowed.
 *  - Returns structured details for flexible formatting.
 *
 * @module n-dx/stale-check
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Expected schema versions ──────────────────────────────────────────────────

const EXPECTED_REX_PRD_SCHEMA = "rex/v1";
const EXPECTED_HENCH_CONFIG_SCHEMA = "hench/v1";
const EXPECTED_SV_SCHEMA_VERSION = "1.0.0";

// ── Required config keys ──────────────────────────────────────────────────────
// Only truly-required keys (not .optional().default() in Zod) are listed.
// These are the fields whose absence would cause a runtime error.

/** Required keys in .rex/config.json */
const REX_CONFIG_REQUIRED_KEYS = ["schema", "project", "adapter"];

/**
 * Required keys in .hench/config.json.
 * Excludes keys with Zod `.optional().default()` (tokenBudget, retry,
 * loopPauseMs, maxFailedAttempts) — those are filled in by the runtime.
 */
const HENCH_CONFIG_REQUIRED_KEYS = [
  "schema",
  "model",
  "maxTurns",
  "maxTokens",
  "rexDir",
  "apiKeyEnv",
  "guard",
];

// ── Main detection ────────────────────────────────────────────────────────────

/**
 * @typedef {{ kind: "missing-dir" | "schema-mismatch" | "missing-key", message: string }} StaleDetail
 */

/**
 * Check whether the project's n-dx setup is stale or incomplete.
 * Returns an empty array when everything looks current.
 *
 * @param {string} dir  Project root directory.
 * @returns {StaleDetail[]}
 */
export function checkProjectStaleness(dir) {
  /** @type {StaleDetail[]} */
  const details = [];
  try {
    // 1. Missing directories
    for (const sub of [".sourcevision", ".rex", ".hench"]) {
      if (!existsSync(join(dir, sub))) {
        details.push({ kind: "missing-dir", message: `Missing ${sub}/ directory` });
      }
    }

    // 2. SourceVision manifest schema
    const svManifest = join(dir, ".sourcevision", "manifest.json");
    if (existsSync(svManifest)) {
      try {
        const m = JSON.parse(readFileSync(svManifest, "utf-8"));
        if (m.schemaVersion && m.schemaVersion !== EXPECTED_SV_SCHEMA_VERSION) {
          details.push({
            kind: "schema-mismatch",
            message: `sourcevision manifest schema ${m.schemaVersion} (expected ${EXPECTED_SV_SCHEMA_VERSION})`,
          });
        }
      } catch { /* malformed JSON — skip */ }
    }

    // 3. Rex PRD schema
    const rexPrd = join(dir, ".rex", "prd.json");
    if (existsSync(rexPrd)) {
      try {
        const p = JSON.parse(readFileSync(rexPrd, "utf-8"));
        if (p.schema && p.schema !== EXPECTED_REX_PRD_SCHEMA) {
          details.push({
            kind: "schema-mismatch",
            message: `rex PRD schema ${p.schema} (expected ${EXPECTED_REX_PRD_SCHEMA})`,
          });
        }
      } catch { /* malformed JSON — skip */ }
    }

    // 4. Rex config required keys
    const rexConfig = join(dir, ".rex", "config.json");
    if (existsSync(rexConfig)) {
      try {
        const r = JSON.parse(readFileSync(rexConfig, "utf-8"));
        for (const key of REX_CONFIG_REQUIRED_KEYS) {
          if (!(key in r)) {
            details.push({
              kind: "missing-key",
              message: `.rex/config.json missing required key: ${key}`,
            });
          }
        }
      } catch { /* malformed JSON — skip */ }
    }

    // 5. Hench config schema + required keys
    const henchConfig = join(dir, ".hench", "config.json");
    if (existsSync(henchConfig)) {
      try {
        const h = JSON.parse(readFileSync(henchConfig, "utf-8"));
        if (h.schema && h.schema !== EXPECTED_HENCH_CONFIG_SCHEMA) {
          details.push({
            kind: "schema-mismatch",
            message: `hench config schema ${h.schema} (expected ${EXPECTED_HENCH_CONFIG_SCHEMA})`,
          });
        }
        for (const key of HENCH_CONFIG_REQUIRED_KEYS) {
          if (!(key in h)) {
            details.push({
              kind: "missing-key",
              message: `.hench/config.json missing required key: ${key}`,
            });
          }
        }
      } catch { /* malformed JSON — skip */ }
    }
  } catch { /* outer safety net */ }

  return details;
}

/**
 * Format a staleness notice for display after command output.
 * Written to stderr so JSON stdout output stays machine-parseable.
 *
 * @param {StaleDetail[]} details
 * @param {{ initVersion?: string | null }} [opts]
 * @returns {string}
 */
export function formatStalenessNotice(details, { initVersion } = {}) {
  const dim = (t) => `\x1b[2m${t}\x1b[22m`;
  const bold = (t) => `\x1b[1m${t}\x1b[22m`;
  const yellow = (t) => `\x1b[33m${t}\x1b[39m`;

  const versionHint = initVersion ? ` ${dim(`(initialized with n-dx ${initVersion})`)}` : "";
  const header =
    `\n  ${yellow("Project setup is stale")}${versionHint} — run ${bold("ndx init")} to update:`;
  const items = details.map((d) => `    ${dim("•")} ${d.message}`).join("\n");
  return `${header}\n${items}`;
}

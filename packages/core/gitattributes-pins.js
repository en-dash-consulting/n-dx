/**
 * Canonical LF eol=lf pins for files that n-dx tools rewrite.
 *
 * Each n-dx-written file needs an `eol=lf` pin so a Windows checkout
 * (`core.autocrlf=true`) doesn't show line-ending-only churn after every tool
 * write. This list is the single source of truth, imported by:
 *
 *   - `cli.js` (`ensureGitattributesRules`) — injects the pins into a consumer
 *     project's `.gitattributes` during `ndx init`.
 *   - n-dx's own `.gitattributes` — which must contain the same pattern set so
 *     n-dx dogfoods its own pins. That equality is enforced by a sync-guard
 *     test (`tests/e2e/prd-line-endings.test.js`); the root cause of the pins
 *     shipping incomplete was the two drifting apart, so the guard treats any
 *     divergence as a failure.
 *
 * See https://github.com/en-dash-consulting/n-dx/issues/283.
 *
 * @module n-dx/gitattributes-pins
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

/** @type {string[]} */
export const GITATTRIBUTES_EOL_RULES = [
  ".rex/**/*.md    text eol=lf",
  ".rex/**/*.json  text eol=lf",
  ".rex/**/*.jsonl text eol=lf",
  ".hench/**/*.md   text eol=lf",
  ".hench/**/*.json text eol=lf",
  ".sourcevision/**/*.md   text eol=lf",
  ".sourcevision/**/*.json text eol=lf",
  ".sourcevision/**/*.txt  text eol=lf",
  ".n-dx.json text eol=lf",
  "AGENTS.md  text eol=lf",
  "CLAUDE.md  text eol=lf",
  ".agents/**/*.md text eol=lf",
  ".claude/skills/**/*.md text eol=lf",
  ".codex/config.toml text eol=lf",
];

export const GITATTRIBUTES_EOL_HEADER =
  "# n-dx tools write these files with LF. Pin them so Windows checkouts\n" +
  "# (core.autocrlf=true) don't show line-ending-only churn on every tool write.\n";

/**
 * Merge-driver pins: PRD tree files merge through the rex-prd driver — a
 * three-way, frontmatter-aware merge (`rex merge-driver`). The driver itself
 * is registered in git config by `ndx init` (see `ensureMergeDriverRegistered`
 * in cli.js); this attribute routes the paths to it.
 *
 * @type {string[]}
 */
export const GITATTRIBUTES_MERGE_RULES = [
  ".rex/prd_tree/** merge=rex-prd",
];

export const GITATTRIBUTES_MERGE_HEADER =
  "# PRD tree markdown merges through the rex-prd driver (three-way,\n" +
  "# frontmatter-aware). The driver is registered in git config by 'ndx init'.\n";

/** git config values for the rex-prd merge driver, registered by `ndx init`. */
export const MERGE_DRIVER_CONFIG = {
  name: { key: "merge.rex-prd.name", value: "n-dx PRD tree merge" },
  driver: { key: "merge.rex-prd.driver", value: "rex merge-driver %O %A %B" },
};

/**
 * The glob pattern (first token) of each eol=lf rule — the canonical pattern
 * set the repo's own `.gitattributes` must match.
 *
 * @returns {Set<string>}
 */
export function getEolPatternSet() {
  return new Set(GITATTRIBUTES_EOL_RULES.map((rule) => rule.trim().split(/\s+/)[0]));
}

/**
 * Append missing n-dx rules (eol=lf pins and the rex-prd merge pin) to the
 * project's .gitattributes.
 * Creates the file if it doesn't exist. Idempotent: a rule is skipped when a
 * line for its pattern is already present (even with different attributes,
 * so user overrides win). Existing content is never modified.
 *
 * @param {string} dir  Project root directory
 */
export function ensureGitattributesRules(dir) {
  const attrPath = join(dir, ".gitattributes");
  let content = "";
  try {
    content = readFileSync(attrPath, "utf-8");
  } catch {
    // No .gitattributes yet
  }

  const sections = [
    {
      rules: GITATTRIBUTES_EOL_RULES,
      header: GITATTRIBUTES_EOL_HEADER,
      headerMarker: "n-dx tools write these files with LF",
    },
    {
      rules: GITATTRIBUTES_MERGE_RULES,
      header: GITATTRIBUTES_MERGE_HEADER,
      headerMarker: "merges through the rex-prd driver",
    },
  ];

  let changed = false;
  for (const { rules, header, headerMarker } of sections) {
    const existingPatterns = new Set(
      content.split("\n").map((line) => line.trim().split(/\s+/)[0]).filter(Boolean),
    );
    const missing = rules.filter((rule) => !existingPatterns.has(rule.split(/\s+/)[0]));
    if (missing.length === 0) continue;
    const sectionHeader = content.includes(headerMarker) ? "" : header;
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    content = content + prefix + sectionHeader + missing.join("\n") + "\n";
    changed = true;
  }

  if (changed) writeFileSync(attrPath, content, "utf-8");
}

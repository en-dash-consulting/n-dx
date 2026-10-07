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

import { relativeToRoot, resolveLayout } from "./layout.js";

/**
 * File-type suffixes to pin under each tool directory, in the order the rules
 * are written. Which *directory* they hang off is the layout's answer, not
 * this module's — see {@link gitattributesEolRules}.
 */
const EOL_TOOL_SUFFIXES = {
  // `yaml`: the v2 trees' per-folder `state.yaml` under `<rexDir>/product` and `<rexDir>/changes`.
  rexDir: ["md", "json", "jsonl", "yaml"],
  henchDir: ["md", "json"],
  sourcevisionDir: ["md", "json", "txt"],
};

/** Pins for files that sit at the project root on either layout. */
const EOL_FIXED_RULES = [
  "AGENTS.md  text eol=lf",
  "CLAUDE.md  text eol=lf",
  ".agents/**/*.md text eol=lf",
  ".claude/skills/**/*.md text eol=lf",
  ".codex/config.toml text eol=lf",
];

/**
 * The eol=lf pins for a project, named for the layout it is on.
 *
 * The patterns have to follow the files: a `.rex/**` pin on a project whose PRD
 * lives in `.ndx/rex/` matches nothing, which is indistinguishable from having
 * no pin at all until a Windows checkout rewrites every PRD file's line endings.
 *
 * @param {import("./layout.js").Layout} layout
 * @returns {string[]}
 */
export function gitattributesEolRules(layout) {
  const rules = [];
  for (const [field, suffixes] of Object.entries(EOL_TOOL_SUFFIXES)) {
    const dir = relativeToRoot(layout, layout[field]);
    for (const suffix of suffixes) rules.push(`${dir}/**/*.${suffix} text eol=lf`);
  }
  rules.push(`${relativeToRoot(layout, layout.configFile)} text eol=lf`);
  return [...rules, ...EOL_FIXED_RULES];
}

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
export function gitattributesMergeRules(layout) {
  return [`${relativeToRoot(layout, layout.rexDir)}/prd_tree/** merge=rex-prd`];
}

export const GITATTRIBUTES_MERGE_HEADER =
  "# PRD tree markdown merges through the rex-prd driver (three-way,\n" +
  "# frontmatter-aware). The driver is registered in git config by 'ndx init'.\n";

/** git config values for the rex-prd merge driver, registered by `ndx init`. */
export const MERGE_DRIVER_CONFIG = {
  name: { key: "merge.rex-prd.name", value: "n-dx PRD tree merge" },
  driver: { key: "merge.rex-prd.driver", value: "rex merge-driver %O %A %B" },
};

/**
 * The glob pattern (first token) of each eol=lf rule `ndx init` would write
 * into `dir` — the canonical pattern set n-dx's own `.gitattributes` must
 * match, asserted by `tests/e2e/prd-line-endings.test.js`.
 *
 * Returns a list rather than a Set so the guard can also catch a duplicate
 * pattern, which a Set would silently absorb.
 *
 * @param {string} dir  Project root whose layout names the patterns.
 * @returns {string[]}
 */
export function eolPatternsFor(dir) {
  return gitattributesEolRules(resolveLayout(dir)).map((rule) => rule.trim().split(/\s+/)[0]);
}

/**
 * Append missing n-dx rules (eol=lf pins and the rex-prd merge pin) to the
 * project's .gitattributes.
 * Creates the file if it doesn't exist. Idempotent: a rule is skipped when a
 * line for its pattern is already present (even with different attributes,
 * so user overrides win). Existing content is never modified.
 *
 * @param {string} dir  Project root directory
 * @param {import("./layout.js").Layout} [layout]  The layout the patterns name.
 *   Defaults to detecting it. `ndx init` passes the layout it just established,
 *   because on a brand-new project the container is created and the pins are
 *   written in the same breath and re-detecting would be asking a question
 *   already answered.
 */
export function ensureGitattributesRules(dir, layout = resolveLayout(dir)) {
  const attrPath = join(dir, ".gitattributes");
  let content = "";
  try {
    content = readFileSync(attrPath, "utf-8");
  } catch {
    // No .gitattributes yet
  }

  const sections = [
    {
      rules: gitattributesEolRules(layout),
      header: GITATTRIBUTES_EOL_HEADER,
      headerMarker: "n-dx tools write these files with LF",
    },
    {
      rules: gitattributesMergeRules(layout),
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

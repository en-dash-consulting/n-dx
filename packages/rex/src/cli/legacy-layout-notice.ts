/**
 * The v1 deprecation notice: one line on stderr when a rex command runs on a
 * v1 PRD (`prd_tree/` present, no `product/`), naming `ndx migrate`.
 *
 * v1 keeps working this release; the next one refuses it (decision D5). The
 * line goes through `warn`, so `--quiet` drops it and `--format=json` stdout
 * never carries it. Commands that create, convert or serve the tree, that
 * git or the release pipeline runs, or that are v2-only, print nothing: the notice would be noise there, or (`mcp`) land
 * in a client's log once per session. `ndx migrate` sets
 * {@link LEGACY_NOTICE_ENV}=off for the rex commands it spawns, which would
 * otherwise tell the operator to run the command already running.
 *
 * @module rex/cli/legacy-layout-notice
 */

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRD_TREE_DIRNAME, resolveRexPaths } from "../store/index.js";
import { PRODUCT_DIRNAME } from "../store/prd-model-reader.js";
import { warn } from "./output.js";

export const LEGACY_LAYOUT_NOTICE =
  "Deprecated: this PRD uses the v1 layout (prd_tree/). Run 'ndx migrate' to move it to v2; the next release refuses v1 PRDs.";

/** Set to `off` to silence the notice (packages/core/migrate-chain.js spells it out: core spawns rex, never imports it). */
export const LEGACY_NOTICE_ENV = "NDX_LEGACY_NOTICE";

/** Commands that print no notice. */
const SILENT_COMMANDS: ReadonlySet<string> = new Set([
  "init", "mcp", "migrate", "migrate-to-md", "migrate-to-folder-tree", "migrate-folder-tree-filenames", "migrate-slugs",
  "merge-driver", "merge-state", "parse-md", "product", "change",
  // `release stamp` runs in the release pipeline and reports a v1 tree itself.
  "release",
]);

function isDir(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** Whether the project at `dir` keeps a v1 tree and no v2 one. */
export function isLegacyLayout(dir: string): boolean {
  const { rexDir } = resolveRexPaths(dir);
  return isDir(join(rexDir, PRD_TREE_DIRNAME)) && !isDir(join(rexDir, PRODUCT_DIRNAME));
}

/**
 * Print {@link LEGACY_LAYOUT_NOTICE} for `command` when its project is on v1.
 * The project is the last positional when that is a directory (commands such
 * as `update <id>` take an id there), else the working directory.
 */
export function noteLegacyLayout(command: string, positional: readonly string[]): void {
  if (SILENT_COMMANDS.has(command) || process.env[LEGACY_NOTICE_ENV] === "off") return;
  const last = positional[positional.length - 1];
  const dir = last !== undefined && isDir(last) ? resolve(last) : process.cwd();
  if (isLegacyLayout(dir)) warn(LEGACY_LAYOUT_NOTICE);
}

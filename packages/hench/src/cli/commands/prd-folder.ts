/**
 * A PRD folder that does not exist is not a v1 project.
 *
 * `resolveStore` falls back to the v1 store for any folder without `product/`,
 * including one that is not there at all. Commands that read the PRD check the
 * folder first, so a missing one is reported as missing, with where it was
 * looked for and where the project's layout expects it.
 *
 * @module hench/cli/commands/prd-folder
 */

import { existsSync } from "node:fs";
import { relative } from "node:path";
import { resolveLayout } from "../../prd/llm-gateway.js";
import { CLIError } from "../errors.js";

/** The path as the operator reads it: relative to the project when inside it. */
function shown(root: string, path: string): string {
  const rel = relative(root, path);
  return rel && !rel.startsWith("..") ? rel : path;
}

/**
 * @param root    Absolute project root.
 * @param rexDir  The resolved rex directory the command is about to read.
 * @throws {CLIError} When `rexDir` does not exist.
 */
export function assertPrdFolderExists(root: string, rexDir: string): void {
  if (existsSync(rexDir)) return;
  const expected = resolveLayout(root).rexDir;
  throw new CLIError(
    `No PRD folder at ${shown(root, rexDir)}.`,
    expected === rexDir
      ? `This project's layout keeps the PRD at ${shown(root, expected)}. Run "ndx init ." to create one.`
      : `This project's layout expects the PRD at ${shown(root, expected)}; hench's rexDir setting points elsewhere. ` +
        "Fix rexDir in the hench config, or remove it to follow the layout.",
  );
}

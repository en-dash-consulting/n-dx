/**
 * `rex merge-driver <ancestor> <ours> <theirs>` — git merge driver entry point.
 *
 * Git invokes the driver with three temp-file paths (%O %A %B) and expects the
 * merge result written back to the OURS path (%A). Exit 0 marks the path
 * merged; any other exit marks it conflicted, with whatever the driver left in
 * %A — here, the partial merge with standard conflict markers on exactly the
 * fields that genuinely conflict.
 *
 * Registration (done by `ndx init`, or by hand):
 *   git config merge.rex-prd.name   "n-dx PRD tree merge"
 *   git config merge.rex-prd.driver "rex merge-driver %O %A %B"
 *   # .gitattributes: .rex/prd_tree/** merge=rex-prd
 *
 * @module rex/cli/commands/merge-driver
 */

import { readFile, writeFile } from "node:fs/promises";
import { mergePrdMarkdown } from "../../core/merge-driver.js";
import { CLIError } from "../errors.js";
import { warn } from "../output.js";

export async function cmdMergeDriver(positional: string[]): Promise<void> {
  const [ancestorPath, oursPath, theirsPath] = positional;
  if (!ancestorPath || !oursPath || !theirsPath) {
    throw new CLIError(
      "merge-driver needs three file paths: <ancestor> <ours> <theirs>.",
      'Register it as: git config merge.rex-prd.driver "rex merge-driver %O %A %B"',
    );
  }

  const [ancestor, ours, theirs] = await Promise.all([
    readMaybe(ancestorPath),
    readMaybe(oursPath),
    readMaybe(theirsPath),
  ]);

  const { merged, conflicts } = mergePrdMarkdown(ancestor, ours, theirs);
  await writeFile(oursPath, merged, "utf-8");

  if (conflicts.length > 0) {
    // Git shows driver stderr next to the "CONFLICT" line — name the fields.
    warn(`rex-prd merge: unresolved conflict${conflicts.length === 1 ? "" : "s"} in ${conflicts.join(", ")}`);
    process.exitCode = 1;
  }
}

/** Read a merge-stage file; a missing side (add/add, delete) reads as empty. */
async function readMaybe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

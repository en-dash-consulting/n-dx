/**
 * `rex merge-state <ancestor> <ours> <theirs> [path]` — git merge driver for
 * a v2 `state.yaml`, merging rows by item id (see `store/state-merge.ts`).
 *
 * Git passes three temp-file paths (%O %A %B) and the file's path (%P), and
 * expects the result written back to %A. Exit 0 marks the path merged; any
 * other exit marks it conflicted, with markers on exactly the fields that
 * conflict.
 *
 * `path` locates the folder whose product nodes' specs recompute a divergent
 * `metAt`. Git runs the driver from the work tree root before it writes any
 * merged file there, so those specs are our side's. A `metAt` recomputed
 * against them can read revised after the merge, never met when it is not.
 * Without `path` a divergent `metAt` conflicts.
 *
 * Registration (done by `ndx init`, or by hand):
 *   git config merge.rex-state.name   "n-dx PRD state merge"
 *   git config merge.rex-state.driver "rex merge-state %O %A %B %P"
 *   # .gitattributes: .rex/product/**\/state.yaml merge=rex-state (and changes/)
 *
 * @module rex/cli/commands/merge-state
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mergeStateYaml, readFolderSpecs } from "../../store/state-merge.js";
import { CLIError } from "../errors.js";
import { warn } from "../output.js";

export async function cmdMergeState(positional: string[]): Promise<void> {
  const [ancestorPath, oursPath, theirsPath, path] = positional;
  if (!ancestorPath || !oursPath || !theirsPath) {
    throw new CLIError(
      "merge-state needs three file paths: <ancestor> <ours> <theirs> [path].",
      'Register it as: git config merge.rex-state.driver "rex merge-state %O %A %B %P"',
    );
  }

  const [ancestor, ours, theirs] = await Promise.all([readMaybe(ancestorPath), readMaybe(oursPath), readMaybe(theirsPath)]);
  const specs = path ? await readFolderSpecs(dirname(resolve(path))) : undefined;

  const { merged, conflicts } = mergeStateYaml(ancestor, ours, theirs, { specs });
  await writeFile(oursPath, merged, "utf-8");

  if (conflicts.length > 0) {
    warn(`rex-state merge${path ? ` of ${path}` : ""}: unresolved conflict${conflicts.length === 1 ? "" : "s"} in ${conflicts.join(", ")}`);
    process.exitCode = 1;
  }
}

/** Read a merge-stage file; a missing side (add/add, delete) reads as empty. */
async function readMaybe(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

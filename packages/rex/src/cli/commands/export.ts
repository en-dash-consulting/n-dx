/**
 * `rex export` — write the whole PRD to a single portable JSON bundle.
 *
 * The bundle is a transport artifact, not a PRD backend: it goes to an
 * operator-chosen path outside `.rex/prd_tree/` and nothing in rex ever reads
 * it as storage. See `../../core/prd-bundle.ts` for the format and the
 * carve-out rationale.
 *
 * Not to be confused with `ndx export`, which publishes the static dashboard.
 */

import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { mkdir } from "node:fs/promises";
import { resolveStore, PRD_TREE_DIRNAME, resolveGitBranch } from "../../store/index.js";
import { atomicWriteJSON } from "../../store/atomic-write.js";
import { captureGitCommitHash } from "../../core/git-utils.js";
import { buildBundle, countItems } from "../../core/prd-bundle.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info } from "../output.js";

/**
 * Reject an output path inside the folder tree.
 *
 * A bundle written into `.rex/prd_tree/` would sit in the one directory the
 * PRD invariant reserves for markdown, where the next tree write would treat
 * it as junk (or, worse, a future reader would treat it as storage).
 */
function assertOutsideTree(outPath: string, dir: string): void {
  const treeRoot = join(dir, REX_DIR, PRD_TREE_DIRNAME);
  const rel = relative(treeRoot, outPath);
  const inside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (inside) {
    throw new CLIError(
      `Refusing to write a bundle inside ${REX_DIR}/${PRD_TREE_DIRNAME}/.`,
      "The bundle is a transport artifact — pick a path outside the PRD tree, e.g. --out=./prd-bundle.json",
    );
  }
}

export async function cmdExport(dir: string, flags: Record<string, string>): Promise<void> {
  const out = flags.out;
  if (!out || out === "true") {
    throw new CLIError(
      "Missing --out path.",
      "Usage: rex export --out=<path.json> [dir]",
    );
  }

  // Resolved against the caller's cwd, not the project dir: an operator typing
  // `--out=bundle.json` means "here", the same as every other CLI.
  const outPath = resolve(out);
  assertOutsideTree(outPath, dir);

  const store = await resolveStore(join(dir, REX_DIR));
  const doc = await store.loadDocument();

  const bundle = buildBundle(doc, {
    branch: resolveGitBranch(dir),
    commit: await captureGitCommitHash(dir),
  });

  await mkdir(dirname(outPath), { recursive: true });
  await atomicWriteJSON(outPath, bundle);

  const items = countItems(bundle.items);

  if (flags.format === "json") {
    result(JSON.stringify({ out: outPath, items, schema: bundle.schema, exportedAt: bundle.exportedAt }, null, 2));
    return;
  }

  result(`Exported ${items} item${items === 1 ? "" : "s"} to ${outPath}`);
  info(`Import elsewhere with: rex import-bundle --in=${out}`);
}

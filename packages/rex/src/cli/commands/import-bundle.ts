/**
 * `rex import-bundle` — reconstruct the PRD tree from a portable JSON bundle.
 *
 * ## Why not `rex import`
 *
 * `rex import` is a long-standing alias for `rex analyze` (proposal generation
 * from a spec file), pinned by `tests/e2e/cli-import.test.ts` and the CLI help
 * contract. Taking that name for bundle import would break it, so the bundle
 * importer carries its own. The symmetric operator-facing pair lives one tier
 * up as `ndx prd export` / `ndx prd import`.
 *
 * ## Write discipline
 *
 * The bundle is parsed and version-gated *before* the store is touched, so a
 * rejected bundle leaves the tree untouched. The tree is snapshotted before
 * the write (`ensureSnapshot`, undone with `rex restore`), and on `--replace`
 * the discarded items are additionally archived to `.rex/archive.json` — the
 * whole-tree wipe is the one loss this command can cause that nothing else
 * would remember. The merge itself runs inside `store.withTransaction`, which
 * holds the PRD lock across the whole read-modify-write — a concurrent writer
 * cannot interleave with an import.
 *
 * A successful import also appends a `bundle_imported` entry to
 * `.rex/execution-log.jsonl`. That is an audit record rather than a third
 * recovery mechanism: the snapshot and the archive exist to get items back,
 * while the log answers what ran, in which direction, and from where — none of
 * which the resulting tree records.
 */

import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { resolveStore } from "../../store/index.js";
import { parseBundle, mergeBundle, countItems, BundleError } from "../../core/prd-bundle.js";
import type { ImportMode, MergeOutcome, PRDBundle } from "../../core/prd-bundle.js";
import type { PRDItem } from "../../schema/index.js";
import { appendArchiveBatch } from "../../core/archive.js";
import { ensureSnapshot } from "../snapshot-guard.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info, warn } from "../output.js";

/** `3 items` / `1 item` — the log detail reads like the command's own output. */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Ask before discarding the local tree. Non-interactive callers must pass --yes. */
async function confirmReplace(itemCount: number): Promise<boolean> {
  if (!process.stdin.isTTY) return false;

  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((res) => {
      rl.question(
        `Replace the existing PRD (${itemCount} item${itemCount === 1 ? "" : "s"}) with the bundle? [y/N] `,
        res,
      );
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function readBundleFile(path: string): Promise<PRDBundle> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new CLIError(
      `Cannot read bundle at ${path}.`,
      "Check the path passed to --in.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CLIError(
      `Bundle at ${path} is not valid JSON: ${(err as Error).message}`,
      "Re-export it with: rex export --out=<path>",
    );
  }

  try {
    return parseBundle(parsed);
  } catch (err) {
    if (err instanceof BundleError) {
      throw new CLIError(err.message, "Nothing was written to the PRD.");
    }
    throw err;
  }
}

function reportOutcome(
  outcome: MergeOutcome,
  bundle: PRDBundle,
  mode: ImportMode,
  isJson: boolean,
): void {
  const differing = outcome.collisions.filter((c) => c.kind === "differing");

  if (isJson) {
    result(
      JSON.stringify(
        {
          mode,
          added: outcome.added,
          replaced: outcome.replaced,
          collisions: outcome.collisions,
          schema: bundle.schema,
          exportedAt: bundle.exportedAt,
          exportedFrom: bundle.exportedFrom,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (mode === "replace") {
    result(`Replaced ${outcome.replaced} item${outcome.replaced === 1 ? "" : "s"} with ${outcome.added} from the bundle`);
    return;
  }

  result(`Imported ${outcome.added} new item${outcome.added === 1 ? "" : "s"}`);

  if (differing.length > 0) {
    warn(
      `${differing.length} item${differing.length === 1 ? "" : "s"} already exist locally with different content — the local copy was kept:`,
    );
    for (const collision of differing) {
      warn(`  ${collision.id}  ${collision.title}`);
    }
    info("Use --replace to overwrite the tree with the bundle instead.");
  }
}

export async function cmdImportBundle(dir: string, flags: Record<string, string>): Promise<void> {
  const input = flags.in;
  if (!input || input === "true") {
    throw new CLIError(
      "Missing --in path.",
      "Usage: rex import-bundle --in=<path.json> [--replace] [--yes] [dir]",
    );
  }

  const mode: ImportMode = flags.replace === "true" ? "replace" : "merge";
  // Resolved against the caller's cwd — see the note in export.ts.
  const bundle = await readBundleFile(resolve(input));

  const rexDir = join(dir, REX_DIR);
  const store = await resolveStore(rexDir);

  // Confirmation happens before the transaction so the lock is not held while
  // waiting on a human. Help documents `--yes, -y`; honour both.
  const autoConfirm = flags.yes === "true" || flags.y === "true";
  if (mode === "replace" && !autoConfirm) {
    const existing = await store.loadDocument();
    // The whole tree, not `existing.items.length`. This prompt is the operator's
    // last chance to stop an irreversible wipe, and the top-level count reads as
    // a fraction of the loss: 3 epics holding 240 descendants asked to replace
    // "3 items" and then reported "Replaced 240 items". `countItems` is what
    // `mergeBundle` uses for the `replaced` count reported afterwards, so the
    // number agreed to and the number charged cannot disagree.
    const confirmed = await confirmReplace(countItems(existing.items));
    if (!confirmed) {
      throw new CLIError(
        "Replace declined — nothing was written.",
        "Pass --yes to replace the PRD non-interactively.",
      );
    }
  }

  // Snapshot before the tree is rewritten so `rex restore` can undo the
  // import — on --replace this is the only local copy of the outgoing tree.
  // Taken after the confirmation, not before: a declined replace must not
  // burn a slot in the snapshot retention cap. Fails closed, like every
  // other tree-rewriting command (see cli/snapshot-guard.ts).
  await ensureSnapshot(rexDir, "import-bundle", flags);

  let discarded: PRDItem[] = [];
  const outcome = await store.withTransaction(async (doc) => {
    // Adopt the bundle's title when replacing, and when merging into a project
    // that has no items yet: a freshly initialised PRD carries a placeholder
    // title, and keeping it would mean an import into an empty project did not
    // actually reproduce the source.
    const wasEmpty = doc.items.length === 0;
    if (mode === "replace") discarded = doc.items;
    const merged = mergeBundle(doc.items, bundle, mode);
    doc.items = merged.items;
    if (mode === "replace" || wasEmpty) doc.title = bundle.title;
    return merged;
  });

  // The snapshot covers rollback; the archive batch covers recovering an
  // individual item after the snapshot has aged out of the retention cap —
  // the same double record prune and reshape keep.
  if (discarded.length > 0) {
    await appendArchiveBatch(rexDir, {
      timestamp: new Date().toISOString(),
      source: "import",
      items: discarded,
      count: countItems(discarded),
      reason: "Local tree discarded by import-bundle --replace",
    });
  }

  // Recorded after the write, so a rejected bundle or a declined replace —
  // both of which throw above — leaves the log as silent as it left the tree.
  // `appendLog` stamps the actor, which supplies the "who" half; the rest is
  // what an operator reading the log afterwards cannot reconstruct from the
  // tree alone: which direction the import ran, how much it moved, and which
  // project and commit the items came from.
  await store.appendLog({
    timestamp: new Date().toISOString(),
    event: "bundle_imported",
    detail:
      mode === "replace"
        ? `Replaced ${plural(outcome.replaced, "item")} with ${outcome.added} from ${input}`
        : `Imported ${plural(outcome.added, "new item")} from ${input}, ` +
          `${outcome.collisions.length} already present`,
    mode,
    added: outcome.added,
    replaced: outcome.replaced,
    collisions: outcome.collisions.length,
    bundleExportedAt: bundle.exportedAt,
    ...(bundle.exportedFrom ? { exportedFrom: bundle.exportedFrom } : {}),
  });

  reportOutcome(outcome, bundle, mode, flags.format === "json");
}

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
 * rejected bundle leaves the tree untouched. The merge itself runs inside
 * `store.withTransaction`, which holds the PRD lock across the whole
 * read-modify-write — a concurrent writer cannot interleave with an import.
 */

import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { resolveStore } from "../../store/index.js";
import { parseBundle, mergeBundle, BundleError } from "../../core/prd-bundle.js";
import type { ImportMode, MergeOutcome, PRDBundle } from "../../core/prd-bundle.js";
import { REX_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info, warn } from "../output.js";

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

  const store = await resolveStore(join(dir, REX_DIR));

  // Confirmation happens before the transaction so the lock is not held while
  // waiting on a human.
  if (mode === "replace" && flags.yes !== "true") {
    const existing = await store.loadDocument();
    const confirmed = await confirmReplace(existing.items.length);
    if (!confirmed) {
      throw new CLIError(
        "Replace declined — nothing was written.",
        "Pass --yes to replace the PRD non-interactively.",
      );
    }
  }

  const outcome = await store.withTransaction(async (doc) => {
    // Adopt the bundle's title when replacing, and when merging into a project
    // that has no items yet: a freshly initialised PRD carries a placeholder
    // title, and keeping it would mean an import into an empty project did not
    // actually reproduce the source.
    const wasEmpty = doc.items.length === 0;
    const merged = mergeBundle(doc.items, bundle, mode);
    doc.items = merged.items;
    if (mode === "replace" || wasEmpty) doc.title = bundle.title;
    return merged;
  });

  reportOutcome(outcome, bundle, mode, flags.format === "json");
}

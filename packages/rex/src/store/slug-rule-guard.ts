/**
 * The write-time half of the slug-rule guard.
 *
 * `rex validate` catches a non-conformant tree at review time. That is one
 * check too late: on 2026-09-17 a build whose slug rule differed from main
 * rewrote 1,570 paths, and the rewrite was already committed by the time
 * anything looked at it. The renames are lossless and the item fields are
 * untouched, so nothing downstream can tell a re-slug from a normal save.
 *
 * The only moment a foreign build can be stopped is *before* it writes. But it
 * cannot be asked to notice that its own output is wrong — from inside that
 * build the output is correct by construction. It can only be told that the
 * tree in front of it was written by something else. So the tree records which
 * rule wrote it, and every writer checks that marker against its own
 * {@link SLUG_RULE_VERSION} before touching a file.
 *
 * Three states, and the third is the one that matters:
 *
 * - **Marker equals this build's version.** The common case. Proceed.
 * - **Marker differs.** Refuse the whole save. Either this build is stale or
 *   the tree is; the guard cannot tell which, and does not need to.
 * - **Marker absent.** Every tree written before this guard existed. Refusing
 *   these outright would break every existing checkout, so the tree is judged
 *   on its paths instead: conformant means adopt it and write the marker,
 *   non-conformant means refuse exactly as a mismatch would. The path scan is
 *   the expensive branch, and it runs at most once per tree — the save it
 *   permits writes the marker, and every save after that takes the cheap one.
 *
 * `rex migrate-slugs` is the sole sanctioned way past a refusal: it rewrites
 * the tree under this build's rule and adopts the marker in the same locked
 * write, so there is no window in which the marker claims a rule the paths do
 * not follow.
 *
 * @module store/slug-rule-guard
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PRDItem } from "../schema/index.js";
import {
  SLUG_RULE_VERSION,
  findNonConformingSlugs,
  type SlugMismatch,
} from "./folder-tree-serializer.js";
import { parseTreeMeta } from "./tree-meta.js";
import { TREE_META_FILENAME } from "./paths.js";

/** How many offending paths a refusal lists before it stops. */
const SAMPLE_LIMIT = 5;

/**
 * A save refused because the tree was written under a different slug rule.
 *
 * Typed so callers can tell a guard refusal from an I/O failure — a refusal
 * means the tree is intact and untouched, which is the opposite of what a
 * failed write implies.
 */
export class SlugRuleMismatchError extends Error {
  /** Marker found in `tree-meta.json`, or `undefined` when absent. */
  readonly found: number | undefined;
  /** Slug rule this build implements. */
  readonly expected: number;
  /** Sample of offending paths, when the refusal came from a path scan. */
  readonly mismatches: readonly SlugMismatch[];

  constructor(
    message: string,
    found: number | undefined,
    expected: number,
    mismatches: readonly SlugMismatch[] = [],
  ) {
    super(message);
    this.name = "SlugRuleMismatchError";
    this.found = found;
    this.expected = expected;
    this.mismatches = mismatches;
  }
}

/**
 * Read the `slugRule` marker from `<rexDir>/tree-meta.json`.
 *
 * `undefined` covers both "no sidecar" and "sidecar without the field" — a
 * tree older than the marker, in either case. Unreadable JSON also lands here
 * via {@link parseTreeMeta}, which is deliberate: a damaged sidecar must not
 * be read as permission to write.
 */
export async function readSlugRuleMarker(rexDir: string): Promise<number | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(rexDir, TREE_META_FILENAME), "utf-8");
  } catch {
    return undefined;
  }
  return parseTreeMeta(raw).slugRule;
}

/**
 * Throw unless this build may write the tree at `treeRoot`.
 *
 * Callers must already hold the PRD lock, and must call this **before writing
 * any file** — the contract is that a refused save leaves the tree byte for
 * byte as it was, which is only true if nothing has been written yet.
 *
 * A tree that does not exist yet passes: {@link findNonConformingSlugs}
 * reports nothing for an absent directory, so a first save writes the marker
 * rather than being refused for having none.
 *
 * @param rexDir   The `.rex/` directory holding `tree-meta.json`.
 * @param treeRoot The folder tree itself, for the path scan.
 * @param items    The document about to be written, supplying expected slugs.
 * @throws {SlugRuleMismatchError} When the tree belongs to another rule.
 */
export async function assertSlugRuleWritable(
  rexDir: string,
  treeRoot: string,
  items: PRDItem[],
): Promise<void> {
  const found = await readSlugRuleMarker(rexDir);

  if (found !== undefined) {
    if (found === SLUG_RULE_VERSION) return;
    throw new SlugRuleMismatchError(
      `Refusing to write the PRD tree: it was written under slug rule ${found}, ` +
        `but this build implements slug rule ${SLUG_RULE_VERSION}. ` +
        `Saving would rewrite every path in the tree. ` +
        `Run 'rex migrate-slugs' on the default branch to bring the tree onto ` +
        `rule ${SLUG_RULE_VERSION}, or use a rex build that implements rule ${found}.`,
      found,
      SLUG_RULE_VERSION,
    );
  }

  // No marker: a tree older than the guard. Judge it by its paths.
  const mismatches = await findNonConformingSlugs(items, treeRoot);
  if (mismatches.length === 0) return;

  const sample = mismatches
    .slice(0, SAMPLE_LIMIT)
    .map((m) => `  ${m.parentDir}/${m.found} should be ${m.expected} (${m.title})`)
    .join("\n");
  const more =
    mismatches.length > SAMPLE_LIMIT
      ? `\n  …and ${mismatches.length - SAMPLE_LIMIT} more.`
      : "";

  throw new SlugRuleMismatchError(
    `Refusing to write the PRD tree: it carries no slug-rule marker and ` +
      `${mismatches.length} path${mismatches.length === 1 ? " does" : "s do"} not match ` +
      `slug rule ${SLUG_RULE_VERSION}, which this build implements. ` +
      `Saving would rewrite them.\n${sample}${more}\n` +
      `Run 'rex migrate-slugs' on the default branch to bring the tree onto ` +
      `rule ${SLUG_RULE_VERSION} and record the marker.`,
    undefined,
    SLUG_RULE_VERSION,
    mismatches,
  );
}

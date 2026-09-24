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
 * - **Marker differs.** Refuse the whole save. Whether the build or the tree
 *   is the stale one does not change the refusal, but it does change the
 *   advice — see {@link markerAdvice}.
 * - **Marker absent.** Judge the tree by its paths. A clean scan adopts it and
 *   records the marker, with a notice on the way past; a dirty scan is refused
 *   exactly as a mismatch would be. An empty tree skips the scan — a tree that
 *   does not exist yet has nothing to protect, and that is the branch a first
 *   save and `rex init` take.
 *
 * Absence is two states, not one. It is a tree older than the guard, and it is
 * a tree whose guard was disarmed: a rex MCP server started before the marker
 * existed saved the PRD and rewrote `tree-meta.json` from a type with no
 * `slugRule` field, erasing the record while moving no path at all. Nothing on
 * disk separates them, and the path scan is not a sound tiebreak either — it
 * can only recognise a rule this build can reproduce, so a tree re-slugged by a
 * *future* build would scan clean and get this build's marker stamped on paths
 * it did not write.
 *
 * That hazard is real but not yet reachable. There is no rule 3, so no tree in
 * existence can have been written under one, and whoever introduces one edits
 * {@link SLUG_RULE_VERSION} in the same commit and can turn adoption back into
 * a refusal there. Refusing today buys protection against a future that does
 * not exist, and charges for it now: the marker is unreleased, so *every*
 * repository is unmarked, and every tree written by 0.5.2 or later already
 * follows rule {@link SLUG_RULE_VERSION} — `rex migrate-slugs` on those trees
 * renames nothing and records the marker, which is precisely what adoption
 * does. The refusal would fall entirely on the population for whom the command
 * is ceremony. A notice buys the visibility without the stop.
 *
 * Trees older than that carry rule-1 paths (0.5.1 suffixed every slug with
 * `-{id6}`; the title-only rule before it is rule 1 too), fail the scan, and
 * are refused — as they were before the marker existed.
 *
 * `rex migrate-slugs` is the sole sanctioned way past a refusal: it rewrites
 * the tree under this build's rule and adopts the marker in the same locked
 * write, so there is no window in which the marker claims a rule the paths do
 * not follow. It only goes one way — see {@link assertSlugRuleAdoptable}.
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
import { parseFolderTree } from "./folder-tree-parser.js";
import { parseTreeMeta } from "./tree-meta.js";
import { TREE_META_FILENAME } from "./paths.js";

/** How many offending paths a refusal lists before it stops. */
const SAMPLE_LIMIT = 5;

/**
 * The sentence every surface says about a tree carrying no slug-rule marker.
 *
 * Shared rather than repeated so the store, `rex validate`, `ndx work` and the
 * dashboard's Execute cannot describe the same tree three different ways — an
 * operator who hits the refusal in one surface and searches for it in another
 * must land on the same instruction.
 */
export const SLUG_RULE_MARKER_MISSING = "slug rule marker missing; run rex migrate-slugs";

/**
 * Why an unmarked tree whose paths do not conform is refused, and what fixes it.
 *
 * Appended to {@link SLUG_RULE_MARKER_MISSING} by surfaces with room for it.
 * Only the refusing branch uses it — an unmarked tree that scans clean is
 * adopted, and says so through {@link noticeUnmarkedTreeAdopted} instead.
 */
function missingMarkerExplanation(): string {
  return (
    `The tree records the rule it was written under in ${TREE_META_FILENAME}, and this ` +
    `one carries no such record. Absence alone is survivable — a tree written before ` +
    `the marker existed, or one whose sidecar a build older than the field rewrote ` +
    `without it — and is adopted when every path already matches rule ` +
    `${SLUG_RULE_VERSION}. These paths do not, so there is nothing left to identify the ` +
    `build that wrote them. 'rex migrate-slugs' brings every path onto rule ` +
    `${SLUG_RULE_VERSION} and records the marker in the same locked write.`
  );
}

/**
 * Tell the operator that an unmarked tree was adopted rather than refused.
 *
 * The write itself is silent and lossless — the marker is recorded, no path
 * moves — which is exactly why it needs saying. The marker's whole job is to
 * name the build that wrote the tree, and a build that quietly claims a tree it
 * did not write has removed the evidence the next reader would need. `rex
 * migrate-slugs` is named because it re-derives every path from the items
 * rather than trusting the scan, which is the independent check this adoption
 * skips.
 *
 * On stderr, not stdout: the rex MCP server speaks JSON-RPC over stdio, and a
 * notice on stdout would corrupt the protocol. It fires at most once per
 * repository — the save it accompanies records the marker, so every later save
 * takes the matching-marker branch and returns before reaching here.
 */
function noticeUnmarkedTreeAdopted(): void {
  console.warn(
    `Notice: the PRD tree carried no slug-rule marker and every path matches rule ` +
      `${SLUG_RULE_VERSION}, so this save recorded the marker — run 'rex migrate-slugs' to verify.`,
  );
}

/**
 * Render up to {@link SAMPLE_LIMIT} offending paths, with an "and N more" tail.
 *
 * A refusal that named no paths would be unactionable — "the tree is wrong"
 * gives the operator nothing to look at — and one that named all 1,570 would
 * be scrolled past. Five is enough to recognise the shape of the rewrite.
 *
 * `parentDir` is built with `path.join`, so the entry is joined the same way:
 * concatenating a forward slash rendered a nested offender as the mixed
 * `epic-x\feature-y/task.md` on Windows.
 */
function samplePaths(mismatches: readonly SlugMismatch[]): string {
  const sample = mismatches
    .slice(0, SAMPLE_LIMIT)
    .map((m) => `  ${join(m.parentDir, m.found)} should be ${m.expected} (${m.title})`)
    .join("\n");
  const more =
    mismatches.length > SAMPLE_LIMIT
      ? `\n  …and ${mismatches.length - SAMPLE_LIMIT} more.`
      : "";
  return `${sample}${more}`;
}

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
 * What to tell the operator about a marker that disagrees with this build.
 *
 * The advice has to branch on direction, and getting it wrong is not a wording
 * problem. `rex migrate-slugs` rewrites the tree under *this* build's rule, so
 * recommending it for a tree written by a **newer** rule migrates the tree
 * backwards — and the newer build, refused in turn and given the same advice,
 * migrates it forwards again. Two builds can ping-pong whole-tree renames
 * between them by each following the instructions they were handed.
 *
 * Older or absent is the only direction a migration can fix. Newer means this
 * build is the stale one, and the only honest instruction is to upgrade it.
 */
function markerAdvice(found: number): string {
  if (found > SLUG_RULE_VERSION) {
    return (
      `This rex build is older than the tree. Upgrade rex to a build that implements ` +
      `slug rule ${found}. Do not run 'rex migrate-slugs' — it would rewrite every path ` +
      `under the superseded rule ${SLUG_RULE_VERSION} and overwrite the newer marker.`
    );
  }
  return (
    `Run 'rex migrate-slugs' on the default branch to bring the tree onto rule ` +
    `${SLUG_RULE_VERSION}, or use a rex build that implements rule ${found}.`
  );
}

/**
 * Throw unless this build may write the tree at `treeRoot`.
 *
 * Callers must already hold the PRD lock, and must call this **before writing
 * any file** — the contract is that a refused save leaves the tree byte for
 * byte as it was, which is only true if nothing has been written yet.
 *
 * A tree that does not exist yet passes: {@link parseFolderTree} reports no
 * items for an absent directory, so a first save writes the marker rather than
 * being refused for having none. That emptiness is read from **disk**, never
 * from the document about to be written — a pending document is full of items
 * on the very first save, and judging by it would refuse every new project.
 *
 * **The path scan reads the tree from disk rather than taking the document
 * about to be written**, for the same reason. It once took the pending
 * document, and that made the guard refuse the writer's own rename: the
 * pending document already carries the mutation, so `rex update <id>
 * --title="Beta epic"` against an unmarked tree compared the slug `beta-epic`
 * — which the write was about to create — against the `alpha-epic` still on
 * disk, and reported a foreign build. The question this branch answers is
 * whether the *tree* was written by another rule, which is a fact about disk
 * alone; what the pending document wants the paths to become is precisely the
 * thing under test and cannot be evidence in its own trial.
 *
 * The scan is the expensive branch, and it runs at most once per tree: the
 * save it permits records the marker, and every save after that returns on the
 * cheap one.
 *
 * @param rexDir   The `.rex/` directory holding `tree-meta.json`.
 * @param treeRoot The folder tree itself, for the emptiness check and scan.
 * @throws {SlugRuleMismatchError} When the tree belongs to another rule, or
 *   carries no marker and paths this build did not write.
 */
export async function assertSlugRuleWritable(
  rexDir: string,
  treeRoot: string,
): Promise<void> {
  const found = await readSlugRuleMarker(rexDir);

  if (found !== undefined) {
    if (found === SLUG_RULE_VERSION) return;
    throw new SlugRuleMismatchError(
      `Refusing to write the PRD tree: it was written under slug rule ${found}, ` +
        `but this build implements slug rule ${SLUG_RULE_VERSION}. ` +
        `Saving would rewrite every path in the tree. ` +
        markerAdvice(found),
      found,
      SLUG_RULE_VERSION,
    );
  }

  // No marker. An empty tree has nothing a marker could be wrong about, so a
  // first save proceeds and records one. Otherwise judge the tree by its paths
  // — and by the titles those paths are stored with, both read from disk, so
  // the comparison is the tree against itself rather than against the pending
  // mutation.
  const { items } = await parseFolderTree(treeRoot);
  if (items.length === 0) return;

  const mismatches = await findNonConformingSlugs(items, treeRoot);
  if (mismatches.length === 0) {
    noticeUnmarkedTreeAdopted();
    return;
  }

  throw new SlugRuleMismatchError(
    `Refusing to write the PRD tree: ${SLUG_RULE_MARKER_MISSING}, and ` +
      `${mismatches.length} path${mismatches.length === 1 ? " does" : "s do"} not match ` +
      `slug rule ${SLUG_RULE_VERSION}, which this build implements. ` +
      `Saving would rewrite them.\n${samplePaths(mismatches)}\n` +
      missingMarkerExplanation(),
    undefined,
    SLUG_RULE_VERSION,
    mismatches,
  );
}

/**
 * Throw unless `rex migrate-slugs` may take ownership of the tree at `rexDir`.
 *
 * `adoptSlugRule` is the one write that goes past {@link assertSlugRuleWritable},
 * because re-slugging is exactly what it exists to do. That exemption was
 * unconditional, which made the migration command a downgrade tool: on a tree
 * marked with a newer rule it rewrote every path under this build's older rule
 * and stamped the older marker over the newer one. The refusal that sent the
 * operator there said `migrate-slugs` in both directions, so the loop closed —
 * each build migrating the tree back at the other's instruction.
 *
 * Only the adopt-older direction is a migration. Adopt-newer is a downgrade,
 * and no build can migrate a tree onto a rule it does not implement.
 *
 * @throws {SlugRuleMismatchError} When the marker names a newer rule.
 */
export async function assertSlugRuleAdoptable(rexDir: string): Promise<void> {
  const found = await readSlugRuleMarker(rexDir);
  if (found === undefined || found <= SLUG_RULE_VERSION) return;

  throw new SlugRuleMismatchError(
    `Refusing to migrate the PRD tree: it was written under slug rule ${found}, ` +
      `but this build implements slug rule ${SLUG_RULE_VERSION}. Migrating would ` +
      `rewrite every path under the superseded rule and record rule ` +
      `${SLUG_RULE_VERSION} over the newer marker. ` +
      markerAdvice(found),
    found,
    SLUG_RULE_VERSION,
  );
}

/**
 * Why this build must not write the PRD tree as it stands.
 *
 * Returned rather than thrown because the callers are gates, not writers: they
 * decide whether to *start* something, and a refusal is an ordinary outcome
 * they report rather than an exception they recover from.
 */
export interface TreeConformanceRefusal {
  /**
   * Complete, operator-facing explanation, ending in the `rex migrate-slugs`
   * instruction. Surfaces emit this verbatim so the CLI and the dashboard say
   * the same thing about the same tree.
   */
  message: string;
  /** Offending paths. Empty when the marker alone was enough to refuse. */
  mismatches: readonly SlugMismatch[];
  /** `slugRule` found in `tree-meta.json`, or `undefined` when absent. */
  markerFound: number | undefined;
}

/**
 * Report whether a write from this build would re-slug the tree at `treeRoot`.
 *
 * This is the read-only counterpart to {@link assertSlugRuleWritable}, for
 * callers that must decide something *before* any writer is reached: `ndx work`
 * and the dashboard's Execute both start an agent that writes the PRD when it
 * finishes, so a run begun against a tree this build disagrees with is exactly
 * how a whole-tree rewrite lands inside a feature branch under a "task
 * completed" commit. The store guard would refuse that write, but only after
 * the run had already spent its tokens and made its code changes.
 *
 * It differs from the write guard in one way that matters: **both** checks
 * always run. `assertSlugRuleWritable` returns as soon as a matching marker
 * proves the tree is this build's own, which is sound for a writer — a matching
 * marker means this build's rule produced those paths. A gate answers the
 * broader question `rex validate` asks, so a tree whose marker agrees but whose
 * paths were disturbed (an interrupted migration, a hand-edited directory) is
 * still refused rather than run against.
 *
 * @param rexDir   The `.rex/` directory holding `tree-meta.json`.
 * @param treeRoot The folder tree itself, for the path scan.
 * @param items    The document **as loaded from disk**. Passing a document
 *   carrying a pending mutation reports that mutation's own renames as a
 *   foreign re-slug — the bug {@link assertSlugRuleWritable} was fixed for.
 *   Both callers are gates that run before any mutation exists, so a freshly
 *   loaded document is the only thing they have to pass.
 * @returns `null` when the tree is this build's to write, else the refusal.
 */
export async function checkTreeConformance(
  rexDir: string,
  treeRoot: string,
  items: PRDItem[],
): Promise<TreeConformanceRefusal | null> {
  const markerFound = await readSlugRuleMarker(rexDir);

  if (markerFound !== undefined && markerFound !== SLUG_RULE_VERSION) {
    return {
      markerFound,
      mismatches: [],
      message:
        `The PRD tree was written under slug rule ${markerFound}, but this build ` +
        `implements slug rule ${SLUG_RULE_VERSION}. Every path in the tree would be ` +
        `rewritten by the first write this run makes.\n` +
        markerAdvice(markerFound),
    };
  }

  // An absent marker is judged by the paths, exactly as the write guard judges
  // it — see {@link assertSlugRuleWritable}. A clean scan is a tree this build
  // is about to adopt, so the gate lets the run start; the adopting write
  // announces itself. Only a dirty scan refuses, and it says the marker is
  // missing as well, because that is the other half of what the operator has
  // to fix.
  const mismatches = await findNonConformingSlugs(items, treeRoot);
  if (mismatches.length === 0) return null;

  const one = mismatches.length === 1;
  return {
    markerFound,
    mismatches,
    message:
      (markerFound === undefined
        ? `The PRD tree carries no slug-rule marker — ${SLUG_RULE_MARKER_MISSING}. `
        : "") +
      `${mismatches.length} path${one ? "" : "s"} in the PRD tree do${one ? "es" : ""} not ` +
      `match slug rule ${SLUG_RULE_VERSION}, which this build implements. They would be ` +
      `rewritten by the first write this run makes.\n${samplePaths(mismatches)}\n` +
      (markerFound === undefined
        ? missingMarkerExplanation()
        : `Run 'rex migrate-slugs' on the default branch to bring the tree onto rule ` +
          `${SLUG_RULE_VERSION}.`),
  };
}

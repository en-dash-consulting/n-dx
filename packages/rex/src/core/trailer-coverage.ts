/**
 * Trailer coverage — which commits on the default branch name a PRD item.
 *
 * A read-only measurement, not a backfill. Schema v2 stores no `commits` on an
 * item: a change's commits are computed from `N-DX-Item` trailers
 * (`computeChangeCommits` in {@link module:rex/core/change-commits}). So the
 * useful question about history is no longer "which items can I write commits
 * onto" but "which commits can never be attributed to anything" — which is
 * what this measures, before the trailer format freezes at 1.0.0.
 *
 * Nothing here writes. It does not load the PRD, and it deliberately does not
 * go through `loadTrailerCommits`, whose cache file would land under the rex
 * directory; a report that mutates the state it reports on is a report nobody
 * can run twice with confidence.
 *
 * ## Two readings of the same history, deliberately
 *
 * `written*` fields scan the whole message for `N-DX-Item:` and `N-DX-Status:`
 * lines. `attributedItems` asks git's own trailer parser for `N-DX-Item`,
 * which is what `scanTrailerCommits` uses and therefore what v2 attribution
 * actually sees.
 *
 * The two disagree, and the gap is the point. Git reads trailers only from a
 * message's final paragraph, and most of this project's history puts a blank
 * line between its `N-DX-Status` lines and the closing `Co-Authored-By`, so
 * git classifies them as prose — on this repository it recognised 3 of the 53
 * commits that carry one. Reporting only the written count would call history
 * covered that nothing can attribute; reporting only git's count would hide
 * that the trailer was written at all. Both are reported, and their difference
 * is {@link TrailerCoverageTotals.writtenOutsideTrailerBlock}.
 *
 * @module rex/core/trailer-coverage
 */

import {
  ITEM_TRAILER_KEY,
  assertFullHistory,
  git,
  itemIdFromTrailer,
  resolveMainRef,
} from "./change-commits.js";

export const STATUS_TRAILER_KEY = "N-DX-Status";

/**
 * One `N-DX-Status: <itemId> <from> <arrow> <to>` line.
 *
 * Both arrow forms are accepted because both occur in history: hench writes
 * `→`, while messages composed by hand or by a vendor CLI commonly use `->`.
 * Reading only one form silently skips every commit written with the other.
 */
const STATUS_TRAILER_RE = new RegExp(`^${STATUS_TRAILER_KEY}:\\s+(\\S+)\\s+\\S+\\s+(?:→|->)\\s+\\S+`);

/** One `N-DX-Item: <value>` line. The value is interpreted by {@link itemIdFromTrailer}. */
const ITEM_TRAILER_RE = new RegExp(`^${ITEM_TRAILER_KEY}:\\s*(\\S.*)$`);

/** A commit on the scanned branch, with both readings of its trailers. */
export interface CoverageCommit {
  /** Full commit SHA. */
  hash: string;
  author: string;
  authorEmail: string;
  /** Author date, ISO 8601 (survives a rebase, unlike the committer date). */
  timestamp: string;
  /** More than one parent. A merge carries no trailer by construction. */
  isMerge: boolean;
  /** Item ids named by `N-DX-Item` lines anywhere in the message. */
  writtenItems: string[];
  /** Item ids named by `N-DX-Status` lines anywhere in the message. */
  writtenStatusItems: string[];
  /** Item ids git's own trailer parser reads from `N-DX-Item` — what attribution sees. */
  attributedItems: string[];
}

/** Counts shared by the totals and by every grouping of them. */
export interface GroupCoverage {
  commits: number;
  /** Commits whose message carries an `N-DX-Item` or `N-DX-Status` trailer. */
  covered: number;
  uncovered: number;
  /** Merge commits among the uncovered, so the headline can be read without them. */
  uncoveredMerges: number;
}

export interface AuthorCoverage extends GroupCoverage {
  /** Display name, taken from this author's most recent commit. */
  author: string;
  /** Lower-cased author email — the grouping key, since one person's name can change. */
  authorEmail: string;
}

export interface MonthCoverage extends GroupCoverage {
  /** `YYYY-MM` in the author's own timezone, as git recorded the author date. */
  month: string;
}

export interface TrailerCoverageTotals extends GroupCoverage {
  /** Commits git's trailer parser attributes to at least one item. */
  attributed: number;
  /**
   * Covered commits git's parser does not see, so v2 attribution cannot use
   * them. The trailer was written; it just is not in the final paragraph.
   */
  writtenOutsideTrailerBlock: number;
}

export interface TrailerCoverageReport {
  /** The ref that was read. */
  ref: string;
  /** Its tip SHA, so a report can be tied to the history it describes. */
  tip: string;
  totals: TrailerCoverageTotals;
  /** Every author, most uncovered commits first. */
  byAuthor: AuthorCoverage[];
  /** Every month, oldest first. */
  byMonth: MonthCoverage[];
}

export interface TrailerCoverageOptions {
  /** Directory inside the git repository to read. */
  repoDir: string;
  /** The branch to read. Default: the first of `DEFAULT_MAIN_REFS` that resolves. */
  ref?: string;
}

/**
 * Trailer coverage for every commit reachable from the branch.
 *
 * Throws when the ref does not resolve, or when the repository is a shallow
 * clone — a truncated history would report missing commits as absent rather
 * than unfetched, which is the one way this number can be quietly wrong.
 */
export async function computeTrailerCoverage(
  options: TrailerCoverageOptions,
): Promise<TrailerCoverageReport> {
  const { ref, tip } = await resolveMainRef(options.repoDir, options.ref);
  await assertFullHistory(options.repoDir);
  return summarizeCoverage(ref, tip, await scanCoverageCommits(options.repoDir, tip));
}

/**
 * Field, record and group separators for the scan.
 *
 * The group separator is distinct because the `N-DX-Item` trailer list has no
 * fixed length: separating its entries with the field separator would make the
 * record's field count vary and put the body at an unknown index.
 */
const FS = "\x1f";
const RS = "\x1e";
const GS = "\x1d";

/** Index of `%B` in {@link SCAN_FORMAT}; the body is rejoined from here on. */
const BODY_FIELD = 6;

const SCAN_FORMAT = [
  "%H",
  "%P",
  "%an",
  "%ae",
  "%aI",
  `%(trailers:key=${ITEM_TRAILER_KEY},valueonly,unfold,separator=%x1d)`,
  "%B",
].join("%x1f");

/** Every commit reachable from `tip`, walking all parents of merges, newest first. */
export async function scanCoverageCommits(repoDir: string, tip: string): Promise<CoverageCommit[]> {
  // --no-show-signature: with `log.showSignature` set, git prints signature
  // checks for signed commits (GitHub signs its web merges) to stdout, which
  // would land inside the previous record's fields.
  const stdout = await git(repoDir, [
    "log",
    "--no-show-signature",
    `--format=%x1e${SCAN_FORMAT}`,
    tip,
    "--",
  ]);

  const commits: CoverageCommit[] = [];
  for (const record of stdout.split(RS)) {
    if (record.trim() === "") continue;
    const fields = record.split(FS);
    if (fields.length <= BODY_FIELD) continue;

    const [hash, parents, author, authorEmail, timestamp, itemTrailers] = fields;
    // The body is last and rejoined: a stray separator inside a commit message
    // must not truncate the text the written-trailer scan reads.
    const body = fields.slice(BODY_FIELD).join(FS);

    commits.push({
      hash: hash.trim(),
      author: author.trim(),
      authorEmail: authorEmail.trim(),
      timestamp: timestamp.trim(),
      isMerge: parents.trim().split(/\s+/).filter((p) => p !== "").length > 1,
      writtenItems: parseItemTrailers(body),
      writtenStatusItems: parseStatusTrailers(body),
      attributedItems: unique(
        itemTrailers
          .split(GS)
          .map((value) => itemIdFromTrailer(value))
          .filter((id): id is string => id !== undefined),
      ),
    });
  }
  return commits;
}

/**
 * Item ids named by `N-DX-Item` lines anywhere in the message.
 *
 * The whole message is scanned rather than handed to git's trailer parser —
 * see the module header for why the two readings are both kept.
 */
export function parseItemTrailers(message: string): string[] {
  const ids: string[] = [];
  for (const line of message.split("\n")) {
    const match = ITEM_TRAILER_RE.exec(line.trim());
    if (match === null) continue;
    const id = itemIdFromTrailer(match[1]);
    if (id !== undefined) ids.push(id);
  }
  return unique(ids);
}

/**
 * Item ids named by `N-DX-Status` lines anywhere in the message.
 *
 * A commit that closes several items carries one trailer per item, so every
 * line is read: returning only the first loses the rest, and on this
 * repository's history that was better than half of them.
 */
export function parseStatusTrailers(message: string): string[] {
  const ids: string[] = [];
  for (const line of message.split("\n")) {
    const match = STATUS_TRAILER_RE.exec(line.trim());
    if (match !== null) ids.push(match[1]);
  }
  return unique(ids);
}

/** A commit is covered when its message names an item either way. */
export function isCovered(commit: CoverageCommit): boolean {
  return commit.writtenItems.length > 0 || commit.writtenStatusItems.length > 0;
}

/** Roll a scan up into the report. Pure, so the shaping is testable without git. */
export function summarizeCoverage(
  ref: string,
  tip: string,
  commits: CoverageCommit[],
): TrailerCoverageReport {
  const totals: TrailerCoverageTotals = {
    ...emptyGroup(),
    attributed: 0,
    writtenOutsideTrailerBlock: 0,
  };
  const authors = new Map<string, AuthorCoverage>();
  const months = new Map<string, MonthCoverage>();

  for (const commit of commits) {
    const covered = isCovered(commit);
    const attributed = commit.attributedItems.length > 0;

    count(totals, commit, covered);
    if (attributed) totals.attributed += 1;
    if (covered && !attributed) totals.writtenOutsideTrailerBlock += 1;

    // `git log` is newest-first, so the first sighting of an email is the most
    // recent commit — which is the name worth displaying when one has changed.
    const email = commit.authorEmail.toLowerCase();
    const author =
      authors.get(email) ?? { author: commit.author, authorEmail: email, ...emptyGroup() };
    count(author, commit, covered);
    authors.set(email, author);

    const key = monthOf(commit.timestamp);
    const month = months.get(key) ?? { month: key, ...emptyGroup() };
    count(month, commit, covered);
    months.set(key, month);
  }

  return {
    ref,
    tip,
    totals,
    byAuthor: [...authors.values()].sort(
      (a, b) =>
        b.uncovered - a.uncovered ||
        b.commits - a.commits ||
        a.authorEmail.localeCompare(b.authorEmail),
    ),
    byMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/**
 * The `YYYY-MM` an ISO 8601 author date falls in, in the author's own
 * timezone. Taken from the text rather than through `Date`, which would
 * re-project it into the reader's timezone and move commits near a month
 * boundary depending on who runs the report.
 */
function monthOf(timestamp: string): string {
  return timestamp.slice(0, 7);
}

function emptyGroup(): GroupCoverage {
  return { commits: 0, covered: 0, uncovered: 0, uncoveredMerges: 0 };
}

function count(group: GroupCoverage, commit: CoverageCommit, covered: boolean): void {
  group.commits += 1;
  if (covered) {
    group.covered += 1;
    return;
  }
  group.uncovered += 1;
  if (commit.isMerge) group.uncoveredMerges += 1;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

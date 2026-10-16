/**
 * A change's commits, computed from `N-DX-Item` trailers rather than stored.
 *
 * A commit's SHA is not its identity: a stack rebase or a squash merge
 * rewrites it, while the `N-DX-Item` trailer in the message survives both. So
 * schema v2 stores no `commits` (see `RETIRED_STATE_FIELDS`), and the commits
 * of a change are the commits reachable from main, through merge commits and
 * not first-parent only, whose trailer names the change or one of its tasks.
 *
 * Two trailer forms name an item: the bare item id, which is what hench
 * writes, and the dashboard permalink it used to write
 * (`<publicUrl>/#/rex/item/<id>`, any host). Both stay supported — history
 * written before the change must keep attributing.
 *
 * ## Split trailer blocks are recovered (decision, 2026-10-15)
 *
 * Git reads trailers only from a message's final paragraph. Much of this
 * project's history puts a blank line between `N-DX-Item` and the closing
 * `Co-Authored-By`, which makes git classify the item line as prose: on this
 * repository git's parser attributed 761 commits while 57 more carried a
 * readable `N-DX-Item` it could not see (`rex backfill-commit-attribution`
 * reports the same gap as `writtenOutsideTrailerBlock`). Fixing the writers
 * only helps new commits, and history is immutable, so those 57 would never
 * be attributable — while `ndx migrate --plan` and the product layer's code
 * evidence both read history through this module.
 *
 * The decision was to relax the reader rather than accept the gap, bounded by
 * two rules that keep a trailer from being read out of prose:
 *
 * 1. Only a **trailing run of trailer-shaped paragraphs** is scanned, not the
 *    whole message. Walking back from the end, a paragraph counts while every
 *    one of its lines is `Key: value` or a folded continuation; the first
 *    prose paragraph stops the walk, and the subject is never reached — a
 *    conventional-commit subject is itself trailer-shaped, and git does not
 *    read a trailer out of a one-paragraph message either. This is exactly
 *    the shape the history has, and it refuses a trailer quoted mid-message.
 * 2. **A merge commit is never read this way.** A merge carries no trailer of
 *    its own, and its body quotes the messages of the commits it brings in —
 *    21 merges on this repository quote an `N-DX-Item` that is not theirs.
 *    Merges keep using git's parser alone.
 *
 * Measured against the rejected alternative: scanning the whole message would
 * have attributed 6 further commits, every one of them a GitHub squash merge
 * whose body quotes several branch messages. Crediting one squash commit to
 * every item named in it would hand each of those items the whole multi-item
 * diff as evidence, which is worse than leaving it unattributed.
 *
 * Beyond that trailing region no part of the message is read, so nothing can
 * come to depend on how a host words a merge commit.
 *
 * ## Cache
 *
 * One scan indexes every trailer commit reachable from the ref, written to
 * `<rexDir>/.cache/{@link CHANGE_COMMITS_CACHE_FILENAME}` (`.ndx/rex/.cache`
 * on the `.ndx` layout; `rex init` gitignores the directory). It is keyed by
 * the ref's tip SHA, so a moved ref, a missing or unreadable file, or a
 * format change rebuilds it. The files each commit changed are cached beside
 * it in {@link COMMIT_FILES_CACHE_FILENAME}, keyed by commit SHA: a commit's
 * diff never changes, so that file needs no tip check and is rebuilt only
 * when missing or unreadable.
 *
 * @module rex/core/change-commits
 */

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { exec } from "@n-dx/llm-client";
import { atomicWrite } from "../store/atomic-write.js";

export const CHANGE_COMMITS_CACHE_FILENAME = "trailer-commits.json";
export const COMMIT_FILES_CACHE_FILENAME = "commit-files.json";
/**
 * Refs tried, in order, when the caller names none; the first that resolves
 * wins. A remote-tracking ref comes first because a CI checkout has no local
 * `main` and a long-lived clone's local `main` may be behind what was merged.
 */
export const DEFAULT_MAIN_REFS = ["origin/HEAD", "origin/main", "main"] as const;
export const ITEM_TRAILER_KEY = "N-DX-Item";

/**
 * Bumped when the cached shape changes, so an older file is rebuilt rather
 * than misread. 3: split trailer blocks are recovered, so a cache written by
 * an earlier version is missing commits rather than merely shaped differently.
 */
export const CACHE_VERSION = 3;
const GIT_TIMEOUT_MS = 120_000;
/** A full-history scan prints a line per commit; 1 MiB (the exec default) fits about 10k. */
const GIT_MAX_BUFFER = 256 * 1024 * 1024;

/** A commit whose `N-DX-Item` trailer names at least one item. */
export interface TrailerCommit {
  /** Full commit SHA. */
  hash: string;
  /** Parent SHAs; more than one for a merge commit. */
  parents: string[];
  author: string;
  authorEmail: string;
  /** Author date, ISO 8601 (survives a rebase, unlike the committer date). */
  timestamp: string;
  /** The first line of the message. */
  subject: string;
  /** Item ids its `N-DX-Item` trailers name, in trailer order. */
  items: string[];
}

export interface ChangeCommitsOptions {
  /** Directory inside the git repository to read. */
  repoDir: string;
  /** Rex's derived-state directory (`RexPaths.cacheDir`). */
  cacheDir: string;
  /** The branch commits must be reachable from. Default: the first of {@link DEFAULT_MAIN_REFS} that exists. An explicit ref is never substituted. */
  ref?: string;
}

interface TrailerCommitCache {
  version: number;
  ref: string;
  tip: string;
  commits: TrailerCommit[];
}

const PERMALINK = /\/#\/rex\/item\/([^\s/?#]+)\/?$/;
const BARE_ID = /^[^\s/#?:]+$/;

/** The item id an `N-DX-Item` trailer value names, or undefined for any other value. */
export function itemIdFromTrailer(value: string): string | undefined {
  const trimmed = value.trim();
  return PERMALINK.exec(trimmed)?.[1] ?? (BARE_ID.test(trimmed) ? trimmed : undefined);
}

/**
 * The commits reachable from the ref whose trailer names any of `itemIds`
 * (pass a change's id and its tasks' ids, plus any aliases), newest first.
 * Throws when the ref does not resolve, or when the repository is a shallow
 * clone (its history is truncated, so a missing commit would read as unlanded).
 */
export async function computeChangeCommits(
  itemIds: Iterable<string>,
  options: ChangeCommitsOptions,
): Promise<TrailerCommit[]> {
  const wanted = new Set(itemIds);
  const commits = await loadTrailerCommits(options);
  return commits.filter((commit) => commit.items.some((id) => wanted.has(id)));
}

/** Every trailer commit reachable from the ref, newest first, from the cache when it is current. */
export async function loadTrailerCommits(options: ChangeCommitsOptions): Promise<TrailerCommit[]> {
  const { ref, tip } = await resolveMainRef(options.repoDir, options.ref);
  // Before the cache read: a cache built from a shallow history is truncated too.
  await assertFullHistory(options.repoDir);
  const path = join(options.cacheDir, CHANGE_COMMITS_CACHE_FILENAME);
  const cached = await readCache(path);
  if (cached && cached.ref === ref && cached.tip === tip) return cached.commits;

  const commits = await scanTrailerCommits(options.repoDir, tip);
  const cache: TrailerCommitCache = { version: CACHE_VERSION, ref, tip, commits };
  await mkdir(options.cacheDir, { recursive: true });
  await atomicWrite(path, JSON.stringify(cache) + "\n");
  return commits;
}

/**
 * Field, record and group separators for the scan. None can occur in a SHA,
 * an ISO date or a trailer value; an author name containing one would only
 * corrupt that commit's author fields.
 *
 * The trailer list uses the group separator because it has no fixed length:
 * separating its entries with the field separator would make the record's
 * field count vary and put the body at an unknown index.
 */
const FS = "\x1f";
const RS = "\x1e";
const GS = "\x1d";

/** Index of `%B` in {@link SCAN_FORMAT}; the body is rejoined from here on. */
const BODY_FIELD = 7;

const SCAN_FORMAT = [
  "%H", "%P", "%an", "%ae", "%aI", "%s",
  `%(trailers:key=${ITEM_TRAILER_KEY},valueonly,unfold,separator=%x1d)`,
  "%B",
].join("%x1f");

/** One `N-DX-Item: <value>` line at the start of a line. The value is read by {@link itemIdFromTrailer}. */
const ITEM_TRAILER_LINE = new RegExp(`^${ITEM_TRAILER_KEY}:[ \\t]*(\\S.*)$`, "gm");
/** A `Key: value` trailer line. Keys are the git-trailer shape: alphanumerics and hyphens. */
const TRAILER_SHAPED = /^[A-Za-z0-9][A-Za-z0-9-]*:\s/;
/** A folded trailer continuation — git's `unfold` joins these onto the line above. */
const FOLDED_CONTINUATION = /^[ \t]+\S/;

/**
 * The trailing run of trailer-shaped paragraphs, walking back from the end of
 * the message and stopping at the first paragraph that is not one. Returns ""
 * when the message ends in prose.
 *
 * This is the region a split-off `N-DX-Item` is recovered from; see the
 * decision in this module's header for why it is this rather than the whole
 * message.
 */
export function trailingTrailerRegion(body: string): string {
  const paragraphs = body.replace(/\s+$/, "").split(/\n[ \t]*\n/);
  const kept: string[] = [];
  // Stop at index 1: the first paragraph is the subject, and git never reads a
  // trailer out of it. Without this the walk swallows a conventional-commit
  // subject, which is trailer-shaped ("docs: …"), and a single-paragraph
  // message would be read as a trailer block that git itself reports as empty.
  for (let i = paragraphs.length - 1; i >= 1; i--) {
    const lines = paragraphs[i].split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    const allTrailers = lines.every(
      (line) => TRAILER_SHAPED.test(line) || FOLDED_CONTINUATION.test(line),
    );
    if (!allTrailers) break;
    kept.unshift(paragraphs[i]);
  }
  return kept.join("\n");
}

/** Item ids named by `N-DX-Item` lines in the trailing trailer region of `body`. */
function itemsInTrailingRegion(body: string): string[] {
  const region = trailingTrailerRegion(body);
  if (region === "") return [];
  return [...region.matchAll(ITEM_TRAILER_LINE)]
    .map((match) => itemIdFromTrailer(match[1]))
    .filter((id): id is string => id !== undefined);
}

/** Scan every commit reachable from `tip` (all parents of merges) for `N-DX-Item` trailers. */
export async function scanTrailerCommits(repoDir: string, tip: string): Promise<TrailerCommit[]> {
  // --no-show-signature: with `log.showSignature` set, git prints signature
  // checks for signed commits (GitHub signs its web merges) to stdout, which
  // would land inside the previous record's fields and drop its items.
  const stdout = await git(repoDir, ["log", "--no-show-signature", `--format=%x1e${SCAN_FORMAT}`, tip, "--"]);
  const commits: TrailerCommit[] = [];
  for (const record of stdout.split(RS)) {
    if (record.trim() === "") continue;
    const fields = record.split(FS);
    if (fields.length <= BODY_FIELD) continue;
    const [hash, parents, author, authorEmail, timestamp, subject, trailers] = fields;
    // The body is last and rejoined: a stray separator inside a commit
    // message must not truncate the text the recovery scan reads.
    const body = fields.slice(BODY_FIELD).join(FS);
    const parentList = parents ? parents.split(" ").filter((p) => p !== "") : [];

    const fromGit = trailers
      .split(GS)
      .map(itemIdFromTrailer)
      .filter((id): id is string => id !== undefined);
    // A merge quotes the messages it brings in, so only git's parser reads it.
    const recovered = parentList.length > 1 ? [] : itemsInTrailingRegion(body);
    const items = [...new Set([...fromGit, ...recovered])];
    if (items.length === 0) continue;

    commits.push({
      hash: hash.trim(),
      parents: parentList,
      author,
      authorEmail,
      timestamp,
      subject,
      items,
    });
  }
  return commits;
}

interface CommitFilesCache {
  version: number;
  files: Record<string, string[]>;
}

/** Hashes per `git log` call, which keeps the command line far below any argv limit. */
const FILES_BATCH = 500;

/**
 * The files each commit changed, by commit SHA. A merge commit lists what it
 * brought in (its diff against the first parent), so a merged branch's files
 * are credited to the merge. Reads only commits missing from the cache.
 */
export async function loadCommitFiles(
  repoDir: string,
  cacheDir: string,
  hashes: Iterable<string>,
): Promise<Map<string, string[]>> {
  const path = join(cacheDir, COMMIT_FILES_CACHE_FILENAME);
  const cache = await readJsonCache<CommitFilesCache>(path, (c) => typeof c.files === "object" && c.files !== null);
  const files = cache?.files ?? {};
  const wanted = [...new Set(hashes)];
  const missing = wanted.filter((hash) => !Object.hasOwn(files, hash));
  for (let i = 0; i < missing.length; i += FILES_BATCH) {
    Object.assign(files, await scanCommitFiles(repoDir, missing.slice(i, i + FILES_BATCH)));
  }
  if (missing.length > 0) {
    await mkdir(cacheDir, { recursive: true });
    await atomicWrite(path, JSON.stringify({ version: CACHE_VERSION, files }) + "\n");
  }
  return new Map(wanted.map((hash) => [hash, files[hash]]));
}

async function scanCommitFiles(repoDir: string, hashes: string[]): Promise<Record<string, string[]>> {
  // --no-walk=unsorted lists exactly these commits. -m --first-parent gives a
  // merge its diff against the first parent instead of an empty combined diff.
  // quotePath=false keeps non-ASCII names literal (a name with a newline,
  // quote or backslash is still quoted by git, and is returned as git prints it).
  const stdout = await git(repoDir, [
    "-c", "core.quotePath=false",
    "log", "--no-show-signature", "--no-walk=unsorted", "-m", "--first-parent", "--name-only",
    "--format=%x1e%H", ...hashes, "--",
  ]);
  const out: Record<string, string[]> = {};
  for (const record of stdout.split(RS)) {
    const [hash, ...paths] = record.split("\n");
    if (!hash?.trim()) continue;
    out[hash.trim()] = paths.filter((p) => p !== "");
  }
  for (const hash of hashes) out[hash] ??= [];
  return out;
}

/**
 * The main ref and its tip SHA: `ref` when given (never substituted), else the
 * first of {@link DEFAULT_MAIN_REFS} that resolves. Throws when none does.
 */
export async function resolveMainRef(repoDir: string, ref?: string): Promise<{ ref: string; tip: string }> {
  return ref !== undefined ? { ref, tip: await resolveCommit(repoDir, ref) } : resolveDefaultRef(repoDir);
}

async function resolveDefaultRef(repoDir: string): Promise<{ ref: string; tip: string }> {
  const reasons: string[] = [];
  for (const ref of DEFAULT_MAIN_REFS) {
    try {
      return { ref, tip: await resolveCommit(repoDir, ref) };
    } catch (err) {
      // Absent from this checkout: try the next. Keep the reason, so a cause
      // that is not a missing ref (not a repository, git absent) still surfaces.
      reasons.push(`${ref}: ${(err as Error).message}`);
    }
  }
  throw new Error(
    `git rev-parse failed in ${repoDir}: none of ${DEFAULT_MAIN_REFS.join(", ")} resolves; pass a ref\n${reasons.join("\n")}`,
  );
}

/** A shallow clone's log stops at the fetched depth, so older commits would silently read as absent. */
export async function assertFullHistory(repoDir: string): Promise<void> {
  if ((await git(repoDir, ["rev-parse", "--is-shallow-repository"])).trim() === "true") {
    throw new Error(
      `${repoDir} is a shallow clone, so its history is truncated and commits cannot be worked out from it. ` +
        "Deepen it with `git fetch --unshallow`, or set `fetch-depth: 0` on the CI checkout.",
    );
  }
}

/** The full SHA `ref` names; throws when it names no commit. */
export async function resolveCommit(repoDir: string, ref: string): Promise<string> {
  return (await git(repoDir, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
}

/** Run git in `repoDir` and return stdout; throws, naming the cause, on a non-zero exit. `input` is written to its stdin. */
export async function git(repoDir: string, args: string[], input?: string): Promise<string> {
  const result = await exec("git", args, { cwd: repoDir, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, input });
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim() || result.error?.message || `exit ${result.exitCode}`;
    throw new Error(`git ${args[0]} failed in ${repoDir}: ${reason}`);
  }
  return result.stdout;
}

function readCache(path: string): Promise<TrailerCommitCache | null> {
  return readJsonCache<TrailerCommitCache>(path, (c) => typeof c.tip === "string" && Array.isArray(c.commits));
}

/**
 * The cache file, or null when it must be rebuilt: missing, not valid JSON,
 * written in another format version, or failing `valid`. Any other read
 * error propagates.
 */
export async function readJsonCache<T extends { version: number }>(path: string, valid: (cache: T) => boolean): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null; // A torn or hand-edited cache is rebuilt from git, its source of truth.
  }
  const cache = parsed as T | null;
  return cache?.version === CACHE_VERSION && valid(cache) ? cache : null;
}

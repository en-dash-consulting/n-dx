/**
 * A change's commits, computed from `N-DX-Item` trailers rather than stored.
 *
 * A commit's SHA is not its identity: a stack rebase or a squash merge
 * rewrites it, while the `N-DX-Item` trailer in the message survives both. So
 * schema v2 stores no `commits` (see `RETIRED_STATE_FIELDS`), and the commits
 * of a change are the commits reachable from main, through merge commits and
 * not first-parent only, whose trailer names the change or one of its tasks.
 *
 * Two trailer forms name an item: the dashboard permalink hench writes today
 * (`<publicUrl>/#/rex/item/<id>`, any host) and the bare item id.
 *
 * The only part of a commit message read is the `N-DX-Item` trailer, which
 * git extracts (`%(trailers:key=…)`). No subject or body is requested, so
 * nothing can come to depend on how a host words a merge commit.
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
export const DEFAULT_MAIN_REF = "main";
export const ITEM_TRAILER_KEY = "N-DX-Item";

/** Bumped when the cached shape changes, so an older file is rebuilt rather than misread. */
const CACHE_VERSION = 1;
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
  /** Item ids its `N-DX-Item` trailers name, in trailer order. */
  items: string[];
}

export interface ChangeCommitsOptions {
  /** Directory inside the git repository to read. */
  repoDir: string;
  /** Rex's derived-state directory (`RexPaths.cacheDir`). */
  cacheDir: string;
  /** The branch commits must be reachable from. Default {@link DEFAULT_MAIN_REF}. */
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
 * Throws when the ref does not resolve.
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
  const ref = options.ref ?? DEFAULT_MAIN_REF;
  const tip = await resolveCommit(options.repoDir, ref);
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
 * Field and record separators for the scan. Neither can occur in a SHA, an
 * ISO date or a trailer value; an author name containing one would only
 * corrupt that commit's author fields.
 */
const FS = "\x1f";
const RS = "\x1e";
const SCAN_FORMAT = [
  "%H", "%P", "%an", "%ae", "%aI",
  `%(trailers:key=${ITEM_TRAILER_KEY},valueonly,unfold,separator=%x1f)`,
].join("%x1f");

/** Scan every commit reachable from `tip` (all parents of merges) for `N-DX-Item` trailers. */
export async function scanTrailerCommits(repoDir: string, tip: string): Promise<TrailerCommit[]> {
  // --no-show-signature: with `log.showSignature` set, git prints signature
  // checks for signed commits (GitHub signs its web merges) to stdout, which
  // would land inside the previous record's trailer field and drop its items.
  const stdout = await git(repoDir, ["log", "--no-show-signature", `--format=%x1e${SCAN_FORMAT}`, tip, "--"]);
  const commits: TrailerCommit[] = [];
  for (const record of stdout.split(RS)) {
    if (record.trim() === "") continue;
    const [hash, parents, author, authorEmail, timestamp, ...trailers] = record.replace(/\n+$/, "").split(FS);
    const items = trailers.map(itemIdFromTrailer).filter((id): id is string => id !== undefined);
    if (items.length === 0) continue;
    commits.push({
      hash,
      parents: parents ? parents.split(" ") : [],
      author,
      authorEmail,
      timestamp,
      items: [...new Set(items)],
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

async function resolveCommit(repoDir: string, ref: string): Promise<string> {
  return (await git(repoDir, ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
}

async function git(repoDir: string, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd: repoDir, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER });
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
async function readJsonCache<T extends { version: number }>(path: string, valid: (cache: T) => boolean): Promise<T | null> {
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

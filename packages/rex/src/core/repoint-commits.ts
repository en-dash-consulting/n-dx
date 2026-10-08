/**
 * Re-point recorded commit SHAs that a rebase or squash rewrote.
 *
 * Schema v2 stores no commit SHAs (see `change-commits.ts`), but other tools
 * still record them: hench run records, and resolutions that cite a commit.
 * When such a SHA is not reachable from main, this finds the commit it became,
 * trying each rule in order and stopping at the first that names exactly one
 * commit:
 *
 * 1. `on-main` — the SHA is reachable from main already.
 * 2. `author-date-subject` — a main commit with the same author email, author
 *    date and subject. A rebase or cherry-pick keeps all three.
 * 3. `patch-id` — a main commit with the same `git patch-id --stable`. Catches
 *    a squash of a one-commit branch.
 * 4. `trailer-subject` — a main commit with the same subject whose
 *    `N-DX-Item` trailer names one of the same items.
 * 5. `host-pull-request` — only when a {@link CommitHost} is injected: the
 *    merge commit of the pull request that carried it. The only rule for a
 *    squash of a longer branch, and for a SHA no longer in the repository.
 *
 * A rule naming several commits is ambiguous and falls through to the next.
 * Every SHA comes back either matched (old → new, with the rule) or unmatched
 * with a reason; none is dropped. Without a host everything is read from git.
 *
 * Merge commits are never twin, patch-id or trailer candidates: a merge's
 * subject is the host's wording, not the author's.
 *
 * @module rex/core/repoint-commits
 */

import { assertFullHistory, git, itemIdFromTrailer, ITEM_TRAILER_KEY, resolveMainRef } from "./change-commits.js";

export type RepointRule = "on-main" | "author-date-subject" | "patch-id" | "trailer-subject" | "host-pull-request";

export const REPOINT_RULES: readonly RepointRule[] = [
  "on-main", "author-date-subject", "patch-id", "trailer-subject", "host-pull-request",
];

/**
 * A code host that knows which pull requests contained a commit. Optional:
 * inject one only to resolve what git alone cannot (squash merges of
 * multi-commit branches, SHAs no longer in the repository).
 */
export interface CommitHost {
  /**
   * Merge commits of the merged pull requests that contained `sha` (for
   * GitHub, `merge_commit_sha` of `GET /repos/{owner}/{repo}/commits/{sha}/pulls`).
   * Empty when none did.
   */
  mergeCommitsFor(sha: string): Promise<string[]>;
}

export interface RepointOptions {
  /** Directory inside the git repository to read. */
  repoDir: string;
  /** The branch SHAs should be reachable from. Default: as `computeChangeCommits`. */
  ref?: string;
  /** Off by default: without it, only git is read. */
  host?: CommitHost;
}

export interface RepointMatch {
  /** The SHA as recorded. */
  old: string;
  /** Full SHA of the commit on main it became (the same commit for `on-main`). */
  new: string;
  rule: RepointRule;
}

export interface RepointMiss {
  /** The SHA as recorded. */
  sha: string;
  reason: string;
}

export interface RepointResult {
  ref: string;
  tip: string;
  /** In input order. */
  matched: RepointMatch[];
  /** In input order. */
  unmatched: RepointMiss[];
}

/** What the git rules compare. */
export interface CommitFacts {
  hash: string;
  authorEmail: string;
  /** Author date, ISO 8601 with offset, as git prints `%aI`. */
  authorDate: string;
  subject: string;
  /** Item ids its `N-DX-Item` trailers name. */
  items: string[];
}

/** Lookup tables over main's non-merge commits, built by {@link indexMainCommits}. */
export interface MainCommitIndex {
  byTwinKey: Map<string, string[]>;
  byItemSubject: Map<string, string[]>;
}

type RuleOutcome = { hash: string } | { ambiguous: number } | null;

const SHA = /^[0-9a-f]{4,64}$/i;
const FS = "\x1f";
const RS = "\x1e";
const FACTS_FORMAT = [
  "%H", "%ae", "%aI", "%s",
  `%(trailers:key=${ITEM_TRAILER_KEY},valueonly,unfold,separator=%x1f)`,
].join("%x1f");

const twinKey = (c: CommitFacts) => [c.authorEmail.toLowerCase(), c.authorDate, c.subject].join("\0");
const itemSubjectKey = (item: string, subject: string) => `${item}\0${subject}`;

function push(map: Map<string, string[]>, key: string, hash: string): void {
  const list = map.get(key);
  if (!list) map.set(key, [hash]);
  else if (!list.includes(hash)) list.push(hash);
}

/** Index main's non-merge commits for the twin and trailer-subject rules. */
export function indexMainCommits(commits: Iterable<CommitFacts>): MainCommitIndex {
  const index: MainCommitIndex = { byTwinKey: new Map(), byItemSubject: new Map() };
  for (const c of commits) {
    push(index.byTwinKey, twinKey(c), c.hash);
    for (const item of c.items) push(index.byItemSubject, itemSubjectKey(item, c.subject), c.hash);
  }
  return index;
}

function single(candidates: Iterable<string> | undefined): RuleOutcome {
  const distinct = [...new Set(candidates ?? [])];
  if (distinct.length === 0) return null;
  return distinct.length === 1 ? { hash: distinct[0] } : { ambiguous: distinct.length };
}

/** Rule 2: the main commit with the same author email, author date and subject. */
export function findTwin(old: CommitFacts, index: MainCommitIndex): RuleOutcome {
  return single(index.byTwinKey.get(twinKey(old)));
}

/** Rule 4: the main commit with the same subject and an `N-DX-Item` trailer naming one of the same items. */
export function findTrailerSubject(old: CommitFacts, index: MainCommitIndex): RuleOutcome {
  return single(old.items.flatMap((item) => index.byItemSubject.get(itemSubjectKey(item, old.subject)) ?? []));
}

/** Rule 3: the main commit with the same patch-id. */
export function findPatchTwin(oldPatchId: string | undefined, mainByPatchId: Map<string, string[]>): RuleOutcome {
  return oldPatchId === undefined ? null : single(mainByPatchId.get(oldPatchId));
}

/**
 * Re-point each recorded SHA to the commit on main it became. See the module
 * doc for the rules. Throws when the ref does not resolve or the clone is
 * shallow (a truncated history would make landed commits read as unmatched).
 */
export async function repointCommits(shas: Iterable<string>, options: RepointOptions): Promise<RepointResult> {
  const { repoDir, host } = options;
  const { ref, tip } = await resolveMainRef(repoDir, options.ref);
  await assertFullHistory(repoDir);

  const recorded = [...new Set([...shas].map((s) => s.trim()))];
  const outcome = new Map<string, RepointMatch | RepointMiss>();
  const miss = (sha: string, reason: string) => outcome.set(sha, { sha, reason });
  const match = (old: string, hash: string, rule: RepointRule) => outcome.set(old, { old, new: hash, rule });

  const wellFormed: string[] = [];
  for (const sha of recorded) {
    if (SHA.test(sha)) wellFormed.push(sha);
    else miss(sha, "not a commit SHA");
  }
  const resolved = await resolveLocalCommits(repoDir, wellFormed);
  const onMain = await reachableFrom(repoDir, tip);

  /** Recorded SHA → why the git rules found nothing (or "not in this repository"). */
  const gitMiss = new Map<string, string>();
  const offMain: { sha: string; full: string }[] = [];
  for (const sha of wellFormed) {
    const full = resolved.get(sha);
    if (typeof full !== "string") gitMiss.set(sha, full?.reason ?? "not in this repository");
    else if (onMain.has(full)) match(sha, full, "on-main");
    else offMain.push({ sha, full });
  }

  if (offMain.length > 0) {
    const oldFacts = new Map((await readFacts(repoDir, ["--no-walk=unsorted", ...offMain.map((o) => o.full)])).map((f) => [f.hash, f]));
    const index = indexMainCommits(await readFacts(repoDir, ["--no-merges", tip]));
    const earliest = minDate([...oldFacts.values()].map((f) => f.authorDate));
    let patchIds: { old: Map<string, string>; main: Map<string, string[]> } | undefined;

    for (const { sha, full } of offMain) {
      const facts = oldFacts.get(full);
      if (!facts) throw new Error(`git log printed no record for ${full} in ${repoDir}`);
      const ambiguous: string[] = [];
      const tryRule = (rule: RepointRule, result: RuleOutcome): boolean => {
        if (result && "hash" in result) {
          match(sha, result.hash, rule);
          return true;
        }
        if (result) ambiguous.push(`${result.ambiguous} commits share its ${describeRule(rule)}`);
        return false;
      };
      if (tryRule("author-date-subject", findTwin(facts, index))) continue;
      patchIds ??= await readPatchIds(repoDir, offMain.map((o) => o.full), tip, earliest);
      if (tryRule("patch-id", findPatchTwin(patchIds.old.get(full), patchIds.main))) continue;
      if (tryRule("trailer-subject", findTrailerSubject(facts, index))) continue;
      gitMiss.set(sha, [
        `no commit on ${ref} matches it by author date and subject, patch-id, or N-DX-Item trailer and subject`,
        ...ambiguous,
      ].join("; "));
    }
  }

  for (const [sha, reason] of gitMiss) {
    if (!host) {
      miss(sha, `${reason}; no host lookup configured`);
      continue;
    }
    const viaHost = await hostLookup(host, repoDir, sha, onMain);
    if ("hash" in viaHost) match(sha, viaHost.hash, "host-pull-request");
    else miss(sha, `${reason}; ${viaHost.reason}`);
  }

  const matched: RepointMatch[] = [];
  const unmatched: RepointMiss[] = [];
  for (const sha of recorded) {
    const o = outcome.get(sha)!;
    if ("new" in o) matched.push(o);
    else unmatched.push(o);
  }
  return { ref, tip, matched, unmatched };
}

function describeRule(rule: RepointRule): string {
  switch (rule) {
    case "author-date-subject": return "author, author date and subject";
    case "patch-id": return "patch-id";
    case "trailer-subject": return "N-DX-Item trailer and subject";
    default: return rule;
  }
}

async function hostLookup(
  host: CommitHost,
  repoDir: string,
  sha: string,
  onMain: Set<string>,
): Promise<{ hash: string } | { reason: string }> {
  let merges: string[];
  try {
    merges = await host.mergeCommitsFor(sha);
  } catch (err) {
    return { reason: `host lookup failed: ${(err as Error).message}` };
  }
  if (merges.length === 0) return { reason: "the host names no merged pull request that contained it" };
  const resolved = await resolveLocalCommits(repoDir, merges.filter((m) => SHA.test(m)));
  const landed = new Set<string>();
  const notLanded: string[] = [];
  for (const merge of merges) {
    const full = resolved.get(merge);
    if (typeof full === "string" && onMain.has(full)) landed.add(full);
    else notLanded.push(merge);
  }
  if (landed.size === 1) return { hash: [...landed][0] };
  if (landed.size > 1) return { reason: `the host names ${landed.size} merge commits on main for it` };
  return { reason: `the host's merge commit${notLanded.length > 1 ? "s" : ""} ${notLanded.join(", ")} not on main here (fetch?)` };
}

/**
 * Full SHA for each recorded SHA present in the repository as a commit, or a
 * reason when git finds it ambiguous or not a commit. Absent SHAs are omitted.
 */
async function resolveLocalCommits(repoDir: string, shas: string[]): Promise<Map<string, string | { reason: string }>> {
  const out = new Map<string, string | { reason: string }>();
  if (shas.length === 0) return out;
  // One batch-check line per input, in order: "<sha> <type> <size>", "<name> missing" or "<name> ambiguous".
  const lines = (await git(repoDir, ["cat-file", "--batch-check"], shas.join("\n") + "\n")).split("\n");
  shas.forEach((sha, i) => {
    const [first, second] = (lines[i] ?? "").split(" ");
    if (second === "commit") out.set(sha, first);
    else if (second === "ambiguous") out.set(sha, { reason: "abbreviated SHA names more than one object here" });
    else if (second !== "missing") out.set(sha, { reason: `names a ${second ?? "unknown object"}, not a commit` });
  });
  return out;
}

async function reachableFrom(repoDir: string, tip: string): Promise<Set<string>> {
  return new Set((await git(repoDir, ["rev-list", tip, "--"])).split("\n").filter(Boolean));
}

async function readFacts(repoDir: string, revs: string[]): Promise<CommitFacts[]> {
  const stdout = await git(repoDir, ["log", "--no-show-signature", `--format=%x1e${FACTS_FORMAT}`, ...revs, "--"]);
  const out: CommitFacts[] = [];
  for (const record of stdout.split(RS)) {
    if (record.trim() === "") continue;
    const [hash, authorEmail, authorDate, subject, ...trailers] = record.replace(/\n+$/, "").split(FS);
    const items = trailers.map(itemIdFromTrailer).filter((id): id is string => id !== undefined);
    out.push({ hash, authorEmail, authorDate, subject, items: [...new Set(items)] });
  }
  return out;
}

/**
 * `git patch-id --stable` for the recorded commits, and for main's non-merge
 * commits committed since the earliest recorded author date (a commit cannot
 * land before it was written, so older ones cannot match).
 */
async function readPatchIds(
  repoDir: string,
  olds: string[],
  tip: string,
  since: string,
): Promise<{ old: Map<string, string>; main: Map<string, string[]> }> {
  const old = new Map<string, string>();
  for (const [patchId, hash] of await patchIdsOf(repoDir, ["--no-walk=unsorted", ...olds])) old.set(hash, patchId);
  const main = new Map<string, string[]>();
  for (const [patchId, hash] of await patchIdsOf(repoDir, ["--no-merges", `--since=${since}`, tip])) push(main, patchId, hash);
  return { old, main };
}

async function patchIdsOf(repoDir: string, revs: string[]): Promise<[string, string][]> {
  // --format=commit %H is the header patch-id splits on; the message is left out.
  const patches = await git(repoDir, [
    "log", "--no-show-signature", "--no-color", "--no-ext-diff", "--no-textconv", "-p", "--format=commit %H", ...revs, "--",
  ]);
  if (patches.trim() === "") return [];
  const out = await git(repoDir, ["patch-id", "--stable"], patches);
  return out.split("\n").filter(Boolean).map((line) => line.split(" ") as [string, string]);
}

function minDate(dates: string[]): string {
  return dates.reduce((a, b) => (Date.parse(b) < Date.parse(a) ? b : a));
}

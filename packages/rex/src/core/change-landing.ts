/**
 * When a change landed on main, worked out from git history alone.
 *
 * Nothing here reads a commit message, so nothing depends on how GitHub or
 * Bitbucket word a merge commit (Bitbucket's default omits the PR description).
 * The only text consulted is the `N-DX-Item` trailer, through
 * `loadTrailerCommits`.
 *
 * A change's commits are the trailer commits reachable from main that name the
 * change or one of its tasks (`change-commits.ts`). Each lands where main's
 * first-parent line first contains it:
 *
 * - a merge commit: the first-parent merge whose merged branch holds the commit;
 * - a fast-forward or rebase merge: the commit itself, the first main commit
 *   that contains it.
 *
 * The change landed with its last commit, so its landing is the newest of those.
 * A rebase rewrites SHAs but keeps trailers, so a rebased change reports the
 * landing of its rewritten copies on main. No commit reachable from main (a
 * squash or rebase merge that dropped the trailer, or no merge yet) is
 * `landed: false` with the reason; the change's original branch commits are not
 * on main, so there is nothing for git alone to follow.
 *
 * ## Cache
 *
 * One pass over main's history assigns every trailer commit its landing,
 * written to `<rexDir>/.cache/{@link CHANGE_LANDING_CACHE_FILENAME}` (gitignored
 * by `rex init`) and keyed by the ref's tip SHA like the trailer cache.
 *
 * ## shippedIn
 *
 * A stamped `shippedIn` wins. Without one, {@link resolveShippedIn} falls back
 * to the first release tag (`X.Y.Z`, `vX.Y.Z` or `<package>@X.Y.Z`, no
 * prerelease suffix) containing the landing commit.
 *
 * @module rex/core/change-landing
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { indexTree, type V2Tree } from "../schema/v2-rules.js";
import type { ChangeNode } from "../schema/v2.js";
import { atomicWrite } from "../store/atomic-write.js";
import {
  assertFullHistory,
  CACHE_VERSION,
  git,
  loadTrailerCommits,
  readJsonCache,
  resolveMainRef,
  type ChangeCommitsOptions,
} from "./change-commits.js";
import { trailerIds } from "./product-edges.js";

export const CHANGE_LANDING_CACHE_FILENAME = "commit-landing.json";

export type ChangeLanding =
  | {
      landed: true;
      /** The main commit that brought the change in: a merge commit, or the commit itself when fast-forwarded or rebased. */
      commit: string;
      /** The change's newest commit on main, which that landing carries. */
      lastCommit: string;
    }
  | { landed: false; reason: string };

interface Landed {
  /** Landing commit SHA. */
  commit: string;
  /** Its index on main's first-parent line, oldest first: orders landings. */
  position: number;
}

interface LandingCache {
  version: number;
  ref: string;
  tip: string;
  landed: Record<string, Landed>;
}

/**
 * The landing of every given commit, by commit SHA. Commits not reachable from
 * `tip` are absent. One walk over history, oldest first-parent commit first:
 * each first-parent commit claims every ancestor not already claimed.
 */
export async function scanLandings(repoDir: string, tip: string, commits: ReadonlySet<string>): Promise<Map<string, Landed>> {
  const stdout = await git(repoDir, ["rev-list", "--parents", tip, "--"]);
  const parentsOf = new Map<string, string[]>();
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const [hash, ...parents] = line.split(" ");
    parentsOf.set(hash, parents);
  }

  const firstParentLine: string[] = [];
  for (let c: string | undefined = tip; c !== undefined; c = parentsOf.get(c)?.[0]) firstParentLine.push(c);
  firstParentLine.reverse();

  const claimed = new Set<string>();
  const out = new Map<string, Landed>();
  firstParentLine.forEach((landing, position) => {
    const stack = [landing];
    while (stack.length > 0) {
      const c = stack.pop() as string;
      if (claimed.has(c)) continue;
      claimed.add(c);
      if (commits.has(c)) out.set(c, { commit: landing, position });
      stack.push(...(parentsOf.get(c) ?? []));
    }
  });
  return out;
}

async function loadLandings(options: ChangeCommitsOptions): Promise<Record<string, Landed>> {
  const { ref, tip } = await resolveMainRef(options.repoDir, options.ref);
  await assertFullHistory(options.repoDir);
  const path = join(options.cacheDir, CHANGE_LANDING_CACHE_FILENAME);
  const cached = await readJsonCache<LandingCache>(path, (c) => typeof c.tip === "string" && typeof c.landed === "object" && c.landed !== null);
  if (cached && cached.ref === ref && cached.tip === tip) return cached.landed;

  const trailerCommits = await loadTrailerCommits({ ...options, ref });
  const landed = Object.fromEntries(await scanLandings(options.repoDir, tip, new Set(trailerCommits.map((c) => c.hash))));
  await mkdir(options.cacheDir, { recursive: true });
  const cache: LandingCache = { version: CACHE_VERSION, ref, tip, landed };
  await atomicWrite(path, JSON.stringify(cache) + "\n");
  return landed;
}

/**
 * Where a set of item ids (a change's id and its tasks', plus aliases) landed
 * on main. Throws when the ref does not resolve or the clone is shallow, like
 * `computeChangeCommits`: a truncated history would read as not landed.
 */
export async function computeLanding(itemIds: Iterable<string>, options: ChangeCommitsOptions): Promise<ChangeLanding> {
  const wanted = new Set(itemIds);
  const { ref } = await resolveMainRef(options.repoDir, options.ref);
  const commits = (await loadTrailerCommits({ ...options, ref })).filter((c) => c.items.some((id) => wanted.has(id)));
  if (commits.length === 0) {
    return {
      landed: false,
      reason:
        `no commit naming this change or its tasks is reachable from ${ref}: ` +
        "its branch is unmerged, or was squash- or rebase-merged without the N-DX-Item trailer",
    };
  }
  const landings = await loadLandings({ ...options, ref });
  let latest: { hash: string; landed: Landed } | undefined;
  for (const { hash } of commits) {
    const landed = landings[hash];
    if (landed && (latest === undefined || landed.position > latest.landed.position)) latest = { hash, landed };
  }
  if (!latest) throw new Error(`commit-landing cache has no entry for ${commits[0].hash}; delete ${options.cacheDir} and retry`);
  return { landed: true, commit: latest.landed.commit, lastCommit: latest.hash };
}

/**
 * The landing of every live change (cancelled and retired ones will never
 * land), by change id. A change's commits are those naming it, its tasks or
 * subtasks, or an alias of any.
 */
export async function computeLandings(tree: V2Tree, options: ChangeCommitsOptions): Promise<Record<string, ChangeLanding>> {
  const out: Record<string, ChangeLanding> = {};
  for (const { node, retired } of indexTree(tree, { includeTombstones: true }).entries) {
    if (node.type !== "change" || retired || node.status === "cancelled") continue;
    out[node.id] = await computeLanding(trailerIds(node), options);
  }
  return out;
}

// ── shippedIn ────────────────────────────────────────────────────

/** `X.Y.Z`, `vX.Y.Z`, or a changesets monorepo tag `<package>@X.Y.Z`; no prerelease suffix. */
const RELEASE_TAG = /^(?:\S+@)?v?(\d+\.\d+\.\d+)$/;

/** The version of the earliest-created release tag (see {@link RELEASE_TAG}) whose history contains `commit`, or undefined. */
export async function firstReleaseContaining(repoDir: string, commit: string): Promise<string | undefined> {
  const tags = await git(repoDir, ["tag", "--contains", commit, "--sort=creatordate"]);
  for (const tag of tags.split("\n")) {
    const version = RELEASE_TAG.exec(tag.trim())?.[1];
    if (version !== undefined) return version;
  }
  return undefined;
}

/**
 * The release a change shipped in: its stamped `shippedIn`, else the first
 * release tag containing its landing commit. Undefined when unstamped and not
 * landed, or landed but not yet in a release.
 */
export async function resolveShippedIn(
  change: Pick<ChangeNode, "shippedIn">,
  landing: ChangeLanding,
  repoDir: string,
): Promise<string | undefined> {
  if (change.shippedIn) return change.shippedIn;
  return landing.landed ? firstReleaseContaining(repoDir, landing.commit) : undefined;
}

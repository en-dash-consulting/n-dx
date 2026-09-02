/**
 * Review-repair tracking — which files the adversarial review pass changed,
 * and the commit that keeps those changes from being orphaned.
 *
 * On the autoCommit path the executor commits its own work *before* the
 * review pass runs, the reviewer is barred from committing, and the
 * completion-metadata commit stages only `.rex/prd_tree` — so a repair the
 * reviewer applies in-session is owned by nobody and gets swept into
 * whatever commit happens next (observed live in run 4b4526c5). The fix is
 * to bracket the reviewer spawn with working-tree snapshots, diff them to
 * find exactly what the reviewer changed — never pre-existing user dirt —
 * and commit precisely those paths with run-scoped trailers.
 *
 * The snapshot hashes file *content* rather than trusting `git status`
 * alone: a file that was already dirty before the reviewer ran and stayed
 * byte-identical must not be attributed to the review.
 *
 * @module hench/agent/analysis/review-repairs
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execStdout } from "../../process/exec.js";

const GIT_TIMEOUT = 30_000;

/** Sentinel hash for a path that is listed as dirty but unreadable (deleted). */
const ABSENT = "<absent>";

/** Dirty working-tree paths (repo-relative) mapped to a content hash. */
export type DirtySnapshot = Map<string, string>;

/**
 * Snapshot every dirty path in the working tree (tracked modifications,
 * deletions, and untracked files — `--untracked-files=all` so new files
 * inside untracked directories are listed individually) with a content hash.
 */
export async function snapshotDirtyState(
  projectDir: string,
  timeout = GIT_TIMEOUT,
): Promise<DirtySnapshot> {
  const raw = await execStdout(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: projectDir, timeout },
  );

  const fields = raw.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    // Rename/copy entries carry the source path as a second NUL-separated
    // field; consume it so it is not misread as a status entry.
    if (entry[0] === "R" || entry[0] === "C") i++;
  }

  const snapshot: DirtySnapshot = new Map();
  for (const path of paths) {
    snapshot.set(path, await hashFile(join(projectDir, path)));
  }
  return snapshot;
}

async function hashFile(absPath: string): Promise<string> {
  try {
    return createHash("sha256").update(await readFile(absPath)).digest("hex");
  } catch {
    return ABSENT;
  }
}

/**
 * Paths whose dirty state changed between two snapshots: modified content,
 * newly dirty, or cleaned up (deleted, or reverted to HEAD content — those
 * stage to nothing and fall out at commit time).
 */
export function diffDirtyState(before: DirtySnapshot, after: DirtySnapshot): string[] {
  const changed = new Set<string>();
  for (const [path, hash] of after) {
    if (before.get(path) !== hash) changed.add(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changed.add(path);
  }
  return [...changed];
}

export interface CommitReviewRepairsOptions {
  /** Repo-relative paths the review pass changed. */
  paths: string[];
  /** Run whose review produced the repairs; referenced in the subject line. */
  runId: string;
  /** Task the run executed; referenced in the trailer block. */
  taskId: string;
  /** Co-authorship trailer line, supplied by the caller to avoid a lifecycle import. */
  trailer: string;
  timeout?: number;
}

/**
 * Commit exactly the given paths as the review pass's repair commit.
 *
 * Uses a pathspec commit (`git commit -- <paths>`) so content staged by
 * anything else stays staged and out of this commit. Returns the new commit
 * hash, or undefined when the paths held nothing to commit (e.g. the only
 * "change" was a dirty file reverted back to HEAD content).
 */
export async function commitReviewRepairs(
  projectDir: string,
  opts: CommitReviewRepairsOptions,
): Promise<string | undefined> {
  const { paths, runId, taskId, trailer, timeout = GIT_TIMEOUT } = opts;
  if (paths.length === 0) return undefined;

  const head = (
    await execStdout("git", ["rev-parse", "HEAD"], { cwd: projectDir, timeout })
  ).trim();

  await execStdout("git", ["add", "-A", "--", ...paths], { cwd: projectDir, timeout });
  await execStdout(
    "git",
    [
      "commit",
      "-m",
      `fix(review): apply adversarial-review repairs (run ${runId})`,
      "-m",
      `N-DX: review-pass repairs (task ${taskId})\n${trailer}`,
      "--",
      ...paths,
    ],
    { cwd: projectDir, timeout },
  );

  const newHead = (
    await execStdout("git", ["rev-parse", "HEAD"], { cwd: projectDir, timeout })
  ).trim();
  return newHead && newHead !== head ? newHead : undefined;
}

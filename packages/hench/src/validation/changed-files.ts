/**
 * Git-derived discovery of what a run actually changed.
 *
 * ## Why not ask the model
 *
 * The full-suite gate skips when it believes nothing changed, so this set
 * decides whether a run's tests run at all. It used to come from the model's
 * own summary of what it had done, with a `git diff HEAD` fallback that only
 * fired when the loop recorded no tool calls — which never happens on the
 * Claude CLI. The result was the worst possible failure: on the default path
 * the gate read an empty list and skipped, reporting "no files modified" for
 * runs that had modified files.
 *
 * ## Why the baseline is the pre-run commit, not HEAD
 *
 * `git diff HEAD` answers "what is uncommitted", which is not the question.
 * On the autoCommit path the executor commits its own work before the gate
 * runs, so HEAD already contains it and the diff is empty. Diffing the working
 * tree against the commit the run *started* from captures both what was
 * committed during the run and what is still uncommitted — including repairs
 * the adversarial review pass made after the run summary was parsed.
 *
 * Untracked files are added separately (a diff never lists them), minus the
 * untracked files that were already present when the run started: those are
 * the user's, not this run's.
 *
 * ## Why an unborn HEAD is not a failure
 *
 * A repository with no commits has no HEAD to diff against, so `git diff`
 * fails exactly as it does outside a repository. Reading both as "git could
 * not answer" made every completion claim in a freshly `git init`-ed project
 * unverifiable: the agent wrote real files, the gate saw no evidence, and the
 * run failed with "No changes detected" — permanently, since nothing the
 * agent could do would produce a commit to diff from. An unborn HEAD is a
 * *known* baseline of nothing, so the working tree is read from
 * `git status` instead and everything in it counts.
 *
 * @module hench/validation/changed-files
 */

import { exec } from "../process/exec.js";
import {
  isHenchRuntimeArtifact,
  matchesProjectPath,
  parsePorcelainPath,
  repoRelativePrefix,
  splitPorcelainLines,
} from "../store/artifacts.js";

const GIT_TIMEOUT = 10_000;

/**
 * Paths that are never the run's work product, excluded from the result.
 *
 * `.rex/` is bookkeeping hench itself writes on every run — the task-status
 * update dirties the task's `index.md` before the agent has done anything —
 * and `.hench/` holds run records and review reports. The agent's own prompt
 * forbids modifying either directly, and the reviewer's repaired-files set
 * already filters them (see cli-loop.ts). Left in, they make every run look
 * like it changed files, so the full-suite gate fires for runs that produced
 * no code at all — and a pre-existing failure anywhere in the workspace then
 * fails the run and resets a task that was never the cause.
 *
 * Project-relative with a trailing slash, matched through
 * {@link matchesProjectPath} rather than a bare `startsWith`. Git reports
 * porcelain and diff paths relative to the *repository* root, so in a project
 * nested below that root the real lines read `sub/.rex/…` and a bare prefix
 * test misses every one of them — every run then "changed files" on its own
 * status write alone, which is exactly the vacuous gate this list exists to
 * prevent.
 */
const BOOKKEEPING_PREFIXES = [".rex/", ".hench/"];

/**
 * Decide, for one repository, whether a path is hench's own bookkeeping.
 *
 * Combines the PRD/run-record directories above with
 * {@link isHenchRuntimeArtifact}, hench's shared runtime-artifact list. The
 * second is not redundant: `.hench-commit-msg.txt` is the commit-message
 * handoff hench writes at the repository *root*, so it is under neither
 * `.rex/` nor `.hench/`, and a run whose only output was that file used to
 * satisfy the completion gate on hench's own scratch file.
 *
 * `repoPrefix` comes from {@link repoRelativePrefix} — see the note on
 * {@link BOOKKEEPING_PREFIXES} for why it is required.
 */
function makeBookkeepingFilter(repoPrefix: string): (path: string) => boolean {
  return (path: string) =>
    matchesProjectPath(path, BOOKKEEPING_PREFIXES, repoPrefix) ||
    isHenchRuntimeArtifact(path, repoPrefix);
}

/** One `git status --porcelain` entry, reduced to what this module needs. */
interface StatusEntry {
  path: string;
  /** True for a `??` line — a file git has never been told about. */
  untracked: boolean;
}

/**
 * List working-tree status entries individually.
 *
 * Deliberately not `listUntrackedPaths` from `./review.js`: that uses a plain
 * `--porcelain`, which collapses a new directory to a single `src/` entry.
 * That is the right granularity for the rollback path it serves (`git clean
 * -fd -- src/` removes the tree), but useless here — the test gate aggregates
 * results per file path, and `src/` names no file and maps to no package.
 *
 * Tracked entries are returned alongside the untracked ones because the
 * unborn-HEAD baseline has no diff to read them from; see
 * {@link discoverChangedFiles}.
 */
async function listStatusEntries(projectDir: string, timeout: number): Promise<StatusEntry[]> {
  const result = await exec(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: projectDir, timeout },
  );
  if (result.exitCode !== 0) return [];
  return splitPorcelainLines(result.stdout)
    .map((line) => ({ path: parsePorcelainPath(line), untracked: line.startsWith("??") }))
    .filter((entry) => entry.path.length > 0);
}

/**
 * True when `projectDir` is inside a repository whose HEAD has no commit yet.
 *
 * This is a *known* baseline, not a missing one: a repository with no commits
 * started from nothing, so everything present is the run's work. Telling it
 * apart from "not a repository" is the whole point — `git diff HEAD` fails
 * identically in both cases, and collapsing them made every completion claim
 * in a freshly `git init`-ed project unverifiable, so a run that wrote real
 * files was rejected with "No changes detected" and could never finish.
 */
async function hasUnbornHead(projectDir: string, timeout: number): Promise<boolean> {
  const inWorkTree = await exec("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectDir,
    timeout,
  }).catch(() => undefined);
  if (!inWorkTree || inWorkTree.exitCode !== 0 || inWorkTree.stdout.trim() !== "true") {
    return false;
  }

  // `--verify --quiet` exits non-zero on an unborn HEAD and prints nothing.
  const head = await exec("git", ["rev-parse", "--verify", "--quiet", "HEAD"], {
    cwd: projectDir,
    timeout,
  }).catch(() => undefined);
  return head !== undefined && head.exitCode !== 0;
}

export interface DiscoverChangedFilesOptions {
  projectDir: string;
  /**
   * Commit the run started from. When omitted, falls back to `HEAD`, which
   * sees uncommitted work only — correct for loops that never commit
   * mid-run, and the best available answer when no baseline was captured.
   */
  startingHead?: string;
  /** Untracked paths present before the run; excluded from the result. */
  baselineUntracked?: string[];
  timeout?: number;
}

/**
 * Repo-relative paths this run changed, or undefined when git could not
 * answer.
 *
 * The undefined case is deliberately distinct from an empty array: "git is
 * unavailable, or the baseline commit is unknown" must not be read as
 * "nothing changed", because the caller decides whether to run tests on that
 * answer. Callers should keep their previous behavior on undefined.
 */
export async function discoverChangedFiles(
  opts: DiscoverChangedFilesOptions,
): Promise<string[] | undefined> {
  const { projectDir, startingHead, baselineUntracked, timeout = GIT_TIMEOUT } = opts;
  const baseline = startingHead?.trim() || "HEAD";

  const diff = await exec("git", ["diff", "--name-only", baseline], {
    cwd: projectDir,
    timeout,
  }).catch(() => undefined);
  const diffOutput = diff !== undefined && diff.exitCode === 0 ? diff.stdout : undefined;

  // A non-zero exit usually means the question could not be answered — not a
  // git repo, or a baseline commit this repo does not have (e.g. the run
  // started on a branch that was since rewritten). The one case that is *not*
  // unanswerable is a repository with no commits yet: its baseline is known,
  // and it is nothing, so the working tree below is the whole answer. Gated on
  // no starting head having been captured, because a caller that named a
  // commit named one this repository does not have — still unanswerable.
  const unborn =
    diffOutput === undefined &&
    !startingHead?.trim() &&
    (await hasUnbornHead(projectDir, timeout));
  if (diffOutput === undefined && !unborn) return undefined;

  const isBookkeepingPath = makeBookkeepingFilter(await repoRelativePrefix(projectDir));

  const changed = new Set<string>();
  for (const line of (diffOutput ?? "").split("\n")) {
    const path = line.trim();
    if (path && !isBookkeepingPath(path)) changed.add(path);
  }

  // Untracked files never appear in a diff, so add them explicitly. On an
  // unborn HEAD neither do tracked ones — there is no commit to diff against,
  // so the index's own additions are read from the same status output. A
  // failure here is not fatal: the diff-derived set is still better than
  // nothing.
  try {
    // The baseline may name a directory (that is what the rollback snapshot
    // records), so exclude by prefix as well as by exact match.
    const excluded = baselineUntracked ?? [];
    for (const { path, untracked } of await listStatusEntries(projectDir, timeout)) {
      if (isBookkeepingPath(path)) continue;
      if (!untracked) {
        // Tracked changes came from the diff, except when there was none.
        if (unborn) changed.add(path);
        continue;
      }
      const wasPresent = excluded.some(
        (base) => base === path || (base.endsWith("/") && path.startsWith(base)),
      );
      if (!wasPresent) changed.add(path);
    }
  } catch {
    // Keep the diff-derived set.
  }

  return [...changed];
}

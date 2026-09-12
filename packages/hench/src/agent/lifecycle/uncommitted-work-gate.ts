/**
 * The uncommitted-work gate: a task must not reach `completed` while the work
 * that completes it is still sitting in the working tree.
 *
 * WHY THIS EXISTS (GitHub #363). A run would finish, the agent's files would
 * never be committed, and the only commit to land was hench's own
 * `chore(prd): commit PRD tree changes (task <id> completed)`. The code stayed
 * uncommitted while the PRD recorded the opposite of the truth. Observed three
 * times in one session; one task left a 105-line test file plus a stray
 * `root-test-output.log`, two others left fifteen files including two
 * changesets and a new module. Every one of them had to be recovered by hand.
 *
 * It compounds in `--loop`: the next task starts on a tree still holding the
 * previous task's output, the two tangle together, and the pre-run commit gate
 * — which runs once per invocation, not per iteration — is long past.
 *
 * The gate is deliberately *not* a rollback. It never deletes anything: it
 * refuses the completion claim and names the paths, so the work is still there
 * to be committed. Losing finished work is the bug; discarding it faster is not
 * the fix.
 *
 * @module hench/agent/lifecycle/uncommitted-work-gate
 */

import { execStdout } from "../../process/exec.js";
import { PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../prd/rex-gateway.js";
import {
  excludeHenchRuntimeArtifacts,
  parsePorcelainPath,
  repoRelativePrefix,
  splitPorcelainLines,
} from "../../store/artifacts.js";

/**
 * PRD paths that a completing run commits *after* this gate runs — either via
 * the commit prompt (which stages `.rex/` alongside the agent's work) or via
 * `commitCompletionMetadata` on the autoCommit path.
 *
 * They are dirty at gate time by design: the agent's own `rex_update_status`
 * call, and hench's completion write, both land here. Counting them as leaked
 * work would refuse every completion.
 *
 * Two entries, not one. `tree-meta.json` is a tracked sidecar that *every*
 * store save rewrites, and in a project whose committed copy predates the
 * schema marker the rewrite changes its bytes — so the first PRD write of any
 * run produced ` M .rex/tree-meta.json`, which is neither a hench runtime
 * artifact nor under the tree, and the completion gate refused every task
 * forever. The same dirt defeated `--reset-deferred` (#365) one gate earlier.
 *
 * The legacy `.rex/prd.md` is deliberately absent: no PRD mutation writes it
 * any more, so a run cannot dirty it and there is nothing there to discount.
 */
export const PRD_COMMIT_PATHS: readonly string[] = [
  `.rex/${PRD_TREE_DIRNAME}/`,
  `.rex/${TREE_META_FILENAME}`,
];

/** How many paths the refusal message lists before it truncates. */
const MAX_REPORTED_PATHS = 20;

/**
 * Return the list of entries reported by `git status --porcelain`.
 * Each non-blank line represents a modified, staged, or untracked path.
 * Returns an empty array when the working tree is clean or git is unavailable.
 *
 * Hench's own runtime artifacts are discounted by the callers via
 * {@link excludeHenchRuntimeArtifacts} rather than in here, because that is a
 * policy about what counts as operator work, not a detail of how the paths
 * were obtained — and this function is an injectable seam, so a filter hidden
 * inside the default implementation would silently not apply wherever a
 * caller supplied its own.
 *
 * `--untracked-files=all` matters twice over. By default git collapses a
 * wholly-untracked directory to a single entry — a fresh project reports
 * `?? .hench/`, never `?? .hench/locks/` — so
 * {@link excludeHenchRuntimeArtifacts} could not see what was inside and the
 * run blocked on its own lock file anyway. It also makes the count honest: a
 * directory of forty new files was being reported as "1 uncommitted file(s)".
 */
export async function listDirtyPaths(projectDir: string): Promise<string[]> {
  try {
    const output = await execStdout("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: projectDir,
      timeout: 15_000,
    });
    return splitPorcelainLines(output);
  } catch {
    return [];
  }
}

export interface UncommittedWorkOptions {
  /** The directory hench is operating on. */
  projectDir: string;
  /**
   * Paths a later step of the same run will commit, so they are not leaked
   * work. Project-relative; a trailing slash matches the directory and
   * everything beneath it. See {@link PRD_COMMIT_PATHS}.
   */
  discountPaths?: readonly string[];
  /**
   * True when a commit of the index still follows this gate — the commit
   * prompt runs `git commit -F`, which lands whatever is staged. Fully-staged
   * paths are then about to be committed and do not count.
   *
   * False on the autoCommit path, where the executor was supposed to have
   * committed already: anything still staged there has no remaining owner,
   * which is precisely the leak this gate exists to catch.
   */
  stagedCommitFollows?: boolean;
  /** Test seam — defaults to the real {@link listDirtyPaths}. */
  deps?: {
    listDirty?: (dir: string) => Promise<string[]>;
  };
}

export interface UncommittedWorkResult {
  /** True when nothing of this run's work is left in the working tree. */
  clean: boolean;
  /** Repository-relative paths that are still uncommitted, in git's order. */
  paths: string[];
}

/**
 * True when a porcelain line describes a path that is wholly staged — index
 * status set, working-tree status clear.
 *
 * `??` (untracked) and `!!` (ignored) are excluded explicitly: their first
 * character is not a staged-state letter, and an untracked file is never
 * picked up by a plain `git commit`.
 *
 * `MM` (staged, then edited again) is deliberately *not* fully staged — the
 * second edit would not be committed, so the path still leaks.
 */
function isFullyStaged(line: string): boolean {
  if (line.length < 2) return false;
  const index = line[0] as string;
  const worktree = line[1] as string;
  if (index === "?" || index === "!") return false;
  return index !== " " && worktree === " ";
}

/** Normalize a path for comparison: forward slashes, no leading `./`. */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * True when `path` (repository-relative, as git reports it) is covered by one
 * of the project-relative `discounts`.
 *
 * `repoPrefix` is applied to the pattern rather than stripped from the path,
 * for the same reason {@link excludeHenchRuntimeArtifacts} does it that way:
 * a sibling project's `other/.rex/prd_tree/` is somebody else's uncommitted
 * work, not this run's.
 */
function isDiscounted(path: string, discounts: readonly string[], repoPrefix: string): boolean {
  const normalized = normalize(path);
  return discounts.some((entry) => {
    const target = repoPrefix + normalize(entry);
    if (target.endsWith("/")) {
      return (
        normalized === target ||
        normalized === target.slice(0, -1) ||
        normalized.startsWith(target)
      );
    }
    return normalized === target;
  });
}

/**
 * Find the work this run leaves behind in the working tree.
 *
 * Three things are discounted, in order: hench's own runtime artifacts (the
 * same list the pre-run gate discounts, so a lock file hench created itself
 * cannot fail a task), paths a later step of this run will commit, and — only
 * when `stagedCommitFollows` — paths that are wholly staged.
 *
 * Everything else is finished work with no owner.
 */
export async function findUncommittedWork(
  opts: UncommittedWorkOptions,
): Promise<UncommittedWorkResult> {
  const { projectDir, discountPaths = [], stagedCommitFollows = false } = opts;
  const listDirty = opts.deps?.listDirty ?? listDirtyPaths;

  const operatorLines = await excludeHenchRuntimeArtifacts(
    await listDirty(projectDir),
    projectDir,
  );
  if (operatorLines.length === 0) return { clean: true, paths: [] };

  const repoPrefix = discountPaths.length > 0 ? await repoRelativePrefix(projectDir) : "";

  const paths = operatorLines
    .filter((line) => !(stagedCommitFollows && isFullyStaged(line)))
    .map(parsePorcelainPath)
    .filter((path) => !isDiscounted(path, discountPaths, repoPrefix));

  return { clean: paths.length === 0, paths };
}

/** Render the path list of a refusal, truncated so it stays readable. */
function renderPaths(paths: string[]): string {
  const shown = paths.slice(0, MAX_REPORTED_PATHS).map((p) => `  ${p}`);
  if (paths.length > MAX_REPORTED_PATHS) {
    shown.push(`  …and ${paths.length - MAX_REPORTED_PATHS} more`);
  }
  return shown.join("\n");
}

/**
 * The message recorded on `run.error` and printed when a completion is
 * refused. Names every path, because the whole failure mode was work
 * disappearing without anyone being told which work.
 */
export function formatUncommittedWorkRefusal(paths: string[]): string {
  return (
    `⚠ Refusing to mark this task completed: ${paths.length} path(s) of its work are still uncommitted.\n` +
    `${renderPaths(paths)}\n` +
    `Nothing was discarded. Commit these paths (or delete them if they are scratch output), then re-run the task.`
  );
}

/**
 * The message printed when a loop refuses to start the next task because the
 * previous one's output is still in the tree.
 *
 * Starting anyway is what turned one leaked task into a tangle of three: the
 * next task's diff, review and commit all include files it never wrote.
 */
export function formatLoopRefusal(paths: string[]): string {
  return (
    `⚠ Stopping the loop: ${paths.length} path(s) from the previous task are still uncommitted.\n` +
    `${renderPaths(paths)}\n` +
    `Starting another task would fold them into its commit. Commit or remove them, then re-run.`
  );
}

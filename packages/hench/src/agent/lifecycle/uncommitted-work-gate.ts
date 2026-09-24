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

import { existsSync } from "node:fs";
import { join } from "node:path";
import { execStdout } from "../../process/exec.js";
import { PRD_TREE_DIRNAME, TREE_META_FILENAME } from "../../prd/rex-gateway.js";
import {
  excludeHenchRuntimeArtifacts,
  matchesProjectPath,
  parsePorcelainPath,
  repoRelativePrefix,
  splitPorcelainLines,
} from "../../store/artifacts.js";

/**
 * One entry in the single definition of the PRD paths hench's own writes
 * touch. `PRD_STAGE_PATHS` and `PRD_COMMIT_PATHS` both derive from the list
 * below — the staged set and the discounted set have drifted twice, in both
 * directions, and each drift was invisible until a project hit it:
 * `tree-meta.json` was once discounted by nobody and staged by nobody, so
 * every completion was refused; then the execution log was staged by nobody
 * but still discounted, so in a project that tracks it every completion left
 * it silently dirty and the next autonomous run's pre-run gate refused to
 * start.
 */
interface PrdWritePath {
  /** Project-relative path, forward slashes, no trailing slash. */
  path: string;
  /** A directory: the gate's discount covers everything beneath it. */
  isDirectory: boolean;
  /**
   * Who lands the write. `"hench"`: the completion/reset commits stage it.
   * `"operator"`: hench never stages it — the append-only execution log is
   * gitignored by `rex init`, and in a repository that tracks it anyway the
   * operator owns committing it; the completion path *reports* it
   * ({@link listOperatorOwnedPrdDirt}) rather than leaving it silently dirty.
   */
  stagedBy: "hench" | "operator";
}

/**
 * The single definition. These paths are dirty at gate time by design: the
 * agent's own `rex_update_status` call, and hench's completion write, land
 * here — counting them as leaked work would refuse every completion.
 *
 * `tree-meta.json` is its own entry because it is a tracked sidecar *every*
 * store save rewrites; in a project whose committed copy predated the schema
 * marker the rewrite changed its bytes, and as neither a runtime artifact nor
 * a tree path it once refused every task forever. The execution-log entries
 * carry each status transition's audit line. The legacy `.rex/prd.md` is
 * absent because no PRD mutation writes it any more (the commit prompt still
 * stages it when present, as a prompt-only legacy extra).
 */
const PRD_WRITE_PATHS: readonly PrdWritePath[] = [
  { path: `.rex/${PRD_TREE_DIRNAME}`, isDirectory: true, stagedBy: "hench" },
  { path: `.rex/${TREE_META_FILENAME}`, isDirectory: false, stagedBy: "hench" },
  { path: ".rex/execution-log.jsonl", isDirectory: false, stagedBy: "operator" },
  { path: ".rex/execution-log.1.jsonl", isDirectory: false, stagedBy: "operator" },
];

/**
 * What the completion and reset-deferred commits stage (after per-path
 * existence and gitignore filtering — see `prdPathsToStage` in shared.ts).
 */
export const PRD_STAGE_PATHS: readonly string[] = PRD_WRITE_PATHS
  .filter((entry) => entry.stagedBy === "hench")
  .map((entry) => entry.path);

/** PRD writes hench never stages; dirty ones are the operator's, and are said so. */
export const OPERATOR_PRD_PATHS: readonly string[] = PRD_WRITE_PATHS
  .filter((entry) => entry.stagedBy === "operator")
  .map((entry) => entry.path);

/**
 * What the completion gate discounts: every PRD write path, staged-by-hench
 * or not. A trailing slash marks a directory prefix for
 * {@link findUncommittedWork}'s matcher.
 */
export const PRD_COMMIT_PATHS: readonly string[] = PRD_WRITE_PATHS.map((entry) =>
  entry.isDirectory ? `${entry.path}/` : entry.path,
);

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
    .filter((path) => !matchesProjectPath(path, discountPaths, repoPrefix));

  return { clean: paths.length === 0, paths };
}

/**
 * The PRD paths ({@link PRD_COMMIT_PATHS}) that are *already* dirty in
 * `projectDir`'s working tree.
 *
 * The same match as the discount in {@link findUncommittedWork}, read the other
 * way round: that asks "what is dirty that the PRD commit won't cover", this
 * asks "what of the PRD is dirty right now".
 *
 * Exists for callers that are about to write the PRD tree and then commit it
 * wholesale. `git add .rex/prd_tree` cannot tell their write from an operator
 * edit that was already sitting there, so the only way to commit just their own
 * work is to check first and decline when something else is in the way.
 *
 * Hench's runtime artifacts are deliberately not excluded: none of them live
 * under a PRD path, so the filter would be a no-op that only obscured the
 * question being asked.
 *
 * Returns repository-relative paths in git's order — empty when the PRD is
 * clean, when the directory is not a repository, or when git is unavailable.
 */
export async function listUncommittedPrdPaths(
  projectDir: string,
  deps: { listDirty?: (dir: string) => Promise<string[]> } = {},
): Promise<string[]> {
  const listDirty = deps.listDirty ?? listDirtyPaths;
  const lines = await listDirty(projectDir);
  if (lines.length === 0) return [];

  const repoPrefix = await repoRelativePrefix(projectDir);
  return lines
    .map(parsePorcelainPath)
    .filter((path) => matchesProjectPath(path, PRD_COMMIT_PATHS, repoPrefix));
}

/** The dirty working tree, split by who wrote each path. */
export interface DirtyPathPartition {
  /** Dirty paths hench itself writes — {@link PRD_COMMIT_PATHS}. */
  prd: string[];
  /** Everything else dirty: the agent's work and the operator's own edits. */
  other: string[];
}

/**
 * Split the dirty working tree into the PRD paths hench writes and everything
 * else, in one `git status`.
 *
 * The rollback prompt is the caller that needs this distinction, and it needs
 * it to be exact. It used to offer the whole dirty tree under the sentence
 * "hench's status writes from this run" and, since the default became Yes, a
 * bare Enter reverted every tracked change in the repository — including the
 * agent's finished source edits, which are not hench's to discard. Two of the
 * four paths in the prompt that surfaced this were the agent's work.
 *
 * Hench's own runtime artifacts are excluded, as everywhere else: they are not
 * anyone's work.
 */
export async function partitionDirtyPaths(
  projectDir: string,
  deps: { listDirty?: (dir: string) => Promise<string[]> } = {},
): Promise<DirtyPathPartition> {
  const listDirty = deps.listDirty ?? listDirtyPaths;
  const lines = await excludeHenchRuntimeArtifacts(await listDirty(projectDir), projectDir);
  if (lines.length === 0) return { prd: [], other: [] };

  const repoPrefix = await repoRelativePrefix(projectDir);
  const prd: string[] = [];
  const other: string[] = [];
  for (const line of lines) {
    const path = parsePorcelainPath(line);
    if (matchesProjectPath(path, PRD_COMMIT_PATHS, repoPrefix)) prd.push(path);
    else other.push(path);
  }
  return { prd, other };
}

/**
 * Render a path list, truncated so it stays readable. Shared beyond this
 * module's own refusal messages by {@link promptRollbackConfirm} in
 * `shared.ts`, which lists the same kind of dirty paths in its revert prompt.
 */
export function renderPaths(paths: string[]): string {
  const shown = paths.slice(0, MAX_REPORTED_PATHS).map((p) => `  ${p}`);
  if (paths.length > MAX_REPORTED_PATHS) {
    shown.push(`  …and ${paths.length - MAX_REPORTED_PATHS} more`);
  }
  return shown.join("\n");
}

/**
 * The operator-owned PRD writes ({@link OPERATOR_PRD_PATHS}) still dirty in
 * `projectDir`'s working tree.
 *
 * In the common case — `rex init` gitignored the execution log — this is
 * empty: `git status --porcelain` never lists an ignored file, and a tracked
 * file cannot be ignored. It is non-empty exactly in the project this exists
 * for: one whose log predates the gitignore entry and is tracked, where every
 * completion modifies it, hench never stages it, and the gate discounts it —
 * so without a report it stayed silently dirty and the next autonomous run's
 * pre-run gate refused to start.
 */
export async function listOperatorOwnedPrdDirt(projectDir: string): Promise<string[]> {
  const lines = await listDirtyPaths(projectDir);
  if (lines.length === 0) return [];
  const repoPrefix = await repoRelativePrefix(projectDir);
  return lines
    .map(parsePorcelainPath)
    .filter((path) => matchesProjectPath(path, OPERATOR_PRD_PATHS, repoPrefix));
}

/**
 * Printed after a completion commit when {@link listOperatorOwnedPrdDirt}
 * found something — the log is never staged by hench, so silence here is what
 * turned a tracked log into a permanent pre-run-gate refusal.
 */
export function formatOperatorPrdLeftovers(paths: string[]): string {
  return (
    `note: ${paths.length} PRD bookkeeping file(s) hench never commits are uncommitted:\n` +
    `${renderPaths(paths)}\n` +
    `The execution log is yours to commit — or add .rex/execution-log*.jsonl to ` +
    `.gitignore (rex init does), so PRD writes stop dirtying the tree.`
  );
}

/**
 * Printed when a completed task's follow-up PRD "record" commit could not be
 * committed. The work itself is committed and the task stays completed — a
 * failed bookkeeping commit is a pending record, not a failed run — so the
 * message says exactly that, and the recovery commands are scoped to the
 * paths the record commit tried to stage, nothing wider: an unscoped
 * `git add`/`git commit` here would sweep whatever else the operator has in
 * flight, which is the same hazard the scoped completion commit exists to
 * avoid.
 */
export function formatRecordCommitPending(paths: string[], taskId: string, error: string): string {
  const pathspec = paths.join(" ");
  return (
    `⚠ Work committed; record not committed: the PRD record commit for task ${taskId} failed.\n` +
    `  ${error}\n` +
    `The task stays completed and its code commits are intact. Still uncommitted:\n` +
    `${renderPaths(paths)}\n` +
    `Land the record once the cause is fixed:\n` +
    `  git add -- ${pathspec}\n` +
    `  git commit -m "chore(prd): commit PRD tree changes (task ${taskId} completed)" -- ${pathspec}`
  );
}

/**
 * The subset of `paths` no longer on disk, checked at print time so the
 * suggested commands match what git will accept: `git add` on a missing
 * untracked path is an error, and a deleted tracked one is recovered with
 * `git rm --cached` instead.
 */
export function deletedAmong(projectDir: string, paths: string[]): Set<string> {
  return new Set(paths.filter((p) => !existsSync(join(projectDir, p))));
}

/** Quote a pathspec entry the shell would otherwise split. */
function shellPath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * Path-scoped recovery commands for a set of dirty paths.
 *
 * Every command carries `--` and the exact listed paths — all of them, even
 * when the displayed list above truncates — because an unscoped
 * `git add`/`git commit`/`git stash` is how an unrelated in-flight change
 * gets swept into a hench commit (WM2048), and a partial pathspec would land
 * only part of the refused work. Deleted paths get `git rm --cached`.
 */
function renderRecoveryCommands(paths: string[], deleted: ReadonlySet<string>): string {
  const spec = (list: string[]): string => list.map(shellPath).join(" ");
  const existing = paths.filter((p) => !deleted.has(p));
  const gone = paths.filter((p) => deleted.has(p));

  const lines: string[] = ["To keep the work, commit exactly these paths:"];
  if (existing.length > 0) lines.push(`  git add -- ${spec(existing)}`);
  if (gone.length > 0) lines.push(`  git rm --cached -- ${spec(gone)}`);
  lines.push(`  git commit -- ${spec(paths)}`);
  lines.push("Or set them aside:");
  lines.push(`  git stash push -- ${spec(paths)}`);
  return lines.join("\n");
}

/**
 * The message recorded on `run.error` and printed when a completion is
 * refused. Names every path, because the whole failure mode was work
 * disappearing without anyone being told which work — and suggests only
 * commands scoped to those paths ({@link renderRecoveryCommands}).
 */
export function formatUncommittedWorkRefusal(paths: string[], deleted: ReadonlySet<string> = new Set()): string {
  return (
    `⚠ Refusing to mark this task completed: ${paths.length} path(s) of its work are still uncommitted.\n` +
    `${renderPaths(paths)}\n` +
    `Nothing was discarded. Land the work, then re-run the task.\n` +
    renderRecoveryCommands(paths, deleted)
  );
}

/**
 * The message printed when a loop refuses to start the next task because the
 * previous one's output is still in the tree.
 *
 * Starting anyway is what turned one leaked task into a tangle of three: the
 * next task's diff, review and commit all include files it never wrote.
 */
export function formatLoopRefusal(paths: string[], deleted: ReadonlySet<string> = new Set()): string {
  return (
    `⚠ Stopping the loop: ${paths.length} path(s) from the previous task are still uncommitted.\n` +
    `${renderPaths(paths)}\n` +
    `Starting another task would fold them into its commit.\n` +
    `${renderRecoveryCommands(paths, deleted)}\n` +
    `Then re-run.`
  );
}

/**
 * The message printed when `--reset-deferred` resets tasks but declines to
 * commit the reset, because the PRD tree was already carrying uncommitted
 * changes that the commit could not have excluded.
 *
 * It names them because the consequence — the pre-run gate refusing the run a
 * moment later — otherwise looks like `--reset-deferred` not working.
 */
export function formatResetDeferredCommitSkipped(paths: string[], deleted: ReadonlySet<string> = new Set()): string {
  return (
    `⚠ Reset applied but not committed: ${paths.length} PRD path(s) were already uncommitted before it.\n` +
    `${renderPaths(paths)}\n` +
    `Committing would fold that work into hench's own "reset deferred/failing task(s)" commit. ` +
    `The pre-run gate will refuse the run until it is dealt with.\n` +
    renderRecoveryCommands(paths, deleted)
  );
}

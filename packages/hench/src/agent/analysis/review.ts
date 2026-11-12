import { createInterface } from "node:readline";
import { execStdout } from "../../process/exec.js";
import { matchesProjectPath } from "../../store/artifacts.js";
import { section, subsection, info } from "../../types/output.js";

/**
 * Review mode — shows proposed changes and prompts for approval
 * before committing task completion.
 *
 * The review gate sits between completion validation (changes exist,
 * tests pass) and status updates (marking the task complete). When
 * `--review` is active, the user sees a full diff and can approve
 * or reject the agent's work.
 */

export interface ReviewResult {
  approved: boolean;
  /** Reason for rejection, if rejected. */
  reason?: string;
}

export interface ReviewDiff {
  /** Full diff output (git diff HEAD). */
  diff: string;
  /** Summary stat line (git diff --stat HEAD). */
  stat: string;
}

const DEFAULT_TIMEOUT = 30_000;

/**
 * Collect the current diff for review.
 */
export async function collectReviewDiff(
  projectDir: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<ReviewDiff> {
  const [diff, stat] = await Promise.all([
    execStdout("git", ["diff", "HEAD"], { cwd: projectDir, timeout }),
    execStdout("git", ["diff", "--stat", "HEAD"], { cwd: projectDir, timeout }),
  ]);

  return {
    diff: diff.trim(),
    stat: stat.trim(),
  };
}

/** What a pair reviewer is shown of the change. See {@link collectPairReviewScope}. */
export interface PairReviewScope {
  /** `git diff <base>`: committed and uncommitted changes to tracked files. */
  diff: string;
  /** Changed paths, tracked and untracked, sorted. */
  changedFiles: string[];
}

/**
 * Collect the change a pair reviewer must see: the diff against `base` (the
 * commit the run started at, or `HEAD` when it could not be captured) and the
 * list of changed files, untracked ones included.
 *
 * Paths in `bookkeepingPaths` — hench's own state and rex's records, see
 * `BOOKKEEPING_PATHS` in `store/paths.ts` — are left out: the task's status
 * flip and the review report live there, and neither is the change under
 * review. Matched through {@link matchesProjectPath}: an entry with a trailing
 * slash covers everything beneath it, the rest are exact files.
 */
export async function collectPairReviewScope(
  projectDir: string,
  base: string | undefined,
  bookkeepingPaths: readonly string[],
  timeout = DEFAULT_TIMEOUT,
): Promise<PairReviewScope> {
  const ref = base ?? "HEAD";
  const exclude = bookkeepingPaths.map((path) => `:(exclude)${path.replace(/\/$/, "")}`);
  const pathspec = ["--", ".", ...exclude];
  const [diff, names, untracked] = await Promise.all([
    execStdout("git", ["diff", ref, ...pathspec], { cwd: projectDir, timeout }),
    execStdout("git", ["diff", "--name-only", ref, ...pathspec], { cwd: projectDir, timeout }),
    listUntrackedPaths(projectDir, timeout),
  ]);
  const isBookkeeping = (path: string): boolean => matchesProjectPath(path, bookkeepingPaths);
  const changedFiles = [
    ...new Set([...names.split("\n").map((l) => l.trim()).filter(Boolean), ...untracked.filter((p) => !isBookkeeping(p))]),
  ].sort();
  return { diff, changedFiles };
}

/**
 * Display the review UI and prompt for approval.
 *
 * Shows:
 * 1. Diff stat summary
 * 2. Full diff
 * 3. Approve/reject prompt
 *
 * The `promptFn` parameter allows injection for testing.
 */
export async function promptReview(
  reviewDiff: ReviewDiff,
  promptFn?: (question: string) => Promise<string>,
): Promise<ReviewResult> {
  section("Review");

  subsection("Changes");
  info(reviewDiff.stat);

  subsection("Diff");
  info(reviewDiff.diff);

  info("");

  const askUser = promptFn ?? defaultPrompt;
  const answer = await askUser("Approve these changes? [Y/n] ");

  const normalized = answer.trim().toLowerCase();

  // Empty string or "y"/"yes" → approve; anything else → reject
  if (normalized === "" || normalized === "y" || normalized === "yes") {
    return { approved: true };
  }

  return {
    approved: false,
    reason: "Changes rejected by reviewer",
  };
}

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Options controlling how {@link revertChanges} treats untracked files. */
export interface RevertOptions {
  /**
   * Repository-relative untracked file paths captured by listUntrackedPaths
   * BEFORE the run started. Only untracked paths absent from this list are
   * treated as agent-created and removed.
   *
   * When omitted (`undefined`), NO untracked files are removed — the safe
   * fallback used when a baseline could not be captured. This is the #303
   * data-loss guard: without a baseline we cannot distinguish the agent's
   * scratch files from the user's own uncommitted work, so we delete nothing.
   */
  baselineUntracked?: string[];
  /**
   * Path prefixes the revert is confined to. When set, tracked changes are
   * reverted only under these paths and only agent-created untracked files
   * under them are removed; everything outside is left exactly as it is.
   *
   * Failure rollback uses exact paths below instead: a directory prefix can
   * contain protected renames as well as ordinary PRD changes.
   *
   * Omitting both scope and paths means the whole working tree, which a review repair
   * wants: there the changes under review *are* the agent's.
   */
  scope?: readonly string[];
  /**
   * Repository-relative paths offered by the rollback prompt, passed literally.
   * The caller excludes overlaps with protected paths: even literal Git
   * pathspecs recurse into directories. When supplied, these take precedence
   * over scope; an empty list authorizes no changes.
   */
  paths?: readonly string[];
  /** Timeout for each git invocation (ms). */
  timeout?: number;
}

/** Outcome of a {@link revertChanges} call. */
export interface RevertResult {
  /** Untracked paths removed because the agent created them during the run. */
  removedUntracked: string[];
  /** Untracked paths preserved (pre-existing, or baseline unknown). */
  keptUntracked: string[];
}

/**
 * List individual untracked files, relative to the repository root.
 * Returns `[]` when the tree is clean or git is unavailable.
 *
 * Exported so the run lifecycle can capture a pre-run baseline with the exact
 * same parsing used during rollback, keeping the two sets directly comparable.
 */
export async function listUntrackedPaths(
  projectDir: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<string[]> {
  // NUL records preserve quotes, arrows and whitespace. Enumerate individual
  // files so a baseline directory cannot hide files created later within it.
  const output = await execStdout("git", ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"], {
    cwd: projectDir,
    timeout,
  });
  return output.split("\0").filter(Boolean);
}

/**
 * The subset of `scope` that git has at least one tracked file under.
 *
 * See the call site: an unmatched entry makes `git checkout` fail as a whole,
 * so the filter is what keeps a scoped revert working in a project that does
 * not have every scoped path committed.
 */
async function trackedPathspec(
  projectDir: string,
  scope: string[],
  timeout: number,
): Promise<string[]> {
  const kept: string[] = [];
  for (const entry of scope) {
    const listed = await execStdout("git", ["ls-files", "--", entry], {
      cwd: projectDir,
      timeout,
    });
    if (listed.trim().length > 0) kept.push(entry);
  }
  return kept;
}

/**
 * Revert the agent's uncommitted work — safely.
 *
 * Tracked changes are restored to HEAD with `git reset` + `git checkout`,
 * discarding staged and unstaged changes only
 * within the authorized scope.
 *
 * Untracked files are the dangerous case: the previous implementation ran a
 * blanket `git clean -fd`, which deleted every untracked file in the tree —
 * including the user's pre-existing scratch, `.env`, and hidden files (issue
 * #303). Instead we remove ONLY the untracked files the agent created during
 * the run, computed by diffing the current untracked set against
 * `options.baselineUntracked`. With no baseline we remove nothing.
 *
 * Invocation is also prompt-gated: the run lifecycle only calls this after an
 * express per-run confirmation on an interactive TTY (never unattended) — see
 * `performRollbackIfNeeded` in `lifecycle/shared.ts`.
 */
export async function revertChanges(
  projectDir: string,
  options: RevertOptions = {},
): Promise<RevertResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const scope = options.scope && options.scope.length > 0 ? [...options.scope] : undefined;
  const paths = options.paths === undefined ? undefined : new Set(options.paths);
  const literal = (path: string): string => `:(top,literal)${path}`;
  const inScope = (path: string): boolean => {
    if (paths !== undefined) return paths.has(path);
    return scope === undefined || scope.some((entry) => {
      const prefix = entry.endsWith("/") ? entry : `${entry}/`;
      return path === entry || path === entry.replace(/\/$/, "") || path.startsWith(prefix);
    });
  };

  // Exact paths come from the same classification as the prompt. Broad PRD
  // prefixes would also unstage protected source-to-PRD renames, turning the
  // target (including post-move edits) into an untracked file that clean deletes.
  const pathspec = paths !== undefined
    ? [...paths].map(literal)
    : scope ? await trackedPathspec(projectDir, scope, timeout) : ["."];
  if (pathspec.length > 0) {
    await execStdout("git", ["reset", "HEAD", "--", ...pathspec], { cwd: projectDir, timeout });
    // Reset restores deleted sources to the index and removes added targets.
    // Filter AFTER reset: one now-untracked target would make checkout reject
    // the whole request, leaving ordinary PRD modifications unrestored too.
    const checkoutPaths = paths !== undefined
      ? await trackedPathspec(projectDir, pathspec, timeout)
      : pathspec;
    if (checkoutPaths.length > 0) {
      await execStdout("git", ["checkout", "--", ...checkoutPaths], { cwd: projectDir, timeout });
    }
  }

  // 2. Untracked files: remove ONLY the ones the agent created this run, and
  //    only inside the scope. An agent-created file outside it is still the
  //    agent's work — out of scope means out of reach, in both directions.
  const current = await listUntrackedPaths(projectDir, timeout);

  if (options.baselineUntracked === undefined) {
    // No baseline → cannot tell agent files from the user's own; delete none.
    return { removedUntracked: [], keptUntracked: current };
  }

  const baseline = new Set(options.baselineUntracked);
  const agentCreated = current.filter((p) => !baseline.has(p) && inScope(p));
  const preExisting = current.filter((p) => baseline.has(p) || !inScope(p));

  if (agentCreated.length > 0) {
    // Scoped clean: the pathspec after `--` limits removal to exactly the
    // agent-created paths. Pre-existing untracked files are never matched.
    await execStdout("git", ["clean", "-fd", "--", ...agentCreated.map(literal)], {
      cwd: projectDir,
      timeout,
    });
  }

  return { removedUntracked: agentCreated, keptUntracked: preExisting };
}

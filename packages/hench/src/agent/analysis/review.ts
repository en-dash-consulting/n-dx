import { createInterface } from "node:readline";
import { execStdout } from "../../process/exec.js";
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
   * Untracked paths (as reported by `git status --porcelain`) that existed
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
   * The rollback caller passes the PRD paths, because those are the only
   * files hench writes — an unscoped revert also discarded the agent's
   * finished source edits, which it was never entitled to touch.
   *
   * Omitted means the whole working tree, which is what a review repair
   * wants: there the changes under review *are* the agent's.
   */
  scope?: readonly string[];
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
 * List untracked paths as reported by `git status --porcelain` (the `??`
 * entries). Returns `[]` when the tree is clean or git is unavailable.
 *
 * Exported so the run lifecycle can capture a pre-run baseline with the exact
 * same parsing used during rollback, keeping the two sets directly comparable.
 */
export async function listUntrackedPaths(
  projectDir: string,
  timeout = DEFAULT_TIMEOUT,
): Promise<string[]> {
  const output = await execStdout("git", ["status", "--porcelain"], {
    cwd: projectDir,
    timeout,
  });
  return output
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => {
      // `git status --porcelain` wraps paths containing spaces or special
      // characters in double quotes (e.g. `?? "my file.ts"`). Strip them so
      // the same path matches between the baseline and the current set, and so
      // the pathspec passed to `git clean -fd --` refers to the real file.
      let path = line.slice(3).trim();
      if (path.length >= 2 && path.startsWith('"') && path.endsWith('"')) {
        path = path.slice(1, -1);
      }
      return path;
    })
    .filter(Boolean);
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
 * Tracked changes are reverted with `git reset` + `git checkout`; because those
 * files are known to git, their prior content is always recoverable from
 * history, so this can never destroy unrecoverable data.
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
  const inScope = (path: string): boolean =>
    scope === undefined ||
    scope.some((entry) => {
      const prefix = entry.endsWith("/") ? entry : `${entry}/`;
      return path === entry || path === entry.replace(/\/$/, "") || path.startsWith(prefix);
    });

  // 1. Unstage and revert modifications to TRACKED files only, within scope.
  //    reset/checkout never touch untracked files, and tracked content is
  //    recoverable from git history — so there is no unrecoverable data loss.
  //
  //    The pathspec is filtered to entries git actually tracks first. `git
  //    checkout -- a b` where `b` matches nothing known to git fails the whole
  //    command and reverts neither — so one scope entry for a file this
  //    project has never committed (`.rex/tree-meta.json` in a fresh fixture,
  //    say) would silently turn the entire revert into a no-op.
  const pathspec = scope ? await trackedPathspec(projectDir, scope, timeout) : ["."];
  if (pathspec.length > 0) {
    await execStdout("git", ["reset", "HEAD", "--", ...pathspec], { cwd: projectDir, timeout });
    await execStdout("git", ["checkout", "--", ...pathspec], { cwd: projectDir, timeout });
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
    await execStdout("git", ["clean", "-fd", "--", ...agentCreated], {
      cwd: projectDir,
      timeout,
    });
  }

  return { removedUntracked: agentCreated, keptUntracked: preExisting };
}

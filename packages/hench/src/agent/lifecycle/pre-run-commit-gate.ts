/**
 * Pre-run commit gate — the one-time check `hench run` makes before its work
 * loop starts when the working tree already carries uncommitted changes:
 * commit, stash, discard, stop or proceed. A tree whose only dirt is n-dx's
 * own planning files gets those committed on their own instead.
 *
 * The questions it asks are built on `shared.ts`'s SIGINT-suspended readline
 * prompt, and its commits carry the same co-authorship trailer as every other
 * hench commit.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CHECKPOINT_THRESHOLD, DEFAULT_GIT_COMMIT_MESSAGE_SOURCE } from "../../schema/index.js";
import type { GitCommitMessageSource } from "../../schema/index.js";
import { measureChangeMagnitude } from "../analysis/change-magnitude.js";
import type { ChangeMagnitude } from "../analysis/change-magnitude.js";
import { collectReviewDiff, type ReviewDiff } from "../analysis/review.js";
import { execStdout } from "../../process/exec.js";
import { execCheckedGit, execGitMutation } from "../../process/git-mutation.js";
import { checkRunGitOrigin, type RunGitOrigin } from "../../process/git-origin.js";
import { defaultRegistry, resolveVendorModel, resolveTaskModel } from "../../prd/llm-gateway.js";
import {
  excludeHenchRuntimeArtifacts,
  formatPorcelainPath,
  splitPlanningPaths,
  type PlanningSplit,
} from "../../store/artifacts.js";
import { loadLLMConfig, resolveLLMVendor } from "../../store/project-config.js";
import { section, subsection, detail, info } from "../../types/output.js";
import { extractCommitSubject } from "./commit-subject.js";
import { buildPreRunCommitSubject } from "./pre-run-commit-subject.js";
import { listDirtyPaths } from "./uncommitted-work-gate.js";
import {
  askYesNoWithSuspendedSigint,
  buildCoAuthoredByTrailerLine,
  readLineWithSuspendedSigint,
} from "./shared.js";

/** Cap the diff sent to the LLM so message generation stays cheap and fast. */
const PRE_RUN_COMMIT_DIFF_CHAR_LIMIT = 12_000;
/** Deterministic message used when the LLM is unavailable or errors. */
const PRE_RUN_COMMIT_FALLBACK_MESSAGE = "chore: commit local changes before hench run";

export type PreRunCommitChoice = "commit" | "stash" | "discard" | "stop" | "proceed";
export type PreRunCommitGateResult = "proceed" | "stop";

/** Stash label prefix, so `git stash list` says where the entry came from. */
const PRE_RUN_STASH_PREFIX = "hench pre-run";

/**
 * How the pre-run prompt should present its choices.
 *
 * - `escalate` — changes are at/above the checkpoint threshold: bare Enter
 *   commits instead of proceeding.
 * - `allowProceed` — false when `hench.git.requireCleanTree` is set (without
 *   `--allow-dirty`): the "proceed" option is dropped entirely.
 */
export interface PreRunPromptOptions {
  escalate: boolean;
  allowProceed: boolean;
}

/**
 * Map a raw prompt answer to a {@link PreRunCommitChoice}. Bare Enter takes
 * the default: "proceed" normally, "commit" when escalated or when proceeding
 * is disallowed. A "proceed" answer while disallowed re-resolves to the
 * default rather than sneaking past requireCleanTree. Exported for tests.
 *
 * `s` stays bound to "stop" — it has meant that since the gate shipped, and
 * silently repointing a one-key answer at `stash` would make muscle memory
 * start a run the operator meant to abort. Stash takes `t`, discard `d`.
 */
export function resolvePreRunCommitAnswer(
  answer: string | null,
  { escalate, allowProceed }: PreRunPromptOptions,
): PreRunCommitChoice {
  if (answer === null) return "stop"; // Ctrl-C — don't start the run.
  const fallback: PreRunCommitChoice = escalate || !allowProceed ? "commit" : "proceed";
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "c" || trimmed === "commit") return "commit";
  if (trimmed === "t" || trimmed === "stash") return "stash";
  if (trimmed === "d" || trimmed === "discard") return "discard";
  if (trimmed === "s" || trimmed === "stop") return "stop";
  if ((trimmed === "p" || trimmed === "proceed") && allowProceed) return "proceed";
  return fallback;
}

/**
 * Prompt for the pre-run commit gate. Bare Enter takes the least dangerous
 * default (proceed normally, commit when escalated); Ctrl-C stops (treat an
 * interrupt as "don't start the run"). Built on the same SIGINT-suspended
 * readline core as the yes/no prompt.
 *
 * `discard` is never a default and never reachable by a bare Enter — the
 * caller confirms it separately before anything is removed.
 */
async function promptPreRunCommitChoice(opts: PreRunPromptOptions): Promise<PreRunCommitChoice> {
  const def = opts.escalate || !opts.allowProceed ? "commit" : "proceed";
  const choices = opts.allowProceed
    ? "[c]ommit / s[t]ash / [d]iscard / [s]top / [p]roceed"
    : "[c]ommit / s[t]ash / [d]iscard / [s]top";
  const answer = await readLineWithSuspendedSigint(
    `\nWhat should happen to these changes? ${choices} (default: ${def}) `,
  );
  return resolvePreRunCommitAnswer(answer, opts);
}

/** What the deterministic subject builder needs from the gate. */
export interface PreRunSubjectContext {
  /** Project-relative paths of every dirty file, runtime artifacts already discounted. */
  paths: readonly string[];
  /** Lines changed against HEAD, from the same measurement the gate reports. */
  counts?: { linesChanged: number };
  /** The `hench.git.commitMessage` setting, when the caller passed one. */
  source?: GitCommitMessageSource | undefined;
}

/**
 * Which subject source to use. Absent config means the default, which is
 * deterministic — the switch exists to restore the model call, not to
 * enable it.
 */
function resolveCommitMessageSource(
  source: GitCommitMessageSource | undefined,
): GitCommitMessageSource {
  return source ?? DEFAULT_GIT_COMMIT_MESSAGE_SOURCE;
}

/**
 * Confirm a discard. Defaults to No: of the five answers this is the only one
 * that destroys work, so it is the only one that costs a second keystroke.
 */
async function confirmPreRunDiscard(fileCount: number): Promise<boolean> {
  return askYesNoWithSuspendedSigint(
    `\nDiscard ${fileCount} uncommitted file(s)? Tracked changes are reverted and ` +
      `untracked files are deleted. [y/N] `,
    { interruptMode: "hold-then-exit", defaultYes: false },
  );
}

/**
 * Best-effort LLM commit subject for pre-existing changes. Falls back to a
 * deterministic message when no provider/credentials are available or the
 * call fails — the gate must never block or error on message generation.
 *
 * Commit-message generation is a mechanical single-shot call, so it runs on
 * the vendor's light tier (e.g. haiku) rather than the run's standard model.
 * The caller passes the run's resolved model; when that matches the
 * config-derived standard resolution (i.e. no explicit --model override was
 * given), the light tier is used instead. A model that differs from the
 * standard resolution is an explicit operator override and is honored as-is.
 *
 * Exported for testing.
 */
export async function proposePreRunCommitMessage(
  diff: ReviewDiff,
  henchDir: string,
  model?: string,
  context?: PreRunSubjectContext,
): Promise<string> {
  // Default path: compute the subject from the file list. No provider, no
  // credentials, no round trip before the prompt can be shown. See
  // `pre-run-commit-subject.ts` for why a model adds nothing here that is
  // worth those costs.
  if (resolveCommitMessageSource(context?.source) === "deterministic") {
    const paths = context?.paths ?? [];
    if (paths.length > 0) {
      return buildPreRunCommitSubject(paths, context?.counts);
    }
    // No path list to describe — only happens through an injected test seam
    // or a caller predating `context`. The generic message is still better
    // than an empty subject.
    return PRE_RUN_COMMIT_FALLBACK_MESSAGE;
  }

  try {
    const llmConfig = await loadLLMConfig(henchDir);
    const provider = defaultRegistry.getActiveProvider(llmConfig);
    const vendor = resolveLLMVendor(llmConfig);
    const standardModel = resolveVendorModel(vendor, llmConfig);
    const isExplicitOverride = Boolean(model) && model !== standardModel;
    const commitResolution = resolveTaskModel("git.commit-message", llmConfig, { vendor });
    const resolvedModel = isExplicitOverride ? (model as string) : commitResolution.model;
    if (!isExplicitOverride) {
      // Tier visibility — mirrors the vendor header's "(light tier)" label.
      detail(`Commit message model: ${resolvedModel} (${commitResolution.tier} tier)`);
    }
    const prompt =
      "Write a single-line git commit subject (max 72 chars, conventional-commit " +
      "style, no body, no surrounding quotes or backticks) summarizing these " +
      `uncommitted changes:\n\n${diff.stat}\n\n${diff.diff.slice(0, PRE_RUN_COMMIT_DIFF_CHAR_LIMIT)}`;
    const { text } = await provider.complete({
      prompt,
      model: resolvedModel,
      effort: commitResolution.effort,
      taskClass: "git.commit-message",
    });
    // Output contract for the light-tier route: the answer goes straight to
    // `git commit -m`, so a preamble, fence, or paragraph would land in the
    // repository's history. Anything that is not a usable single-line subject
    // yields the generic fallback instead.
    return extractCommitSubject(text) ?? PRE_RUN_COMMIT_FALLBACK_MESSAGE;
  } catch {
    return PRE_RUN_COMMIT_FALLBACK_MESSAGE;
  }
}

/**
 * Stage everything and commit with the standard N-DX audit trailers. Reuses
 * {@link buildCoAuthoredByTrailerLine} so the co-authorship trailer stays in
 * one place; the `N-DX:` line marks this as a pre-run gate commit (no run/task
 * context exists yet, so the run-scoped trailers do not apply).
 */
async function commitPreRunChanges(projectDir: string, message: string): Promise<void> {
  await execGitMutation(projectDir, ["add", "-A"], 30_000);
  const trailers = `N-DX: pre-run commit gate\n${buildCoAuthoredByTrailerLine()}`;
  await execGitMutation(projectDir, ["commit", "-m", message, "-m", trailers], 30_000);
}

/** Subject of the commit that lands n-dx's own planning files before a run. */
export const PLANNING_COMMIT_SUBJECT = "chore(prd): commit planning changes before run";

/**
 * Commit exactly `paths` — n-dx's planning files — and nothing else.
 *
 * The paths are repository-relative (porcelain), so each is spelled as a
 * `:(top,literal)` pathspec: right from a project in a subdirectory, and no
 * glob in a slug can widen it. The same pathspecs go to `git commit`, which
 * then records only those paths even if something else was already staged.
 * A path-limited commit takes each path's worktree state, deletions included,
 * but only for paths git already knows; `add` is there for untracked files.
 * Paths missing from the worktree are kept out of `add`: one removed with
 * `git rm` (or a rename's source) is in neither the worktree nor the index,
 * so `add` refuses it, while `commit` still finds it in HEAD.
 *
 * @param itemId The task about to run, for the `N-DX-Item` trailer; omitted
 *   when selection has not picked one yet.
 */
async function commitPlanningChanges(projectDir: string, paths: string[], itemId?: string): Promise<void> {
  // No paths would mean a bare `git commit`, which takes the whole index.
  if (paths.length === 0) throw new Error("no planning files to commit");
  const spec = (path: string) => `:(top,literal)${path}`;
  const pathspecs = paths.map(spec);
  const top = (await execStdout("git", ["rev-parse", "--show-toplevel"], { cwd: projectDir, timeout: 15_000 })).trim();
  const present = paths.filter((path) => existsSync(join(top || projectDir, path)));
  if (present.length > 0) await execGitMutation(projectDir, ["add", "--", ...present.map(spec)], 30_000);
  const trailers = [
    "N-DX: pre-run commit gate",
    ...(itemId ? [`N-DX-Item: ${itemId}`] : []),
    buildCoAuthoredByTrailerLine(),
  ].join("\n");
  await execGitMutation(
    projectDir,
    ["commit", "-m", PLANNING_COMMIT_SUBJECT, "-m", trailers, "--", ...pathspecs],
    30_000,
  );
}

/**
 * Set the pre-existing changes aside under the same generated message the
 * commit option would have used, prefixed so `git stash list` says where the
 * entry came from.
 *
 * `--include-untracked` matters: the gate counts untracked files as dirty, so
 * a stash that left them behind would hand the run a tree the gate had just
 * reported as handled. Ignored files stay put (no `--all`) — `.hench/`,
 * `node_modules/` and the rest are not the operator's work.
 */
async function stashPreRunChanges(projectDir: string, message: string): Promise<void> {
  await execGitMutation(
    projectDir,
    ["stash", "push", "--include-untracked", "-m", `${PRE_RUN_STASH_PREFIX}: ${message}`],
    60_000,
  );
}

/**
 * Discard the pre-existing changes: revert tracked files to HEAD and remove
 * untracked ones.
 *
 * Done as a stash that is immediately dropped, rather than
 * `git reset --hard` + `git clean -fd`. Both remove the same files, but the
 * stash leaves a commit behind: dropping it only unlinks the ref, so the
 * operator who answers `d` and then remembers what was in there has a sha to
 * recover from (`git stash store <sha>` then `git stash pop`) until git gc
 * reaps it. `git stash create` was the obvious way to snapshot first and is
 * the wrong one — it has no `--include-untracked`, so the half of the discard
 * that deletes new files would not have been in the snapshot at all.
 *
 * Ignored files are never touched (no `--all`, and no `git clean -x` anywhere
 * in this path): `.hench/`, build output and tool state are not the changes
 * this gate is about.
 *
 * Returns the dropped stash's sha, or undefined when git made no stash (an
 * already-clean tree) — in which case nothing is dropped either. The drop is
 * conditional on the subject matching the marker written moments earlier, so
 * a pre-existing `stash@{0}` belonging to the operator can never be the entry
 * this removes.
 */
async function discardPreRunChanges(projectDir: string): Promise<string | undefined> {
  const marker = `${PRE_RUN_STASH_PREFIX} discard ${Date.now()}`;
  await execGitMutation(
    projectDir,
    ["stash", "push", "--include-untracked", "-m", marker],
    60_000,
  );

  let snapshot: string | undefined;
  try {
    const top = await execCheckedGit(
      projectDir,
      ["log", "-1", "--format=%H%x00%s", "refs/stash"],
      15_000,
    );
    const [sha, subject = ""] = top.stdout.trim().split("\0");
    if (sha && subject.includes(marker)) snapshot = sha;
  } catch {
    // No stash ref at all — nothing was stashed, so nothing to drop.
  }
  if (!snapshot) return undefined;

  try {
    await execGitMutation(projectDir, ["stash", "drop"], 15_000);
  } catch {
    // The entry stays in the stash list. The changes are still out of the
    // working tree, which is what was asked for; the operator sees it in
    // `git stash list` rather than losing it.
  }
  return snapshot;
}

export interface PreRunCommitGateOptions {
  projectDir: string;
  henchDir: string;
  model?: string;
  yes?: boolean;
  autonomous?: boolean;
  /**
   * Opt in to starting an autonomous run against a dirty working tree.
   * Set by `--allow-dirty`. Without it, autonomous runs (--auto/--loop/
   * --epic-by-epic) abort when the tree carries uncommitted changes instead
   * of silently folding them into hench's own commits.
   */
  allowDirty?: boolean;
  dryRun?: boolean;
  /**
   * Lines-changed threshold at/above which an interactive gate escalates
   * (from `hench.git.checkpointThreshold`). 0 disables escalation.
   * Defaults to {@link DEFAULT_CHECKPOINT_THRESHOLD}.
   */
  checkpointThreshold?: number;
  /**
   * Refuse to start against a dirty tree (from `hench.git.requireCleanTree`):
   * interactive prompts drop "proceed", non-interactive runs stop.
   * `--allow-dirty` (allowDirty) takes precedence.
   */
  requireCleanTree?: boolean;
  /**
   * Where the proposed commit subject comes from, from
   * `hench.git.commitMessage`. Omitted means the default, which is
   * {@link DEFAULT_GIT_COMMIT_MESSAGE_SOURCE} — computed from the dirty
   * file list rather than asked of a model.
   */
  commitMessageSource?: GitCommitMessageSource;
  /**
   * Checkout the invocation started in, captured by the caller immediately
   * before this gate runs. The gate refuses to commit when the working tree
   * has moved to another branch or worktree since. Omitted (or empty, outside
   * a git repository) means there is nothing to enforce.
   */
  origin?: RunGitOrigin;
  /**
   * The task about to run, named in the `N-DX-Item` trailer of the planning
   * commit. Known when `--task` was given (every dashboard and Sidecar start);
   * left out otherwise, because selection has not run yet.
   */
  itemId?: string;
  /** Test seams — default to the real implementations. */
  deps?: {
    listDirty?: (dir: string) => Promise<string[]>;
    measureMagnitude?: (dir: string) => Promise<ChangeMagnitude>;
    collectDiff?: (dir: string) => Promise<ReviewDiff>;
    proposeMessage?: (diff: ReviewDiff, henchDir: string, model?: string, context?: PreRunSubjectContext) => Promise<string>;
    promptChoice?: (promptOpts: PreRunPromptOptions) => Promise<PreRunCommitChoice>;
    confirmDiscard?: (fileCount: number) => Promise<boolean>;
    commit?: (dir: string, message: string) => Promise<void>;
    commitPlanning?: (dir: string, paths: string[], itemId?: string) => Promise<void>;
    splitPlanning?: (lines: string[], dir: string) => Promise<PlanningSplit>;
    stash?: (dir: string, message: string) => Promise<void>;
    discard?: (dir: string) => Promise<string | undefined>;
    checkOrigin?: (dir: string, origin: RunGitOrigin | undefined) => string | undefined;
    isTTY?: boolean;
  };
}

/**
 * One-time pre-run git gate. Runs once per `hench run` invocation, before the
 * work loop begins (never per iteration). When the working tree carries
 * pre-existing uncommitted changes and the session is interactive, it shows
 * the diff stat plus a proposed message and asks what to do with them:
 *
 * - `commit` — stage everything and commit under the generated message.
 * - `stash`  — `git stash push -u` under the same generated message.
 * - `discard` — revert tracked files and delete untracked ones, after a
 *   second confirmation defaulting to No. A `git stash create` snapshot is
 *   taken first, and its sha reported, so the answer is still recoverable.
 * - `stop` / `proceed` — as before.
 *
 * Clean trees always proceed without prompting. A tree whose only dirt is
 * n-dx's planning files (`PLANNING_PATHS`, store/paths.ts) gets those committed on
 * their own and proceeds, unless --allow-dirty; otherwise everything below
 * sees only the other files.
 *
 * Autonomous runs (--auto/--loop/--epic-by-epic) must not silently fold
 * pre-existing changes into hench's own commits. On a TTY they get the same
 * prompt — it runs once, before the loop, so it cannot stall an iteration —
 * with the escalated default (commit) and an explicit `proceed` standing in
 * for `--allow-dirty`. Without a TTY they abort as before. Other
 * non-interactive runs (--yes, piped) proceed unless
 * `hench.git.requireCleanTree` is set (then they stop too, again unless
 * --allow-dirty).
 *
 * The gate is size-aware: when the uncommitted changes reach the checkpoint
 * threshold (`hench.git.checkpointThreshold` lines changed, default
 * {@link DEFAULT_CHECKPOINT_THRESHOLD}), the interactive prompt escalates —
 * it warns about the magnitude and defaults to committing instead of
 * proceeding. Below the threshold, behavior is unchanged.
 *
 * Returns "stop" when the caller should abort before running, else "proceed".
 */
export async function performPreRunCommitGateIfNeeded(
  opts: PreRunCommitGateOptions,
): Promise<PreRunCommitGateResult> {
  const { projectDir, henchDir, model, yes, autonomous, allowDirty, dryRun } = opts;
  const deps = opts.deps ?? {};
  const listDirty = deps.listDirty ?? listDirtyPaths;
  const measureMagnitude = deps.measureMagnitude ?? measureChangeMagnitude;
  const collectDiff = deps.collectDiff ?? ((dir: string) => collectReviewDiff(dir));
  const proposeMessage = deps.proposeMessage ?? proposePreRunCommitMessage;
  const promptChoice = deps.promptChoice ?? promptPreRunCommitChoice;
  const confirmDiscard = deps.confirmDiscard ?? confirmPreRunDiscard;
  const commit = deps.commit ?? commitPreRunChanges;
  const stash = deps.stash ?? stashPreRunChanges;
  const discard = deps.discard ?? discardPreRunChanges;
  const checkOrigin = deps.checkOrigin ?? checkRunGitOrigin;
  const isTTY = deps.isTTY ?? Boolean(process.stdin.isTTY);
  const checkpointThreshold = opts.checkpointThreshold ?? DEFAULT_CHECKPOINT_THRESHOLD;
  // --allow-dirty takes precedence over config: it suppresses both
  // requireCleanTree and threshold escalation for this run.
  const requireCleanTree = Boolean(opts.requireCleanTree) && !allowDirty;

  // Dry runs never touch the working tree; skip the gate entirely.
  if (dryRun) return "proceed";

  const allDirty = await excludeHenchRuntimeArtifacts(await listDirty(projectDir), projectDir);
  if (allDirty.length === 0) return "proceed"; // Clean tree → start immediately, no prompt.

  // n-dx's own planning files (PRD roots, project config) are not someone
  // else's work: when they are all that is dirty, they get a commit of their
  // own and the run starts (decision UT1). Anything else dirty is handled
  // below as before, and the refusal names only those files. --allow-dirty
  // means "leave my tree alone", so it skips the planning commit too.
  let dirty = allDirty;
  if (!allowDirty) {
    const split = await (deps.splitPlanning ?? splitPlanningPaths)(allDirty, projectDir);
    if (split.other.length === 0) {
      // Only rex's machine-local files: nothing to commit, and an empty
      // pathspec list would make `git commit` take the whole index.
      if (split.planning.length === 0) return "proceed";
      return commitPlanningBeforeRun(projectDir, split.planning, opts, deps.commitPlanning ?? commitPlanningChanges, checkOrigin);
    }
    dirty = split.other;
  }

  const magnitude = await measureMagnitude(projectDir);
  const magnitudeLabel = `${dirty.length} uncommitted file(s), ${magnitude.linesChanged} line(s) changed`;
  const fileList = formatDirtyFileList(dirty);
  // An autonomous run that would otherwise have refused is itself an
  // escalation: the prompt must not let a bare Enter proceed into the loop
  // with someone else's changes in the tree, so the default becomes "commit"
  // exactly as it does above the checkpoint threshold.
  const autonomousDirty = Boolean(autonomous) && !allowDirty;
  const escalate =
    autonomousDirty ||
    (!allowDirty && checkpointThreshold > 0 && magnitude.linesChanged >= checkpointThreshold);

  // Only prompt in an attended TTY session. Autonomous runs are included, but
  // only where they would otherwise have been refused outright: this gate runs
  // once per invocation, before the work loop starts, so a prompt here cannot
  // stall an iteration mid-flight — and refusing to start was the worse
  // outcome when someone was sitting there able to answer. `--allow-dirty` is
  // the operator saying "just go", so it keeps the silent autonomous path;
  // --yes and non-TTY runs still can't prompt and keep the fail-fast below.
  const isInteractive = isTTY && !yes && (!autonomous || autonomousDirty);
  if (!isInteractive) {
    // Fail-forward deliberately does NOT act here. At this point the run has
    // not started, so it has touched nothing, and committing the tree would be
    // `git add -A` with extra steps — exactly what the comment below, and
    // stageRunWork's baseline rule, exist to prevent. Fail-forward commits
    // work a run *produced*; a tree someone else left dirty is what
    // --allow-dirty is for.
    // Autonomous runs must not fold a pre-existing dirty tree into hench's own
    // commits. They can't prompt (that would hang an unattended loop), so fail
    // fast instead — unless the operator explicitly opted in with --allow-dirty.
    if (autonomous && !allowDirty) {
      info(
        `⚠ Refusing to start an autonomous run with ${magnitudeLabel} in the working tree. ` +
          `Commit or stash them, or pass --allow-dirty to proceed anyway.\n${fileList}`,
      );
      return "stop";
    }
    // requireCleanTree extends the same fail-fast to all non-interactive runs
    // (--yes, piped): there is no one attending who can commit first.
    if (requireCleanTree) {
      info(
        `⚠ hench.git.requireCleanTree is set: refusing to start with ${magnitudeLabel} in the working tree. ` +
          `Commit or stash them, or pass --allow-dirty to proceed anyway.\n${fileList}`,
      );
      return "stop";
    }
    info(`Proceeding with ${magnitudeLabel} in the working tree.`);
    return "proceed";
  }

  const diff = await collectDiff(projectDir);
  const proposed = await proposeMessage(diff, henchDir, model, {
    paths: dirty,
    counts: { linesChanged: magnitude.linesChanged },
    source: opts.commitMessageSource,
  });

  section("Uncommitted changes detected");
  subsection("Changes");
  info(diff.stat || `${dirty.length} file(s)`);
  if (autonomousDirty) {
    info(
      `⚠ An autonomous run would fold ${magnitudeLabel} into its own commits. ` +
        `Deal with them first, or choose proceed to accept that (same as --allow-dirty).`,
    );
  } else if (escalate) {
    info(
      `⚠ Large uncommitted change: ${magnitudeLabel} (threshold: ${checkpointThreshold}). ` +
        `Committing a checkpoint before the run is strongly recommended.`,
    );
  }
  if (requireCleanTree) {
    info("hench.git.requireCleanTree is set: commit these changes or stop (pass --allow-dirty to override).");
  }
  subsection("Proposed commit message");
  info(proposed);

  const allowProceed = !requireCleanTree;
  const choice = await promptChoice({ escalate, allowProceed });
  if (choice === "stop") return "stop";
  if (choice === "proceed") return "proceed";

  // Leaving the changes where they are: honest when the operator was free to
  // proceed anyway, wrong when the run was only allowed to start because they
  // were going to be dealt with.
  const leaveInPlace = (): PreRunCommitGateResult =>
    allowProceed && !autonomousDirty ? "proceed" : "stop";

  if (choice === "discard" && !(await confirmDiscard(dirty.length))) {
    info("Discard cancelled — changes left in the working tree.");
    return leaveInPlace();
  }

  // Between capture and here the operator answered a prompt, which is long
  // enough for another process to move the checkout. The changes stay in the
  // tree and the caller must not start a run that could absorb them.
  const drift = checkOrigin(projectDir, opts.origin);
  if (drift) {
    info(
      `⚠ Refusing to ${choice} pre-existing changes: ${drift}. ` +
        `They remain in the working tree.`,
    );
    return leaveInPlace();
  }

  try {
    if (choice === "commit") {
      await commit(projectDir, proposed);
      info("Committed pre-existing changes. Starting run…");
    } else if (choice === "stash") {
      await stash(projectDir, proposed);
      info("Stashed pre-existing changes (git stash pop to restore). Starting run…");
    } else {
      const snapshot = await discard(projectDir);
      info(
        snapshot
          ? `Discarded pre-existing changes. Recoverable until git gc: git stash store ${snapshot}`
          : "Discarded pre-existing changes.",
      );
    }
  } catch (err) {
    info(
      `⚠ Pre-run ${choice} failed: ${(err as Error).message} — stopping before work starts.`,
    );
    return "stop";
  }
  return "proceed";
}

/** At most this many paths are listed under a refusal; the rest are counted. */
const DIRTY_FILE_LIST_LIMIT = 20;

/** Indented path list of porcelain lines, capped at {@link DIRTY_FILE_LIST_LIMIT}. */
function formatDirtyFileList(porcelainLines: string[]): string {
  const shown = porcelainLines.slice(0, DIRTY_FILE_LIST_LIMIT).map((line) => `  ${formatPorcelainPath(line)}`);
  const rest = porcelainLines.length - shown.length;
  return [...shown, ...(rest > 0 ? [`  … and ${rest} more`] : [])].join("\n");
}

/**
 * The pre-run gate's planning-only path: commit `paths` on their own and start.
 * Refuses instead when the checkout moved since the invocation began, or when
 * the commit fails — a run must not start on top of a half-made commit.
 */
async function commitPlanningBeforeRun(
  projectDir: string,
  paths: string[],
  opts: PreRunCommitGateOptions,
  commitPlanning: (dir: string, paths: string[], itemId?: string) => Promise<void>,
  checkOrigin: (dir: string, origin: RunGitOrigin | undefined) => string | undefined,
): Promise<PreRunCommitGateResult> {
  const drift = checkOrigin(projectDir, opts.origin);
  if (drift) {
    info(`⚠ Refusing to commit n-dx planning files: ${drift}. They remain in the working tree.`);
    return "stop";
  }
  try {
    await commitPlanning(projectDir, paths, opts.itemId);
  } catch (err) {
    info(`⚠ Could not commit n-dx planning files: ${(err as Error).message} — stopping before work starts.`);
    return "stop";
  }
  info(`Committed ${paths.length} n-dx planning file(s) before the run (${PLANNING_COMMIT_SUBJECT}).`);
  return "proceed";
}

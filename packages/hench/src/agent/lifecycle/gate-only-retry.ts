/**
 * Gate-only retry (#539 item 1).
 *
 * A run whose agent finished, committed and asked for completion can still
 * fail at the test gate; its completion is then held, not applied. Retrying it
 * used to start a whole agent session over committed work: the agent found
 * nothing to edit, the read-only refusal fired, hench re-spawned cold, the cold
 * session re-verified everything, and only then did the gate run again — the
 * retry of 5b8fc246 ran the full suite three times this way.
 *
 * When the task's previous run failed *only* at the gate, its commits are all
 * in HEAD and nothing else has changed, there is nothing for an agent to do.
 * This run re-records the held completion on its own claim, re-runs the gate
 * over the work, and lets `finalizeRun`'s ordinary hold path apply the
 * completion on green.
 *
 * Every case that does not fit falls through to the normal agent path. In
 * particular a gate-only retry is never followed by another one: if the gate
 * fails again, the failure is probably real and the agent must get a chance to
 * fix it.
 */

import type { RunCommitRecord, RunCompletionHold, RunRecord, RunReviewRecord } from "../../schema/index.js";
import type { TaskClaims } from "../../process/task-claims.js";
import { getCurrentBranch, getCurrentHead } from "../../process/exec.js";
import { isAncestorOfHead } from "../../process/git-ancestry.js";
import { detail, info, subsection } from "../../types/output.js";
import { findUncommittedWork, PRD_COMMIT_PATHS } from "./uncommitted-work-gate.js";
import { finalizeRun, recordClaimLoss, type FinalizeRunOptions, type MemoryContext } from "./shared.js";

/** A held completion with the timestamp the claims store requires. */
type HeldCompletion = RunCompletionHold & { outcome: "not-applied"; requestedAt: string };

/** Git state the eligibility decision reads. Gathered by {@link readGateOnlyGitFacts}. */
export interface GateOnlyGitFacts {
  /** The probed commits that are ancestors of (or equal to) HEAD. */
  reachable: ReadonlySet<string>;
  /** True when nothing but PRD bookkeeping and hench artifacts is dirty. */
  clean: boolean;
  /** Checked-out branch; undefined when HEAD is detached or git cannot say. */
  branch: string | undefined;
}

export type GateOnlyRetryDecision =
  | {
      eligible: true;
      /** The failed run whose work and held completion are retried. */
      source: RunRecord;
      hold: HeldCompletion;
      /** Commit the gate diffs from. */
      base: string;
      commits: RunCommitRecord[];
    }
  | {
      eligible: false;
      /** True when the previous run held a completion — the only case worth explaining. */
      held: boolean;
      reason: string;
    };

/** The task's runs, newest first. Run ids are not chronological, so sort on `startedAt`. */
export function taskRunsNewestFirst(taskId: string, history: readonly RunRecord[]): RunRecord[] {
  return history
    .filter((r) => r.taskId === taskId)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

function heldCompletion(run: RunRecord): HeldCompletion | undefined {
  const hold = run.completionHold;
  if (hold?.outcome !== "not-applied" || !hold.requestedAt) return undefined;
  return { ...hold, outcome: "not-applied", requestedAt: hold.requestedAt };
}

/** Commits whose reachability from HEAD the decision needs. */
export function gateOnlyProbeCommits(taskRuns: readonly RunRecord[]): string[] {
  const shas = new Set<string>();
  const last = taskRuns[0]?.commits?.at(-1);
  if (last) shas.add(last.sha);
  for (const run of taskRuns) if (run.startHead) shas.add(run.startHead);
  return [...shas];
}

const short = (sha: string): string => sha.slice(0, 8);

/**
 * Decide whether this run can skip the agent. Pure: every git fact arrives in
 * `facts`.
 *
 * @param taskRuns The task's runs, newest first ({@link taskRunsNewestFirst}).
 */
export function decideGateOnlyRetry(
  taskRuns: readonly RunRecord[],
  facts: GateOnlyGitFacts,
): GateOnlyRetryDecision {
  const source = taskRuns[0];
  if (!source) return { eligible: false, held: false, reason: "the task has no earlier run" };
  const hold = heldCompletion(source);
  if (!hold) return { eligible: false, held: false, reason: "the previous run held no completion" };

  const refuse = (reason: string): GateOnlyRetryDecision => ({ eligible: false, held: true, reason });

  if (source.gateOnlyRetry) {
    return refuse("it was itself a gate-only retry, so the gate failure is likely real and the agent gets to fix it");
  }
  if (source.status !== "failed") return refuse(`it ended ${source.status}, not failed`);
  if (source.testGate?.ran !== true || source.testGate.passed !== false) {
    return refuse("it did not fail at the test gate");
  }
  if (!source.startHead) return refuse("it recorded no start commit");
  const commits = source.commits ?? [];
  const last = commits.at(-1);
  if (!last) return refuse("it committed nothing");
  if (!facts.reachable.has(last.sha)) return refuse(`its last commit ${short(last.sha)} is not in HEAD`);
  if (source.branch && facts.branch !== source.branch) {
    return refuse(`it ran on ${source.branch}, and this checkout is on ${facts.branch ?? "a detached HEAD"}`);
  }
  if (!facts.clean) return refuse("the working tree has uncommitted changes");

  // The oldest start commit still in HEAD covers every attempt's work, not just
  // the last one's: an earlier attempt may have committed part of the task.
  const oldestFirst = [...taskRuns].reverse();
  const base = oldestFirst.find((r) => r.startHead && facts.reachable.has(r.startHead))?.startHead ?? source.startHead;

  return { eligible: true, source, hold, base, commits };
}

/** Read the git facts {@link decideGateOnlyRetry} needs. */
export async function readGateOnlyGitFacts(projectDir: string, probe: readonly string[]): Promise<GateOnlyGitFacts> {
  const reachable = new Set<string>();
  for (const sha of probe) {
    if (await isAncestorOfHead(projectDir, sha)) reachable.add(sha);
  }
  // The PRD tree is discounted: claiming the task moved it to in_progress a
  // moment ago, and finalizeRun commits that bookkeeping itself.
  const { clean } = await findUncommittedWork({ projectDir, discountPaths: PRD_COMMIT_PATHS });
  const branch = getCurrentBranch(projectDir);
  return { reachable, clean, branch: branch === "HEAD" ? undefined : branch };
}

export type GateOnlyRetryPlan = Extract<GateOnlyRetryDecision, { eligible: true }>;

/**
 * Decide, and on yes re-record the held completion on this run's claim.
 *
 * Returns undefined when the run must take the normal agent path. Prints one
 * line saying why only when the previous run held a completion — otherwise
 * there was never a gate-only retry to consider.
 */
export async function planGateOnlyRetry(opts: {
  projectDir: string;
  taskId: string;
  runHistory?: readonly RunRecord[];
  claims?: TaskClaims;
}): Promise<GateOnlyRetryPlan | undefined> {
  const taskRuns = taskRunsNewestFirst(opts.taskId, opts.runHistory ?? []);
  // No git calls unless there is a held completion to retry.
  if (!taskRuns[0] || !heldCompletion(taskRuns[0])) return undefined;

  const facts = await readGateOnlyGitFacts(opts.projectDir, gateOnlyProbeCommits(taskRuns));
  const decision = decideGateOnlyRetry(taskRuns, facts);
  const sourceId = short(taskRuns[0].id);
  if (!decision.eligible) {
    if (decision.held) info(`Gate-only retry not used for run ${sourceId}: ${decision.reason}. Running the agent.`);
    return undefined;
  }

  const { hold } = decision;
  const recorded = opts.claims
    ? await opts.claims.recordPendingCompletion(opts.taskId, {
        ...(hold.resolutionType ? { resolutionType: hold.resolutionType } : {}),
        ...(hold.resolutionDetail ? { resolutionDetail: hold.resolutionDetail } : {}),
        requestedAt: hold.requestedAt,
      })
    : false;
  if (!recorded) {
    info(
      `Gate-only retry not used for run ${sourceId}: this run's claim cannot carry its held completion. ` +
        "Running the agent.",
    );
    return undefined;
  }
  return decision;
}

/**
 * The source run's review, when it still describes the work: it passed with
 * no unrepaired must-fix, and HEAD is exactly the commit it ended on.
 */
export function inheritableReview(source: RunRecord, head: string | undefined): RunReviewRecord | undefined {
  const review = source.review;
  if (!review || review.failed !== undefined || review.unrepairedMustFixCount !== 0) return undefined;
  const last = source.commits?.at(-1);
  if (!last || !head || last.sha !== head) return undefined;
  return { ...review, inheritedFrom: source.id };
}

export interface GateOnlyRetryExecution {
  plan: GateOnlyRetryPlan;
  /** This run's record, already initialized and claimed. */
  run: RunRecord;
  memoryCtx: MemoryContext;
  /** Everything `finalizeRun` needs except what this module sets itself. */
  finalize: Omit<FinalizeRunOptions, "run" | "memoryCtx" | "heartbeat" | "startingHead" | "gateBase">;
  /**
   * Run a fresh adversarial review of `base..HEAD`, when `--review` is on and
   * the source run's review cannot be inherited. Undefined when review is off.
   */
  review?: (base: string) => Promise<void>;
}

/** Gate the source run's work without an agent session, then finalize. */
export async function executeGateOnlyRetry(x: GateOnlyRetryExecution): Promise<void> {
  const { plan, run } = x;
  const { projectDir, henchDir } = x.finalize;

  subsection("Gate-only retry");
  info(
    `Run ${short(plan.source.id)} failed only at the test gate with its work committed ` +
      `(${plan.commits.length} commit(s), last ${short(plan.commits.at(-1)!.sha)}). ` +
      `Re-running the gate from ${short(plan.base)} without an agent session.`,
  );

  run.gateOnlyRetry = { sourceRunId: plan.source.id, base: plan.base, commits: plan.commits };
  if (plan.source.summary) run.summary = plan.source.summary;
  run.spawnCount = 0;
  run.spawnBreakdown = {};
  recordClaimLoss(x.finalize.claims, run, henchDir);

  if (x.review) {
    const inherited = inheritableReview(plan.source, getCurrentHead(projectDir));
    if (inherited) {
      run.review = inherited;
      detail(`Review: inherited from run ${short(plan.source.id)} — it passed, and HEAD is unchanged since.`);
    } else {
      await x.review(plan.base);
    }
  }

  run.status = "completed";
  await finalizeRun({
    ...x.finalize,
    run,
    memoryCtx: x.memoryCtx,
    // Both the changed-file diff and `{base}` start from the earliest attempt:
    // this run's own start is HEAD, and a HEAD-relative diff is empty, which
    // the gate reads as "nothing to test" and passes.
    startingHead: plan.base,
    gateBase: plan.base,
  });
}

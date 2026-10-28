/**
 * Run classifier — why a run did not complete, and what to do next.
 *
 * Rule-based and LLM-free: a pure function over a run record, its progress
 * events and its review report. It never reads a file, a clock or the process;
 * the callers (`hench runs diagnose` and the run-end path) load the inputs.
 *
 * Every class rests on a recorded signal. A run whose record carries none of
 * them is `unclassified` — the classifier does not guess.
 *
 * @module hench/agent/analysis/run-verdict
 */

import type {
  RunDiagnosis,
  RunRecord,
  RunVerdictAction,
  RunVerdictClass,
} from "../../schema/index.js";
import type { RunEvent } from "../../store/run-events.js";
import { classifyUnresolved, type ReviewReport } from "./adversarial-review.js";

/** How many attempts a task gets before the verdict stops recommending a re-run. */
export const MAX_VERDICT_ATTEMPTS = 2;

export interface RunVerdictInput {
  run: RunRecord;
  /** Parsed lines of the run's events JSONL (`run.eventsPath`), if read. */
  events?: readonly RunEvent[];
  /** The run's review report (`.hench/reviews/<run>.json`), if read. */
  review?: ReviewReport | null;
  /** Finished, non-completed runs of the task so far — see {@link countAttempts}. */
  attempt: number;
  /**
   * Rex's directory relative to the project root, forward slashes — what the
   * layout resolver says (`rexDirName`). Paths under it are PRD bookkeeping,
   * not work, for `no-changes`.
   */
  rexDir: string;
}

/**
 * Finished, non-completed runs of `run`'s task that started no later than it.
 * Includes `run` itself when it is finished and not completed.
 */
export function countAttempts(run: RunRecord, runs: readonly RunRecord[]): number {
  const seen = new Set<string>();
  for (const r of [run, ...runs]) {
    if (seen.has(r.id)) continue;
    if (r.taskId !== run.taskId || !r.finishedAt) continue;
    if (r.status === "completed" || r.status === "running") continue;
    if (r.startedAt > run.startedAt) continue;
    seen.add(r.id);
  }
  return seen.size;
}

// ── Signals ──────────────────────────────────────────────────────────────

/**
 * The completion gate's uncommitted-work refusal, as written to `run.error`
 * by `formatUncommittedWorkRefusal` and `formatReviewRepairsUncommittedRefusal`
 * (agent/lifecycle/uncommitted-work-gate.ts). A test feeds both formatters
 * through the classifier so the wording cannot drift from this pattern.
 */
const DIRTY_TREE_REFUSAL = /Refusing to mark this task completed: .*uncommitted/;

/** The local loop's brief-too-large refusal (agent/lifecycle/loop.ts). */
const OVERSIZED = /Brief too large for configured context window/;

/** Vendor failure categories that mean "the vendor, not the task". */
const VENDOR_CATEGORIES = new Set(["auth", "rate_limit"]);

/** File-like tokens in a failure digest: a path segment ending in a source extension. */
const DIGEST_FILE = /[\w@.+-]+(?:\/[\w@.+-]+)*\.(?:[cm]?[jt]sx?|py|go|java|kt|rs|rb|php|cs|swift|vue|svelte)\b/g;

function normalizePath(path: string, root: string | undefined): string {
  let p = path.replace(/\\/g, "/");
  if (root) {
    const r = root.replace(/\\/g, "/").replace(/\/$/, "") + "/";
    if (p.startsWith(r)) p = p.slice(r.length);
  }
  return p.replace(/^\.\//, "");
}

/** Repo-relative paths the run changed: git's list plus the files it edited. */
function changedPaths(run: RunRecord, events: readonly RunEvent[]): string[] {
  const paths = new Set<string>();
  for (const p of run.structuredSummary?.filesChanged ?? []) paths.add(normalizePath(p, run.worktreeRoot));
  for (const e of events) {
    if (e.kind === "file_edited" && e.detail) paths.add(normalizePath(e.detail, run.worktreeRoot));
  }
  return [...paths];
}

/** True when `a` and `b` name the same file, one possibly a path suffix of the other. */
function samePath(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function isUnder(path: string, dir: string): boolean {
  const d = dir.replace(/\/$/, "");
  return path === d || path.startsWith(`${d}/`);
}

function digestFiles(digest: string, root: string | undefined): string[] {
  return [...new Set([...digest.matchAll(DIGEST_FILE)].map((m) => normalizePath(m[0], root)))];
}

function vendorFailureCategories(run: RunRecord): string[] {
  return [...new Set((run.events ?? []).map((e) => e.failure?.category).filter((c): c is string => !!c && VENDOR_CATEGORIES.has(c)))];
}

function list(paths: readonly string[], max = 3): string {
  const shown = paths.slice(0, max).join(", ");
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}

// ── Rules ────────────────────────────────────────────────────────────────

interface Verdict {
  class: RunVerdictClass;
  summary: string;
  evidence: string[];
  actions: RunVerdictAction[];
}

type Rule = (input: RunVerdictInput, changed: string[]) => Verdict | null;

const claimLost: Rule = ({ run }) => {
  if (run.claimLost) {
    return {
      class: "claim-lost",
      summary: `Another worktree took the task over mid-run (${run.claimLost.holderWorktree}).`,
      evidence: [`claimLost: held by ${run.claimLost.holderWorktree} since ${run.claimLost.at}`],
      actions: [
        { kind: "release-claim", label: "Release the claim, or let the other worktree finish the task" },
        { kind: "re-run", label: "Re-run the task" },
      ],
    };
  }
  if (run.readOnlyRefusal) {
    return {
      class: "claim-lost",
      summary: "The agent refused to edit and made no changes.",
      evidence: [`readOnlyRefusal: ${run.readOnlyRefusal.reason}`],
      actions: [
        { kind: "release-claim", label: "Release the claim or clean the tree" },
        { kind: "re-run", label: "Re-run the task" },
      ],
    };
  }
  if (run.error && DIRTY_TREE_REFUSAL.test(run.error)) {
    const paths = run.uncommittedPaths ?? [];
    return {
      class: "claim-lost",
      summary: "The completion was refused: the run left work uncommitted.",
      evidence: [
        "Completion gate refused on uncommitted work",
        ...(paths.length > 0 ? [`Uncommitted: ${list(paths)}`] : []),
      ],
      actions: [
        { kind: "clean-tree", label: "Commit or discard the uncommitted paths" },
        { kind: "re-run", label: "Re-run the task" },
      ],
    };
  }
  return null;
};

const vendorTransient: Rule = ({ run }) => {
  const categories = vendorFailureCategories(run);
  if (run.status !== "error_transient" && categories.length === 0) return null;
  return {
    class: "vendor-transient",
    summary: categories.length > 0
      ? `The vendor failed (${categories.join(", ")}), not the task.`
      : "The vendor kept failing transiently; retries ran out.",
    evidence: [
      ...(run.status === "error_transient" ? ["status: error_transient"] : []),
      ...categories.map((c) => `failure category: ${c}`),
      ...(run.error ? [`error: ${run.error.split("\n")[0]}`] : []),
    ],
    actions: [{ kind: "retry-later", label: "Retry later, once the vendor recovers" }],
  };
};

const budgetTimeout: Rule = ({ run }) => {
  const oversized = !!run.error && OVERSIZED.test(run.error);
  if (run.status !== "budget_exceeded" && run.status !== "timeout" && !oversized) return null;
  return {
    class: "budget-timeout",
    summary: oversized
      ? "The task's brief was too large for the model's context window."
      : run.status === "timeout"
        ? "The run timed out before finishing."
        : "The run exceeded its budget before finishing.",
    evidence: [
      oversized ? "Brief too large for the context window" : `status: ${run.status}`,
      `turns: ${run.turns}`,
    ],
    actions: [
      { kind: "split-task", label: "Split the task into smaller ones" },
      { kind: "raise-tier", label: "Or raise the task's model tier" },
    ],
  };
};

const reviewBlocked: Rule = ({ run, review }) => {
  const record = run.review;
  const recordCount = record && record.failed === undefined ? record.unrepairedMustFixCount : 0;
  const reportFindings = review ? classifyUnresolved(review).unrepairedMustFix : [];
  const failedOnMustFix = record?.failed === "must-fix-unresolved";
  if (recordCount <= 0 && reportFindings.length === 0 && !failedOnMustFix) return null;
  const count = Math.max(recordCount, reportFindings.length);
  return {
    class: "review-blocked",
    summary: count > 0
      ? `The review left ${count} must-fix finding(s) unrepaired.`
      : "The review left must-fix findings unrepaired.",
    evidence: [
      ...(recordCount > 0 ? [`review.unrepairedMustFixCount: ${recordCount}`] : []),
      ...(failedOnMustFix ? ["review failed: must-fix-unresolved"] : []),
      ...reportFindings.slice(0, 3).map((f) => `must-fix: ${f.title}${f.location ? ` (${f.location})` : ""}`),
    ],
    actions: [{ kind: "follow-up-run", label: "Follow-up run with the review findings in the brief" }],
  };
};

const testGate: Rule = ({ run }, changed) => {
  const gate = run.testGate;
  if (!gate?.ran || gate.passed) return null;
  const digest = gate.failureDigest ?? run.diagnostics?.testGateFailureDigest;
  if (!digest) return null;
  const named = digestFiles(digest, run.worktreeRoot);
  if (named.length === 0) return null;
  const ours = named.filter((n) => changed.some((c) => samePath(n, c)));
  if (ours.length > 0) {
    return {
      class: "test-gate-new",
      summary: `The test gate failed in files this run changed: ${list(ours)}.`,
      evidence: [`Gate failure names changed file(s): ${list(ours)}`],
      actions: [
        { kind: "follow-up-run", label: "Follow-up run with the failure digest in the brief" },
        { kind: "re-run", label: "Then re-run the gate" },
      ],
    };
  }
  return {
    class: "test-gate-preexisting",
    summary: `The test gate failed only in files this run did not change: ${list(named)}.`,
    evidence: [
      `Gate failure names only unchanged file(s): ${list(named)}`,
      "Not verified on main",
    ],
    actions: [
      { kind: "verify-on-main", label: "Run the failing tests on main to confirm they fail there" },
      { kind: "close-verified", label: "Then close the task as verified" },
    ],
  };
};

const completionHeld: Rule = ({ run }) => {
  if (!run.completionHold && !run.gateOnlyRetry) return null;
  return {
    class: "completion-held",
    summary: "The agent's completion is held: the run did not finish its gates.",
    evidence: [
      ...(run.completionHold ? [`completionHold: ${run.completionHold.outcome}`] : []),
      ...(run.gateOnlyRetry ? [`gateOnlyRetry of run ${run.gateOnlyRetry.sourceRunId}`] : []),
    ],
    actions: [
      { kind: "fresh", label: `Re-run with a fresh session: ndx work --task=${run.taskId} --fresh .` },
      { kind: "hand-fix", label: "Or fix it by hand, then verify" },
    ],
  };
};

const noChanges: Rule = ({ run, rexDir }, changed) => {
  // A record written before `commits` existed says nothing about them.
  if (!run.commits) return null;
  const isPrd = (p: string): boolean => isUnder(normalizePath(p, run.worktreeRoot), rexDir);
  const commits = run.commits;
  const leftBehind = (run.uncommittedPaths ?? []).filter((p) => !isPrd(p));
  const onlyRex = changed.length > 0 && changed.every(isPrd);
  if (!((commits.length === 0 && leftBehind.length === 0) || (commits.length > 0 && onlyRex))) return null;
  return {
    class: "no-changes",
    summary: commits.length === 0
      ? "The run made no commits."
      : `The run changed only PRD files under ${rexDir}/.`,
    evidence: [
      `commits: ${commits.length}`,
      ...(onlyRex ? [`Changed only: ${list(changed)}`] : []),
    ],
    actions: [{ kind: "tighten-done-when", label: "Tighten the task's done-when so the work is concrete" }],
  };
};

/** Most specific first: a lost claim or a vendor outage makes the rest moot. */
const RULES: readonly Rule[] = [claimLost, vendorTransient, budgetTimeout, reviewBlocked, testGate, completionHeld, noChanges];

const RERUN_KINDS = new Set(["re-run", "fresh", "retry-later"]);

/**
 * On the last attempt, drop every action that would just try again, and lead
 * with a follow-up fix (or a split, where the class already ranks one first).
 */
function lastAttemptActions(actions: RunVerdictAction[]): RunVerdictAction[] {
  const kept = actions.filter((a) => !RERUN_KINDS.has(a.kind));
  const first = kept[0]?.kind;
  if (first === "follow-up-run" || first === "split-task") return kept;
  return [{ kind: "follow-up-run", label: "Follow-up run that fixes the cause above; do not re-run as is" }, ...kept];
}

/** Classify a finished, non-completed run. Pure. */
export function classifyRun(input: RunVerdictInput): RunDiagnosis {
  const changed = changedPaths(input.run, input.events ?? []);
  const verdict: Verdict = RULES.reduce<Verdict | null>((found, rule) => found ?? rule(input, changed), null) ?? {
    class: "unclassified",
    summary: "No recorded signal explains this run's failure.",
    evidence: [`status: ${input.run.status}`, ...(input.run.error ? [`error: ${input.run.error.split("\n")[0]}`] : [])],
    actions: [{ kind: "hand-fix", label: "Read the run log and decide by hand" }],
  };
  const n = Math.min(Math.max(input.attempt, 1), MAX_VERDICT_ATTEMPTS);
  return {
    class: verdict.class,
    summary: verdict.summary,
    evidence: verdict.evidence,
    actions: n >= MAX_VERDICT_ATTEMPTS ? lastAttemptActions(verdict.actions) : verdict.actions,
    attempt: { n, of: MAX_VERDICT_ATTEMPTS },
  };
}

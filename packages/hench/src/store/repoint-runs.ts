/**
 * Re-point the commit SHAs a run record stores after history was rewritten.
 *
 * ## Why a run record needs this
 *
 * A run record names commits: every commit the run produced (`commits[].sha`),
 * the baseline it started from (`startHead`), and the commit that captured the
 * reviewer's repairs (`review.repairCommit`). All of them are SHAs of commits
 * on a branch, and a branch is rewritten routinely — a stack rebase, a squash
 * merge, an amend. When that happens the record still names commits that exist
 * nowhere, and the run's own evidence stops being reachable: on 2026-10-07
 * every commit cited in the PR 27/8 and #548/#549 run records left main at
 * once.
 *
 * ## Why the rules come from rex
 *
 * Which commit a rewritten SHA became is not a hench question. Rex asks it of
 * the commits a change records, and answers with an ordered set of rules:
 * already on main, a twin with the same author email, author date and subject
 * (a rebase preserves all three), the same patch-id, the same `N-DX-Item`
 * trailer and subject, and then — only through an optional injected host seam
 * — the merge commit of the pull request that carried it. A hench-local
 * reimplementation would be a second definition of commit identity across a
 * rewrite, free to disagree with rex's about the same pair of SHAs.
 *
 * ## What this module adds
 *
 * The run-record shape: which fields hold SHAs, how to collect them without
 * asking twice about the same commit, and how to write the answers back. It
 * never drops a SHA it could not resolve — an unmatched SHA is returned with
 * rex's reason, and the record keeps it unchanged.
 *
 * @module hench/store/repoint-runs
 */

import type { RunCommitRecord, RunRecord } from "../schema/index.js";
import {
  repointCommits,
  type RecordedCommitFacts,
  type RepointMatch,
  type RepointMiss,
} from "../prd/rex-gateway.js";

/** Where in a run record a SHA sat. */
export type RunShaField = "startHead" | "commits" | "repairCommit";

/** One SHA a run record holds, with where it came from. */
export interface RunSha {
  sha: string;
  field: RunShaField;
  /** The commit's subject, when the record stored it. */
  subject?: string;
}

/** What a re-point did to one run record. */
export interface RunRepointReport {
  runId: string;
  /** The ref SHAs were matched against, and its tip, as rex resolved them. */
  ref: string;
  tip: string;
  /** Old SHA → new, with the rule that matched. Only genuine moves. */
  moved: RepointMatch[];
  /** Matched to themselves: already on the ref, nothing to rewrite. */
  unchanged: RepointMatch[];
  /** Never dropped. Each carries rex's reason. */
  unmatched: RepointMiss[];
}

/**
 * Every SHA a run record holds, in a stable order, deduplicated.
 *
 * Deduplicated because the same commit legitimately appears twice: the
 * reviewer's `repairCommit` is also enumerated in `commits`, since that list
 * is read from git history rather than tracked per call site. Asking rex about
 * it twice would cost a second scan and report the same move twice.
 *
 * Exported for the CLI, which lists what it is about to ask about.
 */
export function runShas(run: RunRecord): RunSha[] {
  const seen = new Set<string>();
  const out: RunSha[] = [];
  const add = (sha: string | undefined, field: RunShaField, subject?: string): void => {
    if (!sha || seen.has(sha)) return;
    seen.add(sha);
    out.push(subject === undefined ? { sha, field } : { sha, field, subject });
  };

  add(run.startHead, "startHead", run.startHeadCommit?.subject);
  for (const commit of run.commits ?? []) add(commit.sha, "commits", commit.subject);
  if (run.review && run.review.failed === undefined) {
    add(run.review.repairCommit, "repairCommit");
  }
  return out;
}

export interface RepointRunOptions {
  /** Directory inside the git repository to read. */
  repoDir: string;
  /** Branch the SHAs should be reachable from. Defaults to rex's own default. */
  ref?: string;
}

/**
 * Re-point one run record's SHAs against a ref.
 *
 * Returns the updated record and a report. The record is a copy: the caller
 * decides whether to persist it, which is what lets a CLI offer a dry run.
 *
 * A record with no SHAs at all — one written outside a git repository, or
 * before `startHead` existed — comes back untouched with empty lists rather
 * than an error. There is nothing to re-point and that is not a failure.
 */
export async function repointRun(
  run: RunRecord,
  options: RepointRunOptions,
): Promise<{ run: RunRecord; report: RunRepointReport }> {
  const shas = runShas(run);
  if (shas.length === 0) {
    return {
      run,
      report: { runId: run.id, ref: options.ref ?? "", tip: "", moved: [], unchanged: [], unmatched: [] },
    };
  }

  // The facts the run recorded, for the SHAs git can no longer resolve. Rex
  // rejects a missing SHA before any twin rule runs, and its twin key is
  // author email + author date + subject — so without these the stored facts
  // were never read at all, in exactly the case they were recorded for: a
  // pruned branch, a fresh clone, `git gc` after a squash merge.
  const recorded = new Map<string, RecordedCommitFacts>();
  const remember = (sha: string | undefined, facts: RunCommitRecord | undefined): void => {
    if (!sha || !facts) return;
    recorded.set(sha, {
      ...(facts.authorEmail ? { authorEmail: facts.authorEmail } : {}),
      ...(facts.authorDate ? { authorDate: facts.authorDate } : {}),
      ...(facts.subject ? { subject: facts.subject } : {}),
    });
  };
  remember(run.startHead, run.startHeadCommit);
  for (const commit of run.commits ?? []) remember(commit.sha, commit);

  const result = await repointCommits(
    shas.map((entry) => entry.sha),
    {
      repoDir: options.repoDir,
      ...(options.ref ? { ref: options.ref } : {}),
      ...(recorded.size > 0 ? { facts: recorded } : {}),
    },
  );

  // `on-main` means the SHA is still reachable and nothing needs rewriting.
  // Separated from the genuine moves so a report can say "nothing moved"
  // without the reader counting rules.
  const moved = result.matched.filter((m) => m.old !== m.new);
  const unchanged = result.matched.filter((m) => m.old === m.new);

  const byOld = new Map(moved.map((m) => [m.old, m.new]));
  const updated: RunRecord = { ...run };

  if (updated.startHead && byOld.has(updated.startHead)) {
    const next = byOld.get(updated.startHead) as string;
    // The subject and author date belong to the commit that was rewritten,
    // not to its twin. Dropping them is honest: the next re-point reads the
    // new SHA directly, and a stale subject beside a new SHA would be a claim
    // about the twin that nothing here checked.
    updated.startHead = next;
    delete updated.startHeadCommit;
  }

  if (updated.commits?.length) {
    updated.commits = updated.commits.map((commit) => {
      const next = byOld.get(commit.sha);
      return next ? { sha: next, subject: commit.subject } : commit;
    });
  }

  if (updated.review && updated.review.failed === undefined && updated.review.repairCommit) {
    const next = byOld.get(updated.review.repairCommit);
    if (next) updated.review = { ...updated.review, repairCommit: next };
  }

  return {
    run: updated,
    report: {
      runId: run.id,
      ref: result.ref,
      tip: result.tip,
      moved,
      unchanged,
      unmatched: result.unmatched,
    },
  };
}

/**
 * Render a report for the terminal, one line per SHA that moved or could not
 * be matched.
 *
 * Unchanged SHAs are counted, not listed: on a healthy record they are all of
 * them, and the operator is here to find out what did not survive.
 */
export function formatRunRepointReport(report: RunRepointReport): string[] {
  const lines: string[] = [];
  const total = report.moved.length + report.unchanged.length + report.unmatched.length;

  if (total === 0) {
    return [`Run ${report.runId}: no commit SHAs recorded.`];
  }

  lines.push(`Run ${report.runId}: ${total} commit SHA(s) against ${report.ref || "the default ref"}.`);

  if (report.moved.length > 0) {
    lines.push(`Re-pointed ${report.moved.length}:`);
    for (const match of report.moved) {
      lines.push(`  ${match.old.slice(0, 8)} -> ${match.new.slice(0, 8)}  (${match.rule})`);
    }
  }

  if (report.unchanged.length > 0) {
    lines.push(`Already on the ref: ${report.unchanged.length}.`);
  }

  if (report.unmatched.length > 0) {
    lines.push(`Could not re-point ${report.unmatched.length}:`);
    for (const miss of report.unmatched) {
      lines.push(`  ${miss.sha.slice(0, 8)}  ${miss.reason}`);
    }
  }

  return lines;
}

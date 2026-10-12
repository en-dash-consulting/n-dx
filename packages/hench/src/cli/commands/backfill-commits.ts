/**
 * CLI command: fill `commits` on run records that were written without one.
 *
 * Usage:
 *   hench backfill-commits [--ref=<branch>] [--pad=<minutes>] [--dry-run]
 *                          [--format=json] [dir]
 *
 * `RunRecord.commits` is the one channel that ties a run, and so its task, to
 * the code it changed. The live path fills it from `startHead..HEAD` when a
 * run ends; a record written before `startHead` existed has nothing, and on a
 * repository worked by hench before any commit carried an `N-DX-Item` trailer
 * that is nearly every run. Git still knows what happened, so this reads the
 * main branch once and ties each commit to at most one run, in this order:
 *
 * 1. `subject`: the commit's subject names the run id (review-repair commits
 *    say `(run <id>)`).
 * 2. `trailer`: the commit's `N-DX-Item` trailer names the run's task. With
 *    several runs of that task, the run whose window holds the commit wins,
 *    else the last run that started before it.
 * 3. `window`: the commit was authored inside the run's window (`startedAt`
 *    to `finishedAt`, or `lastActivityAt`) and no other run's window holds
 *    it; failing that, inside the window stretched by `--pad` minutes, since
 *    the record is written before the last commit lands. A commit two windows
 *    both claim is ambiguous and stays unattributed; a commit whose trailer
 *    names some other item is someone else's work and never falls to a
 *    window. A window longer than `--max-window` is not a window at all: a run
 *    ended by an audit weeks after it died would otherwise claim everything
 *    in between.
 *
 * Merge commits and PRD-only `chore(prd)` commits are never attributed. A
 * commit a record already names (the live path's, or an earlier backfill's)
 * is taken, so the command is idempotent and a record that has commits is
 * left exactly as it is. Each commit written carries its `attribution`.
 *
 * Exit codes:
 *   0  done (or nothing to do)
 *   1  the ref does not resolve, or `dir` is not a git repository
 */

import { listRuns, saveRun } from "../../store/runs.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { execStdout } from "../../process/exec.js";
import { info, result } from "../output.js";
import { CLIError } from "../errors.js";
import type { RunRecord, RunCommitAttribution, RunCommitRecord } from "../../schema/index.js";

export interface BackfillCommitsFlags {
  ref?: string;
  pad?: string;
  "max-window"?: string;
  "dry-run"?: string;
  format?: string;
}

/** A commit on the main branch, as the attribution reads it. */
export interface MainCommit {
  sha: string;
  subject: string;
  /** Author time, epoch ms. */
  authoredAt: number;
  /** Parent count; more than one is a merge. */
  parents: number;
  /** The `N-DX-Item` trailer values git parsed. */
  items: string[];
}

/** The refs tried in order when `--ref` is not given; an explicit ref is never substituted. */
export const DEFAULT_MAIN_REFS = ["origin/HEAD", "origin/main", "main", "HEAD"] as const;

/** Minutes a run's window reaches past its last recorded time: the record is written before the final commit lands. */
export const DEFAULT_PAD_MINUTES = 10;

/** Minutes beyond which a run's window says nothing about its commits: a run ended by an audit long after it died. */
export const DEFAULT_MAX_WINDOW_MINUTES = 6 * 60;

export interface AttributionOptions {
  padMs?: number;
  maxWindowMs?: number;
}

/** Commits that only write the PRD tree: bookkeeping, not a run's work. */
const PRD_ONLY_SUBJECT = /^chore\(prd\)/;

export interface AttributionCounts {
  runs: number;
  /** Runs with no commits before this pass. */
  candidates: number;
  /** Runs that received at least one commit. */
  filled: number;
  subject: number;
  trailer: number;
  window: number;
  /** Commits two or more windows claimed. */
  ambiguous: number;
  /** Commits no run could be found for. */
  unattributed: number;
  merges: number;
  prdOnly: number;
}

export interface AttributionPlan {
  /** Run id → the commits it receives, oldest first. */
  commits: Map<string, RunCommitRecord[]>;
  counts: AttributionCounts;
}

interface Window {
  run: RunRecord;
  start: number;
  /** Absent when the record has no end time, or its window is too long to mean anything. */
  end?: number;
}

function windowOf(run: RunRecord, maxWindowMs: number): Window {
  const start = Date.parse(run.startedAt);
  const last = run.finishedAt ?? run.lastActivityAt;
  const end = last ? Date.parse(last) : Number.NaN;
  const usable = !Number.isNaN(start) && !Number.isNaN(end) && end - start <= maxWindowMs;
  return { run, start, ...(usable ? { end } : {}) };
}

function holds(w: Window, at: number, padMs = 0): boolean {
  return !Number.isNaN(w.start) && w.end !== undefined && at >= w.start && at <= w.end + padMs;
}

/**
 * Tie each unclaimed commit to at most one run. Pure: reads the runs and the
 * commits, returns what each run would receive.
 */
export function attributeCommits(runs: readonly RunRecord[], commits: readonly MainCommit[], options: AttributionOptions = {}): AttributionPlan {
  const padMs = options.padMs ?? DEFAULT_PAD_MINUTES * 60_000;
  const maxWindowMs = options.maxWindowMs ?? DEFAULT_MAX_WINDOW_MINUTES * 60_000;
  const counts: AttributionCounts = { runs: runs.length, candidates: 0, filled: 0, subject: 0, trailer: 0, window: 0, ambiguous: 0, unattributed: 0, merges: 0, prdOnly: 0 };
  const claimed = new Set<string>();
  const candidates: Window[] = [];
  for (const run of runs) {
    if (run.commits && run.commits.length > 0) {
      for (const c of run.commits) claimed.add(c.sha);
    } else {
      counts.candidates += 1;
      candidates.push(windowOf(run, maxWindowMs));
    }
  }
  const byTask = new Map<string, Window[]>();
  for (const w of candidates) {
    const list = byTask.get(w.run.taskId) ?? [];
    list.push(w);
    byTask.set(w.run.taskId, list);
  }

  const assigned = new Map<string, Array<{ commit: MainCommit; attribution: RunCommitAttribution }>>();
  const give = (w: Window, commit: MainCommit, attribution: RunCommitAttribution): void => {
    const list = assigned.get(w.run.id) ?? [];
    list.push({ commit, attribution });
    assigned.set(w.run.id, list);
    counts[attribution === "start-head" ? "window" : attribution] += 1;
  };

  for (const commit of [...commits].sort((a, b) => a.authoredAt - b.authoredAt)) {
    if (claimed.has(commit.sha)) continue;
    if (commit.parents > 1) {
      counts.merges += 1;
      continue;
    }
    if (PRD_ONLY_SUBJECT.test(commit.subject)) {
      counts.prdOnly += 1;
      continue;
    }

    const named = candidates.find((w) => commit.subject.includes(w.run.id));
    if (named) {
      give(named, commit, "subject");
      continue;
    }

    const ofTask = commit.items.flatMap((item) => byTask.get(item) ?? []);
    if (ofTask.length > 0) {
      const inWindow = ofTask.find((w) => holds(w, commit.authoredAt, padMs));
      const before = ofTask.filter((w) => !Number.isNaN(w.start) && w.start <= commit.authoredAt).sort((a, b) => b.start - a.start)[0];
      give(inWindow ?? before ?? ofTask[0]!, commit, "trailer");
      continue;
    }
    if (commit.items.length > 0) {
      // Someone else's item: the trailer says whose, and it is not a candidate's.
      counts.unattributed += 1;
      continue;
    }

    // The window proper first; the pad only when no window proper holds it, so
    // back-to-back loop runs do not read ambiguous for the pad's sake.
    const core = candidates.filter((w) => holds(w, commit.authoredAt));
    const holders = core.length > 0 ? core : candidates.filter((w) => holds(w, commit.authoredAt, padMs));
    if (holders.length === 1) give(holders[0]!, commit, "window");
    else if (holders.length > 1) counts.ambiguous += 1;
    else counts.unattributed += 1;
  }

  const out = new Map<string, RunCommitRecord[]>();
  for (const [runId, list] of assigned) {
    list.sort((a, b) => a.commit.authoredAt - b.commit.authoredAt);
    out.set(
      runId,
      list.map(({ commit, attribution }) => ({ sha: commit.sha, subject: commit.subject, attribution })),
    );
  }
  counts.filled = out.size;
  return { commits: out, counts };
}

/** The first ref that resolves, or the explicit one; throws when none does. */
export async function resolveRef(projectDir: string, ref?: string): Promise<string> {
  const tried = ref !== undefined ? [ref] : [...DEFAULT_MAIN_REFS];
  for (const candidate of tried) {
    const out = (await execStdout("git", ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], { cwd: projectDir, timeout: 10_000 })).trim();
    if (out) return candidate;
  }
  throw new CLIError(
    ref !== undefined ? `"${ref}" does not name a commit in ${projectDir}.` : `No main branch found in ${projectDir} (tried ${tried.join(", ")}).`,
    "Pass --ref=<branch> naming the branch the runs' commits landed on.",
  );
}

/** Every commit reachable from `ref`, with the fields the attribution reads. One git call. */
export async function readMainCommits(projectDir: string, ref: string): Promise<MainCommit[]> {
  // Unit separator between fields, record separator between trailer values,
  // group separator between commits: a subject holds none of them.
  const output = await execStdout(
    "git",
    ["log", ref, "--format=%H%x1f%P%x1f%aI%x1f%s%x1f%(trailers:key=N-DX-Item,valueonly,separator=%x1e)%x1d"],
    { cwd: projectDir, timeout: 60_000, maxBuffer: 256 * 1024 * 1024 },
  );
  const commits: MainCommit[] = [];
  for (const record of output.split("\x1d")) {
    const [sha = "", parents = "", authored = "", subject = "", items = ""] = record.replace(/^\n/, "").split("\x1f");
    if (!sha.trim()) continue;
    commits.push({
      sha: sha.trim(),
      subject,
      authoredAt: Date.parse(authored),
      parents: parents.trim() === "" ? 0 : parents.trim().split(/\s+/).length,
      items: items
        .split("\x1e")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }
  return commits;
}

export async function cmdBackfillCommits(dir: string, flags: BackfillCommitsFlags): Promise<void> {
  const dryRun = flags["dry-run"] === "true";
  const asJson = flags.format === "json";
  const padMinutes = flags.pad !== undefined ? Number(flags.pad) : DEFAULT_PAD_MINUTES;
  if (!Number.isFinite(padMinutes) || padMinutes < 0) {
    throw new CLIError(`--pad must be a number of minutes, got "${flags.pad}".`);
  }
  const maxWindowMinutes = flags["max-window"] !== undefined ? Number(flags["max-window"]) : DEFAULT_MAX_WINDOW_MINUTES;
  if (!Number.isFinite(maxWindowMinutes) || maxWindowMinutes <= 0) {
    throw new CLIError(`--max-window must be a number of minutes, got "${flags["max-window"]}".`);
  }

  const ref = await resolveRef(dir, flags.ref);
  const { henchDir } = resolveHenchPaths(dir);
  const runs = await listRuns(henchDir);
  const commits = await readMainCommits(dir, ref);
  const plan = attributeCommits(runs, commits, { padMs: padMinutes * 60_000, maxWindowMs: maxWindowMinutes * 60_000 });

  if (!dryRun) {
    const byId = new Map(runs.map((r) => [r.id, r]));
    for (const [runId, records] of plan.commits) {
      const run = byId.get(runId);
      if (!run) continue;
      run.commits = records;
      await saveRun(henchDir, run);
    }
  }

  const { counts } = plan;
  if (asJson) {
    result(JSON.stringify({ ref, dryRun, pad: padMinutes, maxWindow: maxWindowMinutes, counts, runs: [...plan.commits.entries()].map(([id, c]) => ({ id, commits: c })) }, null, 2));
    return;
  }
  info(`${dryRun ? "Would fill" : "Filled"} commits on ${counts.filled} of ${counts.candidates} run${counts.candidates === 1 ? "" : "s"} without one (${counts.runs} in all), from ${commits.length} commits on ${ref}.`);
  info(`  by subject ${counts.subject} · by trailer ${counts.trailer} · by window ${counts.window}`);
  info(`  left alone: ${counts.ambiguous} ambiguous (two windows), ${counts.unattributed} unattributed, ${counts.merges} merges, ${counts.prdOnly} PRD-only`);
  if (dryRun) info("Dry run: nothing written.");
}

/**
 * A run record's commit SHAs survive a rebase.
 *
 * A record names commits — `startHead`, every commit the run produced, and the
 * reviewer's `repairCommit` — and a stack rebase rewrites all of them at once.
 * These tests use a real fixture repository: a branch is committed, main moves
 * on, the branch is rebased and merged, and the record then cites SHAs that
 * are on no branch. The matching rules themselves are rex's and are tested
 * there; what is tested here is the run-record half — which fields are
 * collected, that the same commit is not asked about twice, that the record is
 * rewritten correctly, and that nothing unmatched is quietly dropped.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { RunRecord } from "../../src/schema/index.js";
import { repointRun, runShas, formatRunRepointReport } from "../../src/store/repoint-runs.js";

let root: string;
let repo: string;
let clock = 0;

/**
 * Run git with a fixed, increasing clock. `keepAuthorDate` sets only the
 * committer date, so a rebase keeps the original author date as it does
 * outside a test — which is what makes the author-date-subject rule work.
 */
function git(args: string[], keepAuthorDate = false): string {
  clock += 1;
  const date = new Date(Date.UTC(2026, 9, 1, 0, clock)).toISOString();
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_COMMITTER_DATE: date };
  if (keepAuthorDate) delete env.GIT_AUTHOR_DATE;
  else env.GIT_AUTHOR_DATE = date;
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function commit(file: string, message: string): Promise<string> {
  await writeFile(join(repo, file), `${file} ${clock}\n`, "utf-8");
  git(["add", file]);
  const msgFile = join(root, `msg-${clock}.txt`);
  await writeFile(msgFile, message, "utf-8");
  git(["commit", "-q", "-F", msgFile]);
  return git(["rev-parse", "HEAD"]);
}

/** Pre-rebase SHAs, as a run record would have stored them. */
const before: Record<string, string> = {};
/** The same commits' SHAs on main after the rebase. */
const after: Record<string, string> = {};
/** A SHA of a commit that was never merged anywhere. */
let abandoned: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-repoint-runs-"));
  repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "commit.gpgsign", "false"]);

  const base = await commit("base.txt", "Initial commit");

  // The run's branch: the baseline it started from, its work commit, and the
  // reviewer's repair commit.
  git(["checkout", "-q", "-b", "work", base]);
  before.startHead = await commit("baseline.txt", "Baseline the run started from");
  before.work = await commit("work.txt", "feat: the work the run did");
  before.repair = await commit("repair.txt", "fix: repairs from the review pass");

  // A commit on another branch that never lands — the unmatched case.
  git(["checkout", "-q", "-b", "abandoned", base]);
  abandoned = await commit("abandoned.txt", "Never merged");

  // Main moves on, then the branch is rebased onto it and fast-forwarded in.
  // Every SHA above is rewritten; author email, author date and subject are
  // preserved, which is what the twin rule matches on.
  git(["checkout", "-q", "main"]);
  await commit("moves-main.txt", "Main moves on");
  git(["checkout", "-q", "work"]);
  git(["rebase", "-q", "main"], true);
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--ff-only", "work"]);

  const log = git(["log", "--format=%H%x1f%s", "main"]).split("\n");
  for (const line of log) {
    const [sha, subject] = line.split("\x1f");
    if (subject === "Baseline the run started from") after.startHead = sha;
    if (subject === "feat: the work the run did") after.work = sha;
    if (subject === "fix: repairs from the review pass") after.repair = sha;
  }
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A record as it was written before the rebase. */
function recordBeforeRebase(): RunRecord {
  return {
    id: "run-001",
    taskId: "task-42",
    taskTitle: "Do the work",
    startedAt: "2026-10-01T00:00:00.000Z",
    finishedAt: "2026-10-01T00:10:00.000Z",
    status: "completed",
    turns: 4,
    tokenUsage: { input: 100, output: 50 },
    toolCalls: [],
    model: "claude-opus-5",
    startHead: before.startHead,
    startHeadCommit: {
      sha: before.startHead,
      subject: "Baseline the run started from",
      authorDate: "2026-10-01T00:01:00.000Z",
    },
    commits: [
      { sha: before.work, subject: "feat: the work the run did" },
      { sha: before.repair, subject: "fix: repairs from the review pass" },
    ],
    review: {
      model: "claude-opus-5",
      resumedSession: false,
      findingCount: 1,
      unresolvedCount: 0,
      unrepairedMustFixCount: 0,
      failedActionCount: 0,
      fixesApplied: true,
      reportPath: join(repo, ".hench", "reviews", "run-001.json"),
      repairCommit: before.repair,
    },
  };
}

describe("runShas", () => {
  it("collects every field that holds a SHA", () => {
    const fields = runShas(recordBeforeRebase()).map((entry) => entry.field);
    expect(fields).toContain("startHead");
    expect(fields.filter((f) => f === "commits")).toHaveLength(2);
  });

  it("does not ask about the repair commit twice", () => {
    // `commits` is read from git history, so it already contains the review's
    // repairCommit. Without deduplication rex would scan for it twice and the
    // report would name the same move twice.
    const shas = runShas(recordBeforeRebase()).map((entry) => entry.sha);
    expect(new Set(shas).size).toBe(shas.length);
    expect(shas).toHaveLength(3);
  });

  it("returns nothing for a record that stored no SHAs", () => {
    const run = recordBeforeRebase();
    delete run.startHead;
    delete run.startHeadCommit;
    delete run.commits;
    delete (run.review as { repairCommit?: string }).repairCommit;

    expect(runShas(run)).toEqual([]);
  });
});

describe("repointRun over a rebased branch", () => {
  it("maps every rewritten SHA to its twin on main", async () => {
    const { run, report } = await repointRun(recordBeforeRebase(), {
      repoDir: repo,
      ref: "main",
    });

    expect(report.unmatched).toEqual([]);
    expect(run.startHead).toBe(after.startHead);
    expect(run.commits?.map((c) => c.sha)).toEqual([after.work, after.repair]);
    expect(run.review && "repairCommit" in run.review ? run.review.repairCommit : undefined).toBe(
      after.repair,
    );
  });

  it("names the rule that matched each move", async () => {
    const { report } = await repointRun(recordBeforeRebase(), { repoDir: repo, ref: "main" });

    expect(report.moved).toHaveLength(3);
    for (const match of report.moved) {
      expect(match.rule).toBe("author-date-subject");
    }
  });

  it("drops the baseline's stale facts rather than keeping them beside a new SHA", async () => {
    // The subject and author date described the commit that was rewritten.
    // Carried over unchanged they would be an unverified claim about its twin.
    const { run } = await repointRun(recordBeforeRebase(), { repoDir: repo, ref: "main" });

    expect(run.startHeadCommit).toBeUndefined();
  });

  it("leaves the original record untouched, so a caller can report before writing", async () => {
    const original = recordBeforeRebase();
    await repointRun(original, { repoDir: repo, ref: "main" });

    expect(original.startHead).toBe(before.startHead);
    expect(original.commits?.[0].sha).toBe(before.work);
  });

  it("reports a SHA it could not match instead of dropping it", async () => {
    const run = recordBeforeRebase();
    run.commits = [{ sha: abandoned, subject: "Never merged" }];
    delete (run.review as { repairCommit?: string }).repairCommit;

    const { run: updated, report } = await repointRun(run, { repoDir: repo, ref: "main" });

    expect(report.unmatched.map((m) => m.sha)).toContain(abandoned);
    expect(report.unmatched[0].reason).toBeTruthy();
    // The record keeps it: an unresolvable SHA is still the best record of
    // what the run did.
    expect(updated.commits?.[0].sha).toBe(abandoned);
  });

  it("counts a SHA already on the ref as unchanged, not as a move", async () => {
    const run = recordBeforeRebase();
    run.startHead = after.startHead;
    delete run.startHeadCommit;
    run.commits = [];
    delete (run.review as { repairCommit?: string }).repairCommit;

    const { report } = await repointRun(run, { repoDir: repo, ref: "main" });

    expect(report.moved).toEqual([]);
    expect(report.unchanged).toHaveLength(1);
    expect(report.unchanged[0].rule).toBe("on-main");
  });
});

describe("a record written before commit facts were stored", () => {
  it("is still readable and still re-points", async () => {
    // No authorDate on any commit, and no startHeadCommit at all — exactly a
    // record from before this field existed. The twin rule reads git for the
    // old SHA's facts, so it still works; nothing here depends on the stored
    // copy.
    const run = recordBeforeRebase();
    delete run.startHeadCommit;
    run.commits = [{ sha: before.work, subject: "feat: the work the run did" }];
    delete (run.review as { repairCommit?: string }).repairCommit;

    const { run: updated, report } = await repointRun(run, { repoDir: repo, ref: "main" });

    expect(report.unmatched).toEqual([]);
    expect(updated.commits?.[0].sha).toBe(after.work);
  });
});

describe("formatRunRepointReport", () => {
  it("lists what moved and what could not be matched, and counts the rest", async () => {
    const run = recordBeforeRebase();
    run.commits = [
      { sha: before.work, subject: "feat: the work the run did" },
      { sha: abandoned, subject: "Never merged" },
    ];
    run.startHead = after.startHead;
    delete run.startHeadCommit;
    delete (run.review as { repairCommit?: string }).repairCommit;

    const { report } = await repointRun(run, { repoDir: repo, ref: "main" });
    const text = formatRunRepointReport(report).join("\n");

    expect(text).toContain("Re-pointed 1");
    expect(text).toContain(after.work.slice(0, 8));
    expect(text).toContain("author-date-subject");
    expect(text).toContain("Already on the ref: 1");
    expect(text).toContain("Could not re-point 1");
    expect(text).toContain(abandoned.slice(0, 8));
  });

  it("says so plainly when the record holds no SHAs", () => {
    const text = formatRunRepointReport({
      runId: "run-001",
      ref: "main",
      tip: "abc",
      moved: [],
      unchanged: [],
      unmatched: [],
    }).join("\n");

    expect(text).toContain("no commit SHAs recorded");
  });
});

/**
 * `hench backfill-commits` — ties the main branch's commits to the runs that
 * made them, for records written before `startHead` existed.
 *
 * The attribution rules are tested on `attributeCommits` directly; the
 * command tests cover what it reads from git, what it writes, and when it
 * writes nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { attributeCommits, cmdBackfillCommits, readMainCommits, resolveRef, type MainCommit } from "../../../../src/cli/commands/backfill-commits.js";
import type { RunRecord } from "../../../../src/schema/index.js";
import { initGitFixtureRepoSync, RM_RETRY } from "../../../helpers/index.js";

const T0 = Date.parse("2026-02-10T10:00:00Z");
const minute = 60_000;
const at = (minutes: number): string => new Date(T0 + minutes * minute).toISOString();

function run(id: string, taskId: string, startMin: number, endMin: number | undefined, extra: Partial<RunRecord> = {}): RunRecord {
  return {
    id,
    taskId,
    taskTitle: `Task ${taskId}`,
    startedAt: at(startMin),
    ...(endMin !== undefined ? { finishedAt: at(endMin) } : {}),
    status: "completed",
    turns: 1,
    tokenUsage: { input: 1, output: 1 },
    toolCalls: [],
    model: "claude-opus-5",
    ...extra,
  } as RunRecord;
}

function commit(sha: string, subject: string, minutes: number, extra: Partial<MainCommit> = {}): MainCommit {
  return { sha, subject, authoredAt: T0 + minutes * minute, parents: 1, items: [], ...extra };
}

const PAD = { padMs: 10 * minute };

describe("attributeCommits", () => {
  it("ties a commit whose subject names the run id, wherever it was authored", () => {
    const r = run("run-a", "task-1", 0, 20);
    const plan = attributeCommits([r], [commit("c1", "fix(review): repairs (run run-a)", 500)], PAD);
    expect(plan.commits.get("run-a")).toEqual([{ sha: "c1", subject: "fix(review): repairs (run run-a)", attribution: "subject" }]);
    expect(plan.counts).toMatchObject({ candidates: 1, filled: 1, subject: 1, trailer: 0, window: 0 });
  });

  it("ties a trailer commit to the run of its task whose window holds it, else the last run started before it", () => {
    const first = run("run-a", "task-1", 0, 20);
    const second = run("run-b", "task-1", 100, 120);
    const commits = [
      commit("c1", "Build it", 10, { items: ["task-1"] }),
      commit("c2", "Finish it", 110, { items: ["task-1"] }),
      commit("c3", "Patch it later", 300, { items: ["task-1"] }),
    ];
    const plan = attributeCommits([first, second], commits, PAD);
    expect(plan.commits.get("run-a")?.map((c) => c.sha)).toEqual(["c1"]);
    expect(plan.commits.get("run-b")?.map((c) => c.sha)).toEqual(["c2", "c3"]);
    expect(plan.commits.get("run-b")?.every((c) => c.attribution === "trailer")).toBe(true);
    expect(plan.counts.trailer).toBe(3);
  });

  it("ties an untagged commit to the one run whose window holds it, and calls two holders ambiguous", () => {
    const a = run("run-a", "task-1", 0, 24);
    const b = run("run-b", "task-2", 25, 40);
    const overlapping = run("run-c", "task-3", 35, 60);
    const commits = [
      commit("c1", "Work for a", 15),
      commit("c2", "Work in the pad after a", 25.5), // a's pad reaches 26, but b's window proper holds it: b's.
      commit("c3", "Work for b alone", 30),
      commit("c4", "Work for b or c", 38),
      commit("c5", "Nobody's", 500),
    ];
    const plan = attributeCommits([a, b, overlapping], commits, { padMs: 2 * minute });
    expect(plan.commits.get("run-a")?.map((c) => c.sha)).toEqual(["c1"]);
    expect(plan.commits.get("run-b")?.map((c) => c.sha)).toEqual(["c2", "c3"]);
    expect(plan.commits.get("run-c")).toBeUndefined(); // c4 sits in b's and c's windows proper: ambiguous
    expect(plan.counts).toMatchObject({ window: 3, ambiguous: 1, unattributed: 1 });
    expect(plan.commits.get("run-a")?.[0]?.attribution).toBe("window");
  });

  it("never attributes a merge, a chore(prd) commit, a commit tagged for some other item, or one a record already names", () => {
    const a = run("run-a", "task-1", 0, 20);
    const live = run("run-live", "task-9", 0, 20, { commits: [{ sha: "c-live", subject: "Landed live", attribution: "start-head" }] });
    const commits = [
      commit("m1", "Merge branch 'x'", 5, { parents: 2 }),
      commit("p1", "chore(prd): commit PRD tree changes", 6),
      commit("o1", "Someone else's work", 7, { items: ["task-other"] }),
      commit("c-live", "Landed live", 8),
      commit("c1", "Real work", 9),
    ];
    const plan = attributeCommits([a, live], commits, PAD);
    expect(plan.commits.get("run-a")?.map((c) => c.sha)).toEqual(["c1"]);
    expect(plan.commits.has("run-live")).toBe(false);
    expect(plan.counts).toMatchObject({ candidates: 1, merges: 1, prdOnly: 1, unattributed: 1, window: 1 });
  });

  it("reads the window proper before the pad, so back-to-back loop runs are not ambiguous", () => {
    const a = run("run-a", "task-1", 0, 20);
    const b = run("run-b", "task-2", 20, 40); // starts the moment a ends: a's pad covers b's first minutes
    const plan = attributeCommits([a, b], [commit("c1", "a's last commit", 19), commit("c2", "b's first commit", 22), commit("c3", "in a's pad, before b", 20.5)], PAD);
    expect(plan.commits.get("run-a")?.map((c) => c.sha)).toEqual(["c1"]);
    expect(plan.commits.get("run-b")?.map((c) => c.sha)).toEqual(["c3", "c2"]);
    expect(plan.counts.ambiguous).toBe(0);
  });

  it("gives a run whose window is longer than max-window nothing by window, so an audit-ended run swallows nothing", () => {
    const dead = run("run-dead", "task-1", 0, 30 * 24 * 60, { status: "failed" }); // ended by an audit a month later
    const live = run("run-live", "task-2", 100, 120);
    const plan = attributeCommits([dead, live], [commit("c1", "live work", 110), commit("c2", "dead's own work (run run-dead)", 5), commit("c3", "somebody's", 5000)], PAD);
    expect(plan.commits.get("run-live")?.map((c) => c.sha)).toEqual(["c1"]);
    expect(plan.commits.get("run-dead")?.map((c) => c.sha)).toEqual(["c2"]); // by subject, which needs no window
    expect(plan.counts).toMatchObject({ window: 1, subject: 1, ambiguous: 0, unattributed: 1 });
    expect(attributeCommits([dead, live], [commit("c3", "a month in", 5000)], { ...PAD, maxWindowMs: 60 * 24 * 60 * minute }).commits.get("run-dead")?.map((c) => c.sha)).toEqual(["c3"]);
  });

  it("orders a run's commits oldest first and skips a run with no end time for windows", () => {
    const a = run("run-a", "task-1", 0, 30);
    const open = run("run-open", "task-2", 0, undefined);
    const plan = attributeCommits([a, open], [commit("c2", "later", 20), commit("c1", "earlier", 10)], PAD);
    expect(plan.commits.get("run-a")?.map((c) => c.sha)).toEqual(["c1", "c2"]);
    expect(plan.commits.has("run-open")).toBe(false);
  });
});

describe("hench backfill-commits", () => {
  let dir: string;
  let runsDir: string;

  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
  }

  function commitAt(file: string, message: string, iso: string): string {
    writeFileSync(join(dir, file), `${message}\n`);
    git("add", file);
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso } });
    return git("rev-parse", "HEAD");
  }

  async function writeRun(record: RunRecord): Promise<void> {
    await writeFile(join(runsDir, `${record.id}.json`), JSON.stringify(record, null, 2));
  }

  async function readRun(id: string): Promise<RunRecord> {
    return JSON.parse(await readFile(join(runsDir, `${id}.json`), "utf-8")) as RunRecord;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-backfill-"));
    runsDir = join(dir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    initGitFixtureRepoSync(dir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("reads the branch's commits with their parents, author time and item trailers", async () => {
    commitAt("a.txt", "start", at(0));
    const tagged = commitAt("b.txt", `Build it\n\nN-DX-Item: task-1`, at(5));
    const ref = await resolveRef(dir);
    const commits = await readMainCommits(dir, ref);
    expect(commits.map((c) => c.subject)).toEqual(["Build it", "start"]);
    const built = commits.find((c) => c.sha === tagged)!;
    expect(built).toMatchObject({ parents: 1, items: ["task-1"], authoredAt: T0 + 5 * minute });
    expect(commits.find((c) => c.subject === "start")!.parents).toBe(0);
  });

  it("fills the runs that have no commits, says how each was tied, and leaves the rest alone", async () => {
    commitAt("a.txt", "start", at(0));
    const windowed = commitAt("b.txt", "Build the thing", at(12));
    const prd = commitAt("c.txt", "chore(prd): commit PRD tree changes", at(13));
    git("checkout", "-q", "-b", "side");
    const side = commitAt("d.txt", "Side work", at(14));
    git("checkout", "-q", "-");
    execFileSync("git", ["merge", "-q", "--no-ff", "-m", "Merge branch 'side'", "side"], { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: at(15), GIT_COMMITTER_DATE: at(15) } });
    const repaired = commitAt("e.txt", "fix(review): repairs (run run-b)", at(200));
    const tagged = commitAt("f.txt", `Finish it\n\nN-DX-Item: task-3`, at(300));

    await writeRun(run("run-a", "task-1", 10, 16));
    await writeRun(run("run-b", "task-2", 100, 110));
    await writeRun(run("run-c", "task-3", 290, 295));
    await writeRun(run("run-live", "task-4", 0, 1, { commits: [{ sha: "deadbeef", subject: "already", attribution: "start-head" }] }));

    await cmdBackfillCommits(dir, { "dry-run": "true" });
    expect((await readRun("run-a")).commits).toBeUndefined();

    await cmdBackfillCommits(dir, {});
    // The side branch's commit is reachable from the branch and authored inside the window: the run's work, merged in.
    expect((await readRun("run-a")).commits).toEqual([
      { sha: windowed, subject: "Build the thing", attribution: "window" },
      { sha: side, subject: "Side work", attribution: "window" },
    ]);
    expect((await readRun("run-b")).commits).toEqual([{ sha: repaired, subject: "fix(review): repairs (run run-b)", attribution: "subject" }]);
    expect((await readRun("run-c")).commits).toEqual([{ sha: tagged, subject: "Finish it", attribution: "trailer" }]);
    expect((await readRun("run-live")).commits).toEqual([{ sha: "deadbeef", subject: "already", attribution: "start-head" }]);
    // The PRD-only commit and the merge went nowhere, though both sit inside run-a's window.
    const all = JSON.stringify(await Promise.all(["run-a", "run-b", "run-c"].map(readRun)));
    expect(all).not.toContain(prd);
    expect(all).not.toContain("Merge branch");

    // Idempotent: a second pass has nothing to fill and changes nothing.
    const before = await readFile(join(runsDir, "run-a.json"), "utf-8");
    await cmdBackfillCommits(dir, {});
    expect(await readFile(join(runsDir, "run-a.json"), "utf-8")).toBe(before);
  });

  it("refuses a ref that names no commit", async () => {
    commitAt("a.txt", "start", at(0));
    await expect(cmdBackfillCommits(dir, { ref: "no-such-branch" })).rejects.toThrow(/does not name a commit/);
  });
});

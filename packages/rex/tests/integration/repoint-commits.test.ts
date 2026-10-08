/**
 * Recorded SHAs that a rebase, cherry-pick or squash rewrote are re-pointed to
 * the commit they became on main. Runs against a real fixture repository; the
 * host seam is a fake, so nothing touches the network.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findTwin,
  indexMainCommits,
  repointCommits,
  type CommitFacts,
  type CommitHost,
} from "../../src/core/repoint-commits.js";

const ITEM = "9f1c2a3b-0000-4000-8000-0000000000c1";

let root: string;
let repo: string;
let clock = 0;

/**
 * Run git with a fixed, increasing clock. `keepAuthorDate` sets only the
 * committer date, so a rebase or cherry-pick keeps the original author date
 * as it does outside a test.
 */
function git(args: string[], keepAuthorDate = false): string {
  clock += 1;
  const date = new Date(Date.UTC(2026, 9, 1, 0, clock)).toISOString();
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_COMMITTER_DATE: date };
  if (keepAuthorDate) delete env.GIT_AUTHOR_DATE;
  else env.GIT_AUTHOR_DATE = date;
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function commit(file: string, message: string, content = `${file} ${clock}\n`): Promise<string> {
  await writeFile(join(repo, file), content, "utf-8");
  git(["add", file]);
  const msgFile = join(root, `msg-${clock}.txt`);
  await writeFile(msgFile, message, "utf-8");
  git(["commit", "-q", "-F", msgFile]);
  return git(["rev-parse", "HEAD"]);
}

const head = () => git(["rev-parse", "HEAD"]);

/** The fixture: one recorded SHA per scenario, and the commit each became on main. */
const sha: Record<string, string> = {};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rex-repoint-"));
  repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "commit.gpgsign", "false"]);

  const base = await commit("base.txt", "Initial commit");
  sha.onMain = await commit("on-main.txt", "Already landed");

  // Rebased: written on a branch, then rebased onto a moved main and merged.
  git(["checkout", "-q", "-b", "rebased", base]);
  sha.rebased = await commit("rebased.txt", "Rebased work");
  git(["checkout", "-q", "main"]);
  await commit("moves-main.txt", "Main moves on");
  git(["checkout", "-q", "-b", "rebased-copy", "rebased"]);
  git(["rebase", "-q", "main"], true);
  sha.rebasedNew = head();
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--no-ff", "-m", "Merge rebased", "rebased-copy"]);

  // Cherry-picked onto main from a hotfix branch.
  git(["checkout", "-q", "-b", "hotfix", base]);
  sha.picked = await commit("hotfix.txt", "Fix the thing");
  git(["checkout", "-q", "main"]);
  git(["cherry-pick", "-x", sha.picked], true);
  sha.pickedNew = head();

  // A one-commit branch squash-merged under the pull request's title.
  git(["checkout", "-q", "-b", "squash-one", base]);
  sha.squashOne = await commit("squash-one.txt", "Small feature");
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--squash", "squash-one"]);
  git(["commit", "-q", "-m", "Small feature (#12)"]);
  sha.squashOneNew = head();

  // A two-commit branch squash-merged: only the host can say where it went.
  git(["checkout", "-q", "-b", "squash-two", base]);
  sha.squashTwoA = await commit("squash-two-a.txt", "Big feature, part A");
  sha.squashTwoB = await commit("squash-two-b.txt", "Big feature, part B");
  git(["checkout", "-q", "main"]);
  git(["merge", "-q", "--squash", "squash-two"]);
  git(["commit", "-q", "-m", "Big feature (#13)"]);
  sha.squashTwoNew = head();

  // Re-authored with a different diff: only the trailer and subject survive.
  git(["checkout", "-q", "-b", "reworked", base]);
  sha.reworked = await commit("reworked.txt", `Wire the thing\n\nN-DX-Item: ${ITEM}\n`, "first try\n");
  git(["checkout", "-q", "main"]);
  sha.reworkedNew = await commit("reworked.txt", `Wire the thing\n\nN-DX-Item: http://localhost:3117/#/rex/item/${ITEM}\n`, "second try\n");

  // Never merged.
  git(["checkout", "-q", "-b", "abandoned", base]);
  sha.abandoned = await commit("abandoned.txt", "Abandoned idea");
  git(["checkout", "-q", "main"]);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fakeHost(table: Record<string, string[]>): CommitHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async mergeCommitsFor(s) {
      calls.push(s);
      return table[s] ?? [];
    },
  };
}

describe("repointCommits from git alone", () => {
  it("re-points each rewritten SHA and names the rule that matched", async () => {
    const result = await repointCommits(
      [sha.onMain, sha.rebased, sha.picked, sha.squashOne, sha.reworked],
      { repoDir: repo, ref: "main" },
    );
    expect(result.unmatched).toEqual([]);
    expect(result.matched).toEqual([
      { old: sha.onMain, new: sha.onMain, rule: "on-main" },
      { old: sha.rebased, new: sha.rebasedNew, rule: "author-date-subject" },
      { old: sha.picked, new: sha.pickedNew, rule: "author-date-subject" },
      { old: sha.squashOne, new: sha.squashOneNew, rule: "patch-id" },
      { old: sha.reworked, new: sha.reworkedNew, rule: "trailer-subject" },
    ]);
  });

  it("returns a never-merged commit, a multi-commit squash and an unknown SHA as unmatched with reasons", async () => {
    const missing = "0123456789abcdef0123456789abcdef01234567";
    const result = await repointCommits([sha.abandoned, sha.squashTwoA, missing, "not-a-sha"], { repoDir: repo, ref: "main" });
    expect(result.matched).toEqual([]);
    expect(result.unmatched.map((m) => m.sha)).toEqual([sha.abandoned, sha.squashTwoA, missing, "not-a-sha"]);
    const reasons = Object.fromEntries(result.unmatched.map((m) => [m.sha, m.reason]));
    expect(reasons[sha.abandoned]).toMatch(/no commit on main matches it.*no host lookup configured/);
    expect(reasons[sha.squashTwoA]).toMatch(/no commit on main matches it/);
    expect(reasons[missing]).toMatch(/not in this repository; no host lookup configured/);
    expect(reasons["not-a-sha"]).toBe("not a commit SHA");
  });

  it("resolves an abbreviated SHA and reports the full one", async () => {
    const result = await repointCommits([sha.rebased.slice(0, 12)], { repoDir: repo, ref: "main" });
    expect(result.matched).toEqual([{ old: sha.rebased.slice(0, 12), new: sha.rebasedNew, rule: "author-date-subject" }]);
  });
});

describe("repointCommits with the host seam", () => {
  it("resolves a multi-commit squash through the pull request's merge commit, after git rules fail", async () => {
    const host = fakeHost({ [sha.squashTwoA]: [sha.squashTwoNew], [sha.squashTwoB]: [sha.squashTwoNew] });
    const result = await repointCommits([sha.squashTwoA, sha.squashTwoB, sha.rebased], { repoDir: repo, ref: "main", host });
    expect(result.matched).toEqual([
      { old: sha.squashTwoA, new: sha.squashTwoNew, rule: "host-pull-request" },
      { old: sha.squashTwoB, new: sha.squashTwoNew, rule: "host-pull-request" },
      { old: sha.rebased, new: sha.rebasedNew, rule: "author-date-subject" },
    ]);
    expect(host.calls).toEqual([sha.squashTwoA, sha.squashTwoB]);
  });

  it("asks the host about a SHA no longer in the repository", async () => {
    const gone = "fedcba9876543210fedcba9876543210fedcba98";
    const result = await repointCommits([gone], { repoDir: repo, ref: "main", host: fakeHost({ [gone]: [sha.squashOneNew] }) });
    expect(result.matched).toEqual([{ old: gone, new: sha.squashOneNew, rule: "host-pull-request" }]);
  });

  it("keeps a never-merged commit unmatched when the host names no pull request", async () => {
    const result = await repointCommits([sha.abandoned], { repoDir: repo, ref: "main", host: fakeHost({}) });
    expect(result.unmatched).toEqual([
      { sha: sha.abandoned, reason: expect.stringMatching(/the host names no merged pull request that contained it$/) },
    ]);
  });

  it("refuses a host merge commit that is not on main", async () => {
    const result = await repointCommits([sha.abandoned], {
      repoDir: repo, ref: "main", host: fakeHost({ [sha.abandoned]: [sha.abandoned] }),
    });
    expect(result.unmatched[0].reason).toMatch(/not on main here/);
  });

  it("reports a failing host lookup as the reason, not an exception", async () => {
    const host: CommitHost = { mergeCommitsFor: async () => { throw new Error("rate limited"); } };
    const result = await repointCommits([sha.abandoned], { repoDir: repo, ref: "main", host });
    expect(result.unmatched[0].reason).toMatch(/host lookup failed: rate limited$/);
  });
});

describe("findTwin", () => {
  const facts = (hash: string, over: Partial<CommitFacts> = {}): CommitFacts => ({
    hash, authorEmail: "dev@example.com", authorDate: "2026-10-01T00:01:00Z", subject: "Same", items: [], ...over,
  });

  it("treats several twins as ambiguous rather than picking one", () => {
    const index = indexMainCommits([facts("a"), facts("b")]);
    expect(findTwin(facts("old"), index)).toEqual({ ambiguous: 2 });
  });

  it("matches author email case-insensitively and requires the same author date", () => {
    const index = indexMainCommits([facts("a", { authorEmail: "Dev@Example.com" }), facts("b", { authorDate: "2026-10-02T00:00:00Z" })]);
    expect(findTwin(facts("old"), index)).toEqual({ hash: "a" });
  });
});

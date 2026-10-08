/**
 * When a change landed on main is worked out from git history alone: merge
 * commit, fast-forward, rebase and squash, on a real fixture repository.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { V2Tree } from "../../src/schema/v2-rules.js";
import {
  CHANGE_LANDING_CACHE_FILENAME,
  computeLanding,
  computeLandings,
  firstReleaseContaining,
  resolveShippedIn,
} from "../../src/core/change-landing.js";

const MERGED = "9f1c2a3b-0000-4000-8000-0000000000a1";
const MERGED_TASK = "9f1c2a3b-0000-4000-8000-0000000000a2";
const FAST = "9f1c2a3b-0000-4000-8000-0000000000b1";
const SQUASHED = "9f1c2a3b-0000-4000-8000-0000000000c1";
const REBASED = "9f1c2a3b-0000-4000-8000-0000000000d1";
const permalink = (id: string) => `http://localhost:3117/#/rex/item/${id}`;
const trailer = (id: string) => `\n\nN-DX-Item: ${permalink(id)}`;

let repo: string;
let cacheDir: string;
let clock = 0;

function git(...args: string[]): string {
  clock += 1;
  const date = new Date(Date.UTC(2026, 9, 1, 0, clock)).toISOString();
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim();
}

async function commit(file: string, message: string): Promise<string> {
  await writeFile(join(repo, file), `${file} ${clock}\n`, "utf-8");
  git("add", file);
  const msgFile = join(repo, "..", `msg-${clock}.txt`);
  await writeFile(msgFile, message, "utf-8");
  git("commit", "-q", "-F", msgFile);
  return git("rev-parse", "HEAD");
}

const head = () => git("rev-parse", "HEAD");
const options = () => ({ repoDir: repo, cacheDir, ref: "main" });

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "rex-change-landing-"));
  repo = join(root, "repo");
  cacheDir = join(repo, ".ndx", "rex", ".cache");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  git("config", "commit.gpgsign", "false");
  await commit("base.txt", "Initial commit");
});

afterEach(async () => {
  await rm(join(repo, ".."), { recursive: true, force: true });
});

describe("computeLanding", () => {
  it("reports the merge commit for a merge-commit merge, whatever its message says", async () => {
    git("checkout", "-q", "-b", "feature");
    await commit("a.txt", `Add a${trailer(MERGED)}`);
    const last = await commit("a2.txt", `Add a2${trailer(MERGED_TASK)}`);
    git("checkout", "-q", "main");
    await commit("other.txt", "Unrelated work on main");
    // A Bitbucket-style merge message: no PR description, nothing to parse.
    git("merge", "--no-ff", "-q", "-m", "Merged in feature (pull request #7)", "feature");
    const merge = head();
    await commit("after.txt", "Later work");

    const landing = await computeLanding([MERGED, MERGED_TASK], options());
    expect(landing).toEqual({ landed: true, commit: merge, lastCommit: last });
  });

  it("reports the merge commit under a differently worded merge message", async () => {
    git("checkout", "-q", "-b", "feature");
    await commit("a.txt", `Add a${trailer(MERGED)}`);
    git("checkout", "-q", "main");
    await commit("other.txt", "Unrelated work on main");
    git("merge", "--no-ff", "-q", "-m", "Merge pull request #9 from org/feature\n\nA long description.", "feature");
    expect(await computeLanding([MERGED], options())).toMatchObject({ landed: true, commit: head() });
  });

  it("reports the commit itself for a fast-forward merge", async () => {
    git("checkout", "-q", "-b", "quick");
    await commit("f1.txt", `First${trailer(FAST)}`);
    const tip = await commit("f2.txt", `Second${trailer(FAST)}`);
    git("checkout", "-q", "main");
    git("merge", "--ff-only", "-q", "quick");

    expect(await computeLanding([FAST], options())).toEqual({ landed: true, commit: tip, lastCommit: tip });
  });

  it("lands with the newest of a change's commits", async () => {
    git("checkout", "-q", "-b", "first");
    await commit("a.txt", `Add a${trailer(MERGED)}`);
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", "-m", "merge first", "first");
    git("checkout", "-q", "-b", "second");
    const task = await commit("b.txt", `Add b${trailer(MERGED_TASK)}`);
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", "-m", "merge second", "second");

    expect(await computeLanding([MERGED, MERGED_TASK], options())).toEqual({ landed: true, commit: head(), lastCommit: task });
  });

  it("reports a squash-merged change as not reachable from main, with the reason", async () => {
    git("checkout", "-q", "-b", "squashed");
    await commit("s1.txt", `Part one${trailer(SQUASHED)}`);
    await commit("s2.txt", `Part two${trailer(SQUASHED)}`);
    git("checkout", "-q", "main");
    git("merge", "--squash", "-q", "squashed");
    git("commit", "-q", "-m", "Squashed feature (#12)");

    const landing = await computeLanding([SQUASHED], options());
    expect(landing.landed).toBe(false);
    if (!landing.landed) expect(landing.reason).toMatch(/reachable from main.*squash/);
  });

  it("reports the landing of the rewritten copy when the change was rebased", async () => {
    git("checkout", "-q", "-b", "topic");
    const original = await commit("r.txt", `Rebased work${trailer(REBASED)}`);
    git("checkout", "-q", "main");
    await commit("other.txt", "Moved main on");
    git("cherry-pick", original);
    const twin = head();
    expect(twin).not.toBe(original);

    expect(await computeLanding([REBASED], options())).toEqual({ landed: true, commit: twin, lastCommit: twin });
  });

  it("caches landings under the cache dir and rebuilds when main moves", async () => {
    git("checkout", "-q", "-b", "feature");
    await commit("a.txt", `Add a${trailer(MERGED)}`);
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", "-m", "merge", "feature");
    const merge = head();
    await computeLanding([MERGED], options());

    const cache = JSON.parse(await readFile(join(cacheDir, CHANGE_LANDING_CACHE_FILENAME), "utf-8"));
    expect(cache.tip).toBe(merge);

    git("checkout", "-q", "-b", "next");
    await commit("n.txt", `Next${trailer(FAST)}`);
    git("checkout", "-q", "main");
    git("merge", "--ff-only", "-q", "next");
    expect(await computeLanding([FAST], options())).toMatchObject({ landed: true, commit: head() });
  });
});

describe("computeLandings", () => {
  it("reports each live change by its own, its tasks' and its aliases' trailers, and skips cancelled ones", async () => {
    git("checkout", "-q", "-b", "feature");
    await commit("a.txt", `Task work${trailer(MERGED_TASK)}`);
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", "-m", "merge", "feature");
    const merge = head();

    const node = (fields: Record<string, unknown>) => ({ title: String(fields.id), slug: String(fields.id), ...fields });
    const tree = {
      product: [],
      changes: [
        node({ id: MERGED, type: "change", children: [node({ id: MERGED_TASK, type: "task" })] }),
        node({ id: FAST, type: "change", aliases: [SQUASHED] }),
        node({ id: REBASED, type: "change", status: "cancelled" }),
      ],
    } as unknown as V2Tree;

    const landings = await computeLandings(tree, options());
    expect(Object.keys(landings).sort()).toEqual([MERGED, FAST].sort());
    expect(landings[MERGED]).toMatchObject({ landed: true, commit: merge });
    expect(landings[FAST]).toMatchObject({ landed: false });
  });
});

describe("resolveShippedIn", () => {
  async function landedChange() {
    git("checkout", "-q", "-b", "feature");
    await commit("a.txt", `Add a${trailer(MERGED)}`);
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", "-m", "merge", "feature");
    return computeLanding([MERGED], options());
  }

  it("prefers a stamped shippedIn", async () => {
    const landing = await landedChange();
    git("tag", "v0.9.0");
    expect(await resolveShippedIn({ shippedIn: "0.8.0" }, landing, repo)).toBe("0.8.0");
  });

  it("falls back to the first release tag containing the landing commit", async () => {
    git("tag", "v0.1.0"); // Before the change: does not contain it.
    const landing = await landedChange();
    git("tag", "v0.2.0-rc.1");
    git("tag", "not-a-release");
    git("tag", "v0.2.0");
    await commit("later.txt", "Later");
    git("tag", "0.3.0");

    expect(await resolveShippedIn({}, landing, repo)).toBe("0.2.0");
  });

  it("reads a changesets monorepo tag (<package>@X.Y.Z), skipping its prereleases", async () => {
    const landing = await landedChange();
    git("tag", "@n-dx/rex@0.9.0-next.0");
    git("tag", "@n-dx/rex@0.9.0");
    expect(await resolveShippedIn({}, landing, repo)).toBe("0.9.0");
  });

  it("is undefined when landed but unreleased, or not landed", async () => {
    const landing = await landedChange();
    expect(await resolveShippedIn({}, landing, repo)).toBeUndefined();
    expect(await resolveShippedIn({}, { landed: false, reason: "x" }, repo)).toBeUndefined();
    expect(await firstReleaseContaining(repo, landing.landed ? landing.commit : "")).toBeUndefined();
  });
});

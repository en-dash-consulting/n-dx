/**
 * Release tags and the release each commit first shipped in, read from a
 * real repository: one tag per version in creation order, the monorepo's
 * `<package>@X.Y.Z` tags folded to one release, and the batch answer equal
 * to `firstReleaseContaining` for every commit. The trailer scan carries the
 * commit's subject.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { firstReleaseContaining, listReleaseTags, releasesContaining } from "../../../src/core/change-landing.js";
import { scanTrailerCommits } from "../../../src/core/change-commits.js";

let repo: string;
let clock = 0;

function git(...args: string[]): string {
  clock += 1;
  const date = new Date(Date.UTC(2026, 9, 1, 0, clock)).toISOString();
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf-8",
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@test", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@test" },
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

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "rex-landing-"));
  repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--initial-branch=main", repo]);
});

afterEach(async () => {
  await rm(join(repo, ".."), { recursive: true, force: true });
});

describe("listReleaseTags", () => {
  it("lists one release per version in creation order, from plain, v-prefixed and monorepo tags", async () => {
    await commit("a.txt", "first");
    git("tag", "@shop/core@1.0.0");
    git("tag", "@shop/web@1.0.0");
    await commit("b.txt", "second");
    git("tag", "-a", "v1.1.0", "-m", "annotated");
    const third = await commit("c.txt", "third");
    git("tag", "1.2.0");
    git("tag", "v1.3.0-rc.1");
    git("tag", "not-a-release");

    const tags = await listReleaseTags(repo);
    expect(tags.map((t) => t.version)).toEqual(["1.0.0", "1.1.0", "1.2.0"]);
    expect(tags.map((t) => t.tag)).toEqual(["@shop/core@1.0.0", "v1.1.0", "1.2.0"]);
    expect(tags[2].commit).toBe(third);
    // An annotated tag names the commit it points at, not the tag object.
    expect(tags[1].commit).toBe(git("rev-parse", "v1.1.0^{commit}"));
    for (const tag of tags) expect(tag.createdAt).toMatch(/^2026-10-01T/);
  });

  it("is empty for a repository without release tags", async () => {
    await commit("a.txt", "first");
    expect(await listReleaseTags(repo)).toEqual([]);
  });
});

describe("releasesContaining", () => {
  it("answers for every commit what firstReleaseContaining answers for one", async () => {
    const first = await commit("a.txt", "first");
    git("tag", "v1.0.0");
    git("checkout", "-q", "-b", "feature");
    const branch = await commit("f.txt", "on a branch");
    git("checkout", "-q", "main");
    git("merge", "--no-ff", "-q", "-m", "Merge feature", "feature");
    const merge = git("rev-parse", "HEAD");
    git("tag", "v1.1.0");
    const unreleased = await commit("z.txt", "after the last tag");

    const tags = await listReleaseTags(repo);
    const commits = new Set([first, branch, merge, unreleased]);
    const batch = await releasesContaining(repo, tags, commits);
    expect(batch.get(first)).toBe("1.0.0");
    expect(batch.get(branch)).toBe("1.1.0");
    expect(batch.get(merge)).toBe("1.1.0");
    expect(batch.has(unreleased)).toBe(false);
    for (const sha of commits) expect(batch.get(sha)).toBe(await firstReleaseContaining(repo, sha));
  });

  it("is empty without tags or without commits, and reads git for neither", async () => {
    await commit("a.txt", "first");
    expect(await releasesContaining(repo, [], new Set(["deadbeef"]))).toEqual(new Map());
    expect(await releasesContaining(repo, await listReleaseTags(repo), new Set())).toEqual(new Map());
  });
});

describe("scanTrailerCommits", () => {
  it("carries each trailer commit's subject", async () => {
    const id = "c0000000-0000-4000-8000-000000000001";
    await commit("a.txt", "no trailer here");
    const sha = await commit("b.txt", `Add Apple Pay\n\nThe body.\n\nN-DX-Item: ${id}`);
    const commits = await scanTrailerCommits(repo, "main");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ hash: sha, subject: "Add Apple Pay", items: [id], author: "Test" });
  });
});

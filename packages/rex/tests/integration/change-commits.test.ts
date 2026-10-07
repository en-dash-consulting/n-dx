/**
 * A change's commits come from N-DX-Item trailers on commits reachable from
 * main, not from stored SHAs. Runs against a real fixture repository.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CHANGE_COMMITS_CACHE_FILENAME,
  computeChangeCommits,
  itemIdFromTrailer,
} from "../../src/core/change-commits.js";

const CHANGE = "9f1c2a3b-0000-4000-8000-0000000000c1";
const TASK = "9f1c2a3b-0000-4000-8000-0000000000t1";
const OTHER = "9f1c2a3b-0000-4000-8000-0000000000o1";
const permalink = (id: string) => `http://localhost:3117/#/rex/item/${id}`;

let repo: string;
let cacheDir: string;
let clock = 0;

function git(...args: string[]): string {
  // A fixed, increasing clock keeps `git log` order deterministic.
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

const hashes = (commits: { hash: string }[]) => commits.map((c) => c.hash);

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "rex-change-commits-"));
  repo = join(root, "repo");
  cacheDir = join(root, "repo", ".ndx", "rex", ".cache");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "dev@example.com");
  git("config", "user.name", "Dev");
  git("config", "commit.gpgsign", "false");
});

afterEach(async () => {
  await rm(join(repo, ".."), { recursive: true, force: true });
});

describe("itemIdFromTrailer", () => {
  it("reads the permalink form from any host and the bare id form", () => {
    expect(itemIdFromTrailer(permalink(CHANGE))).toBe(CHANGE);
    expect(itemIdFromTrailer(`https://ndx.example.org/base/#/rex/item/${TASK}`)).toBe(TASK);
    expect(itemIdFromTrailer(`  ${TASK} `)).toBe(TASK);
  });

  it("ignores values that name no item", () => {
    expect(itemIdFromTrailer("https://example.com/pulls/12")).toBeUndefined();
    expect(itemIdFromTrailer("two words")).toBeUndefined();
    expect(itemIdFromTrailer("")).toBeUndefined();
  });
});

describe("computeChangeCommits", () => {
  /** main with a merged feature branch, a rebased unmerged copy, and unrelated commits. */
  async function buildFixture() {
    await commit("base.txt", "Initial commit");
    git("checkout", "-q", "-b", "feat");
    const viaPermalink = await commit("a.txt", `Do part A\n\nN-DX-Item: ${permalink(CHANGE)}\n`);
    const viaBareId = await commit("b.txt", `Do part B\n\nCo-Authored-By: Dev <dev@example.com>\nN-DX-Item: ${TASK}\n`);
    git("checkout", "-q", "main");
    const unrelated = await commit("u.txt", `Unrelated work\n\nN-DX-Item: ${permalink(OTHER)}\n`);
    const untrailered = await commit("v.txt", `Mentions ${CHANGE} in the subject only`);
    // The merge commit names the change in its body, but not in a trailer block.
    const mergeMsg = join(repo, "..", "merge-msg.txt");
    await writeFile(mergeMsg, `Merge feat\n\nN-DX-Item: ${CHANGE}\n\nThis paragraph ends the message, so the line above is body text.\n`);
    git("merge", "-q", "--no-ff", "-F", mergeMsg, "feat");
    const merge = git("rev-parse", "HEAD");
    // A rebased copy of part A on a branch that never merged.
    git("checkout", "-q", "-b", "stack", `${viaPermalink}~1`);
    git("cherry-pick", viaPermalink);
    const rebasedCopy = git("rev-parse", "HEAD");
    git("checkout", "-q", "main");
    return { viaPermalink, viaBareId, unrelated, untrailered, merge, rebasedCopy };
  }

  it("returns exactly the change's commits reachable from main, for both trailer forms", async () => {
    const f = await buildFixture();
    expect(f.rebasedCopy).not.toBe(f.viaPermalink);

    const commits = await computeChangeCommits([CHANGE, TASK], { repoDir: repo, cacheDir });
    expect(hashes(commits).sort()).toEqual([f.viaPermalink, f.viaBareId].sort());
    expect(commits.find((c) => c.hash === f.viaBareId)).toMatchObject({
      author: "Dev",
      authorEmail: "dev@example.com",
      items: [TASK],
      parents: [f.viaPermalink],
    });

    // The change alone, and an unrelated item, each get only their own commits.
    expect(hashes(await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir }))).toEqual([f.viaPermalink]);
    expect(hashes(await computeChangeCommits([OTHER], { repoDir: repo, cacheDir }))).toEqual([f.unrelated]);
  });

  it("reads commits from the named ref, so an unmerged rebased copy counts only there", async () => {
    const f = await buildFixture();
    const onStack = await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir, ref: "stack" });
    expect(hashes(onStack)).toEqual([f.rebasedCopy]);
  });

  it("caches under the cache dir, keyed by the ref tip, and rebuilds when missing or stale", async () => {
    const f = await buildFixture();
    const cacheFile = join(cacheDir, CHANGE_COMMITS_CACHE_FILENAME);
    await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir });
    const cached = JSON.parse(await readFile(cacheFile, "utf-8"));
    expect(cached).toMatchObject({ ref: "main", tip: f.merge });

    // A missing or unreadable cache is rebuilt from git.
    await rm(cacheFile);
    expect(hashes(await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir }))).toEqual([f.viaPermalink]);
    await stat(cacheFile);
    await writeFile(cacheFile, "{ torn", "utf-8");
    expect(hashes(await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir }))).toEqual([f.viaPermalink]);

    // A new commit on main moves the tip, and the next lookup sees it.
    const later = await commit("c.txt", `Follow-up\n\nN-DX-Item: ${CHANGE}\n`);
    expect(hashes(await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir }))).toEqual([later, f.viaPermalink]);
    expect(JSON.parse(await readFile(cacheFile, "utf-8")).tip).toBe(later);
  });

  it("serves a current cache without rescanning git", async () => {
    const f = await buildFixture();
    await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir });
    const cacheFile = join(cacheDir, CHANGE_COMMITS_CACHE_FILENAME);
    const cached = JSON.parse(await readFile(cacheFile, "utf-8"));
    // Only a cache hit can return a commit git never produced.
    const marker = { hash: "f".repeat(40), parents: [], author: "C", authorEmail: "c@x", timestamp: "t", items: [CHANGE] };
    await writeFile(cacheFile, JSON.stringify({ ...cached, commits: [marker] }), "utf-8");
    expect(hashes(await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir }))).toEqual([marker.hash]);
    expect(f.merge).toBe(cached.tip);
  });

  it("ignores log.showSignature, whose output for signed commits would corrupt the scan", async (ctx) => {
    await commit("base.txt", "Initial commit");
    const key = join(repo, "..", "signing-key");
    try {
      execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key], { stdio: "ignore" });
    } catch {
      ctx.skip(); // No ssh-keygen: SSH commit signing cannot be set up on this host.
    }
    git("config", "gpg.format", "ssh");
    git("config", "user.signingkey", `${key}.pub`);
    git("config", "log.showSignature", "true");
    const signed = async (file: string, id: string) => {
      await writeFile(join(repo, file), file, "utf-8");
      git("add", file);
      git("commit", "-q", "-S", "-m", `Signed\n\nN-DX-Item: ${id}`);
      return git("rev-parse", "HEAD");
    };
    const first = await signed("s1.txt", CHANGE);
    const second = await signed("s2.txt", TASK);
    const commits = await computeChangeCommits([CHANGE, TASK], { repoDir: repo, cacheDir });
    expect(hashes(commits)).toEqual([second, first]);
  });

  describe("default ref", () => {
    const landedMessage = `Part A\n\nN-DX-Item: ${CHANGE}\n`;

    /** A clone of `repo` (the origin). */
    function cloneOrigin(): string {
      const dir = join(repo, "..", "clone");
      execFileSync("git", ["clone", "-q", repo, dir]);
      return dir;
    }
    const inClone = (dir: string, ...args: string[]) =>
      execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();

    it("reads origin/main when the checkout has no local main", async () => {
      await commit("base.txt", "Initial commit");
      const landed = await commit("a.txt", landedMessage);
      const dir = cloneOrigin();
      inClone(dir, "checkout", "-q", "--detach", "origin/main");
      inClone(dir, "branch", "-D", "main");
      expect(() => inClone(dir, "rev-parse", "--verify", "main")).toThrow();

      const commits = await computeChangeCommits([CHANGE], { repoDir: dir, cacheDir });
      expect(hashes(commits)).toEqual([landed]);
    });

    it("prefers origin/main over a local main that is behind it", async () => {
      await commit("base.txt", "Initial commit");
      const dir = cloneOrigin();
      const landed = await commit("a.txt", landedMessage);
      inClone(dir, "fetch", "-q", "origin");
      expect(inClone(dir, "rev-parse", "main")).not.toBe(landed);

      expect(hashes(await computeChangeCommits([CHANGE], { repoDir: dir, cacheDir }))).toEqual([landed]);
    });

    it("falls back to a local main when there is no remote", async () => {
      await commit("base.txt", "Initial commit");
      const landed = await commit("a.txt", landedMessage);
      expect(hashes(await computeChangeCommits([CHANGE], { repoDir: repo, cacheDir }))).toEqual([landed]);
    });

    it("lets an explicit ref override the default", async () => {
      await commit("base.txt", "Initial commit");
      const dir = cloneOrigin();
      const landed = await commit("a.txt", landedMessage);
      inClone(dir, "fetch", "-q", "origin");

      expect(await computeChangeCommits([CHANGE], { repoDir: dir, cacheDir, ref: "main" })).toEqual([]);
      expect(hashes(await computeChangeCommits([CHANGE], { repoDir: dir, cacheDir, ref: "origin/main" }))).toEqual([landed]);
    });

    it("names the candidates when none resolves", async () => {
      await expect(computeChangeCommits([CHANGE], { repoDir: repo, cacheDir })).rejects.toThrow(/origin\/HEAD, origin\/main, main/);
    });

    it("keeps git's reason when the directory is not a repository", async () => {
      const notRepo = join(repo, "..", "plain");
      await mkdir(notRepo);
      await expect(computeChangeCommits([CHANGE], { repoDir: notRepo, cacheDir })).rejects.toThrow(/not a git repository/i);
    });
  });

  it("refuses a shallow clone, naming how to deepen it", async () => {
    await commit("base.txt", "Initial commit");
    await commit("a.txt", `Part A\n\nN-DX-Item: ${CHANGE}\n`);
    await commit("b.txt", "Later");
    const dir = join(repo, "..", "shallow");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${repo}`, dir]);
    await expect(computeChangeCommits([CHANGE], { repoDir: dir, cacheDir })).rejects.toThrow(
      /shallow clone.*git fetch --unshallow.*fetch-depth: 0/s,
    );
    execFileSync("git", ["fetch", "-q", "--unshallow"], { cwd: dir });
    expect(await computeChangeCommits([CHANGE], { repoDir: dir, cacheDir })).toHaveLength(1);
  });

  it("names the ref when it does not resolve", async () => {
    await commit("base.txt", "Initial commit");
    await expect(computeChangeCommits([CHANGE], { repoDir: repo, cacheDir, ref: "no-such-branch" })).rejects.toThrow(/git rev-parse failed/);
  });
});

/**
 * `rex branch add|remove|show` against the built CLI, in a real git repository
 * holding the v2 fixture tree: the set is written on a feature branch, refused
 * on the default branch and a detached HEAD, and nothing is committed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FIXTURE_TASK, copyV2Fixture } from "../helpers/v2-fixture.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf-8" }).trim();
const rex = (...args: string[]) => spawnSync("node", [cliPath, "branch", ...args, dir], { encoding: "utf-8", timeout: 20000 });
const commitCount = () => Number(git("rev-list", "--count", "HEAD"));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rex-e2e-branch-"));
  await copyV2Fixture(join(dir, ".rex"), "lf");
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("rex branch", () => {
  it("adds, shows and removes the current branch's set without committing", () => {
    git("checkout", "-q", "-b", "feat/apple-pay");

    const empty = rex("show");
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain("has no work set");

    const add = rex("add", "CH-1");
    expect(add.status, add.stderr).toBe(0);
    expect(add.stdout).toContain("Added to feat/apple-pay");
    expect(add.stdout).toContain("Wire the button");

    const show = rex("show");
    expect(show.stdout).toContain("CH-1  Add Apple Pay");
    expect(show.stdout).toContain("Wire the button  [pending]");

    const json = JSON.parse(rex("show", "--format=json").stdout);
    expect(json.branch).toBe("feat/apple-pay");
    expect(json.changes[0].units[0].id).toBe(FIXTURE_TASK);

    const again = rex("add", "CH-1");
    expect(again.stdout).toContain("Already on feat/apple-pay");

    const removed = rex("remove", "CH-1");
    expect(removed.status, removed.stderr).toBe(0);
    expect(removed.stdout).toContain("Removed from feat/apple-pay");
    expect(rex("show").stdout).toContain("has no work set");

    expect(commitCount()).toBe(1);
  });

  it("refuses a task on another branch unless --move, and names where it came from", () => {
    git("checkout", "-q", "-b", "feat/one");
    expect(rex("add", FIXTURE_TASK).status).toBe(0);
    git("checkout", "-q", "-b", "feat/two");

    const refused = rex("add", FIXTURE_TASK);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("feat/one");

    const moved = rex("add", FIXTURE_TASK, "--move");
    expect(moved.status, moved.stderr).toBe(0);
    expect(moved.stdout).toContain("moved from feat/one");

    // remove acts on this branch only
    git("checkout", "-q", "feat/one");
    expect(rex("remove", FIXTURE_TASK).stdout).toContain("Nothing to remove");
  });

  it("refuses on the default branch and on a detached HEAD", () => {
    for (const sub of [["add", "CH-1"], ["remove", "CH-1"], ["show"]]) {
      const onMain = rex(...sub);
      expect(onMain.status).not.toBe(0);
      expect(onMain.stderr).toContain("feature branch");
    }
    git("checkout", "-q", "--detach");
    const detached = rex("add", "CH-1");
    expect(detached.status).not.toBe(0);
    expect(detached.stderr).toContain("feature branch");
    expect(commitCount()).toBe(1);
  });
});

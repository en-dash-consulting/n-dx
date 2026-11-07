/**
 * `rex next` against the built CLI narrows selection to the current branch's
 * work set: only assigned units on a branch that has one, anything with
 * `--any`, and unchanged on the default branch and on a branch with no
 * assignment.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FIXTURE_TASK, copyV2Fixture } from "../helpers/v2-fixture.js";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");
/** A second, low-priority task in the fixture change: picked only through a work set. */
const LOW_TASK = "c0000000-0000-4000-8000-0000000000a1";

let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf-8" }).trim();
const rex = (...args: string[]) => spawnSync("node", [cliPath, ...args, dir], { encoding: "utf-8", timeout: 20000 });
const next = (...flags: string[]) => {
  const out = rex("next", "--format=json", ...flags);
  expect(out.status, out.stderr).toBe(0);
  return JSON.parse(out.stdout);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rex-e2e-next-work-set-"));
  await copyV2Fixture(join(dir, ".rex"), "lf");
  await writeFile(
    join(dir, ".rex", "changes", "add-apple-pay", "polish-the-sheet.md"),
    `---\nid: "${LOW_TASK}"\ntype: "task"\ntitle: "Polish the sheet"\nslug: "polish-the-sheet"\npriority: "low"\n---\n`,
  );
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("rex next with a branch work set", () => {
  it("is unchanged on the default branch and on a branch with no assignment", () => {
    expect(next().item.id).toBe(FIXTURE_TASK);
    git("checkout", "-q", "-b", "feat/polish");
    const unassigned = next();
    expect(unassigned.item.id).toBe(FIXTURE_TASK);
    expect(unassigned.workSetBranch).toBeUndefined();
  });

  it("picks only from the set, outside it with --any, and says when the set is spent", () => {
    git("checkout", "-q", "-b", "feat/polish");
    expect(rex("branch", "add", LOW_TASK).status).toBe(0);

    const inSet = next();
    expect(inSet.item.id).toBe(LOW_TASK);
    expect(inSet.workSetBranch).toBe("feat/polish");
    expect(next("--any").item.id).toBe(FIXTURE_TASK);

    expect(rex("update", LOW_TASK, "--status=completed").status).toBe(0);
    const spent = rex("next");
    expect(spent.status, spent.stderr).toBe(0);
    expect(spent.stdout).toContain("Nothing left in this branch's work set; --any picks outside it");
    expect(next().item).toBeNull();
    expect(next("--any").item.id).toBe(FIXTURE_TASK);

    git("checkout", "-q", "main");
    expect(next().item.id).toBe(FIXTURE_TASK);
  });
});

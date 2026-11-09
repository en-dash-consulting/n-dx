/**
 * A branch name used again after its first branch merged: the rows that
 * already named it where the new branch left the default branch belong to the
 * earlier branch, so the new one has no work set, and `rex branch show` and
 * `rex next` say the same thing in each state. Against the built CLI, in
 * temporary repositories.
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
const EARLIER_LINE = "1 task on feat/x comes from an earlier branch of this name; it is not in this branch's set";
const FINISHED = "This branch's work set is finished: all its tasks are done; selection stays narrowed to it, and --any picks outside it";

let dir: string;
const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf-8" }).trim();
const rex = (...args: string[]) => {
  const out = spawnSync("node", [cliPath, ...args, dir], { encoding: "utf-8", timeout: 20000 });
  expect(out.status, out.stderr).toBe(0);
  return out.stdout;
};
const json = (...args: string[]) => JSON.parse(rex(...args, "--format=json"));

async function init(defaultBranch: string): Promise<void> {
  await copyV2Fixture(join(dir, ".rex"), "lf");
  await writeFile(
    join(dir, ".rex", "changes", "add-apple-pay", "polish-the-sheet.md"),
    `---\nid: "${LOW_TASK}"\ntype: "task"\ntitle: "Polish the sheet"\nslug: "polish-the-sheet"\npriority: "low"\n---\n`,
  );
  git("init", "-q", "-b", defaultBranch);
  git("add", "-A");
  git("commit", "-q", "-m", "init");
}

/** Finish LOW_TASK on feat/x, merge feat/x into `base`, delete it and cut feat/x again. */
function finishMergeAndReuse(base: string): void {
  git("checkout", "-q", "-b", "feat/x");
  rex("branch", "add", LOW_TASK);
  rex("update", LOW_TASK, "--status=completed");
  git("add", "-A");
  git("commit", "-q", "-m", "finish");
  git("checkout", "-q", base);
  git("merge", "-q", "--no-ff", "-m", "merge feat/x", "feat/x");
  git("branch", "-q", "-D", "feat/x");
  git("checkout", "-q", "-b", "feat/x");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "rex-e2e-branch-earlier-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a work set and an earlier branch of the same name", () => {
  it("a branch cut again under a merged branch's name has no work set, and every reader says so", async () => {
    await init("main");
    finishMergeAndReuse("main");

    const show = rex("branch", "show");
    expect(show).toContain("Branch feat/x has no work set");
    expect(show).toContain(EARLIER_LINE);
    const shown = json("branch", "show");
    expect(shown).toMatchObject({ hasWorkSet: false, finished: false, changes: [], earlierUse: { branch: "feat/x", ids: [LOW_TASK] } });

    const next = json("next");
    expect(next.item.id).toBe(FIXTURE_TASK);
    expect(next.workSetBranch).toBeUndefined();
    expect(next.earlierUse).toMatchObject({ ids: [LOW_TASK], message: EARLIER_LINE });
    const text = rex("next");
    expect(text).toContain(EARLIER_LINE);
    expect(text).not.toContain("work set is finished");
    expect(text).not.toContain("Nothing left");
  });

  it("a set finished on this branch still narrows selection and says it is finished", async () => {
    await init("main");
    git("checkout", "-q", "-b", "feat/y");
    rex("branch", "add", LOW_TASK);
    rex("update", LOW_TASK, "--status=completed");

    expect(rex("branch", "show")).toContain(FINISHED);
    expect(json("branch", "show")).toMatchObject({ hasWorkSet: true, finished: true, changes: [] });
    const next = json("next");
    expect(next).toMatchObject({ item: null, workSetBranch: "feat/y", message: FINISHED });
    expect(next.earlierUse).toBeUndefined();
    expect(rex("next")).toContain(FINISHED);
    expect(json("next", "--any").item.id).toBe(FIXTURE_TASK);
  });

  it("a branch rebased onto a default branch that moved keeps its own set", async () => {
    await init("main");
    git("checkout", "-q", "-b", "feat/z");
    rex("branch", "add", LOW_TASK);
    git("add", "-A");
    git("commit", "-q", "-m", "assign");
    git("checkout", "-q", "main");
    await writeFile(join(dir, "README.md"), "moved\n");
    git("add", "-A");
    git("commit", "-q", "-m", "main moves");
    git("checkout", "-q", "feat/z");
    git("rebase", "-q", "main");

    const next = json("next");
    expect(next.item.id).toBe(LOW_TASK);
    expect(next.workSetBranch).toBe("feat/z");
    expect(next.earlierUse).toBeUndefined();
    expect(json("branch", "show")).toMatchObject({ hasWorkSet: true, finished: false });
    expect(rex("branch", "show")).toContain("Polish the sheet");
  });

  it("without a default branch to read the fork point from, every row counts, as before", async () => {
    await init("trunk");
    finishMergeAndReuse("trunk");

    expect(json("branch", "show")).toMatchObject({ hasWorkSet: true, finished: true });
    expect(json("next")).toMatchObject({ item: null, workSetBranch: "feat/x", message: FINISHED });
  });
});

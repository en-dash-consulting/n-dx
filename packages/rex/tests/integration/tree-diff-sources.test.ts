/**
 * `rex tree-diff` against real sources: git commits and sibling checkouts.
 *
 * The diff arithmetic is unit-tested in `tests/unit/core/tree-diff.test.ts`.
 * What this file covers is the part that can only be wrong against a real
 * repository — that the tree at a ref is read correctly, that reading it
 * leaves the caller's index and working tree alone, and that a ref from
 * before the PRD existed is reported as an absent tree rather than as a
 * thousand additions with no explanation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { cmdTreeDiff } from "../../src/cli/commands/tree-diff.js";
import {
  loadTreeAtRef,
  loadTreeFromDir,
  resolveAnchorRef,
  TreeSourceError,
} from "../../src/core/tree-source.js";
import { writePRD } from "../helpers/rex-dir-test-support.js";
import type { PRDDocument, PRDItem } from "../../src/schema/index.js";

const EPIC = "11111111-1111-4111-8111-111111111111";
const FEATURE_A = "22222222-2222-4222-8222-22222222222a";
const FEATURE_B = "22222222-2222-4222-8222-22222222222b";
const TASK_MOVES = "33333333-3333-4333-8333-333333333331";
const TASK_STAYS = "33333333-3333-4333-8333-333333333332";
const TASK_GOES = "33333333-3333-4333-8333-333333333333";
const TASK_ARRIVES = "33333333-3333-4333-8333-333333333334";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepo(dir: string): void {
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
}

function commitAll(dir: string, message: string): string {
  git(dir, "add", "-A");
  git(dir, "commit", "-m", message);
  return git(dir, "rev-parse", "HEAD");
}

function task(id: string, title: string, extra: Partial<PRDItem> = {}): PRDItem {
  return { id, title, level: "task", status: "pending", ...extra };
}

/** epic → (feature A: moves, stays, goes) with feature B empty. */
function before(): PRDDocument {
  return {
    schema: "rex/v1",
    title: "PRD",
    items: [
      {
        id: EPIC,
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: FEATURE_A,
            title: "Feature A",
            level: "feature",
            status: "pending",
            children: [
              task(TASK_MOVES, "Task that moves"),
              task(TASK_STAYS, "Task that stays"),
              task(TASK_GOES, "Task that goes"),
            ],
          },
          { id: FEATURE_B, title: "Feature B", level: "feature", status: "pending", children: [] },
        ],
      },
    ],
  };
}

/**
 * One item of each category relative to {@link before}: TASK_MOVES reparents
 * to Feature B, TASK_STAYS is renamed and completed, TASK_GOES is deleted,
 * TASK_ARRIVES is new.
 */
function after(): PRDDocument {
  return {
    schema: "rex/v1",
    title: "PRD",
    items: [
      {
        id: EPIC,
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: FEATURE_A,
            title: "Feature A",
            level: "feature",
            status: "pending",
            children: [
              task(TASK_STAYS, "Task that stays, renamed", { status: "completed" }),
              task(TASK_ARRIVES, "Task that arrives"),
            ],
          },
          {
            id: FEATURE_B,
            title: "Feature B",
            level: "feature",
            status: "pending",
            children: [task(TASK_MOVES, "Task that moves")],
          },
        ],
      },
    ],
  };
}

/** Run the command with JSON output and return the parsed payload. */
async function runJson(dir: string, flags: Record<string, string>): Promise<Record<string, any>> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    await cmdTreeDiff(dir, { ...flags, json: "true" });
  } finally {
    console.log = original;
  }
  return JSON.parse(lines.join("\n"));
}

describe("tree-diff against git refs", () => {
  let dir: string;
  let firstSha: string;
  let secondSha: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-tree-diff-git-"));
    initRepo(dir);

    // A commit with no PRD at all, so the "ref predates the tree" case has a
    // real ref to point at rather than a synthesised one.
    await writeFile(join(dir, "README.md"), "# fixture\n");
    firstSha = commitAll(dir, "before the PRD existed");

    writePRD(dir, before());
    secondSha = commitAll(dir, "add the PRD");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports every category between two commits, including the move", async () => {
    writePRD(dir, after());
    const thirdSha = commitAll(dir, "restructure");

    const out = await runJson(dir, { from: secondSha, to: thirdSha });

    expect(out.counts).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      completed: 1,
      moved: 1,
    });
    expect(out.added.map((e: any) => e.id)).toEqual([TASK_ARRIVES]);
    expect(out.removed.map((e: any) => e.id)).toEqual([TASK_GOES]);
    expect(out.changed.map((e: any) => e.id)).toEqual([TASK_STAYS]);
    expect(out.completed.map((e: any) => e.id)).toEqual([TASK_STAYS]);
    expect(out.moved.map((e: any) => e.id)).toEqual([TASK_MOVES]);
    expect(out.identical).toBe(false);
  });

  it("carries the ancestor chain on every category, and both chains on a move", async () => {
    writePRD(dir, after());
    const thirdSha = commitAll(dir, "restructure");

    const out = await runJson(dir, { from: secondSha, to: thirdSha });

    expect(out.added[0].ancestors.map((a: any) => a.title)).toEqual(["Epic", "Feature A"]);
    expect(out.removed[0].ancestors.map((a: any) => a.title)).toEqual(["Epic", "Feature A"]);
    expect(out.changed[0].ancestors.map((a: any) => a.title)).toEqual(["Epic", "Feature A"]);
    expect(out.moved[0].fromAncestors.map((a: any) => a.title)).toEqual(["Epic", "Feature A"]);
    expect(out.moved[0].ancestors.map((a: any) => a.title)).toEqual(["Epic", "Feature B"]);
  });

  it("reports a commit against itself as identical with empty categories", async () => {
    const out = await runJson(dir, { from: secondSha, to: secondSha });

    expect(out.identical).toBe(true);
    expect(out.counts).toEqual({ added: 0, removed: 0, changed: 0, completed: 0, moved: 0 });
    expect(out.added).toEqual([]);
    expect(out.removed).toEqual([]);
    expect(out.changed).toEqual([]);
    expect(out.completed).toEqual([]);
    expect(out.moved).toEqual([]);
  });

  it("defaults the target side to the working tree", async () => {
    writePRD(dir, after());
    // Deliberately not committed — the point is that the uncommitted tree is
    // what `--to` falls back to.
    const out = await runJson(dir, { from: secondSha });

    expect(out.sources.to.label).toBe("working tree");
    expect(out.counts.added).toBe(1);
    expect(out.counts.moved).toBe(1);
  });

  it("reports a ref from before the tree existed as absent, not as an empty tree", async () => {
    const out = await runJson(dir, { from: firstSha, to: secondSha });

    // The whole `before()` tree: one epic, two features, three tasks.
    expect(out.sources.from).toMatchObject({ present: false, items: 0 });
    expect(out.sources.to).toMatchObject({ present: true, items: 6 });
    expect(out.counts.added).toBe(6);
  });

  it("leaves the caller's index and working tree untouched", async () => {
    // GIT_INDEX_FILE is what keeps `git checkout -- <path>` from staging the
    // ref's version of every PRD file into the caller's real index. Without
    // it, `git commit` straight after a diff would commit the *baseline*
    // tree — 1,750 files on this repository.
    //
    // The ref being read has to differ from HEAD for this to prove anything.
    // Staging a blob the index already holds is a no-op that `git status`
    // cannot see, so an earlier version of this test — which read HEAD's own
    // tree — passed with the guard deleted. Here HEAD is `after()` and the
    // ref read is `before()`, so an unredirected index write shows up as
    // `M .rex/prd_tree/...`.
    writePRD(dir, after());
    commitAll(dir, "restructure");

    const statusBefore = git(dir, "status", "--porcelain");
    expect(statusBefore).toBe("");

    await runJson(dir, { from: secondSha, to: "HEAD" });

    expect(git(dir, "status", "--porcelain")).toBe(statusBefore);
    // Belt and braces: the index must still agree with HEAD, which is the
    // thing `git status` would report as staged if it did not.
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("");
  });

  it("refuses an unknown ref by name instead of diffing against nothing", async () => {
    await expect(runJson(dir, { from: "no-such-ref" })).rejects.toThrow(/no-such-ref/);
  });

  it("refuses --against combined with --from", async () => {
    await expect(runJson(dir, { from: secondSha, against: dir })).rejects.toThrow(
      /cannot be combined/,
    );
  });
});

describe("tree-diff against another checkout", () => {
  let anchorDir: string;
  let workDir: string;

  beforeEach(async () => {
    anchorDir = await mkdtemp(join(tmpdir(), "rex-tree-diff-anchor-"));
    workDir = await mkdtemp(join(tmpdir(), "rex-tree-diff-work-"));
    writePRD(anchorDir, before());
    writePRD(workDir, after());
  });

  afterEach(async () => {
    await rm(anchorDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  });

  it("diffs two directories with no git involved", async () => {
    const out = await runJson(workDir, { against: anchorDir });

    expect(out.sources.from.label).toBe(anchorDir);
    expect(out.sources.to.label).toBe("working tree");
    expect(out.counts).toEqual({
      added: 1,
      removed: 1,
      changed: 1,
      completed: 1,
      moved: 1,
    });
  });

  it("reports two identical checkouts as identical", async () => {
    writePRD(workDir, before());
    const out = await runJson(workDir, { against: anchorDir });
    expect(out.identical).toBe(true);
  });

  it("refuses an --against directory that has no PRD tree", async () => {
    const empty = await mkdtemp(join(tmpdir(), "rex-tree-diff-empty-"));
    try {
      await expect(runJson(workDir, { against: empty })).rejects.toThrow(/No PRD tree/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe("tree source resolution", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-tree-source-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a directory with no tree as absent rather than throwing", async () => {
    const tree = await loadTreeFromDir(dir, "nowhere");
    expect(tree.present).toBe(false);
    expect(tree.items).toEqual([]);
  });

  it("refuses a ref lookup outside a git repository", async () => {
    writePRD(dir, before());
    await expect(loadTreeAtRef(dir, "HEAD")).rejects.toBeInstanceOf(TreeSourceError);
  });

  it("resolves the anchor ref to a branch the repository actually has", async () => {
    initRepo(dir);
    writePRD(dir, before());
    commitAll(dir, "init");

    // No origin, so the fallback chain lands on the local default branch.
    expect(await resolveAnchorRef(dir)).toBe("main");
  });

  it("returns no anchor ref outside a git repository", async () => {
    expect(await resolveAnchorRef(dir)).toBeNull();
  });
});

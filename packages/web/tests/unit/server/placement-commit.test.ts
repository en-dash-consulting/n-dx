/**
 * The commit a best-guess placement makes of the PRD files it rewrote: its
 * message, its pathspec, and — against a real repository — that it commits
 * exactly those files and leaves the operator's own work, staged or not, alone.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { commitPlacements, placementMessage, placementPathspec, placementSubject } from "../../../src/server/placement-commit.js";

const one = { change: "c-1", changeTitle: "Fix the slider", targetTitle: "Dashboard on the v2 model" };
const two = { change: "c-2", changeTitle: "Stop the PUT spam", targetTitle: "Run controls" };

describe("placement commit message", () => {
  it("names a single change and its home in the subject", () => {
    expect(placementSubject([one])).toBe('chore(prd): place "Fix the slider" on Dashboard on the v2 model');
  });

  it("counts a batch, lists each change in the body, and ends in one trailer block", () => {
    expect(placementMessage([one, two])).toBe(
      "chore(prd): place 2 Inbox changes on their best guess\n\n"
        + "- Fix the slider → Dashboard on the v2 model\n"
        + "- Stop the PUT spam → Run controls\n\n"
        + "N-DX: web/place-best\nN-DX-Item: c-1\nN-DX-Item: c-2\n"
        + "Co-Authored-By: En Dash's n-dx <n-dx@endash.us>\n",
    );
  });
});

describe("placement pathspec", () => {
  it("is repo-relative, forward-slashed and literal, written and deleted files alike, without repeats", () => {
    const project = join(tmpdir(), "proj");
    const spec = placementPathspec(project, join(project, ".rex"), {
      written: ["changes/a/index.md", "changes/a/state.yaml"],
      deletedFiles: ["changes/inbox/a/index.md", "changes/a/index.md"],
    });
    expect(spec).toEqual([
      ":(literal).rex/changes/a/index.md",
      ":(literal).rex/changes/a/state.yaml",
      ":(literal).rex/changes/inbox/a/index.md",
    ]);
  });

  it("drops a file outside the project", () => {
    const project = join(tmpdir(), "proj");
    expect(placementPathspec(project, join(tmpdir(), "elsewhere"), { written: ["x.md"], deletedFiles: [] })).toEqual([]);
  });
});

describe("commitPlacements against a real repository", () => {
  let dir: string;
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
  const write = (rel: string, text: string) => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ndx-place-commit-test-"));
    git("init", "-q");
    git("config", "user.email", "test@test.com");
    git("config", "user.name", "Test");
    git("config", "core.autocrlf", "false");
    write(".rex/changes/inbox/a/index.md", "a\n");
    write(".rex/changes/inbox/b/index.md", "b\n");
    write("src.ts", "v1\n");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("commits the move out of the Inbox and nothing else, staged work included", async () => {
    // The placement: a leaves the Inbox.
    rmSync(join(dir, ".rex/changes/inbox/a"), { recursive: true });
    write(".rex/changes/a/index.md", "a\n");
    // The operator's own work: an edit, a staged edit, and an unrelated PRD edit.
    write("src.ts", "v2\n");
    write("notes.md", "staged\n");
    git("add", "notes.md");
    write(".rex/changes/inbox/b/index.md", "b edited\n");

    const outcome = await commitPlacements(dir, join(dir, ".rex"), {
      written: ["changes/a/index.md"],
      deletedFiles: ["changes/inbox/a/index.md"],
    }, [one]);

    expect(outcome).toEqual({ sha: git("rev-parse", "--short", "HEAD").trim() });
    expect(git("log", "-1", "--pretty=%s").trim()).toBe('chore(prd): place "Fix the slider" on Dashboard on the v2 model');
    expect(git("log", "-1", "--pretty=%(trailers:key=N-DX-Item,valueonly)").trim()).toBe("c-1");
    // Both sides of the move are in the commit (git would show it as one rename).
    expect(git("show", "--name-status", "--no-renames", "--pretty=", "HEAD").trim().split("\n").sort()).toEqual([
      "A\t.rex/changes/a/index.md",
      "D\t.rex/changes/inbox/a/index.md",
    ]);
    // Everything else is as the operator left it: notes.md still staged, the rest unstaged.
    expect(git("status", "--porcelain").split("\n").filter(Boolean).sort()).toEqual([
      " M .rex/changes/inbox/b/index.md",
      " M src.ts",
      "A  notes.md",
    ]);
  });

  it("says why when the project is not a git repository, and never throws", async () => {
    const plain = mkdtempSync(join(tmpdir(), "ndx-place-commit-plain-"));
    try {
      const outcome = await commitPlacements(plain, join(plain, ".rex"), { written: ["changes/a/index.md"], deletedFiles: [] }, [one]);
      expect(outcome).toEqual({ skipped: "the project is not a git repository" });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("commits nothing when nothing was placed", async () => {
    expect(await commitPlacements(dir, join(dir, ".rex"), { written: [], deletedFiles: [] }, [])).toEqual({ skipped: "nothing was placed" });
    expect(git("log", "--oneline").trim().split("\n")).toHaveLength(1);
  });
});

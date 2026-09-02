/**
 * Tests for review-repairs — the snapshot/diff/commit machinery that keeps
 * adversarial-review repairs from being orphaned on the autoCommit path.
 *
 * The scenario under test is the one observed live (run 4b4526c5): the
 * executor commits its own work, the reviewer then edits files in-session,
 * and nothing downstream commits those edits. The snapshot pair brackets the
 * reviewer spawn so exactly its changes — never pre-existing user dirt — are
 * identified and committed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { initGitFixtureRepoSync } from "../../helpers/index.js";
import {
  snapshotDirtyState,
  diffDirtyState,
  commitReviewRepairs,
} from "../../../src/agent/analysis/review-repairs.js";

const RUN_ID = "run-1234abcd";
const TASK_ID = "task-5678efgh";
const TRAILER = "Co-Authored-By: Test <test@example.com>";

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

describe("review-repairs", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "hench-review-repairs-"));
    initGitFixtureRepoSync(repoDir);
    await writeFile(join(repoDir, "base.ts"), "export const base = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-m", "baseline");
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  describe("snapshotDirtyState / diffDirtyState", () => {
    it("returns no changes when the tree did not change between snapshots", async () => {
      await writeFile(join(repoDir, "dirty.ts"), "pre-existing dirt\n");
      const before = await snapshotDirtyState(repoDir);
      const after = await snapshotDirtyState(repoDir);
      expect(diffDirtyState(before, after)).toEqual([]);
    });

    it("identifies files modified, added, and deleted between snapshots", async () => {
      await writeFile(join(repoDir, "dirty.ts"), "pre-existing dirt\n");
      await writeFile(join(repoDir, "doomed.ts"), "reviewer will delete this\n");
      const before = await snapshotDirtyState(repoDir);

      // Reviewer edits a tracked file, adds a new one, deletes one; the
      // pre-existing dirty file is untouched.
      await writeFile(join(repoDir, "base.ts"), "export const base = 2;\n");
      await writeFile(join(repoDir, "new-test.ts"), "test file added by reviewer\n");
      await unlink(join(repoDir, "doomed.ts"));

      const after = await snapshotDirtyState(repoDir);
      const changed = diffDirtyState(before, after).sort();
      expect(changed).toEqual(["base.ts", "doomed.ts", "new-test.ts"]);
    });

    it("sees changes inside untracked directories", async () => {
      const before = await snapshotDirtyState(repoDir);
      await mkdir(join(repoDir, "sub/deep"), { recursive: true });
      await writeFile(join(repoDir, "sub/deep/file.ts"), "nested\n");
      const after = await snapshotDirtyState(repoDir);
      expect(diffDirtyState(before, after)).toEqual(["sub/deep/file.ts"]);
    });
  });

  describe("commitReviewRepairs", () => {
    it("commits exactly the repaired paths, leaving pre-existing dirt uncommitted", async () => {
      // Pre-existing user dirt, present before the run.
      await writeFile(join(repoDir, "dirty.ts"), "pre-existing dirt\n");

      // Executor commits its own work (the sequence from the live run).
      await writeFile(join(repoDir, "work.ts"), "export const work = 1;\n");
      git(repoDir, "add", "work.ts");
      git(repoDir, "commit", "-m", "feat: executor work");

      const before = await snapshotDirtyState(repoDir);

      // Reviewer repairs the work and adds a regression test.
      await writeFile(join(repoDir, "work.ts"), "export const work = 2; // repaired\n");
      await writeFile(join(repoDir, "work.test.ts"), "regression test\n");

      const after = await snapshotDirtyState(repoDir);
      const repaired = diffDirtyState(before, after);

      const sha = await commitReviewRepairs(repoDir, {
        paths: repaired,
        runId: RUN_ID,
        taskId: TASK_ID,
        trailer: TRAILER,
      });

      expect(sha).toBeTruthy();
      const committed = git(repoDir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")
        .trim()
        .split("\n")
        .sort();
      expect(committed).toEqual(["work.test.ts", "work.ts"]);

      const message = git(repoDir, "log", "-1", "--format=%B");
      expect(message).toContain(RUN_ID);
      expect(message).toContain(TASK_ID);
      expect(message).toContain(TRAILER);

      // The user's dirt is still uncommitted, exactly as it was.
      const status = git(repoDir, "status", "--porcelain").trim();
      expect(status).toBe("?? dirty.ts");
    });

    it("commits a deletion made by the reviewer", async () => {
      await writeFile(join(repoDir, "obsolete.ts"), "kill me\n");
      git(repoDir, "add", "obsolete.ts");
      git(repoDir, "commit", "-m", "feat: adds obsolete file");

      const before = await snapshotDirtyState(repoDir);
      await unlink(join(repoDir, "obsolete.ts"));
      const after = await snapshotDirtyState(repoDir);
      const repaired = diffDirtyState(before, after);
      expect(repaired).toEqual(["obsolete.ts"]);

      const sha = await commitReviewRepairs(repoDir, {
        paths: repaired,
        runId: RUN_ID,
        taskId: TASK_ID,
        trailer: TRAILER,
      });
      expect(sha).toBeTruthy();
      expect(git(repoDir, "status", "--porcelain").trim()).toBe("");
    });

    it("returns undefined and creates no commit when there is nothing to stage", async () => {
      const head = git(repoDir, "rev-parse", "HEAD").trim();
      const sha = await commitReviewRepairs(repoDir, {
        paths: [],
        runId: RUN_ID,
        taskId: TASK_ID,
        trailer: TRAILER,
      });
      expect(sha).toBeUndefined();
      expect(git(repoDir, "rev-parse", "HEAD").trim()).toBe(head);
    });

    it("commits repairs recorded on the run and stamps repairCommit (autoCommit wiring)", async () => {
      // The full sequence from the live defect: pre-existing dirt, executor
      // self-commit, reviewer repairs recorded on run.review.repairedFiles.
      const { commitReviewRepairsIfNeeded } = await import(
        "../../../src/agent/lifecycle/shared.js"
      );

      await writeFile(join(repoDir, "dirty.ts"), "pre-existing dirt\n");
      await writeFile(join(repoDir, "work.ts"), "export const work = 1;\n");
      git(repoDir, "add", "work.ts");
      git(repoDir, "commit", "-m", "feat: executor work");
      await writeFile(join(repoDir, "work.ts"), "export const work = 2; // repaired\n");

      const run = {
        id: RUN_ID,
        taskId: TASK_ID,
        review: {
          model: "claude-opus-5",
          resumedSession: true,
          findingCount: 1,
          unresolvedCount: 0,
          fixesApplied: true,
          reportPath: "/tmp/report.json",
          repairedFiles: ["work.ts"],
        },
      } as never;

      await commitReviewRepairsIfNeeded(repoDir, run);

      const review = (run as { review: { repairCommit?: string } }).review;
      expect(review.repairCommit).toBeTruthy();
      expect(git(repoDir, "rev-parse", "HEAD").trim()).toBe(review.repairCommit);
      const committed = git(repoDir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim();
      expect(committed).toBe("work.ts");
      expect(git(repoDir, "status", "--porcelain").trim()).toBe("?? dirty.ts");
      const message = git(repoDir, "log", "-1", "--format=%B");
      expect(message).toContain(RUN_ID);
      expect(message).toContain(TASK_ID);
    });

    it("does nothing when the review failed or recorded no repairs", async () => {
      const { commitReviewRepairsIfNeeded } = await import(
        "../../../src/agent/lifecycle/shared.js"
      );
      const head = git(repoDir, "rev-parse", "HEAD").trim();

      await commitReviewRepairsIfNeeded(repoDir, {
        id: RUN_ID,
        taskId: TASK_ID,
        review: { failed: "spawn-failed", detail: "boom" },
      } as never);
      await commitReviewRepairsIfNeeded(repoDir, {
        id: RUN_ID,
        taskId: TASK_ID,
        review: {
          model: "claude-opus-5",
          resumedSession: true,
          findingCount: 0,
          unresolvedCount: 0,
          fixesApplied: false,
          reportPath: "/tmp/report.json",
          repairedFiles: [],
        },
      } as never);
      await commitReviewRepairsIfNeeded(repoDir, { id: RUN_ID, taskId: TASK_ID } as never);

      expect(git(repoDir, "rev-parse", "HEAD").trim()).toBe(head);
    });

    it("returns undefined when the named paths have no stageable content", async () => {
      // A path that was dirty at snapshot time but reverted to HEAD content
      // by the reviewer: diff lists it, but there is nothing to commit.
      await writeFile(join(repoDir, "base.ts"), "export const base = 999;\n");
      const before = await snapshotDirtyState(repoDir);
      await writeFile(join(repoDir, "base.ts"), "export const base = 1;\n");
      const after = await snapshotDirtyState(repoDir);
      const repaired = diffDirtyState(before, after);
      expect(repaired).toEqual(["base.ts"]);

      const head = git(repoDir, "rev-parse", "HEAD").trim();
      const sha = await commitReviewRepairs(repoDir, {
        paths: repaired,
        runId: RUN_ID,
        taskId: TASK_ID,
        trailer: TRAILER,
      });
      expect(sha).toBeUndefined();
      expect(git(repoDir, "rev-parse", "HEAD").trim()).toBe(head);
    });
  });
});

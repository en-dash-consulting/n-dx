/**
 * findPriorAttemptWork must not count commit-message scratch files as the
 * task's work: a run that committed only `.ndx-commit-msg.txt` (or the hench
 * sibling) left nothing the next attempt could skip.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { findPriorAttemptWork } from "../../../../src/agent/lifecycle/prior-attempt-work.js";
import type { RunRecord } from "../../../../src/schema/index.js";
import { RM_RETRY } from "../../../helpers/index.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
}

describe("findPriorAttemptWork", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "hench-prior-attempt-"));
    git(dir, ["init"]);
    git(dir, ["config", "user.email", "test@test.com"]);
    git(dir, ["config", "user.name", "Test"]);
    git(dir, ["config", "core.autocrlf", "false"]);
    git(dir, ["checkout", "-b", "main"]);
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "README.md"), "base\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "base"]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, ...RM_RETRY });
  });

  function runWith(sha: string): RunRecord {
    return {
      id: "run-aaaaaaaa-0000",
      taskId: "task-1",
      startedAt: "2026-10-09T00:00:00.000Z",
      commits: [{ sha }],
    } as unknown as RunRecord;
  }

  /** Commit the given files (force-added, as a careless `git add -A` would) and return the sha. */
  function commitFiles(files: string[]): string {
    git(dir, ["add", "-f", "--", ...files]);
    git(dir, ["commit", "-m", "prior attempt"]);
    return git(dir, ["rev-parse", "HEAD"]);
  }

  it("reports the task's files from an earlier run's commit", async () => {
    await writeFile(join(dir, "src", "a.ts"), "export const a = 1;\n");
    const sha = commitFiles(["src/a.ts"]);

    const work = await findPriorAttemptWork({ projectDir: dir, taskId: "task-1", runHistory: [runWith(sha)] });
    expect(work?.files).toEqual(["src/a.ts"]);
  });

  it.each([".ndx-commit-msg.txt", ".hench-commit-msg.txt"])(
    "does not count a committed %s as prior-attempt work",
    async (scratch) => {
      await writeFile(join(dir, scratch), "feat: leftover\n");
      await writeFile(join(dir, "src", "a.ts"), "export const a = 1;\n");
      const sha = commitFiles([scratch, "src/a.ts"]);

      const work = await findPriorAttemptWork({ projectDir: dir, taskId: "task-1", runHistory: [runWith(sha)] });
      expect(work?.files).toEqual(["src/a.ts"]);
    },
  );

  it("reports nothing when the only committed file is the scratch file", async () => {
    await writeFile(join(dir, ".ndx-commit-msg.txt"), "feat: leftover\n");
    const sha = commitFiles([".ndx-commit-msg.txt"]);

    const work = await findPriorAttemptWork({ projectDir: dir, taskId: "task-1", runHistory: [runWith(sha)] });
    expect(work).toBeUndefined();
  });
});

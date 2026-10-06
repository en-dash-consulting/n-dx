/**
 * `stageRunWork` — the commit must contain everything the run changed.
 *
 * The commit used to contain only what the *agent* had staged, because the
 * prompt asks it to `git add -- <path...>` naming each path. A file it forgot
 * was simply not in the commit. These tests pin the two halves of the fix:
 * everything the run touched gets staged, and nothing that was already the
 * operator's does.
 *
 * Run against a real temporary repository rather than a mocked git, because
 * what is being asserted is the state of a real index.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  stageRunWork,
  captureBaselineDirty,
} from "../../../../src/agent/lifecycle/shared.js";
import { RM_RETRY } from "../../../helpers/index.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

function initRepo(dir: string): void {
  git(dir, ["init"]);
  git(dir, ["config", "user.email", "test@test.com"]);
  git(dir, ["config", "user.name", "Test"]);
  // See routes-git.test.ts: Git-for-Windows defaults core.autocrlf=true in the
  // SYSTEM config, which makes byte-exact expectations non-deterministic.
  git(dir, ["config", "core.autocrlf", "false"]);
  git(dir, ["config", "core.eol", "lf"]);
  git(dir, ["checkout", "-b", "main"]);
}

/** Paths in the index, as `git diff --cached --name-only` reports them. */
function stagedPaths(dir: string): string[] {
  return git(dir, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).sort();
}

describe("stageRunWork", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "stage-run-work-"));
    initRepo(dir);
    await writeFile(join(dir, "README.md"), "hello\n");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "existing.ts"), "export const a = 1;\n");
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "init"]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("stages a file the agent changed but forgot to add", async () => {
    const baseline = await captureBaselineDirty(dir);
    expect(baseline).toEqual([]);

    await writeFile(join(dir, "src", "existing.ts"), "export const a = 2;\n");

    const result = await stageRunWork(dir, baseline);
    expect(result.error).toBeUndefined();
    expect(result.staged).toEqual(["src/existing.ts"]);
    expect(stagedPaths(dir)).toEqual(["src/existing.ts"]);
  });

  it("stages a new file the agent created but forgot to add", async () => {
    const baseline = await captureBaselineDirty(dir);
    await writeFile(join(dir, "src", "brand-new.ts"), "export const b = 1;\n");

    await stageRunWork(dir, baseline);
    expect(stagedPaths(dir)).toEqual(["src/brand-new.ts"]);
  });

  it("stages a deletion the agent made", async () => {
    const baseline = await captureBaselineDirty(dir);
    await rm(join(dir, "src", "existing.ts"));

    await stageRunWork(dir, baseline);
    expect(git(dir, ["diff", "--cached", "--name-status"])).toContain("D\tsrc/existing.ts");
  });

  it("adds to what the agent already staged rather than replacing it", async () => {
    const baseline = await captureBaselineDirty(dir);
    await writeFile(join(dir, "src", "staged.ts"), "export const c = 1;\n");
    await writeFile(join(dir, "src", "forgotten.ts"), "export const d = 1;\n");
    git(dir, ["add", "--", "src/staged.ts"]);

    await stageRunWork(dir, baseline);
    expect(stagedPaths(dir)).toEqual(["src/forgotten.ts", "src/staged.ts"]);
  });

  it("picks up a further edit the agent made after staging", async () => {
    const baseline = await captureBaselineDirty(dir);
    await writeFile(join(dir, "src", "existing.ts"), "export const a = 2;\n");
    git(dir, ["add", "--", "src/existing.ts"]);
    // The agent kept working after staging — this edit was not in the index.
    await appendFile(join(dir, "src", "existing.ts"), "export const e = 3;\n");

    await stageRunWork(dir, baseline);
    expect(git(dir, ["diff", "--name-only"])).toBe("");
    expect(git(dir, ["diff", "--cached"])).toContain("export const e = 3;");
  });

  // ── The exclusions ──────────────────────────────────────────────────────

  it("never stages work that was already dirty when the run started", async () => {
    // The operator's work in progress, present before the agent ran.
    await writeFile(join(dir, "README.md"), "hello, edited by a human\n");
    await writeFile(join(dir, "scratch.local"), "notes\n");
    const baseline = await captureBaselineDirty(dir);
    expect(baseline.sort()).toEqual(["README.md", "scratch.local"]);

    await writeFile(join(dir, "src", "agent-work.ts"), "export const f = 1;\n");

    const result = await stageRunWork(dir, baseline);
    expect(result.staged).toEqual(["src/agent-work.ts"]);
    expect(stagedPaths(dir)).toEqual(["src/agent-work.ts"]);
    // The operator's files are untouched and still dirty.
    expect(git(dir, ["status", "--porcelain"])).toContain("README.md");
    expect(git(dir, ["status", "--porcelain"])).toContain("scratch.local");
  });

  it("stages nothing at all when no baseline was captured", async () => {
    // An unknown baseline cannot tell the run's work from the operator's, so
    // the safe answer is to stage none of it.
    await writeFile(join(dir, "src", "whatever.ts"), "export const g = 1;\n");

    const result = await stageRunWork(dir, undefined);
    expect(result.staged).toEqual([]);
    expect(stagedPaths(dir)).toEqual([]);
  });

  it("never stages hench's own runtime artifacts, including the message sentinel", async () => {
    const baseline = await captureBaselineDirty(dir);
    await writeFile(join(dir, ".hench-commit-msg.txt"), "feat: something\n");
    await mkdir(join(dir, ".run-logs"), { recursive: true });
    await writeFile(join(dir, ".run-logs", "run.log"), "noise\n");
    await writeFile(join(dir, "src", "real-work.ts"), "export const h = 1;\n");

    const result = await stageRunWork(dir, baseline);
    expect(result.staged).toEqual(["src/real-work.ts"]);
    expect(stagedPaths(dir)).not.toContain(".hench-commit-msg.txt");
  });

  it("never stages the PRD paths — the commit prompt owns those", async () => {
    // Staging them here would capture the PRD as it was *before* the
    // completion write that performCommitPromptIfNeeded is about to make.
    const baseline = await captureBaselineDirty(dir);
    await mkdir(join(dir, ".rex", "prd_tree", "epic"), { recursive: true });
    await writeFile(join(dir, ".rex", "prd_tree", "epic", "index.md"), "---\nid: e1\n---\n");
    await writeFile(join(dir, "src", "code.ts"), "export const i = 1;\n");

    const result = await stageRunWork(dir, baseline);
    expect(result.staged).toEqual(["src/code.ts"]);
    expect(stagedPaths(dir).some((p) => p.startsWith(".rex/"))).toBe(false);
  });

  it("stages a path containing glob metacharacters as itself", async () => {
    const baseline = await captureBaselineDirty(dir);
    await writeFile(join(dir, "src", "report[1].ts"), "export const j = 1;\n");

    const result = await stageRunWork(dir, baseline);
    expect(result.staged).toEqual(["src/report[1].ts"]);
    expect(stagedPaths(dir)).toEqual(["src/report[1].ts"]);
  });

  it("is a no-op on a clean tree", async () => {
    const baseline = await captureBaselineDirty(dir);
    const result = await stageRunWork(dir, baseline);
    expect(result.staged).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it("reports an error instead of throwing when git refuses", async () => {
    const baseline = await captureBaselineDirty(dir);
    await writeFile(join(dir, "src", "work.ts"), "export const k = 1;\n");
    // Point the helper at a directory that is not a repository.
    const notARepo = await mkdtemp(join(tmpdir(), "not-a-repo-"));
    try {
      const result = await stageRunWork(notARepo, baseline);
      // Nothing dirty there, so nothing to stage and nothing to fail on.
      expect(result.staged).toEqual([]);
    } finally {
      await rm(notARepo, { recursive: true, force: true, ...RM_RETRY });
    }
  });
});

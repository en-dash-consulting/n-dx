/**
 * The fail-forward commit engine.
 *
 * The properties under test are the ones that make the mode safe to leave on:
 * it commits only the paths it was given, it leaves an operator's own staged
 * work alone, and it uses a constant message. A bug in any of those turns a
 * convenience into a mode that quietly commits other people's work.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import {
  commitFailForward,
  failForwardSubject,
} from "../../../../src/agent/lifecycle/fail-forward.js";
import {
  initGitFixtureRepoSync,
  commitGitFixtureBaseline,
  gitCommitTrailers,
} from "../../../helpers/index.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

describe("commitFailForward", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fail-forward-"));
    initGitFixtureRepoSync(dir);
    writeFileSync(join(dir, "kept.txt"), "v1\n");
    commitGitFixtureBaseline(dir, "init");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("commits nothing when given no paths", async () => {
    const before = git(dir, ["rev-parse", "HEAD"]).trim();
    const result = await commitFailForward(dir, [], "loop-leftover");
    expect(result.committed).toBe(false);
    expect(git(dir, ["rev-parse", "HEAD"]).trim()).toBe(before);
  });

  it("stages and commits exactly the paths it is given", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    writeFileSync(join(dir, "b.txt"), "also new\n");

    const result = await commitFailForward(dir, ["a.txt"], "loop-leftover");
    expect(result.committed).toBe(true);

    const files = git(dir, ["show", "--name-only", "--pretty=", "HEAD"]);
    expect(files).toContain("a.txt");
    expect(files).not.toContain("b.txt");
    // The one it did not name is still sitting in the tree.
    expect(git(dir, ["status", "--porcelain"])).toContain("b.txt");
  });

  it("leaves work the operator had already staged out of the commit", async () => {
    // The scenario the pathspec exists for: a half-finished `git add -p`
    // must not land under a fail-forward message.
    writeFileSync(join(dir, "kept.txt"), "operator edit\n");
    git(dir, ["add", "kept.txt"]);
    writeFileSync(join(dir, "leftover.txt"), "run output\n");

    const result = await commitFailForward(dir, ["leftover.txt"], "loop-leftover");
    expect(result.committed).toBe(true);

    const files = git(dir, ["show", "--name-only", "--pretty=", "HEAD"]);
    expect(files).toContain("leftover.txt");
    expect(files).not.toContain("kept.txt");
    // And it is still staged, exactly as the operator left it.
    expect(git(dir, ["diff", "--cached", "--name-only"])).toContain("kept.txt");
  });

  it("uses the constant subject for its kind", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "loop-leftover");
    expect(git(dir, ["log", "-1", "--pretty=%s"]).trim())
      .toBe(failForwardSubject("loop-leftover"));
  });

  it("uses a different constant subject for the pre-run kind", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "pre-run");
    expect(git(dir, ["log", "-1", "--pretty=%s"]).trim())
      .toBe(failForwardSubject("pre-run"));
    expect(failForwardSubject("pre-run")).not.toBe(failForwardSubject("loop-leftover"));
  });

  it("carries the N-DX producer trailer and co-authorship", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "loop-leftover");

    const trailers = gitCommitTrailers(dir);
    const keys = trailers.map(([k]) => k);
    expect(keys).toContain("N-DX");
    expect(keys).toContain("Co-Authored-By");
    expect(trailers.find(([k]) => k === "N-DX")![1]).toContain("fail-forward");
  });

  it("names the PRD item when the work belongs to one", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "loop-leftover", "task-123");
    const trailers = gitCommitTrailers(dir);
    expect(trailers).toContainEqual(["N-DX-Item", "task-123"]);
  });

  it("omits the item trailer when there is no item", async () => {
    writeFileSync(join(dir, "a.txt"), "new\n");
    await commitFailForward(dir, ["a.txt"], "loop-leftover");
    expect(gitCommitTrailers(dir).map(([k]) => k)).not.toContain("N-DX-Item");
  });

  it("commits a deletion as a deletion", async () => {
    rmSync(join(dir, "kept.txt"));
    const result = await commitFailForward(dir, ["kept.txt"], "loop-leftover");
    expect(result.committed).toBe(true);
    expect(git(dir, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("handles a path with a glob character literally", async () => {
    // :(literal) is what stops `report[1].txt` matching as a character class.
    const odd = "report[1].txt";
    writeFileSync(join(dir, odd), "new\n");
    const result = await commitFailForward(dir, [odd], "loop-leftover");
    expect(result.committed).toBe(true);
    expect(git(dir, ["show", "--name-only", "--pretty=", "HEAD"])).toContain(odd);
  });

  it("reports an error rather than throwing when git refuses", async () => {
    // A path that does not exist and was never tracked: `git add` fails.
    const result = await commitFailForward(dir, ["does-not-exist.txt"], "loop-leftover");
    expect(result.committed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("commits a file in a nested directory", async () => {
    mkdirSync(join(dir, "nested", "deep"), { recursive: true });
    writeFileSync(join(dir, "nested", "deep", "x.txt"), "new\n");
    const result = await commitFailForward(dir, ["nested/deep/x.txt"], "loop-leftover");
    expect(result.committed).toBe(true);
    expect(git(dir, ["status", "--porcelain"]).trim()).toBe("");
  });
});

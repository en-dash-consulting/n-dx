/**
 * Branch health against real temporary repositories.
 *
 * git runs for real; gh is always a stub, so nothing here touches the network.
 * The stub is also how "no gh command runs" is proven: with GitHub reads off,
 * any gh call fails the test.
 *
 * @see packages/web/src/server/branch-health/collect.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec, type ExecOptions, type ExecResult } from "@n-dx/llm-client";
import {
  collectBranchHealth,
  LOCAL_ONLY_REASON,
  LOG_TAIL_MAX_CHARS,
  LOG_TAIL_MAX_LINES,
  type BranchHealthExec,
} from "../../src/server/branch-health/index.js";

let root: string;
let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function write(file: string, content: string): void {
  writeFileSync(join(repo, file), content, "utf-8");
}

function commitAll(message: string): void {
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

/** A repo whose `main` is also pushed to a bare `origin` with HEAD set, as a clone has. */
function initRepo(): void {
  root = mkdtempSync(join(tmpdir(), "branch-health-"));
  repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", join(root, "origin.git")]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  write("a.txt", "one\ntwo\nthree\n");
  write("b.txt", "alpha\nbeta\n");
  commitAll("base");
  git("remote", "add", "origin", join(root, "origin.git"));
  git("push", "-q", "origin", "main");
  git("remote", "set-head", "origin", "main");
}

/** `git` for real; `gh` through `onGh`, which by default fails the test. */
function stubExec(onGh: (args: string[]) => ExecResult = (args) => {
  throw new Error(`gh must not run, but was called with: ${args.join(" ")}`);
}): { run: BranchHealthExec; ghCalls: string[][] } {
  const ghCalls: string[][] = [];
  const run: BranchHealthExec = async (cmd: string, args: string[], opts: ExecOptions) => {
    if (cmd === "gh") {
      ghCalls.push(args);
      return onGh(args);
    }
    return exec(cmd, args, opts);
  };
  return { run, ghCalls };
}

function result(stdout: string, exitCode = 0): ExecResult {
  return { stdout, stderr: "", exitCode, error: exitCode === 0 ? null : new Error("exit"), launched: true };
}

/** Everything a read must not change: HEAD, the index file, the worktree. */
function snapshot(): Record<string, string> {
  return {
    head: git("rev-parse", "HEAD"),
    symbolic: git("symbolic-ref", "HEAD"),
    index: createHash("sha256").update(readFileSync(join(repo, ".git", "index"))).digest("hex"),
    status: git("status", "--porcelain", "--untracked-files=all"),
    a: readFileSync(join(repo, "a.txt"), "utf-8"),
    b: readFileSync(join(repo, "b.txt"), "utf-8"),
  };
}

beforeEach(() => {
  initRepo();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("predicted conflicts", () => {
  /** feat edits a.txt's middle line and b.txt; main edits a.txt's middle line differently. */
  function divergeWithOneConflict(): void {
    git("checkout", "-q", "-b", "feat");
    write("a.txt", "one\nTWO-feat\nthree\n");
    write("b.txt", "alpha\nbeta\ngamma\n");
    commitAll("feat edits");
    git("checkout", "-q", "main");
    write("a.txt", "one\nTWO-main\nthree\n");
    commitAll("main edits");
    git("push", "-q", "origin", "main");
    git("checkout", "-q", "feat");
  }

  it("lists only the conflicting file, with its stages, and leaves worktree, index and HEAD alone", async () => {
    divergeWithOneConflict();
    const before = snapshot();

    const health = await collectBranchHealth(repo, { githubReads: false, exec: stubExec().run });

    expect(health.conflicts).toEqual([{ path: "a.txt", stages: [1, 2, 3] }]);
    expect(health.conflictsUnavailable).toBeNull();
    expect(snapshot()).toEqual(before);
  });

  it("reports base, ahead/behind and no conflicts for a clean branch", async () => {
    git("checkout", "-q", "-b", "feat");
    write("b.txt", "alpha\nbeta\ngamma\n");
    commitAll("feat");

    const health = await collectBranchHealth(repo, { githubReads: false, exec: stubExec().run });

    expect(health).toMatchObject({
      branch: "feat",
      head: git("rev-parse", "HEAD"),
      base: "origin/main",
      baseSource: "default",
      ahead: 1,
      behind: 0,
      conflicts: [],
      stack: [],
    });
  });
});

describe("offline", () => {
  beforeEach(() => {
    git("checkout", "-q", "-b", "feat");
    write("b.txt", "alpha\nbeta\ngamma\n");
    commitAll("feat");
  });

  it("runs no gh command while GitHub reads are off, and still answers the local facts", async () => {
    const { run, ghCalls } = stubExec();

    const health = await collectBranchHealth(repo, { githubReads: false, exec: run });

    expect(ghCalls).toEqual([]);
    expect(health.github).toBeNull();
    expect(health.githubReason).toContain("web.sidecarGithubReads");
    expect(health).toMatchObject({ base: "origin/main", ahead: 1, behind: 0, conflicts: [], stack: [] });
  });

  it("answers the local facts with github null and a reason when gh is not installed", async () => {
    const missing: ExecResult = { stdout: "", stderr: "", exitCode: 1, error: new Error("spawn gh ENOENT"), launched: false };
    const { run } = stubExec(() => missing);

    const health = await collectBranchHealth(repo, { githubReads: true, exec: run });

    expect(health.github).toBeNull();
    expect(health.githubReason).toMatch(/gh is not installed/);
    expect(health).toMatchObject({ base: "origin/main", baseSource: "default", ahead: 1, behind: 0, conflicts: [] });
  });
});

describe("stack containment", () => {
  /** main ← l1 ← l2 ← l3, each branch's upstream set to the one below it. */
  function buildStack(): void {
    let below = "main";
    for (const layer of ["l1", "l2", "l3"]) {
      git("checkout", "-q", "-b", layer, below);
      git("branch", "-q", `--set-upstream-to=${below}`);
      write(`${layer}.txt`, `${layer}\n`);
      commitAll(layer);
      below = layer;
    }
  }

  it("reports every layer contained, then one not contained after a lower layer gains a commit", async () => {
    buildStack();

    const first = await collectBranchHealth(repo, { githubReads: false, exec: stubExec().run });
    expect(first.base).toBe("l2");
    expect(first.baseSource).toBe("upstream");
    // The trunk is not a layer: the chain stops at origin's default branch.
    expect(first.stack).toEqual([
      { branch: "l2", contained: true },
      { branch: "l1", contained: true },
    ]);

    // l1 gains a commit l3 lacks, without checking anything out.
    const tip = git("commit-tree", "l1^{tree}", "-p", "l1", "-m", "l1 moves on");
    git("update-ref", "refs/heads/l1", tip);

    const second = await collectBranchHealth(repo, { githubReads: false, exec: stubExec().run });
    expect(second.stack).toEqual([
      { branch: "l2", contained: true },
      { branch: "l1", contained: false },
    ]);
  });
});

describe("GitHub facts", () => {
  const RUN_URL = "https://github.com/acme/repo/actions/runs/111/job/222";

  function prJson(): string {
    return JSON.stringify({
      number: 42,
      url: "https://github.com/acme/repo/pull/42",
      baseRefName: "main",
      isCrossRepository: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      statusCheckRollup: [
        { __typename: "CheckRun", name: "test (ubuntu)", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: RUN_URL },
        { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/acme/repo/actions/runs/111/job/223" },
        { __typename: "StatusContext", context: "deploy/preview", state: "PENDING", targetUrl: "https://example.com" },
      ],
    });
  }

  beforeEach(() => {
    git("checkout", "-q", "-b", "feat");
    write("b.txt", "alpha\nbeta\ngamma\n");
    commitAll("feat");
  });

  it("reads PR fields from gh pr view --json and caps each failing check's log tail", async () => {
    const log = Array.from({ length: 10_000 }, (_, i) => `test (ubuntu)\tRun tests\tline ${i + 1} ${"x".repeat(60)}`).join("\n");
    const { run, ghCalls } = stubExec((args) => {
      if (args[0] === "pr") return result(prJson());
      if (args[0] === "run") return result(log);
      throw new Error(`unexpected gh call: ${args.join(" ")}`);
    });

    const health = await collectBranchHealth(repo, { githubReads: true, exec: run });

    expect(ghCalls[0]).toEqual([
      "pr", "view", "--json",
      "number,url,baseRefName,isCrossRepository,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup",
    ]);
    expect(ghCalls).toContainEqual(["run", "view", "111", "--job", "222", "--log-failed"]);
    expect(health.base).toBe("origin/main");
    expect(health.baseSource).toBe("pr");
    expect(health.github).toMatchObject({
      number: 42,
      baseRefName: "main",
      isCrossRepository: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      checks: { total: 3, failing: 1, pending: 1 },
    });
    const [failing] = health.github!.failing;
    expect(failing).toMatchObject({ name: "test (ubuntu)", conclusion: "FAILURE", url: RUN_URL, class: "unclassified" });
    const tail = failing.logTail!;
    expect(tail.split("\n").length).toBeLessThanOrEqual(LOG_TAIL_MAX_LINES);
    expect(tail.length).toBeLessThanOrEqual(LOG_TAIL_MAX_CHARS);
    expect(tail.endsWith("line 10000 " + "x".repeat(60))).toBe(true);
  });

  it("classes a failing check as touched-test when the branch changed the failing file", async () => {
    write("widget.test.ts", "it('x', () => {});\n");
    commitAll("add a test");
    const { run } = stubExec((args) => {
      if (args[0] === "pr") return result(prJson());
      return result(" FAIL  widget.test.ts > widget > renders\nAssertionError: expected 1 to be 2\n");
    });

    const health = await collectBranchHealth(repo, { githubReads: true, exec: run });

    expect(health.github!.failing[0]).toMatchObject({ class: "touched-test" });
  });

  it("classifies over the whole log and stores a tail without gh's line prefix", async () => {
    write("widget.test.ts", "it('x', () => {});\n");
    commitAll("add a test");
    const prefix = "test (ubuntu)\tRun tests\t2026-10-29T12:34:56.1234567Z ";
    const log = [
      `${prefix} FAIL  widget.test.ts > widget > renders`,
      ...Array.from({ length: 300 }, (_, i) => `${prefix}    at frame ${i}`),
    ].join("\n");
    const { run } = stubExec((args) => result(args[0] === "pr" ? prJson() : log));

    const health = await collectBranchHealth(repo, { githubReads: true, exec: run });

    const [failing] = health.github!.failing;
    expect(failing.class).toBe("touched-test");
    expect(failing.logTail).not.toContain("widget.test.ts");
    expect(failing.logTail!.split("\n").every((line) => line.startsWith("    at frame"))).toBe(true);
  });

  it("classes a failing check behind-base from the PR's BEHIND merge state", async () => {
    const behind = JSON.stringify({ ...JSON.parse(prJson()), mergeStateStatus: "BEHIND" });
    const { run } = stubExec((args) => result(args[0] === "pr" ? behind : " FAIL  other.test.ts > x\n"));

    const health = await collectBranchHealth(repo, { githubReads: true, exec: run });

    expect(health.github!.failing[0].class).toBe("behind-base");
    expect(health.github!.failing[0].evidence).toContain("BEHIND");
  });

  it("runs no gh command when only local facts are asked for, and says GitHub facts are deferred", async () => {
    const { run, ghCalls } = stubExec();

    const health = await collectBranchHealth(repo, { githubReads: true, localOnly: true, exec: run });

    expect(ghCalls).toEqual([]);
    expect(health).toMatchObject({ base: "origin/main", github: null, githubDeferred: true, githubReason: LOCAL_ONLY_REASON });
  });
});

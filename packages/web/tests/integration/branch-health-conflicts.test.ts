/**
 * Conflict classes against real temporary repositories: the prediction is
 * classified, and running the offered fix on the real merge resolves it.
 *
 * git runs for real; gh never runs (GitHub reads are off). The rex steps run
 * the built rex CLI, so build rex before this file.
 *
 * @see packages/web/src/server/branch-health/conflicts.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectBranchHealth, type PredictedConflict } from "../../src/server/branch-health/index.js";

const REX_CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../rex/dist/cli/index.js");

let root: string;
let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function rex(...args: string[]): string {
  return execFileSync(process.execPath, [REX_CLI, ...args], { cwd: repo, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function write(file: string, content: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true });
  writeFileSync(join(repo, file), content, "utf-8");
}

function commitAll(message: string): void {
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

function initRepo(): void {
  root = realpathSync(mkdtempSync(join(tmpdir(), "branch-conflicts-")));
  repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", join(root, "origin.git")]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("remote", "add", "origin", join(root, "origin.git"));
}

function publishMain(): void {
  git("push", "-q", "origin", "main");
  git("remote", "set-head", "origin", "main");
}

/** Run a fix's steps from the worktree root, `rex` as the built CLI. */
function runSteps(steps: string[][]): void {
  for (const [cmd, ...args] of steps) {
    const run = cmd === "rex"
      ? spawnSync(process.execPath, [REX_CLI, ...args], { cwd: repo, encoding: "utf-8" })
      : spawnSync(cmd, args, { cwd: repo, encoding: "utf-8" });
    expect(run.status, `${cmd} ${args.join(" ")}: ${run.stdout}${run.stderr}`).toBe(0);
  }
}

async function predict(): Promise<PredictedConflict[]> {
  const health = await collectBranchHealth(repo, { githubReads: false });
  expect(health.conflictsUnavailable).toBeNull();
  return health.conflicts;
}

/** `git merge origin/main` on this branch, which must stop on conflicts. */
function mergeBase(): void {
  const merge = spawnSync("git", ["merge", "--no-edit", "origin/main"], { cwd: repo, encoding: "utf-8" });
  expect(merge.status).not.toBe(0);
}

beforeEach(() => {
  initRepo();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("prd-children-table on a real v1 tree", () => {
  it("is predicted for two branches each adding a child under one parent, and its steps resolve the merge", async () => {
    rex("init", ".");
    rmSync(join(repo, ".rex", "product"), { recursive: true, force: true });
    mkdirSync(join(repo, ".rex", "prd_tree"), { recursive: true });
    const epic = JSON.parse(rex("add", "epic", "--title=Parent epic", "--format=json", ".")) as { id: string };
    rex("add", "feature", "--title=First feature", `--parent=${epic.id}`, "--format=json", ".");
    commitAll("v1 tree with one child");
    publishMain();

    git("checkout", "-q", "-b", "feat");
    rex("add", "feature", "--title=Branch feature", `--parent=${epic.id}`, "--format=json", ".");
    commitAll("feat adds a child");
    git("checkout", "-q", "main");
    rex("add", "feature", "--title=Main feature", `--parent=${epic.id}`, "--format=json", ".");
    commitAll("main adds a child");
    publishMain();
    git("checkout", "-q", "feat");

    const conflicts = await predict();
    const index = conflicts.find((c) => c.path.endsWith("index.md"));
    expect(conflicts.map((c) => c.class)).toEqual(["prd-children-table"]);
    expect(index?.fix && "steps" in index.fix).toBe(true);

    mergeBase();
    runSteps((index!.fix as { steps: string[][] }).steps);

    const text = readFileSync(join(repo, index!.path), "utf-8");
    expect(text).not.toMatch(/^(<{7}|={7}|>{7})/m);
    expect(text).toContain("Branch feature");
    expect(text).toContain("Main feature");
    expect(text).toContain("First feature");
    expect(spawnSync(process.execPath, [REX_CLI, "validate", "."], { cwd: repo }).status).toBe(0);
  });
});

describe("allowlist-union on a real merge", () => {
  it("applies to this branch's copy and keeps both additions, ours first, writing nothing itself", async () => {
    write("allow.txt", "alpha\nomega\n");
    commitAll("base");
    publishMain();
    git("checkout", "-q", "-b", "feat");
    write("allow.txt", "alpha\nfrom-feat\nomega\n");
    commitAll("feat adds");
    git("checkout", "-q", "main");
    write("allow.txt", "alpha\nfrom-main\nomega\n");
    commitAll("main adds");
    publishMain();
    git("checkout", "-q", "feat");

    const status = git("status", "--porcelain");
    const [conflict] = await predict();
    expect(git("status", "--porcelain")).toBe(status);
    expect(conflict.class).toBe("allowlist-union");

    mergeBase();
    runSteps([["git", "checkout", "--ours", "--", "allow.txt"]]);
    const patch = join(root, "fix.diff");
    writeFileSync(patch, (conflict.fix as { diff: string }).diff);
    runSteps([["git", "apply", patch]]);
    expect(readFileSync(join(repo, "allow.txt"), "utf-8")).toBe("alpha\nfrom-feat\nfrom-main\nomega\n");
  });

  it("is source when a side changes a base line", async () => {
    write("allow.txt", "alpha\nomega\n");
    commitAll("base");
    publishMain();
    git("checkout", "-q", "-b", "feat");
    write("allow.txt", "ALPHA-feat\nomega\n");
    commitAll("feat changes");
    git("checkout", "-q", "main");
    write("allow.txt", "ALPHA-main\nomega\n");
    commitAll("main changes");
    publishMain();
    git("checkout", "-q", "feat");

    const [conflict] = await predict();
    expect(conflict).toMatchObject({ class: "source", fix: null });
  });
});

describe("source conflicts and other worktrees", () => {
  it("names the other local worktree whose branch changed the path, and not one that did not", async () => {
    write("src.ts", "one\ntwo\n");
    write("other.ts", "x\n");
    commitAll("base");
    publishMain();

    git("branch", "side");
    git("branch", "quiet");
    git("worktree", "add", "-q", join(root, "side"), "side");
    git("worktree", "add", "-q", join(root, "quiet"), "quiet");
    writeFileSync(join(root, "side", "src.ts"), "one\nTWO-side\n");
    execFileSync("git", ["commit", "-q", "-am", "side edits"], { cwd: join(root, "side"), stdio: "ignore" });
    writeFileSync(join(root, "quiet", "other.ts"), "y\n");
    execFileSync("git", ["commit", "-q", "-am", "quiet edits"], { cwd: join(root, "quiet"), stdio: "ignore" });

    git("checkout", "-q", "-b", "feat");
    write("src.ts", "one\nTWO-feat\n");
    commitAll("feat edits");
    git("checkout", "-q", "main");
    write("src.ts", "one\nTWO-main\n");
    commitAll("main edits");
    publishMain();
    git("checkout", "-q", "feat");

    const [conflict] = await predict();
    expect(conflict.class).toBe("source");
    expect(conflict.fix).toBeNull();
    expect(conflict.otherWorktrees).toEqual([{ path: join(root, "side"), branch: "side" }]);
  });
});

describe("generated on a real merge", () => {
  it("is classed from web.generatedFiles and ordered after the other conflicts", async () => {
    write("gen/out.txt", "v1\n");
    write("a.txt", "a\n");
    commitAll("base");
    publishMain();
    git("checkout", "-q", "-b", "feat");
    write("gen/out.txt", "v-feat\n");
    write("a.txt", "a-feat\n");
    commitAll("feat");
    git("checkout", "-q", "main");
    write("gen/out.txt", "v-main\n");
    write("a.txt", "a-main\n");
    commitAll("main");
    publishMain();
    git("checkout", "-q", "feat");

    const health = await collectBranchHealth(repo, {
      githubReads: false,
      generatedFiles: [{ paths: ["gen/**"], command: ["node", "gen.mjs"] }],
    });
    expect(health.conflicts.map((c) => [c.path, c.class])).toEqual([["a.txt", "source"], ["gen/out.txt", "generated"]]);
    expect(readdirSync(repo).sort()).toEqual([".git", "a.txt", "gen"]);
  });
});

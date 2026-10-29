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
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exec, type ExecOptions } from "@n-dx/llm-client";
import { collectBranchHealth, type PredictedConflict } from "../../src/server/branch-health/index.js";

const REX_CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../rex/dist/cli/index.js");
const V2_FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../../rex/tests/fixtures/v2-tree");

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

describe("duplicate-capture on a real v2 tree", () => {
  /**
   * main and feat each `rex add task "Add a widget"` under one change: the
   * same file path, different ids. Main's id is kept; returns feat's (dropped)
   * id, the change folder, and feat's other task that is blocked by it.
   */
  async function captureTwice(): Promise<{ dropped: string; kept: string; folder: string; conflict: PredictedConflict }> {
    rex("init", ".");
    for (const tree of ["prd_tree", "product", "changes"]) rmSync(join(repo, ".rex", tree), { recursive: true, force: true });
    cpSync(V2_FIXTURE, join(repo, ".rex"), { recursive: true });
    // state.yaml rows merge by id through the driver ndx init registers.
    write(".gitattributes", ".rex/**/state.yaml merge=rex-state\n");
    git("config", "merge.rex-state.driver", `"${process.execPath}" "${REX_CLI}" merge-state %O %A %B %P`);
    const change = { id: "c0000000-0000-4000-8000-000000000001" };
    commitAll("v2 tree");
    publishMain();

    const addTask = (title: string, ...extra: string[]) =>
      (JSON.parse(rex("add", "task", `--title=${title}`, `--parent=${change.id}`, ...extra, "--format=json", ".")) as { id: string }).id;
    git("checkout", "-q", "-b", "feat");
    const dropped = addTask("Add a widget");
    addTask("Use the widget", `--blocked-by=${dropped}`);
    commitAll("feat captures the widget");
    git("checkout", "-q", "main");
    const kept = addTask("Add a widget");
    commitAll("main captures the widget");
    publishMain();
    git("checkout", "-q", "feat");

    const conflicts = await predict();
    expect(conflicts.map((c) => c.class)).toEqual(["duplicate-capture"]);
    const conflict = conflicts[0];
    return { dropped, kept, folder: dirname(join(repo, conflict.path)), conflict };
  }

  function namesAnywhere(folder: string, id: string): string[] {
    return readdirSync(folder).filter((f) => readFileSync(join(folder, f), "utf-8").includes(id));
  }

  it("leaves no state row or blockedBy naming the dropped id once its steps run", async () => {
    const { dropped, kept, folder, conflict } = await captureTwice();
    const steps = (conflict.fix as { steps: string[][] }).steps;
    expect(steps.some((s) => s[0] === "rex" && s.includes("--repair"))).toBe(true);
    expect(namesAnywhere(folder, dropped).sort()).toEqual(expect.arrayContaining(["state.yaml"]));

    mergeBase();
    runSteps(steps);

    expect(namesAnywhere(folder, dropped)).toEqual([]);
    expect(readFileSync(join(folder, "state.yaml"), "utf-8")).toContain(kept);
    // Everything the repair rewrote is staged: the merge can be committed.
    expect(git("diff", "--name-only")).toBe("");
    expect(git("diff", "--name-only", "--diff-filter=U")).toBe("");
  });

  it("fails its validation step on a reference to the dropped id planted after the repair", async () => {
    const { dropped, folder, conflict } = await captureTwice();
    const steps = (conflict.fix as { steps: string[][] }).steps;
    mergeBase();
    runSteps(steps.slice(0, -1));

    const user = readdirSync(folder).find((f) => readFileSync(join(folder, f), "utf-8").includes("Use the widget"))!;
    const text = readFileSync(join(folder, user), "utf-8").replace(/^---\n/, `---\nblockedBy:\n  - "${dropped}"\n`);
    writeFileSync(join(folder, user), text);
    const [cmd, ...args] = steps[steps.length - 1];
    expect(cmd).toBe("rex");
    const run = spawnSync(process.execPath, [REX_CLI, ...args], { cwd: repo, encoding: "utf-8" });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain(dropped);
  });
});

describe("allowlist-union on a real merge", () => {
  // The shape of route-feature-gates.test.ts: both sides add one row after the same line.
  const gates = (...rows: string[]) => [
    "const GATED: ReadonlyArray<[path: string, feature: string]> = [",
    '  ["/api/rex/capture-ask", "sourcevision.ask"],',
    ...rows,
    "];",
    "",
  ].join("\n");
  const FEAT_ROW = '  ["/api/branch-health", "git.branchHealth"],';
  const MAIN_ROW = '  ["/api/hench/plan-queue", "hench.readyNext"],';

  /** Commit `start` on main, `feat` on a feat branch, `main` on main, and leave feat checked out. */
  function diverge(file: string, start: string, feat: string, main: string): void {
    write(file, start);
    commitAll("base");
    publishMain();
    git("checkout", "-q", "-b", "feat");
    write(file, feat);
    commitAll("feat adds");
    git("checkout", "-q", "main");
    write(file, main);
    commitAll("main adds");
    publishMain();
    git("checkout", "-q", "feat");
  }

  it("applies to this branch's copy and keeps both rows, ours first, writing nothing itself", async () => {
    diverge("gates.test.ts", gates(), gates(FEAT_ROW), gates(MAIN_ROW));

    const status = git("status", "--porcelain");
    const gitCalls: string[][] = [];
    const health = await collectBranchHealth(repo, {
      githubReads: false,
      exec: async (cmd: string, args: string[], opts: ExecOptions) => {
        if (cmd === "git") gitCalls.push(args);
        return exec(cmd, args, opts);
      },
    });
    const [conflict] = health.conflicts;
    expect(git("status", "--porcelain")).toBe(status);
    expect(conflict.class).toBe("allowlist-union");
    // No source conflict, so other worktrees are never listed or diffed.
    expect(gitCalls.some((args) => args.includes("worktree"))).toBe(false);

    mergeBase();
    runSteps([["git", "checkout", "--ours", "--", "gates.test.ts"]]);
    const patch = join(root, "fix.diff");
    writeFileSync(patch, (conflict.fix as { diff: string }).diff);
    runSteps([["git", "apply", patch]]);
    expect(readFileSync(join(repo, "gates.test.ts"), "utf-8")).toBe(gates(FEAT_ROW, MAIN_ROW));
  });

  it("is source when both sides add a code block", async () => {
    const fn = (name: string) => [`export function ${name}() {`, "  return 1;", "}"].join("\n");
    diverge("code.ts", "// start\n// end\n", `// start\n${fn("feat")}\n// end\n`, `// start\n${fn("main")}\n// end\n`);
    const [conflict] = await predict();
    expect(conflict).toMatchObject({ path: "code.ts", class: "source", fix: null });
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

describe("prd-state on a real merge", () => {
  it("stops at the check step, before git add, when the redone merge leaves conflict markers", async () => {
    write(".rex/changes/c/state.yaml", "items:\n  a: pending\n");
    commitAll("base");
    publishMain();
    git("checkout", "-q", "-b", "feat");
    write(".rex/changes/c/state.yaml", "items:\n  a: in_progress\n");
    commitAll("feat");
    git("checkout", "-q", "main");
    write(".rex/changes/c/state.yaml", "items:\n  a: completed\n");
    commitAll("main");
    publishMain();
    git("checkout", "-q", "feat");

    const [conflict] = await predict();
    expect(conflict.class).toBe("prd-state");
    const steps = (conflict.fix as { steps: string[][] }).steps;

    mergeBase();
    // No driver attribute here, so `checkout --merge` recreates the text
    // conflict, as an unresolvable rex-state row would: markers, exit 0.
    const checkAt = steps.findIndex((s) => s.includes("--check"));
    for (const [cmd, ...args] of steps.slice(0, checkAt)) {
      expect(spawnSync(cmd, args, { cwd: repo }).status).toBe(0);
    }
    const [cmd, ...args] = steps[checkAt];
    expect(spawnSync(cmd, args, { cwd: repo }).status).not.toBe(0);
    expect(checkAt).toBeLessThan(steps.findIndex((s) => s[1] === "add"));
    expect(git("diff", "--name-only", "--diff-filter=U")).toBe(".rex/changes/c/state.yaml");
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

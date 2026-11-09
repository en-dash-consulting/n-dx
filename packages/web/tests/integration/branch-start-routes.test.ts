/**
 * Start a branch: GET /api/rex/branch/start offers the open changes and the
 * bases, POST cuts the branch and, on a clean idle checkout only, switches to
 * it, assigns the changes and commits the PRD with N-DX-Item trailers. A real
 * git repo with the v2 fixture committed, because the checkout is the subject.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../src/server/types.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import type { BranchStartOptionsWire } from "../../src/server/routes-rex/branch-start.js";
import { startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";
import { removeTempDir } from "../helpers/temp-dir.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe("start a branch routes", () => {
  let root: string;
  let ctx: ServerContext;
  let server: RouteTestServer;
  let frames: unknown[];

  const post = (body: unknown) =>
    fetch(`${server.baseUrl}/api/rex/branch/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const stateFile = () => join(ctx.rexDir, "changes", "add-apple-pay", "state.yaml");
  const head = () => git(root, "rev-parse", "--abbrev-ref", "HEAD");
  const branches = () => git(root, "branch", "--format=%(refname:short)").split("\n").sort();
  const commits = () => Number(git(root, "rev-list", "--count", "--all"));

  beforeEach(async () => {
    frames = [];
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-branch-start-")));
    git(root, "init", "--quiet", "--initial-branch=main");
    // The PRD is committed, as in a real project; the machine-local files are not.
    writeFileSync(join(root, ".gitignore"), ".hench/\n.sourcevision/\n.rex/.cache/\n.rex/*.lock\n.rex/execution-log*.jsonl\n");
    const rexDir = join(root, ".rex");
    cpSync(FIXTURE, rexDir, { recursive: true });
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "root");
    ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir, dev: false };
    server = await startRouteTestServer(async (req, res) => handleRexRoute(req, res, ctx, (f) => { frames.push(f); }));
  });

  afterEach(async () => {
    await server.close();
    await removeTempDir(root);
  });

  it("offers the open changes with their slugs, and no stacking on the default branch", async () => {
    const read = (await (await fetch(`${server.baseUrl}/api/rex/branch/start`)).json()) as BranchStartOptionsWire;
    expect(read).toEqual({
      branch: null,
      workSet: false,
      defaultBranch: "main",
      changes: [{ id: CHANGE, displayId: "CH-1", title: "Add Apple Pay", slug: "add-apple-pay" }],
    });
    git(root, "checkout", "--quiet", "-b", "feat/x");
    expect(((await (await fetch(`${server.baseUrl}/api/rex/branch/start`)).json()) as BranchStartOptionsWire).branch).toBe("feat/x");
  });

  it("on a clean idle checkout cuts from the default branch, switches, assigns and commits with trailers", async () => {
    git(root, "checkout", "--quiet", "-b", "feat/elsewhere");
    git(root, "commit", "--quiet", "--allow-empty", "-m", "elsewhere");
    const mainTip = git(root, "rev-parse", "main");

    const res = await post({ changeIds: [CHANGE], name: "feat/add-apple-pay", base: "default" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ switched: true, branch: "feat/add-apple-pay", assigned: expect.arrayContaining([expect.objectContaining({ id: TASK })]) });

    expect(head()).toBe("feat/add-apple-pay");
    expect(git(root, "rev-parse", "HEAD~1")).toBe(mainTip);
    expect(readFileSync(stateFile(), "utf-8")).toMatch(/delivery: \{"branch": ?"feat\/add-apple-pay"\}/);
    expect(git(root, "log", "-1", "--format=%s")).toBe("chore(prd): assign changes to this branch");
    expect(git(root, "log", "-1", "--format=%(trailers:key=N-DX-Item,valueonly)").trim()).toBe(CHANGE);
    expect(git(root, "show", "--name-only", "--format=", "HEAD").split("\n").every((f) => f.startsWith(".rex/changes/"))).toBe(true);
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(frames).toContainEqual(expect.objectContaining({ type: "rex:prd-changed" }));
  });

  it("on a dirty tree creates the branch only and says how to switch", async () => {
    writeFileSync(join(root, "scratch.txt"), "wip\n");
    const before = { commits: commits(), state: readFileSync(stateFile(), "utf-8") };
    const res = await post({ changeIds: [CHANGE], name: "feat/a", base: "default" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ switched: false, branch: "feat/a", reason: "dirty", switchCommand: "git switch feat/a" });
    expect(head()).toBe("main");
    expect(branches()).toEqual(["feat/a", "main"]);
    expect(commits()).toBe(before.commits);
    expect(readFileSync(stateFile(), "utf-8")).toBe(before.state);
  });

  it("counts an untracked PRD file as dirty even when status.showUntrackedFiles is off, and leaves it alone", async () => {
    // A just-captured change is untracked. Hidden from a plain `status`, it would be
    // swept into the assignment commit, or removed by the roll-back's `git clean`.
    git(root, "config", "status.showUntrackedFiles", "no");
    const captured = join(ctx.rexDir, "changes", "captured-not-committed.md");
    writeFileSync(captured, "wip\n");
    const res = await post({ changeIds: [CHANGE], name: "feat/a", base: "default" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ switched: false, reason: "dirty" });
    expect(head()).toBe("main");
    expect(readFileSync(captured, "utf-8")).toBe("wip\n");
  });

  it("with a live run creates the branch only and says how to switch", async () => {
    const locks = join(root, ".hench", "locks");
    mkdirSync(locks, { recursive: true });
    writeFileSync(join(locks, `${process.pid}.lock`), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId: TASK }));
    const before = { commits: commits(), state: readFileSync(stateFile(), "utf-8") };
    const res = await post({ changeIds: [CHANGE], name: "feat/a", base: "default" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ switched: false, branch: "feat/a", reason: "run-active", switchCommand: "git switch feat/a" });
    expect(head()).toBe("main");
    expect(branches()).toEqual(["feat/a", "main"]);
    expect(commits()).toBe(before.commits);
    expect(readFileSync(stateFile(), "utf-8")).toBe(before.state);
  });

  it("refuses a name clash with 409 NAME_TAKEN and creates nothing", async () => {
    git(root, "branch", "feat/a");
    const before = { branches: branches(), commits: commits() };
    const res = await post({ changeIds: [CHANGE], name: "feat/a", base: "default" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NAME_TAKEN" });
    expect(branches()).toEqual(before.branches);
    expect(commits()).toBe(before.commits);
    expect(head()).toBe("main");
  });

  it("stacks on the current work-set branch: the new branch's parent is its tip", async () => {
    git(root, "checkout", "--quiet", "-b", "feat/first");
    // A different task-less change is on this branch, so it has a work set to stack on.
    const first = join(ctx.rexDir, "changes", "first-change");
    mkdirSync(first, { recursive: true });
    writeFileSync(join(first, "index.md"), `---\nid: "c0000000-0000-4000-8000-0000000000b1"\ntype: "change"\ntitle: "First change"\nslug: "first-change"\n---\n`);
    writeFileSync(join(first, "state.yaml"), `schema: "rex/v2"\nitems:\n  "c0000000-0000-4000-8000-0000000000b1":\n    delivery: {"branch": "feat/first"}\n`);
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "first");
    const tip = git(root, "rev-parse", "HEAD");
    const read = (await (await fetch(`${server.baseUrl}/api/rex/branch/start`)).json()) as BranchStartOptionsWire;
    expect(read).toMatchObject({ branch: "feat/first", workSet: true });
    const res = await post({ changeIds: [CHANGE], name: "feat/second", base: "current" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ switched: true, branch: "feat/second" });
    expect(head()).toBe("feat/second");
    expect(git(root, "rev-parse", "HEAD~1")).toBe(tip);
  });

  it("refuses stacking off a work-set branch, a bad name and a closed or unknown change, creating nothing", async () => {
    const before = branches();
    const stacked = await post({ changeIds: [CHANGE], name: "feat/a", base: "current" });
    expect(stacked.status).toBe(409);
    expect(await stacked.json()).toMatchObject({ code: "NO_WORK_SET_BRANCH" });
    // A feature branch nothing is assigned to has no work set either.
    git(root, "checkout", "--quiet", "-b", "feat/empty");
    const read = (await (await fetch(`${server.baseUrl}/api/rex/branch/start`)).json()) as BranchStartOptionsWire;
    expect(read).toMatchObject({ branch: "feat/empty", workSet: false });
    const emptyStacked = await post({ changeIds: [CHANGE], name: "feat/b", base: "current" });
    expect(emptyStacked.status).toBe(409);
    expect(await emptyStacked.json()).toMatchObject({ code: "NO_WORK_SET_BRANCH" });
    git(root, "checkout", "--quiet", "main");
    git(root, "branch", "-D", "feat/empty");
    for (const name of ["bad..name", "-x", "@{-1}"]) {
      const bad = await post({ changeIds: [CHANGE], name, base: "default" });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: "INVALID_NAME" });
    }
    const unknown = await post({ changeIds: [TASK], name: "feat/a", base: "default" });
    expect(unknown.status).toBe(409);
    expect(await unknown.json()).toMatchObject({ code: "NOT_OPEN" });
    expect((await post({ changeIds: [], name: "feat/a", base: "default" })).status).toBe(400);
    expect(branches()).toEqual(before);
  });

  it("switches back and deletes the branch when the assignment fails", async () => {
    // A commit hook that refuses makes the step after the assignment fail.
    // core.hooksPath set here, so a global hooksPath cannot bypass it.
    const hooks = join(root, ".git", "refuse-hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    git(root, "config", "core.hooksPath", hooks);
    const state = readFileSync(stateFile(), "utf-8");
    const res = await post({ changeIds: [CHANGE], name: "feat/a", base: "default" });
    expect(res.status).toBe(500);
    expect(head()).toBe("main");
    expect(branches()).toEqual(["main"]);
    expect(readFileSync(stateFile(), "utf-8")).toBe(state);
    expect(git(root, "status", "--porcelain")).toBe("");
  });
});

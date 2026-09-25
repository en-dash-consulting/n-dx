/**
 * The completion hold: while a live `hench run` in this worktree holds a
 * task's claim with `holdsCompletion`, a completion asked for through rex MCP
 * or `rex update` is recorded on the claim instead of written to the PRD.
 * Everywhere else — no claim, an interactive claim, a dead run, another
 * worktree — both paths write exactly as before.
 *
 * Real git and a real folder tree: the claim lives in the git common dir, and
 * "not completed on disk" has to be read back from the tree.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleClaimTask, handleReleaseTask, handleUpdateTaskStatus } from "../../src/cli/mcp-tools.js";
import { cmdUpdate } from "../../src/cli/commands/update.js";
import { openClaimsStore, resolveClaimHolder, claimsStorePath } from "../../src/store/claims.js";
import {
  resolveStore,
  serializeFolderTree,
  PRD_TREE_DIRNAME,
  TREE_META_FILENAME,
  SLUG_RULE_VERSION,
} from "../../src/store/index.js";
import type { PRDDocument } from "../../src/schema/index.js";

const PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Hold",
  items: [
    {
      id: "e1", title: "Epic", level: "epic", status: "in_progress",
      children: [
        { id: "t1", title: "Task one", level: "task", status: "in_progress", acceptanceCriteria: [] },
        { id: "t2", title: "Task two", level: "task", status: "pending", acceptanceCriteria: [] },
      ],
    },
  ],
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

const roots: string[] = [];
const children: ChildProcess[] = [];

afterAll(() => {
  for (const c of children) c.kill();
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A live process standing in for the hench run that holds the claim. */
function runProcess(): ChildProcess {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  children.push(child);
  return child;
}

async function makeProject(): Promise<string> {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "rex-completion-hold-")));
  roots.push(root);
  const dir = join(root, "p");
  mkdirSync(dir);
  git(dir, "init", "--quiet", "--initial-branch=main");
  await serializeFolderTree(PRD.items, join(dir, ".rex", PRD_TREE_DIRNAME));
  writeFileSync(
    join(dir, ".rex", TREE_META_FILENAME),
    JSON.stringify({ title: PRD.title, schema: PRD.schema, slugRule: SLUG_RULE_VERSION }),
    "utf-8",
  );
  git(dir, "add", "-A");
  git(dir, "commit", "--quiet", "-m", "prd");
  return dir;
}

let dir: string;
let worktreeRoot: string;

beforeEach(async () => {
  dir = await makeProject();
  worktreeRoot = resolveClaimHolder(dir).worktreeRoot;
});

function ctx() {
  return { store: openClaimsStore(dir), worktreeRoot };
}

async function statusOf(id: string): Promise<string | undefined> {
  const store = await resolveStore(join(dir, ".rex"));
  return (await store.getItem(id))?.status;
}

function treeIsClean(): boolean {
  return git(dir, "status", "--porcelain", "--", ".rex/prd_tree").trim() === "";
}

describe("ClaimsStore.recordPendingCompletion", () => {
  it("records on a live completion-holding claim from this worktree, and a refresh keeps it", async () => {
    const run = runProcess();
    const store = openClaimsStore(dir);
    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });

    const held = await store.recordPendingCompletion("t1", { worktreeRoot }, {
      resolutionType: "code-change", resolutionDetail: "did it", requestedAt: "2026-09-25T00:00:00.000Z",
    });
    expect(held?.pendingCompletion).toEqual({
      resolutionType: "code-change", resolutionDetail: "did it", requestedAt: "2026-09-25T00:00:00.000Z",
    });

    // The run's renewal timer re-claims with the same pid: the completion survives.
    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    const [claim] = await store.readClaims();
    expect(claim.pendingCompletion?.resolutionDetail).toBe("did it");

    // A new run in the same worktree starts with nothing held.
    const next = runProcess();
    await store.claim("t1", { worktreeRoot, pid: next.pid!, holdsCompletion: true });
    expect((await store.readClaims())[0].pendingCompletion).toBeUndefined();
  });

  it("returns null for an ordinary claim, a missing claim, and a dead run's claim", async () => {
    const store = openClaimsStore(dir);
    const interactive = runProcess();
    await store.claim("t1", { worktreeRoot, pid: interactive.pid! });
    expect(await store.recordPendingCompletion("t1", { worktreeRoot }, { requestedAt: "x" })).toBeNull();
    expect(await store.recordPendingCompletion("t2", { worktreeRoot }, { requestedAt: "x" })).toBeNull();

    const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((r) => dead.once("exit", r));
    await store.release("t1", { worktreeRoot }, { force: true });
    await store.claim("t1", { worktreeRoot, pid: dead.pid!, holdsCompletion: true });
    expect(await store.recordPendingCompletion("t1", { worktreeRoot }, { requestedAt: "x" })).toBeNull();
  });

  it("returns null for a claim held past its run (uncommitted-work), which also drops the hold", async () => {
    const run = runProcess();
    const store = openClaimsStore(dir);
    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    await store.recordPendingCompletion("t1", { worktreeRoot }, { requestedAt: "x" });
    const kept = await store.hold("t1", { worktreeRoot }, "uncommitted-work");
    expect(kept?.holdsCompletion).toBeUndefined();
    expect(kept?.pendingCompletion).toBeUndefined();
    expect(await store.recordPendingCompletion("t1", { worktreeRoot }, { requestedAt: "x" })).toBeNull();
  });

  it("refuses another worktree's run", async () => {
    const run = runProcess();
    const store = openClaimsStore(dir);
    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    expect(await store.recordPendingCompletion("t1", { worktreeRoot: "/elsewhere" }, { requestedAt: "x" })).toBeNull();
  });

  it("an MCP claim from inside the run does not take the run's claim over", async () => {
    const run = runProcess();
    const store = openClaimsStore(dir);
    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });

    // The agent's MCP server claims with its own pid (here, this test's).
    const out = await handleClaimTask(await resolveStore(join(dir, ".rex")), { id: "t1" }, ctx());
    expect(out.isError).toBeUndefined();
    const [claim] = await store.readClaims();
    expect(claim.pid).toBe(run.pid);
    expect(claim.holdsCompletion).toBe(true);
  });
});

describe("releasing a live hench run's claim", () => {
  it("the agent's release_task cannot drop the run's claim or its hold", async () => {
    const run = runProcess();
    const store = openClaimsStore(dir);
    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });

    const out = await handleReleaseTask({ id: "t1" }, ctx());
    const body = JSON.parse(out.content[0].text);
    expect(body.released).toBe(false);
    expect(body.reason).toMatch(new RegExp(`pid ${run.pid}`));

    const [claim] = await store.readClaims();
    expect(claim).toMatchObject({ pid: run.pid, holdsCompletion: true });
    // …so a completion asked for afterwards is still held.
    const held = await handleUpdateTaskStatus(await resolveStore(join(dir, ".rex")), dir, { id: "t1", status: "completed" }, ctx());
    expect(JSON.parse(held.content[0].text).completionHeld).toBe(true);
  });

  it("a terminal status from the agent does not release it either", async () => {
    const run = runProcess();
    const store = openClaimsStore(dir);
    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    await handleUpdateTaskStatus(await resolveStore(join(dir, ".rex")), dir, { id: "t1", status: "deferred" }, ctx());
    expect((await store.readClaims())[0]).toMatchObject({ pid: run.pid, holdsCompletion: true });
  });

  it("releases for the run's own pid, for force, and once the run is gone", async () => {
    const store = openClaimsStore(dir);
    const run = runProcess();
    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    expect(await store.release("t1", { worktreeRoot }, { pid: run.pid! })).toBe(true);

    await store.claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    expect(await store.release("t1", { worktreeRoot }, { force: true })).toBe(true);

    const dead = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((r) => dead.once("exit", r));
    await store.claim("t1", { worktreeRoot, pid: dead.pid!, holdsCompletion: true });
    // A dead pid's claim is pruned on the next write, so there is nothing left to refuse.
    expect(await store.release("t1", { worktreeRoot })).toBe(false);
    expect(await store.readClaims()).toEqual([]);
  });

  it("an ordinary claim still releases for anyone in its worktree, as before", async () => {
    const store = openClaimsStore(dir);
    const interactive = runProcess();
    await store.claim("t1", { worktreeRoot, pid: interactive.pid! });
    const out = await handleReleaseTask({ id: "t1" }, ctx());
    expect(JSON.parse(out.content[0].text)).toEqual({ id: "t1", released: true });
  });
});

describe("update_task_status completed (MCP)", () => {
  it("while a hench run holds the task: records the resolution, writes nothing, keeps the claim", async () => {
    const run = runProcess();
    await openClaimsStore(dir).claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    const store = await resolveStore(join(dir, ".rex"));

    const out = await handleUpdateTaskStatus(store, dir, {
      id: "t1", status: "completed", resolutionType: "code-change", resolutionDetail: "Fixed the gate",
    }, ctx());
    const body = JSON.parse(out.content[0].text);

    expect(out.isError).toBeUndefined();
    expect(body.completionHeld).toBe(true);
    expect(body.newStatus).toBe("in_progress");
    expect(body.message).toMatch(/test gate passes/);
    expect(await statusOf("t1")).toBe("in_progress");
    expect(treeIsClean()).toBe(true);

    const [claim] = await openClaimsStore(dir).readClaims();
    expect(claim.pid).toBe(run.pid);
    expect(claim.pendingCompletion).toMatchObject({ resolutionType: "code-change", resolutionDetail: "Fixed the gate" });
  });

  it("without a hench run: completes and releases the claim, exactly as before", async () => {
    const store = await resolveStore(join(dir, ".rex"));
    await handleClaimTask(store, { id: "t1" }, ctx());

    const out = await handleUpdateTaskStatus(store, dir, {
      id: "t1", status: "completed", resolutionType: "code-change", resolutionDetail: "done",
    }, ctx());
    const body = JSON.parse(out.content[0].text);

    expect(body.completionHeld).toBeUndefined();
    expect(body.newStatus).toBe("completed");
    const item = await (await resolveStore(join(dir, ".rex"))).getItem("t1");
    expect(item?.status).toBe("completed");
    expect(item?.resolutionDetail).toBe("done");
    expect(await openClaimsStore(dir).readClaims()).toEqual([]);
  });

  it("other statuses are not held while a run holds the task", async () => {
    const run = runProcess();
    await openClaimsStore(dir).claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    const store = await resolveStore(join(dir, ".rex"));
    await handleUpdateTaskStatus(store, dir, { id: "t1", status: "deferred" }, ctx());
    expect(await statusOf("t1")).toBe("deferred");
  });
});

describe("rex update --status=completed (CLI)", () => {
  it("while a hench run holds the task: prints the hold and leaves the PRD alone", async () => {
    const run = runProcess();
    await openClaimsStore(dir).claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdUpdate(dir, "t1", { status: "completed" });
      expect(spy.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/recorded, not yet applied/);
    } finally {
      spy.mockRestore();
    }
    expect(await statusOf("t1")).toBe("in_progress");
    expect(treeIsClean()).toBe(true);
    expect((await openClaimsStore(dir).readClaims())[0].pendingCompletion).toBeDefined();
  });

  it("applies the other fields of the same call", async () => {
    const run = runProcess();
    await openClaimsStore(dir).claim("t1", { worktreeRoot, pid: run.pid!, holdsCompletion: true });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdUpdate(dir, "t1", { status: "completed", priority: "high" });
    } finally {
      spy.mockRestore();
    }
    const item = await (await resolveStore(join(dir, ".rex"))).getItem("t1");
    expect(item?.status).toBe("in_progress");
    expect(item?.priority).toBe("high");
  });

  it("without a hench run: completes as before", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdUpdate(dir, "t1", { status: "completed" });
    } finally {
      spy.mockRestore();
    }
    expect(await statusOf("t1")).toBe("completed");
    // No run, so nothing was ever written to the claims file.
    const path = claimsStorePath(dir)!;
    let raw = "";
    try { raw = readFileSync(path, "utf-8"); } catch { /* absent */ }
    expect(raw).not.toMatch(/pendingCompletion/);
  });
});

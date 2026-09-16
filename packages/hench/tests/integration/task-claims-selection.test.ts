/**
 * `ndx work` in one worktree must not pick up what another worktree is
 * working on — and must claim what it picks so the reverse holds too.
 *
 * Real git: the claims store lives in the repository's common dir, and only
 * `git worktree add` creates the situation this guards against. The PRD is a
 * mock store; what is under test is selection and claiming, not the tree.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDItem } from "@n-dx/rex";
import { assembleTaskBrief, getActionableTasks } from "../../src/agent/planning/brief.js";
import { TaskClaims, TaskClaimedElsewhereError } from "../../src/process/task-claims.js";
import { mockStoreWithDefaults } from "../helpers/index.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

const ITEMS: PRDItem[] = [
  {
    id: "e1", title: "Epic", level: "epic", status: "in_progress",
    children: [
      { id: "t-high", title: "High task", level: "task", status: "pending", priority: "high" },
      { id: "t-low", title: "Low task", level: "task", status: "pending", priority: "low" },
    ],
  },
];

let root: string;
let wtA: string;
let wtB: string;
let plain: string;
const children: ChildProcess[] = [];

/** A live process in worktree A holding a claim — this test's own pid would count as "ours". */
function holderIn(worktree: string): TaskClaims {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  children.push(child);
  const base = TaskClaims.forProject(worktree);
  return new TaskClaims(base.store, { worktreeRoot: base.holder.worktreeRoot, pid: child.pid! });
}

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "hench-claims-")));
  wtA = join(root, "a");
  mkdirSync(wtA);
  git(wtA, "init", "--quiet", "--initial-branch=main");
  git(wtA, "commit", "--allow-empty", "--quiet", "-m", "root");
  wtB = join(root, "b");
  git(wtA, "worktree", "add", "--quiet", "-b", "side", wtB);
  plain = join(root, "plain");
  mkdirSync(plain);
});

afterAll(() => {
  for (const c of children) c.kill();
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  const path = TaskClaims.forProject(wtA).store.path;
  if (path && existsSync(path)) rmSync(path);
});

describe("TaskClaims", () => {
  it("is a no-op outside a repository", async () => {
    const claims = TaskClaims.forProject(plain);
    expect(claims.store.path).toBeNull();
    expect(await claims.claim("t-high")).toBeNull();
    expect(await claims.foreignClaims()).toEqual(new Map());
    await claims.releaseAll();
  });

  it("claims, tracks what it holds, and releases everything on releaseAll", async () => {
    const mine = TaskClaims.forProject(wtA);
    expect(await mine.claim("t-high")).toBeNull();
    expect(await mine.claim("t-low")).toBeNull();
    expect([...mine.held]).toEqual(["t-high", "t-low"]);

    const other = TaskClaims.forProject(wtB);
    expect([...(await other.foreignClaims()).keys()].sort()).toEqual(["t-high", "t-low"]);

    await mine.releaseAll();
    expect(mine.held.size).toBe(0);
    expect(await other.foreignClaims()).toEqual(new Map());
  });
});

describe("assembleTaskBrief with claims", () => {
  it("autoselection in worktree B passes over the task worktree A holds, and claims what it picks", async () => {
    const a = holderIn(wtA);
    expect(await a.claim("t-high")).toBeNull();

    const b = TaskClaims.forProject(wtB);
    const { taskId } = await assembleTaskBrief(mockStoreWithDefaults(ITEMS), undefined, { claims: b });
    expect(taskId).toBe("t-low");
    expect([...b.held]).toEqual(["t-low"]);
    // ...so A, selecting next, would skip it.
    expect([...(await a.foreignClaims()).keys()]).toEqual(["t-low"]);
    await b.releaseAll();
  });

  it("an explicit task held by another worktree is refused and names the holder", async () => {
    const a = holderIn(wtA);
    await a.claim("t-high");

    const b = TaskClaims.forProject(wtB);
    const err = await assembleTaskBrief(mockStoreWithDefaults(ITEMS), "t-high", { claims: b }).catch((e) => e);
    expect(err).toBeInstanceOf(TaskClaimedElsewhereError);
    expect(err.message).toContain(wtA);
    expect(err.message).toContain("High task");
    expect(b.held.size).toBe(0);
  });

  it("a retry in the worktree that already holds the task is allowed", async () => {
    const crashed = holderIn(wtA);
    await crashed.claim("t-high");

    const retry = TaskClaims.forProject(wtA);
    const { taskId } = await assembleTaskBrief(mockStoreWithDefaults(ITEMS), "t-high", { claims: retry });
    expect(taskId).toBe("t-high");
    expect([...retry.held]).toEqual(["t-high"]);
    // Autoselect in the same worktree sees it too — it is ours.
    const again = TaskClaims.forProject(wtA);
    const auto = await assembleTaskBrief(mockStoreWithDefaults(ITEMS), undefined, { claims: again });
    expect(auto.taskId).toBe("t-high");
  });

  it("says so when every actionable task is held elsewhere", async () => {
    const a = holderIn(wtA);
    await a.claim("t-high");
    await a.claim("t-low");
    await expect(
      assembleTaskBrief(mockStoreWithDefaults(ITEMS), undefined, { claims: TaskClaims.forProject(wtB) }),
    ).rejects.toThrow("No actionable tasks found in PRD");
  });

  it("without claims, selection is unchanged", async () => {
    const a = holderIn(wtA);
    await a.claim("t-high");
    const { taskId } = await assembleTaskBrief(mockStoreWithDefaults(ITEMS), undefined);
    expect(taskId).toBe("t-high");
  });

  it("the interactive picker leaves held tasks off the menu", async () => {
    const a = holderIn(wtA);
    await a.claim("t-high");
    const menu = await getActionableTasks(mockStoreWithDefaults(ITEMS), undefined, TaskClaims.forProject(wtB));
    expect(menu.map((t) => t.id)).toEqual(["t-low"]);
    const full = await getActionableTasks(mockStoreWithDefaults(ITEMS));
    expect(full.map((t) => t.id)).toEqual(["t-high", "t-low"]);
  });
});

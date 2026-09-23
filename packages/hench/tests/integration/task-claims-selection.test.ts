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
import { openClaimsStore, resolveClaimHolder } from "@n-dx/rex";
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

describe("TaskClaims renewal", () => {
  /** A store whose clock the test controls, so an expiry can be watched moving. */
  function clockedClaims(worktree: string, now: () => number): TaskClaims {
    const holder = resolveClaimHolder(worktree);
    return new TaskClaims(openClaimsStore(worktree, { now }), holder);
  }

  it("moves the expiry forward without changing when the claim was first taken", async () => {
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const mine = clockedClaims(wtA, () => nowMs);
    await mine.claim("t-high");

    // The observer reads on the same clock; on the real one this claim would
    // have expired months ago and been filtered out as dead.
    const observer = clockedClaims(wtB, () => nowMs);
    const before = (await observer.foreignClaims()).get("t-high")!;

    // Most of the four-hour life gone, run still going.
    nowMs += 3 * 60 * 60 * 1000;
    await mine.renewNow();

    const after = (await observer.foreignClaims()).get("t-high")!;
    expect(Date.parse(after.expiresAt)).toBeGreaterThan(Date.parse(before.expiresAt));
    expect(after.claimedAt).toBe(before.claimedAt);
    expect([...mine.held]).toEqual(["t-high"]);
  });

  it("keeps a claim alive past its original expiry", async () => {
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const mine = clockedClaims(wtA, () => nowMs);
    await mine.claim("t-high");

    // Refresh every hour across a run that outlives the default four-hour TTL.
    for (let hour = 1; hour <= 6; hour++) {
      nowMs += 60 * 60 * 1000;
      await mine.renewNow();
    }

    // Six hours in, another worktree must still be told the task is taken.
    const observer = new TaskClaims(openClaimsStore(wtB, { now: () => nowMs }), resolveClaimHolder(wtB));
    expect((await observer.foreignClaims()).has("t-high")).toBe(true);
    await mine.releaseAll();
  });

  it("without renewal the same run loses the task once the TTL passes", async () => {
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const mine = clockedClaims(wtA, () => nowMs);
    await mine.claim("t-high");

    nowMs += 5 * 60 * 60 * 1000;

    const observer = new TaskClaims(openClaimsStore(wtB, { now: () => nowMs }), resolveClaimHolder(wtB));
    expect((await observer.foreignClaims()).has("t-high")).toBe(false);
  });

  it("drops a task another worktree took over, so it is never released by us", async () => {
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const mine = clockedClaims(wtA, () => nowMs);
    await mine.claim("t-high");

    // Our claim lapses, and worktree B — a live process — picks the task up.
    nowMs += 5 * 60 * 60 * 1000;
    const b = holderIn(wtB);
    expect(await b.claim("t-high")).toBeNull();

    await mine.renewNow();
    expect(mine.held.has("t-high")).toBe(false);

    // B still holds it: our releaseAll must not take away someone else's claim.
    await mine.releaseAll();
    expect([...(await TaskClaims.forProject(wtA).foreignClaims()).keys()]).toEqual(["t-high"]);
  });

  it("startRenewal does not hold the process open, and stops on releaseAll", async () => {
    const mine = TaskClaims.forProject(wtA);
    await mine.claim("t-high");
    mine.startRenewal();
    mine.startRenewal(); // idempotent

    // Unref'd timers never appear in process.getActiveResourcesInfo(), so the
    // only reliable observation is the handle itself: scheduled, but not
    // keeping the event loop alive.
    const timerOf = (c: TaskClaims) =>
      (c as unknown as { renewalTimer: NodeJS.Timeout | null }).renewalTimer;
    expect(timerOf(mine)).not.toBeNull();
    expect(timerOf(mine)!.hasRef()).toBe(false);

    await mine.releaseAll();
    expect(mine.held.size).toBe(0);
    expect(timerOf(mine)).toBeNull();
  });
});

describe("TaskClaims in read-only mode", () => {
  it("reports a free task as free but writes nothing", async () => {
    const preview = TaskClaims.forProject(wtA, { readOnly: true });
    expect(await preview.claim("t-high")).toBeNull();
    expect(preview.held.size).toBe(0);

    // No claim reached the store, so another worktree sees the task as free.
    expect(await TaskClaims.forProject(wtB).foreignClaims()).toEqual(new Map());
  });

  it("still reports a task another worktree holds", async () => {
    const a = holderIn(wtA);
    await a.claim("t-high");

    const preview = TaskClaims.forProject(wtB, { readOnly: true });
    const refusedBy = await preview.claim("t-high");
    expect(refusedBy?.worktreeRoot).toBe(a.holder.worktreeRoot);
    expect(preview.held.size).toBe(0);
  });

  it("does not start a renewal timer", async () => {
    const preview = TaskClaims.forProject(wtA, { readOnly: true });
    await preview.claim("t-high");
    preview.startRenewal();
    await preview.renewNow();
    expect(preview.held.size).toBe(0);
    expect(await TaskClaims.forProject(wtB).foreignClaims()).toEqual(new Map());
  });

  it("a dry run leaves no claim behind for a real run elsewhere", async () => {
    // The preview selects and "claims" exactly as a real run would...
    const preview = TaskClaims.forProject(wtA, { readOnly: true });
    const { taskId } = await assembleTaskBrief(mockStoreWithDefaults(ITEMS), undefined, { claims: preview });
    expect(taskId).toBe("t-high");

    // ...and a real run in the other worktree is free to take it.
    const real = TaskClaims.forProject(wtB);
    expect(await real.claim("t-high")).toBeNull();
    await real.releaseAll();
  });
});

// ── Claim lost mid-run (0.7.1 PR F) ─────────────────────────────────────────
//
// Renewal noticing a takeover is the only moment anything learns about it, and
// the run deliberately carries on. So the event has to be emitted there, or it
// is not recorded anywhere at all.

describe("TaskClaims claim-lost events", () => {
  function clocked(worktree: string, now: () => number): TaskClaims {
    const base = TaskClaims.forProject(worktree);
    return new TaskClaims(openClaimsStore(worktree, { now }), base.holder);
  }

  it("emits the takeover, naming the task and the worktree that now holds it", async () => {
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const mine = clocked(wtA, () => nowMs);
    await mine.claim("t-high");

    const seen: Array<{ taskId: string; holderWorktree: string; at: string }> = [];
    mine.onClaimLost = (e) => seen.push(e);

    nowMs += 5 * 60 * 60 * 1000;
    const b = holderIn(wtB);
    expect(await b.claim("t-high")).toBeNull();

    await mine.renewNow();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ taskId: "t-high", holderWorktree: b.holder.worktreeRoot });
    expect(Number.isFinite(Date.parse(seen[0]!.at))).toBe(true);
    // Also kept on the instance, so a caller that attached no listener can
    // still find out afterwards.
    expect(mine.claimLost).toMatchObject({ taskId: "t-high" });
  });

  it("says nothing when renewal succeeds", async () => {
    const mine = TaskClaims.forProject(wtA);
    await mine.claim("t-high");
    const seen: unknown[] = [];
    mine.onClaimLost = (e) => seen.push(e);

    await mine.renewNow();

    expect(seen).toEqual([]);
    expect(mine.claimLost).toBeNull();
    await mine.releaseAll();
  });

  it("keeps refreshing the rest when a listener throws", async () => {
    let nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const mine = clocked(wtA, () => nowMs);
    await mine.claim("t-high");
    await mine.claim("t-low");
    mine.onClaimLost = () => { throw new Error("listener blew up"); };

    nowMs += 5 * 60 * 60 * 1000;
    const b = holderIn(wtB);
    await b.claim("t-high");

    // Must not reject, and t-low must survive the pass.
    await expect(mine.renewNow()).resolves.toBeUndefined();
    expect(mine.held.has("t-high")).toBe(false);
    expect(mine.held.has("t-low")).toBe(true);
  });
});

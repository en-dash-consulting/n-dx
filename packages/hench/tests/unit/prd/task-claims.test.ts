/**
 * This process's ledger of cross-worktree task claims.
 *
 * The store's own semantics are rex's to test. What belongs here is the part
 * hench owns: that a claim taken during a run is given back when the run ends —
 * by any route — and that losing the race names the worktree that won it.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openClaimsStore } from "../../../src/prd/rex-gateway.js";
import { getWorktreeRoot } from "../../../src/prd/llm-gateway.js";
import {
  claimTask,
  releaseTask,
  releaseAllTaskClaims,
  claimedElsewhere,
  resetTaskClaimLedger,
} from "../../../src/prd/task-claims.js";

/** A live PID that is not this process, so its claims read as someone else's. */
const LIVE_FOREIGN_PID = process.ppid;

describe("task claims", () => {
  const tmpDirs: string[] = [];

  beforeEach(() => resetTaskClaimLedger());

  afterEach(async () => {
    resetTaskClaimLedger();
    vi.useRealTimers();
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "hench-claims-"));
    tmpDirs.push(dir);
    execFileSync("git", ["init", "--quiet"], { cwd: dir, stdio: "ignore" });
    return dir;
  }

  it("claims a task and reports no blocking holder", async () => {
    const repo = await makeRepo();
    expect(await claimTask(repo, "task-1")).toBeNull();
    expect(await openClaimsStore(repo).readClaims()).toHaveLength(1);
  });

  it("names the worktree that already holds the task", async () => {
    const repo = await makeRepo();
    await openClaimsStore(repo).claim("task-1", {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: "/elsewhere/checkout",
    });

    const holder = await claimTask(repo, "task-1");
    expect(holder?.worktreeRoot).toBe("/elsewhere/checkout");
  });

  it("names another live process in this worktree", async () => {
    const repo = await makeRepo();
    await openClaimsStore(repo).claim("task-1", { pid: LIVE_FOREIGN_PID });

    const holder = await claimTask(repo, "task-1");
    expect(holder?.worktreeRoot).toBe(getWorktreeRoot(repo) ?? repo);
  });

  it("releases a single claim", async () => {
    const repo = await makeRepo();
    await claimTask(repo, "task-1");
    await releaseTask(repo, "task-1");

    expect(await openClaimsStore(repo).readClaims()).toEqual([]);
  });

  it("releases every claim this process took, in one call", async () => {
    // The finalization path: one call in `finally` has to cover whichever task
    // the run was on, without each exit path tracking it.
    const repo = await makeRepo();
    await claimTask(repo, "task-1");
    await claimTask(repo, "task-2");

    await releaseAllTaskClaims(repo);
    expect(await openClaimsStore(repo).readClaims()).toEqual([]);
  });

  it("keeps a linked worktree from taking a live claim past its original ttl", async () => {
    const repo = await makeRepo();
    execFileSync(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init", "--quiet"],
      { cwd: repo, stdio: "ignore" },
    );
    const linkedParent = await mkdtemp(join(tmpdir(), "hench-claims-wt-"));
    tmpDirs.push(linkedParent);
    const linked = join(linkedParent, "wt");
    execFileSync("git", ["worktree", "add", "--quiet", "--detach", linked], {
      cwd: repo,
      stdio: "ignore",
    });

    const startedAt = new Date("2026-09-16T12:00:00.000Z");
    const ttlMs = 90;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(startedAt);

    try {
      await claimTask(repo, "task-1", { ttlMs });
      const originalExpiry = Date.parse((await openClaimsStore(repo).readClaims())[0]!.expiresAt);

      await vi.advanceTimersByTimeAsync(ttlMs / 3 + 1);
      let renewed = (await openClaimsStore(linked).readClaims())[0];
      for (let attempt = 0; attempt < 20 && Date.parse(renewed?.expiresAt ?? "") <= originalExpiry; attempt += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        renewed = (await openClaimsStore(linked).readClaims())[0];
      }
      expect(Date.parse(renewed!.expiresAt)).toBeGreaterThan(originalExpiry);

      await vi.advanceTimersByTimeAsync(ttlMs - ttlMs / 3);
      expect(await openClaimsStore(linked).claim("task-1")).toBe(false);
    } finally {
      await releaseAllTaskClaims(repo);
    }
  });

  it("stops renewal when a claim is released or the run finalizes", async () => {
    const repo = await makeRepo();
    const ttlMs = 90;
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-09-16T12:00:00.000Z"));

    await claimTask(repo, "released", { ttlMs });
    await claimTask(repo, "finalized", { ttlMs });
    await releaseTask(repo, "released");
    await releaseAllTaskClaims(repo);

    await vi.advanceTimersByTimeAsync(ttlMs * 2);

    const competitor = openClaimsStore(repo);
    expect(await competitor.claim("released", {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: "/elsewhere/checkout",
    })).toBe(true);
    expect(await competitor.claim("finalized", {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: "/elsewhere/checkout",
    })).toBe(true);
  });

  it("leaves another worktree's claims alone when releasing ours", async () => {
    const repo = await makeRepo();
    await openClaimsStore(repo).claim("theirs", {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: "/elsewhere/checkout",
    });
    await claimTask(repo, "ours");

    await releaseAllTaskClaims(repo);
    const left = await openClaimsStore(repo).readClaims();
    expect(left.map((c) => c.taskId)).toEqual(["theirs"]);
  });

  it("is a no-op when nothing was claimed", async () => {
    const repo = await makeRepo();
    await expect(releaseAllTaskClaims(repo)).resolves.toBeUndefined();
  });

  it("does not release the same claim twice after the ledger is cleared", async () => {
    // A second release call in a nested finally must not walk the file again.
    const repo = await makeRepo();
    await claimTask(repo, "task-1");
    await releaseAllTaskClaims(repo);
    await openClaimsStore(repo).claim("task-1", {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: "/elsewhere/checkout",
    });

    await releaseAllTaskClaims(repo);
    expect(await openClaimsStore(repo).readClaims()).toHaveLength(1);
  });

  it("reports other worktrees' claims for selection to skip", async () => {
    const repo = await makeRepo();
    await openClaimsStore(repo).claim("theirs", {
      pid: LIVE_FOREIGN_PID,
      worktreeRoot: "/elsewhere/checkout",
    });
    await claimTask(repo, "ours");

    const elsewhere = await claimedElsewhere(repo);
    expect([...elsewhere.keys()]).toEqual(["theirs"]);
  });

  it("never blocks work outside a git repository", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hench-claims-plain-"));
    tmpDirs.push(dir);

    expect(await claimTask(dir, "task-1")).toBeNull();
    expect(await claimedElsewhere(dir)).toEqual(new Map());
    await expect(releaseAllTaskClaims(dir)).resolves.toBeUndefined();
  });
});

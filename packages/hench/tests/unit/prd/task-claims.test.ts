/**
 * This process's ledger of cross-worktree task claims.
 *
 * The store's own semantics are rex's to test. What belongs here is the part
 * hench owns: that a claim taken during a run is given back when the run ends —
 * by any route — and that losing the race names the worktree that won it.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openClaimsStore } from "../../../src/prd/rex-gateway.js";
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

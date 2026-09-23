/**
 * Two worktrees of one repository share the claims store, so a task one of
 * them is working on is not what the other is told to work on next.
 *
 * Worktree A claims task T; `rex next` and the `get_next_task` MCP handler in
 * worktree B pass over T and say why. Inside worktree A the task remains
 * selectable — a retry in the checkout that holds it is not a conflict.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdNext } from "../../src/cli/commands/next.js";
import { handleClaimTask, handleGetNextTask, handleReleaseTask, handleUpdateTaskStatus } from "../../src/cli/mcp-tools.js";
import { openClaimsStore, resolveClaimHolder } from "../../src/store/claims.js";
import {
  resolveStore,
  serializeFolderTree,
  PRD_TREE_DIRNAME,
  TREE_META_FILENAME,
  SLUG_RULE_VERSION,
} from "../../src/store/index.js";
import { findNextTask, collectCompletedIds } from "../../src/core/next-task.js";
import type { PRDDocument } from "../../src/schema/index.js";

const PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Claims",
  items: [
    {
      id: "e1", title: "Epic", level: "epic", status: "in_progress",
      children: [
        { id: "t-high", title: "High task", level: "task", status: "pending", priority: "high", acceptanceCriteria: [] },
        { id: "t-low", title: "Low task", level: "task", status: "pending", priority: "low", acceptanceCriteria: [] },
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

let root: string;
let wtA: string;
let wtB: string;
const children: ChildProcess[] = [];

beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "rex-claims-select-")));
  wtA = join(root, "a");
  mkdirSync(wtA);
  git(wtA, "init", "--quiet", "--initial-branch=main");
  await serializeFolderTree(PRD.items, join(wtA, ".rex", PRD_TREE_DIRNAME));
  // `serializeFolderTree` writes the tree but not the sidecar, and a tree with
  // no slug-rule marker is refused by every writer — including the MCP
  // handlers under test here.
  writeFileSync(
    join(wtA, ".rex", TREE_META_FILENAME),
    JSON.stringify({ title: PRD.title, schema: PRD.schema, slugRule: SLUG_RULE_VERSION }),
    "utf-8",
  );
  git(wtA, "add", "-A");
  git(wtA, "commit", "--quiet", "-m", "prd");
  wtB = join(root, "b");
  git(wtA, "worktree", "add", "--quiet", "-b", "side", wtB);
});

afterAll(() => {
  for (const c of children) c.kill();
  rmSync(root, { recursive: true, force: true });
});

function jsonFrom(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  for (const [line] of spy.mock.calls) {
    try { return JSON.parse(String(line)); } catch { /* not the JSON line */ }
  }
  throw new Error("no JSON output");
}

describe("findNextTask excludeIds", () => {
  it("passes over excluded ids without treating them as completed", () => {
    const completed = collectCompletedIds(PRD.items);
    expect(findNextTask(PRD.items, completed)?.item.id).toBe("t-high");
    expect(findNextTask(PRD.items, completed, { excludeIds: new Set(["t-high"]) })?.item.id).toBe("t-low");
    expect(findNextTask(PRD.items, completed, { excludeIds: new Set(["t-high", "t-low"]) })).toBeNull();
  });
});

describe("selection across two worktrees", () => {
  it("worktree B skips the task worktree A holds; A still sees it", async () => {
    // A live process in worktree A holds the claim — a claim from this test's
    // own pid would count as "ours" everywhere.
    const holderA = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    children.push(holderA);
    const claimsA = openClaimsStore(wtA);
    const claimed = await claimsA.claim("t-high", { worktreeRoot: resolveClaimHolder(wtA).worktreeRoot, pid: holderA.pid! });
    expect(claimed.ok).toBe(true);

    // rex next in B → the unclaimed task, and the skipped claim reported.
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await cmdNext(wtB, { format: "json" });
      const out = jsonFrom(spy);
      expect((out.item as { id: string }).id).toBe("t-low");
      expect(out.skippedClaimed).toEqual([
        expect.objectContaining({ taskId: "t-high", worktreeRoot: wtA, pid: holderA.pid }),
      ]);

      // Human output names the count, and --verbose the ids.
      spy.mockClear();
      await cmdNext(wtB, {});
      const plain = spy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(plain).toContain("Low task");
      expect(plain).toContain("Claimed elsewhere: 1 task(s)");
      expect(plain).not.toContain("t-high —");
      spy.mockClear();
      await cmdNext(wtB, { verbose: "true" });
      const verbose = spy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(verbose).toContain("t-high");
      expect(verbose).toContain(wtA);

      // In A itself the claimed task is still the next task.
      spy.mockClear();
      await cmdNext(wtA, { format: "json" });
      const inA = jsonFrom(spy);
      expect((inA.item as { id: string }).id).toBe("t-high");
      expect(inA.skippedClaimed).toEqual([]);
    } finally {
      spy.mockRestore();
    }

    // The MCP handler with B's claims context makes the same choice.
    const storeB = await resolveStore(join(wtB, ".rex"));
    const mcp = await handleGetNextTask(storeB, undefined, {
      store: openClaimsStore(wtB),
      worktreeRoot: resolveClaimHolder(wtB).worktreeRoot,
    });
    const body = JSON.parse(mcp.content[0].text);
    expect(body.item.id).toBe("t-low");
    expect(body.skippedClaimed[0]).toMatchObject({ taskId: "t-high", worktreeRoot: wtA });

    // Without a claims context (or outside a repo) nothing is skipped.
    const bare = JSON.parse((await handleGetNextTask(storeB)).content[0].text);
    expect(bare.item.id).toBe("t-high");
    expect(bare.skippedClaimed).toBeUndefined();

    // Once A releases, B is offered the task again.
    await claimsA.release("t-high", { worktreeRoot: wtA });
    const after = JSON.parse((await handleGetNextTask(storeB, undefined, {
      store: openClaimsStore(wtB),
      worktreeRoot: resolveClaimHolder(wtB).worktreeRoot,
    })).content[0].text);
    expect(after.item.id).toBe("t-high");
  });

  it("says when every remaining task is claimed elsewhere", async () => {
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
    children.push(holder);
    const claimsA = openClaimsStore(wtA);
    for (const id of ["t-high", "t-low"]) {
      await claimsA.claim(id, { worktreeRoot: wtA, pid: holder.pid! });
    }
    const storeB = await resolveStore(join(wtB, ".rex"));
    const body = JSON.parse((await handleGetNextTask(storeB, undefined, {
      store: openClaimsStore(wtB), worktreeRoot: wtB,
    })).content[0].text);
    expect(body.next).toBeNull();
    expect(body.message).toContain("2 claimed elsewhere");
    expect(body.skippedClaimed).toHaveLength(2);
    for (const id of ["t-high", "t-low"]) await claimsA.release(id, { worktreeRoot: wtA });
  });
});

/**
 * The MCP path must *write* claims, not only read them.
 *
 * `get_next_task` has skipped claimed tasks since claims existed, but nothing
 * on this path ever took one: only `hench run` did. So two assistants in two
 * worktrees each asked for the next task, each saw it unclaimed, and both
 * worked it — the exact collision the store was built to prevent, still open
 * on the `/ndx-work` route.
 */
describe("claims on the MCP path", () => {
  const ctxFor = (wt: string) => ({ store: openClaimsStore(wt), worktreeRoot: resolveClaimHolder(wt).worktreeRoot });

  it("claim_task holds a task, and the other worktree stops being offered it", async () => {
    const storeA = await resolveStore(join(wtA, ".rex"));
    const storeB = await resolveStore(join(wtB, ".rex"));

    const before = JSON.parse((await handleGetNextTask(storeB, undefined, ctxFor(wtB))).content[0].text);
    expect(before.item.id, "B's first choice with nothing claimed").toBe("t-high");

    const claimed = JSON.parse((await handleClaimTask(storeA, { id: "t-high" }, ctxFor(wtA))).content[0].text);
    expect(claimed).toMatchObject({ id: "t-high", claimed: true, worktreeRoot: wtA });

    const after = JSON.parse((await handleGetNextTask(storeB, undefined, ctxFor(wtB))).content[0].text);
    expect(after.item.id, "B now passes over the claimed task").toBe("t-low");

    const released = JSON.parse((await handleReleaseTask({ id: "t-high" }, ctxFor(wtA))).content[0].text);
    expect(released).toEqual({ id: "t-high", released: true });
    expect(JSON.parse((await handleGetNextTask(storeB, undefined, ctxFor(wtB))).content[0].text).item.id).toBe("t-high");
  });

  it("update_task_status takes the claim when a task starts and gives it back when it ends", async () => {
    const storeA = await resolveStore(join(wtA, ".rex"));
    const storeB = await resolveStore(join(wtB, ".rex"));

    const started = JSON.parse(
      (await handleUpdateTaskStatus(storeA, wtA, { id: "t-high", status: "in_progress" }, ctxFor(wtA))).content[0].text,
    );
    expect(started.claim, "starting work records the claim").toMatchObject({ worktreeRoot: wtA, pid: process.pid });
    expect(JSON.parse((await handleGetNextTask(storeB, undefined, ctxFor(wtB))).content[0].text).item.id).toBe("t-low");

    await handleUpdateTaskStatus(
      storeA, wtA,
      { id: "t-high", status: "completed", resolutionType: "code-change", resolutionDetail: "done" },
      ctxFor(wtA),
    );
    const claimsLeft = await openClaimsStore(wtA).readClaims();
    expect(claimsLeft.map((c) => c.taskId), "a finished task must not stay claimed for the TTL").not.toContain("t-high");

    // Put the task back for the next test.
    await handleUpdateTaskStatus(storeA, wtA, { id: "t-high", status: "pending", force: true }, ctxFor(wtA));
  });

  /**
   * Both contexts in *this* process, with no spawned child.
   *
   * That is the dashboard: `ndx start` builds a rex MCP server per workspace
   * inside one server process, and the handlers claim without passing a pid,
   * so every worktree's claim carries the same one. An earlier version of this
   * test spawned a child purely to obtain a distinct pid — which meant it
   * passed while the production condition stayed broken, because `sameHolder`
   * read a matching pid as "already ours" whatever worktree it came from.
   */
  it("refuses to start a task another worktree is holding, with both servers in one process", async () => {
    const storeA = await resolveStore(join(wtA, ".rex"));
    const storeB = await resolveStore(join(wtB, ".rex"));

    const held = await handleClaimTask(storeA, { id: "t-high" }, ctxFor(wtA));
    expect(JSON.parse(held.content[0].text).claimed).toBe(true);

    const refused = await handleUpdateTaskStatus(storeB, wtB, { id: "t-high", status: "in_progress" }, ctxFor(wtB));
    expect(refused.isError, "B must not be allowed to start a task A holds").toBe(true);
    expect(refused.content[0].text).toContain(wtA);
    expect((await storeB.getItem("t-high"))?.status, "and the status is left alone").not.toBe("in_progress");

    // Nor may B take the claim by asking for it directly, or drop A's.
    const stolen = await handleClaimTask(storeB, { id: "t-high" }, ctxFor(wtB));
    expect(stolen.isError).toBe(true);
    expect(JSON.parse((await handleReleaseTask({ id: "t-high" }, ctxFor(wtB))).content[0].text).released).toBe(false);
    expect((await openClaimsStore(wtA).readClaims())[0]).toMatchObject({ taskId: "t-high", worktreeRoot: wtA });

    // force is the escape hatch for a run the operator knows is finished.
    const forced = await handleUpdateTaskStatus(storeB, wtB, { id: "t-high", status: "in_progress", force: true }, ctxFor(wtB));
    expect(forced.isError).toBeFalsy();
    expect((await storeB.getItem("t-high"))?.status).toBe("in_progress");

    await openClaimsStore(wtA).release("t-high", { worktreeRoot: wtA });
    await openClaimsStore(wtB).release("t-high", { worktreeRoot: wtB });
  });

  it("is a no-op outside a repository — no claims context, no refusal", async () => {
    const storeA = await resolveStore(join(wtA, ".rex"));
    const out = await handleUpdateTaskStatus(storeA, wtA, { id: "t-low", status: "in_progress" }, undefined);
    expect(out.isError).toBeFalsy();
    expect(JSON.parse(out.content[0].text).claim).toBeUndefined();
  });
});

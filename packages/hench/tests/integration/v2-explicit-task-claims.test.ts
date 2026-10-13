/**
 * `ndx work --task=<id>` on a v2 tree: a claim another worktree holds on the
 * task's enclosing change covers the task, as it does in rex's claim_task.
 * The claims store is an in-memory stub; what is under test is selectTaskEntry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore } from "@n-dx/rex";
import type { ClaimsStore, TaskClaim } from "@n-dx/rex";
import { selectTaskEntry } from "../../src/agent/planning/brief.js";
import { loadV2Tree } from "../../src/agent/planning/work-selection.js";
import { TaskClaims, TaskClaimedElsewhereError } from "../../src/process/task-claims.js";
import { RM_RETRY } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";
const MINE = "/work/b";
const THEIRS = "/work/a";

let root: string;
let rexDir: string;

function claimOf(taskId: string, worktreeRoot: string): TaskClaim {
  return { taskId, worktreeRoot, pid: 4242, expiresAt: "2099-01-01T00:00:00.000Z" } as TaskClaim;
}

/** Claims keyed by task id; `claimed` records what this run asked to claim. */
function claimsWith(existing: TaskClaim[]): { claims: TaskClaims; claimed: string[] } {
  const claimed: string[] = [];
  const store = {
    claimedElsewhere: async (worktree: string) =>
      new Map(existing.filter((c) => c.worktreeRoot !== worktree).map((c) => [c.taskId, c])),
    isClaimedByOther: async () => null,
    claim: async (taskId: string) => {
      claimed.push(taskId);
      return { ok: true, claim: claimOf(taskId, MINE) };
    },
  } as unknown as ClaimsStore;
  return { claims: new TaskClaims(store, { worktreeRoot: MINE, pid: process.pid }), claimed };
}

async function select(claims: TaskClaims) {
  const s = await resolveStore(rexDir);
  const tree = (await loadV2Tree(s))!;
  return selectTaskEntry((await s.loadDocument()).items, { tree, taskId: WIRE_ID, claims });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hench-v2-explicit-claims-"));
  rexDir = join(root, ".rex");
  await cp(FIXTURE, rexDir, { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, ...RM_RETRY });
});

describe("explicit --task on a v2 tree", () => {
  it("is refused when another worktree claims the enclosing change, and claims nothing", async () => {
    const { claims, claimed } = claimsWith([claimOf(CHANGE_ID, THEIRS)]);
    const err = await select(claims).catch((e) => e);
    expect(err).toBeInstanceOf(TaskClaimedElsewhereError);
    expect(err.taskId).toBe(CHANGE_ID);
    expect(err.message).toContain("Add Apple Pay");
    expect(err.message).toContain(THEIRS);
    expect(claimed).toEqual([]);
  });

  it("claims the task when its change is unclaimed", async () => {
    const { claims, claimed } = claimsWith([]);
    expect((await select(claims)).item.id).toBe(WIRE_ID);
    expect(claimed).toEqual([WIRE_ID]);
  });

  it("claims the task when its change is claimed by this worktree", async () => {
    const { claims, claimed } = claimsWith([claimOf(CHANGE_ID, MINE)]);
    expect((await select(claims)).item.id).toBe(WIRE_ID);
    expect(claimed).toEqual([WIRE_ID]);
  });
});

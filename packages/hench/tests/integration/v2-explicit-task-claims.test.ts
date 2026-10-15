/**
 * `ndx work --task=<id>` on a v2 tree: a claim another worktree holds on the
 * task's enclosing change covers the task, as it does in rex's claim_task;
 * a ref naming a change with open tasks runs and claims one of those tasks.
 * The claims store is an in-memory stub; what is under test is selectTaskEntry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { appendFile, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore } from "@n-dx/rex";
import type { ClaimsStore, TaskClaim } from "@n-dx/rex";
import { selectTaskEntry } from "../../src/agent/planning/brief.js";
import { ChangeTasksUnavailableError, loadV2Tree } from "../../src/agent/planning/work-selection.js";
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

async function select(claims: TaskClaims, taskId = WIRE_ID) {
  const s = await resolveStore(rexDir);
  const tree = (await loadV2Tree(s))!;
  return selectTaskEntry((await s.loadDocument()).items, { tree, taskId, claims });
}

const CHANGE_DIR = () => join(rexDir, "changes", "add-apple-pay");
const SHIP_ID = "c0000000-0000-4000-8000-000000000003";

/** A second task under CH-1, after the fixture's WIRE. */
async function addShipTask(extra = ""): Promise<void> {
  await writeFile(
    join(CHANGE_DIR(), "ship-it.md"),
    `---\nid: "${SHIP_ID}"\ntype: "task"\ntitle: "Ship it"\nslug: "ship-it"\n${extra}---\n`,
  );
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

describe("explicit --task naming a v2 change with open tasks", () => {
  it("runs and claims the change's next task, never the change", async () => {
    const { claims, claimed } = claimsWith([]);
    expect((await select(claims, "CH-1")).item.id).toBe(WIRE_ID);
    expect(claimed).toEqual([WIRE_ID]);
  });

  it("passes over a task another worktree holds and claims the next one", async () => {
    await addShipTask();
    const { claims, claimed } = claimsWith([claimOf(WIRE_ID, THEIRS)]);
    expect((await select(claims, "CH-1")).item.id).toBe(SHIP_ID);
    expect(claimed).toEqual([SHIP_ID]);
  });

  it("is refused, naming each task, when every open task is claimed elsewhere or blocked", async () => {
    await addShipTask(`blockedBy: ["${WIRE_ID}"]\n`);
    const { claims, claimed } = claimsWith([claimOf(WIRE_ID, THEIRS)]);
    const err = await select(claims, "CH-1").catch((e) => e);
    expect(err).toBeInstanceOf(ChangeTasksUnavailableError);
    expect(err.allClaimed).toBe(false);
    expect(err.message).toContain(`"Wire the button" (claimed by another worktree: ${THEIRS})`);
    expect(err.message).toContain(`"Ship it" (pending, blocked by ${WIRE_ID})`);
    expect(claimed).toEqual([]);
  });

  it("names a task's status when that is why it cannot run", async () => {
    await addShipTask();
    await appendFile(join(CHANGE_DIR(), "state.yaml"), `  "${SHIP_ID}":\n    status: "deferred"\n`);
    const { claims } = claimsWith([claimOf(WIRE_ID, THEIRS)]);
    const err = await select(claims, "CH-1").catch((e) => e);
    expect(err).toBeInstanceOf(ChangeTasksUnavailableError);
    expect(err.message).toContain(`"Ship it" (deferred)`);
  });

  it("says all are claimed when they are", async () => {
    const { claims, claimed } = claimsWith([claimOf(WIRE_ID, THEIRS)]);
    const err = await select(claims, "CH-1").catch((e) => e);
    expect(err).toBeInstanceOf(ChangeTasksUnavailableError);
    expect(err.allClaimed).toBe(true);
    expect(claimed).toEqual([]);
  });

  it("is refused when another worktree claims the change itself, claiming nothing", async () => {
    const { claims, claimed } = claimsWith([claimOf(CHANGE_ID, THEIRS)]);
    const err = await select(claims, "CH-1").catch((e) => e);
    expect(err).toBeInstanceOf(TaskClaimedElsewhereError);
    expect(err.taskId).toBe(CHANGE_ID);
    expect(claimed).toEqual([]);
  });

  it("runs a task-less change as one unit, claiming the change", async () => {
    await rm(join(CHANGE_DIR(), "wire-the-button.md"));
    const { claims, claimed } = claimsWith([]);
    expect((await select(claims, "CH-1")).item.id).toBe(CHANGE_ID);
    expect(claimed).toEqual([CHANGE_ID]);
  });
});

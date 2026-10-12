/**
 * hench's status, completion and claim writes on a v2 tree (product/ + changes/).
 *
 * Completion goes through rex's v2 runtime (`completeV2Work`), the entry point
 * `update_task_status` uses on v2: completing the last task of a pending change
 * completes the change and, under the default `rex.applyOn: complete`, applies
 * its amendments to the product layer in the same write. Every other status
 * write goes through the change-layer store. No write reaches a v1 FileStore
 * and nothing creates `prd_tree/`.
 *
 * Every test works on a temp copy of rex's v2 fixture inside a git repository
 * (claims live in the git common dir), so writes never touch the fixture.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { completedWorkIds, isChangeLayerStore, loadPrdModel, openClaimsStore, resolveStore, PRD_TREE_DIRNAME } from "@n-dx/rex";
import type { PRDStore } from "@n-dx/rex";
import { FileStore } from "@n-dx/rex/dist/store/file-adapter.js";
import { toolRexUpdateStatus } from "../../src/tools/rex.js";
import { updateCompletedTaskStatus } from "../../src/agent/lifecycle/shared.js";
import { selectTaskEntry } from "../../src/agent/planning/brief.js";
import { loadV2Tree } from "../../src/agent/planning/work-selection.js";
import { TaskClaims, TaskClaimedElsewhereError } from "../../src/process/task-claims.js";
import type { RunRecord } from "../../src/schema/index.js";
import { cleanupProjectDir, initGitFixtureRepo } from "../helpers/index.js";

const FIXTURE = join(import.meta.dirname, "../../../rex/tests/fixtures/v2-tree");

/** The fixture's change, CH-1 (high priority); amends capability "Pay by card". */
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
/** Its only task, "Wire the button". */
const WIRE_ID = "c0000000-0000-4000-8000-000000000002";
/** A task-less change this suite adds: the change itself is the unit of work. */
const SOLO_ID = "c0000000-0000-4000-8000-0000000000f0";
/** The criterion CH-1's amendment adds to "Pay by card". */
const AMENDED_CRITERION = "Apple Pay is offered on Safari";

const FILESTORE_WRITES = ["saveDocument", "updateItem", "addItem", "removeItem", "withTransaction"] as const;

let projectDir: string;
let rexDir: string;
let fileStoreWrites: Array<ReturnType<typeof vi.spyOn>>;

/** CH-1 pending with its task in progress: the state a run leaves before it completes the task. */
async function startWireTask(): Promise<void> {
  await writeFile(
    join(rexDir, "changes", "add-apple-pay", "state.yaml"),
    [
      'schema: "rex/v2"',
      "items:",
      `  "${CHANGE_ID}":`,
      '    status: "pending"',
      `  "${WIRE_ID}":`,
      '    status: "in_progress"',
      '    startedAt: "2026-10-01T09:00:00.000Z"',
      "",
    ].join("\n"),
  );
}

async function addSoloChange(): Promise<void> {
  const dir = join(rexDir, "changes", "tidy-the-receipt");
  await mkdir(dir);
  await writeFile(
    join(dir, "index.md"),
    ["---", `id: "${SOLO_ID}"`, 'type: "change"', 'title: "Tidy the receipt"', 'slug: "tidy-the-receipt"', "---", ""].join("\n"),
  );
}

async function store(): Promise<PRDStore> {
  const s = await resolveStore(rexDir);
  expect(isChangeLayerStore(s)).toBe(true);
  return s;
}

async function capabilityCriteria(): Promise<string[]> {
  const node = (await loadPrdModel(rexDir)).tree.product
    .flatMap((area) => area.children ?? [])
    .find((n) => n.id === "a0000000-0000-4000-8000-000000000002");
  return ((node as { criteria?: Array<{ text: string }> } | undefined)?.criteria ?? []).map((c) => c.text);
}

beforeEach(async () => {
  projectDir = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-v2-complete-")));
  rexDir = join(projectDir, ".rex");
  await initGitFixtureRepo(projectDir);
  await cp(FIXTURE, rexDir, { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "shop", adapter: "file" }));
  fileStoreWrites = FILESTORE_WRITES.map((m) => vi.spyOn(FileStore.prototype, m));
});

afterEach(async () => {
  // The guard every test here holds: no v1 FileStore write, no prd_tree/.
  for (const spy of fileStoreWrites) expect(spy).not.toHaveBeenCalled();
  expect(existsSync(join(rexDir, PRD_TREE_DIRNAME))).toBe(false);
  vi.restoreAllMocks();
  await cleanupProjectDir(projectDir);
});

describe("completion on a v2 tree", () => {
  it("completing the last task completes its change and applies it, as update_task_status does", async () => {
    await startWireTask();
    expect(await capabilityCriteria()).not.toContain(AMENDED_CRITERION);

    const reply = await toolRexUpdateStatus(await store(), WIRE_ID, {
      status: "completed",
      resolutionType: "code-change",
      resolutionDetail: "Wired the button",
    });

    const done = completedWorkIds((await loadPrdModel(rexDir)).tree);
    expect(done.has(WIRE_ID)).toBe(true);
    expect(done.has(CHANGE_ID)).toBe(true);
    expect(await capabilityCriteria()).toContain(AMENDED_CRITERION);
    expect(reply).toContain(`Updated task ${WIRE_ID} status to completed`);
    expect(reply).toContain(`Auto-completed: "Add Apple Pay" (${CHANGE_ID})`);
    expect(reply).toContain(`Change ${CHANGE_ID} applied to the product layer`);

    const task = await (await store()).getItem(WIRE_ID);
    expect(task?.resolutionType).toBe("code-change");
    expect(task?.resolutionDetail).toBe("Wired the button");
    const log = await readFile(join(rexDir, "execution-log.jsonl"), "utf-8");
    expect(log).toMatch(/"event":"change_applied".*c0000000-0000-4000-8000-000000000001/);
    expect(log).toMatch(/"event":"status_updated"/);
  });

  it("applies a held completion after the gate through the same path", async () => {
    await startWireTask();
    const run = { id: randomUUID(), taskId: WIRE_ID, status: "completed", summary: "done" } as RunRecord;

    const applied = await updateCompletedTaskStatus(await store(), WIRE_ID, run, {
      resolutionType: "code-change",
      resolutionDetail: "Wired the button",
    });

    expect(applied).toBe(true);
    const done = completedWorkIds((await loadPrdModel(rexDir)).tree);
    expect(done.has(CHANGE_ID)).toBe(true);
    expect(await capabilityCriteria()).toContain(AMENDED_CRITERION);
  });

  it("writes the other statuses through the change layer", async () => {
    await startWireTask();
    const s = await store();
    await toolRexUpdateStatus(s, WIRE_ID, { status: "failing", reason: "red" });
    expect((await s.getItem(WIRE_ID))?.status).toBe("failing");
    expect((await s.getItem(WIRE_ID))?.failureReason).toBe("red");
    await toolRexUpdateStatus(s, WIRE_ID, { status: "deferred" });
    expect((await s.getItem(WIRE_ID))?.status).toBe("deferred");
    // A deferred task never completes its change.
    expect((await s.getItem(CHANGE_ID))?.status).toBe("pending");
    await toolRexUpdateStatus(s, WIRE_ID, { status: "pending" });
    expect((await s.getItem(WIRE_ID))?.status).toBe("pending");
  });
});

describe("claims on a v2 tree", () => {
  function otherWorktree(): TaskClaims {
    return new TaskClaims(openClaimsStore(projectDir), { worktreeRoot: join(projectDir, "other-worktree"), pid: process.pid });
  }

  it("claims the selected task, and another worktree passes over it to a task-less change", async () => {
    await addSoloChange();
    const here = TaskClaims.forProject(projectDir);
    const there = otherWorktree();
    try {
      const s = await store();
      const items = (await s.loadDocument()).items;
      const tree = await loadV2Tree(s);

      const mine = await selectTaskEntry(items, { tree, claims: here });
      expect(mine.item.id).toBe(WIRE_ID);
      expect(here.held.has(WIRE_ID)).toBe(true);

      const theirs = await selectTaskEntry(items, { tree, claims: there });
      expect(theirs.item.id).toBe(SOLO_ID);
      expect(there.held.has(SOLO_ID)).toBe(true);

      await expect(selectTaskEntry(items, { tree, claims: there, taskId: WIRE_ID }))
        .rejects.toBeInstanceOf(TaskClaimedElsewhereError);
      await expect(selectTaskEntry(items, { tree, claims: here, taskId: SOLO_ID }))
        .rejects.toBeInstanceOf(TaskClaimedElsewhereError);
    } finally {
      await here.releaseAll();
      await there.releaseAll();
    }
  });

  it("holds a completion on the claim and applies it through the v2 runtime", async () => {
    await startWireTask();
    const here = TaskClaims.forProject(projectDir);
    try {
      expect(await here.claim(WIRE_ID)).toBeNull();
      await here.recordPendingCompletion(WIRE_ID, { resolutionType: "code-change", requestedAt: new Date().toISOString() });
      const held = await here.pendingCompletion(WIRE_ID);
      expect(held?.resolutionType).toBe("code-change");
      // Holding wrote nothing to the tree.
      expect((await (await store()).getItem(WIRE_ID))?.status).toBe("in_progress");

      const run = { id: randomUUID(), taskId: WIRE_ID, status: "completed", summary: "done" } as RunRecord;
      await updateCompletedTaskStatus(await store(), WIRE_ID, run, held ?? undefined);
      expect(completedWorkIds((await loadPrdModel(rexDir)).tree).has(CHANGE_ID)).toBe(true);
    } finally {
      await here.releaseAll();
    }
  });
});

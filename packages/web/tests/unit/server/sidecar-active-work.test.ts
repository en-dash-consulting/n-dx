/**
 * What active work holds, for the Sidecar's PRD cards and its session packet:
 * runs and claims, each holding its task and every item above it; a run
 * outranks a claim; a failed read holds nothing.
 */

import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeWorkReads,
  cardItemIds,
  firstHeld,
  heldByText,
  heldItemsOf,
  heldWorkSection,
  readActiveWork,
  type ActiveWorkReads,
} from "../../../src/server/sidecar/active-work.js";
import { sidecarContextOptions } from "../../../src/server/routes-sidecar.js";
import type { SpawnedReads } from "../../../src/server/sidecar/packet-sources.js";
import type { SidecarSessionRecord } from "../../../src/server/sidecar/session-registry.js";
import type { PRDItem } from "../../../src/server/rex-gateway.js";
import type { SidecarHeldBy } from "../../../src/shared/index.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

const item = (id: string, title: string, children: PRDItem[] = []): PRDItem =>
  ({ id, title, status: "pending", level: "task", children } as unknown as PRDItem);

const ITEMS: PRDItem[] = [
  item("change-1", "Change one", [item("task-1", "Task one"), item("task-2", "Task two")]),
  item("change-2", "Change two", [item("task-3", "Task three")]),
];

function reads(over: Partial<ActiveWorkReads> = {}): ActiveWorkReads {
  return { runs: async () => [], claims: async () => [], items: async () => ITEMS, ...over };
}

let root: string | null = null;
afterEach(async () => {
  if (root) await removeTestDir(root);
  root = null;
});

describe("readActiveWork", () => {
  it("holds a running task and the items above it, naming the worktree by its directory", async () => {
    const held = await readActiveWork(reads({ runs: async () => [{ taskId: "task-1", worktree: join("/repo", "wt-a"), runId: "run-9" }] }));
    expect([...held.keys()].sort()).toEqual(["change-1", "task-1"]);
    expect(held.get("task-1")).toEqual({
      itemId: "task-1", taskId: "task-1", taskTitle: "Task one", worktree: "wt-a", worktreePath: join("/repo", "wt-a"), runId: "run-9", source: "run",
    });
    expect(held.get("change-1")).toEqual(expect.objectContaining({ itemId: "change-1", taskId: "task-1", source: "run" }));
  });

  it("holds claimed tasks too, and a run outranks a claim on the same task", async () => {
    const held = await readActiveWork(reads({
      runs: async () => [{ taskId: "task-1", worktree: "/repo/wt-a" }, { taskId: null, worktree: "/repo/wt-c" }],
      claims: async () => [{ taskId: "task-1", worktreeRoot: "/repo/wt-b" }, { taskId: "task-3", worktreeRoot: "/repo/wt-b" }],
    }));
    expect(held.get("task-1")).toEqual(expect.objectContaining({ source: "run", worktree: "wt-a" }));
    expect(held.get("task-3")).toEqual(expect.objectContaining({ source: "claim", worktree: "wt-b" }));
    expect(held.get("change-2")).toEqual(expect.objectContaining({ taskId: "task-3", source: "claim" }));
    // An untagged run holds no item.
    expect([...held.keys()].sort()).toEqual(["change-1", "change-2", "task-1", "task-3"]);
  });

  it("holds nothing when its reads fail, and a task the PRD cannot name only itself", async () => {
    const broken = await readActiveWork(reads({
      runs: async () => { throw new Error("locks unreadable"); },
      claims: async () => { throw new Error("no store"); },
    }));
    expect(broken.size).toBe(0);
    const noPrd = await readActiveWork(reads({ runs: async () => [{ taskId: "task-1", worktree: "/repo/wt-a" }], items: async () => { throw new Error("no PRD"); } }));
    expect([...noPrd.keys()]).toEqual(["task-1"]);
    expect(noPrd.get("task-1")?.taskTitle).toBeUndefined();
  });

  it("finds the change above a task on a real v2 PRD through rex", async () => {
    root = mkdtempSync(join(tmpdir(), "sidecar-active-work-"));
    const rexDir = join(root, ".rex");
    cpSync(resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree"), rexDir, { recursive: true });
    const TASK = "c0000000-0000-4000-8000-000000000002";
    const CHANGE = "c0000000-0000-4000-8000-000000000001";
    // Outside a git repository the claims store holds nothing.
    const held = await readActiveWork(activeWorkReads({ projectDir: root, rexDir }, async () => [{ taskId: TASK, worktree: root! }]));
    expect(held.get(TASK)).toEqual(expect.objectContaining({ source: "run", taskId: TASK }));
    expect(held.get(CHANGE)).toEqual(expect.objectContaining({ itemId: CHANGE, taskId: TASK }));
  });
});

describe("card items", () => {
  it("names the items each PRD card writes to, and none for a card that writes no existing item", () => {
    expect(cardItemIds({ itemEdit: { itemId: "a", itemTitle: "A", before: {}, after: {} } })).toEqual(["a"]);
    expect(cardItemIds({ statusChange: { itemId: "b", itemTitle: "B", from: "pending", to: "deferred", rule: { allowed: true } } })).toEqual(["b"]);
    expect(cardItemIds({ link: { itemId: "c", title: "C", ref: "X-1", label: null } })).toEqual(["c"]);
    expect(cardItemIds({
      placement: { change: "d", request: { action: "place", target: "cap" }, reasons: [], check: { ok: false, kind: "x", error: "y" } },
    })).toEqual(["d"]);
    expect(cardItemIds({
      changeSet: {
        layout: "v1",
        items: [
          { title: "new", type: "task", parentId: "e" },
          { title: "dupe", type: "task", parentId: "e", duplicate: { id: "f", title: "F", type: "task", status: "pending" } },
          { title: "child", type: "subtask", parent: 0 },
        ],
      },
    })).toEqual(["e", "f"]);
    expect(cardItemIds({})).toEqual([]);
  });

  it("picks the first held item and words it", () => {
    const held = heldItemsOf([{ taskId: "task-1", worktreePath: "/repo/wt-a", source: "run" }], ITEMS);
    expect(firstHeld(held, ["task-2", "change-1"])?.itemId).toBe("change-1");
    expect(firstHeld(held, ["task-2"])).toBeNull();
    expect(heldByText(held.get("change-1")!)).toBe("held by an active run on task task-1 (Task one) in wt-a — change-1 is above that task");
  });
});

describe("the packet's held section", () => {
  it("is empty with nothing held, and lists each held task with the items above it", () => {
    expect(heldWorkSection(new Map(), "2026-11-20T00:00:00.000Z")).toBe("");
    const held = heldItemsOf([
      { taskId: "task-1", worktreePath: "/repo/wt-a", source: "run" },
      { taskId: "task-3", worktreePath: "/repo/wt-b", source: "claim" },
    ], ITEMS);
    const text = heldWorkSection(held, "2026-11-20T00:00:00.000Z");
    expect(text.split("\n")[0]).toBe("## Items active work holds right now");
    expect(text).toContain("- task-1 Task one: running in wt-a; also holds change-1");
    expect(text).toContain("- task-3 Task three: claimed in wt-b; also holds change-2");
    expect(text).toMatch(/Do not propose edits/);
  });

  it("opens every lens's turn with it, General's too", async () => {
    root = mkdtempSync(join(tmpdir(), "sidecar-active-work-"));
    const ctx = { projectDir: root, rexDir: join(root, ".rex"), svDir: join(root, ".sourcevision"), dev: false };
    const held: Map<string, SidecarHeldBy> = heldItemsOf([{ taskId: "task-1", worktreePath: "/repo/wt-a", source: "run" }], ITEMS);
    const record = { id: "s1", lens: "general" } as SidecarSessionRecord;
    const signal = new AbortController().signal;

    const withHeld = sidecarContextOptions(ctx, {} as SpawnedReads, async () => held);
    expect(await withHeld.packet!(record, signal)).toMatch(/^## Items active work holds right now\n/);

    const nothing = sidecarContextOptions(ctx, {} as SpawnedReads, async () => new Map());
    expect(await nothing.packet!(record, signal)).toBeUndefined();

    const failing = sidecarContextOptions(ctx, {} as SpawnedReads, async () => { throw new Error("no"); });
    expect(await failing.packet!(record, signal)).toBeUndefined();
  });
});

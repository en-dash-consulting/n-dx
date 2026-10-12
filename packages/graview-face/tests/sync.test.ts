/**
 * Two-way sync, headless: Graview's engine over the fixture store and a fake
 * door that behaves like the hub's rex. A local edit lands in rex through
 * update_task_status with the principal in the log; a rex-side edit arrives
 * as a system-authored op; a field edited on both sides is settled to rex's
 * value by the engine's own policy and said; a kind another tool owns is
 * refused with the owner's sentence before an act is offered.
 */
import { readFileSync } from "node:fs";
import { PermissionDeniedError, type Principal } from "@graview/core";
import { readSnapshot } from "@graview/core/snapshot";
import { compileDocumentFiles } from "@graview/core/testing";
import type { GraphSnapshot } from "@graview/ship";
import { writeSnapshot } from "@graview/core/snapshot";
import { beforeEach, describe, expect, it } from "vitest";
import { createSync } from "../src/sync/engine.js";
import { because } from "../src/sync/mapping.js";
import { NEVER_DELETES } from "../src/sync/ndx-system.js";

const DECLARATION = new URL("../../graview/n-dx.graview.json", import.meta.url);
const SEED = new URL("./fixtures/snapshot.json", import.meta.url);
const SEAT: Principal = { kind: "human", id: "nick", name: "Nick" } as Principal;

interface Item {
  id: string;
  kind: string;
  status?: string;
  priority?: string;
  title?: string;
  tags?: string[];
  lastModified?: string;
  [k: string]: unknown;
}

/** A fake door: rex as a map of items, the snapshot as what rex would project (in the line format, served by range), a log. */
function fakeDoor(snapshot: GraphSnapshot) {
  const rex = new Map<string, Item>();
  for (const node of snapshot.nodes) if (node.kind === "change" || node.kind === "task") rex.set(node.id, { ...(node as Item) });
  const log: { event: string; itemId?: string; detail?: string }[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const ranges: string[] = [];
  // Rex's rules the fake keeps: a completed item only moves to failing or deleted, and a hench run may hold a completion.
  const held = new Set<string>();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 10, 12, 0, ++clock)).toISOString();
  const touch = (id: string, patch: Partial<Item>) => {
    const item = rex.get(id);
    if (!item) throw new Error(`no item ${id}`);
    Object.assign(item, patch, { lastModified: stamp() });
  };
  const tools: Record<string, (args: Record<string, unknown>) => unknown> = {
    get_item: ({ id }) => {
      const item = rex.get(String(id));
      if (!item) throw new Error(`Item not found: ${String(id)}`);
      return { item };
    },
    update_task_status: ({ id, status }) => {
      const item = rex.get(String(id));
      if (item?.status === "completed" && status !== "failing" && status !== "deleted") throw new Error(`Cannot move from completed to ${String(status)}. Pass force: true to override.`);
      if (status === "deleted") {
        rex.delete(String(id));
        return { id, status };
      }
      if (status === "completed" && held.has(String(id))) return { id, newStatus: item?.status, completionHeld: true, message: `Completion of ${String(id)} is held for the hench run in this worktree until its test gate passes.` };
      touch(String(id), { status: String(status) });
      return { id, status };
    },
    edit_item: ({ id, ...rest }) => {
      touch(String(id), rest as Partial<Item>);
      return { id };
    },
    append_log: (args) => {
      log.push(args as { event: string; itemId?: string; detail?: string });
      return { logged: true };
    },
  };
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/ndx/emit")) return new Response(JSON.stringify({ ok: true, output: "" }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/data/snapshot.json")) {
      const nodes = snapshot.nodes.map((n) => (rex.has(n.id) ? { ...n, ...rex.get(n.id)! } : n));
      const text = writeSnapshot({ nodes, edges: snapshot.edges }, { generatedAt: "2026-10-10T12:00:00.000Z" });
      const range = /^bytes=(\d+)-(\d+)$/.exec(String((init?.headers as Record<string, string> | undefined)?.["range"] ?? ""));
      if (range) {
        ranges.push(range[0]);
        const bytes = new TextEncoder().encode(text);
        const end = Math.min(Number(range[2]), bytes.length - 1);
        return new Response(bytes.slice(Number(range[1]), end + 1), { status: 206, headers: { "content-range": `bytes ${range[1]}-${end}/${bytes.length}` } });
      }
      return new Response(text);
    }
    if (url.endsWith("/ndx/mcp")) {
      const { name, arguments: args } = JSON.parse(String(init?.body ?? "{}")) as { name: string; arguments: Record<string, unknown> };
      calls.push({ name, args });
      try {
        return new Response(JSON.stringify({ ok: true, result: tools[name]!(args) }), { headers: { "content-type": "application/json" } });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }), { headers: { "content-type": "application/json" } });
      }
    }
    return new Response("not found", { status: 404 });
  };
  return { rex, log, calls, ranges, touch, held, fetch: fetchImpl };
}

let snapshot: GraphSnapshot;
beforeEach(() => {
  snapshot = readSnapshot(readFileSync(SEED, "utf-8")).snapshot as GraphSnapshot;
});

async function setUp() {
  const door = fakeDoor(snapshot);
  const store = compileDocumentFiles(DECLARATION, { seed: SEED }).store();
  const sync = createSync({ store, principal: "nick", fetch: door.fetch, base: "http://door" });
  const engine = sync.engine;
  const changes = store.graph.nodesOfKind("change" as never) as unknown as Item[];
  const change = changes.find((c) => c.status !== "completed") ?? changes[0]!;
  return { door, store, engine, sync, change };
}

describe("two-way sync with rex as the system of record", () => {
  it("links every synced record at the version it was projected with, so the first run pushes nothing, and pulls only the two kinds it syncs", async () => {
    const { door, engine } = await setUp();
    const report = await engine.run();
    expect(report.pushed).toEqual([]);
    expect(report.applied).toEqual([]);
    // A record rex never stamped is agreed at no version, not asked to be created.
    expect(snapshot.nodes.some((n) => (n.kind === "change" || n.kind === "task") && typeof (n as Item).lastModified !== "string")).toBe(true);
    expect(report.refused).toEqual([]);
    expect(report.queued).toEqual([]);
    expect(door.calls).toEqual([]);
    // The header first, then the changes' and the tasks' bytes: never the zones, the runs or the commits.
    expect(door.ranges.length).toBeGreaterThanOrEqual(2);
    expect(door.ranges[0]).toBe("bytes=0-65535");
  });

  it("sends a change's new status to rex through update_task_status and logs the principal", async () => {
    const { door, store, engine, change } = await setUp();
    await engine.run();
    store.apply({ name: "edit-change", args: { id: change.id, status: "in_progress" } }, { author: SEAT });
    const report = await engine.run();
    expect(report.pushed).toContain(change.id);
    expect(door.rex.get(change.id)?.status).toBe("in_progress");
    expect(door.calls.some((c) => c.name === "update_task_status" && c.args["id"] === change.id && c.args["status"] === "in_progress")).toBe(true);
    const entry = door.log.find((l) => l.itemId === change.id);
    expect(entry?.event).toBe("graview_sync");
    expect(entry?.detail).toContain("author=graview:nick");
    // The echo of our own write comes back as an echo, not as news.
    const again = await engine.run();
    expect(again.echoes).toContain(change.id);
    expect(again.applied).toEqual([]);
  });

  it("brings a rex-side edit in as a system-authored op", async () => {
    const { door, store, engine, change } = await setUp();
    await engine.run();
    door.touch(change.id, { priority: "critical", title: `${change.title} (rex)` });
    let systemOps = 0;
    const off = store.subscribe((_diff, ops) => {
      systemOps += ops.filter((op) => op.author.kind === "system" && op.author.id === "n-dx").length;
    });
    const report = await engine.run();
    off();
    expect(report.applied).toContain(change.id);
    const node = store.graph.getNode(change.id) as unknown as Item;
    expect(node.priority).toBe("critical");
    expect(node.title).toBe(`${change.title} (rex)`);
    expect(systemOps).toBeGreaterThan(0);
    expect(door.calls.some((c) => c.name === "edit_item" || c.name === "update_task_status")).toBe(false);
  });

  it("settles a field edited on both sides to rex's value by the engine's own policy, and never overwrites rex", async () => {
    const { door, store, sync, change } = await setUp();
    await sync.run();
    store.apply({ name: "edit-change", args: { id: change.id, priority: "low" } }, { author: SEAT });
    door.touch(change.id, { priority: "high" });
    const writesBefore = door.calls.filter((c) => c.name === "edit_item" || c.name === "update_task_status").length;
    const { report, resolved } = await sync.run();
    expect(resolved.map((c) => ("field" in c ? `${c.field}:${String(c.ours)}→${String(c.theirs)}:${c.took}` : `deleted:${c.took}`))).toEqual(["priority:low→high:theirs"]);
    expect((store.graph.getNode(change.id) as unknown as Item).priority).toBe("high");
    expect(door.rex.get(change.id)?.priority).toBe("high");
    // Rex was told nothing: its value stood, and ours was replaced locally through the inbound act.
    expect(door.calls.filter((c) => c.name === "edit_item" || c.name === "update_task_status").length).toBe(writesBefore);
    expect(report.pushed).toEqual([]);
    expect(report.conflicts).toEqual([]);
    const settled = await sync.run();
    expect(settled.resolved).toEqual([]);
    expect(settled.report.pushed).toEqual([]);
  });

  it("refuses an act on a kind another tool owns with the owner's sentence, before it is offered and when it is tried", async () => {
    const { door, store, engine } = await setUp();
    const zone = (store.graph.nodesOfKind("zone" as never) as unknown as Item[])[0]!;
    expect(engine.refuses("zone")).toBe(because("zone"));
    expect(because("zone")).toContain("sourcevision");
    expect(because("run")).toContain("hench");
    expect(because("commit")).toContain("git");
    expect(engine.refuses("change")).toBeUndefined();
    const release = engine.guard();
    try {
      expect(() => store.apply({ name: "edit-zone", args: { id: zone.id, name: "Renamed" } }, { author: SEAT })).toThrow(PermissionDeniedError);
      expect(store.permits({ name: "edit-zone", args: { id: zone.id, name: "Renamed" } }, SEAT).ok).toBe(false);
    } finally {
      release();
    }
    await engine.run();
    expect(door.calls.filter((c) => c.name !== "get_item")).toEqual([]);
  });

  it("puts rex's value back when rex refuses a write, says why once, and does not ask again", async () => {
    const { door, store, sync } = await setUp();
    const done = (store.graph.nodesOfKind("change" as never) as unknown as Item[]).find((c) => c.status === "completed")!;
    await sync.run();
    store.apply({ name: "edit-change", args: { id: done.id, status: "in_progress" } }, { author: SEAT });
    const { report } = await sync.run();
    expect(report.refused.map((r) => r.localId)).toEqual([done.id]);
    expect(report.refused[0]!.error).toContain("Cannot move from completed");
    expect((store.graph.getNode(done.id) as unknown as Item).status).toBe("completed");
    expect(door.rex.get(done.id)?.status).toBe("completed");
    const statusCalls = () => door.calls.filter((c) => c.name === "update_task_status").length;
    const before = statusCalls();
    const again = await sync.run();
    expect(again.report.refused).toEqual([]);
    expect(statusCalls()).toBe(before);
  });

  it("never sends the status that deletes: rex keeps the item and its children, and the face keeps rex's status", async () => {
    const { door, store, sync, change } = await setUp();
    await sync.run();
    const was = (store.graph.getNode(change.id) as unknown as Item).status;
    store.apply({ name: "edit-change", args: { id: change.id, status: "deleted" } }, { author: SEAT });
    const { report } = await sync.run();
    expect(report.refused[0]?.error).toBe(NEVER_DELETES);
    expect(door.rex.has(change.id)).toBe(true);
    expect(door.calls.some((c) => c.name === "update_task_status")).toBe(false);
    expect((store.graph.getNode(change.id) as unknown as Item).status).toBe(was);
  });

  it("treats a completion rex holds for a run's test gate as not written: no log entry, rex's status kept, its sentence said", async () => {
    const { door, store, sync, change } = await setUp();
    await sync.run();
    const was = (store.graph.getNode(change.id) as unknown as Item).status;
    door.held.add(change.id);
    store.apply({ name: "edit-change", args: { id: change.id, status: "completed" } }, { author: SEAT });
    const { report } = await sync.run();
    expect(report.refused[0]?.error).toContain("held for the hench run");
    expect(door.log.some((l) => l.itemId === change.id)).toBe(false);
    expect(door.rex.get(change.id)?.status).toBe(was);
    expect((store.graph.getNode(change.id) as unknown as Item).status).toBe(was);
  });
});

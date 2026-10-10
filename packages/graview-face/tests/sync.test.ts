/**
 * Two-way sync, headless: the engine over the fixture store and a fake door
 * that behaves like the hub's rex. A local edit lands in rex through
 * update_task_status with the principal in the log; a rex-side edit arrives
 * as a system-authored op; a field edited on both sides resolves to rex's
 * value and is said; a write to a code-side kind is refused naming the owner.
 */
import { readFileSync } from "node:fs";
import { createMemoryAdapter, type Principal } from "@graview/core";
import { compileDocument } from "@graview/core/check";
import { openStore, type GraphSnapshot } from "@graview/ship";
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { createSync, seedLinks } from "../src/sync/engine.js";
import { ndxRemote } from "../src/sync/ndx-system.js";
import { refusal } from "../src/sync/mapping.js";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf-8")) as unknown;
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

/** A fake door: rex as a map of items, the snapshot as what rex would project, a log. */
function fakeDoor(snapshot: GraphSnapshot) {
  const rex = new Map<string, Item>();
  for (const node of snapshot.nodes) if (node.kind === "change" || node.kind === "task") rex.set(node.id, { ...(node as Item) });
  const log: { event: string; itemId?: string; detail?: string }[] = [];
  const calls: { name: string; args: Record<string, unknown> }[] = [];
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
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/ndx/emit")) return new Response(JSON.stringify({ ok: true, output: "" }), { headers: { "content-type": "application/json" } });
    if (url.endsWith("/data/snapshot.json")) {
      const nodes = snapshot.nodes.map((n) => (rex.has(n.id) ? { ...n, ...rex.get(n.id)! } : n));
      return new Response(JSON.stringify({ nodes, edges: snapshot.edges }), { headers: { "content-type": "application/json" } });
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
  }) as typeof fetch;
  return { rex, log, calls, touch, fetch: fetchImpl };
}

let app: App;
let snapshot: GraphSnapshot;
beforeEach(() => {
  const compiled = compileDocument(fixture("document.json"));
  if (!compiled.ok) throw new Error("refused");
  app = compiled.app as App;
  snapshot = fixture("snapshot.json") as GraphSnapshot;
});

async function setUp() {
  const door = fakeDoor(snapshot);
  const { store } = await openStore({ app, adapter: createMemoryAdapter(), seed: snapshot });
  const sync = createSync({ store, principal: "nick", fetch: door.fetch, base: "http://door", pullTtlMs: 0 });
  const engine = sync.engine;
  const change = (store.graph.nodesOfKind("change" as never) as unknown as Item[]).find((c) => c.status !== "completed") ?? (store.graph.nodesOfKind("change" as never) as unknown as Item[])[0]!;
  return { door, store, engine, sync, change };
}

describe("two-way sync with rex as the system of record", () => {
  it("links every synced record at the version it was projected with, so the first run pushes nothing", async () => {
    const { door, store, engine } = await setUp();
    expect(Object.keys(seedLinks(store)).length).toBeGreaterThan(0);
    const report = await engine.run();
    expect(report.pushed).toEqual([]);
    expect(report.applied).toEqual([]);
    expect(door.calls.filter((c) => c.name !== "get_item")).toEqual([]);
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

  it("resolves a field edited on both sides between pulls to rex's value, and never overwrites rex", async () => {
    const { door, store, sync, change } = await setUp();
    await sync.run();
    store.apply({ name: "edit-change", args: { id: change.id, priority: "low" } }, { author: SEAT });
    door.touch(change.id, { priority: "high" });
    const writesBefore = door.calls.filter((c) => c.name === "edit_item" || c.name === "update_task_status").length;
    const { report, resolved } = await sync.run();
    expect(resolved.map((c) => `${c.field}:${String(c.ours)}→${String(c.theirs)}`)).toEqual(["priority:low→high"]);
    expect((store.graph.getNode(change.id) as unknown as Item).priority).toBe("high");
    expect(door.rex.get(change.id)?.priority).toBe("high");
    // Rex was told nothing: its value stood, and ours was replaced locally through the inbound act.
    expect(door.calls.filter((c) => c.name === "edit_item" || c.name === "update_task_status").length).toBe(writesBefore);
    expect(report.pushed).toEqual([]);
    const settled = await sync.run();
    expect(settled.resolved).toEqual([]);
    expect(settled.report.pushed).toEqual([]);
  });

  it("refuses a write to a code-side kind, naming the tool that owns it", async () => {
    const door = fakeDoor(snapshot);
    const remote = ndxRemote({ principal: "nick", fetch: door.fetch, base: "http://door" });
    const acks = await remote.push([{ resource: "zone", id: "checkout", localId: "checkout", fields: { name: "Renamed" } }]);
    expect(acks[0]?.error).toContain("sourcevision");
    expect(refusal("run")).toContain("hench");
    expect(refusal("commit")).toContain("git");
    expect(door.calls).toEqual([]);
  });
});

/**
 * Link and unlink a rex item to a tracker work item (story 44).
 *
 * `POST` / `DELETE /api/rex/items/:id/links { ref }` write a v2 item's ref into
 * its `issues` (the item's state.yaml) and a v1 item's into `links[]`, and
 * remove it from the same place. Real stores on temp trees, no mocks.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveStore } from "@n-dx/rex";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import { readLinkCall } from "../../src/server/tracker/link-card.js";
import type { ServerContext } from "../../src/server/types.js";
import type { PRDItem } from "../../src/server/rex-gateway.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";

const V2_FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const TASK = "c0000000-0000-4000-8000-000000000002";

let tmpDir: string;
let rexDir: string;
let http: RouteTestServer;

async function serve(): Promise<void> {
  const ctx: ServerContext = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
  http = await startRouteTestServer((req, res) => handleRexRoute(req, res, ctx, () => {}));
}

async function send(method: "POST" | "DELETE", id: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${http.baseUrl}/api/rex/items/${id}/links`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function refsOf(id: string): Promise<{ status: number; refs?: string[] }> {
  const res = await fetch(`${http.baseUrl}/api/rex/items/${id}/links`);
  return { status: res.status, ...(res.ok && { refs: ((await res.json()) as { refs: string[] }).refs }) };
}

async function readItem(id: string): Promise<PRDItem & { issues?: string[]; links?: unknown[] }> {
  const doc = await (await resolveStore(rexDir)).loadDocument();
  const stack = [...doc.items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.id === id) return item as PRDItem & { issues?: string[]; links?: unknown[] };
    stack.push(...(item.children ?? []));
  }
  throw new Error(`Item ${id} is not in the tree`);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "tracker-links-"));
  rexDir = join(tmpDir, ".rex");
});

afterEach(async () => {
  await http.close();
  await removeTestDir(tmpDir);
});

describe("on a v2 tree", () => {
  beforeEach(async () => {
    cpSync(V2_FIXTURE, rexDir, { recursive: true });
    await serve();
  });

  it("writes a task's ref into its issues and removes it again", async () => {
    const linked = await send("POST", TASK, { ref: "WM-2054" });
    expect(linked).toMatchObject({ status: 200, json: { ok: true, changed: true, refs: ["WM-2054"] } });
    expect((await readItem(TASK)).issues).toEqual(["WM-2054"]);
    expect(await refsOf(TASK)).toEqual({ status: 200, refs: ["WM-2054"] });
    expect(await refsOf("no-such-item")).toEqual({ status: 404 });
    expect(readFileSync(join(rexDir, "changes", "add-apple-pay", "state.yaml"), "utf8")).toContain("WM-2054");

    const unlinked = await send("DELETE", TASK, { ref: "WM-2054" });
    expect(unlinked).toMatchObject({ status: 200, json: { ok: true, changed: true, refs: [] } });
    expect((await readItem(TASK)).issues).toBeUndefined();
  });

  it("links a change by URL, keeps the ones it has and is a no-op for a repeat", async () => {
    const url = "https://notion.example/page/abc";
    await send("POST", CHANGE, { ref: "WM-1" });
    expect((await send("POST", CHANGE, { ref: url })).json.refs).toEqual(["WM-1", url]);
    expect(await send("POST", CHANGE, { ref: ` ${url} ` })).toMatchObject({ status: 200, json: { changed: false } });
    expect((await readItem(CHANGE)).issues).toEqual(["WM-1", url]);

    await send("DELETE", CHANGE, { ref: "WM-1" });
    expect((await readItem(CHANGE)).issues).toEqual([url]);
    expect(await send("DELETE", CHANGE, { ref: "WM-1" })).toMatchObject({ status: 200, json: { changed: false } });
  });

  it("takes a change's display id for its UUID, on the route and on the link card", async () => {
    const card = await readLinkCall({ rexDir, projectDir: tmpDir }, { itemId: "CH-1", ref: "WM-1" });
    expect(card).toMatchObject({ itemId: CHANGE, ref: "WM-1" });

    expect(await send("POST", "CH-1", { ref: "WM-1" })).toMatchObject({ status: 200, json: { changed: true, refs: ["WM-1"] } });
    expect((await readItem(CHANGE)).issues).toEqual(["WM-1"]);
    expect(await readLinkCall({ rexDir, projectDir: tmpDir }, { itemId: "CH-1", ref: "WM-1" })).toBe("CH-1 already links to WM-1");
    expect((await send("POST", "CH-999", { ref: "WM-1" })).status).toBe(404);
  });

  it("refuses a ref that is neither a tracker key nor a URL, and an item it does not have", async () => {
    expect((await send("POST", TASK, { ref: "owner/repo#12" })).status).toBe(400);
    expect((await send("POST", TASK, {})).status).toBe(400);
    expect((await send("POST", "no-such-item", { ref: "WM-1" })).status).toBe(404);
    expect((await readItem(TASK)).issues).toBeUndefined();
  });
});

describe("on a v1 tree", () => {
  beforeEach(async () => {
    mkdirSync(rexDir, { recursive: true });
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await (await resolveStore(rexDir)).saveDocument({
      schema: "rex/v1",
      title: "Test",
      items: [{ id: "epic-1", title: "Epic", level: "epic", status: "pending", children: [
        { id: "task-a", title: "Task A", level: "task", status: "pending" },
      ] }] as PRDItem[],
    });
    await serve();
  });

  it("writes the ref into links[] and removes it again", async () => {
    expect((await send("POST", "task-a", { ref: "WM-2054" })).json).toMatchObject({ changed: true, refs: ["WM-2054"] });
    expect((await readItem("task-a")).links).toEqual([{ system: "tracker", workItemId: "WM-2054" }]);
    expect((await readItem("task-a")).issues).toBeUndefined();
    expect(await refsOf("task-a")).toEqual({ status: 200, refs: ["WM-2054"] });

    await send("POST", "task-a", { ref: "https://jira.example/browse/WM-9" });
    expect((await readItem("task-a")).links).toHaveLength(2);

    expect((await send("DELETE", "task-a", { ref: "WM-2054" })).json.refs).toEqual(["https://jira.example/browse/WM-9"]);
    expect((await send("DELETE", "task-a", { ref: "https://jira.example/browse/WM-9" })).json.refs).toEqual([]);
    expect((await readItem("task-a")).links).toBeUndefined();
  });

  it("leaves an existing link's other fields alone when unlinking another", async () => {
    const store = await resolveStore(rexDir);
    await store.updateItem("task-a", { links: [{ system: "jira", workItemId: "WM-5", title: "Five", syncState: "synced" }] } as Partial<PRDItem>);
    await send("POST", "task-a", { ref: "WM-6" });
    await send("DELETE", "task-a", { ref: "WM-6" });
    expect((await readItem("task-a")).links).toEqual([{ system: "jira", workItemId: "WM-5", title: "Five", syncState: "synced" }]);
  });
});

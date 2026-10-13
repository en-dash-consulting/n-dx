/**
 * Item routes on a v2 project: Quick Add creates an Inbox change and status
 * PATCH goes through rex's v2 completion. v1 is covered by routes-rex.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { resolveStore } from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
const TASK_ID = "c0000000-0000-4000-8000-000000000002";

describe("Rex item routes on a v2 project", () => {
  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let base: string;
  let frames: unknown[];

  beforeEach(async () => {
    frames = [];
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v2-items-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });

    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    server = createServer(async (req, res) => {
      const handled = await handleRexRoute(req, res, ctx, (frame) => { frames.push(frame); });
      if (!handled) {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/rex`;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const send = (method: string, path: string, body: unknown) =>
    fetch(`${base}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("POST /items creates an Inbox change without a level", async () => {
    const res = await send("POST", "items", { title: "Support gift cards", description: "Shoppers ask for them." });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ ok: true, level: "change", title: "Support gift cards", needsPlacement: true });

    const store = await resolveStore(rexDir);
    const item = await store.getItem(created.id);
    expect(item).toMatchObject({ title: "Support gift cards", type: "change", needsPlacement: true, description: "Shoppers ask for them." });
  });

  it("POST /items ignores the v1 level the viewer sends", async () => {
    const res = await send("POST", "items", { title: "From Quick Add", level: "task" });
    expect(res.status).toBe(201);
    expect((await res.json()).level).toBe("change");
  });

  it("POST /items refuses a parent, which v2 does not take until type-aware CRUD", async () => {
    const res = await send("POST", "items", { title: "Nested", parentId: CHANGE_ID });
    expect(res.status).toBe(400);
  });

  it("PATCH status in_progress goes through the change-layer store", async () => {
    const res = await send("PATCH", `items/${TASK_ID}`, { status: "in_progress" });
    expect(res.status).toBe(200);
    expect((await (await resolveStore(rexDir)).getItem(TASK_ID))?.status).toBe("in_progress");
  });

  it("PATCH status completed completes a task, then its change, through rex", async () => {
    expect((await send("PATCH", `items/${TASK_ID}`, { status: "completed" })).status).toBe(200);
    const store = await resolveStore(rexDir);
    expect((await store.getItem(TASK_ID))?.status).toBe("completed");

    expect((await send("PATCH", `items/${CHANGE_ID}`, { status: "completed" })).status).toBe(200);
    expect((await store.getItem(CHANGE_ID))?.status).toBe("completed");
    // Only rex's v2 completion applies the change's amendment to the product
    // layer; a plain status write through the store would leave it unapplied.
    expect(readFileSync(join(rexDir, "product", "checkout", "pay-by-card.md"), "utf-8")).toContain("Apple Pay is offered on Safari");
  });

  it("bulk PATCH completed applies the change's amendments through rex", async () => {
    expect((await send("PATCH", "items/bulk", { ids: [TASK_ID], updates: { status: "completed" } })).status).toBe(200);
    const res = await send("PATCH", "items/bulk", { ids: [CHANGE_ID, "nope"], updates: { status: "completed" } });
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toEqual([
      { id: CHANGE_ID, ok: true },
      { id: "nope", ok: false, error: "not found" },
    ]);
    expect((await (await resolveStore(rexDir)).getItem(CHANGE_ID))?.status).toBe("completed");
    expect(readFileSync(join(rexDir, "product", "checkout", "pay-by-card.md"), "utf-8")).toContain("Apple Pay is offered on Safari");
  });

  it("bulk PATCH completed of a change with its tasks completes both when the change is listed first", async () => {
    const res = await send("PATCH", "items/bulk", { ids: [CHANGE_ID, TASK_ID], updates: { status: "completed" } });
    expect((await res.json()).results).toEqual([
      { id: CHANGE_ID, ok: true },
      { id: TASK_ID, ok: true },
    ]);
    expect((await (await resolveStore(rexDir)).getItem(CHANGE_ID))?.status).toBe("completed");
  });

  it("bulk PATCH completed reports a refused completion as not ok", async () => {
    // Completing the change while its task is open is refused by rex.
    const res = await send("PATCH", "items/bulk", { ids: [CHANGE_ID], updates: { status: "completed" } });
    const [result] = (await res.json()).results;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not completed");
    expect((await (await resolveStore(rexDir)).getItem(CHANGE_ID))?.status).not.toBe("completed");
  });

  it("bulk PATCH to another status still goes through the store", async () => {
    const res = await send("PATCH", "items/bulk", { ids: [TASK_ID], updates: { status: "in_progress" } });
    expect(res.status).toBe(200);
    expect((await (await resolveStore(rexDir)).getItem(TASK_ID))?.status).toBe("in_progress");
  });

  it("PATCH completing with a field refused by rex writes neither", async () => {
    // The change's task is still open, so completion is refused.
    const res = await send("PATCH", `items/${CHANGE_ID}`, { status: "completed", title: "Renamed dup" });
    expect(res.status).toBe(400);
    const item = await (await resolveStore(rexDir)).getItem(CHANGE_ID);
    expect(item?.title).not.toBe("Renamed dup");
    expect(item?.status).not.toBe("completed");
    expect(frames).toEqual([]);
  });

  it("bulk PATCH completing with a field writes none of a refused item's fields", async () => {
    const res = await send("PATCH", "items/bulk", { ids: [CHANGE_ID], updates: { status: "completed", title: "Renamed dup" } });
    const [result] = (await res.json()).results;
    expect(result.ok).toBe(false);
    expect((await (await resolveStore(rexDir)).getItem(CHANGE_ID))?.title).not.toBe("Renamed dup");
  });

  it("PATCH completing with a field writes both once completion succeeds", async () => {
    const res = await send("PATCH", `items/${TASK_ID}`, { status: "completed", title: "Renamed task" });
    expect(res.status).toBe(200);
    const item = await (await resolveStore(rexDir)).getItem(TASK_ID);
    expect(item).toMatchObject({ status: "completed", title: "Renamed task" });
    expect(frames).toEqual([expect.objectContaining({ type: "rex:item-updated", itemId: TASK_ID })]);
  });

  it("bulk PATCH completing with a field writes both for the items it completed", async () => {
    const res = await send("PATCH", "items/bulk", { ids: [TASK_ID], updates: { status: "completed", priority: "high" } });
    expect((await res.json()).results).toEqual([{ id: TASK_ID, ok: true }]);
    expect(await (await resolveStore(rexDir)).getItem(TASK_ID)).toMatchObject({ status: "completed", priority: "high" });
  });

  it("PATCH whose fields are refused after the completion was written says so and publishes the completion", async () => {
    const res = await send("PATCH", `items/${TASK_ID}`, { status: "completed", requirements: [{ bogus: 1 }] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/^Completed ".*", but its other fields were not saved/);
    expect((await (await resolveStore(rexDir)).getItem(TASK_ID))?.status).toBe("completed");
    expect(frames).toEqual([expect.objectContaining({ type: "rex:item-updated", itemId: TASK_ID, updates: { status: "completed" } })]);
  });

  it("bulk PATCH whose fields are refused after completion reports the completion", async () => {
    const res = await send("PATCH", "items/bulk", { ids: [TASK_ID], updates: { status: "completed", requirements: [{ bogus: 1 }] } });
    const [result] = (await res.json()).results;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^completed, but its other fields were not saved/);
    expect((await (await resolveStore(rexDir)).getItem(TASK_ID))?.status).toBe("completed");
    expect(frames).toEqual([expect.objectContaining({ type: "rex:prd-changed" })]);
  });

  it("PATCH of an unknown id on v2 is a 404", async () => {
    const res = await send("PATCH", "items/nope", { status: "in_progress" });
    expect(res.status).toBe(404);
  });
});

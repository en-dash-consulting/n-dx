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

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v2-items-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });

    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    server = createServer(async (req, res) => {
      const handled = await handleRexRoute(req, res, ctx);
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

  it("bulk PATCH to another status still goes through the store", async () => {
    const res = await send("PATCH", "items/bulk", { ids: [TASK_ID], updates: { status: "in_progress" } });
    expect(res.status).toBe(200);
    expect((await (await resolveStore(rexDir)).getItem(TASK_ID))?.status).toBe("in_progress");
  });

  it("PATCH of an unknown id on v2 is a 404", async () => {
    const res = await send("PATCH", "items/nope", { status: "in_progress" });
    expect(res.status).toBe(404);
  });
});

/**
 * Inbox placement routes on a v2 project: the shortlist read, place and
 * propose, through rex's transaction, the execution log and the broadcast.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import type { ChangePlacement } from "../../../src/viewer/views/product-model.js";
import { resolveStore } from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const modelLoads = vi.hoisted(() => vi.fn());
vi.mock("../../../src/server/rex-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/rex-gateway.js")>();
  return {
    ...actual,
    loadPrdModel: (...args: Parameters<typeof actual.loadPrdModel>) => {
      modelLoads();
      return actual.loadPrdModel(...args);
    },
  };
});

const FIXTURE =resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const AREA_ID = "a0000000-0000-4000-8000-000000000001";
const CAPABILITY_ID = "a0000000-0000-4000-8000-000000000002";
const PLACED_CHANGE_ID = "c0000000-0000-4000-8000-000000000001";

async function serve(ctx: ServerContext, frames: unknown[]): Promise<{ server: Server; base: string }> {
  const server = createServer(async (req, res) => {
    if (!(await handleRexRoute(req, res, ctx, (frame) => { frames.push(frame); }))) {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  return { server, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/rex` };
}

describe("placement routes on a v2 project", () => {
  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let base: string;
  let frames: unknown[];
  let inboxId: string;

  const send = (path: string, body: unknown) =>
    fetch(`${base}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = async (res: Response) => ({ status: res.status, body: await res.json() });

  /** The change folder holding `id`'s index.md, relative to changes/. */
  function folderOf(id: string): string | undefined {
    const changes = join(rexDir, "changes");
    const walk = (dir: string): string | undefined => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const path = join(dir, entry.name);
        const index = join(path, "index.md");
        if (existsSync(index) && readFileSync(index, "utf-8").includes(`id: "${id}"`)) return relative(changes, path);
        const nested = walk(path);
        if (nested) return nested;
      }
      return undefined;
    };
    return walk(changes);
  }

  const logEvents = (): Array<Record<string, unknown>> => {
    const path = join(rexDir, "execution-log.jsonl");
    return existsSync(path) ? readFileSync(path, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };

  beforeEach(async () => {
    frames = [];
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v2-placement-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });
    ({ server, base } = await serve({ projectDir: tmpDir, svDir, rexDir, dev: false }, frames));

    const created = await (await send("items", { title: "Pay by card retries a declined card", description: "A shopper retries after a decline." })).json();
    inboxId = created.id;
    frames.length = 0;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET placement answers the change and its shortlist, with each candidate's area, statement and criteria", async () => {
    const { status, body } = await json(await fetch(`${base}/changes/${inboxId}/placement`));
    expect(status).toBe(200);
    const placement = body as ChangePlacement;
    expect(placement.layout).toBe("v2");
    expect(placement.change).toEqual({ id: inboxId, title: "Pay by card retries a declined card", intent: "A shopper retries after a decline.", status: "pending", taskCount: 0 });
    expect(["touches", "amends"]).toContain(placement.relation);
    expect(typeof placement.tied).toBe("boolean");
    expect(placement.shortlist[0]).toMatchObject({
      target: CAPABILITY_ID,
      type: "capability",
      title: "Pay by card",
      area: "Checkout",
      statement: "A shopper can pay for a basket with a card.",
      criteria: [{ id: "c1", text: "A valid card is charged once" }, { id: "c2", text: "A declined card shows why" }],
    });
    const top = placement.shortlist[0];
    expect(typeof top.score).toBe("number");
    expect(["strong", "possible", "weak"]).toContain(top.strength);
    expect(Array.isArray(top.reasons)).toBe(true);
    // A read writes nothing and tells no one.
    expect(frames).toEqual([]);
  });

  it("GET placement counts a change's tasks and carries its intent", async () => {
    const { body } = await json(await fetch(`${base}/changes/CH-1/placement`));
    expect(body.change).toMatchObject({ id: PLACED_CHANGE_ID, intent: "Shoppers on iPhone abandon at the card form.", status: "in_progress", taskCount: 1 });
  });

  it("GET changes/placements shortlists every awaiting change from one model load", async () => {
    const second = await (await send("items", { title: "Pay by card shows a receipt" })).json();
    modelLoads.mockClear();
    const { status, body } = await json(await fetch(`${base}/changes/placements`));
    expect(status).toBe(200);
    expect(modelLoads).toHaveBeenCalledTimes(1);
    expect(Object.keys(body.placements).sort()).toEqual([inboxId, second.id].sort());
    const single = await json(await fetch(`${base}/changes/${inboxId}/placement`));
    expect(body.placements[inboxId]).toEqual(single.body);
  });

  it("POST place touches a capability: clears needsPlacement, leaves the Inbox, logs and broadcasts", async () => {
    expect(folderOf(inboxId)?.split(sep)[0]).toBe("inbox");
    const { status, body } = await json(await send(`changes/${inboxId}/place`, { target: "A1.1", relation: "touches" }));
    expect(status).toBe(200);
    expect(body).toEqual({ change: inboxId, target: CAPABILITY_ID, relation: "touches" });

    const item = await (await resolveStore(rexDir)).getItem(inboxId);
    expect(item?.needsPlacement).toBeUndefined();
    expect(folderOf(inboxId)?.split(sep)[0]).not.toBe("inbox");
    expect(logEvents().at(-1)).toMatchObject({ event: "change_placed", itemId: inboxId });
    expect(frames).toEqual([expect.objectContaining({ type: "rex:prd-changed" })]);
  });

  it("POST place amends a capability with a criteria delta", async () => {
    const { status, body } = await json(await send(`changes/${inboxId}/place`, {
      target: CAPABILITY_ID,
      relation: "amends",
      criteria: { add: [{ id: "c3", text: "A declined card can be retried" }] },
    }));
    expect(status).toBe(200);
    expect(body).toEqual({ change: inboxId, target: CAPABILITY_ID, relation: "amends" });
  });

  it("POST propose records a new capability under an area and leaves the Inbox", async () => {
    const { status, body } = await json(await send(`changes/${inboxId}/propose`, {
      type: "capability",
      under: AREA_ID,
      title: "Retry a declined card",
      proposed: "A shopper can retry a declined card without refilling the form.",
    }));
    expect(status).toBe(200);
    expect(body.change).toBe(inboxId);
    expect(body.proposed).toMatchObject({ under: AREA_ID, title: "Retry a declined card", type: "capability" });
    expect(typeof body.proposed.target).toBe("string");

    const item = await (await resolveStore(rexDir)).getItem(inboxId);
    expect(item?.needsPlacement).toBeUndefined();
    expect(folderOf(inboxId)?.split(sep)[0]).not.toBe("inbox");
    expect(logEvents().at(-1)).toMatchObject({ event: "change_proposed", itemId: inboxId });
    expect(frames).toEqual([expect.objectContaining({ type: "rex:prd-changed" })]);
  });

  /** Rex's refusals reach the caller as 422 with its plain message and kind, and write nothing. */
  const refusals: Array<[string, () => [string, unknown], string]> = [
    ["not-a-target", () => [`changes/${inboxId}/place`, { target: AREA_ID }], "is not a live capability or constraint"],
    ["content-needs-amends", () => [`changes/${inboxId}/place`, { target: CAPABILITY_ID, relation: "touches", proposed: "x" }], "relation amends"],
    ["nothing-to-modify", () => [`changes/${inboxId}/place`, { target: CAPABILITY_ID, relation: "amends" }], "Cannot place change"],
    ["already-amends", () => [`changes/${PLACED_CHANGE_ID}/place`, { target: CAPABILITY_ID, relation: "touches" }], "already amends"],
    ["not-an-area", () => [`changes/${inboxId}/propose`, { type: "capability", under: CAPABILITY_ID, title: "New", proposed: "x" }], "is not a live area"],
    ["empty-title", () => [`changes/${inboxId}/propose`, { type: "capability", under: AREA_ID, title: "  " }], "needs a title"],
  ];

  it.each(refusals)("POST answers %s as 422 with its plain message and kind", async (kind, request, text) => {
    const [path, body] = request();
    const before = readFileSync(join(rexDir, "execution-log.jsonl"), "utf-8");
    const res = await json(await send(path, body));
    expect(res.status).toBe(422);
    expect(res.body.kind).toBe(kind);
    expect(res.body.error).toContain(text);
    // The plain wording: no MCP tool names.
    expect(res.body.error).not.toContain("get_product");
    expect(readFileSync(join(rexDir, "execution-log.jsonl"), "utf-8")).toBe(before);
    expect(frames).toEqual([]);
  });

  it("POST propose answers already-proposed for a repeat proposal", async () => {
    const proposal = { type: "capability", under: AREA_ID, title: "Retry a declined card", proposed: "A shopper can retry." };
    expect((await send(`changes/${inboxId}/propose`, proposal)).status).toBe(200);
    const res = await json(await send(`changes/${inboxId}/propose`, proposal));
    expect(res).toMatchObject({ status: 422, body: { kind: "already-proposed" } });
  });

  it("POST place answers change-not-open for an applied change", async () => {
    const statePath = join(rexDir, "changes", "add-apple-pay", "state.yaml");
    writeFileSync(statePath, readFileSync(statePath, "utf-8").replace(
      '    status: "in_progress"\n',
      '    status: "completed"\n    appliedAt: "2026-10-05T12:00:00.000Z"\n',
    ));
    const res = await json(await send(`changes/${PLACED_CHANGE_ID}/place`, { target: CAPABILITY_ID, relation: "touches" }));
    expect(res).toMatchObject({ status: 422, body: { kind: "change-not-open" } });
  });

  it.each([
    ["GET placement", () => fetch(`${base}/changes/no-such-change/placement`)],
    ["POST place", () => send("changes/no-such-change/place", { target: CAPABILITY_ID })],
    ["POST propose", () => send("changes/no-such-change/propose", { type: "capability", under: AREA_ID, title: "New" })],
  ])("%s answers 404 for an unknown change", async (_label, request) => {
    const res = await json(await request());
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("No live change");
  });

  it.each([
    ["place", { relation: "touches" }, "target"],
    ["place", { target: CAPABILITY_ID, relation: "sideways" }, "relation"],
    ["place", { target: CAPABILITY_ID, criteria: { add: "c3" } }, "criteria"],
    ["propose", { type: "area", under: AREA_ID, title: "New" }, "type"],
    ["propose", { type: "capability", title: "New" }, "under"],
  ])("POST %s answers 400 for a malformed body", async (action, body, field) => {
    const res = await json(await send(`changes/${inboxId}/${action}`, body));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(field);
    expect(frames).toEqual([]);
  });
});

describe("placement routes on a v1 project", () => {
  let tmpDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v1-placement-"));
    const rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(join(rexDir, "prd_tree"), { recursive: true });
    mkdirSync(svDir, { recursive: true });
    ({ server, base } = await serve({ projectDir: tmpDir, svDir, rexDir, dev: false }, []));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each([
    ["GET", "placement", undefined],
    ["POST", "place", { target: CAPABILITY_ID }],
    ["POST", "propose", { type: "capability", under: AREA_ID, title: "New" }],
  ])("%s %s answers 409 and writes nothing", async (method, action, body) => {
    const res = await fetch(`${base}/changes/${PLACED_CHANGE_ID}/${action}`, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("v1");
    expect(existsSync(join(tmpDir, ".rex", "product"))).toBe(false);
  });
});

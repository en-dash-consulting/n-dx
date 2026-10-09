/**
 * The product-layer MCP tools against the v2 fixture tree: get_product,
 * get_capability, place_change, apply_change, and get_prd_status on v2. Each
 * refuses a v1 tree, which has no product layer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore, ensureRexDir } from "../../../src/store/index.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import {
  handleAddItem,
  handleApplyChange,
  handleGetCapability,
  handleGetItem,
  handleGetPrdStatus,
  handleGetProduct,
  handlePlaceChange,
} from "../../../src/cli/mcp-tools/index.js";
import { copyV2Fixture } from "../../helpers/v2-fixture.js";

const AREA = "a0000000-0000-4000-8000-000000000001";
const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-mcp-product-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const store = () => createStore("file", rexDir);
const json = (r: { content: { text: string }[]; isError?: boolean }) => {
  expect(r.isError, r.content[0].text).toBeFalsy();
  return JSON.parse(r.content[0].text);
};
const error = (r: { content: { text: string }[]; isError?: boolean }) => {
  expect(r.isError).toBe(true);
  return r.content[0].text;
};
const log = async () => (await readFile(join(rexDir, "execution-log.jsonl"), "utf-8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** An Inbox change added through add_item. */
async function inboxChange(title: string): Promise<string> {
  return json(await handleAddItem(store(), tmp, rexDir, { title })).id;
}

describe("get_product", () => {
  it("returns areas with their capabilities' computed status and health", async () => {
    const body = json(await handleGetProduct(rexDir));
    expect(body.title).toBe("Fixture shop");
    expect(body.areas).toEqual([
      {
        id: AREA,
        displayId: "A1",
        type: "area",
        title: "Checkout",
        summary: "Taking payment for a basket.",
        children: [
          {
            id: CAPABILITY,
            displayId: "A1.1",
            type: "capability",
            title: "Pay by card",
            statement: "A shopper can pay for a basket with a card.",
            status: "changing",
            health: "ok",
          },
        ],
      },
    ]);
  });
});

describe("get_capability", () => {
  it("returns the capability with its chain, status and the change amending it", async () => {
    const body = json(await handleGetCapability(rexDir, { id: "A1.1" }));
    expect(body.node).toMatchObject({ id: CAPABILITY, criteria: [{ id: "c1" }, { id: "c2" }] });
    expect(body.parentChain).toEqual([{ id: AREA, displayId: "A1", title: "Checkout", type: "area" }]);
    expect(body.status).toEqual({ status: "changing", health: "ok" });
    expect(body.changes).toEqual([{ id: CHANGE, displayId: "CH-1", title: "Add Apple Pay", status: "in_progress", relation: "amends", open: true, applied: false, release: "1.2.0" }]);
  });

  it("refuses an area, naming get_product", async () => {
    expect(error(await handleGetCapability(rexDir, { id: "A1" }))).toMatch(/is an area.*get_product/);
  });
});

describe("get_prd_status on a v2 tree", () => {
  it("reports change counts, the Inbox, product status per area and changes per release", async () => {
    await inboxChange("Sort this out");
    const body = json(await handleGetPrdStatus(store(), rexDir));
    expect(body).toMatchObject({ title: "Fixture shop", layout: "v2", inbox: 1 });
    expect(body.changes).toEqual({ total: 2, open: 2, applied: 0, byStatus: { in_progress: 1, pending: 1 } });
    expect(body.areas).toEqual([
      { id: AREA, displayId: "A1", title: "Checkout", capabilities: 1, constraints: 0, status: { changing: 1 }, defective: 0, openChanges: 1 },
    ]);
    expect(body.releases.map((r: { release: string | null }) => r.release)).toEqual(["1.2.0", null]);
  });
});

describe("place_change", () => {
  it("returns the rules' shortlist without writing when no target is given", async () => {
    const id = await inboxChange("Support refunds when paying by card");
    const body = json(await handlePlaceChange(store(), rexDir, { id }));
    expect(body).toMatchObject({ change: id, relation: "amends", shortlist: [{ target: CAPABILITY, relation: "amends" }] });
    expect(json(await handleGetItem(store(), rexDir, { id })).item.needsPlacement).toBe(true);
  });

  it("records a touches placement, clears needsPlacement and logs it", async () => {
    const id = await inboxChange("Tidy the card form");
    expect(json(await handlePlaceChange(store(), rexDir, { id, target: "A1.1", relation: "touches" }))).toEqual({
      change: id,
      target: CAPABILITY,
      relation: "touches",
    });
    const { item } = json(await handleGetItem(store(), rexDir, { id }));
    expect(item.touches).toEqual([CAPABILITY]);
    expect(item).not.toHaveProperty("needsPlacement");
    expect((await log()).at(-1)).toMatchObject({ event: "change_placed", itemId: id, detail: `touches ${CAPABILITY}` });
  });

  it("refuses relation or summary without a target, and a closed change", async () => {
    const id = await inboxChange("Tidy the card form");
    expect(error(await handlePlaceChange(store(), rexDir, { id, relation: "touches" }))).toMatch(/pass target/);
    json(await handleApplyChange(store(), rexDir, { id: "CH-1" }));
    expect(error(await handlePlaceChange(store(), rexDir, { id: "CH-1", target: "A1.1" }))).toMatch(/CH-1 is applied at/);
  });

  it("records proposed text and a criteria delta on the amendment, with the target's current base", async () => {
    const id = await inboxChange("Refunds by card");
    const criteria = { add: [{ id: "c9", text: "A card payment can be refunded" }], remove: ["c2"] };
    json(await handlePlaceChange(store(), rexDir, { id, target: "A1.1", relation: "amends", proposed: "A shopper can pay and be refunded by card.", criteria }));
    const { item } = json(await handleGetItem(store(), rexDir, { id }));
    expect(item.amends).toEqual([
      { target: CAPABILITY, delta: "modified", summary: "Refunds by card", proposed: "A shopper can pay and be refunded by card.", criteria, base: expect.any(String) },
    ]);

    // Without them, the amendment stays summary-only, on the same base.
    const bare = await inboxChange("Wallets");
    json(await handlePlaceChange(store(), rexDir, { id: bare, target: "A1.1", relation: "amends" }));
    const [amendment] = json(await handleGetItem(store(), rexDir, { id: bare })).item.amends;
    expect(amendment).toEqual({ target: CAPABILITY, delta: "modified", summary: "Wallets", base: item.amends[0].base });
  });

  it("refuses proposed or criteria without relation amends, naming it", async () => {
    const id = await inboxChange("Tidy the card form");
    expect(error(await handlePlaceChange(store(), rexDir, { id, target: "A1.1", relation: "touches", proposed: "x" }))).toMatch(/relation amends/);
    expect(error(await handlePlaceChange(store(), rexDir, { id, target: "A1.1", criteria: { remove: ["c1"] } }))).toMatch(/relation amends/);
    expect(error(await handlePlaceChange(store(), rexDir, { id, proposed: "x" }))).toMatch(/relation amends/);
    expect(json(await handleGetItem(store(), rexDir, { id })).item.needsPlacement).toBe(true);
  });
});

describe("apply_change", () => {
  it("applies the change's amendments, stamps appliedAt and logs it", async () => {
    const body = json(await handleApplyChange(store(), rexDir, { id: "CH-1" }));
    expect(body).toMatchObject({ change: CHANGE, applied: [{ delta: "modified", nodeId: CAPABILITY, summary: "Wallets count as cards" }] });
    expect(body.appliedAt).toEqual(expect.any(String));

    const capability = json(await handleGetCapability(rexDir, { id: CAPABILITY }));
    expect(capability.node.criteria.map((c: { id: string }) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(capability.status.status).toBe("met");
    expect(capability.changes[0]).toMatchObject({ id: CHANGE, open: false, applied: true });
    expect((await log()).at(-1)).toMatchObject({ event: "change_applied", itemId: CHANGE, detail: `modified ${CAPABILITY}` });
  });

  it("refuses a change already applied, and an unknown one", async () => {
    json(await handleApplyChange(store(), rexDir, { id: "CH-1" }));
    expect(error(await handleApplyChange(store(), rexDir, { id: "CH-1" }))).toMatch(/Cannot apply change CH-1: already applied at/);
    expect(error(await handleApplyChange(store(), rexDir, { id: "CH-404" }))).toMatch(/no live change "CH-404"/);
  });

  it("names place_change's proposed and criteria when a modified amendment has nothing to modify", async () => {
    const id = await inboxChange("Refunds by card");
    json(await handlePlaceChange(store(), rexDir, { id, target: "A1.1", relation: "amends" }));
    const message = error(await handleApplyChange(store(), rexDir, { id }));
    expect(message).toMatch(/nothing to modify/);
    expect(message).toMatch(/place_change.*proposed.*criteria/);
  });
});

describe("on a v1 tree", () => {
  beforeEach(async () => {
    rexDir = join(tmp, "v1", ".rex");
    await ensureRexDir(rexDir);
    await store().saveDocument({ schema: SCHEMA_VERSION, title: "v1", items: [] });
  });

  it("every product-layer tool refuses, naming the v1 layout", async () => {
    const refusals = [
      await handleGetProduct(rexDir),
      await handleGetCapability(rexDir, { id: "x" }),
      await handlePlaceChange(store(), rexDir, { id: "x" }),
      await handleApplyChange(store(), rexDir, { id: "x" }),
    ];
    for (const r of refusals) expect(error(r)).toMatch(/v1 layout \(\.rex\/prd_tree\/\), which has no product layer/);
  });

  it("get_prd_status keeps its v1 shape", async () => {
    expect(json(await handleGetPrdStatus(store(), rexDir))).toEqual({ title: "v1", overall: expect.any(Object), epics: [] });
  });
});

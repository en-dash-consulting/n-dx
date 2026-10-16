/**
 * The product-layer MCP tools against the v2 fixture tree: get_product,
 * get_capability, place_change, apply_change, and get_prd_status on v2. Each
 * refuses a v1 tree, which has no product layer.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { createStore, ensureRexDir, resolveStore } from "../../../src/store/index.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import {
  handleAddItem,
  handleApplyChange,
  handleGetCapability,
  handleGetItem,
  handleGetPrdStatus,
  handleGetProduct,
  handlePlaceChange,
  handleUpdateTaskStatus,
} from "../../../src/cli/mcp-tools/index.js";
import { FIXTURE_TASK, completeFixtureTask, copyV2Fixture } from "../../helpers/v2-fixture.js";

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
/** Every file under the rex directory, by relative path. */
const files = async () => {
  const out: Record<string, string> = {};
  for (const entry of await readdir(rexDir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out[relative(rexDir, join(entry.parentPath, entry.name))] = await readFile(join(entry.parentPath, entry.name), "utf-8");
  }
  return out;
};
const log = async () => (await readFile(join(rexDir, "execution-log.jsonl"), "utf-8").catch(() => "")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** An Inbox change added through add_item. */
async function inboxChange(title: string): Promise<string> {
  return json(await handleAddItem(store(), tmp, rexDir, { title })).id;
}

describe("get_product", () => {
  const CHECKOUT = {
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
  };

  it("summarises each area by default: counts and ids, no capabilities", async () => {
    const body = json(await handleGetProduct(rexDir));
    expect(body.title).toBe("Fixture shop");
    expect(body.areas).toEqual([
      { id: AREA, displayId: "A1", title: "Checkout", summary: "Taking payment for a basket.", capabilities: 1, constraints: 0, status: { changing: 1 }, defective: 0, openChanges: 1 },
    ]);
    expect(body.next).toMatch(/area/);
  });

  it("returns one area's capabilities with their computed status and health", async () => {
    for (const ref of ["A1", AREA]) {
      expect(json(await handleGetProduct(rexDir, { area: ref }))).toEqual({ title: "Fixture shop", area: CHECKOUT });
    }
  });

  it("returns the whole map with full", async () => {
    expect(json(await handleGetProduct(rexDir, { full: true }))).toEqual({ title: "Fixture shop", areas: [CHECKOUT] });
  });

  it("refuses an area ref that names a capability or nothing", async () => {
    expect(error(await handleGetProduct(rexDir, { area: "A1.1" }))).toBe(
      '"A1.1" is a capability, not an area. Use get_product without area for the list of areas.',
    );
    expect(error(await handleGetProduct(rexDir, { area: "nope" }))).toMatch(/^"nope" names no area\./);
  });

  describe("on a large tree", () => {
    const AREAS = 40;
    const PER_AREA = 60;
    /** About 25,000 tokens, Claude Code's default MCP output limit, at four characters a token. */
    const CLIENT_LIMIT_CHARS = 100_000;

    beforeEach(async () => {
      const product = join(rexDir, "product");
      for (let a = 1; a <= AREAS; a++) {
        const slug = `area-${a}`;
        await mkdir(join(product, slug));
        const id = (n: number) => `b${String(a).padStart(7, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
        await writeFile(join(product, slug, "index.md"), `---\nid: "${id(0)}"\ntype: "area"\ntitle: "Area ${a}"\nslug: "${slug}"\ndisplayId: "A${a + 1}"\nsummary: "What area ${a} covers."\n---\n`);
        for (let c = 1; c <= PER_AREA; c++) {
          const statement = `In area ${a}, capability ${c} lets a user do one specific thing reliably, with every edge case the product cares about. `.repeat(2).trim();
          await writeFile(
            join(product, slug, `capability-${c}.md`),
            `---\nid: "${id(c)}"\ntype: "capability"\ntitle: "Capability ${a}.${c}"\nslug: "capability-${c}"\ndisplayId: "A${a + 1}.${c}"\nstatement: "${statement}"\n---\n`,
          );
        }
      }
    });

    it("answers within the client limit by default, while the full map does not", async () => {
      const summary = await handleGetProduct(rexDir);
      const body = json(summary);
      expect(body.areas).toHaveLength(AREAS + 1);
      expect(body.areas.find((a: { displayId: string }) => a.displayId === "A2")).toMatchObject({ title: "Area 1", capabilities: PER_AREA });
      expect(summary.content[0].text.length).toBeLessThan(CLIENT_LIMIT_CHARS / 4);
      expect((await handleGetProduct(rexDir, { full: true })).content[0].text.length).toBeGreaterThan(CLIENT_LIMIT_CHARS);
    });

    it("reaches one area's capabilities and one capability's detail", async () => {
      const area = json(await handleGetProduct(rexDir, { area: "A7" })).area;
      expect(area).toMatchObject({ title: "Area 6", type: "area" });
      expect(area.children).toHaveLength(PER_AREA);
      expect(area.children.find((c: { displayId: string }) => c.displayId === "A7.3")).toMatchObject({ type: "capability", title: "Capability 6.3", status: "proposed" });
      expect(json(await handleGetCapability(rexDir, { id: "A7.3" })).node).toMatchObject({ title: "Capability 6.3" });
    });
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
    expect(error(await handleGetCapability(rexDir, { id: "A1" }))).toBe(
      '"A1" is an area, not a capability or constraint. Use get_product to see the product layer.',
    );
  });

  it("refuses an unknown id, naming get_product", async () => {
    expect(error(await handleGetCapability(rexDir, { id: "nope" }))).toBe(
      '"nope" names no product node. Use get_product to see the product layer.',
    );
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
    await completeFixtureTask(rexDir);
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

  });

  it("refuses an amends placement with neither proposed nor criteria, writing nothing, while touches still places", async () => {
    const id = await inboxChange("Wallets");
    const message = error(await handlePlaceChange(store(), rexDir, { id, target: "A1.1", relation: "amends" }));
    expect(message).toMatch(/nothing to modify/);
    expect(message).toMatch(/Pass proposed or criteria, or use relation touches/);
    const unplaced = json(await handleGetItem(store(), rexDir, { id })).item;
    expect(unplaced.needsPlacement).toBe(true);
    expect(unplaced).not.toHaveProperty("amends");
    expect((await log()).filter((e) => e.event === "change_placed")).toEqual([]);

    json(await handlePlaceChange(store(), rexDir, { id, target: "A1.1", relation: "touches" }));
  });

  it("refuses a summary-only amendment given to add_item, writing nothing", async () => {
    const before = json(await handleGetPrdStatus(store(), rexDir));
    const result = await handleAddItem(store(), tmp, rexDir, {
      title: "Wallets",
      amends: [{ target: "A1.1", delta: "modified", summary: "Wallets count" }],
    });
    expect(error(result)).toMatch(/nothing to modify/);
    expect(json(await handleGetPrdStatus(store(), rexDir))).toEqual(before);
  });

  it("stores a removal that only another open change blocks, with a warning, and apply_change waits for that change", async () => {
    // CH-1 still amends A1.1, so apply refuses a removal of it until CH-1 is applied.
    const added = json(await handleAddItem(store(), tmp, rexDir, { title: "Drop cards", amends: [{ target: "A1.1", delta: "removed", summary: "Retire" }] }));
    expect(added.warnings).toEqual([expect.stringMatching(/Open change CH-1 stands in the way.*open-change-refs-live/)]);
    expect(json(await handleGetItem(store(), rexDir, { id: added.id })).item.amends).toHaveLength(1);

    expect(error(await handleApplyChange(store(), rexDir, { id: added.id }))).toMatch(/open-change-refs-live/);
    await completeFixtureTask(rexDir);
    json(await handleApplyChange(store(), rexDir, { id: "CH-1" }));
    expect(json(await handleApplyChange(store(), rexDir, { id: added.id })).applied).toMatchObject([{ delta: "removed", nodeId: CAPABILITY }]);
  });

  it("still refuses a removal of a node no open change amends when apply would refuse it anyway", async () => {
    const result = await handleAddItem(store(), tmp, rexDir, { title: "Drop ghost", amends: [{ target: "A1.404", delta: "removed", summary: "Retire" }] });
    expect(error(result)).toMatch(/not a live product node|does not resolve|A1\.404/);
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
  it("refuses a change with an open task, naming it, and writes nothing", async () => {
    const before = await files();
    expect(error(await handleApplyChange(store(), rexDir, { id: "CH-1" }))).toBe(
      `Cannot apply change CH-1: task ${FIXTURE_TASK} is not completed; a change applies once its work is done`,
    );
    expect(await files()).toEqual(before);
  });

  it("an applied change still in progress completes through update_task_status, without applying again", async () => {
    await completeFixtureTask(rexDir);
    json(await handleApplyChange(store(), rexDir, { id: "CH-1" }));
    const applied = json(await handleGetCapability(rexDir, { id: CAPABILITY })).node;

    json(await handleUpdateTaskStatus(await resolveStore(rexDir), tmp, { id: CHANGE, status: "completed" }));
    const { item } = json(await handleGetItem(store(), rexDir, { id: CHANGE }));
    expect(item).toMatchObject({ status: "completed", completedAt: expect.any(String), appliedAt: expect.any(String) });
    expect(json(await handleGetCapability(rexDir, { id: CAPABILITY })).node).toEqual(applied);
    expect((await log()).filter((e) => e.event === "change_applied")).toHaveLength(1);
  });

  it("applies the change's amendments, stamps appliedAt and logs it", async () => {
    await completeFixtureTask(rexDir);
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
    await completeFixtureTask(rexDir);
    json(await handleApplyChange(store(), rexDir, { id: "CH-1" }));
    expect(error(await handleApplyChange(store(), rexDir, { id: "CH-1" }))).toMatch(/Cannot apply change CH-1: already applied at/);
    expect(error(await handleApplyChange(store(), rexDir, { id: "CH-404" }))).toMatch(/no live change "CH-404"/);
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

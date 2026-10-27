/**
 * The v2 product reads behind the Product, Changes and capability views:
 * fed from rex's model and reports on a v2 tree, `{ layout: "v1" }` on v1.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import type {
  CapabilityDetailWire,
  ChangeRowWire,
  ProductMapWire,
} from "../../../src/server/routes-rex/product.js";
import type {
  ChangePlacementWire,
  PlaceChangeRequestWire,
  PlaceChangeResultWire,
  ProposeChangeRequestWire,
  ProposeChangeResultWire,
} from "../../../src/server/routes-rex/placement.js";
import type {
  CapabilityDetail,
  ChangePlacement,
  ChangeRow,
  PlaceChangeRequest,
  PlaceChangeResult,
  ProductMap,
  ProposeChangeRequest,
  ProposeChangeResult,
} from "../../../src/viewer/views/product-model.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

// The server's wire types and the viewer's view-model types are declared on
// either side of the server/viewer boundary. These assignments fail to
// compile (`pnpm typecheck` runs tsconfig.test.json) when the two drift.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameMap: Same<ProductMapWire, ProductMap> = true;
const sameChange: Same<ChangeRowWire, ChangeRow> = true;
const sameCapability: Same<CapabilityDetailWire, CapabilityDetail> = true;
const samePlacement: Same<ChangePlacementWire, ChangePlacement> = true;
const samePlace: Same<PlaceChangeRequestWire, PlaceChangeRequest> = true;
const samePlaced: Same<PlaceChangeResultWire, PlaceChangeResult> = true;
const samePropose: Same<ProposeChangeRequestWire, ProposeChangeRequest> = true;
const sameProposed: Same<ProposeChangeResultWire, ProposeChangeResult> = true;
void [sameMap, sameChange, sameCapability, samePlacement, samePlace, samePlaced, samePropose, sameProposed];

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const AREA_ID = "a0000000-0000-4000-8000-000000000001";
const CAPABILITY_ID = "a0000000-0000-4000-8000-000000000002";
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";

async function serve(ctx: ServerContext): Promise<{ server: Server; base: string }> {
  const server = createServer(async (req, res) => {
    if (!(await handleRexRoute(req, res, ctx))) {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  return { server, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/rex` };
}

describe("v2 product reads", () => {
  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v2-product-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });
    ({ server, base } = await serve({ projectDir: tmpDir, svDir, rexDir, dev: false }));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const get = async (path: string) => {
    const res = await fetch(`${base}/${path}`);
    return { status: res.status, body: await res.json() };
  };

  /** Mark the fixture's change applied and shipped, as rex's apply and release would. */
  function applyChange(): void {
    const statePath = join(rexDir, "changes", "add-apple-pay", "state.yaml");
    writeFileSync(statePath, readFileSync(statePath, "utf-8").replace(
      '    status: "in_progress"\n',
      '    status: "completed"\n    appliedAt: "2026-10-05T12:00:00.000Z"\n    shippedIn: "1.2.0"\n',
    ));
  }

  it("GET /product lists areas and capabilities with rex's status, health and open changes", async () => {
    const { status, body } = await get("product");
    expect(status).toBe(200);
    expect(body.layout).toBe("v2");
    const map = body.map as ProductMap;
    expect(map.statement).toBe("The product layer of a small shop.");
    expect(map.constraints).toEqual([]);
    expect(map.areas).toEqual([{
      id: AREA_ID,
      displayId: "A1",
      title: "Checkout",
      summary: "Taking payment for a basket.",
      capabilities: [{
        id: CAPABILITY_ID,
        displayId: "A1.1",
        title: "Pay by card",
        statement: "A shopper can pay for a basket with a card.",
        // An in-progress change amends it: rex reads that as changing.
        status: "changing",
        health: "ok",
        specReviewed: true,
        criteriaCount: 2,
        openChanges: [{ id: CHANGE_ID, displayId: "CH-1", title: "Add Apple Pay", stage: "in-progress", delta: "modified" }],
      }],
    }]);
  });

  it("GET /product drops an applied change from the overlays", async () => {
    applyChange();
    const { body } = await get("product");
    expect((body.map as ProductMap).areas[0].capabilities[0].openChanges).toEqual([]);
  });

  it("GET /changes lists each change with its stage, map links and task progress", async () => {
    const { status, body } = await get("changes");
    expect(status).toBe(200);
    expect(body).toEqual({
      layout: "v2",
      changes: [{
        id: CHANGE_ID,
        displayId: "CH-1",
        title: "Add Apple Pay",
        intent: "Shoppers on iPhone abandon at the card form.",
        stage: "in-progress",
        priority: "high",
        plannedRelease: "1.2.0",
        amends: [{ id: CAPABILITY_ID, title: "Pay by card", delta: "modified" }],
        touches: [],
        taskCount: 1,
        completedTaskCount: 0,
      }],
    });
  });

  it("GET /changes reads a completed but unapplied change as awaiting-apply, not in-progress", async () => {
    const statePath = join(rexDir, "changes", "add-apple-pay", "state.yaml");
    writeFileSync(statePath, readFileSync(statePath, "utf-8").replace('    status: "in_progress"\n', '    status: "completed"\n'));
    const { body } = await get("changes");
    expect((body.changes as ChangeRow[])[0].stage).toBe("awaiting-apply");
    const map = (await get("product")).body.map as ProductMap;
    expect(map.areas[0].capabilities[0].openChanges[0].stage).toBe("awaiting-apply");
  });

  it("GET /changes reads a shipped change as shipped", async () => {
    applyChange();
    const { body } = await get("changes");
    expect((body.changes as ChangeRow[])[0]).toMatchObject({ stage: "shipped", shippedIn: "1.2.0" });
  });

  it("GET /product/capability/<display id> returns the capability page", async () => {
    const { status, body } = await get("product/capability/A1.1");
    expect(status).toBe(200);
    expect(body.layout).toBe("v2");
    const capability = body.capability as CapabilityDetail;
    expect(capability).toMatchObject({
      id: CAPABILITY_ID,
      title: "Pay by card",
      status: "changing",
      health: "ok",
      areaId: AREA_ID,
      areaTitle: "Checkout",
      dependsOn: [],
      history: [],
      code: [],
    });
    expect(capability.criteria).toEqual([
      { id: "c1", text: "A valid card is charged once" },
      { id: "c2", text: "A declined card shows why" },
    ]);
    expect(capability.openChanges.map((c) => c.id)).toEqual([CHANGE_ID]);
  });

  describe("met and specChangedSinceMet", () => {
    const statePath = () => join(rexDir, "product", "checkout", "state.yaml");
    const specPath = () => join(rexDir, "product", "checkout", "pay-by-card.md");
    const detail = async () => (await get(`product/capability/${CAPABILITY_ID}`)).body.capability as CapabilityDetail;
    /** Record `metAt` as rex's met-check would: the hash of the spec as it reads now. */
    async function markMet(): Promise<void> {
      const { nodeSpec, specHash, loadPrdModel, indexTree } = await import("../../../src/server/rex-gateway.js");
      const model = await loadPrdModel(rexDir);
      const node = indexTree(model.tree).resolve(CAPABILITY_ID)!;
      const hash = specHash(nodeSpec(node));
      writeFileSync(statePath(), readFileSync(statePath(), "utf-8") + `    metAt: "${hash}"\n`);
    }

    it("is not met when metAt is absent", async () => {
      expect(await detail()).toMatchObject({ met: false, specChangedSinceMet: false });
    });

    it("is met with an unchanged spec when metAt matches the spec hash", async () => {
      await markMet();
      expect(await detail()).toMatchObject({ met: true, specChangedSinceMet: false });
    });

    it("reads a revised node as changing while reporting met and spec moved", async () => {
      await markMet();
      writeFileSync(specPath(), readFileSync(specPath(), "utf-8").replace("A shopper can pay", "A shopper can quickly pay"));
      const capability = await detail();
      // An in-progress change amends it, so rex's status is `changing`, not `revised`.
      expect(capability.status).toBe("changing");
      expect(capability).toMatchObject({ met: true, specChangedSinceMet: true });
    });
  });

  it("GET /product/capability/<id> lists an applied change in its history", async () => {
    applyChange();
    const { body } = await get(`product/capability/${CAPABILITY_ID}`);
    expect((body.capability as CapabilityDetail).history).toEqual([{
      changeId: CHANGE_ID,
      changeDisplayId: "CH-1",
      changeTitle: "Add Apple Pay",
      stage: "shipped",
      delta: "modified",
      shippedIn: "1.2.0",
      at: "2026-10-05T12:00:00.000Z",
    }]);
  });

  it("GET /product/capability/<id> is a 404 for an unknown id and for an area", async () => {
    expect((await get("product/capability/nope")).status).toBe(404);
    expect((await get(`product/capability/${AREA_ID}`)).status).toBe(404);
  });

  describe("POST /product/edit", () => {
    const EDITED = "A shopper can pay for a basket with a credit or debit card.";

    const post = async (payload: unknown) => {
      const res = await fetch(`${base}/product/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
      });
      return { status: res.status, body: await res.json() };
    };
    const edit = (editorial: boolean, over: Record<string, unknown> = {}) => ({
      id: CAPABILITY_ID,
      statement: EDITED,
      criteria: [
        { id: "c1", text: "A valid card is charged once" },
        { id: "c2", text: "A declined card shows why" },
      ],
      editorial,
      ...over,
    });
    const capabilityFile = () => join(rexDir, "product", "checkout", "pay-by-card.md");

    /** Record the capability as met at its current spec, which rex reads from the reviewed hash. */
    function meetCapability(): void {
      const statePath = join(rexDir, "product", "checkout", "state.yaml");
      const state = readFileSync(statePath, "utf-8");
      const hash = /reviewedHash: "([0-9a-f]+)"/.exec(state)![1];
      writeFileSync(statePath, state.replace(
        `    reviewedHash: "${hash}"\n`,
        `    reviewedHash: "${hash}"\n    metAt: "${hash}"\n`,
      ));
    }

    it("editorial: records the wording as history and keeps the capability met", async () => {
      meetCapability();
      const { status, body } = await post(edit(true));
      expect(status).toBe(200);
      expect(body.outcome).toBe("editorial");
      expect(body.drafts).toEqual([]);
      const capability = body.capability as CapabilityDetailWire;
      expect(capability.statement).toBe(EDITED);
      expect(capability.met).toBe(true);
      expect(capability.specChangedSinceMet).toBe(false);
      expect(readFileSync(capabilityFile(), "utf-8")).toContain("editorial:");
      expect(((await get("changes")).body.changes as ChangeRowWire[]).map((c) => c.id)).toEqual([CHANGE_ID]);
    });

    it("not editorial: the capability reads revised and a change is drafted to build the difference", async () => {
      meetCapability();
      const { status, body } = await post(edit(false));
      expect(status).toBe(200);
      expect(body.outcome).toBe("revised");
      expect(body.drafts).toHaveLength(1);
      const capability = body.capability as CapabilityDetailWire;
      expect(capability.statement).toBe(EDITED);
      expect(capability.specChangedSinceMet).toBe(true);
      const drafted = ((await get("changes")).body.changes as ChangeRowWire[]).find((c) => c.id === body.drafts[0].id);
      expect(drafted).toMatchObject({ needsPlacement: true, amends: [{ id: CAPABILITY_ID, delta: "modified" }] });
    });

    it("edits a criterion's text and refuses an id the capability does not own", async () => {
      meetCapability();
      const changed = await post(edit(false, { criteria: [{ id: "c2", text: "A declined card shows the reason" }] }));
      expect((changed.body.capability as CapabilityDetailWire).criteria.find((c) => c.id === "c2")?.text)
        .toBe("A declined card shows the reason");
      const refused = await post(edit(false, { criteria: [{ id: "c9", text: "x" }] }));
      expect(refused.status).toBe(409);
      expect(refused.body.error).toContain("c9");
    });

    it("refuses a node that is not a live capability, writing nothing", async () => {
      const before = readFileSync(capabilityFile(), "utf-8");
      expect((await post(edit(false, { id: AREA_ID }))).status).toBe(409);
      expect(readFileSync(capabilityFile(), "utf-8")).toBe(before);
    });

    it.each([
      ["a body that is not JSON", "{nope"],
      ["no id", { statement: EDITED }],
      ["an empty statement", { id: CAPABILITY_ID, statement: "  " }],
      ["malformed criteria", { id: CAPABILITY_ID, statement: EDITED, criteria: [{ id: "c1" }] }],
      ["an emptied criterion", { id: CAPABILITY_ID, statement: EDITED, criteria: [{ id: "c1", text: "   " }] }],
    ])("answers 400 for %s", async (_name, payload) => {
      const before = readFileSync(capabilityFile(), "utf-8");
      expect((await post(payload)).status).toBe(400);
      expect(readFileSync(capabilityFile(), "utf-8")).toBe(before);
    });

    it("stores criterion text trimmed, as rex product edit does", async () => {
      meetCapability();
      const { body } = await post(edit(false, {
        statement: "A shopper can pay for a basket with a card.",
        criteria: [{ id: "c1", text: "  A valid card is charged once  " }],
      }));
      expect(body.outcome).toBe("unchanged");
      expect((body.capability as CapabilityDetailWire).criteria.find((c) => c.id === "c1")?.text)
        .toBe("A valid card is charged once");
    });
  });
});

describe("product reads on a v1 project", () => {
  let tmpDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v1-product-"));
    const rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(join(rexDir, "prd_tree"), { recursive: true });
    mkdirSync(svDir, { recursive: true });
    ({ server, base } = await serve({ projectDir: tmpDir, svDir, rexDir, dev: false }));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(["product", "changes", "product/capability/A1.1"])("GET /%s answers layout v1 and nothing else", async (path) => {
    const res = await fetch(`${base}/${path}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ layout: "v1" });
  });

  it("POST /product/edit refuses on a v1 tree and writes nothing", async () => {
    const res = await fetch(`${base}/product/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: CAPABILITY_ID, statement: "x", criteria: [], editorial: false }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("v1");
    expect(existsSync(join(tmpDir, ".rex", "product"))).toBe(false);
  });
});

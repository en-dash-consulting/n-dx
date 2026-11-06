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
  AreaDetailWire,
  CapabilityDetailWire,
  ChangeRowWire,
  ChangeSummaryWire,
  ProductMapWire,
} from "../../../src/server/routes-rex/product.js";
import type {
  ChangePlacementWire,
  ChangePlacementsWire,
  PlaceChangeRequestWire,
  PlaceChangeResultWire,
  ProposeChangeRequestWire,
  ProposeChangeResultWire,
  PlacementDraftWire,
} from "../../../src/server/routes-rex/placement.js";
import type { ChangePlacementErrorKind } from "../../../src/server/rex-gateway.js";
import type {
  AreaDetail,
  CapabilityDetail,
  ChangePlacement,
  ChangePlacements,
  ChangeRow,
  ChangeSummary,
  PlaceChangeRequest,
  PlaceChangeResult,
  PlacementDraft,
  PlacementRefusalKind,
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
const sameSummary: Same<ChangeSummaryWire, ChangeSummary> = true;
const sameArea: Same<AreaDetailWire, AreaDetail> = true;
const samePlacement: Same<ChangePlacementWire, ChangePlacement> = true;
const samePlacements: Same<ChangePlacementsWire, ChangePlacements> = true;
const samePlace:Same<PlaceChangeRequestWire, PlaceChangeRequest> = true;
const samePlaced: Same<PlaceChangeResultWire, PlaceChangeResult> = true;
const samePropose: Same<ProposeChangeRequestWire, ProposeChangeRequest> = true;
const sameProposed: Same<ProposeChangeResultWire, ProposeChangeResult> = true;
const sameDraft: Same<PlacementDraftWire, PlacementDraft> = true;
// The refusal kinds the viewer words a hint for are rex's, which the 422 answer carries.
const sameRefusalKind: Same<ChangePlacementErrorKind, PlacementRefusalKind> = true;
void [sameMap, sameChange, sameCapability, sameSummary, sameArea, samePlacement, samePlacements, samePlace, samePlaced, samePropose, sameProposed, sameDraft, sameRefusalKind];

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const AREA_ID = "a0000000-0000-4000-8000-000000000001";
const CAPABILITY_ID = "a0000000-0000-4000-8000-000000000002";
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
const TASK_ID = "c0000000-0000-4000-8000-000000000002";

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
      slug: "checkout",
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
      openChangeIds: [CHANGE_ID],
    }]);
  });

  it("GET /product drops an applied change from the overlays", async () => {
    applyChange();
    const { body } = await get("product");
    const area = (body.map as ProductMap).areas[0];
    expect(area.capabilities[0].openChanges).toEqual([]);
    expect(area.openChangeIds).toEqual([]);
  });

  describe("GET /product per-area open changes", () => {
    const OTHER_ID = "c0000000-0000-4000-8000-0000000000a1";
    /** A second open change with the given amendments and touches. */
    const addChange = (amends: unknown[], touches: string[] = []): void => {
      const dir = join(rexDir, "changes", "other");
      mkdirSync(dir);
      writeFileSync(join(dir, "index.md"), [
        "---", `id: "${OTHER_ID}"`, 'type: "change"', 'title: "Other"', 'slug: "other"',
        `amends: ${JSON.stringify(amends)}`, `touches: ${JSON.stringify(touches)}`, "---", "",
      ].join("\n"));
      writeFileSync(join(dir, "state.yaml"), ['schema: "rex/v2"', "items:", `  "${OTHER_ID}":`, '    status: "pending"', ""].join("\n"));
    };
    const area = async () => ((await get("product")).body.map as ProductMap).areas[0];
    const added = (target: string, under: string, type = "capability") =>
      ({ target, delta: "added", type, under, title: target, summary: `Adds ${target}` });

    it("counts a change that adds a capability under the area", async () => {
      addChange([added("refunds", AREA_ID)]);
      expect((await area()).openChangeIds.sort()).toEqual([CHANGE_ID, OTHER_ID].sort());
    });

    it("counts a change whose overlay is keyed by the area id", async () => {
      addChange([{ target: AREA_ID, delta: "removed", summary: "Retire checkout" }]);
      const a = await area();
      expect(a.openChangeIds).toContain(OTHER_ID);
      // No capability carries it: only the area's count does.
      expect(a.capabilities[0].openChanges.map((c) => c.id)).not.toContain(OTHER_ID);
    });

    it("counts one change once however many of the area's nodes it reaches", async () => {
      addChange([{ target: AREA_ID, delta: "removed", summary: "Retire checkout" }], [CAPABILITY_ID]);
      expect((await area()).openChangeIds.filter((id) => id === OTHER_ID)).toHaveLength(1);
    });

    // Open changes' ?area=<slug> keeps the rows naming that slug; its count must be the badge's.
    const cases: Array<[string, () => void]> = [
      ["an amendment to a capability", () => {}],
      ["an addition under the area", () => addChange([added("refunds", AREA_ID)])],
      ["a removal of the area itself", () => addChange([{ target: AREA_ID, delta: "removed", summary: "Retire checkout" }])],
      ["a touch on the area and its capability", () => addChange([], [AREA_ID, CAPABILITY_ID])],
    ];
    for (const [label, seed] of cases) {
      it(`filters /changes by area to the badge's open changes: ${label}`, async () => {
        seed();
        const a = await area();
        const rows = (await get("changes")).body.changes as ChangeRow[];
        const filtered = rows.filter((r) => r.areas?.some((ref) => ref.slug === a.slug));
        expect(filtered.map((r) => r.id).sort()).toEqual([...a.openChangeIds].sort());
        expect(filtered).toHaveLength(a.openChangeIds.length);
      });

      it(`lists the badge's open changes in the area view's Moving now: ${label}`, async () => {
        seed();
        const a = await area();
        const detail = (await get(`product/area/${a.slug}`)).body.area as AreaDetail;
        expect(detail.openChanges.map((c) => c.id).sort()).toEqual([...a.openChangeIds].sort());
        expect(detail.counts.openChanges).toBe(a.openChangeIds.length);
      });
    }

    it("lists a change that only adds a capability under the area in Moving now, as added", async () => {
      applyChange();
      addChange([added("refunds", AREA_ID)]);
      const detail = (await get("product/area/checkout")).body.area as AreaDetail;
      expect(detail.openChanges).toEqual([{ id: OTHER_ID, title: "Other", stage: expect.any(String), delta: "added" }]);
      expect(detail.counts.openChanges).toBe(1);
    });
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
        // The change carries no criteria of its own, as after rex's split, but its
        // one open task does: no gap.
        criteriaGap: false,
        openBlockers: 0,
        // The area whose openChangeIds lists it: Open changes' ?area= filter matches this.
        areas: [{ id: AREA_ID, slug: "checkout", title: "Checkout" }],
      }],
    });
  });

  it("GET /changes names no area on applied history", async () => {
    applyChange();
    const rows = (await get("changes")).body.changes as ChangeRow[];
    expect(rows[0]!.areas).toBeUndefined();
  });

  describe("GET /changes gap fields", () => {
    const changeDir = () => join(rexDir, "changes", "add-apple-pay");
    const taskPath = () => join(changeDir(), "wire-the-button.md");
    const indexPath = () => join(changeDir(), "index.md");
    const row = async () => (await get("changes")).body.changes[0] as ChangeRowWire;
    const withChangeCriteria = (): void => {
      writeFileSync(indexPath(), readFileSync(indexPath(), "utf-8").replace(
        'priority: "high"\n', 'priority: "high"\nacceptanceCriteria:\n  - "Apple Pay completes a purchase"\n',
      ));
    };
    const blockerId = "c0000000-0000-4000-8000-0000000000b1";
    /** A sibling change that blocks the fixture's task, with the given status. */
    const addBlocker = (status: "pending" | "completed"): void => {
      writeFileSync(taskPath(), readFileSync(taskPath(), "utf-8").replace(
        'type: "task"\n', `type: "task"\nblockedBy: ["${blockerId}"]\n`,
      ));
      const dir = join(rexDir, "changes", "blocker");
      mkdirSync(dir);
      writeFileSync(join(dir, "index.md"), [
        "---", `id: "${blockerId}"`, 'type: "change"', 'title: "Blocker"', 'slug: "blocker"', "---", "",
      ].join("\n"));
      writeFileSync(join(dir, "state.yaml"), ['schema: "rex/v2"', "items:", `  "${blockerId}":`, `    status: "${status}"`, ""].join("\n"));
    };

    it("reports no gap when the change and its open task both carry criteria", async () => {
      withChangeCriteria();
      expect(await row()).toMatchObject({ criteriaGap: false, openBlockers: 0 });
    });

    it("reports no gap for a task-less change that has its own criteria", async () => {
      withChangeCriteria();
      rmSync(taskPath());
      expect(await row()).toMatchObject({ taskCount: 0, criteriaGap: false });
    });

    it("reports a gap for a task-less change without criteria", async () => {
      rmSync(taskPath());
      expect(await row()).toMatchObject({ taskCount: 0, criteriaGap: true });
    });

    const dropTaskCriteria = (): void => {
      writeFileSync(taskPath(), readFileSync(taskPath(), "utf-8").replace(/acceptanceCriteria:\n {2}- .*\n/, ""));
    };
    /** The fixture's task has no state row; add one. */
    const setTaskStatus = (status: string): void => {
      const statePath = join(changeDir(), "state.yaml");
      writeFileSync(statePath, `${readFileSync(statePath, "utf-8")}  "${TASK_ID}":\n    status: "${status}"\n`);
    };

    it("reports a gap when an open task has no criteria", async () => {
      withChangeCriteria();
      dropTaskCriteria();
      expect((await row()).criteriaGap).toBe(true);
    });

    it("ignores a cancelled task without criteria, and its blockers", async () => {
      dropTaskCriteria();
      addBlocker("pending");
      setTaskStatus("cancelled");
      expect(await row()).toMatchObject({ criteriaGap: false, openBlockers: 0 });
    });

    it("counts an open blocker on a task", async () => {
      addBlocker("pending");
      expect((await row()).openBlockers).toBe(1);
    });

    it("does not count a completed blocker", async () => {
      addBlocker("completed");
      expect((await row()).openBlockers).toBe(0);
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

  describe("stage of an open change whose own state is empty", () => {
    it("reads in-progress while one of its tasks is in_progress", async () => {
      writeTaskStartedState();
      expect(((await get("changes")).body.changes as ChangeRow[])[0].stage).toBe("in-progress");
    });

    it("reads proposed when no task has started and the change is not ready", async () => {
      writeEmptyChangeState();
      expect(((await get("changes")).body.changes as ChangeRow[])[0].stage).toBe("proposed");
    });

    // Rex never clears startedAt: a failed `ndx work` run resets the task to pending and keeps it.
    it("reads proposed when its task was reset to pending after starting", async () => {
      writeEmptyChangeState(`  "${TASK_ID}":\n    status: "pending"\n    startedAt: "2026-11-05T12:00:00.000Z"\n`);
      expect(((await get("changes")).body.changes as ChangeRow[])[0].stage).toBe("proposed");
      expect(((await get("changes/summary")).body.summary as ChangeSummary).stages["in-progress"]).toBe(0);
    });

    it("reads in-progress while one task is completed and another is still pending", async () => {
      const secondTaskId = "c0000000-0000-4000-8000-000000000003";
      writeFileSync(
        join(rexDir, "changes", "add-apple-pay", "show-the-total.md"),
        `---\nid: "${secondTaskId}"\ntype: "task"\ntitle: "Show the total"\nslug: "show-the-total"\n---\n`,
      );
      writeEmptyChangeState(
        `  "${TASK_ID}":\n    status: "completed"\n    startedAt: "2026-11-05T12:00:00.000Z"\n    completedAt: "2026-11-05T13:00:00.000Z"\n` +
        `  "${secondTaskId}":\n    status: "pending"\n`,
      );
      expect(((await get("changes")).body.changes as ChangeRow[])[0].stage).toBe("in-progress");
    });
  });

  /** The change's own state row cleared, as before `ndx work` starts anything. */
  function writeEmptyChangeState(extra = ""): void {
    writeFileSync(join(rexDir, "changes", "add-apple-pay", "state.yaml"), `schema: "rex/v2"\nitems:\n${extra}`);
  }

  /** The change's own state empty and its task started, as `ndx work` leaves them. */
  function writeTaskStartedState(): void {
    writeEmptyChangeState(`  "${TASK_ID}":\n    status: "in_progress"\n    startedAt: "2026-11-05T12:00:00.000Z"\n`);
  }

  it("GET /changes reads a shipped change as shipped", async () => {
    applyChange();
    const { body } = await get("changes");
    expect((body.changes as ChangeRow[])[0]).toMatchObject({ stage: "shipped", shippedIn: "1.2.0" });
  });

  describe("GET /changes/summary", () => {
    /** An unplaced change, as `rex add` files one into the Inbox. */
    function addInboxChange(): void {
      const id = "c0000000-0000-4000-8000-000000000009";
      const dir = join(rexDir, "changes", "gift-cards");
      mkdirSync(dir);
      writeFileSync(join(dir, "index.md"), [
        "---", `id: "${id}"`, 'type: "change"', 'title: "Gift cards"', 'slug: "gift-cards"', "---", "",
      ].join("\n"));
      writeFileSync(join(dir, "state.yaml"), ['schema: "rex/v2"', "items:", `  "${id}":`, "    needsPlacement: true", ""].join("\n"));
    }

    it("counts stages and Inbox, lists placed open changes and names rex's next pick", async () => {
      const { status, body } = await get("changes/summary");
      expect(status).toBe(200);
      expect(body).toEqual({
        layout: "v2",
        summary: {
          inbox: 0,
          stages: { proposed: 0, ready: 0, "in-progress": 1, "awaiting-apply": 0 },
          open: [{
            id: CHANGE_ID,
            displayId: "CH-1",
            title: "Add Apple Pay",
            stage: "in-progress",
            priority: "high",
            plannedRelease: "1.2.0",
            taskCount: 1,
            completedTaskCount: 0,
            criteriaGap: false,
            openBlockers: 0,
          }],
          next: {
            id: TASK_ID,
            title: "Wire the button",
            type: "task",
            changeId: CHANGE_ID,
            changeDisplayId: "CH-1",
            changeTitle: "Add Apple Pay",
            reason: expect.any(String),
            summary: expect.any(String),
          },
          // The fixture's one open change and its task hold no requirement.
          requirements: { total: 0, uncovered: 1 },
        },
      });
      const summary = (body as { summary: ChangeSummary }).summary;
      expect(["in_progress", "ready_to_finalize", "priority"]).toContain(summary.next!.reason);
    });

    it("counts an Inbox change apart from the stages and leaves it out of the open list", async () => {
      addInboxChange();
      const summary = (await get("changes/summary")).body.summary as ChangeSummary;
      expect(summary.inbox).toBe(1);
      expect(summary.stages).toEqual({ proposed: 0, ready: 0, "in-progress": 1, "awaiting-apply": 0 });
      expect(summary.open.map((c) => c.id)).toEqual([CHANGE_ID]);
    });

    describe("requirement coverage reads the change layer, as rex ready does on v2", () => {
      const req = (id: string, validationType: string) =>
        `{"id":"${id}","title":"${id}","category":"technical","validationType":"${validationType}","acceptanceCriteria":["x"]}`;
      /** Put a requirements line just before a node file's closing frontmatter fence. */
      const withReqs = (file: string, reqs: string[]): void => {
        const original = readFileSync(file, "utf8");
        writeFileSync(file, original.replace(/\n---\n/, `\nrequirements: [${reqs.join(",")}]\n---\n`));
      };
      const coverage = async () => ((await get("changes/summary")).body.summary as ChangeSummary).requirements;
      const changeDir = () => join(rexDir, "changes", "add-apple-pay");

      it("ignores product-layer requirements, which rex ready never reads", async () => {
        withReqs(join(rexDir, "product", "checkout", "pay-by-card.md"), [req("r1", "automated")]);
        expect(await coverage()).toEqual({ total: 0, uncovered: 1 });
      });

      it("counts automated and metric requirements on a task, not manual ones", async () => {
        withReqs(join(changeDir(), "wire-the-button.md"), [req("r1", "manual"), req("r2", "automated"), req("r3", "metric")]);
        expect(await coverage()).toEqual({ total: 2, uncovered: 0 });
      });

      it("counts a requirement on the change itself", async () => {
        withReqs(join(changeDir(), "index.md"), [req("r1", "automated")]);
        expect(await coverage()).toEqual({ total: 1, uncovered: 0 });
      });

      it("leaves out a completed task and an applied change", async () => {
        withReqs(join(changeDir(), "wire-the-button.md"), [req("r1", "automated")]);
        const statePath = join(changeDir(), "state.yaml");
        writeFileSync(statePath, `${readFileSync(statePath, "utf8")}  "${TASK_ID}":\n    status: "completed"\n`);
        expect(await coverage()).toEqual({ total: 0, uncovered: 1 });
        applyChange();
        expect(await coverage()).toEqual({ total: 0, uncovered: 0 });
      });

      it("leaves out a completed change awaiting apply, which ready treats as terminal", async () => {
        withReqs(join(changeDir(), "index.md"), [req("r1", "automated")]);
        const statePath = join(changeDir(), "state.yaml");
        writeFileSync(statePath, readFileSync(statePath, "utf8").replace('    status: "in_progress"\n', '    status: "completed"\n'));
        expect(await coverage()).toEqual({ total: 0, uncovered: 0 });
      });
    });

    it("counts a change whose task is in_progress under in-progress, not proposed", async () => {
      writeTaskStartedState();
      const summary = (await get("changes/summary")).body.summary as ChangeSummary;
      expect(summary.stages).toEqual({ proposed: 0, ready: 0, "in-progress": 1, "awaiting-apply": 0 });
      expect(summary.open[0].stage).toBe("in-progress");
    });

    it("counts an unstarted, unready change as proposed", async () => {
      writeEmptyChangeState();
      const summary = (await get("changes/summary")).body.summary as ChangeSummary;
      expect(summary.stages).toEqual({ proposed: 1, ready: 0, "in-progress": 0, "awaiting-apply": 0 });
    });

    it("reads the tree on every request, so a write shows on the next read", async () => {
      expect(((await get("changes/summary")).body.summary as ChangeSummary).stages["in-progress"]).toBe(1);
      applyChange();
      const summary = (await get("changes/summary")).body.summary as ChangeSummary;
      expect(summary.stages["in-progress"]).toBe(0);
      expect(summary.open).toEqual([]);
      expect(summary.next).toBeNull();
    });
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
    // The open change amends it, so what it would change rides along for the area view's diff.
    expect(capability.pendingAmendments).toEqual([
      expect.objectContaining({ changeId: CHANGE_ID, changeDisplayId: "CH-1", stage: "in-progress", delta: "modified", summary: expect.any(String) }),
    ]);
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

  describe("GET /product/area/<slug-or-id>", () => {
    const CONSTRAINT_ID = "a0000000-0000-4000-8000-000000000010";
    const OTHER_CONSTRAINT_ID = "a0000000-0000-4000-8000-000000000011";
    const OTHER_AREA_ID = "a0000000-0000-4000-8000-000000000020";
    const INBOX_ID = "c0000000-0000-4000-8000-000000000030";

    const write = (path: string, lines: string[]): void => {
      mkdirSync(join(rexDir, path, ".."), { recursive: true });
      writeFileSync(join(rexDir, path), [...lines, ""].join("\n"));
    };

    /**
     * Adds to the fixture: a constraint binding Checkout, a second area with a
     * constraint of its own, code on the capability and an Inbox change whose
     * best guess is "Pay by card".
     */
    beforeEach(() => {
      const card = join(rexDir, "product", "checkout", "pay-by-card.md");
      writeFileSync(card, readFileSync(card, "utf-8").replace('criteria: [', 'realizedBy: ["src/pay/card.ts"]\ncriteria: ['));
      write("product/no-card-storage.md", [
        "---", `id: "${CONSTRAINT_ID}"`, 'type: "constraint"', 'title: "No card storage"', 'slug: "no-card-storage"',
        'statement: "Card numbers never touch our disk."', `appliesTo: ["${AREA_ID}"]`, "---",
      ]);
      write("product/catalogue/index.md", [
        "---", `id: "${OTHER_AREA_ID}"`, 'type: "area"', 'title: "Catalogue"', 'slug: "catalogue"', "---",
      ]);
      write("product/catalogue/images-load-fast.md", [
        "---", `id: "${OTHER_CONSTRAINT_ID}"`, 'type: "constraint"', 'title: "Images load fast"', 'slug: "images-load-fast"',
        `appliesTo: ["${OTHER_AREA_ID}"]`, "---",
      ]);
      write("changes/save-a-card/index.md", [
        "---", `id: "${INBOX_ID}"`, 'type: "change"', 'title: "Pay by card with a saved card"', 'slug: "save-a-card"',
        'intent: "A shopper can pay by card without typing the card again."', "---",
      ]);
      write("changes/save-a-card/state.yaml", ['schema: "rex/v2"', "items:", `  "${INBOX_ID}":`, "    needsPlacement: true"]);
    });

    it("answers the area's capabilities, constraints, open changes, Inbox guesses and code", async () => {
      const { status, body } = await get("product/area/checkout");
      expect(status).toBe(200);
      expect(body.layout).toBe("v2");
      const area = body.area as AreaDetail;
      expect(area).toMatchObject({
        id: AREA_ID,
        slug: "checkout",
        title: "Checkout",
        summary: "Taking payment for a basket.",
        stewards: [],
        counts: { capabilities: 1, constraints: 1, met: 0, changing: 1, defective: 0, openChanges: 1 },
        recentlyApplied: [],
        code: [{ capabilityId: CAPABILITY_ID, path: "src/pay/card.ts" }],
      });
      expect(area.capabilities).toEqual([expect.objectContaining({
        id: CAPABILITY_ID,
        statement: "A shopper can pay for a basket with a card.",
        status: "changing",
        health: "ok",
        criteriaCount: 2,
        openChanges: [{ id: CHANGE_ID, displayId: "CH-1", title: "Add Apple Pay", stage: "in-progress", delta: "modified" }],
      })]);
      // The Catalogue constraint binds another area only.
      expect(area.constraints.map((c) => c.id)).toEqual([CONSTRAINT_ID]);
      expect(area.openChanges).toEqual([{ id: CHANGE_ID, displayId: "CH-1", title: "Add Apple Pay", stage: "in-progress", delta: "modified" }]);
      expect(area.inbox).toEqual([expect.objectContaining({
        id: INBOX_ID,
        title: "Pay by card with a saved card",
        target: { id: CAPABILITY_ID, title: "Pay by card", type: "capability" },
      })]);
    });

    it("leaves a retired capability out of the capability count", async () => {
      const RETIRED_ID = "a0000000-0000-4000-8000-000000000004";
      const REMOVER_ID = "c0000000-0000-4000-8000-000000000040";
      write("product/checkout/pay-by-cheque.md", [
        "---", `id: "${RETIRED_ID}"`, 'type: "capability"', 'title: "Pay by cheque"', 'slug: "pay-by-cheque"',
        'statement: "A shopper can pay by cheque."', "---",
      ]);
      const checkoutState = join(rexDir, "product", "checkout", "state.yaml");
      writeFileSync(checkoutState, `${readFileSync(checkoutState, "utf-8")}  "${RETIRED_ID}":\n    status: "deleted"\n`);
      write("changes/drop-cheques/index.md", [
        "---", `id: "${REMOVER_ID}"`, 'type: "change"', 'title: "Drop cheques"', 'slug: "drop-cheques"',
        `amends: [{"target":"${RETIRED_ID}","delta":"removed","summary":"Nobody pays by cheque"}]`, "---",
      ]);
      write("changes/drop-cheques/state.yaml", [
        'schema: "rex/v2"', "items:", `  "${REMOVER_ID}":`, '    status: "completed"', '    appliedAt: "2026-10-05T12:00:00.000Z"',
      ]);
      const area = (await get("product/area/checkout")).body.area as AreaDetail;
      // rex's report omits a tombstone today, so the row never arrives; if it
      // ever does, `counts.capabilities` still counts only the live ones.
      expect(area.capabilities.map((c) => c.id)).toEqual([CAPABILITY_ID]);
      expect(area.counts.capabilities).toBe(1);
    });

    it("marks an Inbox guess tied when the top two candidates share a score", async () => {
      const untied = (await get("product/area/checkout")).body.area as AreaDetail;
      expect(untied.inbox[0]!.strength).not.toBe("tied");
      // A twin of "Pay by card" scores the same against the Inbox change.
      write("product/checkout/pay-by-card-twin.md", [
        "---", 'id: "a0000000-0000-4000-8000-000000000003"', 'type: "capability"', 'title: "Pay by card"',
        'slug: "pay-by-card-twin"', 'statement: "A shopper can pay for a basket with a card."',
        'criteria: [{"id":"c1","text":"A valid card is charged once"},{"id":"c2","text":"A declined card shows why"}]', "---",
      ]);
      const area = (await get("product/area/checkout")).body.area as AreaDetail;
      expect(area.inbox).toEqual([expect.objectContaining({ id: INBOX_ID, strength: "tied" })]);
    });

    it("resolves the area by id and display id, and lists an applied change as recently applied", async () => {
      applyChange();
      for (const ref of [AREA_ID, "A1"]) {
        const area = (await get(`product/area/${ref}`)).body.area as AreaDetail;
        expect(area.id).toBe(AREA_ID);
        expect(area.openChanges).toEqual([]);
        expect(area.recentlyApplied).toEqual([{
          id: CHANGE_ID, displayId: "CH-1", title: "Add Apple Pay", appliedAt: "2026-10-05T12:00:00.000Z", shippedIn: "1.2.0",
        }]);
      }
    });

    it("keeps another area's guesses and constraints out", async () => {
      const area = (await get("product/area/catalogue")).body.area as AreaDetail;
      expect(area).toMatchObject({ id: OTHER_AREA_ID, capabilities: [], openChanges: [], inbox: [], code: [] });
      expect(area.constraints.map((c) => c.id)).toEqual([OTHER_CONSTRAINT_ID]);
    });

    it.each(["no-such-area", CAPABILITY_ID])("answers 404 for %s", async (ref) => {
      const { status, body } = await get(`product/area/${ref}`);
      expect(status).toBe(404);
      expect(body.error).toContain(ref);
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

  it.each(["product", "changes", "changes/summary", "product/capability/A1.1", "product/area/checkout"])("GET /%s answers layout v1 and nothing else", async (path) => {
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

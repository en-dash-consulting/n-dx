/**
 * Item routes on a v2 project: Quick Add creates an Inbox change and status
 * PATCH goes through rex's v2 completion. v1 is covered by routes-rex.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { refreshPRDCache } from "../../../src/server/prd-io.js";
import { REFINEMENT_FENCE_TAG, itemFingerprint, parseAnswerRefinements, type RefinementProposal } from "../../../src/server/prd-refinement.js";
import { itemTypeOf } from "../../../src/shared/index.js";
import { resolveStore, findItem, detectReorganizations, type PRDItem } from "@n-dx/rex";
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
    expect(created).toMatchObject({ ok: true, type: "change", title: "Support gift cards", needsPlacement: true });
    expect(created).not.toHaveProperty("level");

    const store = await resolveStore(rexDir);
    const item = await store.getItem(created.id);
    expect(item).toMatchObject({ title: "Support gift cards", type: "change", needsPlacement: true, description: "Shoppers ask for them." });
  });

  it("POST /items ignores the v1 level the viewer sends", async () => {
    const res = await send("POST", "items", { title: "From Quick Add", level: "task" });
    expect(res.status).toBe(201);
    expect((await res.json()).type).toBe("change");
  });

  it("POST /items accepts type change", async () => {
    const res = await send("POST", "items", { title: "Explicit change", type: "change" });
    expect(res.status).toBe(201);
    expect((await res.json()).type).toBe("change");
  });

  it.each(["capability", "task", "subtask"])("POST /items refuses type %s with a reason and writes nothing", async (type) => {
    const count = async () => (await (await resolveStore(rexDir)).loadDocument()).items.length;
    const before = await count();
    const res = await send("POST", "items", { title: "Typed", type });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(`not a ${type}`);
    expect(await count()).toBe(before);
  });

  const taskFields = {
    description: "Card form takes Apple Pay.",
    acceptanceCriteria: ["Apple Pay button shows on Safari"],
    priority: "high",
  };

  it("POST /items adds a task under a placed change", async () => {
    const res = await send("POST", "items", { title: "Wire Apple Pay", parentId: CHANGE_ID, type: "task", ...taskFields });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ ok: true, type: "task", title: "Wire Apple Pay", parentId: CHANGE_ID });
    expect(created).not.toHaveProperty("level");

    const change = (await (await resolveStore(rexDir)).getItem(CHANGE_ID))!;
    const task = change.children?.find((c) => c.id === created.id);
    expect(task).toMatchObject({ type: "task", title: "Wire Apple Pay", status: "pending", ...taskFields });
  });

  it("POST /items adds a task under an Inbox change, inferring the type from the parent", async () => {
    const inbox = await (await send("POST", "items", { title: "Support gift cards" })).json();
    const res = await send("POST", "items", { title: "Gift card balance check", parentId: inbox.id, ...taskFields });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ type: "task", parentId: inbox.id });

    const change = (await (await resolveStore(rexDir)).getItem(inbox.id))!;
    expect(change.children?.map((c) => c.title)).toEqual(["Gift card balance check"]);
    expect(change.needsPlacement).toBe(true);
  });

  it("POST /items refuses a change or feature under a change and writes nothing", async () => {
    const before = JSON.stringify((await (await resolveStore(rexDir)).loadDocument()).items);
    for (const type of ["change", "feature"]) {
      const res = await send("POST", "items", { title: "Nested", parentId: CHANGE_ID, type });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("a task");
    }
    expect(JSON.stringify((await (await resolveStore(rexDir)).loadDocument()).items)).toBe(before);
  });

  it("POST /items refuses a task under a completed change", async () => {
    expect((await send("PATCH", `items/${TASK_ID}`, { status: "completed" })).status).toBe(200);
    expect((await send("PATCH", `items/${CHANGE_ID}`, { status: "completed" })).status).toBe(200);
    const res = await send("POST", "items", { title: "Late", parentId: CHANGE_ID, type: "task" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/follow-up|completed|applied/i);
  });

  it("POST /items answers 404 for a parent that does not exist", async () => {
    const res = await send("POST", "items", { title: "Orphan", parentId: "nope", type: "task" });
    expect(res.status).toBe(404);
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

  it("PATCH completing a change under rex.applyOn review returns why it was left unapplied", async () => {
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({ rex: { applyOn: "review" } }));
    expect((await send("PATCH", `items/${TASK_ID}`, { status: "completed" })).status).toBe(200);
    const res = await send("PATCH", `items/${CHANGE_ID}`, { status: "completed" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.applied).toBe(false);
    expect(body.reason).toEqual(expect.any(String));
    expect(readFileSync(join(rexDir, "product", "checkout", "pay-by-card.md"), "utf-8")).not.toContain("Apple Pay is offered on Safari");
  });

  it("PATCH completing a change that applies carries no reason", async () => {
    expect((await send("PATCH", `items/${TASK_ID}`, { status: "completed" })).status).toBe(200);
    const body = await (await send("PATCH", `items/${CHANGE_ID}`, { status: "completed" })).json();
    expect(body).toEqual({ ok: true });
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

  it("bulk PATCH completing a change under rex.applyOn review reports why it was left unapplied", async () => {
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({ rex: { applyOn: "review" } }));
    expect((await send("PATCH", "items/bulk", { ids: [TASK_ID], updates: { status: "completed" } })).status).toBe(200);
    const res = await send("PATCH", "items/bulk", { ids: [CHANGE_ID], updates: { status: "completed" } });
    expect(res.status).toBe(200);
    const [result] = (await res.json()).results;
    expect(result).toMatchObject({ id: CHANGE_ID, ok: true, applied: false });
    expect(result.reason).toEqual(expect.any(String));
    expect(readFileSync(join(rexDir, "product", "checkout", "pay-by-card.md"), "utf-8")).not.toContain("Apple Pay is offered on Safari");
  });

  it.each([
    ["run", { run: { tier: "heavy" } }, '"run"'],
    ["id", { id: "other" }, '"id"'],
    ["title", { title: "" }, '"title"'],
    ["tags", { tags: "x" }, '"tags"'],
  ])("bulk PATCH with an unacceptable %s answers 400 and writes nothing", async (_name, updates, named) => {
    const store = await resolveStore(rexDir);
    const before = JSON.stringify((await store.loadDocument()).items);
    const res = await send("PATCH", "items/bulk", { ids: [TASK_ID], updates });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(named);
    expect(JSON.stringify((await store.loadDocument()).items)).toBe(before);
    expect(frames).toEqual([]);
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

  describe("merge follows the change-layer rule", () => {
    const PAY_BY_CARD = "a0000000-0000-4000-8000-000000000002";

    /** An Inbox change, a sibling of the fixture's change, with the given v2 fields. */
    async function addChange(title: string, fields: Partial<PRDItem> = {}): Promise<string> {
      const res = await send("POST", "items", { title });
      expect(res.status).toBe(201);
      const { id } = await res.json();
      if (Object.keys(fields).length > 0) await (await resolveStore(rexDir)).updateItem(id, fields);
      return id;
    }

    async function itemById(id: string): Promise<PRDItem | undefined> {
      const doc = await (await resolveStore(rexDir)).loadDocument();
      return findItem(doc.items, id)?.item;
    }

    it("POST /items/merge carries the absorbed change's touches, id, displayId and aliases onto the target", async () => {
      const other = await addChange("Apple Pay, again", { touches: [PAY_BY_CARD], displayId: "CH-7", aliases: ["CH-old"] } as Partial<PRDItem>);
      const res = await send("POST", "items/merge", { sourceIds: [CHANGE_ID, other], targetId: CHANGE_ID });
      expect(res.status).toBe(200);
      expect((await res.json()).absorbedIds).toEqual([other]);

      expect(await itemById(other)).toBeUndefined();
      const target = (await itemById(CHANGE_ID)) as PRDItem & { touches?: string[]; aliases?: string[] };
      expect(target.touches).toEqual([PAY_BY_CARD]);
      expect([...(target.aliases ?? [])].sort()).toEqual([other, "CH-7", "CH-old"].sort());
    });

    it("POST /items/merge refuses to absorb a change carrying amends, with rex's reason, and writes nothing", async () => {
      const other = await addChange("Apple Pay, again");
      const before = treeSnapshot(rexDir);
      const res = await send("POST", "items/merge", { sourceIds: [CHANGE_ID, other], targetId: other });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/carries amendments/);
      expect(treeSnapshot(rexDir)).toEqual(before);
      expect(frames.filter((f) => (f as { type?: string }).type === "rex:prd-changed")).toHaveLength(1); // the add only
    });

    it("POST /items/merge refuses to merge tasks, with rex's reason, and writes nothing", async () => {
      const task2 = randomUUID();
      await (await resolveStore(rexDir)).addItem(
        { id: task2, title: "Style the button", status: "pending", level: "task", type: "task" } as PRDItem,
        CHANGE_ID,
      );
      const before = treeSnapshot(rexDir);
      const res = await send("POST", "items/merge", { sourceIds: [TASK_ID, task2], targetId: TASK_ID });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/merges changes only/);
      expect(treeSnapshot(rexDir)).toEqual(before);
    });

    it("POST /items/merge preview refuses what the merge would refuse", async () => {
      const other = await addChange("Apple Pay, again");
      const res = await send("POST", "items/merge", { sourceIds: [CHANGE_ID, other], targetId: other, preview: true });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/carries amendments/);
    });

    it("POST /apply-refinements merges through the change-layer rule", async () => {
      const other = await addChange("Apple Pay, again", { touches: [PAY_BY_CARD], displayId: "CH-7" } as Partial<PRDItem>);
      const doc = await (await resolveStore(rexDir)).loadDocument();
      const merge = (itemId: string, intoId: string, id: string): RefinementProposal => ({
        id,
        op: "merge",
        itemId,
        itemTitle: findItem(doc.items, itemId)!.item.title,
        itemType: itemTypeOf(findItem(doc.items, itemId)!.item),
        rationale: "Same work.",
        intoId,
        intoTitle: findItem(doc.items, intoId)!.item.title,
        diffs: [],
        baseline: [
          { itemId, fingerprint: itemFingerprint(findItem(doc.items, itemId)!.item) },
          { itemId: intoId, fingerprint: itemFingerprint(findItem(doc.items, intoId)!.item) },
        ],
      });

      // Absorbing the amending change is refused; absorbing the plain one carries its touches and ids.
      const res = await send("POST", "apply-refinements", {
        proposals: [merge(CHANGE_ID, other, "r1"), merge(other, CHANGE_ID, "r2")],
      });
      expect(res.status).toBe(200);
      const outcomes = (await res.json()).outcomes as Array<{ id: string; status: string; detail?: string }>;
      expect(outcomes.find((o) => o.id === "r1")).toMatchObject({ status: "invalid", detail: expect.stringMatching(/carries amendments/) });
      expect(outcomes.find((o) => o.id === "r2")).toMatchObject({ status: "applied" });

      const target = (await itemById(CHANGE_ID)) as PRDItem & { touches?: string[]; aliases?: string[] };
      expect(target.touches).toEqual([PAY_BY_CARD]);
      expect([...(target.aliases ?? [])].sort()).toEqual([other, "CH-7"].sort());
    });

    describe("parseAnswerRefinements with the change-layer rule", () => {
      const answer = (itemId: string, intoId: string) =>
        `Same work.\n\`\`\`${REFINEMENT_FENCE_TAG}\n${JSON.stringify([{ op: "merge", itemId, intoId, rationale: "Duplicate." }])}\n\`\`\``;

      it("offers no merge that absorbs an amending change, and notes rex's reason", async () => {
        const other = await addChange("Apple Pay, again");
        const doc = await (await resolveStore(rexDir)).loadDocument();
        const parsed = parseAnswerRefinements(answer(CHANGE_ID, other), doc, { changeLayer: true });
        expect(parsed.proposals).toEqual([]);
        expect(parsed.notes).toHaveLength(1);
        expect(parsed.notes[0]).toMatch(/carries amendments/);
      });

      it("skips a merge of two tasks with rex's reason", async () => {
        const task2 = randomUUID();
        await (await resolveStore(rexDir)).addItem(
          { id: task2, title: "Style the button", status: "pending", level: "task", type: "task" } as PRDItem,
          CHANGE_ID,
        );
        const doc = await (await resolveStore(rexDir)).loadDocument();
        const parsed = parseAnswerRefinements(answer(TASK_ID, task2), doc, { changeLayer: true });
        expect(parsed.proposals).toEqual([]);
        expect(parsed.notes[0]).toMatch(/merges changes only/);
      });
    });

    it("reorganize proposes no v1 orphan or single-child collapse, and its merge carries touches and ids", async () => {
      const giftCards = "a0000000-0000-4000-8000-000000000003";
      writeFileSync(
        join(rexDir, "product", "checkout", "gift-cards.md"),
        `---\nid: "${giftCards}"\ntype: "capability"\ntitle: "Gift cards"\nslug: "gift-cards"\ndisplayId: "A1.2"\nstatement: "A shopper can pay with a gift card."\n---\n`,
      );
      const a = await addChange("Add gift card checkout", { touches: [PAY_BY_CARD] } as Partial<PRDItem>);
      const b = await addChange("Add gift card checkout", { touches: [giftCards], displayId: "CH-9" } as Partial<PRDItem>);
      // A change holding one nested change: v1 detection reads it as an epic
      // with one feature and proposes collapsing it.
      const outer = await addChange("Wallets");
      await (await resolveStore(rexDir)).addItem(
        { id: randomUUID(), title: "Google Pay", status: "pending", level: "feature", type: "change", touches: [PAY_BY_CARD] } as PRDItem,
        outer,
      );
      const doc = await (await resolveStore(rexDir)).loadDocument();
      expect(detectReorganizations(doc.items).proposals.map((p) => p.type)).toContain("collapse");
      refreshPRDCache(rexDir, doc);

      const listed = await fetch(`${base}/reorganize?mode=fast`);
      expect(listed.status).toBe(200);
      const proposals = (await listed.json()).structural.proposals as Array<{ id: number; type: string; items: string[] }>;
      expect(proposals.filter((p) => p.type === "collapse" || p.type === "move")).toEqual([]);
      const duplicate = proposals.find((p) => [...p.items].sort().join() === [a, b].sort().join());
      expect(duplicate).toBeDefined();

      const res = await send("POST", "reorganize/apply", { proposalIds: [duplicate!.id] });
      expect(await res.json()).toMatchObject({ applied: 1, failed: 0 });

      const [target, absorbed] = (await itemById(a)) ? [a, b] : [b, a];
      expect(await itemById(absorbed)).toBeUndefined();
      const node = (await itemById(target)) as PRDItem & { touches?: string[]; aliases?: string[] };
      expect([...(node.touches ?? [])].sort()).toEqual([PAY_BY_CARD, giftCards].sort());
      expect(node.aliases).toEqual(expect.arrayContaining([absorbed]));
      if (absorbed === b) expect(node.aliases).toEqual(expect.arrayContaining(["CH-9"]));
    });
  });
});

/** Every file under `dir` (the PRD cache aside) and its content, to show a refused write wrote nothing. */
function treeSnapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (path.includes(`${sep}.cache${sep}`)) continue;
    out[path] = readFileSync(path, "utf-8");
  }
  return out;
}

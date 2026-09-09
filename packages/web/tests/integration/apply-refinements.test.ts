/**
 * POST /api/rex/apply-refinements — the web server writing to the PRD.
 *
 * This route edits content that already exists, on a model's suggestion, while
 * other writers (`ndx work`, the MCP tools, a `rex` command in another
 * terminal) may be writing the same file. So the tests are mostly about what it
 * refuses to do: write anything that was not accepted, write over an item that
 * changed after the proposal was made, and write at all while another process
 * holds the lock.
 *
 * They run against a real `PRDStore` on a temp directory rather than a mock —
 * the guarantee under test is the lock, and a mocked store has no lock.
 *
 * @see packages/web/src/server/routes-rex-refinements.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { resolveStore, serializeDocument } from "@n-dx/rex";
import type { ServerContext } from "../../src/server/types.js";
import { handleApplyRefinementsRoute } from "../../src/server/routes-rex-refinements.js";
import { closeRouteTestServer } from "../helpers/server-route-test-support.js";

function makePRD() {
  return {
    schema: "rex/v1",
    title: "Test Project",
    items: [
      {
        id: "epic-1",
        title: "Billing",
        status: "pending",
        level: "epic",
        priority: "high",
        children: [
          {
            id: "task-1",
            title: "Ship the billing report",
            status: "pending",
            level: "task",
            priority: "medium",
            description: "Generate the monthly invoice report.",
            acceptanceCriteria: ["Report renders", "Totals reconcile"],
          },
          {
            id: "task-2",
            title: "Billing report (duplicate)",
            status: "pending",
            level: "task",
            priority: "low",
            description: "Duplicate of the report task.",
          },
        ],
      },
      { id: "epic-2", title: "Reporting", status: "pending", level: "epic", priority: "medium" },
    ],
  };
}

const DESCRIPTION_PROPOSAL = {
  id: "refinement-1",
  kind: "description",
  itemId: "task-1",
  itemTitle: "Ship the billing report",
  rationale: "Say which month.",
  before: ["Generate the monthly invoice report."],
  after: ["Generate the invoice report for the closing month."],
};

describe("POST /api/rex/apply-refinements", () => {
  let tmpDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let broadcasts: unknown[];

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "apply-refinements-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await writeFile(join(rexDir, "prd.md"), serializeDocument(makePRD() as never));

    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false } as ServerContext;
    broadcasts = [];

    server = createServer(async (req, res) => {
      if (await handleApplyRefinementsRoute(req, res, ctx, (d) => { broadcasts.push(d); })) return;
      res.writeHead(404);
      res.end("Not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function apply(body: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/apply-refinements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }

  /** Read the PRD back through the store, as another writer would see it. */
  async function readItem(id: string) {
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const find = (items: any[]): any => {
      for (const item of items) {
        if (item.id === id) return item;
        const found = find(item.children ?? []);
        if (found) return found;
      }
      return null;
    };
    return find(doc.items);
  }

  /** The whole tree as bytes, for asserting nothing moved. */
  async function treeSnapshot(): Promise<string> {
    const store = await resolveStore(rexDir);
    return JSON.stringify(await store.loadDocument());
  }

  // ── Writing what was accepted ─────────────────────────────────────────────

  it("applies an accepted description change", async () => {
    const { status, body } = await apply({ proposals: [DESCRIPTION_PROPOSAL] });

    expect(status).toBe(200);
    expect(body.applied).toBe(1);
    expect((await readItem("task-1")).description)
      .toBe("Generate the invoice report for the closing month.");
  });

  it("applies an acceptance-criteria rewrite", async () => {
    const { body } = await apply({
      proposals: [{
        ...DESCRIPTION_PROPOSAL,
        kind: "acceptanceCriteria",
        before: ["Report renders", "Totals reconcile"],
        after: ["Report renders within 2s", "Totals reconcile against the ledger"],
      }],
    });

    expect(body.applied).toBe(1);
    expect((await readItem("task-1")).acceptanceCriteria)
      .toEqual(["Report renders within 2s", "Totals reconcile against the ledger"]);
  });

  it("applies a priority change", async () => {
    const { body } = await apply({
      proposals: [{ ...DESCRIPTION_PROPOSAL, kind: "priority", before: ["medium"], after: ["high"] }],
    });

    expect(body.applied).toBe(1);
    expect((await readItem("task-1")).priority).toBe("high");
  });

  it("reparents an item", async () => {
    const { body } = await apply({
      proposals: [{ ...DESCRIPTION_PROPOSAL, kind: "parent", before: ["epic-1"], after: ["epic-2"] }],
    });

    expect(body.applied).toBe(1);
    const epic2 = await readItem("epic-2");
    expect(epic2.children.map((c: { id: string }) => c.id)).toContain("task-1");
    const epic1 = await readItem("epic-1");
    expect(epic1.children.map((c: { id: string }) => c.id)).not.toContain("task-1");
  });

  it("merges a duplicate sibling into the survivor", async () => {
    const { body } = await apply({
      proposals: [{
        ...DESCRIPTION_PROPOSAL,
        kind: "merge",
        before: ["Billing report (duplicate)"],
        after: ["task-2"],
      }],
    });

    expect(body.applied).toBe(1);
    expect(await readItem("task-2")).toBeNull();
    expect(await readItem("task-1")).not.toBeNull();
  });

  it("applies several accepted proposals in one transaction", async () => {
    const { body } = await apply({
      proposals: [
        DESCRIPTION_PROPOSAL,
        { ...DESCRIPTION_PROPOSAL, id: "refinement-2", kind: "priority", before: ["medium"], after: ["high"] },
      ],
    });

    expect(body.applied).toBe(2);
    const item = await readItem("task-1");
    expect(item.description).toBe("Generate the invoice report for the closing month.");
    expect(item.priority).toBe("high");
  });

  // ── Writing nothing that was not accepted ─────────────────────────────────

  it("writes nothing when the accept list is empty", async () => {
    const before = await treeSnapshot();

    const { status } = await apply({ proposals: [] });

    expect(status).toBe(400);
    // Rejecting every proposal leaves the tree byte-identical.
    expect(await treeSnapshot()).toBe(before);
  });

  it("writes nothing when a proposal is malformed", async () => {
    const before = await treeSnapshot();

    const { status } = await apply({ proposals: [{ kind: "description", itemId: "task-1" }] });

    expect(status).toBe(400);
    expect(await treeSnapshot()).toBe(before);
  });

  it("touches only the item a proposal names", async () => {
    await apply({ proposals: [DESCRIPTION_PROPOSAL] });

    // The sibling and the other epic are exactly as they were.
    expect((await readItem("task-2")).description).toBe("Duplicate of the report task.");
    expect((await readItem("epic-2")).title).toBe("Reporting");
  });

  // ── Refusing what no longer matches ───────────────────────────────────────

  it("refuses a proposal whose item changed after it was made", async () => {
    // Someone edits the item between the answer and the click.
    const store = await resolveStore(rexDir);
    await store.updateItem("task-1", { description: "Rewritten by someone else." });

    const { status, body } = await apply({ proposals: [DESCRIPTION_PROPOSAL] });

    expect(status).toBe(200);
    expect(body.applied).toBe(0);
    expect(body.outcomes[0].reason).toMatch(/has changed since this was proposed/i);
    // Their text survives — the model's `after` did not land on top of it.
    expect((await readItem("task-1")).description).toBe("Rewritten by someone else.");
  });

  it("refuses a proposal for an item that has been deleted", async () => {
    const store = await resolveStore(rexDir);
    await store.removeItem("task-1");

    const { body } = await apply({ proposals: [DESCRIPTION_PROPOSAL] });

    expect(body.applied).toBe(0);
    expect(body.outcomes[0].reason).toMatch(/no longer exists/i);
  });

  it("applies the fresh proposals in a batch and refuses only the stale one", async () => {
    const store = await resolveStore(rexDir);
    await store.updateItem("task-1", { description: "Rewritten by someone else." });

    const { body } = await apply({
      proposals: [
        DESCRIPTION_PROPOSAL, // stale
        { ...DESCRIPTION_PROPOSAL, id: "refinement-2", kind: "priority", before: ["medium"], after: ["high"] },
      ],
    });

    // One item moving underneath the user is not a reason to discard their
    // other decisions.
    expect(body.applied).toBe(1);
    expect(body.refused).toBe(1);
    expect((await readItem("task-1")).priority).toBe("high");
    expect((await readItem("task-1")).description).toBe("Rewritten by someone else.");
  });

  it("refuses to move an item under its own descendant", async () => {
    const { body } = await apply({
      proposals: [{
        id: "refinement-1",
        kind: "parent",
        itemId: "epic-1",
        itemTitle: "Billing",
        rationale: "",
        before: [""],
        after: ["task-1"],
      }],
    });

    expect(body.applied).toBe(0);
    expect(body.outcomes[0].reason).toMatch(/own descendant/i);
    // The subtree is still attached.
    expect(await readItem("task-1")).not.toBeNull();
  });

  // ── Refusing to race another writer ───────────────────────────────────────

  it("fails loudly, naming the holder, when another writer holds the lock", async () => {
    const store = await resolveStore(rexDir);
    const before = await treeSnapshot();

    // Hold the lock the way a concurrent `ndx work` or MCP write would.
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const holding = store.withTransaction(async (doc) => {
      await held;
      return doc;
    });

    try {
      const { status, body } = await apply({ proposals: [DESCRIPTION_PROPOSAL] });

      expect(status).toBe(409);
      expect(body.applied).toBe(0);
      expect(body.error).toMatch(/another process is writing/i);
      // The lock's own message names who holds it.
      expect(body.error).toMatch(/PID \d+|held by/i);
      // And the holder's document is untouched.
      expect(await treeSnapshot()).toBe(before);
    } finally {
      release();
      await holding;
    }
  }, 30_000);

  // ── Telling the rest of the dashboard ─────────────────────────────────────

  it("announces the change so the PRD views refresh without a restart", async () => {
    await apply({ proposals: [DESCRIPTION_PROPOSAL] });

    expect(broadcasts).toContainEqual(
      expect.objectContaining({ type: "rex:prd-changed", source: "sv-ask-refinement" }),
    );
  });

  it("stays quiet when nothing was applied", async () => {
    const store = await resolveStore(rexDir);
    await store.updateItem("task-1", { description: "Rewritten by someone else." });

    await apply({ proposals: [DESCRIPTION_PROPOSAL] });

    // A broadcast with no change behind it makes every listener re-read for
    // nothing.
    expect(broadcasts).toEqual([]);
  });

  it("reports the applied value back, read from the saved document", async () => {
    const { body } = await apply({ proposals: [DESCRIPTION_PROPOSAL] });

    expect(body.items).toEqual([
      expect.objectContaining({
        id: "task-1",
        kind: "description",
        value: ["Generate the invoice report for the closing month."],
      }),
    ]);
  });

  // ── Routing ───────────────────────────────────────────────────────────────

  it("rejects GET", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/apply-refinements`);
    expect(res.status).toBe(405);
  });

  it("rejects a body that is not JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/apply-refinements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});

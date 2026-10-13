/**
 * The Inbox → place → apply workflow through the rex MCP server: add_item
 * creates an Inbox change, place_change amends a capability with the
 * amendment's content, apply_change applies it. In-process server over an
 * in-memory transport, on the v2 fixture tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRexMcpServer } from "../../src/cli/mcp.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";

let tmp: string;
let client: Client;
let close: () => Promise<void>;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-v2-place-apply-"));
  await copyV2Fixture(join(tmp, ".rex"), "lf");
  const server = await createRexMcpServer(tmp);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "place-apply", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close = async () => {
    await client.close();
    await server.close();
  };
});
afterEach(async () => {
  await close();
  await rm(tmp, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  expect(result.isError, result.content[0].text).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

/** add_item → place_change (amends A1.1 with `content`) → apply_change; returns the capability after. */
async function placeAndApply(content: Record<string, unknown>) {
  const { id } = await call("add_item", { title: "Refunds by card" });
  await call("place_change", { id, target: "A1.1", relation: "amends", ...content });
  const applied = await call("apply_change", { id });
  expect(applied.applied).toEqual([{ delta: "modified", nodeId: CAPABILITY, summary: "Refunds by card" }]);
  return (await call("get_capability", { id: CAPABILITY })).node;
}

/** Every file under `.rex/`, path → content. */
async function rexFiles(): Promise<Map<string, string>> {
  const entries = await readdir(join(tmp, ".rex"), { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
  return new Map(await Promise.all(files.map(async (f) => [f, await readFile(f, "utf8")] as const)));
}

describe("Inbox change placed with its amendment content, then applied over MCP", () => {
  it("applies proposed text", async () => {
    const node = await placeAndApply({ proposed: "A shopper can pay and be refunded by card." });
    expect(node.statement).toBe("A shopper can pay and be refunded by card.");
  });

  it("applies a criteria delta with no proposed text", async () => {
    const node = await placeAndApply({ criteria: { add: [{ id: "c9", text: "A card payment can be refunded" }] } });
    expect(node.statement).toBe("A shopper can pay for a basket with a card.");
    expect(node.criteria.map((c: { id: string }) => c.id)).toEqual(["c1", "c2", "c9"]);
  });

  // A1.1 has criteria c1 and c2. Apply refuses each of these, and nothing edits the amendment once placed.
  it.each([
    ["removes a criterion it lacks", { remove: ["c7"] }, "criterion c7 to remove does not exist"],
    ["replaces a criterion it lacks", { replace: [{ id: "c7", text: "x" }] }, "criterion c7 to replace does not exist"],
    ["adds a criterion it has", { add: [{ id: "c1", text: "x" }] }, "criterion c1 to add already exists"],
  ])("refuses a placement that %s and writes nothing", async (_label, criteria, message) => {
    const { id } = await call("add_item", { title: "Refunds by card" });
    const before = await rexFiles();
    const result = (await client.callTool({ name: "place_change", arguments: { id, target: "A1.1", relation: "amends", criteria } })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(await rexFiles()).toEqual(before);
  });

  const modify = (criteria: Record<string, unknown>) => ({ target: "A1.1", delta: "modified", summary: "s", criteria });
  it.each([
    ["removes a criterion it lacks", modify({ remove: ["c7"] }), "criterion c7 to remove does not exist"],
    ["replaces a criterion it lacks", modify({ replace: [{ id: "c7", text: "x" }] }), "criterion c7 to replace does not exist"],
    ["adds a criterion it has", modify({ add: [{ id: "c1", text: "x" }] }), "criterion c1 to add already exists"],
    [
      "replaces a criterion of a capability it adds",
      { target: "A1.9", delta: "added", summary: "s", under: "A1", title: "Refunds", proposed: "Refunds work.", criteria: { replace: [{ id: "c1", text: "x" }] } },
      "amendment 1 (added A1.9): a new capability has no capability criteria to replace or remove",
    ],
  ])("refuses add_item with an amendment that %s, in apply's words, and writes nothing", async (_label, amendment, message) => {
    const before = await rexFiles();
    const amends = [amendment];
    const result = (await client.callTool({ name: "add_item", arguments: { title: "Refunds by card", amends } })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(await rexFiles()).toEqual(before);
  });
});

/**
 * The Inbox is a reserved folder: `add_item` writes an unplaced change into it
 * and `place_change` moves the change out. Both are storage — every read goes
 * through the model, where an Inbox change is a top-level change wherever its
 * folder sits.
 */
describe("the reserved Inbox folder over MCP", () => {
  /** Paths under `.rex/`, forward-slashed, that contain `match`. */
  async function treePaths(match: string): Promise<string[]> {
    const root = join(tmp, ".rex");
    return [...(await rexFiles()).keys()]
      .map((p) => relative(root, p).split("\\").join("/"))
      .filter((p) => p.includes(match))
      .sort();
  }

  it("add_item writes the change to changes/inbox/<slug>/, with needsPlacement in that folder's state.yaml", async () => {
    const { id, needsPlacement } = await call("add_item", { title: "Refunds by card" });

    expect(needsPlacement).toBe(true);
    expect(await treePaths("refunds-by-card")).toEqual([
      "changes/inbox/refunds-by-card/index.md",
      "changes/inbox/refunds-by-card/state.yaml",
    ]);
    const files = await rexFiles();
    expect(files.get(join(tmp, ".rex", "changes", "inbox", "refunds-by-card", "state.yaml"))).toContain(
      `  "${id}":\n    needsPlacement: true\n`,
    );
    expect(files.get(join(tmp, ".rex", "changes", "inbox", "refunds-by-card", "index.md"))).not.toContain("needsPlacement");
  });

  it("place_change moves it out to the change-layer root, keeping its id and slug", async () => {
    const { id } = await call("add_item", { title: "Refunds by card" });

    await call("place_change", { id, target: "A1.1", relation: "touches" });

    expect(await treePaths("refunds-by-card")).toEqual(["changes/refunds-by-card/index.md"]);
    expect(await treePaths("inbox")).toEqual([]);
    const item = await call("get_item", { id });
    expect(item.item).toMatchObject({ id, slug: "refunds-by-card" });
    expect(item.item.needsPlacement).toBeUndefined();
  });

  it("reports the same status and capability changes whichever folder holds the Inbox change", async () => {
    const { id } = await call("add_item", { title: "Refunds by card" });
    const inFolder = await call("get_prd_status", {});
    const capability = await call("get_capability", { id: CAPABILITY });
    expect(inFolder.inbox).toBe(1);
    expect(inFolder.changes.total).toBe(2);

    // The layout PR 17 (#612) shipped: the flag alone, at the change-layer root.
    const rexDir = join(tmp, ".rex");
    await rename(join(rexDir, "changes/inbox/refunds-by-card"), join(rexDir, "changes/refunds-by-card"));
    await rm(join(rexDir, "changes/inbox"), { recursive: true });

    expect(await call("get_prd_status", {})).toEqual(inFolder);
    expect(await call("get_capability", { id: CAPABILITY })).toEqual(capability);

    // Placing it clears the flag, which is what the Inbox count follows.
    await call("place_change", { id, target: "A1.1", relation: "touches" });
    const placed = await call("get_prd_status", {});
    expect(placed.inbox).toBe(0);
    expect(placed.changes).toEqual(inFolder.changes);
    expect((await call("get_capability", { id: CAPABILITY })).changes.map((c: { id: string }) => c.id)).toContain(id);
  });
});

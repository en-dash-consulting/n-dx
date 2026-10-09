/**
 * The Inbox → place → apply workflow through the rex MCP server: add_item
 * creates an Inbox change, place_change amends a capability with the
 * amendment's content, apply_change applies it. In-process server over an
 * in-memory transport, on the v2 fixture tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
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
});

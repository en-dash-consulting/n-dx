/**
 * An Inbox change given a proposed new capability with `recordProposal` (from
 * `src/public.ts`, as the dashboard calls it, under the PRD lock), then
 * applied over MCP: the node reaches the product map under its area only then.
 * In-process server over an in-memory transport, on the v2 fixture tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRexMcpServer } from "../../src/cli/mcp.js";
import { loadPrdModel, recordProposal, withPrdModelTransaction, type RuleNode } from "../../src/public.js";
import { copyV2Fixture } from "../helpers/v2-fixture.js";

const AREA = "a0000000-0000-4000-8000-000000000001";
const NEW_NODE = "d0000000-0000-4000-8000-000000000001";

let tmp: string;
let rexDir: string;
let client: Client;
let close: () => Promise<void>;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-propose-apply-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
  const server = await createRexMcpServer(tmp);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "propose-apply", version: "1.0.0" });
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

const areaChildren = async (): Promise<RuleNode[]> =>
  (await loadPrdModel(rexDir, { env: {}, warn: () => {} })).tree.product.find((n) => n.id === AREA)!.children ?? [];

describe("recordProposal, then apply", () => {
  it("puts the proposed capability on the product map under its area only when the change is applied", async () => {
    const { id } = await call("add_item", { title: "Pay with a wallet" });
    await withPrdModelTransaction(rexDir, (model) => {
      const { tree, proposal } = recordProposal(
        model.tree,
        id,
        {
          type: "capability",
          under: "A1",
          title: "Pay by wallet",
          proposed: "A shopper can pay for a basket with a wallet.",
          criteria: { add: [{ id: "c1", text: "Apple Pay is accepted" }] },
        },
        new Date(),
        { newId: () => NEW_NODE },
      );
      return { tree, result: proposal };
    });

    const stored = (await loadPrdModel(rexDir, { env: {}, warn: () => {} })).tree.changes.find((c) => c.id === id)!;
    expect(stored).not.toHaveProperty("needsPlacement");
    expect((await areaChildren()).map((n) => n.id)).not.toContain(NEW_NODE);

    const applied = await call("apply_change", { id });
    expect(applied.applied).toEqual([{ delta: "added", nodeId: NEW_NODE, summary: "Pay with a wallet" }]);
    const created = (await areaChildren()).find((n) => n.id === NEW_NODE);
    expect(created).toMatchObject({
      type: "capability",
      title: "Pay by wallet",
      statement: "A shopper can pay for a basket with a wallet.",
      criteria: [{ id: "c1", text: "Apple Pay is accepted" }],
    });
  });
});

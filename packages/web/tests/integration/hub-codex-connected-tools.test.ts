/** Real broker/MCP contracts over in-memory transport; no native CLI claim. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createBrokerMcpServer, type BrokerConnections } from "../../src/server/sidecar/broker-mcp.js";
import { SidecarBroker } from "../../src/server/sidecar/broker.js";
import { BROKER_SCOPE_TOOLS, type BrokerScope } from "../../src/server/sidecar/broker-policy.js";
import type { ConnectionTool } from "../../src/server/connections/connection-service.js";

let dir: string;
let broker: SidecarBroker;
const clients: Client[] = [];
const calls = vi.fn<BrokerConnections["callTool"]>(async () => ({ content: [{ type: "text" as const, text: "done" }] }));
const tools: ConnectionTool[] = (["run", "ask", "never"] as const).map((policy) => ({
  connection: "fixture", tool: policy, displayName: `fixture.${policy}`, wireName: `fixture__${policy}`,
  description: "Disposable connection", inputSchema: { type: "object", properties: { value: { type: "string" } } }, annotations: undefined,
  policy: { class: policy === "run" ? "read" : "write", classSource: "default", policy, policySource: "default" },
}));
const connections: BrokerConnections = {
  hasConnections: () => true, listTools: async () => tools, check: async () => ({ state: "connected" }),
  callContext: () => ({ label: "Fixture", host: "fixture.test", fieldHints: {} }), callTool: calls,
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hub-tools-")); broker = new SidecarBroker({ dir }); calls.mockClear();
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  rmSync(dir, { recursive: true, force: true });
});
async function connect(scope: BrokerScope): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createBrokerMcpServer(broker, "codex-hub", undefined, scope, { tools, connections }).connect(serverSide);
  const client = new Client({ name: "disposable-codex-session", version: "0" });
  await client.connect(clientSide); clients.push(client); return client;
}

it("keeps every connection out of hub scope, even with injected run/ask/never tools and direct calls", async () => {
  const client = await connect("hub");
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([...BROKER_SCOPE_TOOLS.hub]);
  for (const tool of tools) {
    expect(await client.callTool({ name: tool.wireName, arguments: { value: "secret" } })).toMatchObject({ isError: true });
  }
  expect(calls).not.toHaveBeenCalled();
  expect(broker.cards("codex-hub")).toEqual([]);
});

it("preserves worktree run/ask/never policies and exact operator approval", async () => {
  const client = await connect("worktree");
  expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("fixture__never");
  await client.callTool({ name: "fixture__run", arguments: { value: "read" } });
  expect(calls).toHaveBeenCalledTimes(1);
  const pending = client.callTool({ name: "fixture__ask", arguments: { value: "approved input" } });
  await vi.waitFor(() => expect(broker.cards("codex-hub")).toHaveLength(1));
  const card = broker.cards("codex-hub")[0];
  expect(card.input.arguments).toEqual({ value: "approved input" });
  expect(calls).toHaveBeenCalledTimes(1);
  broker.decide("codex-hub", card.id, { approve: true });
  await pending;
  expect(calls).toHaveBeenCalledTimes(2);
  expect(calls.mock.calls[1]).toEqual(expect.arrayContaining(["fixture", "ask", { value: "approved input" }]));
  expect(await client.callTool({ name: "fixture__never", arguments: {} })).toMatchObject({ isError: true });
  expect(calls).toHaveBeenCalledTimes(2);
});

it("withdraws an external approval on Stop without carrying it out", async () => {
  const client = await connect("worktree");
  const pending = client.callTool({ name: "fixture__ask", arguments: { value: "cancel" } });
  await vi.waitFor(() => expect(broker.cards("codex-hub")).toHaveLength(1));
  broker.withdraw("codex-hub", "The operator stopped the turn");
  expect(await pending).toMatchObject({ isError: true });
  expect(calls).not.toHaveBeenCalled();
});

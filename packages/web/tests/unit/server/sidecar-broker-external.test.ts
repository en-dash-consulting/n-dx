/**
 * External calls through the ndx-sidecar broker: an external-call card can
 * never be allow-listed, and only a worktree session is offered a
 * connection's tools — a hub session gets none in C1.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConnectionTool } from "../../../src/server/connections/connection-service.js";
import { createBrokerMcpServer, type BrokerConnections } from "../../../src/server/sidecar/broker-mcp.js";
import {
  allowListKey,
  BROKER_SCOPE_TOOLS,
  BROKER_TOOL_POLICY,
  EXTERNAL_CALL_TOOL,
  type BrokerScope,
} from "../../../src/server/sidecar/broker-policy.js";
import { BrokerDecisionError, SidecarBroker, type SidecarCard } from "../../../src/server/sidecar/broker.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

let dir: string;
let raised: SidecarCard[];
let broker: SidecarBroker;
const clients: Client[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sidecar-broker-external-"));
  raised = [];
  broker = new SidecarBroker({ dir, onCard: (card) => { if (card.status === "pending") raised.push(card); } });
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await removeTestDir(dir);
});

const INPUT = { connection: "docs", tool: "docs.update_item", class: "write", arguments: { id: "7" } };

function tool(name: string, policy: "run" | "ask" | "never"): ConnectionTool {
  return {
    connection: "docs",
    tool: name,
    displayName: `docs.${name}`,
    wireName: `docs__${name}`,
    description: `The ${name} tool.`,
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    annotations: undefined,
    policy: { class: policy === "run" ? "read" : "write", classSource: "default", policy, policySource: "default" },
  };
}

/** A gateway that answers every call; nothing here reaches a network. */
const connections: BrokerConnections = {
  hasConnections: () => true,
  listTools: async () => [tool("read_item", "run"), tool("update_item", "ask"), tool("delete_item", "never")],
  check: async () => ({ state: "connected" }),
  callContext: () => ({ label: "Docs", host: "docs.example.test", fieldHints: {} }),
  callTool: async (_connection, name) => ({ content: [{ type: "text", text: `called ${name}` }] }),
};

async function listedNames(scope: BrokerScope): Promise<string[]> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const external = { tools: await connections.listTools(), connections };
  await createBrokerMcpServer(broker, "s1", undefined, scope, external).connect(serverSide);
  const client = new Client({ name: "test-cli", version: "0" });
  await client.connect(clientSide);
  clients.push(client);
  return (await client.listTools()).tools.map((t) => t.name);
}

describe("external-call cards", () => {
  it("are never allow-listable", () => {
    expect(BROKER_TOOL_POLICY[EXTERNAL_CALL_TOOL]).toEqual({ card: "external-call", allowList: "never" });
    expect(allowListKey(EXTERNAL_CALL_TOOL, INPUT)).toBeNull();
    // Not even when the input looks like a command.
    expect(allowListKey(EXTERNAL_CALL_TOOL, { argv: ["ndx", "status"] })).toBeNull();
  });

  it("raise a card the operator cannot remember, and that leaves the card pending", async () => {
    void broker.request("s1", EXTERNAL_CALL_TOOL, INPUT);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({ tool: EXTERNAL_CALL_TOOL, kind: "external-call", allowListKey: null, input: INPUT });
    expect(() => broker.decide("s1", raised[0].id, { approve: true, remember: true })).toThrow(BrokerDecisionError);
    expect(broker.cards("s1")[0].status).toBe("pending");
    expect(() => broker.allow(EXTERNAL_CALL_TOOL, INPUT)).toThrow(BrokerDecisionError);
  });

  it("ignore an allow-list rule written into the file by hand", async () => {
    writeFileSync(join(dir, "allow-list.json"), JSON.stringify({
      schema: "ndx/sidecar-allow-list/v1",
      rules: [{ tool: EXTERNAL_CALL_TOOL, key: JSON.stringify(INPUT) }],
    }));
    expect(broker.allowList()).toEqual([]);
    void broker.request("s1", EXTERNAL_CALL_TOOL, INPUT);
    expect(raised).toHaveLength(1);
  });
});

describe("which sessions are offered external tools", () => {
  it("a worktree session: every tool whose policy is not never, after the broker's own", async () => {
    expect(await listedNames("worktree")).toEqual([...BROKER_SCOPE_TOOLS.worktree, "docs__read_item", "docs__update_item"]);
  });

  it("a hub session: none", async () => {
    expect(await listedNames("hub")).toEqual([...BROKER_SCOPE_TOOLS.hub]);
  });
});

/**
 * `propose_link` (story 44): the Sidecar proposes linking a PRD item to a
 * tracker work item. It raises a link card that is never allow-listable, writes
 * the ref only on Approve and from the card's own link, and raises no card for
 * a call the PRD cannot take. Through a real broker and MCP client; the PRD
 * write itself is `tracker-item-links.test.ts`.
 */

import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrokerMcpServer } from "../../../src/server/sidecar/broker-mcp.js";
import { allowListKey, BROKER_SCOPE_TOOLS, BROKER_TOOL_POLICY } from "../../../src/server/sidecar/broker-policy.js";
import { SidecarBroker, type SidecarCard } from "../../../src/server/sidecar/broker.js";
import type { SidecarActions } from "../../../src/server/sidecar/carry-out.js";
import type { SidecarLink } from "../../../src/shared/index.js";
import { removeTestDir } from "../../helpers/server-route-test-support.js";

const LINK: SidecarLink = { itemId: "t1", title: "Write the cache", ref: "WM-2054", label: "CAOS" };

let root: string;
let raised: SidecarCard[];
let broker: SidecarBroker;
let clients: Client[];
let written: SidecarLink[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-link-card-"));
  mkdirSync(join(root, "sidecar"), { recursive: true });
  raised = [];
  clients = [];
  written = [];
  broker = new SidecarBroker({ dir: join(root, "sidecar"), onCard: (card) => { if (card.status === "pending") raised.push(card); } });
});

afterEach(async () => {
  for (const client of clients) await client.close();
  await removeTestDir(root);
});

/** Actions whose link read answers `check`; every other effect is refused. */
function actions(check: (input: Record<string, unknown>) => SidecarLink | string): SidecarActions {
  const refused = { ok: false, text: "no" };
  return {
    previewWork: async () => "",
    runCommand: () => refused,
    startWork: async () => refused,
    reviewChangeSet: async () => "no",
    writeChangeSet: async () => refused,
    checkPlacement: async () => "no",
    writePlacement: async () => refused,
    checkLink: async (input) => check(input),
    writeLink: async (link) => { written.push(link); return { ok: true, text: `Linked ${link.itemId} to ${link.ref}.`, ids: [link.itemId] }; },
    checkItemEdit: async () => "no",
    writeItemEdit: async () => refused,
    checkStatus: async () => "no",
    writeStatus: async () => refused,
    readRunPlan: async () => "no",
    githubReadsAllowed: () => false,
    branchHealthEnabled: () => false,
    githubRead: async () => refused,
    postGithub: async () => refused,
  };
}

async function connect(withActions: SidecarActions | undefined): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createBrokerMcpServer(broker, "s1", withActions).connect(serverSide);
  const client = new Client({ name: "test-cli", version: "0" });
  await client.connect(clientSide);
  clients.push(client);
  return client;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): string => (result.content as Array<{ text: string }>)[0]!.text;

describe("propose_link policy", () => {
  it("raises a link card that can never be allow-listed", () => {
    expect(BROKER_TOOL_POLICY.propose_link).toEqual({ card: "link", allowList: "never" });
    expect(allowListKey("propose_link", { itemId: "t1", ref: "WM-2054" })).toBeNull();
  });

  it("is offered to a worktree session and not to the hub's", () => {
    expect(BROKER_SCOPE_TOOLS.worktree).toContain("propose_link");
    expect(BROKER_SCOPE_TOOLS.hub).not.toContain("propose_link");
  });
});

describe("propose_link", () => {
  it("raises a card carrying the link as read and writes nothing before Approve", async () => {
    const client = await connect(actions(() => LINK));
    const call = client.callTool({ name: "propose_link", arguments: { itemId: "t1", ref: " WM-2054 " } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]).toMatchObject({ kind: "link", tool: "propose_link", allowListKey: null, link: LINK });
    expect(written).toEqual([]);

    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Linked t1 to WM-2054.");
    // What is written is the card's link, never the agent's raw input.
    expect(written).toEqual([LINK]);
  });

  it("writes nothing when the operator denies the card", async () => {
    const client = await connect(actions(() => LINK));
    const call = client.callTool({ name: "propose_link", arguments: { itemId: "t1", ref: "WM-2054" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    broker.decide("s1", raised[0]!.id, { approve: false, reason: "wrong ticket" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("wrong ticket");
    expect(written).toEqual([]);
  });

  it("does not let an always-allow decision remember the call", async () => {
    const client = await connect(actions(() => LINK));
    const first = client.callTool({ name: "propose_link", arguments: { itemId: "t1", ref: "WM-2054" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(() => broker.decide("s1", raised[0]!.id, { approve: true, remember: true })).toThrow(/allow-list/i);
    broker.decide("s1", raised[0]!.id, { approve: true });
    await first;

    const second = client.callTool({ name: "propose_link", arguments: { itemId: "t1", ref: "WM-2054" } });
    await vi.waitFor(() => expect(raised).toHaveLength(2));
    broker.decide("s1", raised[1]!.id, { approve: false });
    await second;
  });

  it("raises no card for a call the PRD cannot take", async () => {
    const client = await connect(actions(() => "no item t9"));
    const result = await client.callTool({ name: "propose_link", arguments: { itemId: "t9", ref: "WM-2054" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No card was raised: no item t9");
    expect(raised).toEqual([]);
    expect(written).toEqual([]);
  });

  it("raises no card when the server cannot read the PRD", async () => {
    const result = await (await connect(undefined)).callTool({ name: "propose_link", arguments: { itemId: "t1", ref: "WM-2054" } });
    expect(result.isError).toBe(true);
    expect(raised).toEqual([]);
  });
});

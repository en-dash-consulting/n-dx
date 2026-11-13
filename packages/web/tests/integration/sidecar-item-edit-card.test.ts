/**
 * `propose_item_edit`: the Sidecar proposes editing an existing item's title,
 * description, done-when, tags or priority. It raises an item-edit card that is
 * never allow-listable, carrying each changed field before and after; only
 * Approve writes, through rex's edit_item, with the operator's edits; Deny
 * writes nothing. Through a real broker and MCP client on a temp v2 PRD.
 */

import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { resolveStore } from "@n-dx/rex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrokerMcpServer } from "../../src/server/sidecar/broker-mcp.js";
import { allowListKey, BROKER_SCOPE_TOOLS, BROKER_TOOL_POLICY } from "../../src/server/sidecar/broker-policy.js";
import { SidecarBroker, type SidecarCard } from "../../src/server/sidecar/broker.js";
import type { SidecarActions } from "../../src/server/sidecar/carry-out.js";
import { applyItemEditEdits, readItemEditCall, writeItemEditCard } from "../../src/server/sidecar/item-edit-card.js";
import type { PRDItem } from "../../src/server/rex-gateway.js";
import { removeTestDir } from "../helpers/server-route-test-support.js";

const V2_FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");
const TASK = "c0000000-0000-4000-8000-000000000002";

let root: string;
let rexDir: string;
let raised: SidecarCard[];
let broker: SidecarBroker;
let clients: Client[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-item-edit-"));
  rexDir = join(root, ".rex");
  cpSync(V2_FIXTURE, rexDir, { recursive: true });
  mkdirSync(join(root, "sidecar"), { recursive: true });
  raised = [];
  clients = [];
  broker = new SidecarBroker({ dir: join(root, "sidecar"), onCard: (card) => { if (card.status === "pending") raised.push(card); } });
});

afterEach(async () => {
  for (const client of clients) await client.close();
  await removeTestDir(root);
});

/** Actions whose item-edit read and write are the server's own, on the temp PRD; every other effect is refused. */
function actions(): SidecarActions {
  const refused = { ok: false, text: "no" };
  return {
    previewWork: async () => "",
    runCommand: () => refused,
    startWork: async () => refused,
    reviewChangeSet: async () => "no",
    writeChangeSet: async () => refused,
    checkPlacement: async () => "no",
    writePlacement: async () => refused,
    checkLink: async () => "no",
    writeLink: async () => refused,
    checkItemEdit: (input) => readItemEditCall(rexDir, input),
    writeItemEdit: (itemEdit) => writeItemEditCard({ rexDir, projectDir: root }, itemEdit),
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

async function readTask(): Promise<PRDItem> {
  const doc = await (await resolveStore(rexDir)).loadDocument();
  const stack = [...doc.items];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.id === TASK) return item;
    stack.push(...(item.children ?? []));
  }
  throw new Error("the task is not in the tree");
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>): string => (result.content as Array<{ text: string }>)[0]!.text;

const PROPOSED = {
  id: TASK,
  description: "Show Apple Pay at checkout.",
  acceptanceCriteria: ["The button appears on Safari only", "Tapping it opens the Apple Pay sheet"],
  tags: ["payments", "ui"],
  priority: "high",
};

describe("propose_item_edit policy", () => {
  it("raises an item-edit card that can never be allow-listed", () => {
    expect(BROKER_TOOL_POLICY.propose_item_edit).toEqual({ card: "item-edit", allowList: "never" });
    expect(allowListKey("propose_item_edit", PROPOSED)).toBeNull();
  });

  it("is offered to a worktree session and not to the hub's", () => {
    expect(BROKER_SCOPE_TOOLS.worktree).toContain("propose_item_edit");
    expect(BROKER_SCOPE_TOOLS.hub).not.toContain("propose_item_edit");
  });
});

describe("propose_item_edit", () => {
  it("shows each changed field before and after, and writes nothing before Approve", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_item_edit", arguments: PROPOSED });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]).toMatchObject({
      kind: "item-edit",
      tool: "propose_item_edit",
      allowListKey: null,
      itemEdit: {
        itemId: TASK,
        itemTitle: "Wire the button",
        before: { description: "", acceptanceCriteria: ["The button appears on Safari only"], tags: [], priority: undefined },
        after: { description: PROPOSED.description, acceptanceCriteria: PROPOSED.acceptanceCriteria, tags: ["payments", "ui"], priority: "high" },
      },
    });
    expect((await readTask()).tags).toBeUndefined();

    broker.decide("s1", raised[0]!.id, { approve: false });
    await call;
  });

  it("writes the edited fields on Approve, tags and done-when included, with the operator's edits", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_item_edit", arguments: PROPOSED });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    broker.decide("s1", raised[0]!.id, {
      approve: true,
      edits: { tags: ["payments", "checkout"], acceptanceCriteria: ["The button appears on Safari only", "Tapping it opens the sheet within 1 s"] },
    });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain(`Edited ${TASK} (Wire the button)`);
    expect(textOf(result)).toContain("the edited values were written");

    const task = await readTask();
    expect(task.tags).toEqual(["payments", "checkout"]);
    expect(task.acceptanceCriteria).toEqual(["The button appears on Safari only", "Tapping it opens the sheet within 1 s"]);
    expect(task.description).toBe("Show Apple Pay at checkout.");
    expect(task.priority).toBe("high");
    expect(broker.cards("s1")[0]).toMatchObject({ edited: true, carriedOut: { ok: true, ids: [TASK] } });
  });

  it("writes nothing when the operator denies the card", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_item_edit", arguments: PROPOSED });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    broker.decide("s1", raised[0]!.id, { approve: false, reason: "keep it" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("keep it");

    const task = await readTask();
    expect(task.acceptanceCriteria).toEqual(["The button appears on Safari only"]);
    expect(task.tags).toBeUndefined();
    expect(task.description).toBeUndefined();
    expect(task.priority).toBeUndefined();
  });

  it("refuses to remember the call, and edits on a denial", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_item_edit", arguments: PROPOSED });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(() => broker.decide("s1", raised[0]!.id, { approve: true, remember: true })).toThrow(/allow-list/i);
    expect(() => broker.decide("s1", raised[0]!.id, { approve: false, edits: { tags: ["x"] } })).toThrow(/Only an approval/);
    // A field the card does not change is not the operator's to add.
    expect(() => broker.decide("s1", raised[0]!.id, { approve: true, edits: { title: "Other" } })).toThrow(/not a field this card edits/);
    broker.decide("s1", raised[0]!.id, { approve: false });
    await call;
  });

  it("writes nothing when a field moved since the card was raised", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_item_edit", arguments: { id: TASK, tags: ["ui"] } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    await (await resolveStore(rexDir)).updateItem(TASK, { tags: ["someone-else"] });
    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("tags of");
    expect((await readTask()).tags).toEqual(["someone-else"]);
  });

  it("raises no card for an unknown item, a call that changes nothing, or no PRD", async () => {
    const client = await connect(actions());
    const unknown = await client.callTool({ name: "propose_item_edit", arguments: { id: "nope", tags: ["x"] } });
    expect(textOf(unknown)).toContain("No card was raised: no item nope");
    const same = await client.callTool({ name: "propose_item_edit", arguments: { id: TASK, acceptanceCriteria: ["The button appears on Safari only"] } });
    expect(textOf(same)).toContain("already has these values");
    const empty = await client.callTool({ name: "propose_item_edit", arguments: { id: TASK } });
    expect(textOf(empty)).toContain("at least one of");
    const none = await (await connect(undefined)).callTool({ name: "propose_item_edit", arguments: PROPOSED });
    expect(none.isError).toBe(true);
    expect(raised).toEqual([]);
  });
});

describe("applyItemEditEdits", () => {
  const card = { itemId: TASK, itemTitle: "t", before: { tags: [] }, after: { tags: ["a"] } };

  it("replaces the card's own fields, trimming and dropping blank entries", () => {
    expect(applyItemEditEdits(card, { tags: [" b ", "", "b"] })).toEqual({ ...card, after: { tags: ["b"] } });
  });

  it("refuses a non-object, a bad value or a field the card does not change", () => {
    expect(applyItemEditEdits(card, [])).toMatch(/object/);
    expect(applyItemEditEdits(card, { tags: "a" })).toMatch(/list of strings/);
    expect(applyItemEditEdits(card, { priority: "high" })).toMatch(/not a field/);
  });
});

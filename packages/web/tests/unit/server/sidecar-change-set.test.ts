/**
 * The change-set card (story 11): a `propose_prd_change` call is read
 * against the PRD before its card is raised, and approval writes the card's
 * items, with the operator's edits, through the dashboard's add and placement
 * rules under the PRD lock.
 *
 * The real route, broker and production actions: an MCP client stands in for
 * the session's vendor CLI, and the registry is the only fake (it reports the
 * session's turn running). One v1 project and one v2 project, each on disk.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { findItem, indexTree, loadPrdModel, resolveStore, type PRDItem } from "@n-dx/rex";
import { createAnnouncingBroker, handleSidecarRoute, sidecarActions } from "../../../src/server/routes-sidecar.js";
import type { SidecarBroker, SidecarCard } from "../../../src/server/sidecar/broker.js";
import { INBOX_NOTE, reviewChangeSet } from "../../../src/server/sidecar/change-set.js";
import type { SidecarSessionRegistry } from "../../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

/** Each duplicate scan, in order, with the real matcher behind it. */
const order = vi.hoisted<string[]>(() => []);
vi.mock("../../../src/server/rex-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/rex-gateway.js")>();
  return {
    ...actual,
    findDuplicateItem: ((...args: Parameters<typeof actual.findDuplicateItem>) => {
      order.push("scan");
      return actual.findDuplicateItem(...args);
    }) as typeof actual.findDuplicateItem,
  };
});

const SESSION = "s1";
const V2_FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const CAPABILITY_ID = "a0000000-0000-4000-8000-000000000002";
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";

let root: string;
let ctx: ServerContext;
let server: RouteTestServer;
let broker: SidecarBroker;
/** Every broadcast, in order: `sidecar:card` and `rex:prd-changed` among them. */
let messages: Array<{ type: string }>;

function broadcast(message: unknown): void {
  messages.push(message as { type: string });
}

const runningRegistry = (): SidecarSessionRegistry => ({
  get: (id: string) => (id === SESSION ? { id, worktree: root } : undefined),
  isRunning: () => true,
}) as unknown as SidecarSessionRegistry;

async function serve(): Promise<void> {
  server = await startRouteTestServer(async (req, res) =>
    handleSidecarRoute(req, res, ctx, broadcast, {
      registryFor: runningRegistry,
      brokerFor: () => broker,
      actionsFor: (c) => sidecarActions(c, broadcast),
    }));
}

async function brokerClient(): Promise<Client> {
  const client = new Client({ name: "test-cli", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/api/sidecar/sessions/${SESSION}/mcp`)));
  return client;
}

type CallResult = Awaited<ReturnType<Client["callTool"]>>;
const resultText = (result: CallResult): string => (result.content as Array<{ text: string }>)[0].text;

/** Propose, and resolve once the card is up (or the call has answered without one). */
async function propose(client: Client, args: Record<string, unknown>): Promise<{ call: Promise<CallResult>; card: SidecarCard }> {
  const call = client.callTool({ name: "propose_prd_change", arguments: args });
  const card = await vi.waitFor(() => {
    const pending = broker.cards(SESSION).find((c) => c.status === "pending");
    if (!pending) throw new Error("no card yet");
    return pending;
  });
  return { call, card };
}

async function decide(cardId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${server.baseUrl}/api/sidecar/sessions/${SESSION}/cards/${cardId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function proposals(): Promise<SidecarCard[]> {
  return ((await (await fetch(`${server.baseUrl}/api/sidecar/proposals`)).json()) as { cards: SidecarCard[] }).cards;
}

/** The ids a tool result lists, in order. */
function idsIn(text: string): string[] {
  return [...text.matchAll(/^- \w+ ([\w-]+): /gm)].map((m) => m[1]);
}

async function v1Items(): Promise<PRDItem[]> {
  return (await (await resolveStore(ctx.rexDir)).loadDocument()).items;
}

function setUp(): void {
  root = mkdtempSync(join(tmpdir(), "sidecar-change-set-"));
  mkdirSync(join(root, ".hench", "sidecar"), { recursive: true });
  mkdirSync(join(root, ".sourcevision"), { recursive: true });
  ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  broker = createAnnouncingBroker(join(root, ".hench", "sidecar"), broadcast);
  messages = [];
}

afterEach(async () => {
  await server?.close();
  await removeTestDir(root);
});

describe("on a v1 PRD", () => {
  beforeEach(async () => {
    setUp();
    mkdirSync(ctx.rexDir, { recursive: true });
    writeFileSync(join(ctx.rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }));
    await (await resolveStore(ctx.rexDir)).saveDocument({
      schema: "rex/v1",
      title: "Change set",
      items: [{
        id: "epic-1",
        title: "Checkout hardening",
        level: "epic",
        status: "pending",
        children: [{ id: "feature-1", title: "Card payments", level: "feature", status: "pending" }],
      }],
    } as never);
    await serve();
  });

  it("raises a card, writes nothing until approval, then adds each item as add_item does and lists the ids", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, {
      items: [
        { title: "Refund flow", description: "Shoppers can ask for a refund." },
        { title: "Refund form", parent: 0 },
        { title: "Validate the amount", parent: 1, acceptanceCriteria: ["An amount above the charge is refused"] },
        { title: "Retry declined cards", parentId: "feature-1", priority: "high" },
      ],
    });
    expect(card.kind).toBe("change-set");
    expect(card.changeSet?.items.map((i) => i.type)).toEqual(["epic", "feature", "task", "task"]);
    expect(await v1Items()).toHaveLength(1);
    expect(walkTitles(await v1Items())).not.toContain("Refund flow");

    expect((await decide(card.id, { decision: "approve" })).status).toBe(200);
    const result = await call;
    expect(result.isError).toBeFalsy();
    const ids = idsIn(resultText(result));
    expect(ids).toHaveLength(4);

    const items = await v1Items();
    const epic = findItem(items, ids[0])!;
    expect(epic.item).toMatchObject({ title: "Refund flow", level: "epic", status: "pending", description: "Shoppers can ask for a refund." });
    expect(epic.parents).toEqual([]);
    expect(findItem(items, ids[1])!.parents.map((p) => p.id)).toEqual([ids[0]]);
    expect(findItem(items, ids[2])!.item).toMatchObject({ level: "task", acceptanceCriteria: ["An amount above the charge is refused"] });
    expect(findItem(items, ids[2])!.parents.map((p) => p.id)).toEqual([ids[0], ids[1]]);
    expect(findItem(items, ids[3])!.item).toMatchObject({ level: "task", priority: "high" });
    expect(findItem(items, ids[3])!.parents.map((p) => p.id)).toEqual(["epic-1", "feature-1"]);

    const log = readFileSync(join(ctx.rexDir, "execution-log.jsonl"), "utf-8");
    expect(log.match(/"event":"item_added"/g)).toHaveLength(4);
    expect(messages.some((m) => m.type === "rex:prd-changed")).toBe(true);
    await client.close();
  });

  it("writes the operator's edits to title, description and done-when", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, {
      items: [{ title: "Refnud flow", description: "typo", acceptanceCriteria: ["old"] }],
    });
    const edits = [{ index: 0, title: "Refund flow", description: "Shoppers can ask for a refund.", acceptanceCriteria: ["A refund is issued once", " "] }];
    const answer = await decide(card.id, { decision: "approve", edits });
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { card: SidecarCard }).card.edited).toBe(true);

    const result = await call;
    expect(resultText(result)).toContain("edited values were written");
    const [id] = idsIn(resultText(result));
    expect(findItem(await v1Items(), id)!.item).toMatchObject({
      title: "Refund flow",
      description: "Shoppers can ask for a refund.",
      acceptanceCriteria: ["A refund is issued once"],
    });
    await client.close();
  });

  it("refuses an edit it cannot write, leaving the card waiting", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, { items: [{ title: "Refund flow" }] });
    expect((await decide(card.id, { decision: "approve", edits: [{ index: 3, title: "x" }] })).status).toBe(400);
    expect((await decide(card.id, { decision: "approve", edits: [{ index: 0, title: " " }] })).status).toBe(400);
    expect((await decide(card.id, { decision: "deny", edits: [{ index: 0, title: "y" }] })).status).toBe(409);
    expect(broker.cards(SESSION)[0].status).toBe("pending");
    await decide(card.id, { decision: "deny" });
    await call;
    await client.close();
  });

  it("flags each proposed item that matches an existing item of its type, with the match", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, {
      items: [{ title: "Checkout hardening" }, { title: "Something unrelated entirely" , parent: 0 }],
    });
    expect(card.changeSet?.items[0].duplicate).toEqual({ id: "epic-1", title: "Checkout hardening", type: "epic", status: "pending" });
    expect(card.changeSet?.items[1].duplicate).toBeUndefined();
    await decide(card.id, { decision: "deny" });
    await call;
    await client.close();
  });

  it("yields to the event loop while it scans, so other work runs before the review finishes", async () => {
    // The scan's own calls are recorded; a callback chain on the event loop
    // stands in for any other request. Scans with no "other work" between
    // them ran back to back, blocking the loop.
    order.length = 0;
    const tick = (): void => {
      order.push("other work");
      timer = setImmediate(tick);
    };
    let timer = setImmediate(tick);
    let result: Awaited<ReturnType<typeof reviewChangeSet>>;
    try {
      result = await reviewChangeSet(ctx.rexDir, {
        items: [{ title: "Checkout hardening" }, { title: "Something unrelated entirely", parent: 0 }],
      });
    } finally {
      clearImmediate(timer);
    }
    const scans = order.flatMap((entry, i) => (entry === "scan" ? [i] : []));
    expect(scans).toHaveLength(2);
    expect(order.slice(scans[0], scans[1])).toContain("other work");
    expect(typeof result).not.toBe("string");
  });

  it("raises no card for a proposal it cannot write, and says why", async () => {
    const client = await brokerClient();
    for (const [args, why] of [
      [{ items: [{ title: "x", parentId: "nope" }] }, `parent "nope" not found`],
      [{ items: [{ title: "x", type: "subtask" }] }, "a subtask goes under"],
      [{ items: [{ title: "x" }], target: CAPABILITY_ID }, "no capability or constraint to target"],
      [{ items: [{ title: "x", type: "capability" }] }, "item 1"],
    ] as const) {
      const result = await client.callTool({ name: "propose_prd_change", arguments: args });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain("No card was raised");
      expect(resultText(result)).toContain(why);
    }
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });

  it("writes nothing when the card is denied or withdrawn", async () => {
    const client = await brokerClient();
    const before = JSON.stringify(await v1Items());

    const denied = await propose(client, { items: [{ title: "Refund flow" }] });
    await decide(denied.card.id, { decision: "deny", reason: "not now" });
    expect(resultText(await denied.call)).toContain("denied");

    const withdrawn = await propose(client, { items: [{ title: "Refund flow" }] });
    broker.withdraw(SESSION, "The operator stopped the turn");
    expect(resultText(await withdrawn.call)).toContain("withdrawn");

    expect(JSON.stringify(await v1Items())).toBe(before);
    expect(existsSync(join(ctx.rexDir, "execution-log.jsonl"))).toBe(false);
    await client.close();
  });

  it("writes none of the card's items when one can no longer be written, and says so", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, {
      items: [{ title: "Refund flow" }, { title: "Retry declined cards", parentId: "feature-1" }],
    });
    await (await resolveStore(ctx.rexDir)).removeItem("feature-1");
    const before = JSON.stringify(await v1Items());
    await decide(card.id, { decision: "approve", edits: [{ index: 0, title: "Refunds" }] });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toContain(`Nothing was written: parent "feature-1"`);
    // An edited approval that wrote nothing must not tell the agent its edits were written.
    expect(resultText(result)).not.toContain("edited values were written");
    expect(JSON.stringify(await v1Items())).toBe(before);
    expect(broker.cards(SESSION)[0].carriedOut).toEqual({ ok: false });
    expect(await proposals()).toEqual([]);
    await client.close();
  });

  it("serves the card as a proposal while it waits, and drops it once denied", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, { items: [{ title: "Refund flow" }] });
    expect((await proposals()).map((c) => c.id)).toEqual([card.id]);
    await decide(card.id, { decision: "deny" });
    await call;
    expect(await proposals()).toEqual([]);
    await client.close();
  });

  it("keeps an approved card a proposal until its items are written, then records the ids written", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, { items: [{ title: "Refund flow" }] });
    await decide(card.id, { decision: "approve" });
    const result = await call;
    const [id] = idsIn(resultText(result));
    expect(await proposals()).toEqual([]);
    expect(broker.cards(SESSION)[0].carriedOut).toEqual({ ok: true, ids: [id] });
    // The write's PRD broadcast comes before the card's last announcement, so a
    // viewer that refetches on both never sees the ghost gone and the item missing.
    const prd = messages.findIndex((m) => m.type === "rex:prd-changed");
    const lastCard = messages.map((m) => m.type).lastIndexOf("sidecar:card");
    expect(prd).toBeGreaterThan(-1);
    expect(prd).toBeLessThan(lastCard);
    await client.close();
  });
});

describe("on a v2 PRD", () => {
  beforeEach(async () => {
    setUp();
    cpSync(V2_FIXTURE, ctx.rexDir, { recursive: true });
    await serve();
  });

  async function change(id: string) {
    const { tree } = await loadPrdModel(ctx.rexDir);
    return indexTree(tree).resolve(id);
  }

  it("writes one change with its tasks, placed on the card's target", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, {
      items: [
        { title: "Offer Google Pay", description: "Android shoppers want a wallet." },
        { title: "Wire the Google Pay button", acceptanceCriteria: ["The button appears on Chrome"] },
        { title: "Charge through the wallet", type: "task" },
      ],
      target: "A1.1",
    });
    expect(card.changeSet?.placement).toEqual({ target: CAPABILITY_ID, title: "Pay by card" });
    expect(card.changeSet?.items.map((i) => [i.type, i.parent])).toEqual([["change", undefined], ["task", 0], ["task", 0]]);

    await decide(card.id, { decision: "approve" });
    const result = await call;
    expect(result.isError, resultText(result)).toBeFalsy();
    const ids = idsIn(resultText(result));
    expect(ids).toHaveLength(3);
    expect(resultText(result)).toContain(`It touches Pay by card (${CAPABILITY_ID})`);

    const node = await change(ids[0]);
    expect(node).toMatchObject({ type: "change", title: "Offer Google Pay", intent: "Android shoppers want a wallet.", touches: [CAPABILITY_ID] });
    expect((node as { needsPlacement?: boolean }).needsPlacement).toBeUndefined();
    // Read back in slug order, not the card's.
    expect(node?.children?.map((c) => c.id).sort()).toEqual(ids.slice(1).sort());
    expect(node?.children?.find((c) => c.id === ids[1])).toMatchObject({ type: "task", acceptanceCriteria: ["The button appears on Chrome"] });
    const log = readFileSync(join(ctx.rexDir, "execution-log.jsonl"), "utf-8");
    expect(log).toContain(`"event":"change_placed","itemId":"${ids[0]}"`);
    await client.close();
  });

  it("says before approval that an untargeted change lands in the Inbox, then leaves it there needing placement", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, { items: [{ title: "Offer Google Pay" }, { title: "Wire it" }] });
    expect(card.changeSet?.placement).toEqual({ inbox: true });

    await decide(card.id, { decision: "approve" });
    const result = await call;
    expect(resultText(result)).toContain(INBOX_NOTE);
    const node = await change(idsIn(resultText(result))[0]);
    expect((node as { needsPlacement?: boolean }).needsPlacement).toBe(true);
    expect(node?.touches).toBeUndefined();
    await client.close();
  });

  it("flags a proposed change that matches an existing change", async () => {
    const client = await brokerClient();
    const { call, card } = await propose(client, { items: [{ title: "Add Apple Pay" }, { title: "Wire the button" }] });
    expect(card.changeSet?.items[0].duplicate).toMatchObject({ id: CHANGE_ID, title: "Add Apple Pay", type: "change" });
    expect(card.changeSet?.items[1].duplicate).toMatchObject({ title: "Wire the button", type: "task" });
    await decide(card.id, { decision: "deny" });
    await call;
    await client.close();
  });

  it("refuses a proposal that is not one change with its tasks, or targets nothing placeable", async () => {
    const client = await brokerClient();
    for (const [args, why] of [
      [{ items: [{ title: "x", type: "task" }] }, "item 1 is the change"],
      [{ items: [{ title: "x" }, { title: "y", type: "subtask" }] }, "every item after the change is one of its tasks"],
      [{ items: [{ title: "x" }, { title: "y", parentId: CHANGE_ID }] }, "a task goes under the card's change"],
      [{ items: [{ title: "x" }], target: CHANGE_ID }, "is not a live capability or constraint"],
    ] as const) {
      const result = await client.callTool({ name: "propose_prd_change", arguments: args });
      expect(result.isError).toBe(true);
      expect(resultText(result)).toContain(why);
    }
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });

  it("never applies the change, and offers no apply_change tool", async () => {
    const client = await brokerClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain("apply_change");
    const { call, card } = await propose(client, { items: [{ title: "Offer Google Pay" }], target: CAPABILITY_ID });
    await decide(card.id, { decision: "approve" });
    const node = await change(idsIn(resultText(await call))[0]);
    expect((node as { appliedAt?: string }).appliedAt).toBeUndefined();
    expect(node?.amends).toBeUndefined();
    await client.close();
  });
});

function walkTitles(items: PRDItem[]): string[] {
  return items.flatMap((item) => [item.title, ...walkTitles(item.children ?? [])]);
}

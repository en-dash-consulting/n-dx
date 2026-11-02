/**
 * The Sidecar Place lens (story 29, server half): its packet over rex's
 * shortlist, its availability, and the placement card raised, dry-run and
 * carried out through rex's own place and propose rules.
 *
 * The card tests run the real route, broker and production actions over a
 * copy of rex's v2 fixture; an MCP client stands in for the vendor CLI.
 */

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { addChangeNode, indexTree, loadPrdModel, nodeSpec, specHash, withPrdModelTransaction, type RuleNode, type V2Tree } from "@n-dx/rex";
import { createAnnouncingBroker, handleSidecarRoute, sidecarActions, type SidecarCardMessage } from "../../../src/server/routes-sidecar.js";
import { buildChangePlacement } from "../../../src/server/routes-rex/placement.js";
import { BROKER_TOOL_POLICY } from "../../../src/server/sidecar/broker-policy.js";
import type { SidecarBroker, SidecarCard } from "../../../src/server/sidecar/broker.js";
import { CARRIED_OUT_LATER } from "../../../src/server/sidecar/carry-out.js";
import { PLACE_INSTRUCTIONS } from "../../../src/server/sidecar/lens-instructions.js";
import { buildLensPacket, LENS_PACKETS } from "../../../src/server/sidecar/lens-packets.js";
import { PLACE_CAP } from "../../../src/server/sidecar/place-packet.js";
import type { PacketSources } from "../../../src/server/sidecar/packet-sources.js";
import type { SidecarSessionRegistry } from "../../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../../src/server/types.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

const NOW = "2026-11-02T12:00:00.000Z";

// ── Packet ───────────────────────────────────────────────────────────

const node = (fields: Record<string, unknown>): RuleNode => ({ slug: fields.id as string, ...fields }) as RuleNode;

/** Ten words the strong candidate shares with the change, so the rules band it strong. */
const SHARED = "ledger export csv totals month currency taxes codes accountants quarterly";

function productTree(change: Record<string, unknown>, capabilities: RuleNode[], others: RuleNode[] = []): V2Tree {
  return {
    product: [node({ id: "fin", type: "area", title: "Finance", children: capabilities })],
    changes: [node({ id: "ch", type: "change", displayId: "CH-9", title: "Untitled", needsPlacement: true, ...change }), ...others],
  };
}

/** Sources whose only read is the PRD; any other read fails the test. */
function prdSources(layout: "v1" | "v2", tree: V2Tree): PacketSources & { prd: ReturnType<typeof vi.fn> } {
  const refuse = (): never => { throw new Error("the Place lens reads only the PRD"); };
  return {
    sourcePaths: { zones: ".sourcevision/zones.json", runs: ".hench/runs/" },
    prd: vi.fn(async () => ({ layout, tree })),
    evidence: refuse, zones: refuse, zone: refuse, resolve: refuse, preview: refuse, runs: refuse,
    taskRun: refuse, diagnose: refuse, queuePlan: refuse, branchHealth: refuse,
    featureEnabled: () => true,
  };
}

async function placePacket(tree: V2Tree, ref = "ch") {
  const result = await buildLensPacket("place", { ref }, prdSources("v2", tree), NOW);
  if (result.status !== "ready") throw new Error(`expected a packet, got ${result.status}`);
  return result.packet;
}

describe("Place lens packet", () => {
  const ledger = node({
    id: "cap-ledger",
    type: "capability",
    title: "Ledger export",
    statement: `Accountants export the ledger as csv: ${SHARED}.`,
    criteria: [{ id: "c1", text: "Totals match the ledger" }, { id: "c2", text: "Currency is named per row" }],
  });

  it("is a 6k packet over the same builder GET placement uses, with a strong pick, its statement and criteria", async () => {
    const tree = productTree({ title: `Quarterly ${SHARED}`, intent: "Accountants need the quarter's csv.", tags: ["finance"] }, [
      ledger,
      node({ id: "cap-pay", type: "capability", title: "Card payment", statement: "A shopper pays by card." }),
    ]);
    const packet = await placePacket(tree);
    const route = buildChangePlacement(tree, "ch");

    expect(LENS_PACKETS.place).toMatchObject({ kind: "packet", cap: PLACE_CAP, target: { kind: "change", needs: "a change awaiting placement" } });
    expect(packet).toMatchObject({ lens: "place", cap: 6_000, cut: [] });
    expect(packet.chars).toBeLessThanOrEqual(6_000);
    expect(packet.text).toContain(PLACE_INSTRUCTIONS);
    expect(route.shortlist[0]).toMatchObject({ target: "cap-ledger", strength: "strong" });
    const top = route.shortlist[0];
    expect(packet.text).toContain(`1. Ledger export (cap-ledger, capability · area Finance): score ${top.score}, strong. Reasons: ${top.reasons.join("; ")}`);
    // Every shortlist row the route answers is in the packet, in its order.
    for (const [i, c] of route.shortlist.entries()) expect(packet.text).toContain(`${i + 1}. ${c.title} (${c.target}`);
    expect(packet.text).toContain("Change ch: Quarterly ledger export");
    expect(packet.text).toContain("Tags: finance");
    expect(packet.text).toContain("Status: pending");
    expect(packet.text).toContain("Accountants need the quarter's csv.");
    expect(packet.text).toContain("Default relation: touches");
    expect(packet.text).toContain("Set by: the title does not open with an amending verb, and the intent has no Relation line");
    expect(packet.text).toContain("  - c1: Totals match the ledger");
    expect(packet.text).toContain(`  Statement: Accountants export the ledger as csv: ${SHARED}.`);
    expect(packet.text).toContain("None: no other open change amends a candidate.");
    expect(packet.text).toContain("- fin: Finance");
    expect(packet.text).not.toMatch(/Tied:|No strong pick/);
    expect(packet.sections.map((s) => s.id)).toEqual(["change", "relation", "shortlist", "blockers", "intent", "candidates", "areas"]);
    for (const s of packet.sections) expect(s.provenance).toMatchObject({ source: expect.any(String), generatedAt: NOW });
    expect(packet.sections.find((s) => s.id === "shortlist")!.provenance.source).toContain("GET /api/rex/changes/:id/placement");
  });

  it("trims a long intent before any shortlist row, so the whole shortlist fits the cap", async () => {
    const intent = Array.from({ length: 120 }, (_, i) => `Paragraph ${i} of a long intent about the quarterly ledger export.`).join("\n");
    const packet = await placePacket(productTree({ title: `Quarterly ${SHARED}`, intent }, [ledger]));
    const route = buildChangePlacement(productTree({ title: `Quarterly ${SHARED}`, intent }, [ledger]), "ch");

    expect(intent.length).toBeGreaterThan(PLACE_CAP);
    expect(packet.chars).toBeLessThanOrEqual(PLACE_CAP);
    expect(packet.cut.map((c) => c.section)).not.toContain("shortlist");
    for (const [i, c] of route.shortlist.entries()) expect(packet.text).toContain(`${i + 1}. ${c.title} (${c.target}`);
    expect(packet.text).toContain("Paragraph 0 of a long intent");
    expect(packet.text).not.toContain("Paragraph 119 of a long intent");
    expect(packet.cut).toContainEqual(expect.objectContaining({ section: "intent", kind: "trimmed" }));
  });

  it("says a tied shortlist is tied, so the order is no pick", async () => {
    const twin = (id: string) => node({ id, type: "capability", title: "Ledger export", statement: "Export the ledger." });
    const packet = await placePacket(productTree({ title: "Ledger export speed" }, [twin("cap-a"), twin("cap-b")]));
    expect(packet.text).toContain("Tied: the top two share a score, so their order is the id tiebreak, not the rules.");
    expect(packet.text).toMatch(/1\. Ledger export \(cap-a, .*\n2\. Ledger export \(cap-b, /);
  });

  it("carries an amends default with the rule that set it, and names the open change already amending a candidate", async () => {
    const other = node({
      id: "other", type: "change", displayId: "CH-3", title: "Ledger copy",
      amends: [{ target: "cap-ledger", delta: "modified", summary: "s", proposed: "p" }],
    });
    const packet = await placePacket(productTree({ title: "Add currency to the ledger export" }, [ledger], [other]));
    expect(packet.text).toContain("Default relation: amends");
    expect(packet.text).toContain('Set by: the title opens with the amending verb "add"');
    expect(packet.text).toContain("- Ledger export (cap-ledger): amended by open change CH-3");
    expect(packet.text).toContain("No strong pick");
  });

  it("with nothing on the map that matches, tells the agent to propose under an area", async () => {
    const packet = await placePacket(productTree({ title: "Zebra stripes" }, [ledger]));
    expect(packet.text).toContain("No rule fired: nothing on the product map matches this change. Propose a new capability or constraint under an area");
  });

  it("marks an unknown change unavailable in rex's words rather than building about nothing", async () => {
    const packet = await placePacket(productTree({ title: "x" }, [ledger]), "no-such");
    expect(packet.text).toContain('Not available: No live change "no-such"');
    expect(packet.sections.map((s) => s.id)).toEqual(["change"]);
  });

  it("without a change attached is unavailable, naming it, and sends no packet", async () => {
    const sources = prdSources("v2", productTree({ title: "x" }, [ledger]));
    expect(await buildLensPacket("place", {}, sources, NOW)).toEqual({ status: "unavailable", lens: "place", needs: "a change awaiting placement" });
  });

  it("on a v1 tree is unavailable, naming a v2 PRD, and sends no packet", async () => {
    const sources = prdSources("v1", productTree({ title: "x" }, [ledger]));
    expect(await buildLensPacket("place", { ref: "ch" }, sources, NOW)).toEqual({ status: "unavailable", lens: "place", needs: "a v2 PRD" });
  });

  it("instructs one recommendation with reasons, an amendment's draft, a proposal when nothing fits, and no apply", () => {
    expect(PLACE_INSTRUCTIONS).toMatch(/Recommend exactly one target and one relation, and give your reasons/);
    expect(PLACE_INSTRUCTIONS).toMatch(/For `amends`, draft what the amendment carries.*`proposed`.*`criteria`/);
    expect(PLACE_INSTRUCTIONS).toMatch(/When nothing on the shortlist fits.*propose a new capability or constraint.*`under` being an area id/);
    expect(PLACE_INSTRUCTIONS).toMatch(/never call or suggest `apply_change`/);
    expect(PLACE_INSTRUCTIONS).not.toMatch(/(?<!never call or suggest )`apply_change`/);
  });
});

// ── Placement card ───────────────────────────────────────────────────

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const AREA_ID = "a0000000-0000-4000-8000-000000000001";
const CAPABILITY_ID = "a0000000-0000-4000-8000-000000000002";
const SESSION = "s1";

let root: string;
let rexDir: string;
let ctx: ServerContext;
let server: RouteTestServer;
let broker: SidecarBroker;
let inboxId: string;
let messages: Array<{ type: string }>;
let cardWaiters: Array<(m: SidecarCardMessage) => boolean>;

function broadcast(message: unknown): void {
  const m = message as SidecarCardMessage;
  messages.push(m);
  if (m.type === "sidecar:card") cardWaiters = cardWaiters.filter((w) => !w(m));
}

/** The next `sidecar:card` announcement with `status`. */
function cardAnnounced(status: string): Promise<SidecarCardMessage> {
  const sent = messages.find((m) => m.type === "sidecar:card" && (m as SidecarCardMessage).status === status);
  if (sent) return Promise.resolve(sent as SidecarCardMessage);
  return new Promise((done) => {
    cardWaiters.push((m) => (m.status === status ? (done(m), true) : false));
  });
}

const runningRegistry = (): SidecarSessionRegistry => ({
  get: (id: string) => (id === SESSION ? { id, worktree: root } : undefined),
  isRunning: () => true,
}) as unknown as SidecarSessionRegistry;

/** One hash over every file under the rex directory, the execution log included. */
function treeHash(): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(relative(rexDir, path)).update("\0").update(readFileSync(path)).update("\0");
    }
  };
  walk(rexDir);
  return hash.digest("hex");
}

const logEvents = (): Array<Record<string, unknown>> => {
  const path = join(rexDir, "execution-log.jsonl");
  return existsSync(path) ? readFileSync(path, "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

async function changeNode(id = inboxId) {
  const { tree } = await loadPrdModel(rexDir);
  return { tree, change: indexTree(tree).resolve(id)! as RuleNode & { amends?: Array<Record<string, unknown>>; touches?: string[] } };
}

async function brokerClient(): Promise<Client> {
  const client = new Client({ name: "test-cli", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/api/sidecar/sessions/${SESSION}/mcp`)));
  return client;
}

const decide = (cardId: string, body: Record<string, unknown>) =>
  fetch(`${server.baseUrl}/api/sidecar/sessions/${SESSION}/cards/${cardId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const resultText = (result: Awaited<ReturnType<Client["callTool"]>>): string => (result.content as Array<{ text: string }>)[0].text;

/** Raise a placement card and wait for it: the call in flight and the card as the broker holds it. */
async function raise(args: Record<string, unknown>) {
  const client = await brokerClient();
  const call = client.callTool({ name: "place_change_card", arguments: { change: inboxId, reasons: ["The change retries a declined card."], ...args } });
  const { cardId } = await cardAnnounced("pending");
  const card = broker.cards(SESSION).find((c) => c.id === cardId)! as SidecarCard;
  return { client, call, card };
}

describe("place_change_card", () => {
  beforeEach(async () => {
    messages = [];
    cardWaiters = [];
    root = mkdtempSync(join(tmpdir(), "sidecar-place-"));
    rexDir = join(root, ".rex");
    cpSync(FIXTURE, rexDir, { recursive: true });
    mkdirSync(join(root, ".hench", "sidecar"), { recursive: true });
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    ctx = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir, dev: false };
    const { result } = await withPrdModelTransaction(rexDir, ({ tree }) => {
      const added = addChangeNode(tree, { type: "change", title: "Pay by card retries a declined card" }, { now: new Date(NOW) });
      return { tree: added.tree, result: added.node.id };
    });
    inboxId = result;
    broker = createAnnouncingBroker(join(root, ".hench", "sidecar"), broadcast);
    server = await startRouteTestServer(async (req, res) =>
      handleSidecarRoute(req, res, ctx, broadcast, { registryFor: runningRegistry, brokerFor: () => broker, actionsFor: (c) => sidecarActions(c, broadcast) }));
  });

  afterEach(async () => {
    await server?.close();
    await removeTestDir(root);
  });

  it("stays never allow-listable and is carried out now, not later", async () => {
    expect(BROKER_TOOL_POLICY.place_change_card).toEqual({ card: "placement", allowList: "never" });
    expect(CARRIED_OUT_LATER).not.toHaveProperty("place_change_card");
    const { client, call, card } = await raise({ target: CAPABILITY_ID, relation: "touches" });
    expect(card.allowListKey).toBeNull();
    expect((await decide(card.id, { decision: "approve", remember: true })).status).toBe(409);
    await decide(card.id, { decision: "deny" });
    await call;
    await client.close();
  });

  it("touches: the card carries rex's dry run, nothing is written until approval, then rex writes and logs it", async () => {
    const before = treeHash();
    const { client, call, card } = await raise({ target: "A1.1", relation: "touches" });
    expect(card.placement).toEqual({
      change: inboxId,
      request: { action: "place", target: "A1.1", relation: "touches" },
      reasons: ["The change retries a declined card."],
      check: { ok: true, action: "place", target: CAPABILITY_ID, title: "Pay by card", relation: "touches", warnings: [] },
    });
    expect(treeHash()).toBe(before);

    await decide(card.id, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain(`Placed change ${inboxId}: it touches Pay by card (${CAPABILITY_ID}).`);
    const { change } = await changeNode();
    expect(change.touches).toEqual([CAPABILITY_ID]);
    expect(change.needsPlacement).toBeUndefined();
    expect(logEvents().at(-1)).toMatchObject({ event: "change_placed", itemId: inboxId, detail: `touches ${CAPABILITY_ID} (via Sidecar)` });
    expect(messages).toContainEqual(expect.objectContaining({ type: "rex:prd-changed" }));
    // The dashboard's PRD cache was refreshed from the written tree.
    expect(readFileSync(join(rexDir, ".cache", "prd.json"), "utf-8")).toContain(inboxId);
    await client.close();
  });

  it("amends with a criteria delta: the card pins the target's spec hash, and approval writes the amendment", async () => {
    const { tree } = await changeNode();
    const base = specHash(nodeSpec(indexTree(tree).resolve(CAPABILITY_ID)!));
    const criteria = { add: [{ id: "c3", text: "A declined card can be retried" }] };
    const { client, call, card } = await raise({ target: CAPABILITY_ID, relation: "amends", criteria });
    expect(card.placement?.check).toEqual({ ok: true, action: "place", target: CAPABILITY_ID, title: "Pay by card", relation: "amends", base, warnings: [] });

    await decide(card.id, { decision: "approve" });
    expect((await call).isError).toBeFalsy();
    const { change } = await changeNode();
    expect(change.amends).toEqual([expect.objectContaining({ target: CAPABILITY_ID, delta: "modified", criteria, base })]);
    await client.close();
  });

  it("amends: a spec edited while the card waits is not overwritten by the approval, which writes nothing", async () => {
    const criteria = { replace: [{ id: "c2", text: "A declined card shows the bank's reason" }] };
    const { client, call, card } = await raise({ target: CAPABILITY_ID, relation: "amends", criteria });
    expect(card.placement?.check).toMatchObject({ ok: true, base: expect.any(String) });
    // Someone rewords the capability's criteria while the operator reads the card.
    await withPrdModelTransaction(rexDir, ({ tree }) => {
      const capability = indexTree(tree).resolve(CAPABILITY_ID)! as RuleNode & { criteria: Array<{ id: string; text: string }> };
      capability.criteria = capability.criteria.map((c) => (c.id === "c2" ? { ...c, text: "A declined card names the decline code" } : c));
      return { tree, result: undefined };
    });
    const before = treeHash();

    await decide(card.id, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/^The operator approved card .*Nothing was written: the spec of "Pay by card" changed since the card was raised/);
    expect(treeHash()).toBe(before);
    const { change } = await changeNode();
    expect(change.amends ?? []).toEqual([]);
    await client.close();
  });

  it("propose: records the new node only as the change's added amendment, never on the product layer", async () => {
    const { tree: before } = await changeNode();
    const productIds = (t: V2Tree) => indexTree(t).entries.filter((e) => e.root === "product").map((e) => e.node.id).sort();
    const { client, call, card } = await raise({ propose: { type: "capability", under: AREA_ID, title: "Retry a declined card", proposed: "A shopper retries a declined card." } });
    expect(card.placement?.check).toEqual({ ok: true, action: "propose", type: "capability", under: AREA_ID, title: "Retry a declined card", warnings: [] });

    await decide(card.id, { decision: "approve" });
    const result = await call;
    expect(resultText(result)).toContain("It reaches the product map only when the change is applied.");
    const { tree, change } = await changeNode();
    expect(change.amends).toEqual([expect.objectContaining({ delta: "added", type: "capability", under: AREA_ID, title: "Retry a declined card" })]);
    expect(change.appliedAt).toBeUndefined();
    expect(productIds(tree)).toEqual(productIds(before));
    expect(logEvents().at(-1)).toMatchObject({ event: "change_proposed", itemId: inboxId });
    await client.close();
  });

  it("a refusal: the card shows rex's kind, and approving returns that kind to the agent and writes nothing", async () => {
    const before = treeHash();
    const { client, call, card } = await raise({ target: CAPABILITY_ID, relation: "amends" });
    expect(card.placement?.check).toMatchObject({ ok: false, kind: "nothing-to-modify", error: expect.stringContaining("Cannot place change") });

    await decide(card.id, { decision: "approve" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toMatch(/Rex refused the placement \(kind: nothing-to-modify\): Cannot place change .*\. Nothing was written\./);
    expect(treeHash()).toBe(before);
    await client.close();
  });

  it("a denied card writes nothing", async () => {
    const before = treeHash();
    const { client, call, card } = await raise({ target: CAPABILITY_ID, relation: "touches" });
    await decide(card.id, { decision: "deny", reason: "Not this one" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(`The operator denied card ${card.id}. Nothing ran. Operator's note: Not this one`);
    expect(treeHash()).toBe(before);
    await client.close();
  });

  it("the operator's edit is what approval writes: the card proposed touches, the edit amends with a criteria delta", async () => {
    const { tree } = await changeNode();
    const base = specHash(nodeSpec(indexTree(tree).resolve(CAPABILITY_ID)!));
    const { client, call, card } = await raise({ target: CAPABILITY_ID, relation: "touches" });
    const criteria = { add: [{ id: "c3", text: "A declined card can be retried" }] };

    const res = await decide(card.id, { decision: "approve", edits: { target: CAPABILITY_ID, relation: "amends", criteria } });
    expect(res.status).toBe(200);
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(resultText(result)).toContain(`it amends Pay by card (${CAPABILITY_ID})`);
    const { change } = await changeNode();
    expect(change.touches ?? []).toEqual([]);
    expect(change.amends).toEqual([expect.objectContaining({ target: CAPABILITY_ID, delta: "modified", criteria, base })]);
    const decided = broker.cards(SESSION).find((c) => c.id === card.id)!;
    expect(decided).toMatchObject({ edited: true, placement: { request: { action: "place", relation: "amends" }, check: { ok: true, relation: "amends", base } } });
    await client.close();
  });

  it("an edit rex refuses, or that cannot be read, is a 400 that leaves the card waiting and writes nothing", async () => {
    const { client, call, card } = await raise({ target: CAPABILITY_ID, relation: "touches" });
    const before = treeHash();
    // amends with no amendment: rex's nothing-to-modify.
    const refused = await decide(card.id, { decision: "approve", edits: { target: CAPABILITY_ID, relation: "amends" } });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("nothing-to-modify");
    expect((await decide(card.id, { decision: "approve", edits: "touches" })).status).toBe(400);
    expect((await decide(card.id, { decision: "approve", edits: { target: CAPABILITY_ID, propose: { type: "capability", under: AREA_ID, title: "x" } } })).status).toBe(400);
    expect(treeHash()).toBe(before);
    expect(broker.cards(SESSION).find((c) => c.id === card.id)!.status).toBe("pending");

    // A denial carries no edit, and Leave in Inbox (a denial) writes nothing.
    expect((await decide(card.id, { decision: "deny", edits: { target: CAPABILITY_ID } })).status).toBe(409);
    await decide(card.id, { decision: "deny", reason: "Left in the Inbox" });
    expect((await call).isError).toBe(true);
    expect(treeHash()).toBe(before);
    await client.close();
  });

  it("raises no card for a change that does not exist, or a call that gives both a target and a proposal", async () => {
    const client = await brokerClient();
    const missing = await client.callTool({ name: "place_change_card", arguments: { change: "no-such", target: CAPABILITY_ID, reasons: ["r"] } });
    expect(missing.isError).toBe(true);
    expect(resultText(missing)).toBe('No card was raised: No live change "no-such". Nothing was written.');
    const both = await client.callTool({
      name: "place_change_card",
      arguments: { change: inboxId, target: CAPABILITY_ID, propose: { type: "capability", under: AREA_ID, title: "x" }, reasons: ["r"] },
    });
    expect(resultText(both)).toBe("No card was raised: Give either target or propose, not both. Nothing was written.");
    expect(broker.cards(SESSION)).toEqual([]);
    await client.close();
  });

  it("lists the Place lens with its change target on v2, and as needing a v2 PRD on v1", async () => {
    const lenses = async () => ((await (await fetch(`${server.baseUrl}/api/sidecar/lenses`)).json()) as { lenses: Array<Record<string, unknown>> }).lenses;
    expect((await lenses()).find((l) => l.id === "place")).toEqual({ id: "place", available: true, target: { kind: "change", needs: "a change awaiting placement" } });
    ctx = { ...ctx, rexDir: join(root, "v1-rex") };
    mkdirSync(join(ctx.rexDir, "prd_tree"), { recursive: true });
    expect((await lenses()).find((l) => l.id === "place")).toEqual({ id: "place", available: false, needs: "a v2 PRD" });
  });
});

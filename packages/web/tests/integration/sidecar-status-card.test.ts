/**
 * `propose_status`: the Sidecar proposes changing an existing item's status.
 * It raises a status card that is never allow-listable, carrying the current
 * and proposed status and rex's own verdict on the move; only Approve writes,
 * through rex's update_task_status, never forced. A move rex refuses comes
 * back as a failed card with rex's message. Through a real broker and MCP
 * client on a temp v2 PRD.
 */

import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
import { PROPOSABLE_STATUSES, readStatusCall, writeStatusCard } from "../../src/server/sidecar/status-card.js";
import { indexTree, loadPrdModel, openClaimsStore, resolveClaimHolder, type PRDItem } from "../../src/server/rex-gateway.js";
import { removeTestDir } from "../helpers/server-route-test-support.js";

const V2_FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");
const TASK = "c0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const CAPABILITY = "a0000000-0000-4000-8000-000000000002";

let root: string;
let rexDir: string;
let raised: SidecarCard[];
let broker: SidecarBroker;
let clients: Client[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sidecar-status-"));
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

/** Actions whose status read and write are the server's own, on the temp PRD; every other effect is refused. */
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
    checkItemEdit: async () => "no",
    writeItemEdit: async () => refused,
    checkStatus: (input) => readStatusCall(rexDir, input),
    writeStatus: (change) => writeStatusCard({ rexDir, projectDir: root }, change),
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

describe("propose_status policy", () => {
  it("excludes deletion from both the advertised schema and server validation", async () => {
    const client = await connect(actions());
    const tool = (await client.listTools()).tools.find((tool) => tool.name === "propose_status")!;
    expect(tool.inputSchema.properties?.status).toMatchObject({ enum: [...PROPOSABLE_STATUSES] });
    expect(PROPOSABLE_STATUSES).not.toContain("deleted");
    const before = await loadPrdModel(rexDir);
    expect(indexTree(before.tree).resolve(CHANGE)?.children).toHaveLength(1);
    const result = await client.callTool({ name: "propose_status", arguments: { id: CHANGE, status: "deleted" } });
    expect(result.isError).toBe(true);
    expect(raised).toEqual([]);
    expect(await loadPrdModel(rexDir)).toEqual(before);
  });

  it("refuses deletion at server validation without removing the item or its children", async () => {
    const before = await loadPrdModel(rexDir);
    expect(indexTree(before.tree).resolve(CHANGE)?.children).toHaveLength(1);
    expect(await readStatusCall(rexDir, { id: CHANGE, status: "deleted" })).toEqual(expect.any(String));
    expect(await loadPrdModel(rexDir)).toEqual(before);
  });

  it("refuses an old deletion card without removing the item or its children", async () => {
    const before = await loadPrdModel(rexDir);
    expect(indexTree(before.tree).resolve(CHANGE)?.children).toHaveLength(1);
    const result = await writeStatusCard({ rexDir, projectDir: root }, {
      itemId: CHANGE, itemTitle: "Add Apple Pay", from: "in_progress", to: "deleted", rule: { allowed: true },
    });
    expect(result.ok).toBe(false);
    expect(result.text).toContain("Nothing was written");
    expect(await loadPrdModel(rexDir)).toEqual(before);
  });

  it("raises a status card that can never be allow-listed", () => {
    expect(BROKER_TOOL_POLICY.propose_status).toEqual({ card: "status", allowList: "never" });
    expect(allowListKey("propose_status", { id: TASK, status: "deferred" })).toBeNull();
  });

  it("is offered to a worktree session and not to the hub's", () => {
    expect(BROKER_SCOPE_TOOLS.worktree).toContain("propose_status");
    expect(BROKER_SCOPE_TOOLS.hub).not.toContain("propose_status");
  });
});

describe("propose_status", () => {
  it("shows the current and proposed status with rex's verdict, and writes nothing before Approve", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "deferred", reason: "waiting on design" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(raised[0]).toMatchObject({
      kind: "status",
      tool: "propose_status",
      allowListKey: null,
      statusChange: { itemId: TASK, itemTitle: "Wire the button", from: "pending", to: "deferred", reason: "waiting on design", rule: { allowed: true } },
    });
    expect((await readTask()).status).toBe("pending");

    broker.decide("s1", raised[0]!.id, { approve: false });
    await call;
    expect((await readTask()).status).toBe("pending");
  });

  it("sets the status through rex on Approve", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "deferred" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("Wire the button");
    expect(textOf(result)).toContain('"newStatus":"deferred"');

    expect((await readTask()).status).toBe("deferred");
    expect(broker.cards("s1")[0]).toMatchObject({ carriedOut: { ok: true, ids: [TASK] } });
  });

  it("completes through rex's own path", async () => {
    const before = await loadPrdModel(rexDir);
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "completed" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(result.isError).toBeFalsy();
    const task = await readTask();
    expect(task.status).toBe("completed");
    // rex's completion stamps the time; a plain status write would not have.
    expect(task.completedAt).toBeTruthy();
    const after = await loadPrdModel(rexDir);
    // An in-progress enclosing change does not auto-complete or apply.
    expect(indexTree(after.tree).resolve(CHANGE)?.status).toBe("in_progress");
    expect(indexTree(after.tree).resolve(CHANGE)?.appliedAt).toBeUndefined();
    expect(after.tree.product).toEqual(before.tree.product);
    expect(raised[0]!.statusChange).toMatchObject({ completionPolicy: "v2" });
  });

  it("discloses completion effects before approving the last task of a pending change, then really auto-applies", async () => {
    await (await resolveStore(rexDir)).updateItem(CHANGE, { status: "pending" });
    const before = await loadPrdModel(rexDir);
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "completed" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    const beforeApproval = await loadPrdModel(rexDir);
    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(raised[0]!.statusChange).toMatchObject({ completionPolicy: "v2" });
    expect(beforeApproval).toEqual(before);
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('"applied":true');
    const after = indexTree((await loadPrdModel(rexDir)).tree);
    expect(after.resolve(TASK)?.status).toBe("completed");
    expect(after.resolve(CHANGE)).toMatchObject({ status: "completed", appliedAt: expect.any(String) });
    expect(after.resolve(CAPABILITY)?.criteria).toContainEqual({ id: "c3", text: "Apple Pay is offered on Safari" });
  });

  it.each(["review", "release"])("preserves rex.applyOn=%s: completion leaves product amendments unapplied", async (applyOn) => {
    writeFileSync(join(root, ".n-dx.json"), JSON.stringify({ rex: { applyOn } }));
    await (await resolveStore(rexDir)).updateItem(CHANGE, { status: "pending" });
    const before = await loadPrdModel(rexDir);
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "completed" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    const beforeApproval = await loadPrdModel(rexDir);
    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(raised[0]!.statusChange).toMatchObject({ completionPolicy: "v2" });
    expect(beforeApproval).toEqual(before);
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('"applied":false');
    const after = await loadPrdModel(rexDir);
    expect(indexTree(after.tree).resolve(CHANGE)?.status).toBe("completed");
    expect(indexTree(after.tree).resolve(CHANGE)?.appliedAt).toBeUndefined();
    expect(after.tree.product).toEqual(before.tree.product);
  });

  it("also discloses product apply when completing the change itself", async () => {
    await (await resolveStore(rexDir)).updateItem(TASK, { status: "completed" });
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: CHANGE, status: "completed" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(raised[0]!.statusChange).toMatchObject({ completionPolicy: "v2" });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('"applied":true');
    expect(indexTree((await loadPrdModel(rexDir)).tree).resolve(CAPABILITY)?.criteria)
      .toContainEqual({ id: "c3", text: "Apple Pay is offered on Safari" });
  });

  it("marks a completion held for a hench run as held, not written", async () => {
    await (await resolveStore(rexDir)).updateItem(CHANGE, { status: "pending" });
    const before = await loadPrdModel(rexDir);
    // Claims live under the git dir, so the project is a repository.
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const run = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    try {
      const claimed = await openClaimsStore(root).claim(TASK, { worktreeRoot: resolveClaimHolder(root).worktreeRoot, pid: run.pid!, holdsCompletion: true });
      expect(claimed.ok).toBe(true);
      const client = await connect(actions());
      const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "completed" } });
      await vi.waitFor(() => expect(raised).toHaveLength(1));
      broker.decide("s1", raised[0]!.id, { approve: true });
      const result = await call;
      expect(result.isError).toBeFalsy();
      expect(raised[0]!.statusChange).toMatchObject({ completionPolicy: "v2" });
      expect(textOf(result)).toContain("not written yet");
      expect(textOf(result)).toContain("completionHeld");
      expect((await readTask()).status).toBe("pending");
      expect(await loadPrdModel(rexDir)).toEqual(before);
      const carriedOut = broker.cards("s1")[0]!.carriedOut!;
      expect(carriedOut).toMatchObject({ ok: true, held: true, ids: [TASK] });
    } finally {
      run.kill();
    }
  });

  it("does not mark a written status held", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "deferred" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    broker.decide("s1", raised[0]!.id, { approve: true });
    await call;
    expect(broker.cards("s1")[0]!.carriedOut!.held).toBeUndefined();
  });

  it("fails the card with rex's message for a transition rex refuses", async () => {
    await (await resolveStore(rexDir)).updateItem(TASK, { status: "cancelled" });
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "in_progress" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    const rule = raised[0]!.statusChange!.rule;
    expect(rule.allowed).toBe(false);
    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Cannot move from "cancelled" to "in_progress"');
    expect(textOf(result)).toContain("Nothing was written");
    expect(rule).toEqual({ allowed: false, message: expect.stringContaining('from "cancelled"') });
    expect(broker.cards("s1")[0]).toMatchObject({ carriedOut: { ok: false } });
    expect((await readTask()).status).toBe("cancelled");
  });

  it("writes nothing when the status moved since the card was raised", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "deferred" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    await (await resolveStore(rexDir)).updateItem(TASK, { status: "blocked" });
    broker.decide("s1", raised[0]!.id, { approve: true });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("is now blocked");
    expect((await readTask()).status).toBe("blocked");
  });

  it("refuses to remember the call, and edits", async () => {
    const client = await connect(actions());
    const call = client.callTool({ name: "propose_status", arguments: { id: TASK, status: "deferred" } });
    await vi.waitFor(() => expect(raised).toHaveLength(1));
    expect(() => broker.decide("s1", raised[0]!.id, { approve: true, remember: true })).toThrow(/allow-list/i);
    expect(() => broker.decide("s1", raised[0]!.id, { approve: true, edits: { status: "completed" } })).toThrow(/takes no edits/);
    broker.decide("s1", raised[0]!.id, { approve: false });
    await call;
  });

  it("raises no card for an unknown item, an unchanged status, or no PRD", async () => {
    const client = await connect(actions());
    const unknown = await client.callTool({ name: "propose_status", arguments: { id: "nope", status: "deferred" } });
    expect(textOf(unknown)).toContain("No card was raised: no item nope");
    const same = await client.callTool({ name: "propose_status", arguments: { id: TASK, status: "pending" } });
    expect(textOf(same)).toContain("is already pending");
    const none = await (await connect(undefined)).callTool({ name: "propose_status", arguments: { id: TASK, status: "deferred" } });
    expect(none.isError).toBe(true);
    expect(raised).toEqual([]);
  });
});

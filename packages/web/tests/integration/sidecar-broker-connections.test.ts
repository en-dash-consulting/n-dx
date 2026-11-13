/**
 * A worktree Sidecar session's broker re-exposes the tools of the servers the
 * operator connected, under `<id>__<tool>`: a read runs at once, a write waits
 * on an external-call card, a never-policy tool is absent, and a server that
 * went away reads "connection unavailable" while the broker keeps working.
 *
 * Real request gate, real routes, a real ConnectionService over the project's
 * `.n-dx.local.json` with a temp ndx home, and an in-process fake MCP server.
 * The broker endpoint is driven with the SDK Client the way both vendors'
 * CLIs reach it: Streamable HTTP, the session config's URL and headers.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setCredential, type VendorSessionOptions } from "@n-dx/llm-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { handleRequestSecurity } from "../../src/server/request-security.js";
import { handleConnectionsRoute } from "../../src/server/routes-connections.js";
import { createAnnouncingBroker, handleSidecarRoute, sidecarBrokerEndpoint } from "../../src/server/routes-sidecar.js";
import { isSidecarBrokerRequest } from "../../src/server/sidecar/broker-credential.js";
import { BROKER_SCOPE_TOOLS } from "../../src/server/sidecar/broker-policy.js";
import type { SidecarBroker, SidecarCard } from "../../src/server/sidecar/broker.js";
import { SidecarSessionRegistry, sidecarSessionConnect } from "../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../src/server/types.js";
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from "../helpers/fake-mcp-http-server.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";
import { addCallCardTools } from "../fixtures/connections/fake-mcp-tools.mjs";

const TOKEN = "dashboard-token-0123456789abcdef";

let root: string;
let ndxHome: string;
let server: RouteTestServer;
let broker: SidecarBroker;
let fake: FakeMcpHttpServer;
let service: ConnectionService;
let configPaths: string[];
const clients: Client[] = [];

/** A Claude stand-in that names a session and holds its turn open until killed. */
const holdingSpawn: NonNullable<VendorSessionOptions["spawn"]> = (_binary, args) => {
  configPaths.push(args[args.indexOf("--mcp-config") + 1]);
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const exit = (signal: string | null): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    Object.assign(child, { exitCode: null, signalCode: signal });
    stdout.end();
    setImmediate(() => { child.emit("exit", null, signal); child.emit("close", null, signal); });
  };
  Object.assign(child, {
    stdin, stdout, stderr: new PassThrough(), pid: undefined, exitCode: null, signalCode: null,
    kill: (signal: string) => { exit(signal); return true; },
  });
  stdin.on("finish", () => {
    stdout.write(JSON.stringify({ type: "system", subtype: "init", session_id: `v-${configPaths.length}` }) + "\n");
  });
  stdin.resume();
  return child as unknown as ChildProcess;
};

/** Start the dashboard over `root` whose `.n-dx.local.json` declares `connections` (none: no file). */
async function startDashboard(connections?: Record<string, unknown>, options: { connectTimeoutMs?: number } = {}): Promise<void> {
  if (connections) writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ connections }));
  service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {}, ...options });
  const dir = join(root, ".hench", "sidecar");
  const ctx: ServerContext = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  const connect = sidecarSessionConnect(dir, (id) => sidecarBrokerEndpoint(ctx, id));
  const registry = new SidecarSessionRegistry({ dir, connect: async (record) => ({ ...await connect(record), spawn: holdingSpawn }) });
  broker = createAnnouncingBroker(dir, () => {});
  server = await startRouteTestServer((req, res) => {
    if (handleRequestSecurity(req, res, { token: TOKEN, scopedCredential: isSidecarBrokerRequest })) return true;
    return handleConnectionsRoute(req, res, ctx, { connectionsFor: () => service, credentials: { ndxHome } }).then((handled) =>
      handled || handleSidecarRoute(req, res, ctx, () => {}, {
        registryFor: () => registry,
        brokerFor: () => broker,
        connectionsFor: () => service,
      }));
  });
  ctx.port = server.port;
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "sidecar-connections-"));
  ndxHome = mkdtempSync(join(tmpdir(), "sidecar-connections-home-"));
  configPaths = [];
  fake = await startFakeMcpHttpServer();
});

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await service?.close();
  await server?.close();
  await fake.close();
  await removeTestDir(root);
  await removeTestDir(ndxHome);
});

const auth = { "X-Ndx-Token": TOKEN };

/** A session with a running turn, and an SDK Client on its broker endpoint as the vendor CLI connects. */
async function sessionClient(): Promise<{ id: string; client: Client }> {
  const created = await fetch(`${server.baseUrl}/api/sidecar/sessions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ vendor: "claude", name: "s" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()).session as { id: string };
  const previousSpawns = configPaths.length;
  const turn = await fetch(`${server.baseUrl}/api/sidecar/sessions/${id}/turns`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "go" }),
  });
  expect(turn.status).toBe(202);
  // Accepted is not spawned: config loading can still be in flight.
  await expect.poll(() => configPaths.length).toBe(previousSpawns + 1);
  const config = JSON.parse(readFileSync(configPaths.at(-1)!, "utf-8")) as {
    mcpServers: Record<string, { url: string; headers: Record<string, string> }>;
  };
  const broker = config.mcpServers["ndx-sidecar"];
  const client = new Client({ name: "vendor-cli", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(broker.url), { requestInit: { headers: broker.headers } }));
  clients.push(client);
  return { id, client };
}

function text(result: unknown): string {
  return ((result as CallToolResult).content as Array<{ type: string; text: string }>).map((c) => c.text).join("");
}

/** The session's first pending card, once raised. */
async function pendingCard(id: string): Promise<SidecarCard> {
  await expect.poll(() => broker.cards(id).some((card) => card.status === "pending")).toBe(true);
  return broker.cards(id).find((card) => card.status === "pending")!;
}

const docs = () => ({ transport: "http", url: fake.url, tools: { delete_item: { policy: "never" } } });

describe("a worktree session's broker and the operator's connections", () => {
  it("lists each connection's tools under <id>__<tool>, leaving out never-policy tools", async () => {
    await startDashboard({ docs: docs() });
    const { client } = await sessionClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    expect(names).toEqual([...BROKER_SCOPE_TOOLS.worktree, "docs__read_item", "docs__update_item"]);
    const read = tools.find((t) => t.name === "docs__read_item")!;
    expect(read.description).toBe("docs.read_item: Read an item by id.");
    // The server's schema, passed through: the broker does not validate it.
    expect(read.inputSchema).toMatchObject({ type: "object", properties: { id: { type: "string" } }, required: ["id"] });
    expect(read.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("lists exactly the broker's own tools when no connection is declared", async () => {
    await startDashboard();
    const { client } = await sessionClient();
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([...BROKER_SCOPE_TOOLS.worktree]);
  });

  it("runs a run-policy read at once, raises no card, and passes the server's result and isError back unchanged", async () => {
    await startDashboard({ docs: docs() });
    const { id, client } = await sessionClient();

    const read = await client.callTool({ name: "docs__read_item", arguments: { id: "7" } });
    expect(read).toMatchObject({ content: [{ type: "text", text: "item 7" }] });
    expect(read.isError).toBeFalsy();

    const missing = await client.callTool({ name: "docs__read_item", arguments: { id: "missing" } });
    expect(missing).toMatchObject({ content: [{ type: "text", text: "no item missing" }], isError: true });

    expect(fake.calls.map((c) => c.name)).toEqual(["read_item", "read_item"]);
    expect(broker.cards(id)).toEqual([]);
  });

  it("raises an external-call card for an ask-policy write and calls the server only on Approve", async () => {
    await startDashboard({ docs: docs() });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "docs__update_item", arguments: { id: "7", title: "t" } });
    const card = await pendingCard(id);
    expect(card).toMatchObject({
      tool: "external_call",
      kind: "external-call",
      allowListKey: null,
      input: { connection: "docs", tool: "docs.update_item", class: "write", arguments: { id: "7", title: "t" } },
    });
    expect(fake.calls).toEqual([]);

    broker.decide(id, card.id, { approve: true });
    expect(text(await call)).toBe("updated 7: t");
    expect(fake.calls).toEqual([{ name: "update_item", arguments: { id: "7", title: "t" } }]);
    expect(broker.cards(id)[0]).toMatchObject({ status: "approved", carriedOut: { ok: true } });
  });

  it("reads an approved write that a stopped turn aborts as failed, and keeps the connection connected", async () => {
    // A write the server answers only when released, so the turn can stop mid-call.
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    await fake.close();
    fake = await startFakeMcpHttpServer({
      extraTools: (mcp) =>
        mcp.registerTool("slow_write", { description: "Writes when released." }, async () => {
          await gate;
          return { content: [{ type: "text", text: "written" }] };
        }),
    });
    await startDashboard({ docs: docs() });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "docs__slow_write", arguments: {} }).catch((err: unknown) => err);
    const card = await pendingCard(id);
    broker.decide(id, card.id, { approve: true });
    await expect.poll(() => fake.calls.length).toBe(1);

    broker.withdraw(id, "the turn stopped");
    await expect.poll(() => broker.cards(id)[0].carriedOut).toEqual({ ok: false });
    release();
    await call;

    const status = (await service.listConnections()).find((c) => c.id === "docs")?.status;
    expect(status).toEqual({ state: "connected" });
    expect(fake.methods.filter((m) => m === "initialize")).toHaveLength(1);
  });

  it("refuses an ask-policy write on Deny, with the operator's note, and never calls the server", async () => {
    await startDashboard({ docs: docs() });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "docs__update_item", arguments: { id: "7", title: "t" } });
    const card = await pendingCard(id);
    broker.decide(id, card.id, { approve: false, reason: "not that one" });
    const result = await call;
    expect(result.isError).toBe(true);
    expect(text(result)).toBe(`The operator denied card ${card.id}. docs.update_item did not run. Operator's note: not that one`);
    expect(fake.calls).toEqual([]);
  });

  it("reads 'connection unavailable' with no card when the server is down, and the broker keeps working", async () => {
    await startDashboard({ docs: docs() });
    const { id, client } = await sessionClient();
    await client.listTools();
    await fake.close();

    for (const [name, args] of [["docs__read_item", { id: "7" }], ["docs__update_item", { id: "7", title: "t" }]] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/^connection unavailable: /);
    }
    expect(broker.cards(id)).toEqual([]);

    // The tools stay listed, and the broker's own tools still answer.
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("docs__update_item");
    expect(text(await client.callTool({ name: "ledger_append", arguments: { type: "decision", text: "kept going" } })))
      .toBe("Noted in the session ledger.");
  });

  it("calls a healthy connection without trying to reach another connection that never answers", async () => {
    // Accepts each request and never answers; counts them.
    let silentRequests = 0;
    const silent = createServer(() => { silentRequests += 1; });
    await new Promise<void>((done) => silent.listen(0, "127.0.0.1", done));
    try {
      const url = `http://127.0.0.1:${(silent.address() as AddressInfo).port}/mcp`;
      await startDashboard({ docs: docs(), silent: { transport: "http", url } }, { connectTimeoutMs: 500 });
      const { client } = await sessionClient();
      await client.listTools();
      const before = silentRequests;
      expect(before).toBeGreaterThan(0);

      // A call names its connection: only that one is read, so the silent one costs it no connect wait.
      expect(text(await client.callTool({ name: "docs__read_item", arguments: { id: "7" } }))).toBe("item 7");
      expect(silentRequests).toBe(before);
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((done) => silent.close(() => done()));
    }
  });

  it("reads 'sign in again' with no card when the server starts refusing the stored token", async () => {
    setCredential("connection:docs", "tok-1", { ndxHome });
    fake.requireToken = "tok-1";
    await startDashboard({ docs: { ...docs(), auth: "token" } });
    const { id, client } = await sessionClient();
    await client.listTools();
    fake.requireToken = "tok-2";

    for (const [name, args] of [["docs__read_item", { id: "7" }], ["docs__update_item", { id: "7", title: "t" }]] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/^sign in again: connection docs needs sign-in \(the server refused the stored token\)/);
      expect(text(result)).not.toContain("tok-");
    }
    expect(broker.cards(id)).toEqual([]);
  });
});

describe("an external-call card's form, hints and problems", () => {
  const ticket = (extra: Record<string, unknown> = {}) => ({ transport: "http", url: fake.url, ...extra });

  beforeEach(async () => {
    // The default fake lists only the base tools; these tests need the call-card tools.
    await fake.close();
    fake = await startFakeMcpHttpServer({ extraTools: addCallCardTools });
  });

  /** Decide the waiting card through the real route, as the drawer does. */
  async function decideOverHttp(id: string, cardId: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`${server.baseUrl}/api/sidecar/sessions/${id}/cards/${cardId}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("carries the connection, workspace host and the tool's input schema, with no choices when there are no hints", async () => {
    await startDashboard({ desk: ticket({ label: "Help desk" }) });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__create_ticket", arguments: { title: "t", requestId: "r-1" } });
    const card = await pendingCard(id);
    expect(card.externalCall).toMatchObject({
      label: "Help desk",
      host: new URL(fake.url).host,
      inputSchema: { type: "object", properties: { title: { type: "string" }, estimate: { type: "integer" } }, required: ["title"] },
    });
    expect(card.externalCall).not.toHaveProperty("options");
    // Only the card's own tool is asked of the server: no hint, no read.
    expect(fake.calls).toEqual([]);

    broker.decide(id, card.id, { approve: false });
    await call;
  });

  it("calls the server with the arguments the operator edited, but never a changed idempotency key", async () => {
    await startDashboard({ desk: ticket() });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__create_ticket", arguments: { title: "t", requestId: "r-1" } });
    const card = await pendingCard(id);
    const res = await decideOverHttp(id, card.id, {
      decision: "approve",
      arguments: { title: "edited", estimate: 4, requestId: "r-other", idempotencyKey: "added" },
    });
    expect(res.status).toBe(200);

    expect(text(await call)).toBe("created edited for nobody in no team (r-1)");
    expect(fake.calls).toEqual([{ name: "create_ticket", arguments: { title: "edited", estimate: 4, requestId: "r-1" } }]);
    expect(broker.cards(id)[0]).toMatchObject({
      status: "approved",
      edited: true,
      input: { arguments: { title: "edited", estimate: 4, requestId: "r-1" } },
      carriedOut: { ok: true },
    });
  });

  it("calls the server with the agent's arguments when the operator edits nothing", async () => {
    await startDashboard({ desk: ticket() });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__create_ticket", arguments: { title: "t", requestId: "r-1" } });
    const card = await pendingCard(id);
    expect((await decideOverHttp(id, card.id, { decision: "approve", arguments: { requestId: "r-1", title: "t" } })).status).toBe(200);
    await call;
    expect(fake.calls[0].arguments).toEqual({ title: "t", requestId: "r-1" });
    expect(broker.cards(id)[0].edited).toBeUndefined();
  });

  it("refuses arguments that are not an object, and arguments on a denial", async () => {
    await startDashboard({ desk: ticket() });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__create_ticket", arguments: { title: "t" } });
    const card = await pendingCard(id);
    expect((await decideOverHttp(id, card.id, { decision: "approve", arguments: ["x"] })).status).toBe(400);
    expect((await decideOverHttp(id, card.id, { decision: "deny", arguments: { title: "x" } })).status).toBe(409);
    expect(broker.cards(id)[0].status).toBe("pending");

    broker.decide(id, card.id, { approve: false });
    await call;
  });

  it("fills a picker from a read tool named by a hint (structured content or JSON text), and ignores a hint it cannot honour", async () => {
    await startDashboard({
      desk: ticket({
        fieldHints: {
          ownerId: { optionsFrom: { tool: "list_owners", path: "owners" } },
          teamId: { optionsFrom: { tool: "find_teams", path: "data.teams" } },
          // A write tool, an unknown tool and a property the schema lacks are not read.
          estimate: { optionsFrom: { tool: "create_ticket", path: "" } },
          title: { optionsFrom: { tool: "nope", path: "" } },
          missing: { optionsFrom: { tool: "list_owners", path: "owners" } },
        },
      }),
    });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__create_ticket", arguments: { title: "t", ownerId: "u-2" } });
    const card = await pendingCard(id);
    expect(card.externalCall!.options).toEqual({
      ownerId: [{ value: "u-1", label: "Ada" }, { value: "u-2", label: "Grace" }],
      teamId: [{ value: "t-a", label: "Alpha" }, { value: "t-b", label: "t-b" }],
    });
    expect(fake.calls.map((c) => c.name).sort()).toEqual(["find_teams", "list_owners"]);

    broker.decide(id, card.id, { approve: false });
    await call;
  });

  it("fills an auto hint from the read tool the property's name points at", async () => {
    await startDashboard({ desk: ticket({ fieldHints: { ownerId: { auto: true }, teamId: { auto: true } } }) });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__create_ticket", arguments: { title: "t" } });
    const card = await pendingCard(id);
    // ownerId -> list_owners; teamId has no list_teams, list_team or teams tool, so it stays a plain field.
    expect(card.externalCall!.options).toEqual({ ownerId: [{ value: "u-1", label: "Ada" }, { value: "u-2", label: "Grace" }] });

    broker.decide(id, card.id, { approve: false });
    await call;
  });

  it("never reads a hint's tool the operator set to ask or never", async () => {
    await startDashboard({
      desk: ticket({
        tools: { list_owners: { policy: "ask" }, find_teams: { policy: "never" } },
        fieldHints: {
          ownerId: { optionsFrom: { tool: "list_owners", path: "owners" } },
          teamId: { optionsFrom: { tool: "find_teams", path: "data.teams" } },
        },
      }),
    });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__create_ticket", arguments: { title: "t" } });
    const card = await pendingCard(id);
    expect(card.externalCall).not.toHaveProperty("options");
    expect(fake.calls).toEqual([]);

    broker.decide(id, card.id, { approve: false });
    await call;
  });

  it("raises the card with a plain form when a hint's read finds no choices", async () => {
    await startDashboard({ desk: ticket({ fieldHints: { ownerId: { optionsFrom: { tool: "list_owners", path: "no.such.path" } } } }) });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__create_ticket", arguments: { title: "t" } });
    const card = await pendingCard(id);
    expect(card.externalCall).not.toHaveProperty("options");

    broker.decide(id, card.id, { approve: false });
    await call;
  });

  it("shows a validation_failed result's problems on the card, hands the session the result unchanged, and calls the server once", async () => {
    await startDashboard({ desk: ticket() });
    const { id, client } = await sessionClient();

    const call = client.callTool({ name: "desk__reject_ticket", arguments: { title: "t" } });
    const card = await pendingCard(id);
    broker.decide(id, card.id, { approve: true });
    const result = await call;

    expect(result.isError).toBe(true);
    expect(JSON.parse(text(result))).toEqual({
      error: "validation_failed",
      problems: [{ field: "title", message: "too long" }, "estimate is required"],
    });
    expect(broker.cards(id)[0].carriedOut).toEqual({
      ok: false,
      problems: [{ field: "title", message: "too long" }, { message: "estimate is required" }],
    });
    // No retry with altered arguments, and no second card.
    expect(fake.calls).toEqual([{ name: "reject_ticket", arguments: { title: "t" } }]);
    expect(broker.cards(id)).toHaveLength(1);
  });
});

describe("a tool's class and policy edited on the Settings route", () => {
  const put = (path: string, body: unknown) =>
    fetch(`${server.baseUrl}${path}`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const localConnections = () => JSON.parse(readFileSync(join(root, ".n-dx.local.json"), "utf-8")).connections;

  it("reach the next tools/list of a session that is already running, and the local config file", async () => {
    await startDashboard({ docs: { transport: "http", url: fake.url } });
    const { client } = await sessionClient();
    const names = async () => (await client.listTools()).tools.map((t) => t.name).filter((n) => n.startsWith("docs__")).sort();
    expect(await names()).toEqual(["docs__delete_item", "docs__read_item", "docs__update_item"]);

    // never: gone from the session's list.
    const never = await put("/api/connections/docs/tools/delete_item", { policy: "never" });
    expect(never.status).toBe(200);
    expect((await never.json()).tool).toMatchObject({ tool: "delete_item", policy: "never", policySource: "override" });
    expect(await names()).toEqual(["docs__read_item", "docs__update_item"]);
    expect(localConnections().docs.tools).toEqual({ delete_item: { policy: "never" } });

    // A class change moves the default policy with it: a write told to be a read runs.
    const read = await put("/api/connections/docs/tools/update_item", { class: "read" });
    expect((await read.json()).tool).toMatchObject({ class: "read", classSource: "override", policy: "run", policySource: "default" });

    // null clears the override and the tool comes back.
    const cleared = await put("/api/connections/docs/tools/delete_item", { policy: null });
    expect((await cleared.json()).tool).toMatchObject({ policy: "ask", policySource: "default" });
    expect(await names()).toEqual(["docs__delete_item", "docs__read_item", "docs__update_item"]);
    expect(localConnections().docs.tools).toEqual({ update_item: { class: "read" } });
  });

  it("refuse an unknown tool, class or policy and write nothing", async () => {
    await startDashboard({ docs: { transport: "http", url: fake.url } });
    const before = readFileSync(join(root, ".n-dx.local.json"), "utf-8");
    expect((await put("/api/connections/docs/tools/nope", { policy: "never" })).status).toBe(404);
    expect((await put("/api/connections/docs/tools/read_item", { policy: "sometimes" })).status).toBe(400);
    expect((await put("/api/connections/docs/tools/read_item", { class: "admin" })).status).toBe(400);
    expect((await put("/api/connections/missing/tools/read_item", { policy: "run" })).status).toBe(404);
    expect(readFileSync(join(root, ".n-dx.local.json"), "utf-8")).toBe(before);
  });
});

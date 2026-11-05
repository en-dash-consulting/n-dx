/**
 * Server profiles over a real ConnectionService and fake MCP servers (never
 * CAOS): the built-in CAOS profile fits a server exposing CAOS's tool names
 * and schemas and fills the write card's pickers; a profile that does not fit
 * is refused with the gap named while the connection keeps working attended;
 * a connection with no profile still lists, reads and raises plain cards.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConnectionConfig } from "../../src/server/connections/connection-config.js";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { handleConnectionsRoute } from "../../src/server/routes-connections.js";
import { buildExternalCall } from "../../src/server/sidecar/external-call.js";
import { resolveServerProfile, USER_PROFILES_DIR } from "../../src/server/tracker/server-profiles.js";
import type { ServerContext } from "../../src/server/types.js";
import { addCaosTools } from "../fixtures/connections/fake-mcp-tools.mjs";
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from "../helpers/fake-mcp-http-server.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";

let root: string;
let ndxHome: string;
let caosFake: FakeMcpHttpServer;
let plainFake: FakeMcpHttpServer;
let service: ConnectionService | undefined;
let routes: RouteTestServer | undefined;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "tracker-profiles-"));
  ndxHome = mkdtempSync(join(tmpdir(), "tracker-profiles-home-"));
  caosFake = await startFakeMcpHttpServer({ extraTools: addCaosTools });
  plainFake = await startFakeMcpHttpServer();
});

afterEach(async () => {
  await service?.close();
  service = undefined;
  await routes?.close();
  routes = undefined;
  await caosFake.close();
  await plainFake.close();
  await removeTestDir(root);
  await removeTestDir(ndxHome);
});

function connect(...connections: ConnectionConfig[]): ConnectionService {
  service = new ConnectionService({ projectDir: root, credentials: { ndxHome }, warn: () => {}, connections });
  return service;
}

const http = (id: string, url: string, extra: Partial<ConnectionConfig> = {}): ConnectionConfig =>
  ({ id, label: id, auth: "none", transport: "http", url, ...extra }) as ConnectionConfig;

/** GET /api/connections over `svc`, as the Settings page reads it. */
async function connectionsRoute(svc: ConnectionService): Promise<Array<Record<string, unknown>>> {
  const ctx: ServerContext = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  routes = await startRouteTestServer((req, res) => handleConnectionsRoute(req, res, ctx, { connectionsFor: () => svc }));
  const body = await (await fetch(`${routes.baseUrl}/api/connections`)).json() as { connections: Array<Record<string, unknown>> };
  return body.connections;
}

describe("the built-in CAOS profile", () => {
  it("fits a server with CAOS's tools and fills the epic picker and the enums", async () => {
    const svc = connect(http("caos", caosFake.url, { profile: "caos" }));
    const tools = await svc.listTools();
    expect(resolveServerProfile("caos", tools, { ndxHome })).toMatchObject({ state: "ok" });

    const create = tools.find((t) => t.tool === "create_work_item")!;
    const call = await buildExternalCall(create, tools, svc, undefined, { ndxHome });
    expect(call.options).toEqual({
      epicId: [{ value: "ep-1", label: "ndx 0.10.0 - Sidecar" }, { value: "ep-2", label: "ndx 1.0.0 - Freeze" }],
      type: ["Story", "Bug", "Task"].map((v) => ({ value: v, label: v })),
      priority: ["High", "Medium", "Low"].map((v) => ({ value: v, label: v })),
      estimate: ["1", "2", "3", "5", "8"].map((v) => ({ value: v, label: v })),
    });
    // requestId is the agent's idempotency key, never a picker.
    expect(call.options).not.toHaveProperty("requestId");

    expect(await connectionsRoute(svc)).toEqual([expect.objectContaining({ id: "caos", profile: { name: "caos", state: "ok" } })]);
  });

  it("gives way to the connection's own hint for the same property", async () => {
    const svc = connect(http("caos", caosFake.url, {
      profile: "caos",
      fieldHints: { estimate: { optionsFrom: { tool: "list_epics", path: "items" } } },
    }));
    const tools = await svc.listTools();
    const call = await buildExternalCall(tools.find((t) => t.tool === "create_work_item")!, tools, svc, undefined, { ndxHome });
    expect(call.options?.estimate).toEqual(call.options?.epicId);
    expect(call.options?.type).toHaveLength(3);
  });
});

describe("a profile that does not fit its server", () => {
  it("is refused with the gap named, and the connection keeps working attended", async () => {
    // The CAOS profile on a server that has none of CAOS's tools.
    const svc = connect(http("desk", plainFake.url, { profile: "caos" }));
    const tools = await svc.listTools();
    const resolution = resolveServerProfile("caos", tools, { ndxHome });
    expect(resolution).toMatchObject({ state: "invalid", problem: expect.stringContaining("tracker.createTool names create_work_item, which the server does not list") });

    const [view] = await connectionsRoute(svc);
    expect(view).toMatchObject({ state: "connected", profile: { name: "caos", state: "invalid", problem: expect.stringContaining("create_work_item") } });

    // Attended use is unchanged: reads run, a write's card is a plain form.
    expect(await svc.callTool("desk", "read_item", { id: "3" })).toMatchObject({ content: [{ text: "item 3" }] });
    const call = await buildExternalCall(tools.find((t) => t.tool === "update_item")!, tools, svc, undefined, { ndxHome });
    expect(call).not.toHaveProperty("options");
  });

  it("is refused when a user profile's status map misses an event, and its hints are not used", async () => {
    const dir = join(ndxHome, USER_PROFILES_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mine.json"), JSON.stringify({
      fieldHints: { create_work_item: { epicId: { optionsFrom: { tool: "list_epics", path: "items" } } } },
      tracker: {
        createTool: "create_work_item", moveTool: "move_work_item", readTool: "get_work_item",
        requestIdProperty: "requestId", itemIdProperty: "workItemId", moveStatusProperty: "toStatus",
        statusMap: { "change-captured": "backlog", "run-started": "inProgress" },
      },
    }));
    const svc = connect(http("caos", caosFake.url, { profile: "mine" }));
    const tools = await svc.listTools();
    expect(resolveServerProfile("mine", tools, { ndxHome })).toMatchObject({
      state: "invalid",
      problem: expect.stringContaining("tracker.statusMap has no status for pr-opened"),
    });
    const call = await buildExternalCall(tools.find((t) => t.tool === "create_work_item")!, tools, svc, undefined, { ndxHome });
    expect(call).not.toHaveProperty("options");
    expect(svc.connection("caos")!.status).toEqual({ state: "connected" });
  });
});

describe("the built-in CAOS profile on a server with many epics", () => {
  it("asks list_epics for its largest page, so the picker holds more than the default 25", async () => {
    const big = await startFakeMcpHttpServer({ extraTools: (server) => addCaosTools(server, {}, { epicCount: 150 }) });
    try {
      const svc = connect(http("caos", big.url, { profile: "caos" }));
      const tools = await svc.listTools();
      const call = await buildExternalCall(tools.find((t) => t.tool === "create_work_item")!, tools, svc, undefined, { ndxHome });
      expect(big.calls.find((c) => c.name === "list_epics")?.arguments).toEqual({ pageSize: 100 });
      expect(call.options?.epicId).toHaveLength(100);
    } finally {
      await big.close();
    }
  });
});

describe("a connection with no profile", () => {
  it("lists its tools, runs reads and raises plain write cards", async () => {
    const svc = connect(http("desk", plainFake.url));
    const tools = await svc.listTools();
    expect(tools.map((t) => t.tool).sort()).toEqual(["delete_item", "read_item", "update_item"]);
    expect(await svc.callTool("desk", "read_item", { id: "9" })).toMatchObject({ content: [{ text: "item 9" }] });
    const call = await buildExternalCall(tools.find((t) => t.tool === "update_item")!, tools, svc, undefined, { ndxHome });
    expect(call).toEqual({ label: "desk", host: new URL(plainFake.url).host, inputSchema: expect.objectContaining({ type: "object" }) });
    const [view] = await connectionsRoute(svc);
    expect(view).not.toHaveProperty("profile");
  });
});

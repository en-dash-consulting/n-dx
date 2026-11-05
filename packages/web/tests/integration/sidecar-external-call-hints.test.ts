/**
 * A field hint's read tool against a real ConnectionService and a fake MCP
 * server: a hint read that runs past its limit leaves a plain field and
 * leaves the connection connected, with its client still serving calls.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConnectionService } from "../../src/server/connections/connection-service.js";
import { buildExternalCall } from "../../src/server/sidecar/external-call.js";
import { addCallCardTools } from "../fixtures/connections/fake-mcp-tools.mjs";
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from "../helpers/fake-mcp-http-server.js";
import { removeTestDir } from "../helpers/server-route-test-support.js";

let root: string;
let ndxHome: string;
let fake: FakeMcpHttpServer;
let service: ConnectionService;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "sidecar-hints-"));
  ndxHome = mkdtempSync(join(tmpdir(), "sidecar-hints-home-"));
  fake = await startFakeMcpHttpServer({ extraTools: addCallCardTools });
});

afterEach(async () => {
  await service?.close();
  await fake.close();
  await removeTestDir(root);
  await removeTestDir(ndxHome);
});

describe("a field hint's read", () => {
  it("that runs past its limit leaves a plain field and the connection connected", async () => {
    service = new ConnectionService({
      projectDir: root,
      credentials: { ndxHome },
      warn: () => {},
      connections: [{
        id: "desk", label: "Desk", auth: "none", transport: "http", url: fake.url,
        fieldHints: {
          ownerId: { optionsFrom: { tool: "stall_owners", path: "" } },
          teamId: { optionsFrom: { tool: "find_teams", path: "data.teams" } },
        },
      }],
    });
    const tools = await service.listTools();
    const create = tools.find((t) => t.tool === "create_ticket")!;

    const call = await buildExternalCall(create, tools, service, undefined, { hintTimeoutMs: 200 });

    // The stalled hint is a plain field; the one that answered is still a picker.
    expect(call.options).toEqual({ teamId: [{ value: "t-a", label: "Alpha" }, { value: "t-b", label: "t-b" }] });
    expect(service.connection("desk")!.status).toEqual({ state: "connected" });
    // The same client still answers: nothing was dropped and reconnected.
    const before = fake.authorizations.length;
    expect(await service.callTool("desk", "read_item", { id: "7" })).toMatchObject({ content: [{ text: "item 7" }] });
    expect(fake.calls.at(-1)).toEqual({ name: "read_item", arguments: { id: "7" } });
    // One request for the call: no initialize handshake from a reconnect.
    expect(fake.authorizations.length - before).toBe(1);
  });
});

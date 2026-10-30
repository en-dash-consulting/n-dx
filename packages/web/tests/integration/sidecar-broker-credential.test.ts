/**
 * A Sidecar session's MCP config is readable by the session's own Read tool,
 * so it must not carry the dashboard's per-user token. It carries a
 * per-session broker credential, which the request gate accepts on that
 * session's `POST …/mcp` and nowhere else.
 *
 * Real request gate with a token, real routes, the real spawn flags and
 * config writer; only the vendor CLI is a scripted child that holds its turn
 * open and records the `--mcp-config` path it was given.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VendorSessionOptions } from "@n-dx/llm-client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { handleRequestSecurity } from "../../src/server/request-security.js";
import { createAnnouncingBroker, handleSidecarRoute, sidecarBrokerEndpoint } from "../../src/server/routes-sidecar.js";
import { isSidecarBrokerRequest } from "../../src/server/sidecar/broker-credential.js";
import { SidecarSessionRegistry, sidecarSessionConnect } from "../../src/server/sidecar/session-registry.js";
import type { ServerContext } from "../../src/server/types.js";
import { removeTestDir, startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";

const TOKEN = "dashboard-token-0123456789abcdef";

let root: string;
let server: RouteTestServer;
/** The `--mcp-config` path each spawn was given, by session prompt order. */
let configPaths: string[];

/** A Claude stand-in that names a session, reports "working" and holds the turn until killed. */
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
    stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "working" }] } }) + "\n");
  });
  stdin.resume();
  return child as unknown as ChildProcess;
};

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "sidecar-credential-"));
  configPaths = [];
  const dir = join(root, ".hench", "sidecar");
  const ctx: ServerContext = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  const connect = sidecarSessionConnect(dir, (id) => sidecarBrokerEndpoint(ctx, id));
  const registry = new SidecarSessionRegistry({ dir, connect: (record) => ({ ...connect(record), spawn: holdingSpawn }) });
  const broker = createAnnouncingBroker(dir, () => {});
  server = await startRouteTestServer((req, res) => {
    if (handleRequestSecurity(req, res, { token: TOKEN, scopedCredential: isSidecarBrokerRequest })) return true;
    return handleSidecarRoute(req, res, ctx, () => {}, { registryFor: () => registry, brokerFor: () => broker });
  });
  ctx.port = server.port;
});

afterEach(async () => {
  await server.close();
  await removeTestDir(root);
});

const auth = { "X-Ndx-Token": TOKEN };

async function runningSession(): Promise<{ id: string; headers: Record<string, string>; text: string }> {
  const created = await fetch(`${server.baseUrl}/api/sidecar/sessions`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ vendor: "claude", name: "s" }),
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()).session as { id: string };
  const turn = await fetch(`${server.baseUrl}/api/sidecar/sessions/${id}/turns`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "go" }),
  });
  expect(turn.status).toBe(202);
  const text = readFileSync(configPaths.at(-1)!, "utf-8");
  const headers = JSON.parse(text).mcpServers["ndx-sidecar"].headers as Record<string, string>;
  return { id, headers, text };
}

const listTools = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
const mcpHeaders = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

describe("a Sidecar session's broker credential", () => {
  it("replaces the dashboard token in the MCP config, and reaches the session's own broker", async () => {
    const { id, headers, text } = await runningSession();
    expect(text).not.toContain(TOKEN);
    expect(Object.keys(headers).map((h) => h.toLowerCase())).not.toContain("x-ndx-token");
    expect(headers["x-ndx-sidecar-key"]).toMatch(/^[\w-]{40,}$/);

    // Connected the way the vendor CLI connects: the config's URL and headers.
    const client = new Client({ name: "cli", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(
      new URL(`${server.baseUrl}/api/sidecar/sessions/${id}/mcp`),
      { requestInit: { headers } },
    ));
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await client.close();
  });

  it("is refused on every other route, method and session", async () => {
    const a = await runningSession();
    const b = await runningSession();
    const key = a.headers;
    const base = server.baseUrl;
    const refusals: Array<[string, string, string?]> = [
      ["GET", `/api/sidecar/sessions`],
      ["GET", `/api/sidecar/sessions/${a.id}`],
      ["GET", `/api/sidecar/sessions/${a.id}/mcp`],
      ["GET", `/api/sidecar/sessions/${a.id}/cards`],
      ["POST", `/api/sidecar/sessions/${a.id}/interrupt`],
      ["POST", `/api/sidecar/sessions/${a.id}/turns`, JSON.stringify({ prompt: "x" })],
      ["POST", `/api/sidecar/sessions/${b.id}/mcp`, listTools],
      ["POST", `/w/main/api/sidecar/sessions/${a.id}/mcp`, listTools],
      ["GET", `/api/sidecar/allow-list`],
      ["POST", `/api/rex/items`, "{}"],
    ];
    for (const [method, path, body] of refusals) {
      const res = await fetch(`${base}${path}`, { method, headers: { ...key, ...mcpHeaders }, ...(body && { body }) });
      expect(res.status, `${method} ${path}`).toBe(401);
    }

    // Each key opens its own session's broker only.
    const own = await fetch(`${base}/api/sidecar/sessions/${b.id}/mcp`, { method: "POST", headers: { ...b.headers, ...mcpHeaders }, body: listTools });
    expect(own.status).toBe(200);
    await own.text();

    for (const { id } of [a, b]) {
      await fetch(`${base}/api/sidecar/sessions/${id}/interrupt`, { method: "POST", headers: auth });
    }
  });
});

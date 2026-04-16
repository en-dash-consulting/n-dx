/**
 * Unit tests for MCP route handler: session lifecycle, HTTP protocol compliance,
 * and routing behaviour.
 *
 * Uses a minimal mock MCP server so this zone has no compile-time dependency on
 * real gateway modules (rex-gateway / domain-gateway). Full tool-call integration
 * is covered by the end-to-end test:
 *
 * @see tests/e2e/mcp-transport.test.js — full server lifecycle + real tool calls
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerContext } from "../../../src/server/types.js";
import { handleMcpRoute, closeAllMcpSessions, initMcpRoutes } from "../../../src/server/routes-mcp.js";

/** Minimal MCP server with a single no-op tool — enough to complete MCP init. */
function createMockMcpServer(): McpServer {
  const server = new McpServer({ name: "mock", version: "1.0.0" });
  server.tool("ping", {}, async () => ({
    content: [{ type: "text" as const, text: "pong" }],
  }));
  return server;
}

/** Start a test HTTP server that handles MCP routes + CORS. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Mirror the CORS setup from start.ts
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      if ((req.method || "GET") === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (await handleMcpRoute(req, res, ctx)) return;

      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("MCP routes", () => {
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    // Inject mock factories — no real files or gateway modules needed
    initMcpRoutes({
      rex: () => createMockMcpServer(),
      sv: () => createMockMcpServer(),
    });

    ctx = { projectDir: "/tmp/mock", svDir: "/tmp/mock/.sourcevision", rexDir: "/tmp/mock/.rex", dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeAllMcpSessions();
    server.close();
  });

  it("returns false for non-MCP paths", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/prd`);
    expect(res.status).toBe(404);
  });

  it("CORS preflight includes MCP-related headers", async () => {
    const res = await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("Mcp-Session-Id");
    expect(res.headers.get("access-control-expose-headers")).toContain("Mcp-Session-Id");
    expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
  });

  it("GET without session returns 400", async () => {
    const res = await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "GET",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("unsupported method returns 405", async () => {
    const res = await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(405);
  });

  it("MCP client can connect to /mcp/rex and list tools", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/rex`),
    );

    await client.connect(transport);

    const result = await client.listTools();
    expect(result.tools.map((t) => t.name)).toContain("ping");

    await client.close();
  });

  it("MCP client can connect to /mcp/sourcevision and list tools", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/sourcevision`),
    );

    await client.connect(transport);

    const result = await client.listTools();
    expect(result.tools.map((t) => t.name)).toContain("ping");

    await client.close();
  });

  it("multiple concurrent MCP sessions work independently", async () => {
    const client1 = new Client({ name: "client-1", version: "1.0.0" });
    const transport1 = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/rex`),
    );

    const client2 = new Client({ name: "client-2", version: "1.0.0" });
    const transport2 = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/rex`),
    );

    await Promise.all([client1.connect(transport1), client2.connect(transport2)]);

    const [result1, result2] = await Promise.all([
      client1.listTools(),
      client2.listTools(),
    ]);

    expect(result1.tools.length).toBe(result2.tools.length);
    expect(result1.tools.length).toBeGreaterThan(0);

    await Promise.all([client1.close(), client2.close()]);
  });
});

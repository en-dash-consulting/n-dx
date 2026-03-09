import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ServerContext } from "../../../src/server/types.js";
import { handleMcpRoute, closeAllMcpSessions } from "../../../src/server/routes-mcp.js";

/** Minimal PRD document fixture for rex. */
function makePRD() {
  return {
    schema: "rex/v1",
    title: "Test Project",
    items: [
      {
        id: "epic-1",
        title: "Epic One",
        status: "pending",
        level: "epic",
        priority: "high",
        children: [
          {
            id: "task-1",
            title: "First Task",
            status: "in_progress",
            level: "task",
            priority: "high",
          },
        ],
      },
    ],
  };
}

/** Minimal sourcevision manifest fixture. */
function makeManifest() {
  return {
    version: "0.1.0",
    analyzedAt: new Date().toISOString(),
    projectRoot: "/tmp/test",
    stats: { files: 0, imports: 0, zones: 0 },
  };
}

/** Start a test server that handles MCP routes + CORS. */
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
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mcp-routes-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(makePRD(), null, 2));
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(makeManifest(), null, 2));

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeAllMcpSessions();
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
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

  it("MCP client can connect to /mcp/rex and list tools", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/rex`),
    );

    await client.connect(transport);

    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("get_prd_status");
    expect(toolNames).toContain("get_next_task");
    expect(toolNames).toContain("update_task_status");
    expect(toolNames).toContain("add_item");

    await client.close();
  });

  it("MCP client can call rex tool get_prd_status", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/rex`),
    );

    await client.connect(transport);

    const result = await client.callTool({ name: "get_prd_status", arguments: {} });
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    const parsed = JSON.parse(text);
    expect(parsed.title).toBe("Test Project");

    await client.close();
  });

  it("MCP client can connect to /mcp/sourcevision and list tools", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/sourcevision`),
    );

    await client.connect(transport);

    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("get_overview");
    expect(toolNames).toContain("get_zone");
    expect(toolNames).toContain("search_files");

    await client.close();
  });

  it("MCP client can call sourcevision tool get_overview", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/sourcevision`),
    );

    await client.connect(transport);

    const result = await client.callTool({ name: "get_overview", arguments: {} });
    expect(result.content).toBeDefined();

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

    // Both clients should be able to list tools
    const [result1, result2] = await Promise.all([
      client1.listTools(),
      client2.listTools(),
    ]);

    expect(result1.tools.length).toBe(result2.tools.length);
    expect(result1.tools.length).toBeGreaterThan(0);

    await Promise.all([client1.close(), client2.close()]);
  });

  it("MCP client can call edit_item and see changes in get_prd_status", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/rex`),
    );

    await client.connect(transport);

    // Edit the task's title and priority
    const editResult = await client.callTool({
      name: "edit_item",
      arguments: {
        id: "task-1",
        title: "Updated Task Title",
        description: "A new description",
        priority: "critical",
        tags: ["urgent", "refactor"],
      },
    });
    expect(editResult.content).toBeDefined();
    expect(Array.isArray(editResult.content)).toBe(true);

    const editText = (editResult.content as Array<{ type: string; text: string }>)[0]?.text;
    const editParsed = JSON.parse(editText);
    expect(editParsed.id).toBe("task-1");
    expect(editParsed.updatedFields).toContain("title");
    expect(editParsed.updatedFields).toContain("description");
    expect(editParsed.updatedFields).toContain("priority");
    expect(editParsed.updatedFields).toContain("tags");
    expect(editParsed.item.title).toBe("Updated Task Title");
    expect(editParsed.item.description).toBe("A new description");
    expect(editParsed.item.priority).toBe("critical");
    expect(editParsed.item.tags).toEqual(["urgent", "refactor"]);

    // Verify changes are reflected in get_prd_status
    const statusResult = await client.callTool({ name: "get_prd_status", arguments: {} });
    const statusText = (statusResult.content as Array<{ type: string; text: string }>)[0]?.text;
    const statusParsed = JSON.parse(statusText);

    // The epic's child task should have the updated title
    const epic = statusParsed.epics.find((e: { id: string }) => e.id === "epic-1");
    expect(epic).toBeDefined();

    // Verify via get_item for full detail
    const getResult = await client.callTool({ name: "get_item", arguments: { id: "task-1" } });
    const getText = (getResult.content as Array<{ type: string; text: string }>)[0]?.text;
    const getParsed = JSON.parse(getText);
    expect(getParsed.item.title).toBe("Updated Task Title");
    expect(getParsed.item.description).toBe("A new description");
    expect(getParsed.item.priority).toBe("critical");
    expect(getParsed.item.tags).toEqual(["urgent", "refactor"]);

    await client.close();
  });

  it("edit_item returns error for non-existent item", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/rex`),
    );

    await client.connect(transport);

    const result = await client.callTool({
      name: "edit_item",
      arguments: { id: "non-existent", title: "Nope" },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("not found");
    expect(result.isError).toBe(true);

    await client.close();
  });

  it("edit_item returns error when no fields provided", async () => {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://localhost:${port}/mcp/rex`),
    );

    await client.connect(transport);

    const result = await client.callTool({
      name: "edit_item",
      arguments: { id: "task-1" },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(text).toContain("No fields to update");
    expect(result.isError).toBe(true);

    await client.close();
  });

  it("unsupported method returns 405", async () => {
    const res = await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(405);
  });
});

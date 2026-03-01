import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRexMcpServer, startMcpServer } from "../../../src/cli/mcp.js";
import { ensureRexDir } from "../../../src/store/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { SCHEMA_VERSION } from "../../../src/schema/v1.js";
import type { PRDDocument } from "../../../src/schema/v1.js";

const EXPECTED_TOOLS = [
  "get_prd_status",
  "get_next_task",
  "update_task_status",
  "add_item",
  "move_item",
  "merge_items",
  "get_item",
  "append_log",
  "sync_with_remote",
  "get_recommendations",
  "verify_criteria",
  "reorganize",
  "health",
  "facets",
  "get_capabilities",
];

const EXPECTED_RESOURCES = ["prd", "workflow", "log"];

describe("Rex MCP server factory", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-mcp-test-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);

    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "MCP Test",
      items: [],
    };
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(doc), "utf-8");
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Test Workflow", "utf-8");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("createRexMcpServer returns an McpServer without connecting a transport", async () => {
    const server = await createRexMcpServer(tmpDir);
    expect(server).toBeDefined();
    // Server should not be connected yet
    expect(server.isConnected()).toBe(false);
  });

  it("registers all expected tools", async () => {
    const server = await createRexMcpServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name).sort();

    expect(toolNames).toEqual([...EXPECTED_TOOLS].sort());

    await client.close();
    await server.close();
  });

  it("registers all expected resources", async () => {
    const server = await createRexMcpServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { resources } = await client.listResources();
    const resourceNames = resources.map((r) => r.name).sort();

    expect(resourceNames).toEqual([...EXPECTED_RESOURCES].sort());

    await client.close();
    await server.close();
  });

  it("tools work identically regardless of transport (via InMemoryTransport)", async () => {
    const server = await createRexMcpServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    // Call get_prd_status — should return document stats
    const result = await client.callTool({ name: "get_prd_status", arguments: {} });
    expect(result.isError).toBeFalsy();

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");

    const parsed = JSON.parse(content[0].text);
    expect(parsed.title).toBe("MCP Test");
    expect(parsed.overall).toBeDefined();

    await client.close();
    await server.close();
  });

  it("can connect multiple transports sequentially (stdio then HTTP pattern)", async () => {
    // First connection (simulating stdio)
    const server1 = await createRexMcpServer(tmpDir);
    const [ct1, st1] = InMemoryTransport.createLinkedPair();
    const client1 = new Client({ name: "stdio-client", version: "1.0.0" });
    await server1.connect(st1);
    await client1.connect(ct1);

    const result1 = await client1.callTool({ name: "get_prd_status", arguments: {} });
    const content1 = result1.content as Array<{ type: string; text: string }>;
    const parsed1 = JSON.parse(content1[0].text);

    await client1.close();
    await server1.close();

    // Second connection (simulating HTTP)
    const server2 = await createRexMcpServer(tmpDir);
    const [ct2, st2] = InMemoryTransport.createLinkedPair();
    const client2 = new Client({ name: "http-client", version: "1.0.0" });
    await server2.connect(st2);
    await client2.connect(ct2);

    const result2 = await client2.callTool({ name: "get_prd_status", arguments: {} });
    const content2 = result2.content as Array<{ type: string; text: string }>;
    const parsed2 = JSON.parse(content2[0].text);

    // Same data regardless of transport
    expect(parsed2.title).toBe(parsed1.title);
    expect(parsed2.overall).toEqual(parsed1.overall);

    await client2.close();
    await server2.close();
  });

  it("startMcpServer is exported for backward compatibility", () => {
    // startMcpServer should be a function (we can't fully test stdio without a process)
    expect(typeof startMcpServer).toBe("function");
  });

  it("factory is re-exported from public API", async () => {
    const publicApi = await import("../../../src/public.js");
    expect(typeof publicApi.createRexMcpServer).toBe("function");
  });
});

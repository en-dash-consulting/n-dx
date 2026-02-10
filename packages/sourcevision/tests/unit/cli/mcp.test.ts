import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createSourcevisionMcpServer, startMcpServer } from "../../../src/cli/mcp.js";
import { DATA_FILES } from "../../../src/schema/data-files.js";

const EXPECTED_TOOLS = [
  "get_overview",
  "get_zone",
  "get_file_info",
  "get_imports",
  "get_route_tree",
  "search_files",
  "get_findings",
  "get_next_steps",
];

const EXPECTED_RESOURCES = ["summary", "zones", "routes"];

/** Minimal manifest for testing. */
function minimalManifest() {
  return {
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    targetPath: "/tmp/test-project",
    svDir: "/tmp/test-project/.sourcevision",
    gitBranch: "main",
    gitSha: "abc1234567890",
    phases: [],
    enrichment: {},
    tokenUsage: {},
  };
}

/** Minimal inventory for testing. */
function minimalInventory() {
  return {
    version: "0.1.0",
    summary: {
      totalFiles: 2,
      totalLines: 100,
      byLanguage: { TypeScript: 2 },
      byRole: { source: 2 },
    },
    files: [
      { path: "src/index.ts", language: "TypeScript", role: "source", lines: 50 },
      { path: "src/utils.ts", language: "TypeScript", role: "source", lines: 50 },
    ],
  };
}

describe("Sourcevision MCP server factory", () => {
  let tmpDir: string;
  let svDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-mcp-test-"));
    svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });

    // Write minimal analysis data
    await writeFile(join(svDir, DATA_FILES.manifest), JSON.stringify(minimalManifest()), "utf-8");
    await writeFile(join(svDir, DATA_FILES.inventory), JSON.stringify(minimalInventory()), "utf-8");
    await writeFile(join(svDir, DATA_FILES.imports), JSON.stringify({
      version: "0.1.0",
      summary: { totalEdges: 1, totalExternal: 0, circularCount: 0, circulars: [] },
      edges: [{ from: "src/index.ts", to: "src/utils.ts", specifiers: ["*"] }],
    }), "utf-8");
    await writeFile(join(svDir, DATA_FILES.zones), JSON.stringify({
      version: "0.1.0",
      zones: [],
      crossings: [],
      unzoned: [],
      findings: [],
    }), "utf-8");
    await writeFile(join(svDir, DATA_FILES.components), JSON.stringify({
      version: "0.1.0",
      summary: { totalComponents: 0, totalRouteModules: 0, routeConventions: [] },
      components: [],
      routeModules: [],
      routeTree: [],
    }), "utf-8");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("createSourcevisionMcpServer returns an McpServer without connecting a transport", () => {
    const server = createSourcevisionMcpServer(tmpDir);
    expect(server).toBeDefined();
    expect(server.isConnected()).toBe(false);
  });

  it("registers all expected tools", async () => {
    const server = createSourcevisionMcpServer(tmpDir);
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
    const server = createSourcevisionMcpServer(tmpDir);
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
    const server = createSourcevisionMcpServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    // Call get_overview — should return project summary
    const result = await client.callTool({ name: "get_overview", arguments: {} });
    expect(result.isError).toBeFalsy();

    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");

    const parsed = JSON.parse(content[0].text);
    expect(parsed.project).toBe("test-project");
    expect(parsed.files).toBe(2);
    expect(parsed.lines).toBe(100);

    await client.close();
    await server.close();
  });

  it("can connect multiple transports sequentially (stdio then HTTP pattern)", async () => {
    // First connection (simulating stdio)
    const server1 = createSourcevisionMcpServer(tmpDir);
    const [ct1, st1] = InMemoryTransport.createLinkedPair();
    const client1 = new Client({ name: "stdio-client", version: "1.0.0" });
    await server1.connect(st1);
    await client1.connect(ct1);

    const result1 = await client1.callTool({ name: "get_overview", arguments: {} });
    const content1 = result1.content as Array<{ type: string; text: string }>;
    const parsed1 = JSON.parse(content1[0].text);

    await client1.close();
    await server1.close();

    // Second connection (simulating HTTP)
    const server2 = createSourcevisionMcpServer(tmpDir);
    const [ct2, st2] = InMemoryTransport.createLinkedPair();
    const client2 = new Client({ name: "http-client", version: "1.0.0" });
    await server2.connect(st2);
    await client2.connect(ct2);

    const result2 = await client2.callTool({ name: "get_overview", arguments: {} });
    const content2 = result2.content as Array<{ type: string; text: string }>;
    const parsed2 = JSON.parse(content2[0].text);

    // Same data regardless of transport
    expect(parsed2.project).toBe(parsed1.project);
    expect(parsed2.files).toBe(parsed1.files);

    await client2.close();
    await server2.close();
  });

  it("startMcpServer is exported for backward compatibility", () => {
    expect(typeof startMcpServer).toBe("function");
  });

  it("factory is re-exported from public API", async () => {
    const publicApi = await import("../../../src/public.js");
    expect(typeof publicApi.createSourcevisionMcpServer).toBe("function");
  });
});

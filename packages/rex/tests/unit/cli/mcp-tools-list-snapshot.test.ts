/**
 * Pins the rex MCP `tools/list` response.
 *
 * The tool surface is a published contract: assistants read these names,
 * descriptions and input schemas to decide what to call and with what. A
 * refactor that moves handlers between modules must not move a byte of it,
 * and a reworded description is a deliberate API change that should show up
 * as a snapshot diff rather than slip through.
 *
 * The snapshot was generated from the single-file `mcp-tools.ts` that
 * preceded the per-tool modules under `cli/mcp-tools/`, so it is the
 * before/after evidence for that split (roadmap PR 2).
 *
 * Registration order is captured too, not just the set of names: the SDK
 * returns tools in the order they were registered, so an accidental reorder
 * inside the registry is a visible change to the response.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRexMcpServer } from "../../../src/cli/mcp.js";
import { REX_MCP_TOOLS } from "../../../src/cli/mcp-tools/registry.js";
import { ensureRexDir } from "../../../src/store/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { SCHEMA_VERSION } from "../../../src/schema/v1.js";

describe("rex MCP tools/list contract", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-mcp-toolslist-"));
    const rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);
    await writeFile(
      join(rexDir, "prd.md"),
      `---\nschema: ${SCHEMA_VERSION}\ntitle: Tools List\nitems: []\n---\n\n# Tools List\n`,
      "utf-8",
    );
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

  it("returns an unchanged tool surface", async () => {
    const server = await createRexMcpServer(tmpDir);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const { tools } = await client.listTools();
      // Serialize rather than snapshot the objects directly: this pins field
      // order inside each input schema as well as the order of the tools.
      expect(JSON.stringify(tools, null, 2)).toMatchSnapshot();
    } finally {
      await client.close();
      await server.close();
    }
  });

  /**
   * With the tools split across modules, a new `mcp-tools/<tool>.ts` that
   * nobody added to `registry.ts` compiles, exports a valid definition and is
   * never served — the tool simply does not exist, with nothing to notice it.
   * Registration used to be the same edit as writing the handler; this is what
   * replaces that guarantee.
   */
  it("registers every tool module, named after its file", () => {
    const toolsDir = join(dirname(fileURLToPath(import.meta.url)), "../../../src/cli/mcp-tools");
    /** Shared infrastructure rather than a tool. */
    const support = new Set(["index.ts", "registry.ts", "tool.ts", "result.ts", "claims.ts"]);

    const fromFiles = readdirSync(toolsDir)
      .filter((f) => f.endsWith(".ts") && !support.has(f))
      .map((f) => f.slice(0, -".ts".length).replace(/-/g, "_"))
      .sort();
    const registered = REX_MCP_TOOLS.map((t) => t.name).sort();

    expect(fromFiles).toEqual(registered);
  });
});

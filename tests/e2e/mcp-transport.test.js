/**
 * MCP HTTP transport contract test — validates that MCP endpoints
 * work end-to-end through the web server.
 *
 * Complements the unit-level routes-mcp.test.ts (which tests the
 * handler in isolation) by verifying the full server lifecycle:
 * start → MCP session → tool call → shutdown.
 *
 * Uses raw fetch with JSON-RPC payloads to avoid SDK version coupling.
 *
 * @see packages/web/tests/unit/server/routes-mcp.test.ts — unit-level MCP tests
 * @see tests/e2e/cli-start.test.js — server lifecycle tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
  mcpJsonRpc as jsonRpc,
} from "./e2e-helpers.js";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");
/** A small v2 tree (product/ + changes/): one area, one capability, change CH-1 amending it. */
const V2_FIXTURE = join(import.meta.dirname, "../../packages/rex/tests/fixtures/v2-tree");
const LOOPBACK_HOST = "127.0.0.1";
/** Mirrors PORT_FILE in packages/web/src/server/start.ts. */
const PORT_FILE = ".n-dx-web.port";

function isListenPermissionError(error) {
  return Boolean(error && typeof error === "object" && error.code === "EPERM");
}

/**
 * Wait for the spawned server and return the port it actually bound.
 *
 * The requested port is only a hint: it is probed free, then released before
 * the server starts, so under a parallel run another suite's server can take
 * it. `ndx start` then falls forward to the next free port and records it in
 * the port file. Polling the requested port instead would reach that other
 * (auth-enforcing) server and fail every request with 401.
 */
async function waitForServer(dir, child, getStderr, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited (${child.exitCode}) before listening:\n${getStderr()}`);
    }
    try {
      // Written by our server after it binds, into our own tmp dir — so the
      // port it names is ours. The fetch only confirms it is accepting.
      const port = Number((await readFile(join(dir, PORT_FILE), "utf-8")).trim());
      await fetch(`http://localhost:${port}/`);
      return port;
    } catch {
      // Port file not written yet, or server not accepting yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms:\n${getStderr()}`);
}

describe("MCP HTTP transport (e2e)", { timeout: 120_000 }, () => {
  let tmpDir;
  let port;
  let serverProcess;
  let canBindPorts = true;

  beforeAll(async () => {
    tmpDir = await createTmpDir("ndx-mcp-e2e-");
    await setupRexDir(tmpDir);
    // product/ makes the rex MCP tools read the v2 tree; the v1 store files stay for the server.
    await cp(V2_FIXTURE, join(tmpDir, ".rex"), { recursive: true });
    await setupSourcevisionDir(tmpDir);

    // Find an available port
    const { createServer } = await import("node:net");
    try {
      port = await new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, () => {
          const p = srv.address().port;
          srv.close(() => resolve(p));
        });
        srv.on("error", reject);
      });
    } catch (error) {
      if (isListenPermissionError(error)) {
        canBindPorts = false;
        return;
      }
      throw error;
    }

    // Start the server in the foreground (as a child process)
    // `--here`: this suite drives the single-project server's own MCP
    // endpoints. The hub-proxied ones are covered by mcp-transport-hub.test.js.
    serverProcess = spawn("node", [CLI_PATH, "start", "--here", "--no-auth", "--port=" + port, tmpDir], {
      stdio: "pipe",
      env: { ...process.env },
    });

    let stderr = "";
    serverProcess.stderr.on("data", (chunk) => { stderr += chunk; });

    port = await waitForServer(tmpDir, serverProcess, () => stderr);
  }, 15000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      // Wait for process to exit
      await new Promise((resolve) => {
        serverProcess.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
    await removeTmpDir(tmpDir);
  });

  it("initializes an MCP session on /mcp/rex", async () => {
    if (!canBindPorts) return;
    const result = await jsonRpc(
      `http://localhost:${port}/mcp/rex`,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "1.0.0" },
      },
    );

    expect(result.status).toBe(200);
    expect(result.sessionId).toBeTruthy();
    expect(result.body.result).toBeDefined();
    expect(result.body.result.protocolVersion).toBeDefined();
    expect(result.body.result.serverInfo).toBeDefined();
  });

  it("lists tools on /mcp/rex with session reuse", async () => {
    if (!canBindPorts) return;
    // Step 1: Initialize to get a session ID
    const init = await jsonRpc(
      `http://localhost:${port}/mcp/rex`,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "1.0.0" },
      },
    );
    const sessionId = init.sessionId;
    expect(sessionId).toBeTruthy();

    // Step 2: Send initialized notification (required by MCP protocol)
    await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    // Step 3: List tools using the session
    const result = await jsonRpc(
      `http://localhost:${port}/mcp/rex`,
      "tools/list",
      {},
      sessionId,
    );

    expect(result.status).toBe(200);
    const toolNames = result.body.result.tools.map((t) => t.name);
    expect(toolNames).toContain("get_prd_status");
    expect(toolNames).toContain("get_next_task");
    expect(toolNames).toContain("add_item");
  });

  it("calls the product-layer tools on /mcp/rex against a v2 tree", async () => {
    if (!canBindPorts) return;
    const url = `http://localhost:${port}/mcp/rex`;
    const init = await jsonRpc(url, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e-test", version: "1.0.0" },
    });
    const sessionId = init.sessionId;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", "Mcp-Session-Id": sessionId },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    const call = async (name, args = {}) => {
      const res = await jsonRpc(url, "tools/call", { name, arguments: args }, sessionId);
      expect(res.status).toBe(200);
      const { content, isError } = res.body.result;
      expect(isError, `${name}: ${content[0].text}`).toBeFalsy();
      return JSON.parse(content[0].text);
    };

    const status = await call("get_prd_status");
    expect(status).toMatchObject({ layout: "v2", areas: [{ displayId: "A1", openChanges: 1 }], releases: [{ release: "1.2.0" }] });

    const product = await call("get_product");
    expect(product.areas[0].children[0]).toMatchObject({ displayId: "A1.1", status: "changing" });

    const capability = await call("get_capability", { id: "A1.1" });
    expect(capability.changes).toEqual([expect.objectContaining({ displayId: "CH-1", relation: "amends" })]);

    const { id } = await call("add_item", { title: "Tidy the card form" });
    const placed = await call("place_change", { id, target: "A1.1", relation: "touches" });
    expect(placed).toEqual({ change: id, target: capability.node.id, relation: "touches" });

    const applied = await call("apply_change", { id: "CH-1" });
    expect(applied.applied).toEqual([expect.objectContaining({ delta: "modified", nodeId: capability.node.id })]);
  });

  it("initializes an MCP session on /mcp/sourcevision", async () => {
    if (!canBindPorts) return;
    const result = await jsonRpc(
      `http://localhost:${port}/mcp/sourcevision`,
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "1.0.0" },
      },
    );

    expect(result.status).toBe(200);
    expect(result.sessionId).toBeTruthy();
    expect(result.body.result).toBeDefined();
  });

  it("GET without session returns 400", async () => {
    if (!canBindPorts) return;
    const res = await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "GET",
    });
    expect(res.status).toBe(400);
  });

  it("PUT returns 405", async () => {
    if (!canBindPorts) return;
    const res = await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(405);
  });
});

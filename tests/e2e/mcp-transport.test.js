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
import { join } from "node:path";
import {
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

/**
 * Wait for the server to accept connections on the given port.
 * Polls with fetch every 200ms, up to the timeout.
 */
async function waitForServer(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/api/health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

/**
 * Send a JSON-RPC 2.0 request to the MCP endpoint.
 *
 * The Streamable HTTP transport requires:
 * - Content-Type: application/json
 * - Accept: application/json, text/event-stream
 */
async function jsonRpc(url, method, params = {}, sessionId = null) {
  const headers = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  // MCP responses may come as SSE or JSON depending on the transport.
  // Parse accordingly based on content-type.
  const contentType = res.headers.get("content-type") || "";
  let body;
  if (contentType.includes("text/event-stream")) {
    // Parse SSE: extract JSON from "data:" lines
    const text = await res.text();
    const dataLines = text.split("\n").filter((l) => l.startsWith("data: "));
    const lastData = dataLines[dataLines.length - 1];
    body = lastData ? JSON.parse(lastData.slice(6)) : {};
  } else {
    body = await res.json();
  }

  return {
    status: res.status,
    sessionId: res.headers.get("mcp-session-id"),
    body,
  };
}

describe("MCP HTTP transport (e2e)", () => {
  let tmpDir;
  let port;
  let serverProcess;

  beforeAll(async () => {
    tmpDir = await createTmpDir("ndx-mcp-e2e-");
    await setupRexDir(tmpDir);
    await setupSourcevisionDir(tmpDir);

    // Find an available port
    const { createServer } = await import("node:net");
    port = await new Promise((resolve, reject) => {
      const srv = createServer();
      srv.listen(0, () => {
        const p = srv.address().port;
        srv.close(() => resolve(p));
      });
      srv.on("error", reject);
    });

    // Start the server in the foreground (as a child process)
    serverProcess = spawn("node", [CLI_PATH, "start", "--port=" + port, tmpDir], {
      stdio: "pipe",
      env: { ...process.env },
    });

    // Capture stderr for debugging if needed
    let stderr = "";
    serverProcess.stderr.on("data", (chunk) => { stderr += chunk; });

    await waitForServer(port);
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

  it("initializes an MCP session on /mcp/sourcevision", async () => {
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
    const res = await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "GET",
    });
    expect(res.status).toBe(400);
  });

  it("PUT returns 405", async () => {
    const res = await fetch(`http://localhost:${port}/mcp/rex`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(405);
  });
});

/**
 * The MCP Streamable-HTTP transport contract, as reusable assertions.
 *
 * Extracted from mcp-transport.test.js so the identical contract can be
 * exercised against different servings of the same endpoints: the direct
 * server at /mcp/*, the hub's per-project prefix at /p/<id>/mcp/*, and the
 * hub's sole-project root alias. A contract that only ran against the direct
 * server would let the proxy silently drop the pieces MCP depends on —
 * the Mcp-Session-Id response header, SSE bodies, DELETE for session close.
 *
 * Not a test file itself — imported and invoked inside a describe().
 *
 * @see tests/e2e/mcp-transport.test.js — direct server
 * @see tests/e2e/hub-mcp-transport.test.js — through the hub
 */

import { it, expect } from "vitest";

/**
 * Send a JSON-RPC 2.0 request to the MCP endpoint.
 *
 * The Streamable HTTP transport requires:
 * - Content-Type: application/json
 * - Accept: application/json, text/event-stream
 */
export async function jsonRpc(url, method, params = {}, sessionId = null) {
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

/** Initialize params every contract call uses. */
export const INIT_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "e2e-test", version: "1.0.0" },
};

/**
 * Initialize a session and send the required initialized notification.
 * Returns the session id.
 */
export async function initializeMcpSession(mcpUrl) {
  const init = await jsonRpc(mcpUrl, "initialize", INIT_PARAMS);
  expect(init.status).toBe(200);
  expect(init.sessionId).toBeTruthy();

  await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      "Mcp-Session-Id": init.sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  return init.sessionId;
}

/**
 * Register the transport contract tests against a base URL.
 *
 * @param {() => string} getBaseUrl Base URL without the /mcp/* suffix — e.g.
 *   `http://localhost:4123` or `http://127.0.0.1:3117/p/alpha`. A thunk
 *   because the port is only known after the suite's beforeAll ran.
 * @param {() => boolean} [isEnabled] Environment gate (port-binding
 *   permission); a test body that returns early counts as passed, matching
 *   the pre-extraction behaviour.
 */
export function registerMcpTransportContract(getBaseUrl, isEnabled = () => true) {
  it("initializes an MCP session on /mcp/rex", async () => {
    if (!isEnabled()) return;
    const result = await jsonRpc(`${getBaseUrl()}/mcp/rex`, "initialize", INIT_PARAMS);

    expect(result.status).toBe(200);
    expect(result.sessionId).toBeTruthy();
    expect(result.body.result).toBeDefined();
    expect(result.body.result.protocolVersion).toBeDefined();
    expect(result.body.result.serverInfo).toBeDefined();
  });

  it("lists tools on /mcp/rex with session reuse", async () => {
    if (!isEnabled()) return;
    const sessionId = await initializeMcpSession(`${getBaseUrl()}/mcp/rex`);

    const result = await jsonRpc(`${getBaseUrl()}/mcp/rex`, "tools/list", {}, sessionId);

    expect(result.status).toBe(200);
    const toolNames = result.body.result.tools.map((t) => t.name);
    expect(toolNames).toContain("get_prd_status");
    expect(toolNames).toContain("get_next_task");
    expect(toolNames).toContain("add_item");
  });

  it("initializes an MCP session on /mcp/sourcevision", async () => {
    if (!isEnabled()) return;
    const result = await jsonRpc(`${getBaseUrl()}/mcp/sourcevision`, "initialize", INIT_PARAMS);

    expect(result.status).toBe(200);
    expect(result.sessionId).toBeTruthy();
    expect(result.body.result).toBeDefined();
  });

  it("GET without session returns 400", async () => {
    if (!isEnabled()) return;
    const res = await fetch(`${getBaseUrl()}/mcp/rex`, { method: "GET" });
    expect(res.status).toBe(400);
  });

  it("PUT returns 405", async () => {
    if (!isEnabled()) return;
    const res = await fetch(`${getBaseUrl()}/mcp/rex`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(405);
  });

  it("DELETE closes the session", async () => {
    if (!isEnabled()) return;
    const sessionId = await initializeMcpSession(`${getBaseUrl()}/mcp/rex`);

    const del = await fetch(`${getBaseUrl()}/mcp/rex`, {
      method: "DELETE",
      headers: { "Mcp-Session-Id": sessionId },
    });
    expect(del.status).toBeLessThan(300);

    // The closed session is gone: reusing it is a client error, not a 200.
    const after = await jsonRpc(`${getBaseUrl()}/mcp/rex`, "tools/list", {}, sessionId);
    expect(after.status).toBeGreaterThanOrEqual(400);
  });
}

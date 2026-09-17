/**
 * MCP HTTP transport through the hub — the per-project endpoints
 * `/p/<id>/mcp/rex` and `/p/<id>/mcp/sourcevision`, and the root alias.
 *
 * Same protocol assertions as mcp-transport.test.js, addressed through the
 * hub's reverse proxy instead of the project server directly. Session
 * handling stays in the project server (routes-mcp.ts); what this proves is
 * that the proxy carries everything the Streamable HTTP transport needs:
 * the Mcp-Session-Id header both ways, SSE response bodies, GET streams and
 * DELETE for session close — and that two registered projects have
 * independent sessions writing to their own trees.
 *
 * @see tests/e2e/mcp-transport.test.js — the same contract against `ndx start`
 * @see packages/web/src/hub/proxy.ts — the proxy under test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
  mcpJsonRpc as jsonRpc,
} from "./e2e-helpers.js";

const WEB_CLI = join(import.meta.dirname, "../../packages/web/dist/cli/index.js");

const INIT_PARAMS = {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "e2e-hub-test", version: "1.0.0" },
};

async function freePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} did not answer within ${timeoutMs}ms`);
}

/** Initialize + notifications/initialized; returns the session id. */
async function openSession(base) {
  const init = await jsonRpc(`${base}/mcp/rex`, "initialize", INIT_PARAMS);
  expect(init.status).toBe(200);
  expect(init.sessionId).toBeTruthy();
  await fetch(`${base}/mcp/rex`, {
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

function prdTreeSlugs(dir) {
  const tree = join(dir, ".rex", "prd_tree");
  return existsSync(tree) ? readdirSync(tree).filter((n) => !n.startsWith(".")) : [];
}

describe("MCP HTTP transport through the hub (e2e)", { timeout: 180_000 }, () => {
  let home;
  let repoA;
  let repoB;
  let hubPort;
  let hubProcess;
  let canBindPorts = true;
  let hubUrl;

  async function register(id, repoRoot) {
    const res = await fetch(`${hubUrl}/api/hub/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, repoRoot, ndxBin: WEB_CLI }),
    });
    const body = await res.json();
    expect([200, 201], JSON.stringify(body)).toContain(res.status);
    expect(body.project.status.state).toBe("healthy");
  }

  beforeAll(async () => {
    home = await createTmpDir("ndx-mcp-hub-home-");
    repoA = await createTmpDir("ndx-mcp-hub-a-");
    repoB = await createTmpDir("ndx-mcp-hub-b-");
    for (const dir of [repoA, repoB]) {
      await setupRexDir(dir);
      await setupSourcevisionDir(dir);
    }

    try {
      hubPort = await freePort();
    } catch (error) {
      if (error && error.code === "EPERM") {
        canBindPorts = false;
        return;
      }
      throw error;
    }
    hubUrl = `http://127.0.0.1:${hubPort}`;

    const { CLAUDECODE: _cc, ...env } = process.env;
    hubProcess = spawn(process.execPath, [WEB_CLI, "hub", `--port=${hubPort}`], {
      stdio: "pipe",
      env: { ...env, N_DX_HOME: home },
    });
    hubProcess.stdout.on("data", () => {});
    hubProcess.stderr.on("data", () => {});
    await waitFor(`${hubUrl}/api/hub/health`);

    // One project first: the root alias is only defined while exactly one is registered.
    await register("alpha", repoA);
  }, 60_000);

  afterAll(async () => {
    if (hubProcess) {
      hubProcess.kill("SIGTERM");
      await new Promise((resolve) => {
        hubProcess.on("exit", resolve);
        setTimeout(resolve, 10_000);
      });
    }
    for (const dir of [home, repoA, repoB]) {
      if (dir) await removeTmpDir(dir);
    }
  });

  it("initializes rex and sourcevision sessions on /p/<id>/mcp/*", async () => {
    if (!canBindPorts) return;
    const rex = await jsonRpc(`${hubUrl}/p/alpha/mcp/rex`, "initialize", INIT_PARAMS);
    expect(rex.status).toBe(200);
    expect(rex.sessionId).toBeTruthy();
    expect(rex.body.result.serverInfo).toBeDefined();

    const sv = await jsonRpc(`${hubUrl}/p/alpha/mcp/sourcevision`, "initialize", INIT_PARAMS);
    expect(sv.status).toBe(200);
    expect(sv.sessionId).toBeTruthy();
  });

  it("reuses a session for tools/list through the prefix", async () => {
    if (!canBindPorts) return;
    const sessionId = await openSession(`${hubUrl}/p/alpha`);
    const result = await jsonRpc(`${hubUrl}/p/alpha/mcp/rex`, "tools/list", {}, sessionId);
    expect(result.status).toBe(200);
    const toolNames = result.body.result.tools.map((t) => t.name);
    expect(toolNames).toContain("get_prd_status");
    expect(toolNames).toContain("add_item");
  });

  it("aliases the root /mcp/* to the sole project", async () => {
    if (!canBindPorts) return;
    const sessionId = await openSession(hubUrl);
    const result = await jsonRpc(`${hubUrl}/mcp/rex`, "tools/list", {}, sessionId);
    expect(result.status).toBe(200);
    expect(result.body.result.tools.map((t) => t.name)).toContain("get_next_task");

    const sv = await jsonRpc(`${hubUrl}/mcp/sourcevision`, "initialize", INIT_PARAMS);
    expect(sv.status).toBe(200);
  });

  it("carries the transport's error statuses: GET without session 400, PUT 405", async () => {
    if (!canBindPorts) return;
    expect((await fetch(`${hubUrl}/p/alpha/mcp/rex`, { method: "GET" })).status).toBe(400);
    const put = await fetch(`${hubUrl}/p/alpha/mcp/rex`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(put.status).toBe(405);
  });

  it("streams the SSE GET channel and closes a session with DELETE", async () => {
    if (!canBindPorts) return;
    const sessionId = await openSession(`${hubUrl}/p/alpha`);

    // GET with a session opens the server→client event stream; read the
    // headers and drop the connection — the stream is long-lived by design.
    const controller = new AbortController();
    const stream = await fetch(`${hubUrl}/p/alpha/mcp/rex`, {
      method: "GET",
      headers: { "Accept": "text/event-stream", "Mcp-Session-Id": sessionId },
      signal: controller.signal,
    });
    expect(stream.status).toBe(200);
    expect(stream.headers.get("content-type") || "").toContain("text/event-stream");
    controller.abort();

    const del = await fetch(`${hubUrl}/p/alpha/mcp/rex`, {
      method: "DELETE",
      headers: { "Mcp-Session-Id": sessionId },
    });
    expect([200, 204]).toContain(del.status);

    // The session is gone: the server refuses it rather than answering.
    const after = await jsonRpc(`${hubUrl}/p/alpha/mcp/rex`, "tools/list", {}, sessionId);
    expect(after.status).not.toBe(200);
  });

  it("two projects have independent sessions and a tool call writes only to its own tree", async () => {
    if (!canBindPorts) return;
    await register("beta", repoB);

    // Root alias is no longer defined.
    const root = await fetch(`${hubUrl}/mcp/rex`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(root.status).toBe(409);
    expect((await root.json()).projects).toEqual(["alpha", "beta"]);

    const sessionA = await openSession(`${hubUrl}/p/alpha`);
    const sessionB = await openSession(`${hubUrl}/p/beta`);
    expect(sessionA).not.toBe(sessionB);

    // A's session means nothing to B's server.
    const crossed = await jsonRpc(`${hubUrl}/p/beta/mcp/rex`, "tools/list", {}, sessionA);
    expect(crossed.status).not.toBe(200);

    const slugsBefore = { a: prdTreeSlugs(repoA), b: prdTreeSlugs(repoB) };
    const added = await jsonRpc(`${hubUrl}/p/alpha/mcp/rex`, "tools/call", {
      name: "add_item",
      arguments: { title: "Hub epic written through project A", level: "epic", priority: "low" },
    }, sessionA);
    expect(added.status).toBe(200);
    expect(added.body.result?.isError, JSON.stringify(added.body)).not.toBe(true);

    const slugsAfter = { a: prdTreeSlugs(repoA), b: prdTreeSlugs(repoB) };
    const newInA = slugsAfter.a.filter((s) => !slugsBefore.a.includes(s));
    expect(newInA.some((s) => s.includes("hub-epic"))).toBe(true);
    expect(slugsAfter.b.filter((s) => !slugsBefore.b.includes(s))).toEqual([]);
    expect(slugsAfter.b.some((s) => s.includes("hub-epic"))).toBe(false);
  });
});

/**
 * MCP through the hub — /p/<id>/mcp/* and the sole-project root alias.
 *
 * Boots the real hub daemon (`web hub`) with real `web serve` children and
 * runs the same transport contract as mcp-transport.test.js at both
 * addresses, so the proxy cannot silently drop what MCP depends on: the
 * Mcp-Session-Id response header, SSE bodies, DELETE for session close.
 * Session handling itself stays in the child (routes-mcp.ts) — the hub only
 * forwards.
 *
 * Then the multi-project half of the PR 8 acceptance: two registered
 * projects expose independent MCP sessions, and an add_item tool call on
 * /p/A/mcp/rex writes to A's folder tree only.
 *
 * @see tests/e2e/mcp-transport-contract.js — the shared contract
 * @see packages/web/tests/integration/hub-proxy.test.ts — proxy mechanics with stub children
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";
import {
  jsonRpc,
  initializeMcpSession,
  registerMcpTransportContract,
} from "./mcp-transport-contract.js";

const WEB_CLI = join(import.meta.dirname, "../../packages/web/dist/cli/index.js");
const LOOPBACK = "127.0.0.1";

function isListenPermissionError(error) {
  return Boolean(error && typeof error === "object" && error.code === "EPERM");
}

async function waitFor(cond, what, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("MCP through the hub (e2e)", { timeout: 180_000 }, () => {
  let baseDir;
  let projectA;
  let projectB;
  let hubDir;
  let hubPort;
  let hubProcess;
  let canBindPorts = true;

  const hubUrl = (path) => `http://${LOOPBACK}:${hubPort}${path}`;

  async function registerProject(id, repoRoot) {
    const res = await fetch(hubUrl("/api/hub/projects"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, repoRoot, ndxBin: WEB_CLI }),
    });
    expect(res.status, await res.clone().text()).toBe(201);
  }

  beforeAll(async () => {
    baseDir = await createTmpDir("ndx-hub-mcp-e2e-");
    hubDir = join(baseDir, "hub-state");
    projectA = join(baseDir, "project-a");
    projectB = join(baseDir, "project-b");
    for (const dir of [projectA, projectB]) {
      await setupRexDir(dir, { project: dir.endsWith("a") ? "Project A" : "Project B" });
      await setupSourcevisionDir(dir);
    }

    const { createServer } = await import("node:net");
    try {
      hubPort = await new Promise((resolve, reject) => {
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

    hubProcess = spawn(
      "node",
      [WEB_CLI, "hub", `--port=${hubPort}`, `--hub-dir=${hubDir}`],
      { stdio: "pipe", env: { ...process.env } },
    );

    await waitFor(async () => {
      try {
        const res = await fetch(hubUrl("/api/hub/health"));
        return res.status === 200;
      } catch {
        return false;
      }
    }, "hub to answer /api/hub/health");

    // Register project A only — the root-alias contract below relies on the
    // hub having exactly one project until the isolation tests add B.
    await registerProject("alpha", projectA);
  }, 60_000);

  afterAll(async () => {
    // Unregister through the API first so the hub stops its children — a
    // plain kill of the spawned hub would orphan them on Windows, where
    // process signals do not cascade.
    if (hubProcess && canBindPorts) {
      for (const id of ["alpha", "beta"]) {
        await fetch(hubUrl(`/api/hub/projects/${id}`), { method: "DELETE" }).catch(() => {});
      }
    }
    if (hubProcess) {
      if (process.platform === "win32" && hubProcess.pid) {
        try {
          execFileSync("taskkill", ["/T", "/F", "/PID", String(hubProcess.pid)], { stdio: "ignore" });
        } catch {
          // already gone
        }
      } else {
        hubProcess.kill("SIGTERM");
      }
      await new Promise((resolve) => {
        hubProcess.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
    await removeTmpDir(baseDir);
  });

  describe("transport contract at /p/<id>/mcp/*", () => {
    registerMcpTransportContract(
      () => hubUrl("/p/alpha"),
      () => canBindPorts,
    );
  });

  describe("transport contract at the sole-project root alias", () => {
    registerMcpTransportContract(
      () => hubUrl(""),
      () => canBindPorts,
    );
  });

  describe("two projects, independent sessions and trees", () => {
    it("a tool call on /p/alpha/mcp/rex writes to A's tree only", async () => {
      if (!canBindPorts) return;
      await registerProject("beta", projectB);

      const sessionA = await initializeMcpSession(hubUrl("/p/alpha/mcp/rex"));
      const call = await jsonRpc(
        hubUrl("/p/alpha/mcp/rex"),
        "tools/call",
        {
          name: "add_item",
          arguments: { level: "epic", title: "Epic Written Via Hub A" },
        },
        sessionA,
      );
      expect(call.status).toBe(200);
      expect(call.body.result?.isError, JSON.stringify(call.body)).not.toBe(true);

      // The write landed in A's folder tree…
      const treeA = join(projectA, ".rex", "prd_tree");
      await waitFor(
        async () =>
          existsSync(treeA) &&
          (await readdir(treeA)).some((d) => d.includes("epic-written-via-hub")),
        "A's tree to contain the new epic",
        10_000,
      );

      // …and nowhere near B's. B has no tree at all unless something wrote one.
      const treeB = join(projectB, ".rex", "prd_tree");
      if (existsSync(treeB)) {
        expect((await readdir(treeB)).some((d) => d.includes("epic-written-via-hub"))).toBe(false);
      }
    });

    it("A's session id is meaningless to B's server", async () => {
      if (!canBindPorts) return;
      const sessionA = await initializeMcpSession(hubUrl("/p/alpha/mcp/rex"));

      const crossed = await jsonRpc(hubUrl("/p/beta/mcp/rex"), "tools/list", {}, sessionA);
      expect(crossed.status).toBeGreaterThanOrEqual(400);

      // And B mints its own working session regardless.
      const sessionB = await initializeMcpSession(hubUrl("/p/beta/mcp/rex"));
      const list = await jsonRpc(hubUrl("/p/beta/mcp/rex"), "tools/list", {}, sessionB);
      expect(list.status).toBe(200);
      expect(sessionB).not.toBe(sessionA);
    });

    it("root MCP paths answer 409 once several projects are registered", async () => {
      if (!canBindPorts) return;
      const res = await fetch(hubUrl("/mcp/rex"), {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.projects.sort()).toEqual(["alpha", "beta"]);
    });
  });
});

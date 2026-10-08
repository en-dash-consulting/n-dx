import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startHub, registryPath } from "../../src/hub/index.js";
import type { HubHandle } from "../../src/hub/index.js";
import { countProjectExecutions } from "../../src/hub/admission.js";

/**
 * The hub's own calls to a project server, with auth on.
 *
 * Since #489 a project server answers 401 to any request without the per-user
 * token. The browser's requests carry it (the proxy forwards the cookie); the
 * hub's own calls — the queued-run replay, the pre-queue check, and the
 * in-flight count behind the session cap — must send it themselves. The
 * children here enforce the token the way the real server does, so a call
 * that leaves it off is refused 401 instead of being waved through.
 */

interface AuthChild {
  server: Server;
  port: number;
  dir: string;
  running: Set<string>;
  received: string[];
  checks: string[];
  /** Requests refused for a missing or wrong token, as "METHOD path". */
  refused: string[];
}

async function startAuthChild(dir: string, token: string): Promise<AuthChild> {
  const child = { dir, running: new Set<string>(), received: [] as string[], checks: [] as string[], refused: [] as string[] };
  const server = createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const json = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
      res.end(text);
    };
    if (req.headers["x-ndx-token"] !== token) {
      child.refused.push(`${req.method} ${url}`);
      return json(401, { error: "unauthorized" });
    }
    const readTaskId = (done: (taskId: string) => void): void => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => done((JSON.parse(body || "{}") as { taskId?: string }).taskId ?? ""));
    };
    if (url === "/api/status") return json(200, { projectDir: dir, hench: { activeRuns: child.running.size } });
    if (url === "/api/hench/execute/status") {
      return json(200, { executions: [...child.running].map((taskId) => ({ taskId, status: "running" })) });
    }
    if (url === "/api/hench/execute/check" && req.method === "POST") {
      readTaskId((taskId) => {
        child.checks.push(taskId);
        // A verdict the hub can only read if it was let in.
        json(200, taskId === "refused-task"
          ? { ok: false, status: 409, error: "Task is blocked.", taskId }
          : { ok: true });
      });
      return;
    }
    if (url === "/api/hench/execute" && req.method === "POST") {
      readTaskId((taskId) => {
        child.received.push(taskId);
        child.running.add(taskId);
        json(200, { runId: `run-${taskId}`, taskId });
      });
      return;
    }
    json(404, { error: "not found" });
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
  return { ...child, server, port };
}

describe("hub admission with auth on", () => {
  let home: string;
  let tokenFile: string;
  let token: string;
  let alpha: AuthChild;
  let beta: AuthChild;
  let hub: HubHandle | null = null;

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "hub-admission-auth-"));
    tokenFile = join(home, "auth.token");
    // The hub reads (and, if absent, creates) this file; creating it first
    // lets the children enforce the same value.
    token = "t".repeat(48);
    writeFileSync(tokenFile, token + "\n", { mode: 0o600 });
    alpha = await startAuthChild(mkdtempSync(join(tmpdir(), "hub-admission-auth-alpha-")), token);
    beta = await startAuthChild(mkdtempSync(join(tmpdir(), "hub-admission-auth-beta-")), token);
    const record = (id: string, c: AuthChild) => ({
      id, name: id, repoRoot: c.dir, worktrees: [c.dir], ndxBin: "/nonexistent/ndx",
      port: c.port, pid: process.pid, lastSeen: new Date().toISOString(),
    });
    writeFileSync(registryPath(home), JSON.stringify({
      version: 1,
      projects: { alpha: record("alpha", alpha), beta: record("beta", beta) },
    }));
    hub = await startHub({
      port: 0,
      homeDir: home,
      tokenFile,
      healthIntervalMs: 60_000,
      limits: { maxSessions: 1, memoryFloorBytes: 1_000 },
      freeMemory: () => 8 * 1024 ** 3,
      drainIntervalMs: 50,
    });
    expect(readFileSync(tokenFile, "utf-8").trim()).toBe(token);
  });

  afterEach(async () => {
    await hub?.close({ stopChildren: false });
    hub = null;
    for (const child of [alpha, beta]) {
      await new Promise<void>((resolve) => child.server.close(() => resolve()));
      rmSync(child.dir, { recursive: true, force: true });
    }
    rmSync(home, { recursive: true, force: true });
  });

  const execute = (path: string, taskId: string) =>
    fetch(`http://127.0.0.1:${hub!.port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ndx-Token": token },
      body: JSON.stringify({ taskId }),
    });

  it("counts a running execution, so the session cap holds", async () => {
    alpha.running.add("task-1");
    expect(await countProjectExecutions(alpha.port, token)).toBe(1);
    // Without the token the child answers 401 and the count reads 0 — the bug.
    expect(await countProjectExecutions(alpha.port)).toBe(0);

    // End to end: the hub sees alpha's run and queues beta's instead of starting it.
    const res = await execute("/p/beta/api/hench/execute", "task-2");
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ queued: true, reason: "at-capacity", running: 1 });
    expect(beta.received).toEqual([]);
  });

  it("starts a queued run at its turn instead of dropping it as unauthorized", async () => {
    alpha.running.add("task-1");
    expect((await execute("/p/beta/api/hench/execute", "task-2")).status).toBe(202);

    alpha.running.delete("task-1");
    await waitFor(() => beta.received.length === 1, 4_000);
    expect(beta.received).toEqual(["task-2"]);
    const queue = await (await fetch(`http://127.0.0.1:${hub!.port}/api/hub/queue`, { headers: { "X-Ndx-Token": token } })).json();
    expect(queue.dropped ?? []).toEqual([]);
    expect(beta.refused).toEqual([]);
  });

  it("answers the pre-queue check with the project server's verdict, not a fail-open 401", async () => {
    alpha.running.add("task-1");
    const res = await execute("/p/beta/api/hench/execute", "refused-task");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "Task is blocked.", taskId: "refused-task" });
    expect(beta.checks).toEqual(["refused-task"]);
    expect(beta.refused).toEqual([]);
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

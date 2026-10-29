/**
 * Sidecar settings: the saved ceilings and idle window reach the code that
 * reads them, an invalid value is refused with a message and writes nothing,
 * and the allow-list takes added commands but never work, reset or push.
 */
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleSidecarRoute } from "../../../src/server/routes-sidecar.js";
import { SidecarBroker } from "../../../src/server/sidecar/broker.js";
import { DEFAULT_CONTEXT_CEILINGS, resolveContextCeiling } from "../../../src/server/sidecar/context-refresh.js";
import { DEFAULT_SIDECAR_TTL_MS, worktreeSidecarDir } from "../../../src/server/sidecar/session-registry.js";
import { readSidecarSettings, resolveSidecarIdleMs } from "../../../src/server/sidecar/settings.js";
import type { ServerContext } from "../../../src/server/types.js";
import { closeRouteTestServer, removeTestDir } from "../../helpers/server-route-test-support.js";

let root: string;
let server: Server;
let base: string;
let broker: SidecarBroker;

const config = () => join(root, ".n-dx.json");
const written = () => JSON.parse(readFileSync(config(), "utf-8")) as { web?: Record<string, unknown> };

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, any> }> {
  const res = await fetch(`${base}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: await res.json() as Record<string, any> };
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "sidecar-settings-"));
  mkdirSync(join(root, ".rex"), { recursive: true });
  broker = new SidecarBroker({ dir: join(root, "sidecar") });
  const ctx: ServerContext = { projectDir: root, svDir: join(root, ".sourcevision"), rexDir: join(root, ".rex"), dev: false };
  server = createServer((req, res) => {
    void handleSidecarRoute(req, res, ctx, () => undefined, { brokerFor: () => broker }).then((handled) => {
      if (!handled) { res.writeHead(404); res.end("{}"); }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await closeRouteTestServer(server);
  removeTestDir(root);
});

describe("settings route", () => {
  it("answers the defaults before anything is saved", async () => {
    const { status, json } = await call("GET", "/api/sidecar/settings");
    expect(status).toBe(200);
    expect(json).toMatchObject({
      mode: "ask",
      contextCeiling: { worktree: 100_000, hub: 40_000 },
      idleMs: 2 * 60 * 60 * 1000,
      githubReads: false,
    });
  });

  it("saves ceilings, idle window and the GitHub reads toggle, and the readers use them", async () => {
    const { status } = await call("PUT", "/api/sidecar/settings", {
      contextCeiling: { worktree: 150_000, hub: 20_000 },
      idleMs: 30 * 60_000,
      githubReads: true,
    });
    expect(status).toBe(200);
    expect(written().web).toEqual({
      sidecarContextCeiling: { worktree: 150_000, hub: 20_000 },
      sidecarIdleMs: 30 * 60_000,
      sidecarGithubReads: true,
    });
    expect(resolveContextCeiling(root, "worktree")).toBe(150_000);
    expect(resolveContextCeiling(root, "hub")).toBe(20_000);
    expect(resolveSidecarIdleMs(root)).toBe(30 * 60_000);
    expect(readSidecarSettings(root).githubReads).toBe(true);
  });

  it("resets a value to its default with null and leaves no empty objects", async () => {
    await call("PUT", "/api/sidecar/settings", { contextCeiling: { hub: 20_000 }, idleMs: 60_000 });
    await call("PUT", "/api/sidecar/settings", { contextCeiling: { hub: null }, idleMs: null });
    expect(written().web).toBeUndefined();
    expect(resolveContextCeiling(root, "hub")).toBe(DEFAULT_CONTEXT_CEILINGS.hub);
    expect(resolveSidecarIdleMs(root)).toBe(DEFAULT_SIDECAR_TTL_MS);
  });

  it("writes to the local config when that is where the value comes from", async () => {
    writeFileSync(join(root, ".n-dx.local.json"), JSON.stringify({ web: { sidecarIdleMs: 60_000 } }));
    await call("PUT", "/api/sidecar/settings", { idleMs: 90_000 });
    expect(resolveSidecarIdleMs(root)).toBe(90_000);
    expect(existsSync(config())).toBe(false);
  });

  it.each([
    [{ contextCeiling: { worktree: 0 } }, /worktree context ceiling/],
    [{ contextCeiling: { hub: 1.5 } }, /hub context ceiling/],
    [{ idleMs: -1 }, /idle window/],
    [{ idleMs: "2h" }, /idle window/],
    [{ githubReads: "yes" }, /githubReads/],
    [{ mode: "auto" }, /Auto mode is not available yet/],
    [{ mode: "yolo" }, /mode must be/],
  ])("refuses %j with a message and writes nothing", async (body, message) => {
    const { status, json } = await call("PUT", "/api/sidecar/settings", { idleMs: 60_000, ...body });
    expect(status).toBe(400);
    expect(String(json.error)).toMatch(message);
    expect(existsSync(config())).toBe(false);
  });
});

describe("the dashboard's session registry", () => {
  it("forgets a resume id once the saved idle window has passed", async () => {
    // The route's own registry (no registryFor), seeded with a session idle for ten minutes.
    const sidecarDir = worktreeSidecarDir(root);
    mkdirSync(sidecarDir, { recursive: true });
    const idleSince = new Date(Date.now() - 10 * 60_000).toISOString();
    writeFileSync(join(sidecarDir, "index.json"), JSON.stringify({
      schema: "ndx/sidecar-index/v1",
      sessions: [{
        id: "s1", scope: "worktree", worktree: root, vendor: "claude", resumeId: "vendor-1",
        createdAt: idleSince, lastActivityAt: idleSince, turns: 1, cursor: 0, tokens: { input: 0, output: 0 },
      }],
    }));
    const resumeId = async () => (await call("GET", "/api/sidecar/sessions")).json.sessions[0].session.resumeId;

    expect(await resumeId()).toBe("vendor-1");
    await call("PUT", "/api/sidecar/settings", { idleMs: 5 * 60_000 });
    expect(await resumeId()).toBeUndefined();
  });
});

describe("allow-list route", () => {
  it("adds a command rule, lists it and removes it", async () => {
    const added = await call("POST", "/api/sidecar/allow-list", { tool: "run_command", argv: ["ndx", "status", "."] });
    expect(added.status).toBe(200);
    const key = JSON.stringify(["ndx", "status", "."]);
    expect((await call("GET", "/api/sidecar/allow-list")).json.rules).toEqual([{ tool: "run_command", key }]);
    expect(broker.allowList()).toEqual([{ tool: "run_command", key }]);
    expect((await call("DELETE", "/api/sidecar/allow-list", { tool: "run_command", key })).json).toEqual({ removed: true });
    expect(broker.allowList()).toEqual([]);
  });

  it.each([
    [["ndx", "work", "."]],
    [["git", "reset", "--hard"]],
    [["git", "push", "origin", "main"]],
  ])("refuses to add %j", async (argv) => {
    const { status, json } = await call("POST", "/api/sidecar/allow-list", { tool: "run_command", argv });
    expect(status).toBe(409);
    expect(String(json.error)).toMatch(/never be allow-listed/);
    expect(broker.allowList()).toEqual([]);
  });

  it("refuses a rule for a tool that can never be allow-listed", async () => {
    expect((await call("POST", "/api/sidecar/allow-list", { tool: "start_work", argv: ["x"] })).status).toBe(409);
  });
});

/**
 * Dashboard routes that spawn from repository content wait for repository
 * trust, and the GETs that do work refuse a foreign site.
 *
 * The fixture is a project whose `.hench/config.json` lets the agent run a
 * command outside the language baseline — a deviation that restricts it until
 * `ndx trust accept .` records it in the (scratch) ndx home. Every spawn and
 * exec from `@n-dx/llm-client` is mocked, so a route that got past its gate
 * would show up as a call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { spawnManagedMock, execMock, spawnCliMock } = vi.hoisted(() => ({
  spawnManagedMock: vi.fn(),
  execMock: vi.fn(),
  spawnCliMock: vi.fn(),
}));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, spawnManaged: spawnManagedMock, exec: execMock, spawnCli: spawnCliMock };
});

import { recordRepoTrust } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import { handleCommandsRoute } from "../../../src/server/routes-commands.js";
import { handleRunCommandsRoute } from "../../../src/server/routes-run-commands.js";
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../../src/server/routes-hench.js";
import { handleHenchPrepRoute } from "../../../src/server/routes-hench-prep.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { handleLlmRoute } from "../../../src/server/routes-llm.js";
import { handleConfigRoute } from "../../../src/server/routes-config.js";
import { clearLlmCatalogCache } from "../../../src/server/llm-catalog.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

/** One request built by hand, so browser-only headers can be set. */
function send(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, method, path, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers } },
      (res) => {
        let text = "";
        res.setEncoding("utf-8");
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          let parsed: unknown = text;
          try { parsed = text ? JSON.parse(text) : null; } catch { /* plain text */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("dashboard routes and repository trust", () => {
  let home: string;
  let projectDir: string;
  let ctx: ServerContext;
  let srv: RouteTestServer;
  let savedHome: string | undefined;
  let savedLegacyHome: string | undefined;

  beforeEach(async () => {
    spawnManagedMock.mockReset();
    execMock.mockReset();
    spawnCliMock.mockReset();
    execMock.mockResolvedValue({ stdout: "", stderr: "", error: null, exitCode: 0, launched: true });
    resetHenchRouteStateForTests();

    home = await mkdtemp(join(tmpdir(), "trust-gate-home-"));
    savedHome = process.env.NDX_HOME;
    savedLegacyHome = process.env.N_DX_HOME;
    process.env.NDX_HOME = home;
    delete process.env.N_DX_HOME;

    projectDir = await mkdtemp(join(tmpdir(), "trust-gate-project-"));
    await mkdir(join(projectDir, ".hench"), { recursive: true });
    await mkdir(join(projectDir, ".rex"), { recursive: true });
    await mkdir(join(projectDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(projectDir, ".hench", "config.json"),
      JSON.stringify({ guard: { allowedCommands: ["npm", "git", "curl"] } }),
    );
    // A tracked CLI path the catalog would otherwise run with --version.
    await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ cli: { claudePath: "/opt/repo-claude" } }));
    await writeFile(join(projectDir, "package.json"), JSON.stringify({ scripts: { dev: "node server.js" } }));
    clearLlmCatalogCache(projectDir);

    ctx = { projectDir, svDir: join(projectDir, ".sourcevision"), rexDir: join(projectDir, ".rex"), dev: false };
    srv = await startRouteTestServer(async (req, res) => {
      if (await handleCommandsRoute(req, res, ctx)) return true;
      if (await handleRunCommandsRoute(req, res, ctx)) return true;
      if (await handleHenchPrepRoute(req, res, ctx)) return true;
      if (await handleHenchRoute(req, res, ctx)) return true;
      if (await handleRexRoute(req, res, ctx)) return true;
      if (await handleLlmRoute(req, res, ctx)) return true;
      return handleConfigRoute(req, res, ctx);
    });
  });

  afterEach(async () => {
    await srv.close();
    if (savedHome === undefined) delete process.env.NDX_HOME;
    else process.env.NDX_HOME = savedHome;
    if (savedLegacyHome !== undefined) process.env.N_DX_HOME = savedLegacyHome;
    await rm(projectDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  const GATED: Array<[string, string, string?]> = [
    ["POST", "/api/commands/refresh", "{}"],
    ["POST", "/api/commands/sv-analyze", "{}"],
    ["POST", "/api/commands/auth"],
    ["POST", "/api/commands/ci", "{}"],
    ["POST", "/api/commands/self-heal", "{}"],
    ["POST", "/api/run-commands/start", JSON.stringify({ id: "npm:dev" })],
    ["POST", "/api/hench/execute", JSON.stringify({ taskId: "t1" })],
    ["GET", "/api/hench/prep/t1"],
    ["POST", "/api/hench/prep/t1/preview", "{}"],
    ["POST", "/api/rex/analyze", "{}"],
    ["POST", "/api/rex/smart-add-preview", JSON.stringify({ text: "x" })],
    ["POST", "/api/rex/execute/epic-by-epic", "{}"],
    ["GET", "/api/llm/local-status"],
    ["POST", "/api/llm/local-test", "{}"],
  ];

  for (const [method, path, body] of GATED) {
    it(`${method} ${path} answers 403 with the trust hint while restricted`, async () => {
      const res = await send(srv.port, method, path, {}, body);
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body).toMatchObject({ hint: "ndx trust accept ." });
      expect(typeof res.body.error).toBe("string");
      expect(spawnManagedMock).not.toHaveBeenCalled();
      expect(spawnCliMock).not.toHaveBeenCalled();
      expect(execMock).not.toHaveBeenCalled();
    });
  }

  it("runs again once the configuration has been accepted", async () => {
    recordRepoTrust(projectDir, { ndxHome: home });
    const res = await send(srv.port, "POST", "/api/commands/auth");
    expect(res.status).toBe(200);
    expect(execMock).toHaveBeenCalled();
  });

  it("the catalog probes the safe CLI fallback while restricted, without running the repository's CLI path", async () => {
    const res = await send(srv.port, "GET", "/api/llm/catalog");
    expect(res.status).toBe(200);
    expect(res.body.claude.cli).toMatchObject({ found: true, path: "claude" });
    for (const call of execMock.mock.calls) expect(call[0]).not.toBe("/opt/repo-claude");
  });

  it("never resolves a CLI from the project's node_modules/.bin", async () => {
    recordRepoTrust(projectDir, { ndxHome: home });
    await mkdir(join(projectDir, "node_modules", ".bin"), { recursive: true });
    for (const name of ["ndx", "rex", "sourcevision", "hench"]) {
      await writeFile(join(projectDir, "node_modules", ".bin", name), "#!/bin/sh\n");
    }
    await send(srv.port, "POST", "/api/commands/auth?refresh=true");
    await send(srv.port, "POST", "/api/commands/export-pdf");
    await send(srv.port, "POST", "/api/commands/validate-tokens");
    expect(execMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [bin, args] of execMock.mock.calls as Array<[string, string[]]>) {
      expect(bin.startsWith(projectDir), bin).toBe(false);
      expect(String(args[0] ?? "").startsWith(projectDir), String(args[0])).toBe(false);
    }
  });

  const SIDE_EFFECT_GETS = [
    "/api/commands/manifest",
    "/api/commands/init/preflight",
    "/api/llm/catalog",
    "/api/llm/local-status",
    "/api/ndx-config",
  ];
  for (const path of SIDE_EFFECT_GETS) {
    it(`GET ${path} refuses Sec-Fetch-Site: cross-site`, async () => {
      const res = await send(srv.port, "GET", path, { "Sec-Fetch-Site": "cross-site", Origin: "https://example.test" });
      expect(res.status).toBe(403);
      expect(spawnManagedMock).not.toHaveBeenCalled();
      expect(execMock).not.toHaveBeenCalled();
    });
  }

  it("GET /api/commands/auth is no longer a route", async () => {
    const res = await send(srv.port, "GET", "/api/commands/auth");
    expect(res.status).not.toBe(200);
    expect(execMock).not.toHaveBeenCalled();
  });
});

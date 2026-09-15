/**
 * Tests for GET /api/config's `server` object (start.ts handleConfigEndpoint).
 *
 * `server` mirrors ProjectStatus.server from routes-status.ts (see
 * routes-status.test.ts) so the viewer footer (PR 7) can read pid/version/
 * cliPath without the heavier /api/status call. This file covers the /api/config
 * wiring specifically: existing `scope`/`initialized` fields must be unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { handleConfigEndpoint } from "../../../src/server/start.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

/** Actual `@n-dx/web` package version — asserted against, not merely typeof-checked. */
const webPackageVersion = (
  JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf-8")) as {
    version: string;
  }
).version;

describe("GET /api/config server object", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let testServer: RouteTestServer;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "config-endpoint-"));
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
      port: 4242,
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    testServer = await startRouteTestServer((req, res) => handleConfigEndpoint(req, res, ctx));
  });

  afterEach(async () => {
    await testServer.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("leaves existing scope/initialized fields unchanged", async () => {
    const res = await fetch(`${testServer.baseUrl}/api/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scope).toBeNull();
    expect(data.initialized).toBe(false);
  });

  it("includes an additive server object with projectDir, version, cliPath, pid, port, startedAt", async () => {
    const res = await fetch(`${testServer.baseUrl}/api/config`);
    const data = await res.json();

    expect(data.server).toBeTruthy();
    expect(data.server.projectDir).toBe(tmpDir);
    // Exact match, not just typeof — a readWebVersion() fallback to "unknown"
    // must fail this assertion.
    expect(data.server.version).toBe(webPackageVersion);
    expect(typeof data.server.cliPath).toBe("string");
    expect(data.server.pid).toBe(process.pid);
    expect(data.server.port).toBe(4242);
    expect(data.server.startedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("reports server.cliPath from NDX_CLI_PATH when set", async () => {
    const original = {
      NDX_CLI_PATH: process.env["NDX_CLI_PATH"],
      N_DX_CLI_PATH: process.env["N_DX_CLI_PATH"],
    };
    process.env["NDX_CLI_PATH"] = "/custom/ndx/cli.js";
    delete process.env["N_DX_CLI_PATH"];
    try {
      const res = await fetch(`${testServer.baseUrl}/api/config`);
      const data = await res.json();
      expect(data.server.cliPath).toBe("/custom/ndx/cli.js");
    } finally {
      if (original.NDX_CLI_PATH === undefined) delete process.env["NDX_CLI_PATH"];
      else process.env["NDX_CLI_PATH"] = original.NDX_CLI_PATH;
      if (original.N_DX_CLI_PATH === undefined) delete process.env["N_DX_CLI_PATH"];
      else process.env["N_DX_CLI_PATH"] = original.N_DX_CLI_PATH;
    }
  });

  it("falls back to process.argv[1] for server.cliPath when no CLI path env vars are set", async () => {
    const original = {
      NDX_CLI_PATH: process.env["NDX_CLI_PATH"],
      N_DX_CLI_PATH: process.env["N_DX_CLI_PATH"],
    };
    delete process.env["NDX_CLI_PATH"];
    delete process.env["N_DX_CLI_PATH"];
    try {
      const res = await fetch(`${testServer.baseUrl}/api/config`);
      const data = await res.json();
      expect(data.server.cliPath).toBe(process.argv[1]);
    } finally {
      if (original.NDX_CLI_PATH === undefined) delete process.env["NDX_CLI_PATH"];
      else process.env["NDX_CLI_PATH"] = original.NDX_CLI_PATH;
      if (original.N_DX_CLI_PATH === undefined) delete process.env["N_DX_CLI_PATH"];
      else process.env["N_DX_CLI_PATH"] = original.N_DX_CLI_PATH;
    }
  });
});

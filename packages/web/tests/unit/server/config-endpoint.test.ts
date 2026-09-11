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
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../../src/server/types.js";
import { handleConfigEndpoint } from "../../../src/server/start.js";
import { startRouteTestServer, type RouteTestServer } from "../../helpers/server-route-test-support.js";

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
    expect(typeof data.server.version).toBe("string");
    expect(data.server.version.length).toBeGreaterThan(0);
    expect(typeof data.server.cliPath).toBe("string");
    expect(data.server.pid).toBe(process.pid);
    expect(data.server.port).toBe(4242);
    expect(data.server.startedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

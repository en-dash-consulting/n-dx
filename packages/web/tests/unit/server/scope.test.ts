/**
 * Tests for --scope filtering behavior.
 *
 * When scope is set, the server should only serve routes and config for the
 * scoped package, returning 404 for out-of-scope API routes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerContext, ViewerScope } from "../../../src/server/types.js";
import { handleSourcevisionRoute } from "../../../src/server/routes-sourcevision.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";
import { jsonResponse } from "../../../src/server/types.js";

type InScopeFn = (pkg: ViewerScope) => boolean;

/** Build the scope filter function matching start.ts logic. */
function buildInScope(scope?: ViewerScope): InScopeFn {
  return (pkg: ViewerScope) => !scope || scope === pkg;
}

/** Start a test server that applies scope filtering like start.ts does. */
function startScopedServer(
  ctx: ServerContext,
  scope?: ViewerScope,
): Promise<{ server: Server; port: number }> {
  const inScope = buildInScope(scope);

  return new Promise((resolve) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      res.setHeader("Access-Control-Allow-Origin", "*");

      const url = req.url || "/";
      const method = req.method || "GET";

      // /api/config endpoint
      if (url === "/api/config" && method === "GET") {
        jsonResponse(res, 200, { scope: scope ?? null });
        return;
      }

      // Scoped route dispatch (mirrors start.ts logic)
      if (inScope("sourcevision") && handleSourcevisionRoute(req, res, ctx)) return;

      if (inScope("rex")) {
        const rexResult = handleRexRoute(req, res, ctx, () => {});
        if (rexResult instanceof Promise) {
          if (await rexResult) return;
        } else if (rexResult) {
          return;
        }
      }

      if (inScope("hench") && handleHenchRoute(req, res, ctx)) return;

      res.writeHead(404);
      res.end("Not found");
    });

    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("Scope filtering", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "scope-test-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    const henchDir = join(tmpDir, ".hench", "runs");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await mkdir(henchDir, { recursive: true });

    // Write sourcevision fixture data
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify({
        schema: "sourcevision/v1",
        project: "test-project",
        timestamp: "2026-01-01T00:00:00.000Z",
        version: "0.1.0",
        summary: { totalFiles: 1, analyzedFiles: 1, languages: {} },
      }),
    );

    // Write rex fixture data
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        version: "1.0.0",
        title: "Test PRD",
        items: [],
      }),
    );

    // Write hench fixture data
    await writeFile(
      join(henchDir, "run-001.json"),
      JSON.stringify({
        id: "run-001",
        taskId: "task-1",
        status: "completed",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("/api/config endpoint", () => {
    it("returns null scope when no scope is set", async () => {
      const { server, port } = await startScopedServer(ctx);
      try {
        const res = await fetch(`http://localhost:${port}/api/config`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.scope).toBeNull();
      } finally {
        server.close();
      }
    });

    it("returns the scope when set to sourcevision", async () => {
      const { server, port } = await startScopedServer(ctx, "sourcevision");
      try {
        const res = await fetch(`http://localhost:${port}/api/config`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.scope).toBe("sourcevision");
      } finally {
        server.close();
      }
    });

    it("returns the scope when set to rex", async () => {
      const { server, port } = await startScopedServer(ctx, "rex");
      try {
        const res = await fetch(`http://localhost:${port}/api/config`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.scope).toBe("rex");
      } finally {
        server.close();
      }
    });
  });

  describe("scope=sourcevision", () => {
    let server: Server;
    let port: number;

    beforeEach(async () => {
      const started = await startScopedServer(ctx, "sourcevision");
      server = started.server;
      port = started.port;
    });

    afterEach(() => {
      server.close();
    });

    it("serves sourcevision API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/sv/manifest`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.project).toBe("test-project");
    });

    it("blocks rex API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prd`);
      expect(res.status).toBe(404);
    });

    it("blocks hench API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/hench/runs`);
      expect(res.status).toBe(404);
    });
  });

  describe("scope=rex", () => {
    let server: Server;
    let port: number;

    beforeEach(async () => {
      const started = await startScopedServer(ctx, "rex");
      server = started.server;
      port = started.port;
    });

    afterEach(() => {
      server.close();
    });

    it("serves rex API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prd`);
      expect(res.status).toBe(200);
    });

    it("blocks sourcevision API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/sv/manifest`);
      expect(res.status).toBe(404);
    });

    it("blocks hench API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/hench/runs`);
      expect(res.status).toBe(404);
    });
  });

  describe("no scope (full dashboard)", () => {
    let server: Server;
    let port: number;

    beforeEach(async () => {
      const started = await startScopedServer(ctx);
      server = started.server;
      port = started.port;
    });

    afterEach(() => {
      server.close();
    });

    it("serves sourcevision API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/sv/manifest`);
      expect(res.status).toBe(200);
    });

    it("serves rex API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prd`);
      expect(res.status).toBe(200);
    });

    it("serves hench API routes", async () => {
      const res = await fetch(`http://localhost:${port}/api/hench/runs`);
      expect(res.status).toBe(200);
    });

    it("returns null scope in config", async () => {
      const res = await fetch(`http://localhost:${port}/api/config`);
      const data = await res.json();
      expect(data.scope).toBeNull();
    });
  });
});

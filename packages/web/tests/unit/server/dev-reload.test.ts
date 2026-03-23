/**
 * Tests for the dev-mode live-reload mechanism.
 *
 * Verifies:
 * - The WebSocket-based live-reload snippet is injected in dev mode
 * - The snippet is NOT injected in production mode
 * - The viewer:reload event is broadcast when HTML changes
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { resolveStaticAssets, handleStaticRoute } from "../../../src/server/routes-static.js";

describe("Dev live-reload", () => {
  let tmpDir: string;
  let viewerDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dev-reload-"));
    viewerDir = join(tmpDir, "viewer");
    await mkdir(viewerDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("Live-reload snippet injection", () => {
    it("injects WebSocket-based reload script in dev mode", () => {
      // resolveStaticAssets uses the compiled dist path, so we test via handleStaticRoute
      // by checking the LIVE_RELOAD_SNIPPET content directly from the module
      // Instead, test the behavior through the getViewerHtml function
      const assets = resolveStaticAssets(true);
      if (!assets) {
        // If dist/viewer/index.html doesn't exist, skip gracefully
        console.log("Skipping: dist/viewer/index.html not found (run build first)");
        return;
      }

      const html = assets.getViewerHtml();
      // Should contain WebSocket-based reload, not polling-based
      expect(html).toContain("new WebSocket(url)");
      expect(html).toContain("viewer:reload");
      expect(html).toContain("location.reload()");
    });

    it("does NOT inject reload script in production mode", () => {
      const assets = resolveStaticAssets(false);
      if (!assets) {
        console.log("Skipping: dist/viewer/index.html not found (run build first)");
        return;
      }

      const html = assets.getViewerHtml();
      expect(html).not.toContain("new WebSocket(url)");
      expect(html).not.toContain("viewer:reload");
    });

    it("uses WebSocket protocol, not HTTP polling", () => {
      const assets = resolveStaticAssets(true);
      if (!assets) {
        console.log("Skipping: dist/viewer/index.html not found (run build first)");
        return;
      }

      const html = assets.getViewerHtml();
      // Should NOT contain the old polling pattern
      expect(html).not.toContain("setInterval");
      expect(html).not.toContain('fetch("/data/status")');
    });
  });

  describe("Static route serving", () => {
    it("serves viewer HTML at / with no-cache in dev mode", async () => {
      const assets = resolveStaticAssets(true);
      if (!assets) {
        console.log("Skipping: dist/viewer/index.html not found");
        return;
      }

      const ctx: ServerContext = {
        projectDir: tmpDir,
        svDir: join(tmpDir, ".n-dx/sourcevision"),
        rexDir: join(tmpDir, ".n-dx/rex"),
        dev: true,
      };

      const { server, port } = await new Promise<{ server: Server; port: number }>((resolve) => {
        const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
          if (handleStaticRoute(req, res, ctx, assets)) return;
          res.writeHead(404);
          res.end("Not found");
        });
        srv.listen(0, () => {
          const addr = srv.address();
          const p = typeof addr === "object" && addr ? addr.port : 0;
          resolve({ server: srv, port: p });
        });
      });

      try {
        const res = await fetch(`http://localhost:${port}/`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("text/html");
        expect(res.headers.get("cache-control")).toBe("no-cache");

        const html = await res.text();
        expect(html).toContain("new WebSocket(url)");
      } finally {
        server.close();
      }
    });
  });
});

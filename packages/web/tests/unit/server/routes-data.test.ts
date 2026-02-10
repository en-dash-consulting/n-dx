import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { createDataWatcher, handleDataRoute } from "../../../src/server/routes-data.js";

/** Start a test server that only runs data routes. */
function startTestServer(
  ctx: ServerContext,
  viewerPath?: string,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const watcher = createDataWatcher(ctx, viewerPath);
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (handleDataRoute(req, res, ctx, watcher)) return;
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

describe("Data routes", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "data-routes-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    // Write fixture data
    await writeFile(
      join(svDir, "manifest.json"),
      JSON.stringify({ schema: "sourcevision/v1", project: "test" }),
    );
    await writeFile(
      join(svDir, "inventory.json"),
      JSON.stringify({ schema: "sourcevision/v1", files: [], summary: {} }),
    );
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "Test", items: [] }),
    );

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /data lists available files", async () => {
    const res = await fetch(`http://localhost:${port}/data`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toContain("manifest.json");
    expect(data.files).toContain("inventory.json");
    expect(data.files).toContain("prd.json");
  });

  it("GET /data/manifest.json serves sourcevision data", async () => {
    const res = await fetch(`http://localhost:${port}/data/manifest.json`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project).toBe("test");
  });

  it("GET /data/prd.json serves Rex data from .rex/", async () => {
    const res = await fetch(`http://localhost:${port}/data/prd.json`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe("rex/v1");
    expect(data.title).toBe("Test");
  });

  it("GET /data/status returns mtimes for live reload", async () => {
    const res = await fetch(`http://localhost:${port}/data/status`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.mtimes).toBeDefined();
    expect(typeof data.mtimes["manifest.json"]).toBe("number");
  });

  it("returns 404 for non-existent data file", async () => {
    const res = await fetch(`http://localhost:${port}/data/nonexistent.json`);
    expect(res.status).toBe(404);
  });

  it("blocks directory traversal", async () => {
    // Use raw HTTP request since fetch normalizes ../
    const http = await import("node:http");
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        { hostname: "localhost", port, path: "/data/../../../etc/passwd", method: "GET" },
        (res) => {
          let body = "";
          res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.status).toBe(403);
  });
});

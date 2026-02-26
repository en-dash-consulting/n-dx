import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleHenchRoute(req, res, ctx);
      if (result instanceof Promise) {
        result.then((handled) => {
          if (!handled) { res.writeHead(404); res.end("Not found"); }
        });
      } else if (!result) {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("GET /api/hench/memory", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-memory-"));
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns 200 with memory status", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/memory`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.system).toBeDefined();
    expect(data.server).toBeDefined();
    expect(data.processes).toBeDefined();
    expect(data.health).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });

  it("returns system memory fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/memory`);
    const data = await res.json();
    const sys = data.system;
    expect(typeof sys.totalBytes).toBe("number");
    expect(sys.totalBytes).toBeGreaterThan(0);
    expect(typeof sys.freeBytes).toBe("number");
    expect(sys.freeBytes).toBeGreaterThanOrEqual(0);
    expect(typeof sys.usedBytes).toBe("number");
    expect(sys.usedBytes).toBeGreaterThan(0);
    expect(typeof sys.usedPercent).toBe("number");
    expect(sys.usedPercent).toBeGreaterThanOrEqual(0);
    expect(sys.usedPercent).toBeLessThanOrEqual(100);
  });

  it("returns server process memory fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/memory`);
    const data = await res.json();
    const srv = data.server;
    expect(typeof srv.pid).toBe("number");
    expect(srv.pid).toBeGreaterThan(0);
    expect(typeof srv.rssBytes).toBe("number");
    expect(srv.rssBytes).toBeGreaterThan(0);
    expect(typeof srv.heapUsedBytes).toBe("number");
    expect(srv.heapUsedBytes).toBeGreaterThan(0);
    expect(typeof srv.heapTotalBytes).toBe("number");
    expect(srv.heapTotalBytes).toBeGreaterThan(0);
    expect(typeof srv.externalBytes).toBe("number");
  });

  it("returns a valid health level", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/memory`);
    const data = await res.json();
    expect(["healthy", "warning", "critical"]).toContain(data.health);
  });

  it("returns load average and CPU count", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/memory`);
    const data = await res.json();
    expect(Array.isArray(data.loadAvg)).toBe(true);
    expect(data.loadAvg).toHaveLength(3);
    for (const val of data.loadAvg) {
      expect(typeof val).toBe("number");
      expect(val).toBeGreaterThanOrEqual(0);
    }
    expect(typeof data.cpuCount).toBe("number");
    expect(data.cpuCount).toBeGreaterThan(0);
  });

  it("returns empty processes when no active executions", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/memory`);
    const data = await res.json();
    expect(data.processes).toEqual([]);
  });
});

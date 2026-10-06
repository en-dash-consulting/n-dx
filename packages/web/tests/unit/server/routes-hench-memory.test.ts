import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { AvailableMemoryReading } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute, setAvailableMemoryReaderForTests } from "../../../src/server/routes-hench.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const GIB = 1024 ** 3;

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
    server.listen(0, "127.0.0.1", () => {
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
    // A known machine by default: the reading is cached and refreshed in the
    // background, so an uninjected darwin test would see "pending" or not
    // depending on how fast `vm_stat` answered.
    setAvailableMemoryReaderForTests(() => ({
      availableBytes: 8 * GIB,
      totalBytes: 16 * GIB,
      pressure: "normal",
      source: "os.freemem",
    }));
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    setAvailableMemoryReaderForTests(null);
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Answer the route from a fixed reading, as a machine of any platform would. */
  function inject(reading: AvailableMemoryReading): void {
    setAvailableMemoryReaderForTests(() => reading);
  }

  async function getMemory(): Promise<{
    system: {
      totalBytes: number;
      freeBytes: number | null;
      availableBytes: number | null;
      usedBytes: number | null;
      usedPercent: number | null;
      pressure: string;
      source: string;
    };
    health: string;
  }> {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/memory`);
    expect(res.status).toBe(200);
    return await res.json();
  }

  it("returns 200 with memory status", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/memory`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.system).toBeDefined();
    expect(data.server).toBeDefined();
    expect(data.processes).toBeDefined();
    expect(data.health).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });

  it("returns system memory fields", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/memory`);
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
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/memory`);
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
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/memory`);
    const data = await res.json();
    expect(["healthy", "warning", "critical"]).toContain(data.health);
  });

  it("returns load average and CPU count", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/memory`);
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
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/memory`);
    const data = await res.json();
    expect(data.processes).toEqual([]);
  });

  it("reports the macOS available reading, not os.freemem()", async () => {
    // The bug: a healthy 16 GB Mac reads 115 MB free (99% used, "critical")
    // while holding ~3.9 GB of inactive and purgeable pages it hands back.
    inject({
      availableBytes: Math.round(3.9 * GIB),
      totalBytes: 16 * GIB,
      pressure: "normal",
      source: "darwin:vm_stat+sysctl",
    });

    const data = await getMemory();
    expect(data.health).toBe("healthy");
    expect(data.system.availableBytes).toBe(Math.round(3.9 * GIB));
    expect(data.system.freeBytes).toBe(data.system.availableBytes);
    expect(data.system.usedPercent).toBe(76);
    expect(data.system.pressure).toBe("normal");
    expect(data.system.source).toBe("darwin:vm_stat+sysctl");
  });

  it("maps warn and critical pressure onto the health level", async () => {
    inject({ availableBytes: 3 * GIB, totalBytes: 16 * GIB, pressure: "warn", source: "darwin:sysctl" });
    expect((await getMemory()).health).toBe("warning");

    inject({ availableBytes: 1 * GIB, totalBytes: 16 * GIB, pressure: "critical", source: "darwin:sysctl" });
    expect((await getMemory()).health).toBe("critical");
  });

  it("reports an unreadable machine as unknown with no derived figures", async () => {
    inject({ availableBytes: null, totalBytes: 16 * GIB, pressure: "unknown", source: "darwin:unavailable" });

    const data = await getMemory();
    expect(data.health).toBe("unknown");
    expect(data.system.freeBytes).toBeNull();
    expect(data.system.availableBytes).toBeNull();
    expect(data.system.usedBytes).toBeNull();
    expect(data.system.usedPercent).toBeNull();
    // Total memory is an `os.totalmem()` read and stays known.
    expect(data.system.totalBytes).toBe(16 * GIB);
  });

  it("keeps the os.freemem() platforms reading exactly as before", async () => {
    // linux / win32 pass os.freemem() through unchanged: 4 GB of 16 GB is 75%
    // used, which is the "warn" threshold and so a warning, as it was.
    inject({ availableBytes: 4 * GIB, totalBytes: 16 * GIB, pressure: "warn", source: "os.freemem" });

    const data = await getMemory();
    expect(data.system.usedPercent).toBe(75);
    expect(data.health).toBe("warning");
  });
});

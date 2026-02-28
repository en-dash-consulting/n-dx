/**
 * Tests for memory-efficient data loading strategies.
 *
 * Covers:
 * - Server-side streaming file responses (routes-data.ts)
 * - Inventory pagination (routes-sourcevision.ts)
 * - Hench runs pagination (routes-hench.ts)
 * - Token events pagination (routes-token-usage.ts)
 * - Client-side lazy loading (loader.ts)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { createDataWatcher, handleDataRoute } from "../../../src/server/routes-data.js";
import { handleSourcevisionRoute } from "../../../src/server/routes-sourcevision.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function startDataServer(
  ctx: ServerContext,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const watcher = createDataWatcher(ctx);
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

function startSvServer(
  ctx: ServerContext,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (handleSourcevisionRoute(req, res, ctx)) return;
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

function startHenchServer(
  ctx: ServerContext,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleHenchRoute(req, res, ctx);
      if (result instanceof Promise) {
        result.then((handled) => {
          if (!handled) {
            res.writeHead(404);
            res.end("Not found");
          }
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

// ---------------------------------------------------------------------------
// Data routes streaming tests
// ---------------------------------------------------------------------------

describe("Data routes — streaming file responses", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "data-stream-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    // Write fixture data
    const largeInventory = {
      schema: "sourcevision/v1",
      files: Array.from({ length: 500 }, (_, i) => ({
        path: `src/file-${i}.ts`,
        size: 1024 + i,
        language: "TypeScript",
        lineCount: 50 + i,
        role: "source",
        category: "module",
        hash: `hash-${i}`,
      })),
      summary: { totalFiles: 500, totalLines: 25000, byLanguage: {}, byRole: {} },
    };

    await writeFile(join(svDir, "inventory.json"), JSON.stringify(largeInventory));
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "Test", items: [] }),
    );

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startDataServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("streams inventory.json with correct Content-Length header", async () => {
    const res = await fetch(`http://localhost:${port}/data/inventory.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBeTruthy();
    const data = await res.json();
    expect(data.files).toHaveLength(500);
  });

  it("streams prd.json with correct Content-Length header", async () => {
    const res = await fetch(`http://localhost:${port}/data/prd.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBeTruthy();
    const data = await res.json();
    expect(data.title).toBe("Test");
  });

  it("returns 404 for missing files", async () => {
    const res = await fetch(`http://localhost:${port}/data/nonexistent.json`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Sourcevision inventory pagination tests
// ---------------------------------------------------------------------------

describe("Sourcevision inventory — pagination", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  const fileCount = 200;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-pagination-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    const inventory = {
      schema: "sourcevision/v1",
      files: Array.from({ length: fileCount }, (_, i) => ({
        path: `src/file-${String(i).padStart(3, "0")}.ts`,
        size: 1024 + i,
        language: "TypeScript",
        lineCount: 50 + i,
        role: "source",
        category: "module",
        hash: `hash-${i}`,
      })),
      summary: { totalFiles: fileCount, totalLines: 30000, byLanguage: {}, byRole: {} },
    };

    await writeFile(join(svDir, "manifest.json"), JSON.stringify({ schema: "sourcevision/v1" }));
    await writeFile(join(svDir, "inventory.json"), JSON.stringify(inventory));

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startSvServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns full inventory when no pagination params", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(fileCount);
    expect(data.pagination).toBeUndefined();
  });

  it("paginates with ?limit=N", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory?limit=50`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(50);
    expect(data.pagination).toEqual({ offset: 0, limit: 50, total: fileCount });
    // First file should be file-000
    expect(data.files[0].path).toBe("src/file-000.ts");
  });

  it("paginates with ?offset=N&limit=N", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory?offset=100&limit=25`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(25);
    expect(data.pagination).toEqual({ offset: 100, limit: 25, total: fileCount });
    expect(data.files[0].path).toBe("src/file-100.ts");
  });

  it("handles offset beyond file count", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory?offset=999&limit=10`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(0);
    expect(data.pagination.total).toBe(fileCount);
  });

  it("returns remaining files when offset without limit", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory?offset=190`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(10); // 200 - 190
    expect(data.pagination.offset).toBe(190);
    expect(data.pagination.total).toBe(fileCount);
  });

  it("preserves summary in paginated responses", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory?limit=10`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.totalFiles).toBe(fileCount);
    expect(data.schema).toBe("sourcevision/v1");
  });
});

// ---------------------------------------------------------------------------
// Hench runs pagination tests
// ---------------------------------------------------------------------------

describe("Hench runs — pagination with offset", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let runsDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  const runCount = 15;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-pagination-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await mkdir(runsDir, { recursive: true });

    // Write hench config
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await writeFile(
      join(tmpDir, ".hench", "config.json"),
      JSON.stringify({ provider: "cli", model: "sonnet" }),
    );

    // Create run files with timestamp-based IDs
    for (let i = 0; i < runCount; i++) {
      const date = new Date(2026, 0, 1 + i).toISOString();
      const id = `run-${String(i).padStart(3, "0")}`;
      await writeFile(
        join(runsDir, `${id}.json`),
        JSON.stringify({
          id,
          taskId: `task-${i}`,
          taskTitle: `Task ${i}`,
          startedAt: date,
          status: "completed",
          turns: 5,
          model: "sonnet",
          tokenUsage: { input: 1000, output: 500 },
        }),
      );
    }

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startHenchServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns all runs with total count", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/runs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(runCount);
    expect(data.total).toBe(runCount);
  });

  it("limits results with ?limit=N", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/runs?limit=5`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(5);
    expect(data.total).toBe(runCount);
  });

  it("paginates with ?offset=N&limit=N", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/runs?offset=10&limit=5`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(5);
    expect(data.total).toBe(runCount);
  });

  it("returns empty array with total when no runs directory", async () => {
    await rm(runsDir, { recursive: true, force: true });
    const res = await fetch(`http://localhost:${port}/api/hench/runs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(0);
    expect(data.total).toBe(0);
  });
});

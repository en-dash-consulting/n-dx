import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleSourcevisionRoute } from "../../../src/server/routes-sourcevision.js";

/** Start a test server that only runs sourcevision routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
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

describe("Sourcevision API routes", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  const manifestData = {
    schema: "sourcevision/v1",
    project: "test-project",
    timestamp: "2026-01-01T00:00:00.000Z",
    version: "0.1.0",
    git: { branch: "main", sha: "abc123" },
    summary: { totalFiles: 10, analyzedFiles: 10, languages: { TypeScript: 8, JavaScript: 2 } },
  };

  const inventoryData = {
    schema: "sourcevision/v1",
    files: [
      { path: "src/index.ts", extension: ".ts", sizeBytes: 1024, lines: 50 },
      { path: "src/utils.ts", extension: ".ts", sizeBytes: 512, lines: 25 },
    ],
    summary: { totalFiles: 2, totalLines: 75, totalSizeBytes: 1536 },
  };

  const zonesData = {
    schema: "sourcevision/v1",
    zones: [
      { id: "zone-1", name: "Core", files: ["src/index.ts"] },
      { id: "zone-2", name: "Utils", files: ["src/utils.ts"] },
    ],
  };

  const componentsData = {
    schema: "sourcevision/v1",
    components: [
      { name: "App", file: "src/App.tsx", props: [] },
    ],
  };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-api-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    // Write fixture data
    await writeFile(join(svDir, "manifest.json"), JSON.stringify(manifestData));
    await writeFile(join(svDir, "inventory.json"), JSON.stringify(inventoryData));
    await writeFile(join(svDir, "zones.json"), JSON.stringify(zonesData));
    await writeFile(join(svDir, "components.json"), JSON.stringify(componentsData));
    await writeFile(join(svDir, "CONTEXT.md"), "# Test Context\n\nThis is a test.");

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/sv/manifest returns manifest data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/manifest`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.project).toBe("test-project");
    expect(data.schema).toBe("sourcevision/v1");
  });

  it("GET /api/sv/inventory returns inventory data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/inventory`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.files).toHaveLength(2);
    expect(data.summary.totalFiles).toBe(2);
  });

  it("GET /api/sv/zones returns zones data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/zones`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.zones).toHaveLength(2);
    expect(data.zones[0].name).toBe("Core");
  });

  it("GET /api/sv/components returns components data", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/components`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.components).toHaveLength(1);
    expect(data.components[0].name).toBe("App");
  });

  it("GET /api/sv/context returns CONTEXT.md", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/context`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown");
    const text = await res.text();
    expect(text).toContain("# Test Context");
  });

  it("GET /api/sv/summary returns aggregate stats", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/summary`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasManifest).toBe(true);
    expect(data.hasInventory).toBe(true);
    expect(data.hasZones).toBe(true);
    expect(data.hasComponents).toBe(true);
    expect(data.project).toBe("test-project");
    expect(data.fileCount).toBe(2);
    expect(data.zoneCount).toBe(2);
    expect(data.componentCount).toBe(1);
  });

  it("returns 404 for missing data files", async () => {
    // Use a fresh dir with no data
    const emptyDir = await mkdtemp(join(tmpdir(), "sv-api-empty-"));
    const emptySvDir = join(emptyDir, ".sourcevision");
    await mkdir(emptySvDir, { recursive: true });
    const emptyCtx: ServerContext = { projectDir: emptyDir, svDir: emptySvDir, rexDir, dev: false };

    const emptyStarted = await startTestServer(emptyCtx);
    try {
      const res = await fetch(`http://localhost:${emptyStarted.port}/api/sv/manifest`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toContain("No manifest data");
    } finally {
      emptyStarted.server.close();
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it("does not handle non-sv API paths", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Not found");
  });

  it("does not handle POST requests", async () => {
    const res = await fetch(`http://localhost:${port}/api/sv/manifest`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

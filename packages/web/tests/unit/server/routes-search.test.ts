import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleSearchRoute, clearSearchIndexCache } from "../../../src/server/routes-search.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePrd(items: unknown[]) {
  return { schema: "rex/v1", title: "Test", items };
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "item-1",
    title: overrides.title ?? "Test item",
    status: overrides.status ?? "pending",
    level: overrides.level ?? "task",
    ...overrides,
  };
}

/** Start a test server that only runs search routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (handleSearchRoute(req, res, ctx)) return;
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Search API routes", () => {
  let tmpDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    clearSearchIndexCache();
    tmpDir = await mkdtemp(join(tmpdir(), "search-api-"));
    const svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── GET /api/search ────────────────────────────────────────────────────

  it("GET /api/search?q=... returns matching results", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "User authentication system" }),
      makeItem({ id: "2", title: "Database migration" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const res = await fetch(`http://localhost:${port}/api/search?q=authentication`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json();
    expect(data.query).toBe("authentication");
    expect(data.count).toBe(1);
    expect(data.elapsed_ms).toBeDefined();
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results[0].id).toBe("1");
    expect(data.results[0].title).toBe("User authentication system");
    expect(typeof data.results[0].score).toBe("number");
  });

  it("returns results with all required fields", async () => {
    const prd = makePrd([
      makeItem({
        id: "t-1",
        title: "Authentication task",
        description: "Build the auth system",
        level: "task",
        status: "in_progress",
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const res = await fetch(`http://localhost:${port}/api/search?q=authentication`);
    const data = await res.json();

    const result = data.results[0];
    expect(result.id).toBe("t-1");
    expect(result.title).toBe("Authentication task");
    expect(result.description).toBe("Build the auth system");
    expect(result.level).toBe("task");
    expect(result.status).toBe("in_progress");
    expect(typeof result.score).toBe("number");
    expect(result.score).toBeGreaterThan(0);
    expect(Array.isArray(result.matchedFields)).toBe(true);
    expect(Array.isArray(result.parentChain)).toBe(true);
  });

  it("returns results sorted by relevance score descending", async () => {
    const prd = makePrd([
      makeItem({
        id: "low",
        title: "Other task",
        description: "Mentions search in passing",
      }),
      makeItem({
        id: "high",
        title: "Search implementation",
        description: "Build search engine",
        tags: ["search"],
      }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const res = await fetch(`http://localhost:${port}/api/search?q=search`);
    const data = await res.json();

    expect(data.results.length).toBe(2);
    expect(data.results[0].id).toBe("high");
    expect(data.results[0].score).toBeGreaterThan(data.results[1].score);
  });

  // ── Error handling ─────────────────────────────────────────────────────

  it("returns 400 when q parameter is missing", async () => {
    const res = await fetch(`http://localhost:${port}/api/search`);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("q");
  });

  it("returns 400 when q parameter is empty", async () => {
    const res = await fetch(`http://localhost:${port}/api/search?q=`);
    expect(res.status).toBe(400);
  });

  it("returns 405 for non-GET methods", async () => {
    const res = await fetch(`http://localhost:${port}/api/search?q=test`, {
      method: "POST",
    });
    expect(res.status).toBe(405);
  });

  it("returns 404 for non-search routes", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
  });

  // ── Limit parameter ────────────────────────────────────────────────────

  it("respects limit parameter", async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      makeItem({ id: `item-${i}`, title: `Search result ${i}` }),
    );
    const prd = makePrd(items);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const res = await fetch(`http://localhost:${port}/api/search?q=search&limit=5`);
    const data = await res.json();
    expect(data.count).toBe(5);
    expect(data.results.length).toBe(5);
  });

  it("ignores invalid limit values", async () => {
    const prd = makePrd([makeItem({ id: "1", title: "Search item" })]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const res = await fetch(`http://localhost:${port}/api/search?q=search&limit=abc`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results.length).toBeGreaterThan(0);
  });

  // ── Empty PRD ──────────────────────────────────────────────────────────

  it("returns empty results when no PRD exists", async () => {
    const res = await fetch(`http://localhost:${port}/api/search?q=test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(0);
    expect(data.results).toEqual([]);
  });

  it("returns empty results when PRD has no items", async () => {
    const prd = makePrd([]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const res = await fetch(`http://localhost:${port}/api/search?q=test`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.count).toBe(0);
  });

  // ── Response time ──────────────────────────────────────────────────────

  it("responds under 200ms for typical PRD sizes", async () => {
    const items = Array.from({ length: 100 }, (_, i) =>
      makeItem({
        id: `item-${i}`,
        title: `Task ${i}: implement feature ${i}`,
        description: `Description for task ${i}`,
        acceptanceCriteria: [`Criteria ${i} must pass`],
      }),
    );
    const prd = makePrd(items);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    // Warm up the index
    await fetch(`http://localhost:${port}/api/search?q=implement`);

    // Measure actual search time
    const start = performance.now();
    const res = await fetch(`http://localhost:${port}/api/search?q=implement`);
    const elapsed = performance.now() - start;
    expect(res.status).toBe(200);

    const data = await res.json();
    // The server-side elapsed time should be well under 200ms
    expect(data.elapsed_ms).toBeLessThan(200);
    // Total round-trip should also be reasonable
    expect(elapsed).toBeLessThan(500); // generous for network overhead
  });

  // ── Query features ─────────────────────────────────────────────────────

  it("supports exact phrase matching with quotes", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "Build user authentication system" }),
      makeItem({ id: "2", title: "User profile with authentication badge" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const res = await fetch(
      `http://localhost:${port}/api/search?q=${encodeURIComponent('"user authentication"')}`,
    );
    const data = await res.json();
    expect(data.count).toBe(1);
    expect(data.results[0].id).toBe("1");
  });

  it("supports OR queries", async () => {
    const prd = makePrd([
      makeItem({ id: "1", title: "Authentication system" }),
      makeItem({ id: "2", title: "Database migration" }),
      makeItem({ id: "3", title: "Logging setup" }),
    ]);
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(prd));

    const res = await fetch(
      `http://localhost:${port}/api/search?q=${encodeURIComponent("authentication OR database")}`,
    );
    const data = await res.json();
    expect(data.count).toBe(2);
    const ids = data.results.map((r: { id: string }) => r.id);
    expect(ids).toContain("1");
    expect(ids).toContain("2");
  });
});

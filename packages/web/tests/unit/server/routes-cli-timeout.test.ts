import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleCliTimeoutRoute } from "../../../src/server/routes-cli-timeout.js";

/** Start a test server that only runs CLI timeout routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (await handleCliTimeoutRoute(req, res, ctx)) return;
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

describe("CLI timeout API routes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "cli-timeout-api-"));
    const svDir = join(tmpDir, ".sourcevision");
    const rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── GET /api/cli/timeouts ──────────────────────────────────────────────

  describe("GET /api/cli/timeouts", () => {
    it("returns default response when no .n-dx.json exists", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const data = await res.json();
      expect(data.timeoutMs).toBeNull();
      expect(data.timeouts).toEqual({});
      expect(data.defaultTimeoutMs).toBe(1_800_000);
      expect(Array.isArray(data.noDefaultTimeoutCommands)).toBe(true);
      expect(data.noDefaultTimeoutCommands).toContain("start");
    });

    it("reads global timeoutMs from .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ cli: { timeoutMs: 60_000 } }),
        "utf-8",
      );

      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.timeoutMs).toBe(60_000);
    });

    it("reads per-command overrides from .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ cli: { timeouts: { analyze: 120_000, work: 0 } } }),
        "utf-8",
      );

      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.timeouts.analyze).toBe(120_000);
      expect(data.timeouts.work).toBe(0);
    });

    it("returns 404 for unknown paths", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/unknown`);
      expect(res.status).toBe(404);
    });
  });

  // ── PUT /api/cli/timeouts ──────────────────────────────────────────────

  describe("PUT /api/cli/timeouts", () => {
    it("saves global timeoutMs to .n-dx.json", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMs: 90_000 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.applied).toContainEqual({ field: "timeoutMs", value: 90_000 });

      // Verify it was persisted
      const readRes = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      const readData = await readRes.json();
      expect(readData.timeoutMs).toBe(90_000);
    });

    it("saves per-command overrides to .n-dx.json", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeouts: { analyze: 300_000, work: 0 } }),
      });
      expect(res.status).toBe(200);

      const readRes = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      const readData = await readRes.json();
      expect(readData.timeouts.analyze).toBe(300_000);
      expect(readData.timeouts.work).toBe(0);
    });

    it("preserves existing .n-dx.json content when saving", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ llm: { vendor: "claude" }, cli: { timeoutMs: 60_000 } }),
        "utf-8",
      );

      await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeouts: { analyze: 120_000 } }),
      });

      // llm.vendor should still be there
      const readRes = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      const readData = await readRes.json();
      // timeoutMs was in the original file; should still be present
      expect(readData.timeoutMs).toBe(60_000);
    });

    it("removes global timeoutMs when set to null", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ cli: { timeoutMs: 60_000 } }),
        "utf-8",
      );

      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMs: null }),
      });
      expect(res.status).toBe(200);

      const readRes = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      const readData = await readRes.json();
      expect(readData.timeoutMs).toBeNull();
    });

    it("removes a per-command override when set to null", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ cli: { timeouts: { analyze: 120_000 } } }),
        "utf-8",
      );

      await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeouts: { analyze: null } }),
      });

      const readRes = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      const readData = await readRes.json();
      expect(readData.timeouts.analyze).toBeUndefined();
    });

    it("rejects negative timeoutMs with 400", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMs: -1000 }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects non-numeric timeoutMs with 400", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMs: "fast" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects negative per-command timeout with 400", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeouts: { analyze: -500 } }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid command name with 400", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeouts: { "INVALID NAME": 5000 } }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid JSON body with 400", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
    });

    it("accepts zero as a valid timeout (disables the timeout)", async () => {
      const res = await fetch(`http://localhost:${port}/api/cli/timeouts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMs: 0 }),
      });
      expect(res.status).toBe(200);

      const readRes = await fetch(`http://localhost:${port}/api/cli/timeouts`);
      const readData = await readRes.json();
      expect(readData.timeoutMs).toBe(0);
    });
  });
});

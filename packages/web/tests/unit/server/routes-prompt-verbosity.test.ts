import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handlePromptVerbosityRoute } from "../../../src/server/routes-prompt-verbosity.js";

/** Start a test server that only runs prompt verbosity routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (await handlePromptVerbosityRoute(req, res, ctx)) return;
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

describe("prompt verbosity API routes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "prompt-verbosity-api-"));
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

  // ── GET /api/prompts/verbosity ──────────────────────────────────────

  describe("GET /api/prompts/verbosity", () => {
    it("returns compact default when no .n-dx.json exists", async () => {
      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const data = await res.json();
      expect(data.verbosity).toBe("compact");
      expect(data.defaultVerbosity).toBe("compact");
    });

    it("returns compact when explicitly set in .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ prompts: { verbosity: "compact" } }),
        "utf-8",
      );

      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`);
      const data = await res.json();
      expect(data.verbosity).toBe("compact");
    });

    it("returns verbose when set in .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ prompts: { verbosity: "verbose" } }),
        "utf-8",
      );

      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`);
      const data = await res.json();
      expect(data.verbosity).toBe("verbose");
    });

    it("falls back to compact for unrecognised verbosity value", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ prompts: { verbosity: "ultra" } }),
        "utf-8",
      );

      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`);
      const data = await res.json();
      expect(data.verbosity).toBe("compact");
    });

    it("returns 404 for unrelated paths", async () => {
      const res = await fetch(`http://localhost:${port}/api/prompts/other`);
      expect(res.status).toBe(404);
    });
  });

  // ── PUT /api/prompts/verbosity ──────────────────────────────────────

  describe("PUT /api/prompts/verbosity", () => {
    it("saves verbose to .n-dx.json and returns updated value", async () => {
      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verbosity: "verbose" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.verbosity).toBe("verbose");

      // Verify persistence
      const readRes = await fetch(`http://localhost:${port}/api/prompts/verbosity`);
      const readData = await readRes.json();
      expect(readData.verbosity).toBe("verbose");
    });

    it("saves compact to .n-dx.json", async () => {
      // First set verbose
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ prompts: { verbosity: "verbose" } }),
        "utf-8",
      );

      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verbosity: "compact" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.verbosity).toBe("compact");
    });

    it("preserves other .n-dx.json keys when saving", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ llm: { vendor: "claude" } }),
        "utf-8",
      );

      await fetch(`http://localhost:${port}/api/prompts/verbosity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verbosity: "verbose" }),
      });

      // Now check that verbosity is saved and llm.vendor is preserved
      const { readFileSync } = await import("node:fs");
      const saved = JSON.parse(readFileSync(join(tmpDir, ".n-dx.json"), "utf-8"));
      expect(saved.llm?.vendor).toBe("claude");
      expect(saved.prompts?.verbosity).toBe("verbose");
    });

    it("rejects unknown verbosity value with 400", async () => {
      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verbosity: "ultra" }),
      });
      expect(res.status).toBe(400);
    });

    it("rejects missing verbosity field with 400", async () => {
      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("rejects invalid JSON body with 400", async () => {
      const res = await fetch(`http://localhost:${port}/api/prompts/verbosity`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
    });
  });
});

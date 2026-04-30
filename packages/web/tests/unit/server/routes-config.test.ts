import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import {
  handleConfigRoute,
  clearConfigCaches,
} from "../../../src/server/routes-config.js";

/** Start a test server that only runs config routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (await handleConfigRoute(req, res, ctx)) return;
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

describe("Config API routes", () => {
  let parentDir: string;
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    clearConfigCaches();
    // Nest tmpDir inside a dedicated parent so detectProjects' parent-dir scan
    // stays bounded — scanning the system tmpdir directly can have 30k+ entries.
    parentDir = await mkdtemp(join(tmpdir(), "config-api-parent-"));
    tmpDir = join(parentDir, "project");
    const svDir = join(tmpDir, ".sourcevision");
    const rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(parentDir, { recursive: true, force: true });
  });

  // ── GET /api/ndx-config ──────────────────────────────────────────────

  describe("GET /api/ndx-config", () => {
    it("returns default config when no config files exist", async () => {
      const res = await fetch(`http://localhost:${port}/api/ndx-config`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/json");

      const data = await res.json();
      expect(data.model).toBeNull();
      expect(data.provider).toBeNull();
      expect(data.authMethod).toBe("none");
      expect(data.tokenBudget).toBeNull();
      expect(data.maxTurns).toBeNull();
      expect(data.projectDir).toBe(tmpDir);
    });

    it("reads model from hench config", async () => {
      const henchDir = join(tmpDir, ".hench");
      await mkdir(henchDir, { recursive: true });
      await writeFile(
        join(henchDir, "config.json"),
        JSON.stringify({ model: "sonnet", provider: "cli", maxTurns: 50, tokenBudget: 500000 }),
      );

      clearConfigCaches();
      const res = await fetch(`http://localhost:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.model).toBe("sonnet");
      expect(data.provider).toBe("cli");
      expect(data.authMethod).toBe("cli");
      expect(data.maxTurns).toBe(50);
      expect(data.tokenBudget).toBe(500000);
    });

    it("prefers .n-dx.json claude.model over hench model", async () => {
      const henchDir = join(tmpDir, ".hench");
      await mkdir(henchDir, { recursive: true });
      await writeFile(
        join(henchDir, "config.json"),
        JSON.stringify({ model: "sonnet", provider: "api" }),
      );
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { model: "claude-opus-4-20250514" } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://localhost:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.model).toBe("claude-opus-4-20250514");
    });

    it("detects api-key auth method", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { api_key: "sk-ant-test123" } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://localhost:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.authMethod).toBe("api-key");
    });

    it("detects cli auth method from provider", async () => {
      const henchDir = join(tmpDir, ".hench");
      await mkdir(henchDir, { recursive: true });
      await writeFile(
        join(henchDir, "config.json"),
        JSON.stringify({ provider: "cli" }),
      );

      clearConfigCaches();
      const res = await fetch(`http://localhost:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.authMethod).toBe("cli");
    });

    it("detects cli auth from cli_path in .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { cli_path: "/usr/local/bin/claude" } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://localhost:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.authMethod).toBe("cli");
    });

    it("reads project name from package.json", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "my-project", version: "1.0.0" }),
      );

      clearConfigCaches();
      const res = await fetch(`http://localhost:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.projectName).toBe("my-project");
    });

    it("uses caching", async () => {
      const res1 = await fetch(`http://localhost:${port}/api/ndx-config`);
      expect(res1.status).toBe(200);

      // Second request should use cache (no need to clear)
      const res2 = await fetch(`http://localhost:${port}/api/ndx-config`);
      expect(res2.status).toBe(200);
    });
  });

  // ── GET /api/projects ────────────────────────────────────────────────

  describe("GET /api/projects", () => {
    it("returns the active project", async () => {
      const res = await fetch(`http://localhost:${port}/api/projects`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(1);

      const active = data.find((p: { active: boolean }) => p.active);
      expect(active).toBeDefined();
      expect(active.path).toBe(tmpDir);
      expect(active.tools.sourcevision).toBe(true);
      expect(active.tools.rex).toBe(true);
    });

    it("detects sibling projects", async () => {
      // Create a sibling project directory
      const parentDir = join(tmpDir, "..");
      const siblingDir = join(parentDir, "sibling-project-test-ndx");
      await mkdir(join(siblingDir, ".rex"), { recursive: true });
      await writeFile(
        join(siblingDir, "package.json"),
        JSON.stringify({ name: "sibling-project" }),
      );

      try {
        clearConfigCaches();
        const res = await fetch(`http://localhost:${port}/api/projects`);
        const data = await res.json();

        const sibling = data.find((p: { name: string }) => p.name === "sibling-project");
        expect(sibling).toBeDefined();
        expect(sibling.active).toBe(false);
        expect(sibling.tools.rex).toBe(true);
      } finally {
        await rm(siblingDir, { recursive: true, force: true });
      }
    });

    it("active project is always first", async () => {
      const res = await fetch(`http://localhost:${port}/api/projects`);
      const data = await res.json();

      if (data.length > 0) {
        expect(data[0].active).toBe(true);
      }
    });
  });

  // ── Non-matching routes ──────────────────────────────────────────────

  it("returns 404 for unrelated routes", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for POST to /api/ndx-config", async () => {
    const res = await fetch(`http://localhost:${port}/api/ndx-config`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

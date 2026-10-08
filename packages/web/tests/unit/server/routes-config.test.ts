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
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

/** Start a test server that only runs config routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (await handleConfigRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("Config API routes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    clearConfigCaches();
    tmpDir = await mkdtemp(join(tmpdir(), "config-api-"));
    const svDir = join(tmpDir, ".sourcevision");
    const rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── GET /api/ndx-config ──────────────────────────────────────────────

  describe("GET /api/ndx-config", () => {
    it("returns default config when no config files exist", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
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

    it("reads provider, turns and budget from hench config but never its dead model key", async () => {
      // `hench.model` is not a model source — `ndx work` has never read it, so
      // reporting it here named a model nothing would actually run.
      const henchDir = join(tmpDir, ".hench");
      await mkdir(henchDir, { recursive: true });
      await writeFile(
        join(henchDir, "config.json"),
        JSON.stringify({ model: "sonnet", provider: "cli", maxTurns: 50, tokenBudget: 500000 }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.model).toBeNull();
      expect(data.provider).toBe("cli");
      expect(data.authMethod).toBe("cli");
      expect(data.maxTurns).toBe(50);
      expect(data.tokenBudget).toBe(500000);
    });

    it("resolves each legacy claude.* field the llm.claude block leaves unset", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({
          claude: { model: "legacy-model", api_key: "sk-legacy" },
          llm: { vendor: "claude", claude: { model: "modern-model" } },
        }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      // The modern block wins for `model`; `api_key` still comes from the
      // legacy key beside it rather than being shadowed by the whole block.
      expect(data.model).toBe("modern-model");
      expect(data.authMethod).toBe("api-key");
    });

    it("reports LM Studio's live model for a local vendor without writing .n-dx.json", async () => {
      // A GET must not have side effects; an earlier version persisted the
      // live model name back into .n-dx.json from here.
      const configPath = join(tmpDir, ".n-dx.json");
      const original = JSON.stringify({ llm: { vendor: "local", local: { host: "localhost", port: 1234, model: "stored-model" } } });
      await writeFile(configPath, original);

      const realFetch = globalThis.fetch;
      const calls: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        calls.push(String(input));
        return new Response(JSON.stringify({ data: [{ id: "live-model" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
      try {
        clearConfigCaches();
        const res = await realFetch(`http://127.0.0.1:${port}/api/ndx-config`);
        const data = await res.json();
        expect(calls).toEqual(["http://localhost:1234/v1/models"]);
        expect(data.vendor).toBe("local");
        expect(data.model).toBe("live-model");
      } finally {
        globalThis.fetch = realFetch;
      }

      const { readFile } = await import("node:fs/promises");
      expect(await readFile(configPath, "utf-8")).toBe(original);
    });

    it("does not report a Claude model as the live model for a non-Claude vendor", async () => {
      // llm.claude.* are Claude's keys. Folding them into the model shown for
      // a codex project names a model that vendor will never run.
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ llm: { vendor: "codex", claude: { model: "claude-opus-5" } } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.vendor).toBe("codex");
      expect(data.model).toBeNull();
    });

    it("still uses the Claude model when the vendor is claude or unset", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { model: "legacy-model" } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.vendor).toBeNull();
      expect(data.model).toBe("legacy-model");
    });

    it("counts a credential set under the modern llm.claude keys", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ llm: { vendor: "claude", claude: { api_key: "sk-modern" } } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.authMethod).toBe("api-key");
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
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.model).toBe("claude-opus-4-20250514");
    });

    it("detects api-key auth method", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { api_key: "sk-ant-test123" } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.authMethod).toBe("api-key");
    });

    it("detects api-key auth when the key lives only in .n-dx.local.json", async () => {
      // `ndx config *.api_key` writes to the gitignored local file; the shared
      // file may exist without the key. The footer must still show ✓.
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ llm: { vendor: "claude" } }),
      );
      await writeFile(
        join(tmpDir, ".n-dx.local.json"),
        JSON.stringify({ claude: { api_key: "sk-ant-local" } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
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
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.authMethod).toBe("cli");
    });

    it("detects cli auth from cli_path in .n-dx.json", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { cli_path: "/usr/local/bin/claude" } }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.authMethod).toBe("cli");
    });

    it("reads project name from package.json", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "my-project", version: "1.0.0" }),
      );

      clearConfigCaches();
      const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      const data = await res.json();

      expect(data.projectName).toBe("my-project");
    });

    it("uses caching", async () => {
      const res1 = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      expect(res1.status).toBe(200);

      // Second request should use cache (no need to clear)
      const res2 = await fetch(`http://127.0.0.1:${port}/api/ndx-config`);
      expect(res2.status).toBe(200);
    });
  });

  // ── Non-matching routes ──────────────────────────────────────────────

  it("returns 404 for unrelated routes", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/other`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for POST to /api/ndx-config", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/ndx-config`, { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/ndx-config on the .ndx/ layout", () => {
  it("reads .ndx/config.json and .ndx/config.local.json, not a root .n-dx.json", async () => {
    clearConfigCaches();
    const tmpDir = await mkdtemp(join(tmpdir(), "config-api-ndx-"));
    const svDir = join(tmpDir, ".ndx", "sourcevision");
    const rexDir = join(tmpDir, ".ndx", "rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    const { server, port } = await startTestServer({ projectDir: tmpDir, svDir, rexDir, dev: false });
    try {
      await writeFile(join(tmpDir, ".ndx", "config.json"), JSON.stringify({ claude: { model: "claude-sonnet-5" } }));
      await writeFile(join(tmpDir, ".ndx", "config.local.json"), JSON.stringify({ llm: { claude: { api_key: "sk-ant-local" } } }));
      await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ claude: { model: "claude-legacy" } }));

      const data = await (await fetch(`http://127.0.0.1:${port}/api/ndx-config`)).json();
      expect(data.model).toBe("claude-sonnet-5");
      expect(data.authMethod).toBe("api-key");
    } finally {
      await closeRouteTestServer(server);
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

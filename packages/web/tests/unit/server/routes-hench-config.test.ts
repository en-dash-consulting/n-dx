import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";

/** Minimal hench config for testing. */
function makeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "hench/v1",
    provider: "cli",
    model: "sonnet",
    maxTurns: 50,
    maxTokens: 8192,
    tokenBudget: 0,
    rexDir: ".n-dx/rex",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    loopPauseMs: 2000,
    maxFailedAttempts: 3,
    guard: {
      blockedPaths: [".hench/**", ".rex/**", ".git/**"],
      allowedCommands: ["npm", "git", "tsc"],
      commandTimeout: 30000,
      maxFileSize: 1048576,
    },
    retry: {
      maxRetries: 3,
      baseDelayMs: 2000,
      maxDelayMs: 30000,
    },
    ...overrides,
  };
}

/** Start a test server that routes through handleHenchRoute. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleHenchRoute(req, res, ctx);
      if (result instanceof Promise) {
        if (await result) return;
      } else if (result) {
        return;
      }
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

describe("Hench Config API routes", () => {
  let tmpDir: string;
  let henchDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-config-api-"));
    henchDir = join(tmpDir, ".n-dx/hench");
    await mkdir(henchDir, { recursive: true });
    await mkdir(join(henchDir, "runs"), { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".n-dx/sourcevision"),
      rexDir: join(tmpDir, ".n-dx/rex"),
      dev: false,
    };

    // Write default config
    await writeFile(
      join(henchDir, "config.json"),
      JSON.stringify(makeConfig(), null, 2) + "\n",
    );

    const result = await startTestServer(ctx);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── GET /api/hench/config ──────────────────────────────────────────

  it("GET /api/hench/config returns config and field metadata", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.config).toBeDefined();
    expect(body.fields).toBeDefined();
    expect(Array.isArray(body.fields)).toBe(true);

    // Check config values
    expect(body.config.provider).toBe("cli");
    expect(body.config.model).toBe("sonnet");
  });

  it("GET /api/hench/config returns field metadata with impact", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`);
    const body = await res.json();

    const providerField = body.fields.find((f: { path: string }) => f.path === "provider");
    expect(providerField).toBeDefined();
    expect(providerField.label).toBe("Provider");
    expect(providerField.type).toBe("enum");
    expect(providerField.enumValues).toContain("cli");
    expect(providerField.enumValues).toContain("api");
    expect(providerField.impact).toBeTruthy();
    expect(providerField.value).toBe("cli");
    expect(providerField.isDefault).toBe(true);
  });

  it("GET /api/hench/config detects non-default values", async () => {
    // Write custom config
    await writeFile(
      join(henchDir, "config.json"),
      JSON.stringify(makeConfig({ model: "opus" }), null, 2) + "\n",
    );

    const res = await fetch(`http://localhost:${port}/api/hench/config`);
    const body = await res.json();

    const modelField = body.fields.find((f: { path: string }) => f.path === "model");
    expect(modelField.value).toBe("opus");
    expect(modelField.isDefault).toBe(false);
  });

  it("GET /api/hench/config returns 404 when no config exists", async () => {
    // Remove config
    await rm(join(henchDir, "config.json"));

    const res = await fetch(`http://localhost:${port}/api/hench/config`);
    expect(res.status).toBe(404);
  });

  it("GET /api/hench/config includes nested field values", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`);
    const body = await res.json();

    const retryField = body.fields.find((f: { path: string }) => f.path === "retry.maxRetries");
    expect(retryField).toBeDefined();
    expect(retryField.value).toBe(3);
    expect(retryField.category).toBe("retry");
  });

  // ── PUT /api/hench/config ──────────────────────────────────────────

  it("PUT /api/hench/config updates a single field", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { model: "opus" } }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.applied).toHaveLength(1);
    expect(body.applied[0].path).toBe("model");
    expect(body.applied[0].oldValue).toBe("sonnet");
    expect(body.applied[0].newValue).toBe("opus");
    expect(body.applied[0].impact).toBeTruthy();

    // Verify persisted
    const raw = await readFile(join(henchDir, "config.json"), "utf-8");
    const saved = JSON.parse(raw);
    expect(saved.model).toBe("opus");
  });

  it("PUT /api/hench/config updates multiple fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: { model: "opus", maxTurns: 100 },
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.applied).toHaveLength(2);
    expect(body.config.model).toBe("opus");
    expect(body.config.maxTurns).toBe(100);
  });

  it("PUT /api/hench/config updates nested fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: { "retry.maxRetries": 5 },
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.config.retry.maxRetries).toBe(5);
  });

  it("PUT /api/hench/config rejects unknown fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { nonexistent: "foo" } }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toContain("Unknown field");
  });

  it("PUT /api/hench/config rejects invalid number values", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { maxTurns: "not-a-number" } }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/hench/config rejects negative numbers", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { maxTurns: -1 } }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/hench/config rejects invalid enum values", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { provider: "invalid" } }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/hench/config rejects missing changes object", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "opus" }),
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/hench/config rejects invalid JSON", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /api/hench/config returns impact descriptions", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { provider: "api" } }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.applied[0].impact).toContain("API");
  });

  it("PUT /api/hench/config validates array fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: { "guard.allowedCommands": ["npm", "git", "pnpm"] },
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.config.guard.allowedCommands).toEqual(["npm", "git", "pnpm"]);
  });

  it("PUT /api/hench/config rejects non-array for array fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changes: { "guard.allowedCommands": "npm" },
      }),
    });
    expect(res.status).toBe(400);
  });
});

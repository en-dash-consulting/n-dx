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

describe("Hench Templates API routes", () => {
  let tmpDir: string;
  let henchDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-templates-api-"));
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

  // ── GET /api/hench/templates ────────────────────────────────────────

  it("GET /api/hench/templates returns built-in templates", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.templates).toBeDefined();
    expect(Array.isArray(body.templates)).toBe(true);
    expect(body.templates.length).toBeGreaterThanOrEqual(5);

    // All built-in templates should be present
    const ids = body.templates.map((t: { id: string }) => t.id);
    expect(ids).toContain("quick-iteration");
    expect(ids).toContain("thorough-execution");
    expect(ids).toContain("budget-conscious");
    expect(ids).toContain("strict-safety");
    expect(ids).toContain("api-direct");
  });

  it("GET /api/hench/templates includes user templates", async () => {
    // Write a user template
    await writeFile(
      join(henchDir, "templates.json"),
      JSON.stringify([{
        id: "my-custom",
        name: "My Custom",
        description: "Custom template",
        useCases: [],
        tags: ["custom"],
        config: { maxTurns: 10 },
        builtIn: false,
      }]),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/templates`);
    const body = await res.json();

    const custom = body.templates.find((t: { id: string }) => t.id === "my-custom");
    expect(custom).toBeDefined();
    expect(custom.name).toBe("My Custom");
    expect(custom.builtIn).toBe(false);
  });

  it("GET /api/hench/templates has complete metadata on each template", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates`);
    const body = await res.json();

    for (const template of body.templates) {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(Array.isArray(template.useCases)).toBe(true);
      expect(Array.isArray(template.tags)).toBe(true);
      expect(typeof template.config).toBe("object");
      expect(typeof template.builtIn).toBe("boolean");
    }
  });

  // ── GET /api/hench/templates/:id ────────────────────────────────────

  it("GET /api/hench/templates/:id returns a specific template", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates/quick-iteration`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("quick-iteration");
    expect(body.name).toBe("Quick Iteration");
    expect(body.builtIn).toBe(true);
  });

  it("GET /api/hench/templates/:id returns 404 for unknown template", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates/nonexistent`);
    expect(res.status).toBe(404);
  });

  // ── POST /api/hench/templates ───────────────────────────────────────

  it("POST /api/hench/templates creates a user template", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "my-new-template",
        name: "My New Template",
        description: "A test template",
        tags: ["test"],
        config: { maxTurns: 10 },
      }),
    });
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe("my-new-template");
    expect(body.name).toBe("My New Template");
    expect(body.builtIn).toBe(false);
    expect(body.createdAt).toBeTruthy();

    // Verify persisted
    const raw = await readFile(join(henchDir, "templates.json"), "utf-8");
    const saved = JSON.parse(raw);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("my-new-template");
  });

  it("POST /api/hench/templates rejects built-in template ID", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "quick-iteration",
        name: "Override",
        description: "Should fail",
        config: {},
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/hench/templates rejects invalid ID format", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "Invalid ID",
        config: {},
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/hench/templates rejects missing ID", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No ID",
        config: {},
      }),
    });
    expect(res.status).toBe(400);
  });

  // ── POST /api/hench/templates/:id/apply ─────────────────────────────

  it("POST /api/hench/templates/:id/apply applies template to config", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates/quick-iteration/apply`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.applied).toBe("quick-iteration");
    expect(body.templateName).toBe("Quick Iteration");
    expect(body.config).toBeDefined();
    expect(body.config.maxTurns).toBe(15);
    expect(body.config.tokenBudget).toBe(50000);

    // Verify persisted
    const raw = await readFile(join(henchDir, "config.json"), "utf-8");
    const saved = JSON.parse(raw);
    expect(saved.maxTurns).toBe(15);
  });

  it("POST /api/hench/templates/:id/apply preserves untouched fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates/quick-iteration/apply`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    // These should be preserved from original config
    expect(body.config.provider).toBe("cli");
    expect(body.config.model).toBe("sonnet");
    expect(body.config.schema).toBe("hench/v1");
  });

  it("POST /api/hench/templates/:id/apply returns 404 for unknown template", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates/nonexistent/apply`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/hench/templates/:id/apply returns 404 when no config", async () => {
    await rm(join(henchDir, "config.json"));

    const res = await fetch(`http://localhost:${port}/api/hench/templates/quick-iteration/apply`, {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  // ── DELETE /api/hench/templates/:id ─────────────────────────────────

  it("DELETE /api/hench/templates/:id deletes a user template", async () => {
    // Create a template first
    await writeFile(
      join(henchDir, "templates.json"),
      JSON.stringify([{
        id: "to-delete",
        name: "To Delete",
        description: "Will be deleted",
        useCases: [],
        tags: [],
        config: {},
        builtIn: false,
      }]),
    );

    const res = await fetch(`http://localhost:${port}/api/hench/templates/to-delete`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deleted).toBe("to-delete");

    // Verify persisted
    const raw = await readFile(join(henchDir, "templates.json"), "utf-8");
    const saved = JSON.parse(raw);
    expect(saved).toHaveLength(0);
  });

  it("DELETE /api/hench/templates/:id rejects built-in templates", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates/quick-iteration`, {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /api/hench/templates/:id returns 404 for unknown template", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/templates/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

/**
 * Integration test: smart-add web endpoint → rex CLI command dispatch.
 *
 * Verifies that POST /api/rex/smart-add-preview constructs the correct
 * `rex add` CLI invocation (not `rex smart-add`, which was a regression).
 * Mocks @n-dx/llm-client exec to capture the spawned command without
 * running a real rex process.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";

// ── Mock @n-dx/llm-client ─────────────────────────────────────────────────
// Capture exec() calls so we can assert the CLI args without spawning a process.

interface CapturedExec {
  cmd: string;
  args: string[];
  opts: Record<string, unknown>;
}

const execCalls: CapturedExec[] = [];
let mockExecResult: { stdout: string; stderr: string; exitCode: number | null; error: Error | null } = {
  stdout: JSON.stringify({ proposals: [] }),
  stderr: "",
  exitCode: 0,
  error: null,
};

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@n-dx/llm-client")>();
  return {
    ...original,
    exec: vi.fn(async (cmd: string, args: string[], opts: Record<string, unknown>) => {
      execCalls.push({ cmd, args, opts });
      return { ...mockExecResult };
    }),
  };
});

// Import AFTER mock registration
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import type { ServerContext } from "../../src/server/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makePRD() {
  return {
    schema: "rex/v1",
    title: "Test Project",
    items: [
      {
        id: "epic-1",
        title: "Epic One",
        status: "pending",
        level: "epic",
        priority: "high",
        children: [],
      },
    ],
  };
}

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleRexRoute(req, res, ctx);
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

async function post(port: number, path: string, body: unknown): Promise<Response> {
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("smart-add endpoint → rex CLI dispatch", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execCalls.length = 0;
    mockExecResult = {
      stdout: JSON.stringify({ proposals: [] }),
      stderr: "",
      exitCode: 0,
      error: null,
    };

    tmpDir = await mkdtemp(join(tmpdir(), "smart-add-test-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "prd.json"), JSON.stringify(makePRD(), null, 2));

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Happy path ────────────────────────────────────────────────────────

  it("dispatches rex CLI with 'add' command (not 'smart-add')", async () => {
    mockExecResult = {
      stdout: JSON.stringify({
        proposals: [
          {
            epic: { title: "Auth system", description: "Add authentication" },
            features: [{ title: "Login page", description: "User login" }],
          },
        ],
      }),
      stderr: "",
      exitCode: 0,
      error: null,
    };

    const res = await post(port, "/api/rex/smart-add-preview", {
      text: "Add an authentication system with a login page",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposals).toHaveLength(1);
    expect(data.proposals[0].epic.title).toBe("Auth system");

    // Core assertion: the CLI was invoked with "add", not "smart-add"
    expect(execCalls).toHaveLength(1);
    const call = execCalls[0];
    expect(call.args).toContain("add");
    expect(call.args).not.toContain("smart-add");
    expect(call.args).toContain("--format=json");
  });

  it("fails when command name is 'smart-add' (regression guard)", async () => {
    // Simulate what happens when the wrong command name is used:
    // rex CLI returns "Unknown command: smart-add" on stderr
    mockExecResult = {
      stdout: "",
      stderr: "Unknown command: smart-add",
      exitCode: 1,
      error: new Error("Unknown command: smart-add"),
    };

    const res = await post(port, "/api/rex/smart-add-preview", {
      text: "Add an authentication system with a login page",
    });

    // The handler surfaces the error as a 500
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Unknown command: smart-add");
  });

  it("passes parentId as --parent flag when provided", async () => {
    const res = await post(port, "/api/rex/smart-add-preview", {
      text: "Add a login page under the auth epic",
      parentId: "epic-1",
    });

    expect(res.status).toBe(200);
    expect(execCalls).toHaveLength(1);
    const call = execCalls[0];
    expect(call.args).toContain("--parent");
    const parentIdx = call.args.indexOf("--parent");
    expect(call.args[parentIdx + 1]).toBe("epic-1");
  });

  it("includes the project dir as the last positional argument", async () => {
    const res = await post(port, "/api/rex/smart-add-preview", {
      text: "Add a new dashboard feature",
    });

    expect(res.status).toBe(200);
    expect(execCalls).toHaveLength(1);
    const call = execCalls[0];
    // Last arg should be the project directory
    expect(call.args[call.args.length - 1]).toBe(tmpDir);
  });

  // ── Error cases ───────────────────────────────────────────────────────

  it("returns 400 when text is missing", async () => {
    const res = await post(port, "/api/rex/smart-add-preview", {});
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/text/i);
    // No CLI should have been invoked
    expect(execCalls).toHaveLength(0);
  });

  it("returns 400 when text is empty string", async () => {
    const res = await post(port, "/api/rex/smart-add-preview", { text: "" });
    expect(res.status).toBe(400);
    expect(execCalls).toHaveLength(0);
  });

  it("returns empty proposals for text shorter than 5 chars", async () => {
    const res = await post(port, "/api/rex/smart-add-preview", { text: "hi" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposals).toEqual([]);
    expect(data.confidence).toBe(0);
    // Short text should skip the CLI call entirely
    expect(execCalls).toHaveLength(0);
  });

  it("returns 500 when CLI produces an error", async () => {
    mockExecResult = {
      stdout: "",
      stderr: "Something went wrong",
      exitCode: 1,
      error: new Error("Something went wrong"),
    };

    const res = await post(port, "/api/rex/smart-add-preview", {
      text: "Add a feature that will cause an error",
    });

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("Something went wrong");
  });

  it("returns empty proposals when CLI outputs non-JSON", async () => {
    mockExecResult = {
      stdout: "This is not JSON at all",
      stderr: "",
      exitCode: 0,
      error: null,
    };

    const res = await post(port, "/api/rex/smart-add-preview", {
      text: "Add something that returns bad output",
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.proposals).toEqual([]);
    expect(data.confidence).toBe(0);
  });
});

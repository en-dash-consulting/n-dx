import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleHenchRoute(req, res, ctx);
      if (result instanceof Promise) {
        result.then((handled) => {
          if (!handled) { res.writeHead(404); res.end("Not found"); }
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

describe("Hench runs diagnostics in API", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-diag-"));
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("includes vendor and tokenDiagnosticStatus in run summary list", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    const run = {
      id: "run-diag-1",
      taskId: "t1",
      taskTitle: "Diagnostics task",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 5,
      model: "sonnet",
      tokenUsage: { input: 1000, output: 500 },
      toolCalls: [],
      diagnostics: {
        tokenDiagnosticStatus: "complete",
        parseMode: "stream-json",
        notes: [],
        vendor: "claude",
        sandbox: "workspace-write",
        approvals: "never",
      },
    };
    await writeFile(join(runsDir, "run-diag-1.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0].vendor).toBe("claude");
    expect(data.runs[0].tokenDiagnosticStatus).toBe("complete");
  });

  it("summary omits vendor/tokenDiagnosticStatus when diagnostics absent", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    const run = {
      id: "run-legacy-1",
      taskId: "t2",
      taskTitle: "Legacy task",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 3,
      model: "sonnet",
      tokenUsage: { input: 500, output: 200 },
      toolCalls: [],
    };
    await writeFile(join(runsDir, "run-legacy-1.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs).toHaveLength(1);
    expect(data.runs[0].vendor).toBeUndefined();
    expect(data.runs[0].tokenDiagnosticStatus).toBeUndefined();
  });

  it("detail endpoint includes full diagnostics", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    const run = {
      id: "run-detail-diag",
      taskId: "t3",
      taskTitle: "Full diagnostics task",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "completed",
      turns: 8,
      model: "opus",
      tokenUsage: { input: 2000, output: 1000 },
      toolCalls: [],
      diagnostics: {
        tokenDiagnosticStatus: "partial",
        parseMode: "json",
        notes: ["codex_usage_missing"],
        vendor: "codex",
        sandbox: "read-only",
        approvals: "on-request",
        promptSections: [
          { name: "system", byteLength: 2048 },
          { name: "brief", byteLength: 1024 },
        ],
      },
    };
    await writeFile(join(runsDir, "run-detail-diag.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs/run-detail-diag`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.diagnostics).toBeDefined();
    expect(data.diagnostics.vendor).toBe("codex");
    expect(data.diagnostics.tokenDiagnosticStatus).toBe("partial");
    expect(data.diagnostics.parseMode).toBe("json");
    expect(data.diagnostics.notes).toEqual(["codex_usage_missing"]);
    expect(data.diagnostics.sandbox).toBe("read-only");
    expect(data.diagnostics.approvals).toBe("on-request");
    expect(data.diagnostics.promptSections).toHaveLength(2);
    expect(data.diagnostics.promptSections[0].name).toBe("system");
    expect(data.diagnostics.promptSections[0].byteLength).toBe(2048);
  });

  it("surfaces partial tokenDiagnosticStatus in summary", async () => {
    const runsDir = join(tmpDir, ".hench", "runs");
    const run = {
      id: "run-partial",
      taskId: "t4",
      taskTitle: "Partial diagnostics",
      startedAt: new Date().toISOString(),
      status: "completed",
      turns: 2,
      model: "haiku",
      tokenUsage: { input: 100, output: 50 },
      toolCalls: [],
      diagnostics: {
        tokenDiagnosticStatus: "unavailable",
        parseMode: "api-sdk",
        notes: ["no_usage_data"],
        vendor: "codex",
      },
    };
    await writeFile(join(runsDir, "run-partial.json"), JSON.stringify(run));

    const res = await fetch(`http://localhost:${port}/api/hench/runs`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.runs[0].vendor).toBe("codex");
    expect(data.runs[0].tokenDiagnosticStatus).toBe("unavailable");
  });
});

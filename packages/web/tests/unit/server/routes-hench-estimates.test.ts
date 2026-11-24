import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleHenchRoute } from "../../../src/server/routes-hench.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const result = handleHenchRoute(req, res, ctx);
      const notFound = () => { res.writeHead(404); res.end("Not found"); };
      if (result instanceof Promise) void result.then((handled) => { if (!handled) notFound(); });
      else if (!result) notFound();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

describe("GET /api/hench/estimates", () => {
  let tmpDir: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-estimates-"));
    const runsDir = join(tmpDir, ".hench", "runs");
    await mkdir(runsDir, { recursive: true });
    const now = Date.now();
    // Three finished runs of 10, 20 and 30 minutes in the last day.
    for (const [i, minutes] of [10, 20, 30].entries()) {
      const started = now - (i + 1) * 60 * 60_000;
      await writeFile(join(runsDir, `run-${i}.json`), JSON.stringify({
        id: `run-${i}`,
        taskId: `task-${i}`,
        taskTitle: `Task ${i}`,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date(started + minutes * 60_000).toISOString(),
        status: "completed",
        turns: 3,
        model: "sonnet",
        tokenUsage: { input: 1000 * (i + 1), output: 500 },
        toolCalls: [],
      }));
    }
    const ctx: ServerContext = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    ({ server, port } = await startTestServer(ctx));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("answers with the median of the finished runs", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/hench/estimates`);
    expect(res.status).toBe(200);
    const body = await res.json() as { windowDays: number; overall: { runs: number; durationMs: number; tokens: number } | null };
    expect(body.windowDays).toBe(30);
    expect(body.overall?.runs).toBe(3);
    expect(body.overall?.durationMs).toBe(20 * 60_000);
    expect(body.overall?.tokens).toBe(2500);
  });
});

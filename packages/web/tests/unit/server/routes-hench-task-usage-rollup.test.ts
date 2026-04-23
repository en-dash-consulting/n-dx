/**
 * Tests the per-item rollup emitted by `/api/hench/task-usage`.
 *
 * The tree view reads `rollup` to render token columns on every level
 * (task / feature / epic). This test pins the wire shape and verifies
 * that rex's `aggregateItemTokenUsage` is correctly driving the
 * totals: `self` is direct attribution, `descendants` sums children's
 * totals, `total = self + descendants`, and `runCount` fans up.
 */
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

async function writeRun(
  runsDir: string,
  filename: string,
  taskId: string,
  tokens: { input?: number; output?: number; cacheCreationInput?: number; cacheReadInput?: number } = {},
): Promise<void> {
  await writeFile(
    join(runsDir, filename),
    JSON.stringify({
      id: filename.replace(/\.json$/, ""),
      taskId,
      startedAt: new Date().toISOString(),
      status: "completed",
      tokenUsage: {
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        ...(tokens.cacheCreationInput !== undefined ? { cacheCreationInput: tokens.cacheCreationInput } : {}),
        ...(tokens.cacheReadInput !== undefined ? { cacheReadInput: tokens.cacheReadInput } : {}),
      },
    }),
    "utf-8",
  );
}

async function writePRD(
  rexDir: string,
  items: unknown[],
): Promise<void> {
  await mkdir(rexDir, { recursive: true });
  const doc = {
    schema: "rex/v1",
    title: "Test PRD",
    items,
  };
  await writeFile(join(rexDir, "prd.json"), JSON.stringify(doc), "utf-8");
}

describe("GET /api/hench/task-usage — rollup", () => {
  let tmpDir: string;
  let runsDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rollup-route-"));
    runsDir = join(tmpDir, ".hench", "runs");
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

  it("returns an empty rollup when the PRD is missing", async () => {
    await writeRun(runsDir, "run-1.json", "task-a", { input: 100, output: 50 });
    const res = await fetch(`http://localhost:${port}/api/hench/task-usage`);
    const data = await res.json();
    expect(data).toHaveProperty("taskUsage");
    expect(data).toHaveProperty("rollup");
    expect(data.rollup).toEqual({});
  });

  it("rolls up self usage into ancestors and emits the full contract", async () => {
    //   epic
    //     └─ feature
    //          ├─ task-a (runs: 150 + 75 tokens, 2 runs)
    //          └─ task-b (runs: 400 tokens, 1 run)
    await writePRD(ctx.rexDir, [
      {
        id: "epic", title: "E", level: "epic", status: "pending",
        children: [
          {
            id: "feature", title: "F", level: "feature", status: "pending",
            children: [
              { id: "task-a", title: "A", level: "task", status: "completed" },
              { id: "task-b", title: "B", level: "task", status: "completed" },
            ],
          },
        ],
      },
    ]);
    await writeRun(runsDir, "run-1.json", "task-a", { input: 100, output: 50 });
    await writeRun(runsDir, "run-2.json", "task-a", { input: 50, output: 25 });
    await writeRun(runsDir, "run-3.json", "task-b", { input: 300, output: 100 });

    const res = await fetch(`http://localhost:${port}/api/hench/task-usage`);
    const data = await res.json();

    // Leaves carry only self attribution.
    expect(data.rollup["task-a"]).toEqual({
      self: { totalTokens: 225, runCount: 2 },
      descendants: { totalTokens: 0, runCount: 0 },
      total: { totalTokens: 225, runCount: 2 },
    });
    expect(data.rollup["task-b"]).toEqual({
      self: { totalTokens: 400, runCount: 1 },
      descendants: { totalTokens: 0, runCount: 0 },
      total: { totalTokens: 400, runCount: 1 },
    });

    // Feature rolls up both tasks.
    expect(data.rollup["feature"]).toEqual({
      self: { totalTokens: 0, runCount: 0 },
      descendants: { totalTokens: 625, runCount: 3 },
      total: { totalTokens: 625, runCount: 3 },
    });

    // Epic rolls up the feature.
    expect(data.rollup["epic"]).toEqual({
      self: { totalTokens: 0, runCount: 0 },
      descendants: { totalTokens: 625, runCount: 3 },
      total: { totalTokens: 625, runCount: 3 },
    });

    // Flat taskUsage is still present for backward compatibility.
    expect(data.taskUsage["task-a"]).toEqual({ totalTokens: 225, runCount: 2 });
    expect(data.taskUsage["task-b"]).toEqual({ totalTokens: 400, runCount: 1 });
  });

  it("includes self and descendant counts when a container also has its own runs", async () => {
    //  feature (has a run directly attributed — unusual but valid)
    //    └─ task-x (one run)
    await writePRD(ctx.rexDir, [
      {
        id: "feature", title: "F", level: "feature", status: "pending",
        children: [
          { id: "task-x", title: "X", level: "task", status: "completed" },
        ],
      },
    ]);
    await writeRun(runsDir, "f-run.json", "feature", { input: 10, output: 10 });
    await writeRun(runsDir, "x-run.json", "task-x", { input: 30, output: 20 });

    const res = await fetch(`http://localhost:${port}/api/hench/task-usage`);
    const data = await res.json();

    expect(data.rollup["feature"]).toEqual({
      self: { totalTokens: 20, runCount: 1 },
      descendants: { totalTokens: 50, runCount: 1 },
      total: { totalTokens: 70, runCount: 2 },
    });
  });

  it("omits rollup entries for items with no runs but keeps their keys present", async () => {
    await writePRD(ctx.rexDir, [
      { id: "lonely", title: "L", level: "task", status: "pending" },
    ]);
    const res = await fetch(`http://localhost:${port}/api/hench/task-usage`);
    const data = await res.json();
    expect(data.rollup["lonely"]).toEqual({
      self: { totalTokens: 0, runCount: 0 },
      descendants: { totalTokens: 0, runCount: 0 },
      total: { totalTokens: 0, runCount: 0 },
    });
  });
});

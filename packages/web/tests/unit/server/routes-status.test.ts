import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import {
  handleStatusRoute,
  clearStatusCache,
} from "../../../src/server/routes-status.js";

/** Start a test server that only runs status routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (handleStatusRoute(req, res, ctx)) return;
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

describe("Status API routes", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    clearStatusCache();
    tmpDir = await mkdtemp(join(tmpdir(), "status-api-"));
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

  it("GET /api/status returns project status", async () => {
    const res = await fetch(`http://localhost:${port}/api/status`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const data = await res.json();
    expect(data).toHaveProperty("sv");
    expect(data).toHaveProperty("rex");
    expect(data).toHaveProperty("hench");
  });

  it("returns 404 for non-status routes", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
  });

  it("returns 404 for POST to /api/status", async () => {
    const res = await fetch(`http://localhost:${port}/api/status`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  describe("SourceVision status", () => {
    it("reports unavailable when no manifest exists", async () => {
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.sv.freshness).toBe("unavailable");
      expect(data.sv.analyzedAt).toBeNull();
      expect(data.sv.minutesAgo).toBeNull();
      expect(data.sv.modulesComplete).toBe(0);
      expect(data.sv.modulesTotal).toBe(5);
    });

    it("reports fresh when manifest is recent", async () => {
      const manifest = {
        schemaVersion: "1",
        toolVersion: "0.1.0",
        analyzedAt: new Date().toISOString(),
        targetPath: tmpDir,
        modules: {
          inventory: { status: "complete" },
          imports: { status: "complete" },
          zones: { status: "complete" },
          components: { status: "running" },
        },
      };
      await writeFile(join(ctx.svDir, "manifest.json"), JSON.stringify(manifest));

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.sv.freshness).toBe("fresh");
      expect(data.sv.analyzedAt).toBeTruthy();
      expect(data.sv.minutesAgo).toBeLessThanOrEqual(1);
      expect(data.sv.modulesComplete).toBe(3);
    });

    it("reports stale when analysis is old", async () => {
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const manifest = {
        schemaVersion: "1",
        toolVersion: "0.1.0",
        analyzedAt: oldDate,
        targetPath: tmpDir,
        modules: {
          inventory: { status: "complete" },
          imports: { status: "complete" },
          zones: { status: "complete" },
          components: { status: "complete" },
          callgraph: { status: "complete" },
        },
      };
      await writeFile(join(ctx.svDir, "manifest.json"), JSON.stringify(manifest));

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.sv.freshness).toBe("stale");
      expect(data.sv.minutesAgo).toBeGreaterThan(24 * 60);
      expect(data.sv.modulesComplete).toBe(5);
    });
  });

  describe("Rex status", () => {
    it("reports no PRD when prd.json does not exist", async () => {
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.rex.exists).toBe(false);
      expect(data.rex.percentComplete).toBe(0);
      expect(data.rex.stats).toBeNull();
    });

    it("reports PRD completion when prd.json exists", async () => {
      const prd = {
        schema: "rex/v1",
        title: "Test PRD",
        version: "1.0",
        items: [
          {
            id: "e1",
            title: "Epic 1",
            level: "epic",
            status: "in_progress",
            children: [
              { id: "f1", title: "Feature 1", level: "feature", status: "in_progress", children: [
                { id: "t1", title: "Task 1", level: "task", status: "completed", children: [] },
                { id: "t2", title: "Task 2", level: "task", status: "pending", children: [] },
                { id: "t3", title: "Task 3", level: "task", status: "in_progress", children: [] },
              ]},
            ],
          },
        ],
      };
      await writeFile(join(ctx.rexDir, "prd.json"), JSON.stringify(prd));

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.rex.exists).toBe(true);
      expect(data.rex.stats).not.toBeNull();
      expect(data.rex.stats.total).toBeGreaterThan(0);
      expect(data.rex.stats.completed).toBeGreaterThan(0);
      expect(data.rex.hasInProgress).toBe(true);
      expect(data.rex.hasPending).toBe(true);
      expect(data.rex.percentComplete).toBeGreaterThan(0);
      expect(data.rex.percentComplete).toBeLessThan(100);
    });

    it("reports 100% when all tasks are completed", async () => {
      const prd = {
        schema: "rex/v1",
        title: "Done PRD",
        version: "1.0",
        items: [
          {
            id: "e1",
            title: "Epic 1",
            level: "epic",
            status: "completed",
            children: [
              { id: "f1", title: "Feature 1", level: "feature", status: "completed", children: [
                { id: "t1", title: "Task 1", level: "task", status: "completed", children: [] },
              ]},
            ],
          },
        ],
      };
      await writeFile(join(ctx.rexDir, "prd.json"), JSON.stringify(prd));

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.rex.percentComplete).toBe(100);
      expect(data.rex.hasPending).toBe(false);
      expect(data.rex.hasInProgress).toBe(false);
    });

    describe("item attribution", () => {
      it("returns empty items array when no PRD exists", async () => {
        const res = await fetch(`http://localhost:${port}/api/status`);
        const data = await res.json();
        expect(data.rex.items).toEqual([]);
      });

      it("includes all item nodes with null attribution when no fields set", async () => {
        const prd = {
          schema: "rex/v1",
          title: "Test PRD",
          version: "1.0",
          items: [
            {
              id: "e1",
              title: "Epic 1",
              level: "epic",
              status: "pending",
              children: [
                { id: "t1", title: "Task 1", level: "task", status: "pending", children: [] },
              ],
            },
          ],
        };
        await writeFile(join(ctx.rexDir, "prd.json"), JSON.stringify(prd));

        clearStatusCache();
        const res = await fetch(`http://localhost:${port}/api/status`);
        const data = await res.json();

        expect(data.rex.items).toHaveLength(2);
        for (const item of data.rex.items) {
          expect(item).toHaveProperty("id");
          expect(item.branch).toBeNull();
          expect(item.sourceFile).toBeNull();
        }
      });

      it("propagates branch and sourceFile when set, null when absent", async () => {
        const prd = {
          schema: "rex/v1",
          title: "Branch PRD",
          version: "1.0",
          items: [
            {
              id: "e1",
              title: "Epic 1",
              level: "epic",
              status: "in_progress",
              branch: "feature/my-epic",
              sourceFile: ".rex/prd_feature-my-epic_20260101.md",
              children: [
                {
                  id: "t1",
                  title: "Task 1",
                  level: "task",
                  status: "pending",
                  children: [],
                  // no branch or sourceFile
                },
              ],
            },
          ],
        };
        await writeFile(join(ctx.rexDir, "prd.json"), JSON.stringify(prd));

        clearStatusCache();
        const res = await fetch(`http://localhost:${port}/api/status`);
        const data = await res.json();

        const byId = Object.fromEntries(
          (data.rex.items as Array<{ id: string; branch: string | null; sourceFile: string | null }>)
            .map((item) => [item.id, item]),
        );

        expect(byId["e1"].branch).toBe("feature/my-epic");
        expect(byId["e1"].sourceFile).toBe(".rex/prd_feature-my-epic_20260101.md");
        expect(byId["t1"].branch).toBeNull();
        expect(byId["t1"].sourceFile).toBeNull();
      });
    });
  });

  describe("Hench status", () => {
    it("reports not configured when no hench dir", async () => {
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.hench.configured).toBe(false);
      expect(data.hench.totalRuns).toBe(0);
    });

    it("reports configured when config.json exists", async () => {
      const henchDir = join(tmpDir, ".hench");
      await mkdir(henchDir, { recursive: true });
      await writeFile(join(henchDir, "config.json"), JSON.stringify({ model: "test" }));

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.hench.configured).toBe(true);
    });

    it("counts run JSON files", async () => {
      const runsDir = join(tmpDir, ".hench", "runs");
      await mkdir(runsDir, { recursive: true });
      const run1 = {
        id: "run-1", taskId: "t1", taskTitle: "Task 1",
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        status: "completed", turns: 5,
        tokenUsage: { input: 100, output: 50 }, toolCalls: [], model: "sonnet",
      };
      const run2 = {
        id: "run-2", taskId: "t2", taskTitle: "Task 2",
        startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        status: "completed", turns: 3,
        tokenUsage: { input: 200, output: 100 }, toolCalls: [], model: "sonnet",
      };
      await writeFile(join(runsDir, "run-1.json"), JSON.stringify(run1));
      await writeFile(join(runsDir, "run-2.json"), JSON.stringify(run2));
      await writeFile(join(join(tmpDir, ".hench"), "config.json"), "{}");

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.hench.totalRuns).toBe(2);
    });

    it("excludes malformed and incomplete run files from totalRuns count", async () => {
      const runsDir = join(tmpDir, ".hench", "runs");
      await mkdir(runsDir, { recursive: true });
      await writeFile(join(join(tmpDir, ".hench"), "config.json"), "{}");

      // Valid run
      const validRun = {
        id: "valid-1", taskId: "t1", taskTitle: "Valid Task",
        startedAt: new Date().toISOString(), status: "completed",
        turns: 3, tokenUsage: { input: 100, output: 50 }, model: "sonnet",
      };
      await writeFile(join(runsDir, "valid-1.json"), JSON.stringify(validRun));

      // Malformed JSON (not parseable)
      await writeFile(join(runsDir, "corrupt.json"), "{ invalid json }");

      // Missing id field
      await writeFile(join(runsDir, "no-id.json"), JSON.stringify({
        startedAt: new Date().toISOString(), status: "completed",
      }));

      // Missing startedAt field
      await writeFile(join(runsDir, "no-started.json"), JSON.stringify({
        id: "no-started", status: "completed",
      }));

      // Empty object
      await writeFile(join(runsDir, "empty.json"), "{}");

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      // Only the valid run should be counted — matches GET /api/hench/runs behavior
      expect(data.hench.totalRuns).toBe(1);
    });

    it("detects stale running runs", async () => {
      const henchDir = join(tmpDir, ".hench");
      const runsDir = join(henchDir, "runs");
      await mkdir(runsDir, { recursive: true });
      await writeFile(join(henchDir, "config.json"), "{}");

      const staleRun = {
        id: "stale-run-1", taskId: "task-1", taskTitle: "Stale Task",
        startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        status: "running",
        lastActivityAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        turns: 5,
        tokenUsage: { input: 1000, output: 500 }, toolCalls: [], model: "sonnet",
      };
      await writeFile(join(runsDir, "stale-run-1.json"), JSON.stringify(staleRun));

      const completedRun = {
        id: "done-run-1", taskId: "task-2", taskTitle: "Done Task",
        startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        finishedAt: new Date(Date.now() - 55 * 60 * 1000).toISOString(),
        status: "completed", turns: 10,
        tokenUsage: { input: 2000, output: 1000 }, toolCalls: [], model: "sonnet",
      };
      await writeFile(join(runsDir, "done-run-1.json"), JSON.stringify(completedRun));

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.hench.totalRuns).toBe(2);
      expect(data.hench.activeRuns).toBe(1);
      expect(data.hench.staleRuns).toBe(1);
    });

    it("reports zero stale runs when running run is fresh", async () => {
      const henchDir = join(tmpDir, ".hench");
      const runsDir = join(henchDir, "runs");
      await mkdir(runsDir, { recursive: true });
      await writeFile(join(henchDir, "config.json"), "{}");

      const freshRun = {
        id: "fresh-run-1", taskId: "task-1", taskTitle: "Fresh Task",
        startedAt: new Date().toISOString(),
        status: "running",
        lastActivityAt: new Date().toISOString(),
        turns: 2,
        tokenUsage: { input: 500, output: 200 }, toolCalls: [], model: "sonnet",
      };
      await writeFile(join(runsDir, "fresh-run-1.json"), JSON.stringify(freshRun));

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.hench.activeRuns).toBe(1);
      expect(data.hench.staleRuns).toBe(0);
    });

    it("treats running run without lastActivityAt as stale (legacy compat)", async () => {
      const henchDir = join(tmpDir, ".hench");
      const runsDir = join(henchDir, "runs");
      await mkdir(runsDir, { recursive: true });
      await writeFile(join(henchDir, "config.json"), "{}");

      const legacyRun = {
        id: "legacy-run-1", taskId: "task-1", taskTitle: "Legacy Task",
        startedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        status: "running", turns: 5,
        tokenUsage: { input: 1000, output: 500 }, toolCalls: [], model: "sonnet",
      };
      await writeFile(join(runsDir, "legacy-run-1.json"), JSON.stringify(legacyRun));

      clearStatusCache();
      const res = await fetch(`http://localhost:${port}/api/status`);
      const data = await res.json();
      expect(data.hench.staleRuns).toBe(1);
    });
  });

  describe("caching", () => {
    it("caches status across requests", async () => {
      const manifest = {
        schemaVersion: "1",
        analyzedAt: new Date().toISOString(),
        modules: { inventory: { status: "complete" } },
      };
      await writeFile(join(ctx.svDir, "manifest.json"), JSON.stringify(manifest));

      const res1 = await fetch(`http://localhost:${port}/api/status`);
      const data1 = await res1.json();
      expect(data1.sv.modulesComplete).toBe(1);

      // Modify manifest — should still return cached value within TTL
      const manifest2 = {
        schemaVersion: "1",
        analyzedAt: new Date().toISOString(),
        modules: {
          inventory: { status: "complete" },
          imports: { status: "complete" },
        },
      };
      await writeFile(join(ctx.svDir, "manifest.json"), JSON.stringify(manifest2));

      const res2 = await fetch(`http://localhost:${port}/api/status`);
      const data2 = await res2.json();
      // Should still be cached (5s TTL)
      expect(data2.sv.modulesComplete).toBe(1);
    });
  });
});

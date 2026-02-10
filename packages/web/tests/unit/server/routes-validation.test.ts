import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleValidationRoute } from "../../../src/server/routes-validation.js";

/** Create a minimal valid PRD document. */
function makePRD(items: unknown[]) {
  return {
    schema: "rex/v1",
    title: "Test PRD",
    items,
  };
}

/** Start a test server that only runs validation routes. */
function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (handleValidationRoute(req, res, ctx)) return;
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

describe("Validation & Dependency Graph API routes", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "validation-api-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const result = await startTestServer(ctx);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── GET /api/rex/validate ──────────────────────────────────────────

  describe("GET /api/rex/validate", () => {
    it("returns 404 when no PRD exists", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/validate`);
      expect(res.status).toBe(404);
    });

    it("returns all-pass for a valid PRD", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "epic-1",
            title: "Test Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "feat-1",
                title: "Test Feature",
                level: "feature",
                status: "pending",
                children: [
                  {
                    id: "task-1",
                    title: "Test Task",
                    level: "task",
                    status: "pending",
                  },
                ],
              },
            ],
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/validate`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.summary.failed).toBe(0);
    });

    it("detects orphaned items", async () => {
      // A feature at root level is invalid
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "feat-1",
            title: "Orphaned Feature",
            level: "feature",
            status: "pending",
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/validate`);
      const data = await res.json();
      expect(data.ok).toBe(false);
      const hierarchyCheck = data.checks.find((c: { name: string }) => c.name === "hierarchy placement");
      expect(hierarchyCheck.pass).toBe(false);
      expect(hierarchyCheck.errors.length).toBeGreaterThan(0);
      expect(hierarchyCheck.errors[0].itemId).toBe("feat-1");
    });

    it("detects blockedBy cycles", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "epic-1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "feat-1",
                title: "Feature",
                level: "feature",
                status: "pending",
                children: [
                  {
                    id: "task-1",
                    title: "Task A",
                    level: "task",
                    status: "pending",
                    blockedBy: ["task-2"],
                  },
                  {
                    id: "task-2",
                    title: "Task B",
                    level: "task",
                    status: "pending",
                    blockedBy: ["task-1"],
                  },
                ],
              },
            ],
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/validate`);
      const data = await res.json();
      const cycleCheck = data.checks.find((c: { name: string }) => c.name === "blockedBy cycles");
      expect(cycleCheck.pass).toBe(false);
      expect(cycleCheck.errors.length).toBeGreaterThan(0);
    });

    it("reports stuck tasks as warnings", async () => {
      const longAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString(); // 72 hours ago
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "epic-1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "feat-1",
                title: "Feature",
                level: "feature",
                status: "pending",
                children: [
                  {
                    id: "task-1",
                    title: "Stuck Task",
                    level: "task",
                    status: "in_progress",
                    startedAt: longAgo,
                  },
                ],
              },
            ],
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/validate`);
      const data = await res.json();
      // Stuck tasks are warnings, so overall validation may still pass
      const stuckCheck = data.checks.find((c: { name: string }) => c.name === "stuck tasks");
      expect(stuckCheck.pass).toBe(false);
      expect(stuckCheck.severity).toBe("warn");
      expect(stuckCheck.errors[0].itemId).toBe("task-1");
    });

    it("provides item context in errors", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "feat-1",
            title: "Misplaced Feature",
            level: "feature",
            status: "pending",
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/validate`);
      const data = await res.json();
      const check = data.checks.find((c: { name: string }) => c.name === "hierarchy placement");
      expect(check.errors[0].itemTitle).toBe("Misplaced Feature");
    });
  });

  // ── GET /api/rex/dependency-graph ──────────────────────────────────

  describe("GET /api/rex/dependency-graph", () => {
    it("returns 404 when no PRD exists", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/dependency-graph`);
      expect(res.status).toBe(404);
    });

    it("returns empty graph for PRD with no dependencies", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "epic-1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "feat-1",
                title: "Feature",
                level: "feature",
                status: "pending",
                children: [
                  { id: "task-1", title: "Task A", level: "task", status: "pending" },
                  { id: "task-2", title: "Task B", level: "task", status: "pending" },
                ],
              },
            ],
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/dependency-graph`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.nodes).toHaveLength(0);
      expect(data.edges).toHaveLength(0);
    });

    it("builds graph from blockedBy relationships", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "epic-1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "feat-1",
                title: "Feature",
                level: "feature",
                status: "pending",
                children: [
                  { id: "task-1", title: "Auth", level: "task", status: "completed" },
                  { id: "task-2", title: "Dashboard", level: "task", status: "pending", blockedBy: ["task-1"] },
                  { id: "task-3", title: "Settings", level: "task", status: "pending", blockedBy: ["task-2"] },
                ],
              },
            ],
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/dependency-graph`);
      const data = await res.json();
      expect(data.nodes.length).toBe(3);
      expect(data.edges.length).toBe(2);

      // task-1 -> task-2 edge
      const edge1 = data.edges.find((e: { source: string; target: string }) =>
        e.source === "task-1" && e.target === "task-2");
      expect(edge1).toBeDefined();
      expect(edge1.resolved).toBe(true); // task-1 is completed

      // task-2 -> task-3 edge
      const edge2 = data.edges.find((e: { source: string; target: string }) =>
        e.source === "task-2" && e.target === "task-3");
      expect(edge2).toBeDefined();
      expect(edge2.resolved).toBe(false); // task-2 is pending
    });

    it("detects cycle nodes", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "epic-1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "feat-1",
                title: "Feature",
                level: "feature",
                status: "pending",
                children: [
                  { id: "task-a", title: "A", level: "task", status: "pending", blockedBy: ["task-b"] },
                  { id: "task-b", title: "B", level: "task", status: "pending", blockedBy: ["task-a"] },
                ],
              },
            ],
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/dependency-graph`);
      const data = await res.json();
      expect(data.cycleNodeIds.length).toBeGreaterThan(0);
      expect(data.cycleNodeIds).toContain("task-a");
      expect(data.cycleNodeIds).toContain("task-b");
    });

    it("identifies critical blockers", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "epic-1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "feat-1",
                title: "Feature",
                level: "feature",
                status: "pending",
                children: [
                  { id: "task-1", title: "Foundation", level: "task", status: "pending" },
                  { id: "task-2", title: "UI", level: "task", status: "pending", blockedBy: ["task-1"] },
                  { id: "task-3", title: "API", level: "task", status: "pending", blockedBy: ["task-1"] },
                  { id: "task-4", title: "Tests", level: "task", status: "pending", blockedBy: ["task-1"] },
                ],
              },
            ],
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/dependency-graph`);
      const data = await res.json();
      expect(data.criticalBlockers.length).toBeGreaterThan(0);
      expect(data.criticalBlockers[0].id).toBe("task-1");
      expect(data.criticalBlockers[0].blockingCount).toBe(3);
    });

    it("computes blocking chains", async () => {
      await writeFile(
        join(rexDir, "prd.json"),
        JSON.stringify(makePRD([
          {
            id: "epic-1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "feat-1",
                title: "Feature",
                level: "feature",
                status: "pending",
                children: [
                  { id: "task-1", title: "First", level: "task", status: "pending" },
                  { id: "task-2", title: "Second", level: "task", status: "pending", blockedBy: ["task-1"] },
                  { id: "task-3", title: "Third", level: "task", status: "pending", blockedBy: ["task-2"] },
                ],
              },
            ],
          },
        ])),
      );

      const res = await fetch(`http://localhost:${port}/api/rex/dependency-graph`);
      const data = await res.json();
      expect(data.blockingChains.length).toBeGreaterThan(0);
      // Should have a chain of length 3: task-1 -> task-2 -> task-3
      const longestChain = data.blockingChains[0];
      expect(longestChain.path.length).toBeGreaterThanOrEqual(3);
    });
  });
});

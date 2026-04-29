import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm, unlink } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { parseDocument, serializeDocument } from "@n-dx/rex";

function readPRDFromMd(rexDir: string) {
  const raw = readFileSync(join(rexDir, "prd.md"), "utf-8");
  const result = parseDocument(raw);
  if (!result.ok) throw result.error;
  return result.data;
}

/** Minimal PRD document fixture. */
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
        children: [
          {
            id: "task-1",
            title: "First Task",
            status: "in_progress",
            level: "task",
            priority: "high",
          },
          {
            id: "task-2",
            title: "Second Task",
            status: "pending",
            level: "task",
            priority: "medium",
          },
          {
            id: "task-3",
            title: "Completed Task",
            status: "completed",
            level: "task",
            priority: "low",
            completedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}

/** Start a test server that only runs Rex routes. */
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

describe("Rex API routes", () => {
  let tmpDir: string;
  let svDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-api-"));
    svDir = join(tmpDir, ".sourcevision");
    rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "prd.md"), serializeDocument(makePRD() as never));

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/rex/prd returns full PRD document", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/prd`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe("rex/v1");
    expect(data.title).toBe("Test Project");
    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe("epic-1");
  });

  it("GET /api/rex/stats returns tree stats", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/stats`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.title).toBe("Test Project");
    expect(data.stats.total).toBe(3);
    expect(data.stats.completed).toBe(1);
    expect(data.stats.inProgress).toBe(1);
    expect(data.stats.pending).toBe(1);
    expect(data.percentComplete).toBe(33);
  });

  it("GET /api/rex/next returns next actionable task", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/next`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.task).not.toBeNull();
    // in_progress tasks come first
    expect(data.task.id).toBe("task-1");
    expect(data.task.status).toBe("in_progress");
  });

  it("GET /api/rex/items/:id returns single item", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-2`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe("task-2");
    expect(data.title).toBe("Second Task");
    expect(data.status).toBe("pending");
  });

  it("GET /api/rex/items/:id returns 404 for unknown item", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/nonexistent`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("not found");
  });

  it("PATCH /api/rex/items/:id updates item status", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify the change was persisted
    const prd = readPRDFromMd(rexDir);
    const task2 = prd.items[0].children[1];
    expect(task2.status).toBe("in_progress");
    expect(task2.startedAt).toBeDefined();
  });

  it("PATCH /api/rex/items/:id sets completedAt for completed status", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    expect(res.status).toBe(200);

    const prd = readPRDFromMd(rexDir);
    const task1 = prd.items[0].children[0];
    expect(task1.status).toBe("completed");
    expect(task1.completedAt).toBeDefined();
  });

  it("PATCH /api/rex/items/:id returns 404 for unknown item", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/nonexistent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    expect(res.status).toBe(404);
  });

  it("GET /api/rex/log returns empty entries when no log exists", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/log`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
  });

  it("GET /api/rex/log returns log entries with limit", async () => {
    const entries = [
      JSON.stringify({ timestamp: "2026-01-01T00:00:00Z", event: "task_started", itemId: "task-1" }),
      JSON.stringify({ timestamp: "2026-01-02T00:00:00Z", event: "task_completed", itemId: "task-1" }),
      JSON.stringify({ timestamp: "2026-01-03T00:00:00Z", event: "task_started", itemId: "task-2" }),
    ];
    await writeFile(join(rexDir, "execution-log.jsonl"), entries.join("\n") + "\n");

    const allRes = await fetch(`http://localhost:${port}/api/rex/log`);
    const allData = await allRes.json();
    expect(allData.entries).toHaveLength(3);

    const limitRes = await fetch(`http://localhost:${port}/api/rex/log?limit=2`);
    const limitData = await limitRes.json();
    expect(limitData.entries).toHaveLength(2);
    // Should return the last 2
    expect(limitData.entries[0].event).toBe("task_completed");
    expect(limitData.entries[1].event).toBe("task_started");
  });

  it("returns 404 when no PRD exists", async () => {
    // Remove prd.json
    const { unlink } = await import("node:fs/promises");
    await unlink(join(rexDir, "prd.md"));

    const prdRes = await fetch(`http://localhost:${port}/api/rex/prd`);
    expect(prdRes.status).toBe(404);

    const statsRes = await fetch(`http://localhost:${port}/api/rex/stats`);
    expect(statsRes.status).toBe(404);

    const nextRes = await fetch(`http://localhost:${port}/api/rex/next`);
    expect(nextRes.status).toBe(404);
  });

  it("does not handle non-Rex API paths", async () => {
    const res = await fetch(`http://localhost:${port}/api/other`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toBe("Not found");
  });

  // ── Merge endpoint tests ────────────────────────────────────────────

  describe("POST /api/rex/items/merge", () => {
    it("returns 400 with fewer than 2 source IDs", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/items/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: ["task-1"], targetId: "task-1" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when target is not in source IDs", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/items/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: ["task-1", "task-2"], targetId: "task-3" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when items are not siblings", async () => {
      // task-1 is under epic-1, we'd need another task at root level
      // to trigger the siblings error. Instead, use non-existent items.
      const res = await fetch(`http://localhost:${port}/api/rex/items/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceIds: ["task-1", "nonexistent"], targetId: "task-1" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("not found");
    });

    it("preview mode returns preview without modifying data", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/items/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: ["task-1", "task-2"],
          targetId: "task-1",
          preview: true,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.preview).toBeDefined();
      expect(data.preview.target.id).toBe("task-1");
      expect(data.preview.absorbed).toHaveLength(1);
      expect(data.preview.absorbed[0].id).toBe("task-2");

      // Verify data was NOT modified
      const prd = readPRDFromMd(rexDir);
      const taskIds = prd.items[0].children.map((t: { id: string }) => t.id);
      expect(taskIds).toContain("task-1");
      expect(taskIds).toContain("task-2");
    });

    it("merges two tasks and removes absorbed item", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/items/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: ["task-1", "task-2"],
          targetId: "task-1",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.targetId).toBe("task-1");
      expect(data.absorbedIds).toEqual(["task-2"]);

      // Verify task-2 is gone from disk
      const prd = readPRDFromMd(rexDir);
      const taskIds = prd.items[0].children.map((t: { id: string }) => t.id);
      expect(taskIds).toContain("task-1");
      expect(taskIds).not.toContain("task-2");
    });

    it("merges with custom title", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/items/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: ["task-1", "task-2"],
          targetId: "task-1",
          title: "Merged Task",
        }),
      });
      expect(res.status).toBe(200);

      const prd = readPRDFromMd(rexDir);
      const task1 = prd.items[0].children.find((t: { id: string }) => t.id === "task-1");
      expect(task1.title).toBe("Merged Task");
    });

    it("logs the merge in execution log", async () => {
      await fetch(`http://localhost:${port}/api/rex/items/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: ["task-1", "task-2"],
          targetId: "task-1",
        }),
      });

      const logPath = join(rexDir, "execution-log.jsonl");
      const logContent = readFileSync(logPath, "utf-8");
      const lines = logContent.trim().split("\n").filter(Boolean);
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      expect(lastEntry.event).toBe("items_merged");
      expect(lastEntry.itemId).toBe("task-1");
    });
  });

  // ── Prune endpoint tests ──────────────────────────────────────────

  describe("GET /api/rex/prune/preview", () => {
    it("returns empty items when nothing is prunable", async () => {
      // Rewrite PRD with no completed items
      const prd = readPRDFromMd(rexDir);
      for (const child of prd.items[0].children) {
        if (child.status === "completed") child.status = "pending";
      }
      await writeFile(join(rexDir, "prd.md"), serializeDocument(prd as never));

      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.hasPrunableItems).toBe(false);
      expect(data.items).toEqual([]);
      expect(data.totalItemCount).toBe(0);
    });

    it("identifies a completed leaf task as prunable", async () => {
      // Set all children of epic-1 to completed, then the epic itself
      const prd = readPRDFromMd(rexDir);
      for (const child of prd.items[0].children) {
        child.status = "completed";
      }
      prd.items[0].status = "completed";
      await writeFile(join(rexDir, "prd.md"), serializeDocument(prd as never));

      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.hasPrunableItems).toBe(true);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].id).toBe("epic-1");
      expect(data.items[0].totalCount).toBe(4); // epic + 3 tasks
      expect(data.totalItemCount).toBe(4);
    });

    it("finds prunable subtree within active parent", async () => {
      // Only set task-3 (already completed) as the only completed subtree
      // task-3 is a leaf node that is already completed in the fixture
      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      // task-3 is completed and a leaf, so it's prunable
      expect(data.hasPrunableItems).toBe(true);
      expect(data.items).toHaveLength(1);
      expect(data.items[0].id).toBe("task-3");
      expect(data.items[0].totalCount).toBe(1);
    });

    it("returns 404 when no PRD exists", async () => {
      const { unlink } = await import("node:fs/promises");
      await unlink(join(rexDir, "prd.md"));

      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      expect(res.status).toBe(404);
    });

    it("returns estimated storage savings and level breakdown", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      // Should include storage estimation fields
      expect(data.estimatedBytes).toBeGreaterThan(0);
      expect(data.totalPrdBytes).toBeGreaterThan(0);
      expect(data.estimatedBytes).toBeLessThanOrEqual(data.totalPrdBytes);
      // Should include level breakdown
      expect(data.levelBreakdown).toBeDefined();
      expect(data.levelBreakdown.task).toBe(1); // task-3 is a completed task
      // Should echo back criteria defaults
      expect(data.criteria).toBeDefined();
      expect(data.criteria.minAgeDays).toBe(0);
      expect(data.criteria.statuses).toEqual(["completed"]);
    });

    it("filters by minAge query parameter", async () => {
      // task-3 was completed on 2026-01-01 — more than 30 days ago
      // With minAge=0, it should be prunable
      const res0 = await fetch(`http://localhost:${port}/api/rex/prune/preview?minAge=0`);
      const data0 = await res0.json();
      expect(data0.hasPrunableItems).toBe(true);
      expect(data0.items).toHaveLength(1);

      // With minAge=99999, nothing should be old enough
      const resHigh = await fetch(`http://localhost:${port}/api/rex/prune/preview?minAge=99999`);
      const dataHigh = await resHigh.json();
      expect(dataHigh.hasPrunableItems).toBe(false);
      expect(dataHigh.items).toHaveLength(0);
    });

    it("filters by statuses query parameter", async () => {
      // Default: only "completed" — should find task-3
      const resDefault = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      const dataDefault = await resDefault.json();
      expect(dataDefault.hasPrunableItems).toBe(true);

      // Filter by "deferred" only — should find nothing
      const resDeferred = await fetch(`http://localhost:${port}/api/rex/prune/preview?statuses=deferred`);
      const dataDeferred = await resDeferred.json();
      expect(dataDeferred.hasPrunableItems).toBe(false);
      expect(dataDeferred.criteria.statuses).toEqual(["deferred"]);
    });

    it("returns completedAt in prunable items", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      const data = await res.json();
      expect(data.items).toHaveLength(1);
      expect(data.items[0].completedAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("returns prunableIds for visual diff highlighting", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      const data = await res.json();
      expect(data.prunableIds).toBeDefined();
      expect(Array.isArray(data.prunableIds)).toBe(true);
      // task-3 is a leaf, so prunableIds should contain exactly one ID
      expect(data.prunableIds).toContain("task-3");
      expect(data.prunableIds).toHaveLength(1);
    });

    it("returns prunableIds with all subtree descendants", async () => {
      // Make the entire epic fully completed so the whole subtree is prunable
      const prd = readPRDFromMd(rexDir);
      for (const child of prd.items[0].children) {
        child.status = "completed";
        child.completedAt = "2026-01-01T00:00:00.000Z";
      }
      prd.items[0].status = "completed";
      prd.items[0].completedAt = "2026-01-01T00:00:00.000Z";
      await writeFile(join(rexDir, "prd.md"), serializeDocument(prd as never));

      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      const data = await res.json();
      // prunableIds should include epic-1 + all 3 children
      expect(data.prunableIds).toHaveLength(4);
      expect(data.prunableIds).toContain("epic-1");
      expect(data.prunableIds).toContain("task-1");
      expect(data.prunableIds).toContain("task-2");
      expect(data.prunableIds).toContain("task-3");
    });

    it("returns epicImpact with before/after completion stats", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      const data = await res.json();
      expect(data.epicImpact).toBeDefined();
      expect(Array.isArray(data.epicImpact)).toBe(true);
      // epic-1 has task-3 (completed) being pruned
      expect(data.epicImpact).toHaveLength(1);
      const impact = data.epicImpact[0];
      expect(impact.id).toBe("epic-1");
      expect(impact.title).toBe("Epic One");
      // Before: 3 tasks (task-1 in_progress, task-2 pending, task-3 completed) → 1 completed / 3 total
      expect(impact.before.total).toBe(3);
      expect(impact.before.completed).toBe(1);
      expect(impact.before.pct).toBe(33);
      // After: 2 tasks (task-1 in_progress, task-2 pending) → 0 completed / 2 total
      expect(impact.after.total).toBe(2);
      expect(impact.after.completed).toBe(0);
      expect(impact.after.pct).toBe(0);
      expect(impact.removedCount).toBe(1);
    });

    it("returns empty epicImpact when nothing is prunable", async () => {
      const prd = readPRDFromMd(rexDir);
      for (const child of prd.items[0].children) {
        if (child.status === "completed") child.status = "pending";
      }
      await writeFile(join(rexDir, "prd.md"), serializeDocument(prd as never));

      const res = await fetch(`http://localhost:${port}/api/rex/prune/preview`);
      const data = await res.json();
      expect(data.epicImpact).toEqual([]);
      expect(data.prunableIds).toEqual([]);
    });
  });

  describe("POST /api/rex/prune", () => {
    it("prunes completed items and archives them", async () => {
      // task-3 is already completed and a leaf
      const res = await fetch(`http://localhost:${port}/api/rex/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCount: 1 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.prunedCount).toBe(1);
      expect(data.prunedItems).toHaveLength(1);
      expect(data.prunedItems[0].id).toBe("task-3");
      expect(data.archivedTo).toBe("archive.json");

      // Verify task-3 is gone from PRD
      const prd = readPRDFromMd(rexDir);
      const taskIds = prd.items[0].children.map((t: { id: string }) => t.id);
      expect(taskIds).not.toContain("task-3");
      expect(taskIds).toContain("task-1");
      expect(taskIds).toContain("task-2");

      // Verify archive was created
      const archive = JSON.parse(readFileSync(join(rexDir, "archive.json"), "utf-8"));
      expect(archive.schema).toBe("rex/archive/v1");
      expect(archive.batches).toHaveLength(1);
      expect(archive.batches[0].source).toBe("prune");
      expect(archive.batches[0].count).toBe(1);
    });

    it("creates a backup when requested", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup: true, confirmCount: 1 }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.backupPath).toBeDefined();

      // Verify backup file was created and contains original data
      const backupContent = readFileSync(data.backupPath, "utf-8");
      const backup = JSON.parse(backupContent);
      expect(backup.items[0].children).toHaveLength(3); // All 3 tasks in backup
    });

    it("returns nothing to prune when all items are active", async () => {
      // Remove the completed task-3
      const prd = readPRDFromMd(rexDir);
      prd.items[0].children = prd.items[0].children.filter(
        (t: { id: string }) => t.id !== "task-3",
      );
      await writeFile(join(rexDir, "prd.md"), serializeDocument(prd as never));

      const res = await fetch(`http://localhost:${port}/api/rex/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.prunedCount).toBe(0);
      expect(data.message).toBe("Nothing to prune");
    });

    it("rejects stale prune when confirmCount does not match", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCount: 999 }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toContain("Stale prune request");
    });

    it("logs the prune in execution log", async () => {
      await fetch(`http://localhost:${port}/api/rex/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmCount: 1 }),
      });

      const logPath = join(rexDir, "execution-log.jsonl");
      const logContent = readFileSync(logPath, "utf-8");
      const lines = logContent.trim().split("\n").filter(Boolean);
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      expect(lastEntry.event).toBe("items_pruned");
      expect(lastEntry.detail).toContain("Completed Task");
    });

    it("returns 404 when no PRD exists", async () => {
      const { unlink } = await import("node:fs/promises");
      await unlink(join(rexDir, "prd.md"));

      const res = await fetch(`http://localhost:${port}/api/rex/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
    });

    it("prunes with criteria filtering", async () => {
      // task-3 is completed, should be prunable with default criteria
      const res = await fetch(`http://localhost:${port}/api/rex/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmCount: 1,
          criteria: { statuses: ["completed"], minAgeDays: 0 },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.prunedCount).toBe(1);
      expect(data.prunedItems[0].id).toBe("task-3");
    });

    it("respects minAge criteria during prune execution", async () => {
      // task-3 completed on 2026-01-01 — with minAge=99999 nothing should be pruned
      const res = await fetch(`http://localhost:${port}/api/rex/prune`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          criteria: { statuses: ["completed"], minAgeDays: 99999 },
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.prunedCount).toBe(0);
      expect(data.message).toBe("Nothing to prune");
    });
  });

  // ── Accept Edited Proposals ─────────────────────────────────────

  describe("POST /api/rex/proposals/accept-edited", () => {
    it("accepts edited proposals and creates PRD items", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [{
            epic: { title: "New Epic", description: "Epic desc" },
            features: [{
              title: "New Feature",
              description: "Feature desc",
              tasks: [{
                title: "New Task",
                description: "Task desc",
                priority: "high",
                tags: ["ui", "core"],
                selected: true,
              }],
              selected: true,
            }],
            selected: true,
          }],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.acceptedCount).toBe(1);
      expect(data.addedCount).toBe(3); // epic + feature + task

      // Verify PRD was updated
      const prdRes = await fetch(`http://localhost:${port}/api/rex/prd`);
      const prd = await prdRes.json();
      const newEpic = prd.items.find((i: { title: string }) => i.title === "New Epic");
      expect(newEpic).toBeTruthy();
      expect(newEpic.description).toBe("Epic desc");
      expect(newEpic.children[0].title).toBe("New Feature");
      expect(newEpic.children[0].children[0].title).toBe("New Task");
      expect(newEpic.children[0].children[0].priority).toBe("high");
      expect(newEpic.children[0].children[0].tags).toEqual(["ui", "core"]);
    });

    it("skips deselected items", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [{
            epic: { title: "Partial Epic" },
            features: [
              {
                title: "Selected Feature",
                tasks: [
                  { title: "Selected Task", selected: true },
                  { title: "Deselected Task", selected: false },
                ],
                selected: true,
              },
              {
                title: "Deselected Feature",
                tasks: [{ title: "Task in Deselected", selected: true }],
                selected: false,
              },
            ],
            selected: true,
          }],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.addedCount).toBe(3); // epic + 1 feature + 1 task (not deselected feature/task)
    });

    it("validates required titles for selected items", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [{
            epic: { title: "" }, // empty title
            features: [],
            selected: true,
          }],
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Validation failed");
      expect(data.error).toContain("epic title is required");
    });

    it("skips validation for deselected items with empty titles", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [
            {
              epic: { title: "" },
              features: [],
              selected: false, // deselected — should not fail validation
            },
            {
              epic: { title: "Valid Epic" },
              features: [],
              selected: true,
            },
          ],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(data.addedCount).toBe(1); // only the valid epic
    });

    it("supports validate-only mode", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [{
            epic: { title: "" },
            features: [],
            selected: true,
          }],
          validateOnly: true,
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(false);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0]).toContain("epic title is required");
    });

    it("returns 400 when no proposals provided", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals: [] }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when nothing is selected", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [{
            epic: { title: "Unselected" },
            features: [],
            selected: false,
          }],
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("No items selected");
    });

    it("clears pending proposals file after acceptance", async () => {
      // Write pending proposals
      await writeFile(
        join(rexDir, "pending-proposals.json"),
        JSON.stringify([{ epic: { title: "Pending" }, features: [] }]),
      );

      await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [{
            epic: { title: "Accepted Epic" },
            features: [],
            selected: true,
          }],
        }),
      });

      const pending = JSON.parse(readFileSync(join(rexDir, "pending-proposals.json"), "utf-8"));
      expect(pending).toEqual([]);
    });

    it("logs acceptance in execution log", async () => {
      await fetch(`http://localhost:${port}/api/rex/proposals/accept-edited`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposals: [{
            epic: { title: "Logged Epic" },
            features: [],
            selected: true,
          }],
        }),
      });

      const logPath = join(rexDir, "execution-log.jsonl");
      const logContent = readFileSync(logPath, "utf-8");
      const lines = logContent.trim().split("\n").filter(Boolean);
      const lastEntry = JSON.parse(lines[lines.length - 1]);
      expect(lastEntry.event).toBe("proposals_edited_accept");
      expect(lastEntry.detail).toContain("proposal editor");
    });
  });

  describe("POST /api/rex/smart-add-preview", () => {
    it("returns 400 when text is empty", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/smart-add-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Text is required");
    });

    it("returns 400 when text field is missing", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/smart-add-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Text is required");
    });

    it("returns empty proposals for text shorter than 5 characters", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/smart-add-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "abc" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.proposals).toEqual([]);
      expect(data.confidence).toBe(0);
    });
  });

  describe("POST /api/rex/batch-import", () => {
    it("rejects request with no items", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/batch-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [] }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("At least one import item");
    });

    it("rejects request with missing items array", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/batch-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("At least one import item");
    });

    it("rejects item with empty content", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/batch-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ content: "", format: "text" }],
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("empty content");
    });

    it("rejects item with whitespace-only content", async () => {
      const res = await fetch(`http://localhost:${port}/api/rex/batch-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ content: "   ", format: "text" }],
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("empty content");
    });
  });
});

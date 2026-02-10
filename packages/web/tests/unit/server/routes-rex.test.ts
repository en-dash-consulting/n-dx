import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex.js";

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
    const prd = JSON.parse(readFileSync(join(rexDir, "prd.json"), "utf-8"));
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

    const prd = JSON.parse(readFileSync(join(rexDir, "prd.json"), "utf-8"));
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
    await unlink(join(rexDir, "prd.json"));

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
});

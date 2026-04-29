import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
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

/** PRD fixture with requirements. */
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
        requirements: [
          {
            id: "req-1",
            title: "Security audit",
            category: "security",
            validationType: "manual",
            acceptanceCriteria: ["All endpoints require auth"],
            priority: "critical",
          },
        ],
        children: [
          {
            id: "task-1",
            title: "First Task",
            status: "pending",
            level: "task",
            priority: "medium",
            requirements: [
              {
                id: "req-2",
                title: "Test coverage > 80%",
                category: "quality",
                validationType: "metric",
                acceptanceCriteria: ["Coverage must exceed 80%"],
                validationCommand: "echo 85",
                threshold: 80,
              },
            ],
          },
          {
            id: "task-2",
            title: "Second Task",
            status: "pending",
            level: "task",
            priority: "medium",
          },
        ],
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

describe("Requirements API routes", () => {
  let tmpDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-req-api-"));
    const svDir = join(tmpDir, ".sourcevision");
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

  // ── GET requirements ──────────────────────────────────────────

  it("GET /api/rex/items/:id/requirements returns own + inherited requirements", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-1/requirements`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ownCount).toBe(1);
    expect(data.own).toHaveLength(1);
    expect(data.own[0].id).toBe("req-2");

    // Should also include inherited from epic-1
    expect(data.totalCount).toBe(2);
    expect(data.inherited).toHaveLength(2);
    expect(data.inherited[0].sourceItemId).toBe("task-1"); // own first
    expect(data.inherited[1].sourceItemId).toBe("epic-1"); // then parent
  });

  it("GET /api/rex/items/:id/requirements returns only inherited for items without own", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-2/requirements`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.ownCount).toBe(0);
    expect(data.inheritedCount).toBe(1);
    expect(data.inherited[0].sourceItemId).toBe("epic-1");
  });

  it("GET /api/rex/items/:id/requirements returns 404 for unknown item", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/nonexistent/requirements`);
    expect(res.status).toBe(404);
  });

  // ── POST add requirement ──────────────────────────────────────

  it("POST /api/rex/items/:id/requirements adds a new requirement", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-2/requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Accessibility compliance",
        category: "accessibility",
        validationType: "manual",
        acceptanceCriteria: ["WCAG 2.1 AA compliant"],
        priority: "high",
      }),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.id).toBeDefined();
    expect(data.requirement.title).toBe("Accessibility compliance");
    expect(data.requirement.category).toBe("accessibility");

    // Verify persisted
    const prd = readPRDFromMd(rexDir);
    const task2 = prd.items[0].children[1];
    expect(task2.requirements).toHaveLength(1);
    expect(task2.requirements[0].title).toBe("Accessibility compliance");
  });

  it("POST /api/rex/items/:id/requirements validates required fields", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-2/requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "security", validationType: "manual" }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("title");
  });

  it("POST /api/rex/items/:id/requirements rejects invalid category", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-2/requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Bad req",
        category: "invalid",
        validationType: "manual",
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("category");
  });

  it("POST /api/rex/items/:id/requirements rejects invalid validationType", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-2/requirements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Bad req",
        category: "security",
        validationType: "invalid",
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("validationType");
  });

  // ── PATCH update requirement ──────────────────────────────────

  it("PATCH /api/rex/items/:id/requirements/:reqId updates a requirement", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-1/requirements/req-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Updated coverage requirement",
        threshold: 90,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.requirement.title).toBe("Updated coverage requirement");
    expect(data.requirement.threshold).toBe(90);
    expect(data.requirement.id).toBe("req-2"); // ID preserved

    // Verify persisted
    const prd = readPRDFromMd(rexDir);
    const task1 = prd.items[0].children[0];
    expect(task1.requirements[0].title).toBe("Updated coverage requirement");
  });

  it("PATCH /api/rex/items/:id/requirements/:reqId rejects invalid category", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-1/requirements/req-2`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "invalid" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /api/rex/items/:id/requirements/:reqId returns 404 for unknown requirement", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-1/requirements/nonexistent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Updated" }),
    });
    expect(res.status).toBe(404);
  });

  // ── DELETE requirement ────────────────────────────────────────

  it("DELETE /api/rex/items/:id/requirements/:reqId removes a requirement", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-1/requirements/req-2`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);

    // Verify removed from disk
    const prd = readPRDFromMd(rexDir);
    const task1 = prd.items[0].children[0];
    expect(task1.requirements).toBeUndefined();
  });

  it("DELETE /api/rex/items/:id/requirements/:reqId returns 404 for unknown requirement", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/items/task-1/requirements/nonexistent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  // ── Coverage endpoint ─────────────────────────────────────────

  it("GET /api/rex/requirements/coverage returns coverage stats", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/requirements/coverage`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.totalItems).toBeGreaterThan(0);
    expect(data.totalRequirements).toBe(2);
    expect(data.itemsWithRequirements).toBe(2); // epic-1 and task-1
    expect(data.coveragePercent).toBeGreaterThan(0);
    expect(data.byCategory).toBeDefined();
    expect(data.byCategory.security).toBe(1);
    expect(data.byCategory.quality).toBe(1);
    expect(data.byValidationType).toBeDefined();
    expect(data.byValidationType.manual).toBe(1);
    expect(data.byValidationType.metric).toBe(1);
  });

  // ── Traceability endpoint ─────────────────────────────────────

  it("GET /api/rex/requirements/traceability returns traceability matrix", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/requirements/traceability`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.totalRequirements).toBe(2);
    expect(data.matrix).toHaveLength(2);

    // Security req on epic-1 should apply to epic + its children
    const secReq = data.matrix.find((m: { requirement: { id: string } }) => m.requirement.id === "req-1");
    expect(secReq).toBeDefined();
    expect(secReq.definedOnItemId).toBe("epic-1");
    expect(secReq.appliesTo.length).toBeGreaterThanOrEqual(2); // epic-1 + children

    // Quality req on task-1 should apply only to task-1
    const qualReq = data.matrix.find((m: { requirement: { id: string } }) => m.requirement.id === "req-2");
    expect(qualReq).toBeDefined();
    expect(qualReq.definedOnItemId).toBe("task-1");
    expect(qualReq.appliesTo).toHaveLength(1);
  });

  // ── Dashboard requirements summary ────────────────────────────

  it("GET /api/rex/dashboard includes requirements summary", async () => {
    const res = await fetch(`http://localhost:${port}/api/rex/dashboard`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.requirements).toBeDefined();
    expect(data.requirements.totalRequirements).toBe(2);
    expect(data.requirements.itemsWithRequirements).toBe(2);
    expect(data.requirements.byCategory).toBeDefined();
    expect(data.requirements.byValidationType).toBeDefined();
  });
});

/**
 * Tests for POST /api/rex/capture-next-steps — the Overview Next Steps
 * panel's capture-to-PRD action.
 *
 * Covers: validation, item creation under the capture epic, title-based
 * dedup against the existing tree, in-request dedup, and epic reuse.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { serializeDocument } from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

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
            title: "Reduce coupling in web-shared",
            status: "pending",
            level: "task",
            priority: "medium",
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
      const result = handleRexRoute(req, res, ctx);
      if (result instanceof Promise) {
        if (await result) return;
      } else if (result) {
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("POST /api/rex/capture-next-steps", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "capture-steps-"));
    const svDir = join(tmpDir, ".sourcevision");
    const rexDir = join(tmpDir, ".rex");
    await mkdir(svDir, { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "prd.md"), serializeDocument(makePRD() as never));

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  function capture(steps: unknown) {
    return fetch(`http://127.0.0.1:${port}/api/rex/capture-next-steps`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps }),
    });
  }

  async function loadPRD() {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/prd`);
    return res.json();
  }

  it("rejects a missing or empty steps array", async () => {
    const resMissing = await capture(undefined);
    expect(resMissing.status).toBe(400);

    const resEmpty = await capture([]);
    expect(resEmpty.status).toBe(400);
  });

  it("rejects steps without titles", async () => {
    const res = await capture([{ description: "no title here" }]);
    expect(res.status).toBe(400);
  });

  it("creates features under the SourceVision Next Steps epic", async () => {
    const res = await capture([
      { title: "Fix circular dependency in hench", description: "Break the cycle", priority: "high", category: "fix" },
      { title: "Extract shared view helpers", description: "Reduce duplication", priority: "medium", category: "extract" },
    ]);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.created).toBe(2);
    expect(data.skipped).toBe(0);

    const prd = await loadPRD();
    const epic = prd.items.find((i: { title: string }) => i.title === "SourceVision Next Steps");
    expect(epic).toBeTruthy();
    expect(epic.level).toBe("epic");
    expect(epic.children).toHaveLength(2);

    const fix = epic.children.find((c: { title: string }) => c.title === "Fix circular dependency in hench");
    expect(fix.level).toBe("feature");
    expect(fix.description).toBe("Break the cycle");
    expect(fix.priority).toBe("high");
    expect(fix.tags).toContain("sourcevision");
    expect(fix.tags).toContain("next-steps");
    expect(fix.tags).toContain("fix");
  });

  it("skips steps whose titles already exist in the PRD tree", async () => {
    const res = await capture([
      { title: "Reduce coupling in web-shared", priority: "medium" }, // exists in fixture
      { title: "A genuinely new step", priority: "low" },
    ]);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.created).toBe(1);
    expect(data.skipped).toBe(1);

    const prd = await loadPRD();
    const epic = prd.items.find((i: { title: string }) => i.title === "SourceVision Next Steps");
    expect(epic.children).toHaveLength(1);
    expect(epic.children[0].title).toBe("A genuinely new step");
  });

  it("dedups by normalized title (case and whitespace insensitive)", async () => {
    const res = await capture([
      { title: "  reduce COUPLING in   web-shared " },
    ]);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.created).toBe(0);
    expect(data.skipped).toBe(1);
  });

  it("dedups repeated titles within a single request", async () => {
    const res = await capture([
      { title: "Same step twice" },
      { title: "same step twice" },
    ]);
    const data = await res.json();
    expect(data.created).toBe(1);
    expect(data.skipped).toBe(1);
  });

  it("reuses the existing capture epic on subsequent calls", async () => {
    await capture([{ title: "Step one" }]);
    await capture([{ title: "Step two" }]);

    const prd = await loadPRD();
    const epics = prd.items.filter((i: { title: string }) => i.title === "SourceVision Next Steps");
    expect(epics).toHaveLength(1);
    expect(epics[0].children).toHaveLength(2);
  });

  it("ignores invalid priorities instead of failing", async () => {
    const res = await capture([{ title: "Odd priority step", priority: "urgent" }]);
    expect(res.status).toBe(200);
    const prd = await loadPRD();
    const epic = prd.items.find((i: { title: string }) => i.title === "SourceVision Next Steps");
    expect(epic.children[0].priority).toBeUndefined();
  });
});

/**
 * Tests for POST /api/rex/capture-ask — the SourceVision Ask panel's
 * capture-to-PRD action.
 *
 * Covers: validation, item creation under the Ask capture epic, epic reuse,
 * the reported item/parent pair, and that a repeated question is captured
 * rather than deduplicated away.
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

describe("POST /api/rex/capture-ask", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "capture-ask-"));
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

  function capture(body: unknown) {
    return fetch(`http://127.0.0.1:${port}/api/rex/capture-ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function loadPRD() {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/prd`);
    return res.json();
  }

  function askEpic(prd: { items: Array<{ title: string }> }) {
    return prd.items.find((i) => i.title === "SourceVision Ask") as unknown as {
      id: string;
      level: string;
      children?: Array<Record<string, unknown>>;
    };
  }

  it("rejects a missing or blank question", async () => {
    expect((await capture({ answer: "an answer" })).status).toBe(400);
    expect((await capture({ question: "   ", answer: "an answer" })).status).toBe(400);
  });

  it("rejects a missing or blank answer", async () => {
    expect((await capture({ question: "a question" })).status).toBe(400);
    expect((await capture({ question: "a question", answer: "  \n " })).status).toBe(400);
  });

  it("writes nothing to the PRD when validation fails", async () => {
    await capture({ answer: "an orphan answer" });

    const prd = await loadPRD();
    expect(askEpic(prd)).toBeUndefined();
  });

  it("files the answer as a feature under the Ask epic", async () => {
    const res = await capture({
      question: "Which zones carry the most coupling?",
      answer: "web-composition-layer, at 0.35.",
    });
    expect(res.status).toBe(200);

    const prd = await loadPRD();
    const epic = askEpic(prd);
    expect(epic.level).toBe("epic");
    expect(epic.children).toHaveLength(1);

    const item = epic.children![0]!;
    expect(item["title"]).toBe("Which zones carry the most coupling?");
    expect(item["level"]).toBe("feature");
    expect(item["description"]).toBe("web-composition-layer, at 0.35.");
    expect(item["tags"]).toContain("sourcevision");
    expect(item["tags"]).toContain("ask");
  });

  it("reports the created item and the epic it landed under", async () => {
    const res = await capture({ question: "Which zone is the hub?", answer: "web-viewer." });
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.item.title).toBe("Which zone is the hub?");
    expect(data.item.level).toBe("feature");
    expect(data.parent.title).toBe("SourceVision Ask");
    expect(data.parent.level).toBe("epic");

    // The reported ids are the ones actually in the tree, not placeholders.
    const prd = await loadPRD();
    const epic = askEpic(prd);
    expect(data.parent.id).toBe(epic.id);
    expect(epic.children![0]!["id"]).toBe(data.item.id);
  });

  it("reuses the Ask epic on subsequent captures", async () => {
    await capture({ question: "First question", answer: "First answer" });
    await capture({ question: "Second question", answer: "Second answer" });

    const prd = await loadPRD();
    const epics = prd.items.filter((i: { title: string }) => i.title === "SourceVision Ask");
    expect(epics).toHaveLength(1);
    expect(epics[0].children).toHaveLength(2);
  });

  it("captures the same question twice rather than deduplicating it", async () => {
    // The analysis moves; a re-asked question earns a second, different answer,
    // and dropping it would silently lose the newer one.
    await capture({ question: "Which zone is the hub?", answer: "web-viewer." });
    await capture({ question: "Which zone is the hub?", answer: "Still web-viewer, now 212 files." });

    const prd = await loadPRD();
    const children = askEpic(prd).children!;
    expect(children).toHaveLength(2);
    expect(children.map((c) => c["description"])).toContain("Still web-viewer, now 212 files.");
  });

  it("elides an over-long question into a usable title and keeps the answer whole", async () => {
    const question = `${"why ".repeat(60)}?`;
    const answer = "Because the import graph says so.";
    const res = await capture({ question, answer });
    const data = await res.json();

    expect(data.item.title.length).toBeLessThanOrEqual(120);
    expect(data.item.title.endsWith("…")).toBe(true);

    const prd = await loadPRD();
    expect(askEpic(prd).children![0]!["description"]).toBe(answer);
  });
});

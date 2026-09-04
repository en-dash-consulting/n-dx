/**
 * Tests for POST /api/rex/capture-ask — the SourceVision Ask panel's
 * capture-to-PRD action.
 *
 * Covers: validation, the created item's level and placement, the epic
 * find-or-create and what the response says about it, title derivation from
 * the question, and the deliberate absence of the title dedup that
 * `capture-next-steps` applies.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { askCaptureTitle, askCaptureDescription } from "../../../src/server/routes-rex-analysis.js";
import { serializeDocument } from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const EPIC_TITLE = "SourceVision Ask";

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
        children: [],
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

interface CapturedItem {
  id: string;
  title: string;
  level: string;
  description?: string;
  priority?: string;
  tags?: string[];
  children?: CapturedItem[];
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

  async function loadTree(): Promise<{ items: CapturedItem[] }> {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/prd`);
    return await res.json() as { items: CapturedItem[] };
  }

  async function captureEpic(): Promise<CapturedItem | undefined> {
    const prd = await loadTree();
    return prd.items.find((i) => i.title === EPIC_TITLE);
  }

  it("rejects a request with no question or no answer", async () => {
    expect((await capture({ answer: "An answer." })).status).toBe(400);
    expect((await capture({ question: "A question?" })).status).toBe(400);
    expect((await capture({ question: "   ", answer: "An answer." })).status).toBe(400);
    expect((await capture({ question: "A question?", answer: "  \n " })).status).toBe(400);
    expect((await capture({})).status).toBe(400);

    // Nothing was written on the way to any of those rejections.
    expect(await captureEpic()).toBeUndefined();
  });

  it("files the exchange as a task under the capture epic", async () => {
    const res = await capture({
      question: "Which zones are most coupled?",
      answer: "`web-viewer` is the hub; split the composition layer.",
    });
    // The route funnels every internal failure into a 400 carrying the error
    // text, so a bare status assertion reports "expected 400 to be 200" and
    // nothing else. Carrying the body into the message is the difference
    // between a diagnosable failure and a rerun.
    expect(res.status, await res.clone().text()).toBe(200);

    const epic = await captureEpic();
    expect(epic?.level).toBe("epic");
    expect(epic?.children).toHaveLength(1);

    const item = epic!.children![0];
    // A task, not a feature: LEVEL_HIERARCHY accepts a task under an epic, so
    // no filler feature has to be invented to hold an actionable item.
    expect(item.level).toBe("task");
    expect(item.title).toBe("Which zones are most coupled?");
    expect(item.description).toContain("Which zones are most coupled?");
    expect(item.description).toContain("`web-viewer` is the hub; split the composition layer.");
    expect(item.tags).toContain("sourcevision");
    expect(item.tags).toContain("ask");
  });

  it("reports the created item and its parent, and whether the epic is new", async () => {
    const first = await capture({ question: "First question?", answer: "First answer." });
    const firstBody = await first.json();
    expect(firstBody.ok).toBe(true);
    expect(firstBody.item.title).toBe("First question?");
    expect(firstBody.item.level).toBe("task");
    expect(typeof firstBody.item.id).toBe("string");
    expect(firstBody.parent.title).toBe(EPIC_TITLE);
    expect(firstBody.parent.level).toBe("epic");
    expect(firstBody.parent.created).toBe(true);

    const second = await capture({ question: "Second question?", answer: "Second answer." });
    const secondBody = await second.json();
    // The second capture reuses the epic, and says so.
    expect(secondBody.parent.created).toBe(false);
    expect(secondBody.parent.id).toBe(firstBody.parent.id);

    const prd = await loadTree();
    expect(prd.items.filter((i) => i.title === EPIC_TITLE)).toHaveLength(1);
    expect((await captureEpic())?.children).toHaveLength(2);
  });

  it("captures the same question twice rather than silently skipping it", async () => {
    // The opposite of capture-next-steps' dedup, and deliberately so: the user
    // pressed Confirm on this specific answer, so a capture that reports
    // success and writes nothing would be a lie.
    await capture({ question: "Same question?", answer: "First answer." });
    await capture({ question: "Same question?", answer: "A revised answer." });

    const children = (await captureEpic())?.children ?? [];
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.title)).toEqual(["Same question?", "Same question?"]);
    expect(new Set(children.map((c) => c.id)).size).toBe(2);

    // Membership, not index: two same-titled siblings land in
    // slug-collision-suffixed directories, and which one the parser reads back
    // first is directory order rather than insertion order.
    const descriptions = children.map((c) => c.description ?? "");
    expect(descriptions.some((d) => d.includes("First answer."))).toBe(true);
    expect(descriptions.some((d) => d.includes("A revised answer."))).toBe(true);
  });

  it("accepts a valid priority and ignores an invalid one", async () => {
    await capture({ question: "High one?", answer: "A.", priority: "high" });
    await capture({ question: "Odd one?", answer: "B.", priority: "urgent" });

    const children = (await captureEpic())!.children!;
    expect(children.find((c) => c.title === "High one?")?.priority).toBe("high");
    expect(children.find((c) => c.title === "Odd one?")?.priority).toBeUndefined();
  });

  it("elides an over-long question into a one-line title", () => {
    expect(askCaptureTitle("  Which   zones\nare coupled?  ")).toBe("Which zones are coupled?");

    const long = "x".repeat(200);
    const title = askCaptureTitle(long);
    expect(title).toHaveLength(120);
    expect(title.endsWith("…")).toBe(true);
    // A title at exactly the limit is not elided.
    expect(askCaptureTitle("y".repeat(120))).toBe("y".repeat(120));
  });

  it("keeps the whole exchange in the description even when the title is elided", async () => {
    const question = `Why is ${"very ".repeat(40)}long?`;
    const res = await capture({ question, answer: "Because." });
    expect(res.status).toBe(200);

    const item = (await captureEpic())!.children![0];
    expect(item.title.endsWith("…")).toBe(true);
    // The elision is cosmetic — nothing the user asked is lost.
    expect(item.description).toContain(question.replace(/\s+$/, ""));
    expect(item.description).toBe(askCaptureDescription(question, "Because."));
  });
});

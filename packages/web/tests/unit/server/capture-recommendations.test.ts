/**
 * Tests for POST /api/rex/capture-recommendations — the Analyze dashboard's
 * "+ PRD" on a recommendation and "Add all to PRD".
 *
 * Covers: validation; on v2, one Inbox change per recommendation with its
 * detail, zones, priority, tags and (for a readiness gap) acceptance
 * criterion; title dedup against the tree and within the request, reported
 * per item; long titles kept whole in the description; and on v1, items under
 * a find-or-create parent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { itemTypeOf } from "../../../src/shared/index.js";
import { resolveStore, serializeDocument, walkTree, type PRDItem } from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const V2_FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");

interface Started { rexDir: string; base: string; server: Server; tmpDir: string; frames: unknown[] }

async function start(layout: "v1" | "v2"): Promise<Started> {
  const tmpDir = mkdtempSync(join(tmpdir(), `capture-recs-${layout}-`));
  const rexDir = join(tmpDir, ".rex");
  const svDir = join(tmpDir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });
  if (layout === "v2") {
    cpSync(V2_FIXTURE, rexDir, { recursive: true });
  } else {
    mkdirSync(rexDir, { recursive: true });
    writeFileSync(join(rexDir, "prd.md"), serializeDocument({
      schema: "rex/v1",
      title: "Test Project",
      items: [{ id: "epic-1", title: "Epic One", status: "pending", level: "epic", children: [] }],
    } as never));
  }
  const frames: unknown[] = [];
  const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
  const server = createServer(async (req, res) => {
    if (!(await handleRexRoute(req, res, ctx, (frame) => { frames.push(frame); }))) {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  return { rexDir, server, tmpDir, frames, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/rex` };
}

async function capture(base: string, items: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/capture-recommendations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const text = await res.text();
  return { status: res.status, body: JSON.parse(text) as Record<string, unknown> };
}

async function itemsTitled(rexDir: string, title: string): Promise<PRDItem[]> {
  const doc = await (await resolveStore(rexDir)).loadDocument();
  const found: PRDItem[] = [];
  for (const { item } of walkTree(doc.items)) if (item.title === title) found.push(item);
  return found;
}

const GAP = {
  title: "Testing: No test command was detected.",
  detail: "A `test` script in a manifest.",
  kind: "gap",
  level: "high",
  zones: [],
  note: "Not on the map — closing it adds files: A `test` script in a manifest.",
  acceptanceCriteria: ["A `test` script in a manifest."],
};
const PROBLEM = {
  title: "God function: Graph in packages/web/src/viewer/views/graph.ts calls 246 unique functions",
  kind: "problem",
  level: "critical",
  zones: ["web-viewer"],
};

describe("POST /api/rex/capture-recommendations on a v2 PRD", () => {
  let s: Started;
  beforeEach(async () => { s = await start("v2"); });
  afterEach(async () => {
    await closeRouteTestServer(s.server);
    rmSync(s.tmpDir, { recursive: true, force: true });
  });

  it("adds each recommendation as an Inbox change with its detail, zones, priority and tags", async () => {
    const { status, body } = await capture(s.base, [GAP, PROBLEM]);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ ok: true, created: 2, skipped: 0, destination: "Inbox", results: ["created", "created"] });

    const [gap] = await itemsTitled(s.rexDir, GAP.title);
    expect(itemTypeOf(gap!)).toBe("change");
    expect(gap!.priority).toBe("high");
    expect(gap!.acceptanceCriteria).toEqual(["A `test` script in a manifest."]);
    expect(gap!.description).toContain("A `test` script in a manifest.");
    expect(gap!.description).toContain("SourceVision readiness gap (high)");
    expect(gap!.tags).toEqual(expect.arrayContaining(["sourcevision", "recommendation", "gap"]));

    const [problem] = await itemsTitled(s.rexDir, PROBLEM.title);
    expect(problem!.priority).toBe("critical");
    expect(problem!.description).toContain("Zones: web-viewer");
    expect(problem!.tags).toEqual(expect.arrayContaining(["problem", "zone:web-viewer"]));
    expect(s.frames.length).toBeGreaterThan(0);
  });

  it("skips what the PRD already holds and repeats within the request, saying which per item", async () => {
    const { body } = await capture(s.base, [
      { title: "add apple pay", kind: "suggestion", level: "info" },
      PROBLEM,
      { ...PROBLEM, title: `  ${PROBLEM.title.toUpperCase()} ` },
    ]);
    expect(body).toMatchObject({ created: 1, skipped: 2, results: ["exists", "created", "exists"] });
    expect(await itemsTitled(s.rexDir, PROBLEM.title)).toHaveLength(1);

    const again = await capture(s.base, [PROBLEM]);
    expect(again.body).toMatchObject({ created: 0, skipped: 1, results: ["exists"] });
  });

  it("maps a finding's severity to a priority", async () => {
    await capture(s.base, [
      { title: "Warned about", kind: "suggestion", level: "warning" },
      { title: "Noted", kind: "pattern", level: "info" },
    ]);
    expect((await itemsTitled(s.rexDir, "Warned about"))[0]!.priority).toBe("medium");
    expect((await itemsTitled(s.rexDir, "Noted"))[0]!.priority).toBe("low");
  });

  it("shortens a long title and keeps the whole text in the description", async () => {
    const long = `Zone "core" has files across 6 directories ${"and more ".repeat(20)}— consider consolidating`;
    const { body } = await capture(s.base, [{ title: long, kind: "suggestion" }]);
    expect(body).toMatchObject({ created: 1 });
    const doc = await (await resolveStore(s.rexDir)).loadDocument();
    const added = [...walkTree(doc.items)].map(({ item }) => item).find((i) => i.title.startsWith('Zone "core" has files'))!;
    expect(added.title.length).toBeLessThanOrEqual(120);
    expect(added.title.endsWith("…")).toBe(true);
    expect(added.description).toContain(long);
  });

  it("refuses a request with no items, too many, or an item without a title, writing nothing", async () => {
    expect((await capture(s.base, [])).status).toBe(400);
    expect((await capture(s.base, undefined)).status).toBe(400);
    expect((await capture(s.base, Array.from({ length: 201 }, (_, i) => ({ title: `T${i}` })))).status).toBe(400);
    const bad = await capture(s.base, [PROBLEM, { title: "  " }]);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/title/);
    expect(await itemsTitled(s.rexDir, PROBLEM.title)).toHaveLength(0);
  });
});

describe("POST /api/rex/capture-recommendations on a v1 PRD", () => {
  let s: Started;
  beforeEach(async () => { s = await start("v1"); });
  afterEach(async () => {
    await closeRouteTestServer(s.server);
    rmSync(s.tmpDir, { recursive: true, force: true });
  });

  it("adds recommendations under one SourceVision Recommendations parent, reused next time", async () => {
    const first = await capture(s.base, [GAP]);
    expect(first.body).toMatchObject({ created: 1, destination: "SourceVision Recommendations" });
    await capture(s.base, [PROBLEM]);

    const parents = await itemsTitled(s.rexDir, "SourceVision Recommendations");
    expect(parents).toHaveLength(1);
    // The store keeps children in priority order: the critical problem first.
    expect(parents[0]!.children?.map((c) => c.title)).toEqual([PROBLEM.title, GAP.title]);
    expect(parents[0]!.children?.find((c) => c.title === GAP.title)?.acceptanceCriteria).toEqual(["A `test` script in a manifest."]);
  });
});

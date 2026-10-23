/**
 * Progress on a v2 project counts changes, not epics. A root change projects
 * to level `epic`, and v1's counting skips epics, so a task-less change used
 * to count for nothing: the Work page, the home Plan card (`/api/status`) and
 * the status bar showed 100% while it was still open.
 *
 * Tree: the fixture's in-progress "Add Apple Pay" with one pending task, plus
 * a pending task-less change and a completed task-less change.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";

import type { ServerContext } from "../../src/server/types.js";
import { refreshPRDCache } from "../../src/server/start.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import { handleStatusRoute, clearStatusCache } from "../../src/server/routes-status.js";
import { closeRouteTestServer } from "../helpers/server-route-test-support.js";

const FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");

const BARE = "c0000000-0000-4000-8000-0000000000b1";
const DONE = "c0000000-0000-4000-8000-0000000000d1";
const WITH_TASKS = "c0000000-0000-4000-8000-000000000001";

function writeChange(rexDir: string, slug: string, id: string, status?: string): void {
  const dir = join(rexDir, "changes", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.md"), [
    "---",
    `id: "${id}"`,
    'type: "change"',
    `title: "${slug}"`,
    `slug: "${slug}"`,
    'intent: "Why."',
    "---",
    "",
  ].join("\n"));
  if (status) {
    writeFileSync(join(dir, "state.yaml"), `schema: "rex/v2"\nitems:\n  "${id}":\n    status: "${status}"\n`);
  }
}

let tmpDir: string;
let ctx: ServerContext;
let server: Server;
let port: number;

beforeAll(async () => {
  clearStatusCache();
  tmpDir = mkdtempSync(join(tmpdir(), "progress-v2-"));
  const rexDir = join(tmpDir, ".rex");
  const svDir = join(tmpDir, ".sourcevision");
  cpSync(FIXTURE, rexDir, { recursive: true });
  mkdirSync(svDir, { recursive: true });
  writeChange(rexDir, "bare-change", BARE);
  writeChange(rexDir, "done-change", DONE, "completed");
  await refreshPRDCache(rexDir);

  ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
  server = createServer(async (req, res) => {
    if (handleStatusRoute(req, res, ctx)) return;
    if (await handleRexRoute(req, res, ctx)) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});

afterAll(async () => {
  await closeRouteTestServer(server);
  rmSync(tmpDir, { recursive: true, force: true });
});

const get = async (path: string) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();

// One pending task, one pending task-less change, one completed task-less change.
const EXPECTED = { total: 3, completed: 1, pending: 2 };

describe("v2 progress counts", () => {
  it("/api/rex/stats counts a task-less change as one unit of work", async () => {
    const body = await get("/api/rex/stats");
    expect(body.stats).toMatchObject(EXPECTED);
    expect(body.percentComplete).toBe(33);
  });

  it("/api/rex/dashboard labels the layout v2 and gives each change its own counts", async () => {
    const body = await get("/api/rex/dashboard");
    expect(body.layout).toBe("v2");
    expect(body.stats).toMatchObject(EXPECTED);
    expect(body.percentComplete).toBe(33);
    const byId = Object.fromEntries((body.epics as Array<{ id: string }>).map((e) => [e.id, e]));
    expect(byId[BARE]).toMatchObject({ type: "change", selfCounted: true, status: "pending", percentComplete: 0 });
    expect(byId[DONE]).toMatchObject({ type: "change", selfCounted: true, status: "completed", percentComplete: 100 });
    expect(byId[WITH_TASKS]).toMatchObject({ type: "change", stats: { total: 1, pending: 1 } });
    expect(byId[WITH_TASKS]).not.toHaveProperty("selfCounted");
  });

  it("/api/status, which the home Plan card and the status bar read, has the same totals", async () => {
    const body = await get("/api/status");
    expect(body.rex.stats).toMatchObject(EXPECTED);
    expect(body.rex.percentComplete).toBe(33);
    expect(body.rex.hasPending).toBe(true);
  });
});

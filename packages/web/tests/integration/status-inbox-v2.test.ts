/**
 * `/api/status` carries `rex.inbox` on a v2 tree, counted with rex's own
 * `awaitsPlacement` and `needsPlacement`, and omits it on v1. Change rows carry
 * `awaitsPlacement` for held open changes only.
 *
 * Tree: the fixture (it has capabilities, so an Inbox change is held), plus one
 * open Inbox change, one applied change still flagged `needsPlacement`, and one
 * open change already placed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";

import type { ServerContext } from "../../src/server/types.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import { handleStatusRoute, clearStatusCache } from "../../src/server/routes-status.js";
import type { ChangeRowWire } from "../../src/server/routes-rex/product.js";
import { closeRouteTestServer } from "../helpers/server-route-test-support.js";

const FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");

const HELD = "c0000000-0000-4000-8000-0000000000e1";
const APPLIED = "c0000000-0000-4000-8000-0000000000e2";
const PLACED = "c0000000-0000-4000-8000-0000000000e3";

function writeChange(rexDir: string, slug: string, id: string, state: string[]): void {
  const dir = join(rexDir, "changes", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.md"), [
    "---", `id: "${id}"`, 'type: "change"', `title: "${slug}"`, `slug: "${slug}"`, 'intent: "Why."', "---", "",
  ].join("\n"));
  writeFileSync(join(dir, "state.yaml"), ['schema: "rex/v2"', "items:", `  "${id}":`, ...state.map((l) => `    ${l}`), ""].join("\n"));
}

describe("v2 Inbox counts", () => {
  let tmpDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    clearStatusCache();
    tmpDir = mkdtempSync(join(tmpdir(), "status-inbox-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    cpSync(FIXTURE, rexDir, { recursive: true });
    mkdirSync(svDir, { recursive: true });
    writeChange(rexDir, "held-change", HELD, ["needsPlacement: true"]);
    writeChange(rexDir, "applied-change", APPLIED, [
      'status: "completed"', 'appliedAt: "2026-10-05T12:00:00.000Z"', "needsPlacement: true",
    ]);
    writeChange(rexDir, "placed-change", PLACED, []);

    ctx = { projectDir: tmpDir, svDir, rexDir, dev: false };
    server = createServer(async (req, res) => {
      if (await handleStatusRoute(req, res, ctx)) return;
      if (await handleRexRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const get = async (path: string) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();

  it("counts held open changes and applied changes still flagged", async () => {
    const body = await get("/api/status");
    expect(body.rex.inbox).toEqual({ open: 1, appliedUnplaced: 1 });
  });

  it("flags awaitsPlacement on the held open change only", async () => {
    const { changes } = (await get("/api/rex/changes")) as { changes: ChangeRowWire[] };
    expect(changes.filter((c) => c.awaitsPlacement).map((c) => c.id)).toEqual([HELD]);
    const applied = changes.find((c) => c.id === APPLIED);
    expect(applied?.needsPlacement).toBe(true);
    expect(applied).not.toHaveProperty("awaitsPlacement");
  });

  it("recounts only when the PRD cache file is rewritten", async () => {
    // Counting loads the whole v2 model; the status poll must not repeat it
    // while nothing has written the PRD (every write rewrites the cache file).
    const cacheFile = join(rexDir, ".cache", "prd.json");
    mkdirSync(join(rexDir, ".cache"), { recursive: true });
    writeFileSync(cacheFile, "{}\n");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect((await get("/api/status")).rex.inbox.open).toBe(1);

      writeChange(rexDir, "second-held", "c0000000-0000-4000-8000-0000000000e4", ["needsPlacement: true"]);
      vi.setSystemTime(Date.now() + 10_000); // past the 5 s status cache
      expect((await get("/api/status")).rex.inbox.open).toBe(1);

      writeFileSync(cacheFile, "{ }\n");
      vi.setSystemTime(Date.now() + 10_000);
      expect((await get("/api/status")).rex.inbox.open).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("omits rex.inbox on a v1 tree", async () => {
    rmSync(join(rexDir, "product"), { recursive: true, force: true });
    rmSync(join(rexDir, "changes"), { recursive: true, force: true });
    clearStatusCache();
    const body = await get("/api/status");
    expect(body.rex).not.toHaveProperty("inbox");
  });
});

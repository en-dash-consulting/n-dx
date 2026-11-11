/**
 * Apply all when an apply throws partway: each change commits on its own, so
 * the ones already applied are still reported, refreshed and broadcast, a held
 * PRD lock stops the batch, and the changes not yet tried say so.
 *
 * rex's apply is replaced so C1 commits and C2 throws; the v2 route test
 * (routes-rex-apply.test.ts) covers the real apply on a fixture tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import type { ApplyAllResultWire } from "../../../src/server/routes-rex/apply.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const gateway = vi.hoisted(() => ({
  applyChange: vi.fn(),
  loadDocument: vi.fn(async () => ({ title: "PRD", items: [] })),
}));
const refreshPRDCache = vi.hoisted(() => vi.fn());

vi.mock("../../../src/server/rex-gateway.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/server/rex-gateway.js")>(),
  prdLayout: vi.fn(async () => "v2"),
  loadPrdModel: vi.fn(async () => ({ layout: "v2", tree: [] })),
  resolveStore: vi.fn(async () => ({ loadDocument: gateway.loadDocument })),
  applyChange: gateway.applyChange,
}));
vi.mock("../../../src/server/routes-rex/product.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/server/routes-rex/product.js")>(),
  awaitingApplyChanges: vi.fn(() => [
    { id: "c1", displayId: "CH-1", title: "First" },
    { id: "c2", displayId: "CH-2", title: "Second" },
    { id: "c3", displayId: "CH-3", title: "Third" },
  ]),
}));
vi.mock("../../../src/server/prd-io.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../src/server/prd-io.js")>(),
  refreshPRDCache,
}));

const { handleRexRoute } = await import("../../../src/server/routes-rex/index.js");

const LOCK = "Could not acquire PRD lock: held by ndx work (pid 4242)";
const applied = (change: string) => ({
  ok: true as const,
  change,
  appliedAt: "2026-11-11T12:00:00.000Z",
  hash: "f".repeat(64),
  written: true,
  applied: [{ delta: "modified", summary: "Wallets count", node: { id: "cap-1", displayId: "A1.1", title: "Pay", type: "capability" } }],
});

describe("apply all with a failure partway", () => {
  let tmpDir: string;
  let server: Server;
  let base: string;
  let frames: Array<{ type?: string }>;

  const applyAll = () =>
    fetch(`${base}/changes/apply-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hashes: { c1: "a", c2: "b", c3: "c" } }),
    });

  beforeEach(async () => {
    frames = [];
    gateway.applyChange.mockReset();
    refreshPRDCache.mockReset();
    tmpDir = mkdtempSync(join(tmpdir(), "rex-apply-all-partial-"));
    const ctx: ServerContext = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir: join(tmpDir, ".rex"), dev: false };
    server = createServer(async (req, res) => {
      if (!(await handleRexRoute(req, res, ctx, (frame) => { frames.push(frame as { type?: string }); }))) {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/rex`;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reports and publishes C1 when C2 hits a held lock, and does not try C3", async () => {
    gateway.applyChange.mockImplementation(async (_dir: string, id: string) => {
      if (id === "c1") return applied("c1");
      throw new Error(LOCK);
    });

    const res = await applyAll();
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: ApplyAllResultWire[] };
    expect(results.map((r) => [r.id, r.ok])).toEqual([["c1", true], ["c2", false], ["c3", false]]);
    expect(results[1]).toMatchObject({ ok: false, error: LOCK });
    expect(results[2]).toMatchObject({ ok: false, error: `Not applied: ${LOCK}` });
    expect(gateway.applyChange.mock.calls.map((c) => c[1])).toEqual(["c1", "c2"]);
    expect(refreshPRDCache).toHaveBeenCalledOnce();
    expect(frames.filter((f) => f.type === "rex:prd-changed")).toHaveLength(1);
  });

  it("keeps going past another kind of failure", async () => {
    gateway.applyChange.mockImplementation(async (_dir: string, id: string) => {
      if (id === "c2") throw new Error("disk full");
      return applied(id);
    });

    const { results } = (await (await applyAll()).json()) as { results: ApplyAllResultWire[] };
    expect(results.map((r) => [r.id, r.ok])).toEqual([["c1", true], ["c2", false], ["c3", true]]);
    expect(results[1]).toMatchObject({ error: "disk full" });
    expect(frames.filter((f) => f.type === "rex:prd-changed")).toHaveLength(1);
  });

  it("still answers and broadcasts the committed changes when reloading the cache fails", async () => {
    gateway.applyChange.mockImplementation(async (_dir: string, id: string) => applied(id));
    gateway.loadDocument.mockRejectedValueOnce(new Error("read failed"));

    const res = await applyAll();
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: ApplyAllResultWire[] };
    expect(results.every((r) => r.ok)).toBe(true);
    expect(frames.filter((f) => f.type === "rex:prd-changed")).toHaveLength(1);
  });
});

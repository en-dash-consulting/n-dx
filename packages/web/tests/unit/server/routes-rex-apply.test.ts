/**
 * Apply routes on a v2 project: preview writes nothing, apply writes through
 * rex's apply, logs and broadcasts, a refusal carries rex's message, and a v1
 * project answers 409.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import type { AppliedAmendmentWire, ApplyAllPreviewWire, ApplyAllResultWire, ChangeApplyWire } from "../../../src/server/routes-rex/apply.js";
import type { ApplyAllPreview, ApplyAllResult } from "../../../src/viewer/views/apply-all.js";
import type { AppliedAmendment, ChangeApply } from "../../../src/viewer/views/product-model.js";
import { indexTree, loadPrdModel } from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

// The viewer's types must accept what the route sends, and the reverse.
const wireToViewer = (w: ChangeApplyWire): ChangeApply => w;
const viewerToWire = (v: ChangeApply): ChangeApplyWire => v;
const amendmentWire = (w: AppliedAmendmentWire): AppliedAmendment => w;
const allPreviewToViewer = (w: ApplyAllPreviewWire): ApplyAllPreview => w;
const allResultToViewer = (w: ApplyAllResultWire): ApplyAllResult => w;
void wireToViewer; void viewerToWire; void amendmentWire; void allPreviewToViewer; void allResultToViewer;

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";
const TASK_ID = "c0000000-0000-4000-8000-000000000002";
const CAPABILITY_ID = "a0000000-0000-4000-8000-000000000002";

async function serve(ctx: ServerContext, frames: unknown[]): Promise<{ server: Server; base: string }> {
  const server = createServer(async (req, res) => {
    if (!(await handleRexRoute(req, res, ctx, (frame) => { frames.push(frame); }))) {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const addr = server.address();
  return { server, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/rex` };
}

/** Every file under `dir` with its contents, to show a request wrote nothing. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out[join(entry.parentPath, entry.name)] = readFileSync(join(entry.parentPath, entry.name), "utf-8");
  }
  return out;
}

describe("apply routes on a v2 project", () => {
  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let base: string;
  let frames: unknown[];

  const post = (path: string, body?: unknown) =>
    fetch(`${base}/${path}`, { method: "POST", ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });

  /** The preview's hash, as the detail panel sends it back on Apply. */
  async function previewHash(): Promise<string> {
    const res = await post(`changes/CH-1/apply/preview`);
    expect(res.status).toBe(200);
    return ((await res.json()) as ChangeApplyWire).hash;
  }

  function edit(file: string, from: string, to: string): void {
    const text = readFileSync(file, "utf-8");
    expect(text).toContain(from);
    writeFileSync(file, text.replace(from, to));
  }

  /** Close CH-1's task and the change: completed, not applied — awaiting apply. */
  function finishChange(): void {
    const state = join(rexDir, "changes", "add-apple-pay", "state.yaml");
    const text = readFileSync(state, "utf-8")
      .replace(`    status: "in_progress"\n`, `    status: "completed"\n    completedAt: "2026-10-02T09:00:00.000Z"\n`);
    writeFileSync(state, `${text.trimEnd()}\n  "${TASK_ID}":\n    status: "completed"\n    startedAt: "2026-10-01T09:00:00.000Z"\n    completedAt: "2026-10-02T09:00:00.000Z"\n`);
  }

  beforeEach(async () => {
    frames = [];
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v2-apply-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });
    ({ server, base } = await serve({ projectDir: tmpDir, svDir, rexDir, dev: false }, frames));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("preview answers the amendments and the product nodes they change, and writes nothing", async () => {
    finishChange();
    const before = snapshot(rexDir);
    const res = await post(`changes/CH-1/apply/preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChangeApplyWire;
    expect(body.layout).toBe("v2");
    expect(body.change).toBe(CHANGE_ID);
    expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.applied).toEqual([
      { delta: "modified", summary: "Wallets count as cards", node: { id: CAPABILITY_ID, displayId: "A1.1", title: "Pay by card", type: "capability" } },
    ]);
    expect(snapshot(rexDir)).toEqual(before);
    expect(frames).toEqual([]);
  });

  it("apply writes through rex's apply, logs it and broadcasts rex:prd-changed", async () => {
    finishChange();
    const hash = await previewHash();
    const res = await post(`changes/${CHANGE_ID}/apply`, { hash });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChangeApplyWire;
    expect(body.applied.map((a) => a.node.id)).toEqual([CAPABILITY_ID]);

    const model = await loadPrdModel(rexDir);
    if (model.layout !== "v2") throw new Error("expected v2");
    const index = indexTree(model.tree);
    expect(index.resolve(CHANGE_ID)?.appliedAt).toBe(body.appliedAt);
    expect(readFileSync(join(rexDir, "product", "checkout", "pay-by-card.md"), "utf-8")).toContain("Apple Pay is offered on Safari");

    const log = readFileSync(join(rexDir, "execution-log.jsonl"), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.at(-1)).toMatchObject({ event: "change_applied", itemId: CHANGE_ID, detail: `modified ${CAPABILITY_ID} (via dashboard)` });
    expect(frames).toEqual([{ type: "rex:prd-changed", timestamp: body.appliedAt }]);
  });

  it.each([
    ["an edited amendment", () => join(rexDir, "changes", "add-apple-pay", "index.md"), `"summary":"Wallets count as cards"`, `"summary":"Wallets and cards"`],
    ["an edited target node", () => join(rexDir, "product", "checkout", "pay-by-card.md"), `A shopper can pay for a basket with a card.`, `A shopper can pay with a card or wallet.`],
  ])("apply answers 409 moved and writes nothing after %s since the preview", async (_name, file, from, to) => {
    finishChange();
    const hash = await previewHash();
    edit(file(), from, to);
    const before = snapshot(rexDir);
    const res = await post(`changes/CH-1/apply`, { hash });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ moved: true });
    expect(body.error).toMatch(/changed since the preview/);
    expect(snapshot(rexDir)).toEqual(before);
    expect(frames).toEqual([]);
    expect(await previewHash()).not.toBe(hash);
  });

  it.each([undefined, {}, { hash: 7 }])("apply without the preview's hash (%j) answers 400 and writes nothing", async (body) => {
    finishChange();
    const before = snapshot(rexDir);
    const res = await post(`changes/CH-1/apply`, body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("preview");
    expect(snapshot(rexDir)).toEqual(before);
  });

  it.each(["apply/preview", "apply"])("%s refuses with rex's message and writes nothing when the change's work is open", async (action) => {
    const before = snapshot(rexDir);
    const res = await post(`changes/CH-1/${action}`, action === "apply" ? { hash: "h" } : undefined);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/^Cannot apply change CH-1: .*not completed/);
    expect(body.problems.length).toBeGreaterThan(0);
    expect(snapshot(rexDir)).toEqual(before);
    expect(frames).toEqual([]);
  });

  it("refuses an already applied change with rex's message", async () => {
    finishChange();
    const hash = await previewHash();
    expect((await post(`changes/CH-1/apply`, { hash })).status).toBe(200);
    // The same approval again: rex's refusal names why, ahead of "moved".
    const res = await post(`changes/CH-1/apply`, { hash });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("already applied");
  });

  it("apply all previews every change waiting to apply, and writes nothing", async () => {
    finishChange();
    const before = snapshot(rexDir);
    const res = await post("changes/apply-all/preview");
    expect(res.status).toBe(200);
    const { changes } = (await res.json()) as { changes: ApplyAllPreviewWire[] };
    expect(changes.map((c) => [c.id, c.displayId, c.ok])).toEqual([[CHANGE_ID, "CH-1", true]]);
    const [only] = changes;
    expect(only!.ok && only!.applied.map((a) => a.node.id)).toEqual([CAPABILITY_ID]);
    expect(snapshot(rexDir)).toEqual(before);
  });

  it("apply all lists nothing when no change is waiting", async () => {
    const res = await post("changes/apply-all/preview");
    expect(((await res.json()) as { changes: unknown[] }).changes).toEqual([]);
  });

  it("apply all applies the approved changes, logs each and broadcasts once", async () => {
    finishChange();
    const preview = (await (await post("changes/apply-all/preview")).json()) as { changes: Array<ApplyAllPreviewWire & { hash?: string }> };
    const hashes = Object.fromEntries(preview.changes.map((c) => [c.id, c.hash!]));
    const res = await post("changes/apply-all", { hashes });
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: ApplyAllResultWire[] };
    expect(results.map((r) => [r.id, r.ok])).toEqual([[CHANGE_ID, true]]);
    const model = await loadPrdModel(rexDir);
    const change = model.layout === "v2" ? indexTree(model.tree).resolve(CHANGE_ID) : undefined;
    expect((change as { appliedAt?: string } | undefined)?.appliedAt).toBeTruthy();
    expect(readFileSync(join(rexDir, "execution-log.jsonl"), "utf-8")).toContain("apply all");
    expect(frames).toHaveLength(1);
    // Applied, it no longer waits.
    const again = (await (await post("changes/apply-all/preview")).json()) as { changes: unknown[] };
    expect(again.changes).toEqual([]);
  });

  it("apply all skips a change edited since its preview and applies nothing else unasked", async () => {
    finishChange();
    const res = await post("changes/apply-all", { hashes: { [CHANGE_ID]: "0".repeat(64) } });
    const { results } = (await res.json()) as { results: ApplyAllResultWire[] };
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: CHANGE_ID, ok: false, moved: true });
    expect(frames).toEqual([]);
    // A change not named in the approval is never applied.
    const none = (await (await post("changes/apply-all", { hashes: { "not-waiting": "x" } })).json()) as { results: unknown[] };
    expect(none.results).toEqual([]);
  });

  it("apply all refuses a body without hashes", async () => {
    finishChange();
    expect((await post("changes/apply-all", {})).status).toBe(400);
    expect((await post("changes/apply-all", { hashes: {} })).status).toBe(400);
  });

  it("GET is not an apply route", async () => {
    finishChange();
    const before = snapshot(rexDir);
    expect((await fetch(`${base}/changes/CH-1/apply`)).status).toBe(404);
    expect(snapshot(rexDir)).toEqual(before);
  });
});

describe("apply routes on a v1 project", () => {
  let tmpDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v1-apply-"));
    const rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(join(rexDir, "prd_tree"), { recursive: true });
    mkdirSync(svDir, { recursive: true });
    ({ server, base } = await serve({ projectDir: tmpDir, svDir, rexDir, dev: false }, []));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it.each(["apply/preview", "apply"])("POST %s answers 409 and writes nothing", async (action) => {
    const res = await fetch(`${base}/changes/${CHANGE_ID}/${action}`, { method: "POST" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("v1");
    expect(existsSync(join(tmpDir, ".rex", "product"))).toBe(false);
  });
});

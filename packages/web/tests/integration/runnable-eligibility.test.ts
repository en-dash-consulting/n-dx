/** Real disposable PRDs through HTTP and in-process routes; CLI resolution and run spawns are mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdtemp, readdir, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { IncomingMessage, ServerResponse, type Server } from "node:http";
import { Socket } from "node:net";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), spawnManaged: vi.fn() }));
vi.mock("@n-dx/llm-client", async (original) => ({
  ...await original<typeof import("@n-dx/llm-client")>(),
  exec: mocks.exec, spawnManaged: mocks.spawnManaged,
}));
vi.mock("../../src/server/routes-llm.js", async (original) => ({
  ...await original<typeof import("../../src/server/routes-llm.js")>(),
  buildLlmCatalog: vi.fn(async () => ({ vendor: "claude", models: [], providers: ["cli"] })),
}));
vi.mock("../../src/server/rex-gateway.js", async (original) => ({
  ...await original<typeof import("../../src/server/rex-gateway.js")>(),
  checkTreeConformance: vi.fn(async () => null),
  openClaimsStore: () => ({ isClaimedByOther: async () => null, claimedElsewhere: async () => new Map() }),
}));

import { findItem, indexTree, loadPrdModel, resolveStore, withPrdModelTransaction } from "../../src/server/rex-gateway.js";
import type { RuleNode, V2Tree } from "../../src/server/rex-gateway.js";
import { createDataWatcher, handleDataRoute } from "../../src/server/routes-data.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../src/server/routes-hench.js";
import { handleHenchPrepRoute, previewTaskRun, resolveTaskRun } from "../../src/server/routes-hench-prep.js";
import { refreshPRDCache } from "../../src/server/prd-io.js";
import { savedRunVersion } from "../../src/server/task-run-settings.js";
import type { ServerContext } from "../../src/server/types.js";
import type { PRDItemData } from "../../src/viewer/components/prd-tree/types.js";
import { startRouteTestServer, closeRouteTestServer } from "../helpers/server-route-test-support.js";

const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const node = (n: number, type = "change", extra: Record<string, unknown> = {}): RuleNode => ({
  id: id(n), type, title: `Node ${n}`, slug: `node-${n}`, status: "pending", ...extra,
} as RuleNode);
const pins = { models: { codex: "saved-codex-pin" }, reviewModels: { codex: "saved-review-pin" }, tier: "heavy" as const };

async function contents(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return Object.fromEntries(await Promise.all(entries.filter((e) => e.isFile()).map(async (e) => {
    const path = join(e.parentPath, e.name);
    return [path.slice(dir.length), await readFile(path, "utf8")];
  })));
}

describe.each(["HTTP", "in-process"])("indexed eligibility across dashboard paths (%s)", (transport) => {
  let root: string;
  let ctx: ServerContext;
  let server: Server | undefined;
  let base: string;
  let product: V2Tree["product"];

  async function seed(changes: RuleNode[], targets = product): Promise<void> {
    const tree = { product: targets, changes };
    const kept = new Set(indexTree(tree, { includeTombstones: true }).entries.map(({ node }) => node.id));
    await withPrdModelTransaction(ctx.rexDir, (model) => ({
      tree, result: undefined,
      removed: new Set(indexTree(model.tree, { includeTombstones: true }).entries.map(({ node }) => node.id).filter((id) => !kept.has(id))),
    }));
    refreshPRDCache(ctx.rexDir, { ...await (await resolveStore(ctx.rexDir)).loadDocument(), product: targets });
  }
  const route = async (req: IncomingMessage, res: ServerResponse) =>
    handleDataRoute(req, res, ctx, createDataWatcher(ctx)) || await handleRexRoute(req, res, ctx) ||
    await handleHenchPrepRoute(req, res, ctx) || await handleHenchRoute(req, res, ctx);

  async function request(path: string, method = "GET", body?: unknown): Promise<{ status: number; body: any }> {
    // The same assertions also run directly through Node request/response
    // objects, independent of socket permissions. HTTP remains its own case.
    if (transport === "in-process") {
      const req = new IncomingMessage(new Socket());
      req.method = method;
      req.url = path;
      req.headers = { "content-type": "application/json" };
      if (body !== undefined) req.push(Buffer.from(JSON.stringify(body)));
      req.push(null);
      const res = new ServerResponse(req);
      let output = "";
      vi.spyOn(res, "end").mockImplementation((chunk: unknown) => { output = String(chunk); return res; });
      expect(await route(req, res)).toBe(true);
      req.destroy();
      return { status: res.statusCode, body: JSON.parse(output) };
    }
    const res = await fetch(`${base}${path}`, {
      method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  }

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    mocks.exec.mockReset().mockResolvedValue({ exitCode: 0, stdout: JSON.stringify({ resolved: {}, refusals: [] }), stderr: "" });
    mocks.spawnManaged.mockReset().mockReturnValue({ done: new Promise(() => {}), kill: vi.fn(() => true), pid: 4242 });
    root = await mkdtemp(join(tmpdir(), "runnable-eligibility-"));
    ctx = { projectDir: root, rexDir: join(root, ".rex"), svDir: join(root, ".sourcevision"), dev: false };
    await cp(resolve(__dirname, "../../../rex/tests/fixtures/v2-tree"), ctx.rexDir, { recursive: true });
    await mkdir(join(root, ".hench", "runs"), { recursive: true });
    await writeFile(join(root, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    product = (await loadPrdModel(ctx.rexDir)).tree.product;
    server = undefined;
    if (transport === "HTTP") {
      const started = await startRouteTestServer(route);
      server = started.server;
      base = `http://127.0.0.1:${started.port}`;
    }
  });
  afterEach(async () => { if (server) await closeRouteTestServer(server); await rm(root, { recursive: true, force: true }); });

  it.each([
    ["held Inbox unit", () => node(1, "change", { needsPlacement: true, run: pins }), 1, /placement/i, true],
    ["held Inbox task", () => node(1, "change", { needsPlacement: true, children: [node(2, "task", { run: pins })] }), 2, /placement/i, true],
    ["applied unit", () => node(1, "change", { appliedAt: "2026-11-12T00:00:00Z", run: pins }), 1, /applied/i, false],
    ["applied task", () => node(1, "change", { appliedAt: "2026-11-12T00:00:00Z", children: [node(2, "task", { run: pins })] }), 2, /applied/i, false],
    ["closed unit", () => node(1, "change", { status: "completed", run: pins }), 1, /closed/i, true],
    ["closed task", () => node(1, "change", { status: "completed", children: [node(2, "task", { run: pins })] }), 2, /closed/i, true],
    ["cancelled unit", () => node(1, "change", { status: "cancelled", run: pins }), 1, /closed/i, true],
    ["container", () => node(1, "change", { children: [node(2)] }), 1, /nested changes/i, false],
    ["change with tasks", () => node(1, "change", { children: [node(2, "task")] }), 1, /save.*tasks/i, false],
    ["v2 subtask", () => node(1, "change", { children: [node(2, "task", { children: [node(3, "subtask", { run: pins })] })] }), 3, /parent task/i, true],
    ["applied subtask", () => node(1, "change", { status: "completed", appliedAt: "2026-11-12T00:00:00Z", children: [node(2, "task", { status: "completed", children: [node(3, "subtask", { status: "completed", run: pins })] })] }), 3, /parent task/i, false],
    ["nested held task", () => node(1, "change", { needsPlacement: true, children: [node(2, "change", { children: [node(3, "task")] })] }), 3, /placement/i, true],
  ] as const)("refuses %s without writing or spawning", async (_name, make, target, reason, showInDetail) => {
    await seed([make()]);
    const before = await contents(ctx.rexDir);
    const prd = (await request("/api/rex/prd")).body;
    expect(findItem(prd.items, id(target))?.item).toMatchObject({ executionEligible: false });
    const projected = findItem(prd.items, id(target))?.item as PRDItemData;
    expect(projected.executionRefusal).toEqual(showInDetail ? expect.stringMatching(reason) : undefined);
    expect((await request("/data/prd.json")).body).toEqual(prd);
    const rows = (await request("/api/rex/changes")).body.changes;
    expect(rows.find((row: { id: string }) => row.id === id(1))?.runsAsOneTask).not.toBe(true);
    for (const [path, method, body] of [
      [`/api/hench/prep/${id(target)}`, "GET", undefined],
      [`/api/hench/prep/${id(target)}/preview`, "POST", { options: { contextNotes: "must not write notes" } }],
      [`/api/hench/prep/${id(target)}`, "PUT", { run: { tier: "light" }, version: savedRunVersion(pins) }],
      ["/api/hench/execute", "POST", { taskId: id(target) }],
      ["/api/hench/execute", "POST", { taskId: id(target), saveRun: { run: { tier: "light" }, version: savedRunVersion(pins) } }],
    ] as const) {
      const response = await request(path, method, body);
      expect(response.status, path).toBe(400);
      expect(response.body.error, path).toMatch(reason);
    }
    const check = await request("/api/hench/execute/check", "POST", { taskId: id(target), saveRun: { run: { tier: "light" }, version: savedRunVersion(pins) } });
    expect(check.body).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(reason) });
    expect(await resolveTaskRun(ctx, id(target), {})).toMatchObject({ ok: false, failure: expect.stringMatching(reason) });
    expect(await previewTaskRun(ctx, id(target), {})).toMatchObject({ ok: false, failure: expect.stringMatching(reason) });
    expect(await contents(ctx.rexDir)).toEqual(before);
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.spawnManaged).not.toHaveBeenCalled();
  });

  it.each(["held Inbox", "applied", "subtask"])("refuses preparation of %s by display id and alias before spawning", async (kind) => {
    const target = node(2, kind === "subtask" ? "subtask" : "change", {
      displayId: "CH-2", aliases: ["old-work-ref"],
      ...(kind === "held Inbox" ? { needsPlacement: true } : {}),
      ...(kind === "applied" ? { appliedAt: "2026-11-12T00:00:00Z" } : {}),
    });
    await seed([kind === "subtask" ? node(1, "change", { children: [node(3, "task", { children: [target] })] }) : target]);
    const before = await contents(ctx.rexDir);
    for (const ref of [target.displayId!, "old-work-ref"]) {
      expect((await request(`/api/hench/prep/${ref}`)).status).toBe(400);
      expect((await request(`/api/hench/prep/${ref}/preview`, "POST", { options: {} })).status).toBe(400);
      expect(await resolveTaskRun(ctx, ref, {})).toMatchObject({ ok: false });
      expect(await previewTaskRun(ctx, ref, {})).toMatchObject({ ok: false });
    }
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.spawnManaged).not.toHaveBeenCalled();
    expect(await contents(ctx.rexDir)).toEqual(before);
  });

  it.each(["placed unit", "empty-product Inbox", "ordinary task", "deferred task", "explicit dependency override"])("allows %s through prep, settings, check and execute", async (kind) => {
    const isTask = kind.includes("task") || kind === "explicit dependency override";
    const target = isTask ? 2 : 1;
    const work = node(target, isTask ? "task" : "change", {
      run: pins,
      ...(kind === "deferred task" ? { status: "deferred" } : {}),
      ...(kind === "explicit dependency override" ? { blockedBy: [id(99)] } : {}),
      ...(kind === "empty-product Inbox" ? { needsPlacement: true } : {}),
    });
    await seed([isTask ? node(1, "change", { children: [work] }) : work], kind === "empty-product Inbox" ? [] : product);
    if (kind === "deferred task" || kind === "explicit dependency override") {
      const ready = (await request("/api/hench/ready")).body;
      expect(ready.tasks.map((task: { id: string }) => task.id)).not.toContain(id(target));
    }
    const prd = (await request("/api/rex/prd")).body;
    expect(findItem(prd.items, id(target))?.item).toMatchObject({ executionEligible: true });
    if (!isTask) expect((await request("/api/rex/changes")).body.changes[0].runsAsOneTask).toBe(true);
    expect((await request(`/api/hench/prep/${id(target)}`)).status).toBe(200);
    expect((await request(`/api/hench/prep/${id(target)}/preview`, "POST", { options: {} })).status).toBe(200);
    expect(mocks.exec.mock.calls.some(([, args]) => args.includes(`--task=${id(target)}`))).toBe(true);
    if (kind === "deferred task") expect(mocks.exec.mock.calls.some(([, args]) => args.includes("--reset-deferred"))).toBe(true);
    const saved = await request(`/api/hench/prep/${id(target)}`, "PUT", { run: pins, version: savedRunVersion(pins) });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const before = await contents(ctx.rexDir);
    const check = await request("/api/hench/execute/check", "POST", { taskId: id(target) });
    expect(check.body).toEqual({ ok: true });
    expect(mocks.spawnManaged).not.toHaveBeenCalled();
    expect(await contents(ctx.rexDir)).toEqual(before);
    const launched = await request("/api/hench/execute", "POST", { taskId: id(target) });
    expect(launched.status, JSON.stringify(launched.body)).toBe(202);
    expect(mocks.spawnManaged).toHaveBeenCalledTimes(1);
    expect(mocks.spawnManaged.mock.calls[0][1]).toContain(`--task=${id(target)}`);
    expect((await (await resolveStore(ctx.rexDir)).getItem(id(target)))?.run).toEqual(pins);
  });
  it.each(["task", "subtask"])("preserves v1 %s prep, save and launch", async (level) => {
    await rm(ctx.rexDir, { recursive: true });
    await mkdir(ctx.rexDir);
    const store = await resolveStore(ctx.rexDir);
    await store.saveDocument({ schema: "rex/v1", title: "Legacy", items: [{
      id: "task", title: "Task", level: "task", status: "pending", children: [{
        id: "subtask", title: "Subtask", level: "subtask", status: "pending",
      }],
    }] });
    refreshPRDCache(ctx.rexDir, await store.loadDocument());
    expect((await request(`/api/hench/prep/${level}`)).status).toBe(200);
    expect((await request(`/api/hench/prep/${level}`, "PUT", { run: pins, version: "none" })).status).toBe(200);
    expect((await request("/api/hench/execute/check", "POST", { taskId: level })).body).toEqual({ ok: true });
    expect((await request("/api/hench/execute", "POST", { taskId: level })).status).toBe(202);
    expect(mocks.spawnManaged).toHaveBeenCalledTimes(1);
    expect((await store.getItem(level))?.run).toEqual(pins);
  });

});

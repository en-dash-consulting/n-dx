/**
 * `POST /api/hench/execute` with `saveRun` — Start Working's one click on a
 * task with no saved settings.
 *
 * The client sends the project defaults with the execute instead of saving
 * them first, and the route saves them only once every execute gate has
 * passed, right before it spawns. What is pinned here, against a real folder
 * tree: a refused start (paused, already executing, claimed elsewhere, a
 * version conflict, a malformed block) writes nothing — the task's `run`
 * block and the PRD tree on disk are unchanged — and an accepted one has the
 * block on disk before `ndx work` is spawned, so the run reads it.
 *
 * @see packages/web/src/server/routes-hench.ts — judgeExecuteRequest, startExecution
 * @see packages/web/src/server/task-run-settings.ts — the save path shared with PUT /api/hench/prep
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  spawnManaged: vi.fn(),
  isClaimedByOther: vi.fn(),
  checkTreeConformance: vi.fn(),
}));

vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, spawnManaged: mocks.spawnManaged };
});

vi.mock("../../src/server/rex-gateway.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/rex-gateway.js")>();
  return {
    ...actual,
    openClaimsStore: () => ({ isClaimedByOther: mocks.isClaimedByOther }),
    checkTreeConformance: mocks.checkTreeConformance,
  };
});

import { resolveStore } from "@n-dx/rex";
import { TIER_MODELS } from "@n-dx/llm-client";
import type { PRDDocument, PRDItem } from "../../src/server/rex-gateway.js";
import type { ServerContext } from "../../src/server/types.js";
import { loadPRDSync, refreshPRDCache } from "../../src/server/prd-io.js";
import { handleHenchRoute, resetHenchRouteStateForTests } from "../../src/server/routes-hench.js";
import { savedRunVersion } from "../../src/server/task-run-settings.js";
import { startRouteTestServer, closeRouteTestServer } from "../helpers/server-route-test-support.js";

const BLOCK = {
  models: { claude: TIER_MODELS.claude.standard },
  provider: "api",
  permissionMode: "acceptEdits",
  reviewMode: "off",
  skipTestGate: false,
  maxTurns: 50,
  tokenBudget: 0,
};

function doc(saved?: Record<string, unknown>): PRDDocument {
  return {
    schema: "rex/v1",
    title: "save-run",
    items: [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          { id: "task-1", title: "Start me", level: "task", status: "pending", priority: "medium", ...(saved ? { run: saved } : {}) },
          { id: "task-2", title: "Other", level: "task", status: "pending", priority: "low" },
        ],
      },
    ] as PRDItem[],
  } as PRDDocument;
}

/** A content hash of every file in a tree, so "nothing changed" is provable. */
function hashTree(dir: string): string {
  const h = createHash("sha256");
  const walk = (d: string): void => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(p.slice(dir.length)).update(readFileSync(p));
    }
  };
  walk(dir);
  return h.digest("hex");
}

describe("POST /api/hench/execute with saveRun", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  /** The task's `run` block as the spawned run would have found it on disk. */
  let runAtSpawn: unknown;

  function post(path: string, body: Record<string, unknown>): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  const execute = (body: Record<string, unknown>) => post("/api/hench/execute", body);
  const withSave = (version = "none") => ({ taskId: "task-1", saveRun: { run: BLOCK, version } });

  /** The task's `run` block as rex reads it back off disk. */
  async function storedRun(taskId = "task-1"): Promise<unknown> {
    const loaded = (await (await resolveStore(ctx.rexDir)).loadDocument()) as PRDDocument;
    return ((loaded.items[0] as PRDItem).children ?? []).find((i) => i.id === taskId)?.run ?? null;
  }
  const treeHash = () => hashTree(join(ctx.rexDir, "prd_tree"));

  /** Write the tree, and the server's PRD cache as the running server keeps it. */
  async function seed(saved?: Record<string, unknown>): Promise<void> {
    const store = await resolveStore(ctx.rexDir);
    await store.saveDocument(doc(saved) as never);
    refreshPRDCache(ctx.rexDir, (await store.loadDocument()) as never);
  }

  beforeEach(async () => {
    resetHenchRouteStateForTests();
    runAtSpawn = undefined;
    mocks.spawnManaged.mockReset();
    mocks.spawnManaged.mockImplementation(() => {
      const item = (loadPRDSync(ctx.rexDir)?.items as Array<{ children?: Array<{ id: string; run?: unknown }> }>)[0]
        .children?.find((c) => c.id === "task-1");
      runAtSpawn = item?.run ?? null;
      return { done: new Promise(() => {}), kill: vi.fn(() => true), pid: 4242 };
    });
    mocks.isClaimedByOther.mockReset();
    mocks.isClaimedByOther.mockResolvedValue(null);
    mocks.checkTreeConformance.mockReset();
    mocks.checkTreeConformance.mockResolvedValue(null);

    tmpDir = realpathSync.native(await mkdtemp(join(tmpdir(), "execute-save-run-")));
    const rexDir = join(tmpDir, ".rex");
    await mkdir(join(rexDir, ".cache"), { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    await seed();

    const started = await startRouteTestServer((req, res) => Promise.resolve(handleHenchRoute(req, res, ctx)));
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves the block before it spawns, so the run reads it", async () => {
    const res = await execute(withSave());

    expect(res.status).toBe(202);
    expect(mocks.spawnManaged).toHaveBeenCalledTimes(1);
    expect(runAtSpawn).toEqual(BLOCK);
    expect(await storedRun()).toEqual(BLOCK);
    // Only the task the request named gains settings.
    expect(await storedRun("task-2")).toBeNull();
  });

  it("writes nothing when executions are paused (503)", async () => {
    expect((await post("/api/hench/throttle/pause", {})).status).toBe(200);
    const before = treeHash();

    const res = await execute(withSave());

    expect(res.status).toBe(503);
    expect(mocks.spawnManaged).not.toHaveBeenCalled();
    expect(await storedRun()).toBeNull();
    expect(treeHash()).toBe(before);
  });

  it("writes nothing when the task is already executing (409)", async () => {
    expect((await execute({ taskId: "task-1" })).status).toBe(202);
    const before = treeHash();

    const res = await execute(withSave());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already being executed/);
    expect(mocks.spawnManaged).toHaveBeenCalledTimes(1);
    expect(await storedRun()).toBeNull();
    expect(treeHash()).toBe(before);
  });

  it("writes nothing when another worktree holds the task (409)", async () => {
    mocks.isClaimedByOther.mockResolvedValue({
      worktreeRoot: "/elsewhere", pid: 1, host: "h", claimedAt: "", expiresAt: "",
    });
    const before = treeHash();

    const res = await execute(withSave());

    expect(res.status).toBe(409);
    expect(mocks.spawnManaged).not.toHaveBeenCalled();
    expect(await storedRun()).toBeNull();
    expect(treeHash()).toBe(before);
  });

  it("refuses the start with 409 conflict when settings were saved since the read", async () => {
    await seed({ tier: "heavy" });
    const before = treeHash();

    const res = await execute(withSave("none"));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ conflict: true, saved: { tier: "heavy" }, version: savedRunVersion({ tier: "heavy" } as never) });
    expect(mocks.spawnManaged).not.toHaveBeenCalled();
    expect(await storedRun()).toEqual({ tier: "heavy" });
    expect(treeHash()).toBe(before);
  });

  it("answers the conflict from execute/check too, without writing", async () => {
    await seed({ tier: "heavy" });
    const before = treeHash();

    const check = await (await post("/api/hench/execute/check", withSave("none"))).json();

    expect(check).toMatchObject({ ok: false, status: 409, conflict: true });
    expect(treeHash()).toBe(before);
  });

  it("refuses a malformed saveRun with 400, before anything is written", async () => {
    const before = treeHash();
    for (const saveRun of [
      "not an object",
      { run: BLOCK },
      { run: null, version: "none" },
      { run: { ...BLOCK, unknownKey: 1 }, version: "none" },
      { run: { fresh: true }, version: "none" },
    ]) {
      const res = await execute({ taskId: "task-1", saveRun });
      expect(res.status, JSON.stringify(saveRun)).toBe(400);
      expect((await res.json()).key, JSON.stringify(saveRun)).toMatch(/^saveRun/);
    }
    expect(mocks.spawnManaged).not.toHaveBeenCalled();
    expect(await storedRun()).toBeNull();
    expect(treeHash()).toBe(before);
  });

  it("saves a pin of the project's own model even when the catalog does not list it", async () => {
    // A configured model newer than the built-in list (and with no live
    // listing to fall back on) is what `ndx work` runs anyway, so recording it
    // must not block the start the terminal would make.
    const unlisted = "claude-unlisted-9-9";
    const reviewer = "claude-unlisted-reviewer-9";
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude", claude: { model: unlisted, reviewModel: reviewer } } }));
    const run = { ...BLOCK, models: { claude: unlisted }, reviewMode: "self", reviewModels: { claude: reviewer } };

    const res = await execute({ taskId: "task-1", saveRun: { run, version: "none" } });

    expect(res.status, JSON.stringify(await res.clone().json())).toBe(202);
    expect(await storedRun()).toEqual(run);
  });

  it("still refuses a pin that is not the project's model and not the vendor's", async () => {
    const res = await execute({ taskId: "task-1", saveRun: { run: { ...BLOCK, models: { claude: "gpt-5" } }, version: "none" } });

    expect(res.status).toBe(400);
    expect((await res.json()).key).toBe("saveRun.run.models");
    expect(mocks.spawnManaged).not.toHaveBeenCalled();
  });

  it("starts a task with saved settings as before when no saveRun is sent", async () => {
    await seed({ tier: "heavy" });

    const res = await execute({ taskId: "task-1" });

    expect(res.status).toBe(202);
    expect(await storedRun()).toEqual({ tier: "heavy" });
  });
});

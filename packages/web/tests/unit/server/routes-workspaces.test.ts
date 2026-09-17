import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { GitWorktree } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import { WorkspaceRegistry, type WorkspaceHooks } from "../../../src/server/workspaces.js";
import { handleWorkspacesRoute } from "../../../src/server/routes-workspaces.js";
import { invalidatePrdDelta } from "../../../src/server/prd-delta.js";
import { startRouteTestServer, closeRouteTestServer, removeTestDir } from "../../helpers/server-route-test-support.js";

/**
 * GET /api/workspaces/:key/prd-delta over a registry with two real
 * directories: the anchor and a linked worktree, each with its own PRD.
 * Git is injected (the registry's worktree list is a stub) — what is under
 * test is the route: resolution of the key, the diff it returns, and that a
 * watcher-driven invalidation makes the next response see a changed tree.
 */

function writePrd(dir: string, items: Array<Record<string, unknown>>): Promise<void> {
  return writeFile(join(dir, ".rex", "prd.json"), JSON.stringify({ schema: "rex/v1", title: "T", items }));
}

describe("GET /api/workspaces/:key/prd-delta", () => {
  let root: string;
  let anchorDir: string;
  let featureDir: string;
  let registry: WorkspaceRegistry;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    invalidatePrdDelta();
    root = await mkdtemp(join(tmpdir(), "ws-prd-delta-"));
    anchorDir = join(root, "app");
    featureDir = join(root, "feature");
    await mkdir(join(anchorDir, ".rex"), { recursive: true });
    await mkdir(join(featureDir, ".rex"), { recursive: true });
    await writePrd(anchorDir, [
      { id: "e1", title: "Epic", level: "epic", status: "in_progress", children: [
        { id: "t1", title: "Shared", level: "task", status: "pending" },
        { id: "t2", title: "Main only", level: "task", status: "pending" },
      ] },
    ]);
    await writePrd(featureDir, [
      { id: "e1", title: "Epic", level: "epic", status: "in_progress", children: [
        { id: "t1", title: "Shared", level: "task", status: "completed" },
        { id: "t3", title: "Branch only", level: "task", status: "pending" },
      ] },
    ]);

    const anchorCtx: ServerContext = {
      projectDir: anchorDir, svDir: join(anchorDir, ".sourcevision"), rexDir: join(anchorDir, ".rex"), dev: false, port: 0, startedAt: "t0",
    };
    const hooks: WorkspaceHooks = {
      setup: vi.fn((ctx: ServerContext) => ({ watcher: { ctx } as never, handles: { watchers: [], henchRunsDir: "", monitorIntervals: [] } })),
      teardown: vi.fn(),
    };
    const worktrees: GitWorktree[] = [
      { path: anchorDir, branch: "main", head: "a", isMain: true, detached: false, bare: false },
      { path: featureDir, branch: "feature", head: "b", isMain: false, detached: false, bare: false },
    ];
    registry = new WorkspaceRegistry({
      anchor: { ctx: anchorCtx, watcher: {} as never, handles: { watchers: [], henchRunsDir: "", monitorIntervals: [] } },
      hooks,
      listWorktrees: async () => worktrees,
      refreshIntervalMs: 0,
    });
    await registry.refresh();

    const started = await startRouteTestServer((req, res) => handleWorkspacesRoute(req, res, registry));
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await removeTestDir(root);
  });

  const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`);

  it("diffs the worktree against the anchor", async () => {
    const res = await get("/api/workspaces/feature/prd-delta");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      anchor: "app",
      workspace: "feature",
      sources: { anchor: true, workspace: true },
      totals: { anchor: 3, workspace: 3 },
      counts: { onlyHere: 1, onlyAnchor: 1, changed: 1, completedHere: 1 },
      onlyHere: ["t3"],
      onlyAnchor: ["t2"],
      changed: ["t1"],
      completedHere: ["t1"],
      truncated: false,
      identical: false,
    });
  });

  it("the anchor against itself is identical, under its key or the 'main' alias", async () => {
    for (const key of ["app", "main"]) {
      const body = await (await get(`/api/workspaces/${key}/prd-delta`)).json();
      expect(body).toMatchObject({ anchor: "app", workspace: "app", identical: true, counts: { onlyHere: 0, onlyAnchor: 0, changed: 0, completedHere: 0 } });
    }
  });

  it("404s an unknown key and lists the known ones", async () => {
    const res = await get("/api/workspaces/nope/prd-delta");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Unknown workspace "nope"', known: ["app", "feature"] });
  });

  it("400s a malformed key", async () => {
    expect((await get("/api/workspaces/%E0%A4%A/prd-delta")).status).toBe(400);
  });

  it("serves the cached delta until the tree watcher invalidates it, then sees the change", async () => {
    expect((await (await get("/api/workspaces/feature/prd-delta")).json()).counts.onlyHere).toBe(1);

    // The branch gains a task. Nothing has invalidated the pair yet.
    await writePrd(featureDir, [
      { id: "e1", title: "Epic", level: "epic", status: "in_progress", children: [
        { id: "t1", title: "Shared", level: "task", status: "completed" },
        { id: "t3", title: "Branch only", level: "task", status: "pending" },
        { id: "t4", title: "Newer", level: "task", status: "pending" },
      ] },
    ]);
    expect((await (await get("/api/workspaces/feature/prd-delta")).json()).counts.onlyHere).toBe(1);

    // What the worktree's rex watcher does on a change. It is registered with
    // the workspace context's rexDir, which the registry canonicalises (on
    // macOS /var/… becomes /private/var/…), so invalidate with that path.
    invalidatePrdDelta(registry.get("feature")!.ctx.rexDir);
    const fresh = await (await get("/api/workspaces/feature/prd-delta")).json();
    expect(fresh.counts.onlyHere).toBe(2);
    expect(fresh.onlyHere).toEqual(["t3", "t4"]);
  });

  it("leaves the other workspace routes untouched", async () => {
    const list = await (await get("/api/workspaces")).json();
    expect(list.workspaces.map((w: { key: string }) => w.key)).toEqual(["app", "feature"]);
    expect((await get("/api/workspaces/feature/other")).status).toBe(404);
  });
});

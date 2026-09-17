import { describe, it, expect, vi } from "vitest";
import { join } from "node:path";
import type { GitWorktree } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import {
  WorkspaceRegistry,
  assignWorkspaceKeys,
  WORKSPACE_HEADER,
  type WatcherHandles,
  type WorkspaceHooks,
} from "../../../src/server/workspaces.js";

/**
 * The registry's contract, with the seam and git both injected: resources are
 * created on first use and released when the worktree disappears; the anchor
 * is eager and permanent; requests resolve by header, slot, then anchor.
 */

const ANCHOR = "/repos/app";

function wt(path: string, branch: string | null = "main", extra: Partial<GitWorktree> = {}): GitWorktree {
  return { path, branch, head: "abc", isMain: path === ANCHOR, detached: false, bare: false, ...extra };
}

function fakeHandles(): WatcherHandles {
  return { watchers: [], henchRunsDir: "", monitorIntervals: [] };
}

function harness(initial: GitWorktree[] = [wt(ANCHOR)]) {
  const setup = vi.fn((ctx: ServerContext) => ({ watcher: { ctx } as never, handles: fakeHandles() }));
  const teardown = vi.fn();
  const hooks: WorkspaceHooks = { setup, teardown };
  let worktrees = initial;
  const listWorktrees = vi.fn(async () => worktrees);
  const anchorCtx: ServerContext = {
    projectDir: ANCHOR, svDir: `${ANCHOR}/.sourcevision`, rexDir: `${ANCHOR}/.rex`, dev: false, port: 3117, startedAt: "t0",
  };
  const registry = new WorkspaceRegistry({
    anchor: { ctx: anchorCtx, watcher: {} as never, handles: fakeHandles() },
    hooks,
    listWorktrees,
    refreshIntervalMs: 0,
  });
  return { registry, setup, teardown, listWorktrees, setWorktrees: (w: GitWorktree[]) => { worktrees = w; } };
}

describe("assignWorkspaceKeys", () => {
  it("keys by basename, keeps the anchor's key, and de-duplicates in list order", () => {
    const keys = assignWorkspaceKeys(
      [wt(ANCHOR, "main"), wt("/wt/feature", "feature"), wt("/elsewhere/feature", "other"), wt("/wt/fix", null)],
      ANCHOR,
      "app",
    );
    expect(Array.from(keys.keys())).toEqual(["app", "feature", "feature-2", "fix"]);
    expect(keys.get("app")).toEqual({ path: ANCHOR, branch: "main" });
    expect(keys.get("feature-2")).toEqual({ path: "/elsewhere/feature", branch: "other" });
  });

  it("never lets a linked worktree steal the anchor key", () => {
    const keys = assignWorkspaceKeys([wt(ANCHOR), wt("/other/app", "x")], ANCHOR, "app");
    expect(keys.get("app")?.path).toBe(ANCHOR);
    expect(keys.get("app-2")?.path).toBe("/other/app");
  });
});

describe("WorkspaceRegistry", () => {
  it("starts with only the anchor, eagerly active, under its directory name and the 'main' alias", () => {
    const { registry, setup } = harness();
    expect(registry.anchorKey).toBe("app");
    expect(registry.list()).toEqual([{ key: "app", path: ANCHOR, branch: null, isAnchor: true, active: true }]);
    expect(registry.get("main")).toBe(registry.anchor);
    expect(registry.get("app")).toBe(registry.anchor);
    expect(registry.anchor.ctx.workspace).toBe("app");
    expect(setup).not.toHaveBeenCalled();
  });

  it("returns null for a key no refresh has seen", () => {
    const { registry } = harness();
    expect(registry.get("feature")).toBeNull();
  });

  it("creates a worktree's resources lazily, once, on first use", async () => {
    const { registry, setup } = harness([wt(ANCHOR), wt("/wt/feature", "feature")]);
    const { added } = await registry.refresh();
    expect(added).toEqual(["feature"]);
    expect(setup).not.toHaveBeenCalled();
    expect(registry.list().find((w) => w.key === "feature")).toMatchObject({ active: false, branch: "feature" });

    const ws = registry.get("feature")!;
    expect(setup).toHaveBeenCalledTimes(1);
    // join(), not literals: the registry composes these with path.join, so on
    // Windows the fake POSIX root comes back with native separators.
    expect(ws.ctx).toMatchObject({
      projectDir: "/wt/feature", svDir: join("/wt/feature", ".sourcevision"), rexDir: join("/wt/feature", ".rex"),
      port: 3117, workspace: "feature",
    });
    expect(registry.get("feature")).toBe(ws);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(registry.list().find((w) => w.key === "feature")?.active).toBe(true);
  });

  it("refresh releases a worktree that disappeared and never the anchor", async () => {
    const { registry, teardown, setWorktrees } = harness([wt(ANCHOR), wt("/wt/feature", "feature")]);
    await registry.refresh();
    const created = registry.get("feature")!;

    setWorktrees([wt(ANCHOR)]);
    const { removed } = await registry.refresh();
    expect(removed).toEqual(["feature"]);
    expect(teardown).toHaveBeenCalledWith(created.handles);
    expect(registry.get("feature")).toBeNull();
    expect(registry.list().map((w) => w.key)).toEqual(["app"]);

    // Even an empty (or failed) listing keeps the anchor.
    setWorktrees([]);
    await registry.refresh();
    expect(registry.anchor.key).toBe("app");
    expect(registry.list()).toHaveLength(1);
  });

  it("a failing worktree list is logged, not thrown, and keeps the anchor", async () => {
    const { registry, listWorktrees } = harness();
    listWorktrees.mockRejectedValueOnce(new Error("git exploded"));
    await expect(registry.refresh()).resolves.toEqual({ added: [], removed: [] });
    expect(registry.anchor).toBeDefined();
  });

  it("rebuilds a workspace whose key now points at a different path", async () => {
    const { registry, teardown, setup, setWorktrees } = harness([wt(ANCHOR), wt("/a/feature", "f")]);
    await registry.refresh();
    registry.get("feature");
    setWorktrees([wt(ANCHOR), wt("/b/feature", "f")]);
    await registry.refresh();
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(registry.get("feature")!.path).toBe("/b/feature");
    expect(setup).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight refresh between concurrent callers", async () => {
    const { registry, listWorktrees } = harness();
    const [a, b] = await Promise.all([registry.refresh(), registry.refresh()]);
    expect(a).toBe(b);
    expect(listWorktrees).toHaveBeenCalledTimes(1);
  });

  it("resolves a request by header, then by the /w/<key>/ slot, then to the anchor", async () => {
    const { registry } = harness([wt(ANCHOR), wt("/wt/feature", "feature")]);
    await registry.refresh();

    expect(registry.resolveWorkspace({ headers: {}, url: "/api/status" })).toBe(registry.anchor);
    expect(registry.resolveWorkspace({ headers: { [WORKSPACE_HEADER]: "feature" }, url: "/api/status" }).key).toBe("feature");
    expect(registry.resolveWorkspace({ headers: {}, url: "/w/feature/api/status" }).key).toBe("feature");
    // Header wins over slot; unknown keys fall back rather than failing.
    expect(registry.resolveWorkspace({ headers: { [WORKSPACE_HEADER]: "main" }, url: "/w/feature/x" })).toBe(registry.anchor);
    expect(registry.resolveWorkspace({ headers: { [WORKSPACE_HEADER]: "nope" }, url: "/" })).toBe(registry.anchor);
    expect(registry.resolveWorkspace({ headers: {}, url: "/w/nope/" })).toBe(registry.anchor);
  });

  it("closeAll releases every non-anchor workspace and leaves the anchor to start.ts", async () => {
    const { registry, teardown, setWorktrees } = harness([wt(ANCHOR), wt("/wt/a", "a"), wt("/wt/b", "b")]);
    await registry.refresh();
    registry.get("a");
    registry.get("b");
    registry.closeAll();
    expect(teardown).toHaveBeenCalledTimes(2);
    expect(registry.anchor.key).toBe("app");
    // Keys stay known — a later get() rebuilds lazily.
    setWorktrees([wt(ANCHOR), wt("/wt/a", "a")]);
    expect(registry.get("a")).not.toBeNull();
  });
});

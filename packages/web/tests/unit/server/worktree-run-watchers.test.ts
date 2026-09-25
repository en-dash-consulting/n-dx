import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FSWatcher } from "node:fs";
import {
  ensureWorktreeRunWatcher,
  pruneWorktreeRunWatchers,
  closeWorktreeRunWatchers,
  setWorktreeRunWatchFactory,
} from "../../../src/server/routes-hench.js";

/**
 * Lifecycle of the lazily registered per-worktree run watchers (PR E, audit
 * item d35a54ea). PR F registered one fs.watch per non-served worktree and
 * never closed it when the worktree went away, so a long-running dashboard
 * accumulated watchers on directories that no longer existed. The registry
 * must close a watcher whose worktree left `git worktree list` (the prune the
 * /api/worktrees refresh calls) and close everything on server shutdown.
 */

describe("worktree run watcher lifecycle", () => {
  let root: string;
  let opened: string[];
  let closed: string[];

  /** A watcher that only counts. The registry closes it; nothing else matters. */
  function fakeFactory(dir: string): FSWatcher {
    opened.push(dir);
    return {
      close: () => { closed.push(dir); },
      on: () => {},
    } as unknown as FSWatcher;
  }

  async function runsDirFor(name: string): Promise<string> {
    const dir = join(root, name, ".hench", "runs");
    await mkdir(dir, { recursive: true });
    return dir;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "wt-watchers-"));
    opened = [];
    closed = [];
    setWorktreeRunWatchFactory(fakeFactory);
  });

  afterEach(async () => {
    closeWorktreeRunWatchers();
    setWorktreeRunWatchFactory(null);
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  const broadcast = () => {};

  it("opens one watcher per directory, idempotently", async () => {
    const a = await runsDirFor("wt-a");
    const b = await runsDirFor("wt-b");

    ensureWorktreeRunWatcher(a, broadcast, undefined);
    ensureWorktreeRunWatcher(b, broadcast, undefined);
    ensureWorktreeRunWatcher(a, broadcast, undefined);

    expect(opened).toEqual([a, b]);
    expect(closed).toEqual([]);
  });

  it("prune closes exactly the watchers whose worktree is gone, and a re-add re-opens", async () => {
    const a = await runsDirFor("wt-a");
    const b = await runsDirFor("wt-b");
    ensureWorktreeRunWatcher(a, broadcast, undefined);
    ensureWorktreeRunWatcher(b, broadcast, undefined);

    // wt-b left `git worktree list`; the next /api/worktrees refresh keeps only wt-a.
    pruneWorktreeRunWatchers(new Set([a]));
    expect(closed).toEqual([b]);

    // Pruning again with the same set is a no-op.
    pruneWorktreeRunWatchers(new Set([a]));
    expect(closed).toEqual([b]);

    // The worktree coming back re-registers rather than being remembered dead.
    ensureWorktreeRunWatcher(b, broadcast, undefined);
    expect(opened).toEqual([a, b, b]);
  });

  it("shutdown closes every remaining watcher", async () => {
    const a = await runsDirFor("wt-a");
    const b = await runsDirFor("wt-b");
    ensureWorktreeRunWatcher(a, broadcast, undefined);
    ensureWorktreeRunWatcher(b, broadcast, undefined);

    closeWorktreeRunWatchers();
    expect([...closed].sort()).toEqual([a, b].sort());

    // The registry is empty again: a new ensure opens rather than no-ops.
    ensureWorktreeRunWatcher(a, broadcast, undefined);
    expect(opened).toEqual([a, b, a]);
  });
});

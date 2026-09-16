/**
 * Per-workspace state for route modules.
 *
 * Before 0.8.0 every route module kept its job trackers and caches as
 * module-level singletons — one `svAnalyzeStatus`, one `activeExecutions`
 * map, one status cache — because a server served one directory. With one
 * server holding a context per worktree (see workspaces.ts), that state has
 * to be keyed by the workspace a request addresses, or an analysis started
 * in worktree A blocks and reports in worktree B.
 *
 * `WorkspaceScoped<T>` is that map: one `T`, created on first use, per
 * workspace key. Keying falls back to `projectDir` when a context carries no
 * workspace key (tests build contexts directly; the anchor before the
 * registry copies it), so a single-workspace server behaves exactly as the
 * singleton did.
 *
 * @module web/server/workspace-scoped
 */

import type { ServerContext } from "./types.js";

/** The key a context's per-workspace state lives under. */
export function workspaceKeyOf(ctx: Pick<ServerContext, "workspace" | "projectDir">): string {
  return ctx.workspace ?? ctx.projectDir;
}

export class WorkspaceScoped<T> {
  private readonly slots = new Map<string, T>();

  constructor(private readonly create: (key: string) => T) {}

  /** The workspace's value, created on first use. */
  get(ctx: Pick<ServerContext, "workspace" | "projectDir">): T {
    return this.getByKey(workspaceKeyOf(ctx));
  }

  getByKey(key: string): T {
    let value = this.slots.get(key);
    if (value === undefined) {
      value = this.create(key);
      this.slots.set(key, value);
    }
    return value;
  }

  /** The workspace's value if it exists, without creating one. */
  peek(ctx: Pick<ServerContext, "workspace" | "projectDir">): T | undefined {
    return this.slots.get(workspaceKeyOf(ctx));
  }

  /** Every workspace's value — for process-wide sweeps such as shutdown. */
  values(): IterableIterator<T> {
    return this.slots.values();
  }

  entries(): IterableIterator<[string, T]> {
    return this.slots.entries();
  }

  get size(): number {
    return this.slots.size;
  }

  delete(ctx: Pick<ServerContext, "workspace" | "projectDir">): boolean {
    return this.slots.delete(workspaceKeyOf(ctx));
  }

  /** Drop every workspace's value (tests, and the reset seams route modules expose). */
  clear(): void {
    this.slots.clear();
  }
}

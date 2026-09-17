/**
 * Workspace registry — one server context per worktree of the served repository.
 *
 * Until 0.8.0 the server built exactly one `ServerContext` (the directory it
 * was started in), one watcher set and one PRD cache. A repository with
 * several worktrees therefore needed several servers. The registry anchors the
 * server at the directory it was started in — the *anchor* workspace, set up
 * eagerly exactly as before — and creates a context, watcher set and PRD cache
 * for any other worktree lazily, the first time a request names it.
 *
 * Keys are worktree basenames (the anchor's is its own directory name; `main`
 * is accepted as an alias for the anchor). The set of known worktrees comes
 * from `git worktree list` via llm-client's `listWorktrees`, refreshed on a
 * timer and on `POST /api/workspaces/refresh`; a worktree that disappears has
 * its resources torn down, the anchor never is.
 *
 * A request picks its workspace with the `X-Ndx-Workspace` header or the
 * `/w/<key>/` URL slot (PR 12), and falls back to the anchor — so until PR 12
 * lands every request resolves to the anchor and nothing observable changes.
 *
 * ## Injection seam
 *
 * Building a workspace's watchers means calling start.ts's registration
 * helpers, and start.ts is what constructs this registry. To avoid the cycle
 * the registry receives {@link WorkspaceHooks} — `setup(ctx)` and
 * `teardown(handles)` — rather than importing them. This seam is listed in
 * `.claude/rules/web-injection-seams.md`.
 *
 * @module web/server/workspaces
 */

import type { IncomingMessage } from "node:http";
import type { FSWatcher } from "node:fs";
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { listWorktrees as defaultListWorktrees } from "@n-dx/llm-client";
import type { GitWorktree } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import type { createDataWatcher } from "./routes-data.js";

/** Header a client sets to address a workspace other than the anchor. */
export const WORKSPACE_HEADER = "x-ndx-workspace";
/** `/w/<key>/…` — the URL slot PR 12 gives workspaces. Parsed here so the registry owns the rule. */
const WORKSPACE_SLOT_PATTERN = /^\/w\/([^/?#]+)/;
/** `main` always means the anchor, whatever the anchor directory is called. */
export const ANCHOR_ALIAS = "main";
/** How often the worktree list is re-read without being asked. */
export const WORKSPACE_REFRESH_INTERVAL_MS = 30_000;

export type DataWatcher = ReturnType<typeof createDataWatcher>;

/** Collected file system watchers and monitor intervals for cleanup during shutdown. */
export interface WatcherHandles {
  watchers: FSWatcher[];
  henchRunsDir: string;
  /** Monitor intervals to clear on shutdown. */
  monitorIntervals: ReturnType<typeof setInterval>[];
  /** Ephemeral PRD JSON cache directory to delete on shutdown (if set). */
  prdCacheDir?: string;
}

/** What a workspace owns besides its context. */
export interface WorkspaceResources {
  watcher: DataWatcher;
  handles: WatcherHandles;
}

/**
 * The injection seam: how a workspace's resources are built and released.
 * Provided by start.ts, which owns the watcher registration helpers.
 */
export interface WorkspaceHooks {
  /** Build watchers (and prime the PRD cache) for a freshly created context. */
  setup(ctx: ServerContext): WorkspaceResources;
  /** Release everything `setup` built, including the PRD cache. */
  teardown(handles: WatcherHandles): void;
}

export interface Workspace extends WorkspaceResources {
  key: string;
  /** Realpath-resolved worktree root. */
  path: string;
  branch: string | null;
  isAnchor: boolean;
  ctx: ServerContext;
  createdAt: string;
}

/** A known worktree, whether or not its resources exist yet. */
export interface WorkspaceSummary {
  key: string;
  path: string;
  branch: string | null;
  isAnchor: boolean;
  /** Resources have been created (lazily, on first use, or eagerly for the anchor). */
  active: boolean;
}

export interface WorkspaceRegistryOptions {
  /** The eagerly built anchor: today's single context, watcher and handles. */
  anchor: { ctx: ServerContext } & WorkspaceResources;
  hooks: WorkspaceHooks;
  /** Injectable for tests; defaults to llm-client's `listWorktrees`. */
  listWorktrees?: (cwd: string) => Promise<GitWorktree[]>;
  /** 0 disables the timer. Default {@link WORKSPACE_REFRESH_INTERVAL_MS}. */
  refreshIntervalMs?: number;
  log?: (message: string) => void;
}

interface KnownWorktree {
  path: string;
  branch: string | null;
}

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * Basename keys, made unique in list order: a second worktree called `app`
 * becomes `app-2`. Git lists worktrees by path, so the assignment is stable
 * as long as the set is.
 */
export function assignWorkspaceKeys(
  worktrees: ReadonlyArray<Pick<GitWorktree, "path" | "branch">>,
  anchorPath: string,
  anchorKey: string,
): Map<string, KnownWorktree> {
  const keys = new Map<string, KnownWorktree>();
  keys.set(anchorKey, { path: anchorPath, branch: null });
  const anchorCanonical = canonical(anchorPath);
  for (const wt of worktrees) {
    const path = canonical(wt.path);
    if (path === anchorCanonical) {
      keys.set(anchorKey, { path: anchorPath, branch: wt.branch });
      continue;
    }
    const base = basename(path) || "worktree";
    let key = base;
    for (let n = 2; keys.has(key); n++) key = `${base}-${n}`;
    keys.set(key, { path, branch: wt.branch });
  }
  return keys;
}

export class WorkspaceRegistry {
  readonly anchorKey: string;
  private readonly hooks: WorkspaceHooks;
  private readonly listWorktrees: (cwd: string) => Promise<GitWorktree[]>;
  private readonly refreshIntervalMs: number;
  private readonly log: (message: string) => void;
  /** Every worktree the last refresh saw (plus the anchor, always). */
  private known: Map<string, KnownWorktree>;
  /** Worktrees whose resources exist. */
  private readonly active = new Map<string, Workspace>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing: Promise<{ added: string[]; removed: string[] }> | null = null;

  constructor(options: WorkspaceRegistryOptions) {
    const { anchor } = options;
    this.hooks = options.hooks;
    this.listWorktrees = options.listWorktrees ?? defaultListWorktrees;
    this.refreshIntervalMs = options.refreshIntervalMs ?? WORKSPACE_REFRESH_INTERVAL_MS;
    this.log = options.log ?? (() => {});
    this.anchorKey = basename(anchor.ctx.projectDir) || ANCHOR_ALIAS;
    this.known = new Map([[this.anchorKey, { path: anchor.ctx.projectDir, branch: null }]]);
    this.active.set(this.anchorKey, {
      key: this.anchorKey,
      path: anchor.ctx.projectDir,
      branch: null,
      isAnchor: true,
      ctx: { ...anchor.ctx, workspace: this.anchorKey },
      watcher: anchor.watcher,
      handles: anchor.handles,
      createdAt: anchor.ctx.startedAt ?? new Date().toISOString(),
    });
  }

  get anchor(): Workspace {
    return this.active.get(this.anchorKey)!;
  }

  /** Keys of every known worktree, anchor first. */
  keys(): string[] {
    return [this.anchorKey, ...Array.from(this.known.keys()).filter((k) => k !== this.anchorKey)];
  }

  /**
   * The workspace for `key`, creating its resources on first use. Null for a
   * key no refresh has seen — the caller falls back to the anchor.
   */
  get(key: string): Workspace | null {
    const resolved = key === ANCHOR_ALIAS ? this.anchorKey : key;
    const existing = this.active.get(resolved);
    if (existing) return existing;
    const known = this.known.get(resolved);
    if (!known) return null;

    const anchorCtx = this.anchor.ctx;
    const ctx: ServerContext = {
      projectDir: known.path,
      svDir: join(known.path, ".sourcevision"),
      rexDir: join(known.path, ".rex"),
      dev: anchorCtx.dev,
      scope: anchorCtx.scope,
      port: anchorCtx.port,
      startedAt: anchorCtx.startedAt,
      workspace: resolved,
    };
    const resources = this.hooks.setup(ctx);
    const workspace: Workspace = {
      key: resolved,
      path: known.path,
      branch: known.branch,
      isAnchor: false,
      ctx,
      ...resources,
      createdAt: new Date().toISOString(),
    };
    this.active.set(resolved, workspace);
    this.log(`[workspaces] created "${resolved}" for ${known.path}`);
    return workspace;
  }

  list(): WorkspaceSummary[] {
    return this.keys().map((key) => {
      const known = this.known.get(key)!;
      const live = this.active.get(key);
      return {
        key,
        path: known.path,
        branch: live?.branch ?? known.branch,
        isAnchor: key === this.anchorKey,
        active: Boolean(live),
      };
    });
  }

  /**
   * Re-read the worktree list. Worktrees that vanished have their resources
   * released; new ones become addressable (and are created on first use).
   * Concurrent calls share one in-flight refresh.
   */
  refresh(): Promise<{ added: string[]; removed: string[] }> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<{ added: string[]; removed: string[] }> {
    const anchorPath = this.anchor.path;
    let worktrees: GitWorktree[];
    try {
      worktrees = (await this.listWorktrees(anchorPath)).filter((wt) => !wt.bare);
    } catch (err) {
      this.log(`[workspaces] worktree list failed: ${(err as Error).message}`);
      worktrees = [];
    }
    const next = assignWorkspaceKeys(worktrees, anchorPath, this.anchorKey);

    const added = Array.from(next.keys()).filter((k) => !this.known.has(k));
    const removed = Array.from(this.known.keys()).filter((k) => k !== this.anchorKey && !next.has(k));

    for (const key of removed) {
      const live = this.active.get(key);
      if (live) {
        this.hooks.teardown(live.handles);
        this.active.delete(key);
        this.log(`[workspaces] released "${key}" (worktree removed)`);
      }
    }
    // A key that stayed but now points elsewhere (worktree moved) is rebuilt on next use.
    for (const [key, info] of next) {
      const live = this.active.get(key);
      if (live && !live.isAnchor && canonical(live.path) !== canonical(info.path)) {
        this.hooks.teardown(live.handles);
        this.active.delete(key);
        this.log(`[workspaces] released "${key}" (worktree moved)`);
      }
      if (live?.isAnchor) live.branch = info.branch;
    }
    this.known = next;
    return { added, removed };
  }

  /**
   * The workspace a request addresses: the `X-Ndx-Workspace` header, else the
   * `/w/<key>/` slot, else the anchor. An unknown key also falls back to the
   * anchor rather than failing — a stale tab must not 404 its whole dashboard.
   */
  resolveWorkspace(req: Pick<IncomingMessage, "headers" | "url">): Workspace {
    const header = req.headers[WORKSPACE_HEADER];
    const fromHeader = Array.isArray(header) ? header[0] : header;
    const fromSlot = WORKSPACE_SLOT_PATTERN.exec(req.url || "/")?.[1];
    const key = fromHeader?.trim() || (fromSlot ? decodeURIComponent(fromSlot) : "");
    if (!key) return this.anchor;
    return this.get(key) ?? this.anchor;
  }

  /** Begin periodic refreshes (and run one now, in the background). */
  start(): void {
    void this.refresh();
    if (this.refreshIntervalMs > 0 && !this.timer) {
      this.timer = setInterval(() => void this.refresh(), this.refreshIntervalMs);
      this.timer.unref();
    }
  }

  /** Stop the timer and release every non-anchor workspace. The anchor's resources belong to start.ts. */
  closeAll(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const [key, live] of this.active) {
      if (live.isAnchor) continue;
      this.hooks.teardown(live.handles);
      this.active.delete(key);
    }
  }
}

/**
 * The workspace a rex MCP server serves, rebindable from the client's MCP roots.
 *
 * `rex mcp .` serves the directory it was spawned in. Claude desktop spawns
 * it in the main checkout while the session works in a linked worktree
 * (#499), so the stdio server re-resolves its workspace from `roots/list`
 * after `initialize` and on `notifications/roots/list_changed`. Handlers read
 * {@link WorkspaceBinding.current} at call time, never at registration.
 */

import { resolve } from "node:path";
import { resolveWorkspaceFromRoots, type WorkspaceRoot } from "@n-dx/llm-client";
import {
  ensureLegacyPrdMigrated,
  openClaimsStore,
  resolveClaimHolder,
  resolveRexPaths,
  resolveStore,
  PRD_TREE_DIRNAME,
  type ClaimsStore,
  type PRDStore,
} from "../store/index.js";
import { formatMigrationBanner, getMigrationMcpWarning } from "./migration-notification.js";

/** How long a tool call waits for an in-flight roots resolution. */
export const ROOTS_RESOLUTION_WAIT_MS = 2_000;

/** How long `roots/list` may take before the resolution gives up. */
const LIST_ROOTS_TIMEOUT_MS = 10_000;

export interface RexWorkspace {
  /** Project directory being served. */
  projectDir: string;
  rexDir: string;
  store: PRDStore;
  claims: { store: ClaimsStore; worktreeRoot: string };
  /** Whether `projectDir` came from the client's roots or the startup dir. */
  source: "roots" | "startup";
  /** Directory the server was started for. */
  startupDir: string;
  /** Set when the client's root cannot be served: writes must be refused. */
  refused?: string;
  /** One-time migration notice for the first tool call against this workspace. */
  migrationWarning?: string;
}

/** Open the store and claims for `projectDir`, migrating a legacy PRD first. */
export async function openRexWorkspace(
  projectDir: string,
  source: RexWorkspace["source"],
  startupDir: string,
): Promise<RexWorkspace> {
  const migration = await ensureLegacyPrdMigrated(projectDir);
  if (migration.migrated) {
    console.error(formatMigrationBanner(
      migration.backupPath ?? "(unknown)",
      migration.itemCount ?? 0,
      migration.folderTreePath ?? PRD_TREE_DIRNAME,
    ));
  }
  const rexDir = resolveRexPaths(projectDir).rexDir;
  return {
    projectDir,
    rexDir,
    store: await resolveStore(rexDir),
    // Cross-worktree claims: selection skips tasks another worktree is working
    // on. Outside a repository this is the no-op store and nothing is skipped.
    claims: { store: openClaimsStore(projectDir), worktreeRoot: resolveClaimHolder(projectDir).worktreeRoot },
    source,
    startupDir,
    ...(migration.migrated ? { migrationWarning: getMigrationMcpWarning(migration) } : {}),
  };
}

/** Writes diagnostics to stderr; stdout carries the MCP protocol. */
export type WorkspaceLog = (line: string) => void;

const stderrLog: WorkspaceLog = (line) => process.stderr.write(`${line}\n`);

/**
 * Holds the current workspace and moves it when the client's roots change.
 *
 * Without roots tracking ({@link WorkspaceBinding.fixed}) it is a constant.
 */
export class WorkspaceBinding {
  current: RexWorkspace;
  private readonly startup: RexWorkspace;
  private readonly log: WorkspaceLog;
  private readonly waitMs: number;
  /** Latest resolution; tool calls wait for it (bounded). */
  private pending: Promise<void> | null;
  private settlePending: (() => void) | null = null;
  private generation = 0;

  private constructor(startup: RexWorkspace, awaitRoots: boolean, log: WorkspaceLog, waitMs: number) {
    this.startup = startup;
    this.current = startup;
    this.log = log;
    this.waitMs = waitMs;
    // Until the client finishes initializing nobody knows whether it has roots,
    // so a call that races ahead of `initialized` waits like any other.
    this.pending = awaitRoots ? new Promise((done) => { this.settlePending = done; }) : null;
  }

  /** A binding that never moves. */
  static fixed(workspace: RexWorkspace): WorkspaceBinding {
    return new WorkspaceBinding(workspace, false, stderrLog, 0);
  }

  /** A binding that follows the client's roots once {@link resolve} is called. */
  static tracking(
    startup: RexWorkspace,
    options: { log?: WorkspaceLog; waitMs?: number } = {},
  ): WorkspaceBinding {
    return new WorkspaceBinding(startup, true, options.log ?? stderrLog, options.waitMs ?? ROOTS_RESOLUTION_WAIT_MS);
  }

  /** The startup workspace stays current: the client has no roots. */
  settleWithoutRoots(): void {
    this.finish(this.pending);
  }

  /**
   * Re-resolve from `listRoots()`. Later calls supersede earlier ones that
   * have not finished, so the last `list_changed` wins.
   */
  resolve(listRoots: (timeoutMs: number) => Promise<readonly WorkspaceRoot[]>): Promise<void> {
    const generation = ++this.generation;
    const run = (async () => {
      let next: RexWorkspace;
      try {
        next = await this.workspaceFor(await listRoots(LIST_ROOTS_TIMEOUT_MS));
      } catch (err) {
        // The client could not answer roots/list. Nothing names another tree,
        // so the startup dir is the honest answer.
        this.log(`rex mcp: could not read the client's roots (${(err as Error).message}); serving ${this.startup.projectDir}`);
        next = this.startup;
      }
      if (generation !== this.generation) return;
      this.bind(next);
    })();
    this.finish(run);
    return run;
  }

  /** Wait (bounded) for the latest resolution before serving a call. */
  async ready(): Promise<RexWorkspace> {
    const pending = this.pending;
    if (pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        pending.then(() => false),
        new Promise<boolean>((done) => { timer = setTimeout(() => done(true), this.waitMs); }),
      ]);
      clearTimeout(timer);
      if (timedOut && this.pending === pending) {
        this.log(`rex mcp: client roots not resolved within ${this.waitMs}ms; serving ${this.current.projectDir}`);
        // Do not make every later call pay the wait again.
        this.pending = null;
      }
    }
    return this.current;
  }

  /** Route `pending` to `run`, releasing the pre-initialize gate. */
  private finish(run: Promise<void> | null): void {
    const settle = this.settlePending;
    this.settlePending = null;
    this.pending = run;
    run?.then(() => { if (this.pending === run) this.pending = null; });
    settle?.();
  }

  private async workspaceFor(roots: readonly WorkspaceRoot[]): Promise<RexWorkspace> {
    const startupDir = this.startup.projectDir;
    const resolution = resolveWorkspaceFromRoots({ roots, startupDir, marker: "rexDir" });
    if (resolution.refused) return this.refusing(resolution.refused);
    if (resolution.source === "startup") return this.startup;
    if (resolve(resolution.dir) === resolve(this.current.projectDir) && !this.current.refused) return this.current;
    try {
      return await openRexWorkspace(resolution.dir, "roots", startupDir);
    } catch (err) {
      return this.refusing(
        `The MCP client is working in ${resolution.dir}, but rex could not open it (${(err as Error).message}). ` +
        `Refusing to write to ${startupDir} on its behalf.`,
      );
    }
  }

  /** The startup workspace, read-only on behalf of a client root it cannot serve. */
  private refusing(refused: string): RexWorkspace {
    // The migration notice belongs to the startup workspace object, which
    // clears it once shown; a copy would show it again.
    const { migrationWarning: _shownByStartup, ...startup } = this.startup;
    return { ...startup, refused };
  }

  private bind(next: RexWorkspace): void {
    const previous = this.current;
    this.current = next;
    if (next.refused) {
      if (next.refused !== previous.refused) this.log(`rex mcp: ${next.refused}`);
    } else if (next.projectDir !== previous.projectDir || previous.refused) {
      this.log(next.source === "roots"
        ? `rex mcp: serving ${next.projectDir} (client root; started in ${next.startupDir})`
        : `rex mcp: serving ${next.projectDir} (startup dir)`);
    }
  }
}

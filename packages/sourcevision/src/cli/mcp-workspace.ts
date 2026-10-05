/**
 * The workspace a stdio sourcevision MCP server serves, rebindable from the
 * client's MCP roots.
 *
 * `sv mcp .` serves the directory it was spawned in. Claude desktop spawns it
 * in the main checkout while the session works in a linked worktree (#499), so
 * the stdio server re-resolves its workspace from `roots/list` after
 * `initialize` and on `notifications/roots/list_changed`. Tool and resource
 * handlers read {@link WorkspaceBinding.current} at call time.
 *
 * Mirrors rex's binding (`packages/rex/src/cli/mcp-workspace.ts`); the two
 * packages may not share it, only the foundation helper they both call.
 */

import { resolve } from "node:path";
import { resolveWorkspaceFromRoots, type WorkspaceRoot } from "@n-dx/llm-client";

/** How long a call waits for an in-flight roots resolution. */
export const ROOTS_RESOLUTION_WAIT_MS = 2_000;

/** How long `roots/list` may take before the resolution gives up. */
const LIST_ROOTS_TIMEOUT_MS = 10_000;

/** The part of a served workspace the binding needs to know about. */
export interface BoundWorkspace {
  absDir: string;
  /** Set when the client's root cannot be served: writes must be refused. */
  refused?: string;
}

/** Writes diagnostics to stderr; stdout carries the MCP protocol. */
export type WorkspaceLog = (line: string) => void;

const stderrLog: WorkspaceLog = (line) => process.stderr.write(`${line}\n`);

export class WorkspaceBinding<W extends BoundWorkspace> {
  current: W;
  private readonly startup: W;
  private readonly open: (dir: string) => W;
  private readonly log: WorkspaceLog;
  private readonly waitMs: number;
  /** Latest resolution; calls wait for it (bounded). */
  private pending: Promise<void> | null;
  private settlePending: (() => void) | null = null;
  private generation = 0;

  private constructor(startup: W, open: (dir: string) => W, awaitRoots: boolean, log: WorkspaceLog, waitMs: number) {
    this.startup = startup;
    this.current = startup;
    this.open = open;
    this.log = log;
    this.waitMs = waitMs;
    // Until the client finishes initializing nobody knows whether it has roots,
    // so a call that races ahead of `initialized` waits like any other.
    this.pending = awaitRoots ? new Promise((done) => { this.settlePending = done; }) : null;
  }

  /** A binding that never moves. */
  static fixed<W extends BoundWorkspace>(workspace: W): WorkspaceBinding<W> {
    return new WorkspaceBinding(workspace, () => workspace, false, stderrLog, 0);
  }

  /** A binding that follows the client's roots once {@link resolve} is called. */
  static tracking<W extends BoundWorkspace>(
    startup: W,
    open: (dir: string) => W,
    options: { log?: WorkspaceLog; waitMs?: number } = {},
  ): WorkspaceBinding<W> {
    return new WorkspaceBinding(startup, open, true, options.log ?? stderrLog, options.waitMs ?? ROOTS_RESOLUTION_WAIT_MS);
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
      let next: W;
      try {
        next = this.workspaceFor(await listRoots(LIST_ROOTS_TIMEOUT_MS));
      } catch (err) {
        // The client could not answer roots/list. Nothing names another tree,
        // so the startup dir is the honest answer.
        this.log(`sourcevision mcp: could not read the client's roots (${(err as Error).message}); serving ${this.startup.absDir}`);
        next = this.startup;
      }
      if (generation !== this.generation) return;
      this.bind(next);
    })();
    this.finish(run);
    return run;
  }

  /** Wait (bounded) for the latest resolution; returns the workspace to serve. */
  async ready(): Promise<W> {
    const pending = this.pending;
    if (pending) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        pending.then(() => false),
        new Promise<boolean>((done) => { timer = setTimeout(() => done(true), this.waitMs); }),
      ]);
      clearTimeout(timer);
      if (timedOut && this.pending === pending) {
        this.log(`sourcevision mcp: client roots not resolved within ${this.waitMs}ms; serving ${this.current.absDir}`);
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

  private workspaceFor(roots: readonly WorkspaceRoot[]): W {
    const resolution = resolveWorkspaceFromRoots({ roots, startupDir: this.startup.absDir, marker: "sourcevisionDir" });
    if (resolution.refused) return { ...this.startup, refused: resolution.refused };
    if (resolution.source === "startup") return this.startup;
    if (resolve(resolution.dir) === resolve(this.current.absDir) && !this.current.refused) return this.current;
    return this.open(resolution.dir);
  }

  private bind(next: W): void {
    const previous = this.current;
    this.current = next;
    if (next.refused) {
      if (next.refused !== previous.refused) this.log(`sourcevision mcp: ${next.refused}`);
    } else if (next.absDir !== previous.absDir || previous.refused) {
      this.log(next.absDir === this.startup.absDir
        ? `sourcevision mcp: serving ${next.absDir} (startup dir)`
        : `sourcevision mcp: serving ${next.absDir} (client root; started in ${this.startup.absDir})`);
    }
  }
}

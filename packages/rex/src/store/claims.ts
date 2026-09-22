/**
 * Cross-worktree task claims.
 *
 * Nothing else stops two worktrees of one repository from picking the same
 * task: each checkout has its own `.rex/prd_tree`, its own `.hench/locks`,
 * and a dashboard sees only its own children. A claim is the one thing every
 * worktree can see, because it lives in the git *common* directory —
 * `git rev-parse --git-common-dir`, shared by the main checkout and every
 * linked worktree — at `<commonDir>/ndx/claims.json`. Being inside `.git/`,
 * it is never tracked.
 *
 * A claim names the task, the worktree that holds it, the holder's pid and
 * when it expires. It is live while the pid exists and the expiry has not
 * passed; a dead or expired claim is ignored by readers and pruned by the
 * next writer, so a crashed run never wedges a task. Writes go through the
 * advisory file lock (`claims.lock`, same mechanism as the PRD lock) and an
 * atomic rename, so two processes claiming at once see one winner.
 *
 * **The worktree is the identity; the pid is only liveness.** One process can
 * serve several worktrees — the dashboard builds a rex MCP server per
 * workspace inside one server process — so a pid says nothing about which
 * checkout is asking. Every ownership decision here (claim, release, "is this
 * someone else's?") compares `worktreeRoot` alone; the pid is consulted only
 * by `isLive`. See {@link sameHolder} for what went wrong when it was both.
 *
 * Outside a git repository there is nothing to share, so the store is a
 * no-op: every claim succeeds and nothing is recorded — behaviour is exactly
 * what it was before claims existed.
 *
 * @module rex/store/claims
 */

import { mkdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { getGitCommonDir, getWorktreeRoot } from "@n-dx/llm-client";
import { atomicWriteJSON } from "./atomic-write.js";
import { withLock, type LockOptions } from "./file-lock.js";

/** Default time a claim stays valid without being refreshed: four hours. */
export const DEFAULT_CLAIM_TTL_MS = 4 * 60 * 60 * 1000;

/** Directory under the git common dir holding n-dx's cross-worktree state. */
export const CLAIMS_DIRNAME = "ndx";
export const CLAIMS_FILENAME = "claims.json";
const CLAIMS_LOCK_FILENAME = "claims.lock";
const CLAIMS_FILE_VERSION = 1;

/**
 * Why a claim is being kept after the run that took it has ended.
 *
 * `uncommitted-work`: the completion gate refused to mark the task done
 * because the run's work is still uncommitted in that worktree. Releasing
 * then would let a second worktree claim the task and redo work that already
 * exists on disk, so the claim is held instead — see {@link ClaimsStore.hold}.
 */
export type ClaimHoldReason = "uncommitted-work";

export interface TaskClaim {
  taskId: string;
  /** Realpath of the worktree root working the task. */
  worktreeRoot: string;
  /** Process holding the claim. Liveness is checked with `kill(pid, 0)`. */
  pid: number;
  /** Informational — claims are only meaningful on one machine. */
  host: string;
  claimedAt: string;
  expiresAt: string;
  /**
   * Set when the claim is deliberately held past its holder's exit. A held
   * claim's {@link pid} is expected to be dead, so liveness falls back to the
   * expiry alone. Absent on an ordinary claim held by a running process.
   */
  reason?: ClaimHoldReason;
}

interface ClaimsFile {
  version: number;
  claims: Record<string, TaskClaim>;
}

export interface ClaimOptions {
  worktreeRoot: string;
  /** Defaults to this process. */
  pid?: number;
  /** Defaults to {@link DEFAULT_CLAIM_TTL_MS}. */
  ttlMs?: number;
}

export type ClaimResult =
  | { ok: true; claim: TaskClaim }
  | { ok: false; heldBy: TaskClaim };

export interface ReleaseOptions {
  /**
   * Release the claim whoever holds it.
   *
   * Ownership is otherwise absolute: a run may only free what its own
   * worktree took, which is what stops one checkout clearing another's claim
   * by accident. `rex claim release --force` is the deliberate exception —
   * an operator clearing a claim whose holder is gone, or whose hold they
   * have dealt with, standing in whichever worktree they happen to be in.
   */
  force?: boolean;
}

/**
 * Who is asking, for the operations that only need identity.
 *
 * Just the worktree: the pid identifies nothing, because one process can serve
 * several worktrees (see {@link sameHolder}). `ClaimHolder` satisfies this, so
 * a caller that already has one passes it unchanged.
 */
export interface ClaimOwner {
  worktreeRoot: string;
}

/** Who is asking: the worktree a process runs in, and the process itself. */
export interface ClaimHolder {
  worktreeRoot: string;
  pid: number;
}

/**
 * The holder identity for a process working in `projectDir`: the worktree
 * root git reports (realpath-resolved, so it compares equal to what the
 * dashboard and other worktrees record), or the directory itself outside a
 * repository — where the store is a no-op and the value is only informational.
 */
export function resolveClaimHolder(projectDir: string): ClaimHolder {
  return { worktreeRoot: getWorktreeRoot(projectDir) ?? resolve(projectDir), pid: process.pid };
}

export interface ClaimsStore {
  /** Where claims are kept, or null for the no-op store outside a repository. */
  readonly path: string | null;
  /** Every live claim — dead pids and expired entries are filtered out. */
  readClaims(): Promise<TaskClaim[]>;
  /**
   * Claim a task. Succeeds when no live claim exists, or when the live claim
   * belongs to this worktree — a retry in the checkout that already holds the
   * task is not a conflict. Otherwise reports who holds it.
   */
  claim(taskId: string, options: ClaimOptions): Promise<ClaimResult>;
  /**
   * Release a claim this worktree holds. False when no such claim exists, or
   * when it belongs to another worktree. Held claims release like any other —
   * that is what frees a task after the work is dealt with.
   */
  release(taskId: string, holder: ClaimOwner, options?: ReleaseOptions): Promise<boolean>;
  /**
   * Keep a claim this worktree holds after its process exits, recording why.
   *
   * An ordinary claim dies with its pid, which is what stops a crashed run
   * wedging a task. That is exactly wrong when the run ended by *refusing* to
   * complete the task because its work is still uncommitted: the work exists,
   * in this worktree, and a second worktree picking the task up would redo it.
   * A held claim therefore survives a dead pid and lapses only at its expiry,
   * which is not extended here — an abandoned hold still clears itself at the
   * original TTL.
   *
   * Returns the held claim, or null when this worktree holds no live claim on
   * the task.
   */
  hold(taskId: string, holder: ClaimOwner, reason: ClaimHoldReason): Promise<TaskClaim | null>;
  /**
   * The live claim held by another worktree, or null when the task is free or
   * held by this one.
   */
  isClaimedByOther(taskId: string, holder: ClaimOwner): Promise<TaskClaim | null>;
  /** Live claims held by worktrees other than `worktreeRoot`, keyed by task id. */
  claimedElsewhere(worktreeRoot: string): Promise<Map<string, TaskClaim>>;
}

export interface ClaimsStoreOptions {
  /** Injectable clock — tests advance it past an expiry. */
  now?: () => number;
  /** Injectable liveness check — tests declare a pid dead. */
  isPidAlive?: (pid: number) => boolean;
  /** Timing for the advisory lock. */
  lock?: LockOptions;
}

/** `kill(pid, 0)` existence check; EPERM means "exists, not ours to signal", which is still alive. */
export function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** `<git common dir>/ndx/claims.json`, or null outside a repository. */
export function claimsStorePath(projectDir: string): string | null {
  const common = getGitCommonDir(projectDir);
  return common ? join(common, CLAIMS_DIRNAME, CLAIMS_FILENAME) : null;
}

/** The store used outside a git repository: claims always succeed and record nothing. */
export const NOOP_CLAIMS_STORE: ClaimsStore = {
  path: null,
  async readClaims() {
    return [];
  },
  async claim(taskId, options) {
    const now = new Date();
    return {
      ok: true,
      claim: {
        taskId,
        worktreeRoot: options.worktreeRoot,
        pid: options.pid ?? process.pid,
        host: hostname(),
        claimedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + (options.ttlMs ?? DEFAULT_CLAIM_TTL_MS)).toISOString(),
      },
    };
  },
  async release() {
    return true;
  },
  async hold() {
    // Nothing was recorded, so there is nothing to hold.
    return null;
  },
  async isClaimedByOther() {
    return null;
  },
  async claimedElsewhere() {
    return new Map();
  },
};

/** Open the claims store for the repository containing `projectDir`. */
export function openClaimsStore(projectDir: string, options: ClaimsStoreOptions = {}): ClaimsStore {
  const path = claimsStorePath(projectDir);
  if (!path) return NOOP_CLAIMS_STORE;
  return new FileClaimsStore(path, options);
}

class FileClaimsStore implements ClaimsStore {
  readonly path: string;
  private readonly dir: string;
  private readonly lockPath: string;
  private readonly now: () => number;
  private readonly isPidAlive: (pid: number) => boolean;
  private readonly lockOptions: LockOptions | undefined;

  constructor(path: string, options: ClaimsStoreOptions) {
    this.path = path;
    this.dir = join(path, "..");
    this.lockPath = join(this.dir, CLAIMS_LOCK_FILENAME);
    this.now = options.now ?? (() => Date.now());
    this.isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
    this.lockOptions = options.lock;
  }

  private isLive(claim: TaskClaim): boolean {
    const expires = Date.parse(claim.expiresAt);
    if (!Number.isFinite(expires) || expires <= this.now()) return false;
    // A held claim outlives the process that took it — that is the whole
    // point of holding one, so the pid says nothing here and only the expiry
    // can retire it. See {@link ClaimsStore.hold}.
    if (claim.reason) return true;
    return this.isPidAlive(claim.pid);
  }

  /** Parse the file, tolerating absence and corruption (a corrupt file is an empty one). */
  private async load(): Promise<ClaimsFile> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf-8");
    } catch {
      return { version: CLAIMS_FILE_VERSION, claims: {} };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<ClaimsFile>;
      const claims: Record<string, TaskClaim> = {};
      for (const [taskId, value] of Object.entries(parsed.claims ?? {})) {
        if (isClaim(value)) claims[taskId] = { ...value, taskId };
      }
      return { version: CLAIMS_FILE_VERSION, claims };
    } catch {
      return { version: CLAIMS_FILE_VERSION, claims: {} };
    }
  }

  /** Load, drop everything that is no longer live, hand the rest to `mutate`, write. */
  private async update<T>(mutate: (claims: Record<string, TaskClaim>) => T): Promise<T> {
    await mkdir(this.dir, { recursive: true });
    return withLock(this.lockPath, async () => {
      const file = await this.load();
      const live: Record<string, TaskClaim> = {};
      for (const [taskId, claim] of Object.entries(file.claims)) {
        if (this.isLive(claim)) live[taskId] = claim;
      }
      const result = mutate(live);
      await atomicWriteJSON(this.path, { version: CLAIMS_FILE_VERSION, claims: live } satisfies ClaimsFile);
      return result;
    }, this.lockOptions);
  }

  async readClaims(): Promise<TaskClaim[]> {
    const file = await this.load();
    return Object.values(file.claims).filter((c) => this.isLive(c));
  }

  async claim(taskId: string, options: ClaimOptions): Promise<ClaimResult> {
    const pid = options.pid ?? process.pid;
    const ttlMs = options.ttlMs ?? DEFAULT_CLAIM_TTL_MS;
    return this.update((claims) => {
      const existing = claims[taskId];
      if (existing && !sameHolder(existing, options.worktreeRoot)) {
        return { ok: false, heldBy: existing };
      }
      const nowMs = this.now();
      const claim: TaskClaim = {
        taskId,
        worktreeRoot: options.worktreeRoot,
        pid,
        host: hostname(),
        // A refresh or same-worktree takeover keeps the original claim time;
        // the expiry moves.
        claimedAt: existing?.claimedAt ?? new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + ttlMs).toISOString(),
      };
      // Deliberately no `reason`: a live process has taken the task, so
      // whatever hold was recorded is over. Re-running in the worktree that
      // left uncommitted work is one of the ways to resolve a hold.
      claims[taskId] = claim;
      return { ok: true, claim };
    });
  }

  async release(taskId: string, holder: ClaimOwner, options: ReleaseOptions = {}): Promise<boolean> {
    return this.update((claims) => {
      const existing = claims[taskId];
      if (!existing) return false;
      if (!options.force && !sameHolder(existing, holder.worktreeRoot)) return false;
      delete claims[taskId];
      return true;
    });
  }

  async hold(taskId: string, holder: ClaimOwner, reason: ClaimHoldReason): Promise<TaskClaim | null> {
    return this.update((claims) => {
      const existing = claims[taskId];
      if (!existing || !sameHolder(existing, holder.worktreeRoot)) return null;
      // The expiry is carried over untouched: holding a claim states why it
      // is still here, it does not buy it more time.
      const held: TaskClaim = { ...existing, reason };
      claims[taskId] = held;
      return held;
    });
  }

  async isClaimedByOther(taskId: string, holder: ClaimOwner): Promise<TaskClaim | null> {
    const file = await this.load();
    const claim = file.claims[taskId];
    if (!claim || !this.isLive(claim)) return null;
    return sameHolder(claim, holder.worktreeRoot) ? null : claim;
  }

  async claimedElsewhere(worktreeRoot: string): Promise<Map<string, TaskClaim>> {
    const out = new Map<string, TaskClaim>();
    for (const claim of await this.readClaims()) {
      if (claim.worktreeRoot !== worktreeRoot) out.set(claim.taskId, claim);
    }
    return out;
  }
}

/**
 * Whose claim it is. The worktree decides — never the pid.
 *
 * This read `claim.pid === pid || claim.worktreeRoot === worktreeRoot`, and
 * the pid arm was safe exactly as long as one process meant one worktree:
 * `hench run` is a CLI invocation inside a checkout, so its pid tracked its
 * worktree. The MCP path broke that property. `ndx start` builds one rex MCP
 * server *per workspace* inside a single server process
 * (`initMcpRoutes` → `createRexMcpServer(rctx.projectDir)`, reached through
 * the workspace-resolved ctx), and the MCP handlers claim without passing a
 * pid, so every worktree's claim carries the same pid — the dashboard's.
 *
 * With the pid arm, worktree B claiming a task worktree A holds matched on
 * `claim.pid === pid`, read as "already ours", and overwrote the claim with
 * B's worktreeRoot while returning ok. Both were told they held it, the
 * `in_progress` refusal never fired, either could release the other's claim,
 * and the dashboard's own "another worktree holds this" 409 went quiet too.
 * Stdio MCP (`ndx rex mcp .`, one process per worktree) never showed it,
 * which is what made it easy to miss.
 *
 * The pid is still recorded and still load-bearing — `isLive` checks it with
 * `kill(pid, 0)`, so a crashed holder's claim is pruned rather than wedging
 * the task for the rest of the TTL. It just has nothing to do with identity.
 *
 * Two processes in the *same* worktree remain one holder: a retry in the
 * checkout that already holds the task is not a conflict, which is the
 * behaviour this has always documented.
 */
function sameHolder(claim: TaskClaim, worktreeRoot: string): boolean {
  return claim.worktreeRoot === worktreeRoot;
}

function isClaim(value: unknown): value is TaskClaim {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.worktreeRoot === "string" &&
    typeof c.pid === "number" &&
    typeof c.expiresAt === "string" &&
    typeof c.claimedAt === "string" &&
    (c.reason === undefined || typeof c.reason === "string")
  );
}

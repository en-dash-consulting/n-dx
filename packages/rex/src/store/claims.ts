/**
 * Cross-worktree task claims.
 *
 * Nothing in the PRD backend stops two checkouts of the same repository from
 * picking the same task: `.rex/prd_tree/` is per-branch, hench's process locks
 * are per-checkout, and the dashboard only ever sees its own children. A claim
 * is the missing shared fact — "someone, somewhere in this repository, is
 * working on this task right now".
 *
 * It is stored in the *git common directory* (`git rev-parse --git-common-dir`,
 * i.e. `<repo>/.git/ndx/claims.json`), which is the one location every linked
 * worktree of a repository agrees on and no worktree can commit: it lives
 * inside `.git`, so git will never track it and a claim can never travel to
 * another machine in a branch. Outside a git repository there is no such shared
 * location and no second worktree to collide with, so {@link openClaimsStore}
 * returns a no-op store and behaviour is unchanged.
 *
 * ## What makes a claim live
 *
 * Two independent conditions, and a claim must satisfy both:
 *
 *   1. **Its owning process is still running** (`process.kill(pid, 0)`). This is
 *      what releases a claim when a run is killed, crashes, or the machine is
 *      rebooted — the common case, and it recovers in seconds rather than hours.
 *   2. **It has not expired** (default {@link DEFAULT_CLAIM_TTL_MS}). The PID
 *      check is only meaningful on the host that wrote the claim and says
 *      nothing about a process that is alive but has long since wandered off
 *      the task. The TTL is the backstop for both.
 *
 * A claim that fails either test is ignored on read and dropped on the next
 * write. Nothing has to garbage-collect it, so an abandoned claim can never
 * become a permanent outage for a task.
 *
 * ## Contract for changing the record shape
 *
 * The file is disposable advisory state: a record this module cannot parse is
 * dropped, which leaves its task looking free. Two worktrees may be running
 * different rex versions against one repository, so **changes to the record
 * shape must be additive** — removing or repurposing a field makes the older
 * reader blind to the newer reader's claims, which is precisely the
 * double-pick this module exists to prevent.
 *
 * @module store/claims
 */

import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getGitCommonDir, getWorktreeRoot } from "@n-dx/llm-client";

import { atomicWriteJSON } from "./atomic-write.js";
import { withLock } from "./file-lock.js";

// ── Constants ────────────────────────────────────────────────────────

/** Subdirectory of the git common dir that holds n-dx's cross-worktree state. */
export const CLAIMS_DIRNAME = "ndx";

/** Name of the claims file. */
export const CLAIMS_FILENAME = "claims.json";

/** Name of the advisory lock guarding the claims file. */
export const CLAIMS_LOCK_FILENAME = "claims.lock";

/**
 * How long a claim stays live without being renewed.
 *
 * Four hours: comfortably longer than any single autonomous task run, so a
 * healthy run is never evicted mid-flight, and short enough that a claim left
 * behind by a process that outlived its work frees the task the same day.
 */
export const DEFAULT_CLAIM_TTL_MS = 4 * 60 * 60 * 1000;

// ── Types ────────────────────────────────────────────────────────────

/** One task claimed by one process in one worktree. */
export interface TaskClaim {
  /** PRD item id being worked on. */
  taskId: string;
  /** PID of the claiming process, on the machine holding the repository. */
  pid: number;
  /** Root of the worktree the claim was taken from — shown to the operator. */
  worktreeRoot: string;
  /** When the claim was taken (ISO 8601). */
  claimedAt: string;
  /** When the claim lapses if not renewed (ISO 8601). */
  expiresAt: string;
}

/** Who is claiming, and for how long. */
export interface ClaimOptions {
  /** Defaults to this process. */
  pid?: number;
  /** Defaults to the worktree containing the project directory. */
  worktreeRoot?: string;
  /** Defaults to {@link DEFAULT_CLAIM_TTL_MS}. */
  ttlMs?: number;
}

/** Who is asking — defaults to this process, in this worktree. */
export interface ClaimIdentity {
  pid?: number;
  worktreeRoot?: string;
}

/** Cross-worktree claim store for one repository. */
export interface ClaimsStore {
  /** Absolute path to the claims file, or null for the no-op store. */
  readonly path: string | null;
  /** Every claim that is currently live. Never writes. */
  readClaims(): Promise<TaskClaim[]>;
  /** Take (or renew) a claim. Returns false when another live claim holds it. */
  claim(taskId: string, options?: ClaimOptions): Promise<boolean>;
  /** Drop our claim on a task. A claim owned by another process is left alone. */
  release(taskId: string, identity?: ClaimIdentity): Promise<void>;
  /** Is a *different* process holding this task right now? */
  isClaimedByOther(taskId: string, identity?: ClaimIdentity): Promise<boolean>;
  /**
   * Live claims held by a *different worktree*, keyed by task id.
   *
   * This is the predicate task selection uses, and it is deliberately coarser
   * than {@link ClaimsStore.isClaimedByOther}: it compares worktree roots only,
   * so a second process in the worktree that already holds a claim can still
   * pick the task up. That is the crash-retry case — the operator re-runs in the
   * same checkout, and a claim their own worktree left behind must not lock them
   * out of their own work. Across worktrees there is no such excuse, and the
   * claim stands.
   *
   * A map rather than a set because the caller has to be able to say *which*
   * worktree is holding the task: "skipped" with no explanation is the kind of
   * silence that gets debugged as a bug in task selection.
   */
  claimedElsewhere(worktreeRoot?: string): Promise<Map<string, TaskClaim>>;
}

/** What task selection passed over because another worktree holds it. */
export interface SkippedClaim {
  taskId: string;
  worktreeRoot: string;
  claimedAt: string;
}

/**
 * Render claims as the report a caller shows when it skipped them.
 *
 * Shared so `rex next --verbose`, `get_next_task` and the dashboard all name
 * the holder the same way — a skip the operator cannot attribute is worse than
 * no skip at all, because it looks like the task vanished.
 */
export function describeSkippedClaims(claims: Iterable<TaskClaim>): SkippedClaim[] {
  return [...claims].map((c) => ({
    taskId: c.taskId,
    worktreeRoot: c.worktreeRoot,
    claimedAt: c.claimedAt,
  }));
}

// ── Liveness ─────────────────────────────────────────────────────────

/**
 * Is `pid` a running process?
 *
 * `EPERM` means the process exists but belongs to another user — alive, and
 * emphatically not ours to evict. Every other error means it is gone.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = existence check, no signal delivered
    return true;
  } catch (err: unknown) {
    return Boolean(err && typeof err === "object" && "code" in err && (err as { code: string }).code === "EPERM");
  }
}

/** A claim counts only while its owner runs and its expiry is in the future. */
function isLive(claim: TaskClaim, now: number): boolean {
  const expiresAt = Date.parse(claim.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return isProcessAlive(claim.pid);
}

/** Does this claim belong to the caller? */
function isOurs(claim: TaskClaim, pid: number, worktreeRoot: string): boolean {
  return claim.pid === pid && claim.worktreeRoot === worktreeRoot;
}

// ── File I/O ─────────────────────────────────────────────────────────

/**
 * Parse one record, or null if it is not one.
 *
 * Unrecognised records are dropped rather than throwing: this is advisory
 * state written by other processes, and one bad line must not make the file
 * unreadable for everybody.
 */
function parseClaim(value: unknown): TaskClaim | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw["taskId"] !== "string" || !raw["taskId"]) return null;
  if (typeof raw["pid"] !== "number" || !Number.isInteger(raw["pid"])) return null;
  if (typeof raw["expiresAt"] !== "string") return null;
  return {
    taskId: raw["taskId"],
    pid: raw["pid"],
    worktreeRoot: typeof raw["worktreeRoot"] === "string" ? raw["worktreeRoot"] : "",
    claimedAt: typeof raw["claimedAt"] === "string" ? raw["claimedAt"] : raw["expiresAt"],
    expiresAt: raw["expiresAt"],
  };
}

/** Read every record in the file. A missing or corrupt file reads as empty. */
async function readAll(claimsPath: string): Promise<TaskClaim[]> {
  let raw: string;
  try {
    raw = await readFile(claimsPath, "utf-8");
  } catch {
    return []; // Not written yet, or unreadable — no claims either way.
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // Corrupt: treated as empty, and overwritten by the next claim.
  }

  const claims = (parsed as { claims?: unknown })?.claims;
  if (!Array.isArray(claims)) return [];
  return claims.map(parseClaim).filter((c): c is TaskClaim => c !== null);
}

async function writeAll(claimsPath: string, claims: TaskClaim[]): Promise<void> {
  await mkdir(dirname(claimsPath), { recursive: true });
  await atomicWriteJSON(claimsPath, { claims });
}

// ── The store ────────────────────────────────────────────────────────

/**
 * The store used outside a git repository.
 *
 * There is no shared location to write to and no second worktree to collide
 * with, so every answer is the one that leaves behaviour unchanged: nothing is
 * claimed, and every claim succeeds.
 */
const NOOP_STORE: ClaimsStore = {
  path: null,
  async readClaims() {
    return [];
  },
  async claim() {
    return true;
  },
  async release() {
    // Nothing was ever written.
  },
  async isClaimedByOther() {
    return false;
  },
  async claimedElsewhere() {
    return new Map();
  },
};

/**
 * Open the claim store for the repository containing `projectDir`.
 *
 * Returns a no-op store when `projectDir` is not inside a git repository (or
 * git is unavailable) — see {@link NOOP_STORE}.
 */
export function openClaimsStore(projectDir: string): ClaimsStore {
  const commonDir = getGitCommonDir(projectDir);
  if (!commonDir) return NOOP_STORE;

  const dir = join(commonDir, CLAIMS_DIRNAME);
  const claimsPath = join(dir, CLAIMS_FILENAME);
  const lockPath = join(dir, CLAIMS_LOCK_FILENAME);

  /** This worktree's root — the identity a claim is attributed to. */
  const defaultWorktreeRoot = getWorktreeRoot(projectDir) ?? projectDir;

  /**
   * Read, prune the lapsed, apply `fn`, and write — all under the lock, so a
   * concurrent claimer cannot slip between the read and the write and both
   * come away thinking they won.
   *
   * The lock file shares the claims directory, so the directory has to exist
   * before the lock can be taken.
   */
  async function mutate<T>(fn: (live: TaskClaim[]) => { claims: TaskClaim[]; result: T }): Promise<T> {
    await mkdir(dir, { recursive: true });
    return withLock(lockPath, async () => {
      const now = Date.now();
      const live = (await readAll(claimsPath)).filter((c) => isLive(c, now));
      const { claims, result } = fn(live);
      await writeAll(claimsPath, claims);
      return result;
    }, { label: "task claim" });
  }

  return {
    path: claimsPath,

    async readClaims() {
      const now = Date.now();
      return (await readAll(claimsPath)).filter((c) => isLive(c, now));
    },

    async claim(taskId, options) {
      const pid = options?.pid ?? process.pid;
      const worktreeRoot = options?.worktreeRoot ?? defaultWorktreeRoot;
      const ttlMs = options?.ttlMs ?? DEFAULT_CLAIM_TTL_MS;

      return mutate((live) => {
        const holder = live.find((c) => c.taskId === taskId);
        if (holder && !isOurs(holder, pid, worktreeRoot)) {
          // Someone else is on it. Their claim stands; we report the loss.
          return { claims: live, result: false };
        }

        const now = Date.now();
        const claim: TaskClaim = {
          taskId,
          pid,
          worktreeRoot,
          // Renewing our own claim keeps the original start time — it is when
          // the work began, which is what the dashboard shows.
          claimedAt: holder?.claimedAt ?? new Date(now).toISOString(),
          expiresAt: new Date(now + ttlMs).toISOString(),
        };
        return {
          claims: [...live.filter((c) => c.taskId !== taskId), claim],
          result: true,
        };
      });
    },

    async release(taskId, identity) {
      const pid = identity?.pid ?? process.pid;
      const worktreeRoot = identity?.worktreeRoot ?? defaultWorktreeRoot;

      // Compare-and-delete, as the PRD file lock does on its ownership token:
      // a process whose claim already lapsed and was retaken by someone else
      // must not evict the new holder when it finally gets around to releasing.
      await mutate((live) => ({
        claims: live.filter((c) => !(c.taskId === taskId && isOurs(c, pid, worktreeRoot))),
        result: undefined,
      }));
    },

    async isClaimedByOther(taskId, identity) {
      const pid = identity?.pid ?? process.pid;
      const worktreeRoot = identity?.worktreeRoot ?? defaultWorktreeRoot;
      const now = Date.now();
      const claims = await readAll(claimsPath);
      return claims.some((c) => c.taskId === taskId && isLive(c, now) && !isOurs(c, pid, worktreeRoot));
    },

    async claimedElsewhere(worktreeRoot) {
      const ours = worktreeRoot ?? defaultWorktreeRoot;
      const now = Date.now();
      const claims = await readAll(claimsPath);
      const byTask = new Map<string, TaskClaim>();
      for (const claim of claims) {
        if (claim.worktreeRoot === ours) continue;
        if (!isLive(claim, now)) continue;
        byTask.set(claim.taskId, claim);
      }
      return byTask;
    },
  };
}

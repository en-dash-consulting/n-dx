/**
 * Warm-parent session cache — the state behind cold-start elimination.
 *
 * ## The problem
 *
 * Every hench task spawns a fresh `claude -p`, and each spawn re-pays the
 * same cold start: the harness system prompt, the project's CLAUDE.md, skill
 * metadata, and the several turns the model spends re-discovering a repo it
 * explored ten minutes ago on the previous task. In a `--loop` that cost is
 * paid once per task, and again per retry.
 *
 * ## The mechanic
 *
 * Run orientation *once* — a read-only session that maps the layout and
 * confirms the build/test commands — then spawn each task as a fork of it
 * (`--resume <parentId> --fork-session`). A fork inherits the transcript
 * under a new session id without mutating the parent, so one orientation
 * serves many tasks, every fork starts with a byte-identical prefix (which
 * is what earns cache-read pricing), and no task re-explores.
 *
 * This module owns only the *state*: which parent exists, and whether it is
 * still safe to fork. The orientation spawn and fork wiring live in the loop.
 *
 * ## Why invalidation is the load-bearing part
 *
 * A cache miss costs one orientation spawn — cheap, and self-correcting. A
 * stale *hit* is the expensive failure: every task in the loop would inherit
 * an orientation describing a repo that has since changed, and act on it
 * confidently. So this module is permissive about failing to find a parent
 * (a corrupt file is simply a miss) and strict about using one: the analysis
 * fingerprint must match, the entry must be within its TTL, and the vendor
 * and model must be the ones it was created under.
 *
 * @module hench/agent/lifecycle/session-cache
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm, open, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { resolveLayout } from "../../prd/llm-gateway.js";

/** File under `.hench/` holding the cached parent session. */
export const SESSION_CACHE_FILE = "session-cache.json";

/** Default TTL for a cached orientation session. */
export const DEFAULT_PARENT_MAX_AGE_HOURS = 24;

/** Default number of tasks a single session executes under the batch strategy. */
export const DEFAULT_TASKS_PER_SESSION = 4;

/**
 * Schema version of a persisted {@link BatchChainEntry}.
 *
 * Bumped whenever the *meaning* of a field changes, so an entry written by an
 * older build is rejected by code rather than reinterpreted by it. Entries
 * written before this field existed read back as version 0 — see
 * {@link readBatchChain}.
 */
export const BATCH_CHAIN_VERSION = 1;

/** Default total lifetime of a batch chain, measured from its creation. */
export const DEFAULT_BATCH_MAX_AGE_HOURS = 8;

/** Default idle window of a batch chain, measured from its last use. */
export const DEFAULT_BATCH_MAX_IDLE_HOURS = 1;

/** How task spawns relate to sessions. */
export const SESSION_STRATEGIES = ["fork", "batch", "cold"] as const;
export type SessionStrategy = (typeof SESSION_STRATEGIES)[number];

/**
 * The independently addressable slots of the cache file.
 *
 * One per strategy that caches anything: `fork` keeps an orientation parent,
 * `batch` keeps a running chain, `cold` keeps neither. They share a file but
 * never a lifetime — see {@link clearSessionCache}.
 */
export const CACHE_SCOPES = ["parent", "batch"] as const;
export type CacheScope = (typeof CACHE_SCOPES)[number];

/**
 * A fault in a cached entry that holds however it is read.
 *
 * The deliberate contrast is with the identity rejections
 * (`worktree-changed`, `policy-changed`, …), which say the entry is wrong *for
 * this caller* — it may be perfectly good for the run that wrote it. A defect
 * says the entry is wrong for everyone: too old, unreadable, or written by a
 * scheme this build does not have. Only defects are evicted, because only a
 * defect makes the entry dead rather than merely unmatched.
 */
export type CacheDefect =
  | "unversioned"
  | "version-changed"
  | "malformed"
  | "expired"
  | "idle";

/** A cached orientation session. */
export interface SessionCacheEntry {
  /** Vendor session id to fork from. */
  parentId: string;
  /** ISO timestamp the orientation session was created. */
  createdAt: string;
  /** Fingerprint of the sourcevision analysis the orientation was built on. */
  svFingerprint: string;
  /** Vendor the parent was created under. */
  vendor: string;
  /** Model the parent was created under. */
  model: string;
}

/** Why a cached parent cannot be used. */
export type ParentRejection =
  | "no-entry"
  | "fresh-requested"
  | "sourcevision-changed"
  | "vendor-changed"
  | "model-changed"
  | "expired"
  | "malformed";

export type ParentVerdict = { usable: true } | { usable: false; reason: ParentRejection };

/**
 * The batch strategy's running session.
 *
 * Where forking gives every task the same orientation prefix in isolation,
 * batching resumes the *previous task's* session so the transcript
 * accumulates. That is the right shape for a CLI whose resume appends rather
 * than branches (`codex exec resume` has no fork equivalent), and it is why
 * the chain needs a bound: an unbounded shared transcript costs more on every
 * later turn and lets one task's framing bleed into the next.
 */
export interface BatchChainEntry extends BatchChainIdentity {
  /** {@link BATCH_CHAIN_VERSION} at write time; 0 for a pre-versioned entry. */
  version: number;
  /** Session the next task should resume. */
  sessionId: string;
  /** Tasks this session has already served, against `tasksPerSession`. */
  tasksUsed: number;
  /** ISO timestamp the chain's first task opened it. */
  createdAt: string;
  /** ISO timestamp the chain most recently served a task. */
  lastUsedAt: string;
  /**
   * Title of the last task this session served. Carried here rather than
   * threaded through the loop drivers: the chain is already the state that
   * survives between per-task `cliLoop` calls, so the divider's "previous
   * task" name belongs with it.
   */
  lastTaskTitle?: string;
}

/**
 * Everything a resumed session must still be true of.
 *
 * Resuming is not forking: `codex exec resume` appends to a transcript that
 * already carries its own sandbox and approval settings, and the adapter
 * cannot re-assert them (the subcommand rejects the policy flags). So a chain
 * carries the identity it was opened under and any drift ends it — the whole
 * point being that a session built for another worktree, ref, source state or
 * permission set must never receive this task's prompt.
 */
export interface BatchChainIdentity {
  /** Realpath-resolved worktree root the chain was opened in. */
  worktreeRoot: string;
  /** Branch, or `detached:<sha>`, from {@link chainRefIdentity}. */
  ref: string;
  /** Analysis fingerprint, from {@link sourcevisionFingerprint}. */
  svFingerprint: string;
  /** Execution-policy hash, from {@link policyFingerprint}. */
  policyHash: string;
  /** Vendor the chain was started under. */
  vendor: string;
  /** Model the chain was started under. */
  model: string;
}

/** Why a batch chain cannot be continued. */
export type BatchChainRejection =
  | "no-chain"
  | "disabled"
  | "unversioned"
  | "version-changed"
  | "malformed"
  | "worktree-changed"
  | "ref-changed"
  | "sourcevision-changed"
  | "policy-changed"
  | "vendor-changed"
  | "model-changed"
  | "expired"
  | "idle"
  | "cap-reached";

export type BatchChainVerdict =
  | { usable: true }
  | { usable: false; reason: BatchChainRejection };

/**
 * One rejection code per identity field, in check order.
 *
 * A table rather than a run of `if`s so that adding a field to
 * {@link BatchChainIdentity} without giving it a code is a type error, not a
 * silently unchecked key. `identity-codes-are-exhaustive` in
 * `batch-chain.test.ts` holds the other direction.
 */
const IDENTITY_CHECKS: ReadonlyArray<readonly [keyof BatchChainIdentity, BatchChainRejection]> = [
  ["worktreeRoot", "worktree-changed"],
  ["ref", "ref-changed"],
  ["svFingerprint", "sourcevision-changed"],
  ["policyHash", "policy-changed"],
  ["vendor", "vendor-changed"],
  ["model", "model-changed"],
];

/**
 * On-disk shape: the orientation parent stays flat at the top level — that is
 * the format already written by released code, and moving it would strand
 * caches in the field — while the batch chain gets its own nested key.
 */
interface SessionCacheFile extends Partial<SessionCacheEntry> {
  batch?: BatchChainEntry;
}

function cachePath(henchDir: string): string {
  return join(henchDir, SESSION_CACHE_FILE);
}

function lockPath(henchDir: string): string {
  return `${cachePath(henchDir)}.lock`;
}

/** A lock older than this is treated as abandoned by a dead process. */
const LOCK_STALE_MS = 30_000;
/** Give up waiting after this long and proceed unlocked rather than fail a run. */
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Hold an exclusive lock on the session cache for the whole of `fn`.
 *
 * `maxConcurrentProcesses` defaults to 3, so several `hench run` processes in
 * one checkout is the configured norm rather than an edge case. Every mutation
 * here is a read-modify-write, and without a lock the last writer wins: two
 * tasks resuming the same batch chain would each persist their own
 * `tasksUsed` and session id over the other's, and `clearSessionCache` could
 * delete a batch chain written between its own read and its `rm`.
 *
 * Deliberately best-effort. A cache is an optimisation, so a lock that cannot
 * be taken must not fail the run — after the timeout this proceeds unlocked,
 * which is no worse than the behaviour before the lock existed. A lock left by
 * a killed process is stolen once it is `LOCK_STALE_MS` old; today's runs were
 * killed often enough for that to matter.
 */
async function withCacheLock<T>(henchDir: string, fn: () => Promise<T>): Promise<T> {
  const path = lockPath(henchDir);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let held = false;

  while (Date.now() < deadline) {
    try {
      // "wx" is O_CREAT|O_EXCL: it fails if the file already exists, which is
      // what makes acquisition atomic across processes.
      const handle = await open(path, "wx");
      await handle.writeFile(`${process.pid}\n`, "utf-8");
      await handle.close();
      held = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") break;
      const age = await stat(path).then(
        (s) => Date.now() - s.mtimeMs,
        () => Number.POSITIVE_INFINITY,
      );
      if (age > LOCK_STALE_MS) {
        await unlink(path).catch(() => { /* another waiter got there first */ });
        continue;
      }
      await sleep(LOCK_RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    if (held) await unlink(path).catch(() => { /* already gone */ });
  }
}

/** Read and parse the cache file, or undefined when there is nothing usable. */
async function readCacheFile(henchDir: string): Promise<SessionCacheFile | undefined> {
  try {
    const raw = await readFile(cachePath(henchDir), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as SessionCacheFile;
  } catch {
    return undefined;
  }
}

/**
 * Merge one slot into the cache file, preserving the other.
 *
 * Both strategies persist here, so a write must never clobber the slot it does
 * not own — switching strategies would otherwise silently discard the state
 * the previous one had built up.
 */
async function updateCacheFile(
  henchDir: string,
  mutate: (file: SessionCacheFile) => void,
): Promise<void> {
  await withCacheLock(henchDir, () => updateCacheFileLocked(henchDir, mutate));
}

/**
 * The read-modify-write itself. Call only with the cache lock held — either
 * through `updateCacheFile`, or from inside a `withCacheLock` span that needs
 * to read and then write without another process intervening.
 */
async function updateCacheFileLocked(
  henchDir: string,
  mutate: (file: SessionCacheFile) => void,
): Promise<void> {
  await mkdir(henchDir, { recursive: true });
  const file = (await readCacheFile(henchDir)) ?? {};
  mutate(file);
  await writeCacheFileAtomic(henchDir, file);
}

/**
 * Write through a temp file and rename.
 *
 * `rename` is atomic on both platforms we run on, so a reader never observes
 * a half-written file and a process killed mid-write leaves the previous
 * contents rather than a truncated JSON document. A bare `writeFile`
 * truncates first, which is exactly the window a kill lands in.
 */
async function writeCacheFileAtomic(henchDir: string, file: SessionCacheFile): Promise<void> {
  const target = cachePath(henchDir);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
  try {
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => { /* leave no scratch file behind */ });
    throw err;
  }
}

/**
 * Read the cached parent session, or undefined when there is nothing usable
 * to read. Absent, unreadable, unparseable, and structurally invalid files
 * are all the same answer — a miss costs one orientation spawn, and failing
 * a run over a scratch file would be a worse trade.
 */
export async function readSessionCache(henchDir: string): Promise<SessionCacheEntry | undefined> {
  try {
    const raw = await readFile(cachePath(henchDir), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const entry = parsed as Partial<SessionCacheEntry>;
    if (typeof entry.parentId !== "string" || !entry.parentId) return undefined;
    if (typeof entry.createdAt !== "string" || !entry.createdAt) return undefined;
    return {
      parentId: entry.parentId,
      createdAt: entry.createdAt,
      svFingerprint: typeof entry.svFingerprint === "string" ? entry.svFingerprint : "",
      vendor: typeof entry.vendor === "string" ? entry.vendor : "",
      model: typeof entry.model === "string" ? entry.model : "",
    };
  } catch {
    return undefined;
  }
}

/** Persist a parent session, stamping `createdAt` at write time. */
export async function writeSessionCache(
  henchDir: string,
  entry: Omit<SessionCacheEntry, "createdAt"> & { createdAt?: string },
): Promise<void> {
  await updateCacheFile(henchDir, (file) => {
    file.parentId = entry.parentId;
    file.createdAt = entry.createdAt ?? new Date().toISOString();
    file.svFingerprint = entry.svFingerprint;
    file.vendor = entry.vendor;
    file.model = entry.model;
  });
}

/**
 * Drop the cached parent, leaving any batch chain intact.
 *
 * `--fresh` and the stale-parent fallback both mean "re-orient", not "forget
 * everything": a batch chain is unrelated state and removing it here would
 * make the two strategies quietly interfere.
 */
export async function clearSessionCache(henchDir: string): Promise<void> {
  // The read, the decision and the act are one span. Split, they race: the
  // `rm` below is chosen because there was no batch chain at read time, and
  // a chain written in between would be deleted by it — the preservation
  // contract broken by the very call that documents it.
  await withCacheLock(henchDir, async () => {
    const file = await readCacheFile(henchDir);
    if (!file || !file.batch) {
      await rm(cachePath(henchDir), { force: true }).catch(() => { /* best effort */ });
      return;
    }
    await updateCacheFileLocked(henchDir, (next) => {
      delete next.parentId;
      delete next.createdAt;
      delete next.svFingerprint;
      delete next.vendor;
      delete next.model;
    }).catch(() => { /* best effort */ });
  });
}

// ── Batch chain ──────────────────────────────────────────────────────────

/** Read a field that should be a non-empty string, or "" when it is not. */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Read the running batch chain, or undefined when there is none.
 *
 * A structurally unusable entry (no session id) is still "no chain" — there is
 * nothing to resume and nothing to explain. But an entry that merely predates
 * a field is surfaced rather than dropped: it comes back with `version: 0` so
 * {@link isBatchChainUsable} can name it `unversioned`, which is the third
 * acceptance criterion — a pre-0.8.0 entry must read as a miss with a reason,
 * not as an error and not as a bare absence.
 */
export async function readBatchChain(henchDir: string): Promise<BatchChainEntry | undefined> {
  const file = await readCacheFile(henchDir);
  const batch = file?.batch;
  if (!batch || typeof batch !== "object") return undefined;
  if (typeof batch.sessionId !== "string" || !batch.sessionId) return undefined;
  return {
    version: typeof batch.version === "number" ? batch.version : 0,
    sessionId: batch.sessionId,
    tasksUsed: typeof batch.tasksUsed === "number" && batch.tasksUsed > 0 ? batch.tasksUsed : 1,
    worktreeRoot: str(batch.worktreeRoot),
    ref: str(batch.ref),
    svFingerprint: str(batch.svFingerprint),
    policyHash: str(batch.policyHash),
    vendor: str(batch.vendor),
    model: str(batch.model),
    createdAt: str(batch.createdAt),
    lastUsedAt: str(batch.lastUsedAt),
    lastTaskTitle: typeof batch.lastTaskTitle === "string" ? batch.lastTaskTitle : undefined,
  };
}

/** What a task hands to the chain after it has finished with a session. */
export interface BatchChainAdvance {
  /** Session the next task may resume. */
  sessionId: string;
  /** Identity this task ran under — re-stamped on every advance. */
  identity: BatchChainIdentity;
  /** Title of the task that just used the session. */
  lastTaskTitle?: string;
  /** Clock seam; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Record that a task used `sessionId`, incrementing the count when it is the
 * session already on the chain and restarting it when a new session takes
 * over.
 *
 * Identity is re-stamped every time. `createdAt` is the one field carried
 * across a continuing chain — it is what the total-age bound measures, and
 * refreshing it on each task would make that bound unreachable.
 */
export async function advanceBatchChain(
  henchDir: string,
  entry: BatchChainAdvance,
): Promise<void> {
  const stamp = new Date(entry.now ?? Date.now()).toISOString();
  await updateCacheFile(henchDir, (file) => {
    const previous = file.batch;
    const continuing = previous?.sessionId === entry.sessionId;
    file.batch = {
      version: BATCH_CHAIN_VERSION,
      sessionId: entry.sessionId,
      tasksUsed: continuing ? (previous?.tasksUsed ?? 0) + 1 : 1,
      ...entry.identity,
      createdAt: continuing ? (previous?.createdAt ?? stamp) : stamp,
      lastUsedAt: stamp,
      lastTaskTitle: entry.lastTaskTitle,
    };
  });
}

/** A task's outcome, as the chain needs to know it. */
export interface BatchChainOutcome {
  /** Whether the task finished successfully. */
  completed: boolean;
  /** Session the task ran in, when the vendor reported one. */
  sessionId?: string;
  /** Identity the task ran under; absent when the run had no batch identity. */
  identity?: BatchChainIdentity;
  /** Title of the task that just ran. */
  lastTaskTitle?: string;
  /** Clock seam; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Hand a finished task's session to the chain, or end the chain.
 *
 * A successful task passes its session on. A failed one does not: whatever
 * went wrong is in that transcript, and the next task would start inside the
 * failure. The same holds when the vendor reported no session id — there is
 * nothing to hand on. Either way the old entry goes, so a later run cannot
 * resume a session this one has stopped counting.
 *
 * Stated here rather than as an `if` in the loop so that "a failed task evicts
 * the chain" is a property of the cache with a test, not an incidental branch
 * in a two-thousand-line driver.
 *
 * @returns what happened, for the caller to report.
 */
export async function settleBatchChain(
  henchDir: string,
  outcome: BatchChainOutcome,
): Promise<"advanced" | "cleared"> {
  if (outcome.completed && outcome.sessionId && outcome.identity) {
    await advanceBatchChain(henchDir, {
      sessionId: outcome.sessionId,
      identity: outcome.identity,
      lastTaskTitle: outcome.lastTaskTitle,
      now: outcome.now,
    }).catch(() => { /* best effort — the next task just starts fresh */ });
    return "advanced";
  }
  await clearBatchChain(henchDir);
  return "cleared";
}

/** Drop the batch chain, leaving the orientation parent intact. */
export async function clearBatchChain(henchDir: string): Promise<void> {
  const file = await readCacheFile(henchDir);
  if (!file?.batch) return;
  await updateCacheFile(henchDir, (next) => {
    delete next.batch;
  }).catch(() => { /* best effort */ });
}

export interface BatchChainUsabilityInput {
  /** What this task would run under; every field must match the chain's. */
  identity: BatchChainIdentity;
  /** `hench.tasksPerSession`; defaults to {@link DEFAULT_TASKS_PER_SESSION}. */
  tasksPerSession?: number;
  /** Total-age bound; defaults to {@link DEFAULT_BATCH_MAX_AGE_HOURS}. */
  maxAgeHours?: number;
  /** Idle bound; defaults to {@link DEFAULT_BATCH_MAX_IDLE_HOURS}. */
  maxIdleHours?: number;
  /** Clock seam; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Decide whether the next task may join the existing chain.
 *
 * Every rejection is named, and the order they are checked in is deliberate:
 *
 *   1. **Disabled**, then **absent** — config and state before content.
 *   2. **Version.** An entry this build does not understand is never read
 *      field-by-field; the fields may not mean what they used to.
 *   3. **Identity.** A chain from another worktree, ref, source state, policy,
 *      vendor or model is rejected for *that* reason. It comes before
 *      freshness and the cap so the operator is told the chain belongs to
 *      somewhere else, rather than the misleading "it filled up".
 *   4. **Freshness**, two bounds. Total age catches a loop whose repo has moved
 *      on beneath it; idle catches one that stopped while someone hand-edited
 *      the same tree. A single bound cannot do both — the total-age check would
 *      subsume the idle one and the last-use stamp would never be reached.
 *   5. **Cap.** The original bound: batching trades isolation for cold-start
 *      savings, and the trade stops paying once the shared transcript is long
 *      enough that every later turn re-reads it.
 *
 * Throughout, the bias is a false miss over a wrong hit. A miss costs one cold
 * start. A wrong hit appends this task's prompt to a transcript carrying
 * another checkout's context and another policy's sandbox — which `codex exec
 * resume` cannot re-assert, since it rejects the policy flags outright.
 */
export function isBatchChainUsable(
  chain: BatchChainEntry | undefined,
  input: BatchChainUsabilityInput,
): BatchChainVerdict {
  const cap = input.tasksPerSession ?? DEFAULT_TASKS_PER_SESSION;
  if (cap <= 1) return { usable: false, reason: "disabled" };
  if (!chain) return { usable: false, reason: "no-chain" };

  // Every defect is also a rejection, but they are consulted at two different
  // points: a version this build cannot read comes before identity (its fields
  // may not mean what they look like), and staleness comes after (so the
  // operator hears "that chain is another worktree's" rather than "it aged
  // out", which sends them to tune the wrong thing).
  const defect = batchChainDefect(chain, input);
  if (defect === "unversioned" || defect === "version-changed") {
    return { usable: false, reason: defect };
  }

  for (const [field, reason] of IDENTITY_CHECKS) {
    if (chain[field] !== input.identity[field]) return { usable: false, reason };
  }

  if (defect) return { usable: false, reason: defect };

  if (chain.tasksUsed >= cap) return { usable: false, reason: "cap-reached" };
  return { usable: true };
}

/** Bounds a batch chain's freshness is judged against. */
export interface BatchFreshnessInput {
  /** Total-age bound; defaults to {@link DEFAULT_BATCH_MAX_AGE_HOURS}. */
  maxAgeHours?: number;
  /** Idle bound; defaults to {@link DEFAULT_BATCH_MAX_IDLE_HOURS}. */
  maxIdleHours?: number;
  /** Clock seam; defaults to `Date.now()`. */
  now?: number;
}

/**
 * What is wrong with this chain regardless of who is asking, or undefined.
 *
 * Split out of {@link isBatchChainUsable} so admission and eviction cannot
 * drift: "expired" has to mean the same thing to the run that declines a chain
 * and to the sweep that deletes it, or the cache would accumulate entries every
 * run rejects and no run removes.
 */
export function batchChainDefect(
  chain: BatchChainEntry,
  input: BatchFreshnessInput = {},
): CacheDefect | undefined {
  if (chain.version !== BATCH_CHAIN_VERSION) {
    // Nothing wrote a version before 0.8.0, so 0 means "older than this
    // scheme" and any other value means a build we cannot reason about.
    return chain.version === 0 ? "unversioned" : "version-changed";
  }

  const createdAtMs = Date.parse(chain.createdAt);
  const lastUsedAtMs = Date.parse(chain.lastUsedAt);
  if (Number.isNaN(createdAtMs) || Number.isNaN(lastUsedAtMs)) return "malformed";

  const now = input.now ?? Date.now();
  const maxAgeHours = input.maxAgeHours ?? DEFAULT_BATCH_MAX_AGE_HOURS;
  const maxIdleHours = input.maxIdleHours ?? DEFAULT_BATCH_MAX_IDLE_HOURS;
  if (now - createdAtMs > maxAgeHours * 3_600_000) return "expired";
  if (now - lastUsedAtMs > maxIdleHours * 3_600_000) return "idle";
  return undefined;
}

/**
 * The ref half of a chain's identity: branch name, or `detached:<sha>`.
 *
 * Keyed on the *branch*, not on HEAD. A task that completes commits, so HEAD
 * moves between every pair of tasks in a loop — keying on it would expire the
 * chain on each success and disable batching by way of it working. Drift in
 * what the branch points at is the analysis fingerprint's job. The
 * branch-else-commit fallback matches the rule `git-origin.ts` already applies
 * to the same three captured fields.
 *
 * A non-git project yields `""`, which is a stable value that matches itself —
 * such a project has no ref to change, so there is nothing to invalidate on.
 */
export function chainRefIdentity(origin: { branch?: string; startHead?: string }): string {
  if (origin.branch) return origin.branch;
  return origin.startHead ? `detached:${origin.startHead}` : "";
}

/**
 * Structural shape of an execution policy, for {@link policyFingerprint}.
 *
 * Declared here rather than importing `ExecutionPolicy` through the llm
 * gateway: this module is pure cache state with no other cross-package
 * dependency, and `ExecutionPolicy` satisfies this shape structurally, so the
 * caller passes its real policy and nothing is added to the gateway's export
 * surface (which `tests/e2e/architecture-policy.test.js` caps).
 */
export interface PolicyFingerprintInput {
  readonly sandbox: string;
  readonly approvals: string;
  readonly networkAccess: boolean;
  readonly writableRoots: ReadonlyArray<string>;
  readonly allowedCommands: ReadonlyArray<string>;
  readonly allowedGitSubcommands?: ReadonlyArray<string>;
  readonly allowedFileTools: ReadonlyArray<string>;
}

/**
 * Hash the permissions a chain was opened under.
 *
 * `codex exec resume` accepts no sandbox or approval flags — the thread keeps
 * whatever policy created it — so tightening the policy between tasks would
 * otherwise leave the next task running under the looser one, invisibly. This
 * value makes that a named miss instead.
 *
 * Arrays are sorted before hashing, because a reordered allowlist grants the
 * same permissions. `allowedGitSubcommands` hashes as `null` when absent and
 * `[]` when empty, which are genuinely different policies: unscoped git versus
 * no git subcommand at all.
 */
export function policyFingerprint(policy: PolicyFingerprintInput): string {
  const canonical = JSON.stringify([
    policy.sandbox,
    policy.approvals,
    policy.networkAccess,
    [...policy.writableRoots].sort(),
    [...policy.allowedCommands].sort(),
    policy.allowedGitSubcommands ? [...policy.allowedGitSubcommands].sort() : null,
    [...policy.allowedFileTools].sort(),
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export interface ParentUsabilityInput {
  /** Current sourcevision fingerprint, from {@link sourcevisionFingerprint}. */
  svFingerprint: string;
  /** Vendor this run will use. */
  vendor: string;
  /** Model this run will use. */
  model: string;
  /** TTL override; defaults to {@link DEFAULT_PARENT_MAX_AGE_HOURS}. */
  maxAgeHours?: number;
  /** `--fresh` — force a new orientation regardless of what is cached. */
  fresh?: boolean;
  /** Clock seam; defaults to `Date.now()`. */
  now?: number;
}

/** Bounds a cached parent's freshness is judged against. */
export interface ParentFreshnessInput {
  /** TTL override; defaults to {@link DEFAULT_PARENT_MAX_AGE_HOURS}. */
  maxAgeHours?: number;
  /** Clock seam; defaults to `Date.now()`. */
  now?: number;
}

/**
 * What is wrong with this parent regardless of who is asking, or undefined.
 *
 * The parent's counterpart to {@link batchChainDefect}, and split out for the
 * same reason: eviction must not invent its own notion of "too old".
 *
 * Narrower than {@link CacheDefect}: a parent carries no version and no
 * last-use stamp, so the other three defects cannot arise for it — and saying
 * so in the type is what lets {@link isParentUsable} return the result
 * directly as a {@link ParentRejection}.
 */
export function parentDefect(
  entry: SessionCacheEntry,
  input: ParentFreshnessInput = {},
): Extract<CacheDefect, "malformed" | "expired"> | undefined {
  const createdAtMs = Date.parse(entry.createdAt);
  if (Number.isNaN(createdAtMs)) return "malformed";

  const now = input.now ?? Date.now();
  const maxAgeHours = input.maxAgeHours ?? DEFAULT_PARENT_MAX_AGE_HOURS;
  if (now - createdAtMs > maxAgeHours * 3_600_000) return "expired";
  return undefined;
}

/**
 * Decide whether a cached parent may be forked for this run.
 *
 * Every rejection is named rather than folded into a boolean so the caller
 * can tell the operator *why* it is re-orienting — "the analysis changed" and
 * "the parent aged out" are different stories, and a fork strategy that
 * silently never hits would otherwise look like it was working.
 */
export function isParentUsable(
  entry: SessionCacheEntry | undefined,
  input: ParentUsabilityInput,
): ParentVerdict {
  if (!entry) return { usable: false, reason: "no-entry" };
  if (input.fresh) return { usable: false, reason: "fresh-requested" };

  // Same two-point consultation as the batch chain: an unreadable timestamp
  // before the fingerprint checks, staleness after them.
  const defect = parentDefect(entry, input);
  if (defect === "malformed") return { usable: false, reason: "malformed" };

  if (entry.svFingerprint !== input.svFingerprint) {
    return { usable: false, reason: "sourcevision-changed" };
  }
  if (entry.vendor !== input.vendor) return { usable: false, reason: "vendor-changed" };
  if (entry.model !== input.model) return { usable: false, reason: "model-changed" };

  if (defect) return { usable: false, reason: defect };
  return { usable: true };
}

/**
 * Fingerprint the sourcevision analysis the orientation session was built on.
 *
 * Reads `manifest.analysisFingerprint` rather than hashing `.sourcevision/`
 * wholesale: sourcevision already computes that value from CONTEXT.md when it
 * writes the analysis, so reading one small file keeps this cheap enough to run
 * before every task, and it changes on exactly the event that invalidates an
 * orientation — a re-analysis that *found something different*. An analysis
 * that found the same thing republishes the same value, which is what keeps the
 * warm parent usable across a no-op re-analysis.
 *
 * A missing, unreadable, or empty manifest returns a stable sentinel rather
 * than throwing: projects without sourcevision output still get forking, they
 * just do not get analysis-driven invalidation.
 *
 * ## Cross-tier contract
 *
 * This value must equal what sourcevision stamped on `PRIMER.md` and what
 * core's `sourcevisionAnalysisFingerprint` reads. The three tiers cannot share
 * one implementation — sourcevision stamps the primer, core reads it from the
 * orchestration tier (spawn-only, no library imports), and hench reads it
 * without a sourcevision gateway — so on the current path they agree by reading
 * one published field instead of recomputing a hash three times. The legacy
 * fallback below is still one of three copies (sourcevision, core, here), kept
 * only for manifests written before the field existed, and
 * `tests/integration/primer-fingerprint-contract.test.js` holds those three in
 * agreement. Divergence is silent rather than loud: the values simply never
 * match, every primer looks stale, and the optimization quietly stops paying.
 */
export async function sourcevisionFingerprint(projectDir: string): Promise<string> {
  try {
    const raw = await readFile(
      join(resolveLayout(projectDir).sourcevisionDir, "manifest.json"),
      "utf-8",
    );
    const manifest = JSON.parse(raw) as {
      analysisFingerprint?: unknown;
      analyzedAt?: unknown;
      gitSha?: unknown;
    };
    if (typeof manifest.analysisFingerprint === "string" && manifest.analysisFingerprint) {
      return manifest.analysisFingerprint;
    }
    const analyzedAt = typeof manifest.analyzedAt === "string" ? manifest.analyzedAt : "";
    const gitSha = typeof manifest.gitSha === "string" ? manifest.gitSha : "";
    if (!analyzedAt && !gitSha) return "unknown";
    return createHash("sha256").update(`${analyzedAt} ${gitSha}`).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

export interface SessionStrategyInput {
  vendor: string;
  provider: "cli" | "api" | string;
  /** `hench.sessionStrategy`, when configured. */
  configured?: string;
}

/**
 * Resolve the session strategy actually available for this run.
 *
 * Forking needs a vendor CLI that can resume a session by id — today that is
 * the Claude CLI alone — and it needs hench to own the spawn, which the API
 * provider does not (it manages its own conversation in-process). Both cases
 * degrade to cold rather than erroring: the strategy is an optimization, and
 * a config value that a vendor cannot honor should cost nothing but the
 * optimization. Batching has no such requirement, so it is honored anywhere.
 */
export function resolveSessionStrategy(input: SessionStrategyInput): SessionStrategy {
  const configured = SESSION_STRATEGIES.includes(input.configured as SessionStrategy)
    ? (input.configured as SessionStrategy)
    : undefined;

  if (configured === "cold") return "cold";
  if (configured === "batch") return "batch";

  // Default (or an explicit "fork"): only the Claude CLI can honor it.
  const canFork = input.vendor === "claude" && input.provider === "cli";
  return canFork ? "fork" : "cold";
}

/**
 * The scopes a run under this strategy will never consult.
 *
 * A run that *does* consult a scope already evicts it with a named reason
 * (`ensureWarmParent` drops an unusable parent, the loop drops a rejected
 * chain). It is the other scope that rots: switch to `fork` and the batch
 * chain sits there past every bound with nothing left to read it. Sweeping
 * only the unused scopes is what keeps automatic eviction from swallowing the
 * diagnostic the active strategy is about to print.
 */
export function unusedCacheScopes(strategy: SessionStrategy): CacheScope[] {
  if (strategy === "fork") return ["batch"];
  if (strategy === "batch") return ["parent"];
  return [...CACHE_SCOPES];
}

// ── Inventory, eviction and scoped clearing ──────────────────────────────

/** Freshness bounds for every scope, as `hench.*` configures them. */
export interface CacheFreshnessInput {
  /** `hench.parentMaxAgeHours`. */
  parentMaxAgeHours?: number;
  /** `hench.batchMaxAgeHours`. */
  batchMaxAgeHours?: number;
  /** `hench.batchMaxIdleHours`. */
  batchMaxIdleHours?: number;
  /** Clock seam; defaults to `Date.now()`. */
  now?: number;
}

/**
 * What the cache holds, per scope, with each entry's defect if it has one.
 *
 * Entries are surfaced verbatim. Nothing is summarised or redacted on the way
 * out because nothing sensitive goes in: the cache stores session ids,
 * fingerprints, counters and timestamps, and the one free-text field is a task
 * title the PRD already publishes. The "cache file contents" block in
 * `cache-inventory.test.ts` holds that line.
 */
export interface CacheInventory {
  parent?: SessionCacheEntry & { defect?: CacheDefect };
  batch?: BatchChainEntry & { defect?: CacheDefect };
}

/**
 * Report what is cached, so an operator can answer "why did it re-orient?"
 * without opening `session-cache.json` and dating the timestamps by hand.
 *
 * Read-only: a defect is reported, not acted on, because listing and deleting
 * should be separate things the operator asks for separately.
 */
export async function listCacheEntries(
  henchDir: string,
  input: CacheFreshnessInput = {},
): Promise<CacheInventory> {
  const inventory: CacheInventory = {};

  const parent = await readSessionCache(henchDir);
  if (parent) {
    inventory.parent = {
      ...parent,
      defect: parentDefect(parent, { maxAgeHours: input.parentMaxAgeHours, now: input.now }),
    };
  }

  const batch = await readBatchChain(henchDir);
  if (batch) {
    inventory.batch = {
      ...batch,
      defect: batchChainDefect(batch, {
        maxAgeHours: input.batchMaxAgeHours,
        maxIdleHours: input.batchMaxIdleHours,
        now: input.now,
      }),
    };
  }

  return inventory;
}

/**
 * How old a cached entry was when it was consulted, or undefined when its
 * stamp cannot be read.
 *
 * Undefined rather than 0 on an unparseable stamp: a run that reports "the
 * entry was 0ms old" has said something false, where one that reports nothing
 * has only declined to answer. The same distinction {@link CacheDefect}'s
 * `malformed` draws, at the one place the number reaches a reader.
 */
export function cacheEntryAgeMs(createdAt: string, now: number = Date.now()): number | undefined {
  const createdAtMs = Date.parse(createdAt);
  return Number.isNaN(createdAtMs) ? undefined : Math.max(0, now - createdAtMs);
}

/** One evicted entry, named so the caller can say what it removed and why. */
export interface CacheEviction {
  scope: CacheScope;
  defect: CacheDefect;
}

export interface EvictionInput extends CacheFreshnessInput {
  /** Scopes to sweep; defaults to all of them. */
  scopes?: readonly CacheScope[];
}

/**
 * Delete cached entries that are dead rather than merely unmatched.
 *
 * Only {@link CacheDefect}s qualify. An entry rejected for identity — another
 * worktree, another policy — is left alone: it is the correct entry for the
 * run that wrote it, and deleting it here would mean the strategies quietly
 * cost each other their caches.
 *
 * Eviction is a convenience, never a precondition: an entry that survives a
 * sweep is still refused by {@link isBatchChainUsable} and
 * {@link isParentUsable}, which are the checks that actually protect a run.
 * So a failed delete is not worth failing anything over.
 */
export async function evictDeadCacheEntries(
  henchDir: string,
  input: EvictionInput = {},
): Promise<CacheEviction[]> {
  const scopes = input.scopes ?? CACHE_SCOPES;
  const inventory = await listCacheEntries(henchDir, input);
  const evicted: CacheEviction[] = [];

  if (scopes.includes("parent") && inventory.parent?.defect) {
    await clearSessionCache(henchDir);
    evicted.push({ scope: "parent", defect: inventory.parent.defect });
  }
  if (scopes.includes("batch") && inventory.batch?.defect) {
    await clearBatchChain(henchDir);
    evicted.push({ scope: "batch", defect: inventory.batch.defect });
  }

  return evicted;
}

/**
 * Clear the named scopes, reporting only those that held something.
 *
 * The two clears stay separate underneath — {@link clearSessionCache} and
 * {@link clearBatchChain} each preserve the other's slot — so clearing one
 * scope never costs the other its state, which is the whole reason the cache
 * is addressable by scope at all.
 */
export async function clearCacheScopes(
  henchDir: string,
  scopes: readonly CacheScope[],
): Promise<CacheScope[]> {
  const cleared: CacheScope[] = [];

  if (scopes.includes("parent") && (await readSessionCache(henchDir))) {
    await clearSessionCache(henchDir);
    cleared.push("parent");
  }
  if (scopes.includes("batch") && (await readBatchChain(henchDir))) {
    await clearBatchChain(henchDir);
    cleared.push("batch");
  }

  return cleared;
}

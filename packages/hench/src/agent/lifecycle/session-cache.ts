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
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

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
  await mkdir(henchDir, { recursive: true });
  const file = (await readCacheFile(henchDir)) ?? {};
  mutate(file);
  await writeFile(cachePath(henchDir), `${JSON.stringify(file, null, 2)}\n`, "utf-8");
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
  const file = await readCacheFile(henchDir);
  if (!file) {
    await rm(cachePath(henchDir), { force: true }).catch(() => { /* best effort */ });
    return;
  }
  if (!file.batch) {
    await rm(cachePath(henchDir), { force: true }).catch(() => { /* best effort */ });
    return;
  }
  await updateCacheFile(henchDir, (next) => {
    delete next.parentId;
    delete next.createdAt;
    delete next.svFingerprint;
    delete next.vendor;
    delete next.model;
  }).catch(() => { /* best effort */ });
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

  if (chain.version !== BATCH_CHAIN_VERSION) {
    // Nothing wrote a version before 0.8.0, so 0 means "older than this
    // scheme" and any other value means a build we cannot reason about.
    return { usable: false, reason: chain.version === 0 ? "unversioned" : "version-changed" };
  }

  for (const [field, reason] of IDENTITY_CHECKS) {
    if (chain[field] !== input.identity[field]) return { usable: false, reason };
  }

  const createdAtMs = Date.parse(chain.createdAt);
  const lastUsedAtMs = Date.parse(chain.lastUsedAt);
  if (Number.isNaN(createdAtMs) || Number.isNaN(lastUsedAtMs)) {
    return { usable: false, reason: "malformed" };
  }

  const now = input.now ?? Date.now();
  const maxAgeHours = input.maxAgeHours ?? DEFAULT_BATCH_MAX_AGE_HOURS;
  const maxIdleHours = input.maxIdleHours ?? DEFAULT_BATCH_MAX_IDLE_HOURS;
  if (now - createdAtMs > maxAgeHours * 3_600_000) return { usable: false, reason: "expired" };
  if (now - lastUsedAtMs > maxIdleHours * 3_600_000) return { usable: false, reason: "idle" };

  if (chain.tasksUsed >= cap) return { usable: false, reason: "cap-reached" };
  return { usable: true };
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

  const createdAtMs = Date.parse(entry.createdAt);
  if (Number.isNaN(createdAtMs)) return { usable: false, reason: "malformed" };

  if (entry.svFingerprint !== input.svFingerprint) {
    return { usable: false, reason: "sourcevision-changed" };
  }
  if (entry.vendor !== input.vendor) return { usable: false, reason: "vendor-changed" };
  if (entry.model !== input.model) return { usable: false, reason: "model-changed" };

  const maxAgeHours = input.maxAgeHours ?? DEFAULT_PARENT_MAX_AGE_HOURS;
  if (Date.now() - createdAtMs > maxAgeHours * 3_600_000) {
    return { usable: false, reason: "expired" };
  }
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
    const raw = await readFile(join(projectDir, ".sourcevision", "manifest.json"), "utf-8");
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

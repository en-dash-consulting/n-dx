/**
 * Runs one managed validation command inside the host-wide validation slot
 * (`validation-slot.ts`) when `hench.testGate.hostSlot` is on.
 *
 * Each call takes the slot, runs the command, and gives the slot back — so a
 * caller that wraps only the command never holds it while an agent, a
 * reviewer or a prompt waits. The command's own timeout starts after
 * admission, because the caller starts it inside `fn`; waiting stops only
 * when the run's abort signal fires. `fn` resolves after `exec` has stopped
 * the command's process tree (on timeout and on a forwarded Ctrl-C alike), so
 * the slot is released after the tree is gone. The command's child is
 * recorded in the holder record as soon as it spawns (its process group on
 * POSIX), so if this process dies first, the slot stays held until the child
 * has exited too.
 *
 * @module hench/process/validation-run
 */

import type { HenchConfig } from "../schema/index.js";
import { verbose } from "../types/output.js";
import {
  acquireValidationSlot,
  reclaimIfStale,
  VALIDATION_SLOT_DIR_ENV,
  ValidationSlotAbortedError,
  type ValidationSlotLease,
  type ValidationSlotWait,
} from "./validation-slot.js";
import {
  hostIdentity,
  LOOKUP_TIMEOUT_MS,
  peekValidationSlotDir,
  resolveValidationSlotDir,
  validationSlotDirFromEnv,
  type HostIdentityCache,
} from "./validation-slot-dir.js";

/** Where and how a validation run takes the slot. */
export interface ValidationSlotRunOptions {
  /**
   * The slot directory. Omitted in production: `resolveValidationSlotDir()`
   * when the slot is taken, which is the absolute `NDX_VALIDATION_SLOT_DIR`
   * this process was handed, without a host lookup, when there is one.
   */
  slotDir?: string;
  /** Where `NDX_VALIDATION_SLOT` and `NDX_VALIDATION_SLOT_DIR` are read from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** The project the validation runs for, recorded for whoever waits. */
  projectDir: string;
  /** The only thing that stops a wait: the run's interrupt (Ctrl-C, SIGTERM). There is no maximum wait. */
  signal?: AbortSignal;
  /** Called on the first wait and then periodically. */
  onWait?: (wait: ValidationSlotWait) => void;
  /** Poll interval while waiting, for tests. */
  pollIntervalMs?: number;
  /** Called with each slot warning: not taken (the command ran without it), child not recorded, not released. */
  onWarning?: (warning: string) => void;
}

/** Time spent queued for the slot and running inside it. */
export interface ValidationSlotTiming {
  queueMs: number;
  executionMs: number;
}

export type ValidationSlotRunOutcome<T> =
  | { ok: true; value: T; timing?: ValidationSlotTiming; slotWarning?: string }
  | { ok: false; queueMs: number; error: string };

/** The exec options a validation command adds when it runs inside the slot. */
export interface ValidationSlotExecOptions {
  env: NodeJS.ProcessEnv;
  onSpawn?: (child: { pid: number; group: boolean }) => void;
}

/**
 * Puts a command's exec options inside the slot: `NDX_VALIDATION_SLOT` and
 * `NDX_VALIDATION_SLOT_DIR` into its environment, and an `onSpawn` that records the spawned child in
 * `holder.json`, so a holder that crashes while the child runs does not free
 * the slot under it.
 */
export type WithValidationSlot = <O extends ValidationSlotExecOptions>(options: O) => O;

/**
 * Run `fn` inside the slot, or directly when `slot` is undefined. `fn` gets
 * `withSlot`; pass every validation command's exec options through it, after
 * sanitizing the environment, as `withTestMaxWorkers` is. `timing` is set only
 * when the slot was used. The slot itself never makes this throw: a wait
 * given up on is `ok: false` and the command does not run. A slot that could
 * not be taken runs the command without it. That, a child that could not be
 * recorded, or a slot that could not be released, is `slotWarning` beside
 * the command's result (and passed to `onWarning`). Only an error `fn`
 * throws propagates.
 */
export async function runInValidationSlot<T>(
  slot: ValidationSlotRunOptions | undefined,
  fn: (withSlot: WithValidationSlot) => Promise<T>,
): Promise<ValidationSlotRunOutcome<T>> {
  if (!slot) return { ok: true, value: await fn((options) => options) };

  let lease: ValidationSlotLease;
  let slotDir = slot.slotDir;
  const queueStarted = Date.now();
  try {
    slotDir ??= await resolveValidationSlotDir(slot.env);
    lease = await acquireValidationSlot({
      slotDir,
      env: slot.env,
      projectDir: slot.projectDir,
      signal: slot.signal,
      onWait: slot.onWait,
      pollIntervalMs: slot.pollIntervalMs,
    });
  } catch (err) {
    if (err instanceof ValidationSlotAbortedError) {
      return {
        ok: false,
        queueMs: err.queueWaitMs,
        error: `stopped waiting for the validation slot after ${formatSeconds(err.queueWaitMs)} (${describeReason(err.cause)})`,
      };
    }
    // An interrupt that fired before the slot failed (acquire creates the
    // directory before it checks the signal) still stops without running.
    if (slot.signal?.aborted) {
      const queueMs = Date.now() - queueStarted;
      return {
        ok: false,
        queueMs,
        error: `stopped waiting for the validation slot after ${formatSeconds(queueMs)} (${describeReason(slot.signal.reason)})`,
      };
    }
    // A slot that cannot be taken (EACCES, EROFS or ENOSPC under the ndx home,
    // no link() support, a directory where holder.json belongs). The command
    // runs without it: a gate that skipped its tests would let the run
    // continue unverified, while running unserialized only costs load.
    const where = slotDir ?? "the ndx home";
    const slotWarning =
      `skipped the validation slot and ran without it: could not take it in ${where}: ${describeReason(err)}`;
    slot.onWarning?.(slotWarning);
    return { ok: true, value: await fn((options) => options), slotWarning };
  }

  // Records run in spawn order; release waits for them, so a late record
  // cannot recreate holder.json after the slot was given back.
  let recording: Promise<string[]> = Promise.resolve([]);
  const withSlot: WithValidationSlot = (options) => ({
    ...options,
    env: lease.childEnv(options.env),
    onSpawn: (child) => {
      options.onSpawn?.(child);
      recording = recording.then(async (warnings) => {
        const warning = await recordChildReportingFailure(lease, slot, child);
        return warning ? [...warnings, warning] : warnings;
      });
    },
  });

  const started = Date.now();
  let value: T;
  try {
    value = await fn(withSlot);
  } catch (err) {
    // The command's own error wins; a slot failure beside it is a warning.
    await recording;
    await releaseReportingFailure(lease, slot);
    throw err;
  }
  const executionMs = Date.now() - started;
  const recordWarnings = await recording;
  const releaseWarning = await releaseReportingFailure(lease, slot);
  const slotWarning = [...recordWarnings, releaseWarning].filter(Boolean).join("; ");
  return {
    ok: true,
    value,
    timing: { queueMs: lease.queueWaitMs, executionMs },
    ...(slotWarning ? { slotWarning } : {}),
  };
}

/**
 * Record the spawned validation command in `holder.json`. A failure is
 * returned (and passed to `onWarning`) rather than thrown: the command is
 * already running, and the slot is still held while this process lives; only
 * a crash during the run would free it early.
 */
async function recordChildReportingFailure(
  lease: ValidationSlotLease,
  slot: ValidationSlotRunOptions,
  child: { pid: number; group: boolean },
): Promise<string | undefined> {
  try {
    await lease.recordChild(child.pid, { group: child.group });
    return undefined;
  } catch (err) {
    const warning = `could not record the validation command (pid ${child.pid}) in ${lease.slotDir}: ${describeReason(err)}`;
    slot.onWarning?.(warning);
    return warning;
  }
}

/**
 * Give the slot back. A failure is returned (and passed to `onWarning`) rather
 * than thrown: the command has already run, and its result must stand. A
 * holder record left behind is reclaimed by this process's next acquire, or
 * as stale once this process exits.
 */
async function releaseReportingFailure(
  lease: ValidationSlotLease,
  slot: ValidationSlotRunOptions,
): Promise<string | undefined> {
  try {
    await lease.release();
    return undefined;
  } catch (err) {
    const warning = `could not release the validation slot in ${lease.slotDir}: ${describeReason(err)}`;
    slot.onWarning?.(warning);
    return warning;
  }
}

/**
 * Clear a stale holder from this host's slot, judged from hench's own (host)
 * view, before a confined command starts (rule 4a in `validation-slot.ts`): a
 * confined runner cannot judge a record left by a dead sibling sandbox, and
 * would wait on it until its own timeout. Runs whatever
 * `hench.testGate.hostSlot` says, because the test runner takes the slot
 * unconditionally. Never waits and never throws; a failure is logged in
 * verbose mode only, since the spawn goes ahead either way.
 *
 * Never waits on the host lookup either: until this process has read the
 * host's identity, the call starts the lookup and skips this reclaim, and a
 * later spawn does it. `cache` is injectable for tests.
 */
export async function reclaimHostValidationSlot(
  env: NodeJS.ProcessEnv = process.env,
  cache: Pick<HostIdentityCache, "peek"> = hostIdentity,
): Promise<void> {
  const onError = (err: unknown): void => verbose(`validation slot: could not check for a stale holder: ${describeReason(err)}`);
  const slotDir = peekValidationSlotDir(env, cache);
  if (!slotDir) {
    verbose("validation slot: this host's slot directory is not known yet; skipped the stale-holder check");
    return;
  }
  if (await reclaimIfStale(slotDir, { env, onError })) {
    verbose(`validation slot: cleared a stale holder in ${slotDir}`);
  }
}

/**
 * Start reading this host's identity without waiting, so it is known by the
 * time a run's vendor CLI session or first confined command spawns, and the
 * session's wait (`withSessionValidationSlotDir`) is usually zero. Called
 * when a confined run starts.
 */
export function startHostIdentityLookup(): void {
  hostIdentity.peek();
}

/** How `withSessionValidationSlotDir` waits; every field is optional. */
export interface SessionSlotDirOptions {
  /** The host's environment the directory is resolved from; defaults to `process.env`. */
  hostEnv?: NodeJS.ProcessEnv;
  /** Injected for tests; defaults to this process's host identity cache. */
  cache?: HostIdentityCache;
  /** Stops the wait; the caller checks it afterwards and does not spawn. */
  signal?: AbortSignal;
  /** Longest wait; defaults to the lookup command's own limit. */
  timeoutMs?: number;
  /** Receives the one line printed when the directory could not be resolved. */
  warn?: (line: string) => void;
}

/**
 * `withHostValidationSlotDir` for a vendor CLI session, which spawns once and
 * keeps its environment for its whole life: waits for the host's identity
 * instead of peeking, so a session started before the lookup finished still
 * gets `NDX_VALIDATION_SLOT_DIR`. The wait ends at `timeoutMs` (the lookup
 * command's limit) or when `signal` aborts. A transient failure, a remembered
 * one or a timeout returns `base` unchanged and warns once: the session's own
 * test runs resolve the slot themselves. Never throws. Per-command spawns
 * keep the never-waiting `withHostValidationSlotDir`.
 */
export async function withSessionValidationSlotDir(
  base: NodeJS.ProcessEnv,
  options: SessionSlotDirOptions = {},
): Promise<NodeJS.ProcessEnv> {
  if (validationSlotDirFromEnv(base)) return base;
  const { signal } = options;
  if (signal?.aborted) return base;
  const hostEnv = options.hostEnv ?? process.env;
  const timeoutMs = options.timeoutMs ?? LOOKUP_TIMEOUT_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stopped = new Promise<{ kind: "timeout" } | { kind: "aborted" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    onAbort = () => resolve({ kind: "aborted" });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  const lookup = resolveValidationSlotDir(hostEnv, options.cache ?? hostIdentity).then(
    (slotDir) => ({ kind: "found" as const, slotDir }),
    (error: unknown) => ({ kind: "failed" as const, error }),
  );
  try {
    const outcome = await Promise.race([lookup, stopped]);
    if (outcome.kind === "found") return { ...base, [VALIDATION_SLOT_DIR_ENV]: outcome.slotDir };
    if (outcome.kind === "aborted") return base;
    const reason = outcome.kind === "timeout"
      ? `this host's identity was not read within ${formatSeconds(timeoutMs)}`
      : describeReason(outcome.error);
    options.warn?.(
      `validation slot: the session starts without NDX_VALIDATION_SLOT_DIR (${reason}); its test runs resolve the slot themselves`,
    );
    return base;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * `base` with `NDX_VALIDATION_SLOT_DIR` naming this host's slot directory, as
 * hench resolved it from `hostEnv` on the host, for a command it confines:
 * inside the sandbox the machine-id lookup may be refused or slow, and with
 * the variable set a runner there uses the directory without one (rule 6).
 * The directory only: a token is exported by an actual holder alone. `base`
 * is returned unchanged when it already names an absolute directory (a
 * holder's, through `withSlot`) or the host's identity is not read yet.
 */
export function withHostValidationSlotDir(
  base: NodeJS.ProcessEnv,
  hostEnv: NodeJS.ProcessEnv = process.env,
  cache: Pick<HostIdentityCache, "peek"> = hostIdentity,
): NodeJS.ProcessEnv {
  if (validationSlotDirFromEnv(base)) return base;
  const slotDir = peekValidationSlotDir(hostEnv, cache);
  return slotDir ? { ...base, [VALIDATION_SLOT_DIR_ENV]: slotDir } : base;
}

/** The slot options `config` asks for, or undefined when `hench.testGate.hostSlot` is off. */
export function validationSlotFromConfig(
  config: Pick<HenchConfig, "testGate"> | undefined,
  projectDir: string,
  options: { signal?: AbortSignal; print?: (line: string) => void } = {},
): ValidationSlotRunOptions | undefined {
  if (config?.testGate?.hostSlot !== true) return undefined;
  const print = options.print;
  return {
    projectDir,
    signal: options.signal,
    onWait: print ? (wait) => print(describeValidationSlotWait(wait)) : undefined,
    onWarning: print,
  };
}

/** The line printed while waiting for the slot. */
export function describeValidationSlotWait(wait: ValidationSlotWait): string {
  const { holder } = wait;
  const who = wait.holderAlive ? `pid ${holder.pid}` : `pid ${holder.pid} (exited; its tests still run)`;
  return `Waiting for the validation slot held by ${who} in ${holder.projectDir} since ${holder.startedAt} (${wait.holderPath})`;
}

/** The queue/execution split printed after a validation run. */
export function describeValidationSlotTiming(timing: ValidationSlotTiming): string {
  return `Validation slot: queued ${formatSeconds(timing.queueMs)}, ran ${formatSeconds(timing.executionMs)}`;
}

/** Sum two timings; either may be absent. */
export function addValidationSlotTiming(
  a: ValidationSlotTiming | undefined,
  b: ValidationSlotTiming | undefined,
): ValidationSlotTiming | undefined {
  if (!a) return b;
  if (!b) return a;
  return { queueMs: a.queueMs + b.queueMs, executionMs: a.executionMs + b.executionMs };
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function describeReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return "the run was interrupted";
}

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
import {
  acquireValidationSlot,
  ValidationSlotAbortedError,
  type ValidationSlotLease,
  type ValidationSlotWait,
} from "./validation-slot.js";
import { resolveValidationSlotDir } from "./validation-slot-dir.js";

/** Where and how a validation run takes the slot. */
export interface ValidationSlotRunOptions {
  /** The slot directory; `resolveValidationSlotDir()` in production. */
  slotDir: string;
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
 * Puts a command's exec options inside the slot: `NDX_VALIDATION_SLOT` into
 * its environment, and an `onSpawn` that records the spawned child in
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
  try {
    lease = await acquireValidationSlot({
      slotDir: slot.slotDir,
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
    // A slot that cannot be taken (EACCES, EROFS or ENOSPC under the ndx home,
    // no link() support, a directory where holder.json belongs). The command
    // runs without it: a gate that skipped its tests would let the run
    // continue unverified, while running unserialized only costs load.
    const slotWarning =
      `skipped the validation slot and ran without it: could not take it in ${slot.slotDir}: ${describeReason(err)}`;
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
    const warning = `could not record the validation command (pid ${child.pid}) in ${slot.slotDir}: ${describeReason(err)}`;
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
    const warning = `could not release the validation slot in ${slot.slotDir}: ${describeReason(err)}`;
    slot.onWarning?.(warning);
    return warning;
  }
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
    slotDir: resolveValidationSlotDir(),
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

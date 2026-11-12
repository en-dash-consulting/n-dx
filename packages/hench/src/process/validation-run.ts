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
 * the slot is released after the tree is gone.
 *
 * @module hench/process/validation-run
 */

import type { HenchConfig } from "../schema/index.js";
import { acquireValidationSlot, ValidationSlotAbortedError, type ValidationSlotWait } from "./validation-slot.js";
import { resolveValidationSlotDir } from "./validation-slot-dir.js";

/** Where and how a validation run takes the slot. */
export interface ValidationSlotRunOptions {
  /** The slot directory; `resolveValidationSlotDir()` in production. */
  slotDir: string;
  /** The project the validation runs for, recorded for whoever waits. */
  projectDir: string;
  /** Stops waiting: the run's interrupt (Ctrl-C, SIGTERM) or deadline. */
  signal?: AbortSignal;
  /** Called on the first wait and then periodically. */
  onWait?: (wait: ValidationSlotWait) => void;
  /** Poll interval while waiting, for tests. */
  pollIntervalMs?: number;
}

/** Time spent queued for the slot and running inside it. */
export interface ValidationSlotTiming {
  queueMs: number;
  executionMs: number;
}

export type ValidationSlotRunOutcome<T> =
  | { ok: true; value: T; timing?: ValidationSlotTiming }
  | { ok: false; queueMs: number; error: string };

/**
 * Run `fn` inside the slot, or directly when `slot` is undefined. `fn` gets
 * the function that puts `NDX_VALIDATION_SLOT` into the command's environment;
 * apply it after sanitizing, as `withTestMaxWorkers` is. `timing` is set only
 * when the slot was used. Never throws for a wait that was given up: that is
 * `ok: false`.
 */
export async function runInValidationSlot<T>(
  slot: ValidationSlotRunOptions | undefined,
  fn: (withSlotEnv: (env: NodeJS.ProcessEnv) => NodeJS.ProcessEnv) => Promise<T>,
): Promise<ValidationSlotRunOutcome<T>> {
  if (!slot) return { ok: true, value: await fn((env) => env) };

  let lease;
  try {
    lease = await acquireValidationSlot({
      slotDir: slot.slotDir,
      projectDir: slot.projectDir,
      signal: slot.signal,
      onWait: slot.onWait,
      pollIntervalMs: slot.pollIntervalMs,
    });
  } catch (err) {
    if (!(err instanceof ValidationSlotAbortedError)) throw err;
    return {
      ok: false,
      queueMs: err.queueWaitMs,
      error: `stopped waiting for the validation slot after ${formatSeconds(err.queueWaitMs)} (${describeReason(err.cause)})`,
    };
  }

  const started = Date.now();
  try {
    const value = await fn((env) => lease.childEnv(env));
    return { ok: true, value, timing: { queueMs: lease.queueWaitMs, executionMs: Date.now() - started } };
  } finally {
    await lease.release();
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
  };
}

/** The line printed while waiting for the slot. */
export function describeValidationSlotWait(wait: ValidationSlotWait): string {
  const { holder } = wait;
  const who = wait.holderAlive ? `pid ${holder.pid}` : `pid ${holder.pid} (exited; its tests still run)`;
  return `Waiting for the validation slot held by ${who} in ${holder.projectDir} since ${holder.startedAt}`;
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

/**
 * Run one exported function in a worker thread and terminate it if it overruns.
 *
 * For linearity tests on repository input (regexes, globs, XML scans). A
 * regressed pattern blocks its thread inside a synchronous match, where vitest's
 * per-test timeout — a timer on that same thread — never fires: the suite hangs
 * until CI's job timeout and names no test. Here the match runs off the test's
 * thread, and `worker.terminate()` interrupts it, so the test fails by name.
 *
 * Arguments and the result cross the thread boundary by structured clone. The
 * budgets are hang guardrails (TESTING.md, Flake Resistance), scaled by
 * NDX_TEST_TIME_MULTIPLIER; a test using this helper passes
 * BOUNDED_TEST_TIMEOUT_MS as its timeout so vitest's own limit sits above them.
 */

import { Worker } from "node:worker_threads";

const BUDGET_MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);

/** Worker start-up and module load (transpiling with typescript), before the call. */
export const LOAD_BUDGET_MS = 1_000 * BUDGET_MULTIPLIER;
/** The call itself: milliseconds when linear, unbounded when it backtracks. */
export const CALL_BUDGET_MS = 250 * BUDGET_MULTIPLIER;
export const BOUNDED_TEST_TIMEOUT_MS = LOAD_BUDGET_MS + CALL_BUDGET_MS + 5_000;

type AnyFunction = (...args: never[]) => unknown;

/**
 * Call `exportName` from `module` (a source file URL) with `args`, within the
 * budgets above. `F` is the function's type, for typing the arguments and result.
 */
export function callWithinBudget<F extends AnyFunction>(
  module: URL,
  exportName: string,
  ...args: Parameters<F>
): Promise<Awaited<ReturnType<F>>> {
  const worker = new Worker(new URL("./bounded-worker.mjs", import.meta.url), {
    workerData: { module: module.href, exportName, args },
  });
  return new Promise((resolve, reject) => {
    const settle = (error?: Error): void => {
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
    };
    const overrun = (what: string, ms: number) => () =>
      settle(new Error(`${exportName}: ${what} did not finish within ${ms} ms; worker terminated`));
    let timer = setTimeout(overrun("module load", LOAD_BUDGET_MS), LOAD_BUDGET_MS);

    worker.on("message", (message: "ready" | { ok: true; value: Awaited<ReturnType<F>> } | { ok: false; error: string }) => {
      if (message === "ready") {
        clearTimeout(timer);
        timer = setTimeout(overrun("the call", CALL_BUDGET_MS), CALL_BUDGET_MS);
        worker.postMessage("run");
        return;
      }
      if (message.ok) {
        settle();
        resolve(message.value);
      } else settle(new Error(`${exportName} threw in the worker:\n${message.error}`));
    });
    worker.on("error", (error) => settle(error));
    worker.on("exit", (code) => settle(new Error(`${exportName}: worker exited (code ${code}) before returning`)));
  });
}

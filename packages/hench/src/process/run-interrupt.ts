/**
 * Interrupt handling for `hench run`: SIGINT and SIGTERM stop the vendor CLI
 * that is running, rather than leaving it to finish (or to outlive hench).
 *
 * Two pieces:
 *
 * - {@link installRunInterrupt} owns the signal handlers for one invocation.
 *   The first signal aborts its `AbortSignal`, which the run plumbs into every
 *   vendor spawn (`spawnWithAdapter`'s `abortSignal`), so the in-flight CLI's
 *   process tree is terminated and the task is recorded as cancelled. A second
 *   signal force-stops whatever vendor process is still alive and exits.
 * - A registry of live vendor processes ({@link trackVendorProcess}), so the
 *   forced exit can reach a child that the graceful path has not finished
 *   with. Exiting without it is what used to orphan the CLI: `process.exit`
 *   does not take children with it, and a SIGTERM from the dashboard reaches
 *   hench alone.
 *
 * @module
 */

import { terminateProcessTree } from "../prd/llm-gateway.js";

/**
 * A spawned vendor CLI, as the tree terminator takes it. Named structurally so
 * this module needs no `node:child_process` import of its own (process
 * creation goes through llm-client's exec helpers).
 */
type ChildProcess = Parameters<typeof terminateProcessTree>[0];

/** Vendor CLI processes currently running, with their termination once started. */
const liveVendorProcesses = new Map<ChildProcess, Promise<void> | undefined>();

/**
 * Register a spawned vendor CLI as live until it closes. Returns the
 * unregister function; calling it more than once is harmless.
 */
export function trackVendorProcess(proc: ChildProcess): () => void {
  liveVendorProcesses.set(proc, undefined);
  return () => {
    liveVendorProcesses.delete(proc);
  };
}

/** How many vendor processes are registered. Exposed for tests. */
export function liveVendorProcessCount(): number {
  return liveVendorProcesses.size;
}

/**
 * Terminate one tracked process tree, at most once. A second request for the
 * same process returns the termination already in flight.
 */
export function terminateTrackedVendorProcess(proc: ChildProcess): Promise<void> {
  const pending = liveVendorProcesses.get(proc);
  if (pending) return pending;
  const termination = terminateProcessTree(proc);
  if (liveVendorProcesses.has(proc)) liveVendorProcesses.set(proc, termination);
  return termination;
}

/**
 * Stop every tracked vendor process, waiting at most `timeoutMs` for the tree
 * terminations, then SIGKILL any direct child still running. Never rejects.
 */
export async function forceStopVendorProcesses(timeoutMs = 5_000): Promise<void> {
  const procs = [...liveVendorProcesses.keys()];
  if (procs.length === 0) return;
  const terminations = procs.map((proc) => terminateTrackedVendorProcess(proc).catch(() => undefined));
  await Promise.race([
    Promise.all(terminations),
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    }),
  ]);
  for (const proc of procs) {
    if (proc.exitCode === null && proc.signalCode === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

/** The signals a run treats as "stop". */
const STOP_SIGNALS = ["SIGINT", "SIGTERM"] as const;
export type StopSignal = (typeof STOP_SIGNALS)[number];

/** The reason an interrupted run's abort signal carries. */
export class RunInterruptedError extends Error {
  readonly signal: StopSignal;
  constructor(signal: StopSignal) {
    super(`Interrupted by ${signal}`);
    this.name = "RunInterruptedError";
    this.signal = signal;
  }
}

export interface RunInterrupt {
  /** Aborted on the first SIGINT/SIGTERM. Plumb into every vendor spawn. */
  readonly signal: AbortSignal;
  /** True once the first signal arrived. */
  readonly stopping: boolean;
  /** Remove the handlers. */
  dispose(): void;
}

export interface InstallRunInterruptOptions {
  /** Called once, on the first signal, after the abort. */
  onStop?: (signal: StopSignal) => void;
  /** Called on the second signal, before the forced stop. */
  onForce?: (signal: StopSignal) => void;
  /** Where the handlers are installed. Injectable for tests; defaults to `process`. */
  target?: Pick<NodeJS.Process, "on" | "removeListener">;
  /** How the forced path exits. Injectable for tests; defaults to `process.exit`. */
  exit?: (code: number) => void;
  /** Bound on the forced stop before exiting. */
  forceTimeoutMs?: number;
}

/**
 * Install SIGINT/SIGTERM handlers for one run invocation.
 *
 * First signal: abort {@link RunInterrupt.signal} — the vendor CLI in flight is
 * terminated by its spawn, and the run is recorded as cancelled. Second signal:
 * terminate every tracked vendor process tree (bounded), then exit 1. A third
 * signal while that is in progress exits at once.
 */
export function installRunInterrupt(opts: InstallRunInterruptOptions = {}): RunInterrupt {
  const target = opts.target ?? process;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const controller = new AbortController();
  let signals = 0;

  const handler = (received: StopSignal): void => {
    signals++;
    if (signals === 1) {
      controller.abort(new RunInterruptedError(received));
      opts.onStop?.(received);
      return;
    }
    if (signals === 2) {
      opts.onForce?.(received);
      void forceStopVendorProcesses(opts.forceTimeoutMs).finally(() => exit(1));
      return;
    }
    exit(1);
  };

  const listeners = STOP_SIGNALS.map((name) => {
    const listener = (): void => handler(name);
    target.on(name, listener);
    return { name, listener };
  });

  return {
    signal: controller.signal,
    get stopping() {
      return signals > 0;
    },
    dispose() {
      for (const { name, listener } of listeners) target.removeListener(name, listener);
    },
  };
}

/** Operator-facing text for an abort reason. */
export function describeAbortReason(reason: unknown): string {
  if (reason instanceof RunInterruptedError) return reason.message;
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === "string" && reason) return reason;
  return "Interrupted";
}

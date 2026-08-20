/**
 * A stand-in for `child_process.spawn`, for tests that mock the module.
 *
 * `exec` spawns rather than execFile'ing, because execFile drops the `detached`
 * option and so cannot make a child a process-group leader. That means tests
 * assert against spawn's event shape — data on the stdout/stderr streams, then
 * `close` with an exit code or signal — instead of a single callback.
 *
 * Events are emitted asynchronously: `exec` attaches its listeners immediately
 * after spawn returns, so anything emitted synchronously would be missed.
 */
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

export interface FakeChildOptions {
  stdout?: string;
  stderr?: string;
  /** Exit code reported by `close`. Ignored when `signal` is set. */
  code?: number | null;
  /** Signal reported by `close` — the "was killed" path. */
  signal?: NodeJS.Signals | null;
  /** Emit `error` instead of completing, as a failed spawn does (ENOENT). */
  spawnError?: Error;
  /** Never emit `close`, so only a timeout can settle the call. */
  hang?: boolean;
}

/** A fake child process with the pieces `exec` touches. */
export function fakeChildProcess(options: FakeChildOptions = {}): ChildProcess & {
  killed: (NodeJS.Signals | number | undefined)[];
  stdinEnded: boolean;
} {
  const { stdout = "", stderr = "", code = 0, signal = null, spawnError, hang = false } = options;

  const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const outStream = new EventEmitter();
  const errStream = new EventEmitter();
  const killed: (NodeJS.Signals | number | undefined)[] = [];

  Object.assign(child, {
    // No pid, deliberately. terminateProcessTree short-circuits to a direct kill
    // when there is none, which keeps these tests off the real kill paths: with a
    // pid it would call process.kill(-pid) for real and could signal an unrelated
    // process group that happens to own that number on the host.
    pid: undefined,
    exitCode: null,
    signalCode: null,
    killed,
    stdinEnded: false,
    stdout: outStream,
    stderr: errStream,
    stdin: {
      end: () => {
        (child as { stdinEnded: boolean }).stdinEnded = true;
      },
    },
    kill(sig?: NodeJS.Signals) {
      killed.push(sig);
      (child as { exitCode: number | null }).exitCode = 0;
      // A real kill leads to close; emit it so callers do not hang.
      setImmediate(() => child.emit("close", null, sig ?? "SIGTERM"));
      return true;
    },
  });

  setImmediate(() => {
    if (spawnError) {
      child.emit("error", spawnError);
      return;
    }
    if (stdout) outStream.emit("data", Buffer.from(stdout));
    if (stderr) errStream.emit("data", Buffer.from(stderr));
    if (!hang) child.emit("close", signal === null ? code : null, signal);
  });

  return child as unknown as ChildProcess & {
    killed: (NodeJS.Signals | number | undefined)[];
    stdinEnded: boolean;
  };
}

/**
 * An implementation for a mocked `spawn`, recording each invocation.
 *
 * `next()` lets a test vary per-call behaviour; without it every call gets the
 * same scripted child.
 */
export function fakeSpawn(options: FakeChildOptions | ((call: number) => FakeChildOptions) = {}) {
  const calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];
  const children: ReturnType<typeof fakeChildProcess>[] = [];

  const impl = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const resolved = typeof options === "function" ? options(calls.length) : options;
    calls.push({ cmd, args, opts });
    const child = fakeChildProcess(resolved);
    children.push(child);
    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  return { impl, calls, children };
}

/**
 * Vitest setupFile — record why a test worker died, when asked to.
 *
 * WHY: under heavy concurrency vitest has reported "Worker exited unexpectedly
 * with exit code 1" with every test in the run passing (TESTING.md Family 3,
 * "A worker exits with every test passing"). Vitest prints the exit code and
 * nothing else: not which test file the worker was running, not who called
 * `process.exit`, not what threw. Each sighting was then dismissed as a flake
 * because there was no evidence to keep. This collects it.
 *
 * Opt-in. With `NDX_TEST_EXIT_TRACE=<dir>` set, each worker appends to
 * `<dir>/worker-<pid>.log`:
 *
 *   - `file`: each test file the worker starts, so the last one is the file
 *     it was running when it died;
 *   - `process.exit`: the code and the caller's stack. An exit with code 1
 *     and no signal is a call, not an OOM kill;
 *   - `uncaught`: an exception or rejection that escaped, through the
 *     `uncaughtExceptionMonitor` event, which observes without changing what
 *     Node or vitest does next;
 *   - `exit`: the final code with heap use and the count of active handles,
 *     the two pressures a loaded machine runs out of.
 *
 * Unset, this file does nothing, so the suite behaves exactly as without it.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect } from "vitest";

const dir = process.env["NDX_TEST_EXIT_TRACE"];
// setupFiles run once per test file, and a shared worker runs many files:
// install the process-level hooks once per worker, not once per file.
const INSTALLED = Symbol.for("ndx.exitTrace.installed");

if (dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `worker-${process.pid}.log`);
  const note = (kind, detail) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${kind} ${detail}\n`);
    } catch {
      // A full disk or a removed directory must not become the test failure.
    }
  };

  if (!globalThis[INSTALLED]) {
    globalThis[INSTALLED] = true;
    const realExit = process.exit.bind(process);
    process.exit = (code) => {
      note("process.exit", `code=${code ?? process.exitCode ?? 0}\n${new Error("exit called from").stack}`);
      return realExit(code);
    };
    process.on("uncaughtExceptionMonitor", (err, origin) => {
      note("uncaught", `${origin}\n${err instanceof Error ? err.stack : String(err)}`);
    });
    process.on("exit", (code) => {
      const handles = process.getActiveResourcesInfo?.().length ?? "n/a";
      note("exit", `code=${code} heapUsed=${process.memoryUsage().heapUsed} activeResources=${handles}`);
    });
  }

  beforeAll(() => {
    note("file", expect.getState().testPath ?? "(unknown)");
  });
}

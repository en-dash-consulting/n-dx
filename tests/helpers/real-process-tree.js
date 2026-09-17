/**
 * Real-process fixtures for the child-lifecycle suites.
 *
 * `tests/unit/child-lifecycle.test.js` drives every kill path through
 * FakeChildProcess and injected signallers, so it can only prove WHICH STRATEGY
 * RAN — replace an implementation with one that records the right signal and
 * delivers nothing and that file still passes. These helpers exist so a test can
 * assert the stronger thing: that an OS process stopped existing.
 *
 * Shared rather than copied per suite so "this pid is gone" means the same thing
 * (and carries the same diagnostics) everywhere it is asserted.
 *
 * POSIX-ORIENTED BY CONSTRUCTION. The trees here are node-spawns-node, which on
 * Windows libuv places in a global job object that reaps them independently of
 * anything under test — see `tests/shell-spawn-inventory.md`. A liveness
 * assertion there would pass without proving a kill reached anything, so callers
 * gate these on POSIX and leave the Windows strategies to injected assertions.
 */
import { spawn } from "node:child_process";
import { treeKillSpawnOptions } from "../../packages/core/child-lifecycle.js";

/** Bound on every wait here: long enough for a node start/exit, short enough to fail fast. */
export const EXIT_TIMEOUT_MS = 3_000;

const POLL_INTERVAL_MS = 25;

/** A child that stays up until something kills it. */
const IDLE_SCRIPT = "setInterval(() => {}, 1000);";

/**
 * Installing an empty SIGTERM listener makes the graceful phase a no-op, so only
 * a real SIGKILL can end the process. That is what separates "SIGTERM was sent"
 * from "the process died".
 */
const IGNORE_SIGTERM_SCRIPT = "process.on('SIGTERM', () => {});";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Signal 0 delivers nothing; it just runs the kernel's existence check. */
export function isPidRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait, bounded, for `pid` to stop answering signal 0.
 *
 * Polls instead of asserting once on return from the terminator: a just-killed
 * direct child can sit as a zombie for an event-loop turn until its parent reaps
 * it, and signal 0 cannot tell a zombie from a live process. The bound is what
 * keeps the assertion honest — a kill that delivers nothing still fails here.
 */
export async function waitForPidExit(pid, label, timeoutMs = EXIT_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidRunning(pid)) return;
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error(`${label} (pid ${pid}) was still alive ${timeoutMs}ms after termination was awaited.`);
}

/**
 * Backstop teardown: SIGKILL anything a test tracked.
 *
 * Every pid here has already been asserted dead by a passing test, so failures
 * are expected and ignored — the point is that a FAILING test does not leak the
 * process it just proved survived.
 */
export function reapPids(pids) {
  for (const pid of pids) {
    if (typeof pid !== "number") continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone — which is what a passing assertion means.
    }
  }
}

function leafScript(ignoreSigterm) {
  return [ignoreSigterm ? IGNORE_SIGTERM_SCRIPT : "", IDLE_SCRIPT].filter(Boolean).join(" ");
}

/**
 * A child that spawns one grandchild, reports the grandchild's pid on stdout, and
 * stays up.
 *
 * The grandchild is spawned NON-detached, so on POSIX it stays in the child's
 * process group and is reachable only by a group signal. Killing the direct child
 * alone leaves it running, which is the orphan this module exists to prevent.
 *
 * The pid is written in two chunks so a reader that only handles a whole-line
 * chunk cannot pass by luck.
 */
function treeScript(ignoreSigterm) {
  return [
    "const { spawn } = require('node:child_process');",
    ignoreSigterm ? IGNORE_SIGTERM_SCRIPT : "",
    `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(leafScript(ignoreSigterm))}], { stdio: 'ignore' });`,
    "process.stdout.write(String(grandchild.pid).slice(0, 1));",
    "setTimeout(() => process.stdout.write(String(grandchild.pid).slice(1) + '\\n'), 10);",
    IDLE_SCRIPT,
  ].filter(Boolean).join(" ");
}

/**
 * Read the first newline-terminated line of `child`'s stdout.
 *
 * Rejects once the stream ENDS without a line, so a fixture that failed to start
 * reports that rather than burning the timeout with no explanation. Keyed on the
 * stream rather than the child's "exit" because those two orderings are not
 * guaranteed: a fixture that writes its line and exits immediately can emit exit
 * before the pipe's pending data is delivered, and rejecting there would fail on
 * output that was already on its way.
 */
export function readFirstLine(child, timeoutMs = EXIT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      finish(reject, new Error(`Timed out waiting for a line from the fixture. Received: ${JSON.stringify(output)}`));
    }, timeoutMs);

    const onData = (chunk) => {
      output += chunk;
      const match = output.match(/^(.*)\r?\n/);
      if (match) finish(resolve, match[1]);
    };
    const onError = (error) => finish(reject, error);
    const onEnd = () => finish(
      reject,
      new Error(`Fixture stdout ended before a line arrived. Received: ${JSON.stringify(output)}`),
    );

    function finish(settle, value) {
      clearTimeout(timeout);
      child.stdout.removeListener("data", onData);
      child.stdout.removeListener("end", onEnd);
      child.removeListener("error", onError);
      settle(value);
    }

    child.stdout.on("data", onData);
    child.stdout.once("end", onEnd);
    child.once("error", onError);
  });
}

/** A single idle process, optionally its own group leader and/or SIGTERM-proof. */
export function spawnIdleChild({ detached = false, ignoreSigterm = false } = {}) {
  return spawn(process.execPath, ["-e", leafScript(ignoreSigterm)], {
    stdio: "ignore",
    ...(detached ? treeKillSpawnOptions() : {}),
  });
}

/**
 * A detached child plus its grandchild, with the handle the caller keeps.
 *
 * Detached via {@link treeKillSpawnOptions} — the same call production uses — so
 * the child leads its own process group and a group kill can reach the
 * grandchild.
 */
export async function spawnProcessTree({ ignoreSigterm = false } = {}) {
  const child = spawn(process.execPath, ["-e", treeScript(ignoreSigterm)], {
    stdio: ["ignore", "pipe", "ignore"],
    ...treeKillSpawnOptions(),
  });

  const grandchildPid = Number.parseInt(await readFirstLine(child), 10);
  return { child, grandchildPid };
}

function waitForChildExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

/**
 * A process tree this test process holds NO handle to — the pid-file case.
 *
 * A short-lived launcher spawns the tree detached, unrefs it, reports the pids
 * and exits. The tree is then reparented to init, exactly like the background
 * server whose pid `ndx start stop` reads out of `.n-dx-web.pid` after the
 * process that spawned it is gone. That matters beyond tidiness: with a handle,
 * this process reaps the child and libuv reports its exit, so a terminator could
 * appear to work on evidence a real caller never has.
 *
 * @param {object} [options]
 * @param {boolean} [options.withGrandchild=true] Report a grandchild pid too.
 * @param {boolean} [options.ignoreSigterm=false] Make the tree SIGKILL-only.
 * @returns {Promise<{ pid: number, grandchildPid: number | null }>}
 */
export async function spawnOrphanedProcessTree({ withGrandchild = true, ignoreSigterm = false } = {}) {
  const targetScript = withGrandchild ? treeScript(ignoreSigterm) : leafScript(ignoreSigterm);
  const launcher = spawn(process.execPath, ["-e", [
    "const { spawn } = require('node:child_process');",
    `const target = spawn(process.execPath, ['-e', ${JSON.stringify(targetScript)}], {`,
    `  detached: true, stdio: ['ignore', ${withGrandchild ? "'pipe'" : "'ignore'"}, 'ignore'],`,
    "});",
    "target.unref();",
    withGrandchild
      ? [
        "let out = '';",
        "target.stdout.on('data', (chunk) => {",
        "  out += chunk;",
        "  const match = out.match(/^(\\d+)\\r?\\n/);",
        "  if (!match) return;",
        // Destroying the pipe (rather than calling process.exit) lets the launcher
        // drain its own stdout before the event loop empties — an exit() here can
        // truncate the line the caller is waiting for.
        "  target.stdout.destroy();",
        "  process.stdout.write(target.pid + ' ' + match[1] + '\\n');",
        "});",
      ].join(" ")
      : "process.stdout.write(target.pid + '\\n');",
  ].join(" ")], { stdio: ["ignore", "pipe", "ignore"] });

  const line = await readFirstLine(launcher);
  // Wait for the launcher to go, so the tree is genuinely orphaned — not this
  // process's grandchild — before anything tries to terminate it.
  await waitForChildExit(launcher);

  const [pid, grandchildPid] = line.trim().split(" ").map((value) => Number.parseInt(value, 10));
  return { pid, grandchildPid: withGrandchild ? grandchildPid : null };
}

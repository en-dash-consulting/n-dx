/**
 * Child-server process management for the hub.
 *
 * The hub runs one server process per registered repository — today's
 * `web serve`, unchanged — on an ephemeral loopback port, so every
 * single-project assumption in the existing server stays intact and each repo
 * can run its own n-dx version. This module owns the mechanics: spawning
 * `<ndxBin> serve --port=0 <repoRoot>`, discovering the port the child
 * actually bound, probing its health, and taking it down again.
 *
 * Process primitives come exclusively through the llm-gateway (web must not
 * import node:child_process — architecture-policy.test.js). Termination of a
 * child we spawned uses the gateway's killWithFallback on the live handle;
 * termination of a child we merely *attached* to (its pid survived a hub
 * restart) has no handle, so it escalates SIGTERM → grace → SIGKILL via
 * process.kill, mirroring the child-lifecycle contract at the only layer the
 * hub can reach.
 *
 * @module hub/children
 */

import { readFile, rm } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { join, extname } from "node:path";
import { spawnManaged, killWithFallback, type ManagedChild } from "./llm-gateway.js";

/** The port file the child server writes next to the repo it serves. */
export const CHILD_PORT_FILE = ".n-dx-web.port";

/** How long to wait for a spawned child to write its port file. */
const PORT_FILE_TIMEOUT_MS = 30_000;
const PORT_FILE_POLL_MS = 100;

/** Ceiling on the health probe: a dashboard answers /api/status in single-digit ms. */
const PROBE_TIMEOUT_MS = 1_500;

/** Grace period before SIGTERM escalates to SIGKILL when stopping a child. */
const STOP_GRACE_MS = 2_000;

/** A running (or attached) child server as the hub sees it. */
export interface ChildServer {
  pid: number;
  port: number;
  /**
   * Live spawn handle — present only for children this hub process spawned.
   * An attached child (pid survived a hub restart) has none, and must be
   * stopped by pid.
   */
  handle?: ManagedChild;
}

export class ChildSpawnError extends Error {}

/**
 * Spawn `<ndxBin> serve --port=0 <repoRoot>` and wait for the bound port.
 *
 * The port is discovered from `<repoRoot>/.n-dx-web.port`, which the server
 * writes once it is listening — the same channel `ndx start --background`
 * reads. The stale file from a previous run is removed first so a leftover
 * port cannot be mistaken for the fresh child's. Children run with stdio
 * ignored: the hub is a daemon, and holding pipes to N long-running servers
 * buffers output nobody reads.
 *
 * A `.js`/`.mjs`/`.cjs` ndxBin is run through the current Node executable —
 * a script is not directly executable on Windows, and this seam is also what
 * lets tests substitute a stub server for the real `web serve`.
 */
export async function spawnProjectServer(ndxBin: string, repoRoot: string): Promise<ChildServer> {
  await rm(join(repoRoot, CHILD_PORT_FILE), { force: true });

  const script = [".js", ".mjs", ".cjs"].includes(extname(ndxBin).toLowerCase());
  const cmd = script ? process.execPath : ndxBin;
  const args = script
    ? [ndxBin, "serve", "--port=0", repoRoot]
    : ["serve", "--port=0", repoRoot];

  const handle = spawnManaged(cmd, args, { cwd: repoRoot, stdio: "ignore" });
  if (handle.pid === undefined) {
    throw new ChildSpawnError(`Failed to spawn ${ndxBin} for ${repoRoot}`);
  }

  // The child exiting while we poll is the failure signal — without racing
  // `done`, a server that dies on startup reads as a 30s port-file timeout.
  let exited = false;
  void handle.done.then(() => {
    exited = true;
  });

  const deadline = Date.now() + PORT_FILE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const port = await readChildPort(repoRoot);
    if (port !== null) return { pid: handle.pid, port, handle };
    if (exited) {
      throw new ChildSpawnError(
        `${ndxBin} for ${repoRoot} exited before reporting a port`,
      );
    }
    await new Promise((r) => setTimeout(r, PORT_FILE_POLL_MS));
  }

  await killWithFallback(handle, STOP_GRACE_MS);
  throw new ChildSpawnError(
    `${ndxBin} for ${repoRoot} did not write ${CHILD_PORT_FILE} within ${PORT_FILE_TIMEOUT_MS}ms`,
  );
}

/** Read the child's port file; null when absent or unparseable. */
export async function readChildPort(repoRoot: string): Promise<number | null> {
  try {
    const raw = await readFile(join(repoRoot, CHILD_PORT_FILE), "utf-8");
    const port = parseInt(raw.trim(), 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/status on the child and report whether it answered 200.
 *
 * Anything else — no listener, timeout, non-200 — is "unreachable"; the
 * caller decides what that means (mark, respawn once).
 */
export function probeChildHealth(port: number, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const req = httpGet(
      { host: "127.0.0.1", port, path: "/api/status", timeout: timeoutMs },
      (res) => {
        res.resume(); // drain — only the status code matters here
        done(res.statusCode === 200);
      },
    );
    // `timeout` only arms the socket timer; it does not abort the request.
    req.on("timeout", () => {
      req.destroy();
      done(false);
    });
    req.on("error", () => done(false));
  });
}

/** Is a process with this pid signallable? (kill(pid, 0) — probe, not signal.) */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop a child: killWithFallback on the handle when we spawned it, or the
 * same SIGTERM → grace → SIGKILL escalation by pid for an attached child.
 */
export async function stopChild(child: ChildServer, gracePeriodMs: number = STOP_GRACE_MS): Promise<void> {
  if (child.handle) {
    await killWithFallback(child.handle, gracePeriodMs);
    return;
  }
  if (!isPidAlive(child.pid)) return;
  try {
    process.kill(child.pid, "SIGTERM");
  } catch {
    return; // exited between the aliveness probe and the signal
  }
  const deadline = Date.now() + gracePeriodMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(child.pid)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    process.kill(child.pid, "SIGKILL");
  } catch {
    // exited during the grace period
  }
}

/**
 * Two project directories can each run `ndx start` and both dashboards survive.
 *
 * `runWeb` only knows about the pid file inside the directory it was given, so a
 * second project on a busy port used to read the occupant as a stranger squatting
 * on 3117 and SIGKILL it via lsof — taking a working dashboard down with it. The
 * peer probe (`probeStatusEndpoint` + `classifyPortOccupant` in
 * packages/core/web.js) now asks who is there first and relocates instead.
 *
 * Driven through the real CLI against two real background servers: the unit tests
 * in tests/unit/web-port-occupant.test.js classify an injected payload, which
 * proves the branching but not that a live peer is actually left alive, nor that
 * `start stop` reaches only the server for the directory it was given.
 *
 * @see packages/core/web.js — runWeb's peer-detection and relocation path
 * @see tests/e2e/cli-start.test.js — single-project start lifecycle
 * @see tests/e2e/mcp-transport.test.js — the spawn/poll shape this follows
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { get as httpGet } from "node:http";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { terminateTreeByPid } from "../../packages/core/child-lifecycle.js";
import {
  CLI_PATH,
  DEFAULT_TIMEOUT,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
  withSandboxedClaudeConfig,
} from "./e2e-helpers.js";

const LOOPBACK_HOST = "127.0.0.1";
const PID_FILE = ".n-dx-web.pid";
const PORT_FILE = ".n-dx-web.port";

/** Servers started by this file, reaped in afterAll whether or not the test passed. */
const startedPids = new Set();

function runStart(args) {
  try {
    const stdout = execFileSync("node", [CLI_PATH, "start", ...args], {
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
      stdio: "pipe",
      ...withSandboxedClaudeConfig(),
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.status ?? 1 };
  }
}

/** A port nothing is listening on, obtained by binding and releasing it. */
function findAvailablePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.listen(0, LOOPBACK_HOST, () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
    srv.on("error", reject);
  });
}

function isListenPermissionError(error) {
  return Boolean(error && typeof error === "object" && error.code === "EPERM");
}

/** Signal 0 delivers nothing; it just runs the kernel's existence check. */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

/** The port the server actually bound to, which may differ from the requested one. */
async function readBoundPort(dir) {
  try {
    const port = Number.parseInt((await readFile(join(dir, PORT_FILE), "utf-8")).trim(), 10);
    return Number.isInteger(port) ? port : null;
  } catch {
    return null;
  }
}

/**
 * Record a started server's pid so afterAll can reap it. Returns the pid, or
 * null when the pid file is missing — the caller asserts on that separately.
 */
async function capturePid(dir) {
  const info = await readJsonFile(join(dir, PID_FILE));
  if (!info || typeof info.pid !== "number") return null;
  startedPids.add(info.pid);
  return info.pid;
}

/**
 * GET /api/status once, parsed. Resolves null for anything that is not a 200
 * with a JSON body.
 *
 * Raw `http.get` with `agent: false`, and an explicit `req.destroy()` once the
 * body is in, rather than `fetch`. This poll used to be load-bearing:
 * `killPortOccupant` picked its victim from `lsof -ti tcp:<port>`, which lists
 * every process holding a socket on the port — CLIENTS included — so a poller
 * leaving a pooled keep-alive socket (fetch) or an undestroyed CLOSE_WAIT socket
 * (observed: 50 ms was enough) put THIS process in line to be SIGKILLed, and the
 * suite reported a dead worker instead of the assertion that named the regression.
 *
 * The query is now restricted to listeners (`listenerPidsOnPort` in
 * packages/core/web.js), so a client socket is no longer a candidate victim.
 * The hygiene stays: it costs nothing and keeps a red run legible.
 */
function getStatus(port, timeoutMs = 2_000) {
  return new Promise((res) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      res(value);
    };
    const req = httpGet(
      { host: LOOPBACK_HOST, port, path: "/api/status", timeout: timeoutMs, agent: false },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          done(null);
          return;
        }
        let body = "";
        response.setEncoding("utf-8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          req.destroy();
          try {
            done(JSON.parse(body));
          } catch {
            done(null);
          }
        });
        response.on("error", () => { req.destroy(); done(null); });
      },
    );
    req.on("timeout", () => { req.destroy(); done(null); });
    req.on("error", () => done(null));
  });
}

/** Poll /api/status until it answers with a parsed body, or the deadline passes. */
async function waitForStatus(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getStatus(port);
    if (status) return status;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No dashboard answered on :${port} within ${timeoutMs}ms`);
}

/** Whether anything accepts a TCP connection on the port. */
function isPortInUse(port) {
  return new Promise((res) => {
    const conn = createConnection({ port, host: LOOPBACK_HOST });
    conn.once("connect", () => {
      conn.destroy();
      res(true);
    });
    conn.once("error", () => res(false));
  });
}

/** Poll until nothing answers on the port. Returns false if it is still up. */
async function waitForPortClosed(port, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortInUse(port))) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Realpath both sides before comparing: mkdtemp hands back /var/folders/... on
 * macOS while the server canonicalizes to /private/var/folders/..., and the two
 * are the same directory.
 */
function canonical(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

describe("two projects start dashboards concurrently", { timeout: 120_000 }, () => {
  let dirA;
  let dirB;
  let requestedPort;
  let portB;
  let pidA;
  let pidB;
  let startB;
  let canBindPorts = true;

  beforeAll(async () => {
    try {
      requestedPort = await findAvailablePort();
    } catch (error) {
      if (isListenPermissionError(error)) {
        canBindPorts = false;
        return;
      }
      throw error;
    }

    dirA = await createTmpDir("ndx-two-projects-a-");
    dirB = await createTmpDir("ndx-two-projects-b-");
    await Promise.all([
      setupRexDir(dirA, { project: "project-a" }),
      setupSourcevisionDir(dirA),
      setupRexDir(dirB, { project: "project-b" }),
      setupSourcevisionDir(dirB),
    ]);

    // Project A claims the port first.
    const startA = runStart([`--port=${requestedPort}`, "--background", dirA]);
    pidA = await capturePid(dirA);
    expect(startA.code, startA.stderr).toBe(0);
    await waitForStatus(requestedPort);

    // Project B asks for the same port. It must relocate, not kill.
    startB = runStart([`--port=${requestedPort}`, "--background", dirB]);
    pidB = await capturePid(dirB);
    expect(startB.code, startB.stderr).toBe(0);
    portB = await readBoundPort(dirB);
  }, 90_000);

  afterAll(async () => {
    // Reap through the tree primitive rather than a bare signal: the servers are
    // detached, so a pid-only kill leaves their children behind. Runs even when an
    // assertion above threw, which is the point.
    for (const pid of startedPids) {
      await terminateTreeByPid(pid, { forceKillTimeoutMs: 2_000 }).catch(() => {});
    }
    startedPids.clear();
    if (dirA) await removeTmpDir(dirA);
    if (dirB) await removeTmpDir(dirB);
  });

  it("leaves the first project's dashboard running", async (ctx) => {
    if (!canBindPorts) {
      ctx.skip();
      return;
    }
    expect(pidA).toBeTypeOf("number");
    expect(isProcessAlive(pidA)).toBe(true);

    const status = await waitForStatus(requestedPort);
    expect(canonical(status.projectDir)).toBe(canonical(dirA));
  });

  it("starts the second project near the requested port, not inside 3117–3200", async (ctx) => {
    if (!canBindPorts) {
      ctx.skip();
      return;
    }
    expect(portB).toBeTypeOf("number");
    expect(portB).not.toBe(requestedPort);
    // requestedPort is an OS-assigned ephemeral port, far outside 3117–3200.
    // Relocation must land in its own neighbourhood (requestedPort + 1
    // upward) rather than jumping into the default fallback range — that is
    // the contract this suite exists to pin down.
    expect(portB).toBe(requestedPort + 1);

    const status = await waitForStatus(portB);
    expect(canonical(status.projectDir)).toBe(canonical(dirB));
  });

  it("names the peer and the fallback port on stdout", (ctx) => {
    if (!canBindPorts) {
      ctx.skip();
      return;
    }
    expect(startB.stdout).toContain(canonical(dirA));
    expect(startB.stdout).toContain(`already on :${requestedPort}`);
    expect(startB.stdout).toContain(`starting this one on :${portB}`);
  });

  // Ordered last on purpose: it tears down what the assertions above observe.
  it("stops only the server for the directory it is given", async (ctx) => {
    if (!canBindPorts) {
      ctx.skip();
      return;
    }

    const stopA = runStart(["stop", dirA]);
    expect(stopA.code, stopA.stderr).toBe(0);
    expect(stopA.stdout).toContain("Stopped");
    expect(await waitForPortClosed(requestedPort)).toBe(true);
    expect(isProcessAlive(pidA)).toBe(false);

    // B is untouched: same pid, still serving its own project.
    expect(isProcessAlive(pidB)).toBe(true);
    const status = await waitForStatus(portB);
    expect(canonical(status.projectDir)).toBe(canonical(dirB));

    const stopB = runStart(["stop", dirB]);
    expect(stopB.code, stopB.stderr).toBe(0);
    expect(await waitForPortClosed(portB)).toBe(true);
    expect(isProcessAlive(pidB)).toBe(false);
  });
});

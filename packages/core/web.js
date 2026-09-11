/**
 * Server orchestration for n-dx.
 *
 * Starts the unified server (@n-dx/web serve) with support for:
 *   - Configurable port (--port, config, default 3117)
 *   - Background/daemon mode (--background)
 *   - PID file management (.n-dx-web.pid)
 *   - Graceful stop (ndx start stop / ndx web stop)
 *   - Peer detection on a busy port: another project's dashboard is left alone
 *     and this one relocates near the requested port (falling back to
 *     3117–3200 only if that neighbourhood is full), rather than being killed
 *
 * Used by both `ndx start` (unified: dashboard + MCP) and `ndx web` (alias).
 *
 * Usage:
 *   ndx start [dir]                  Start server (dashboard + MCP) in foreground
 *   ndx start --port=4000 [dir]      Start on custom port
 *   ndx start --background [dir]     Start detached (daemon mode)
 *   ndx start stop [dir]             Stop a background server
 *   ndx start status [dir]           Check if server is running
 */

import { spawn } from "child_process";
import { get as httpGet } from "http";
import { createConnection } from "net";
import { readFile, writeFile, unlink, access } from "fs/promises";
import { realpathSync } from "fs";
import { join, resolve } from "path";
import { terminateTreeByPid } from "./child-lifecycle.js";
import { execFileSyncCli } from "./win-spawn.js";

const DEFAULT_PORT = 3117;
const PID_FILE = ".n-dx-web.pid";
const PORT_FILE = ".n-dx-web.port";

// Mirrors the server's own fallback allocator (PORT_RANGE_START / PORT_RANGE_END
// in packages/web/src/server/port.ts). Duplicated rather than imported: this is
// the orchestration tier, which spawns packages instead of importing them.
const PORT_RANGE_START = 3117;
const PORT_RANGE_END = 3200;

/** Highest valid TCP port — `net.createConnection` throws ERR_SOCKET_BAD_PORT above this. */
const MAX_PORT = 65535;

/** Ceiling on the port probe: a dashboard answers /api/status in single-digit ms. */
const PROBE_TIMEOUT_MS = 1_500;

/** Cap on the probe response we will buffer — the real payload is a few KB. */
const PROBE_MAX_BYTES = 256 * 1024;

// ── Output helpers ───────────────────────────────────────────────────────────
// Orchestration files avoid importing from packages (they spawn CLIs instead).
// These local helpers mirror @n-dx/llm-client's output.ts for consistency.

/** Print informational output. Suppressed in quiet mode. */
function log(...args) {
  if (!_quiet) console.log(...args);
}

let _quiet = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the project .n-dx.json and return the web.port if configured.
 */
async function loadConfigPort(dir) {
  const configPath = join(dir, ".n-dx.json");
  if (!(await fileExists(configPath))) return undefined;
  try {
    const raw = await readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    const port = config?.web?.port;
    if (typeof port === "number" && port > 0) return port;
  } catch {
    // ignore malformed config
  }
  return undefined;
}

/**
 * Check if a port is in use by attempting a TCP connection.
 *
 * A port outside 0–65535 is treated as "in use" rather than probed: passing
 * it to `net.createConnection` throws ERR_SOCKET_BAD_PORT synchronously
 * (inside the Promise executor, so it becomes a rejection), which previously
 * crashed callers like {@link findRelocationPort} instead of skipping the
 * invalid candidate.
 */
export function isPortInUse(port) {
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    return Promise.resolve(true);
  }
  return new Promise((res) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    sock.once("connect", () => {
      sock.destroy();
      res(true);
    });
    sock.once("error", () => {
      res(false);
    });
  });
}

/**
 * Find the first free port in [start, end], skipping `exclude`.
 * Returns the port, or null when every port in the range is taken.
 */
export async function findFreePortInRange(exclude, start = PORT_RANGE_START, end = PORT_RANGE_END) {
  for (let p = start; p <= end; p++) {
    if (p === exclude) continue;
    if (!(await isPortInUse(p))) return p;
  }
  return null;
}

/**
 * Width of the near-port scan window in {@link findRelocationPort}, matching
 * the span of the default range (3117–3200 inclusive) so the two windows are
 * the same size.
 */
const NEAR_PORT_WINDOW = PORT_RANGE_END - PORT_RANGE_START;

/**
 * Choose a port to relocate a peer's request to.
 *
 * Scans upward from `requestedPort` first — `requestedPort + 1` through
 * `requestedPort + nearWindowSize` — so an operator's explicit `--port` or
 * `web.port` survives relocation in its own neighbourhood instead of being
 * silently replaced by a port inside 3117–3200. Falls back to the default
 * range only when that neighbourhood is entirely taken.
 *
 * For the default port (3117) the near window already covers 3118–3200
 * exactly, so behaviour there is unchanged: it still walks 3118, 3119, … .
 *
 * The window's upper bound is clamped to 65535, the highest valid TCP port —
 * otherwise a requested port near the top of the range (e.g. 65535 itself)
 * pushes the scan past 65535 and into candidates that crash the probe. When
 * `requestedPort` is already 65535 the clamped window is empty and this
 * falls straight through to the 3117–3200 fallback.
 *
 * @param {number} requestedPort
 * @param {number} [nearWindowSize] Exposed for tests; production callers use the default.
 * @returns {Promise<number|null>} The chosen port, or null when neither window has one free.
 */
export async function findRelocationPort(requestedPort, nearWindowSize = NEAR_PORT_WINDOW) {
  const near = await findFreePortInRange(
    requestedPort,
    requestedPort + 1,
    Math.min(requestedPort + nearWindowSize, MAX_PORT),
  );
  if (near !== null) return near;
  return findFreePortInRange(requestedPort, PORT_RANGE_START, PORT_RANGE_END);
}

/**
 * GET http://127.0.0.1:<port>/api/status and return the parsed JSON body.
 *
 * Returns null for anything that is not a parseable 200 — no listener, a
 * connection reset, a non-JSON body, a timeout, an oversized response. The
 * caller treats null as "cannot identify the occupant", which keeps the
 * pre-existing kill path in charge whenever the probe is inconclusive.
 *
 * Plain node:http on purpose: this is the orchestration tier, which must not
 * import from packages.
 *
 * @param {number} port
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown>} Parsed body, or null.
 */
export function probeStatusEndpoint(port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((res) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      res(value);
    };

    const req = httpGet(
      { host: "127.0.0.1", port, path: "/api/status", timeout: timeoutMs },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          req.destroy();
          done(null);
          return;
        }
        let body = "";
        response.setEncoding("utf-8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > PROBE_MAX_BYTES) {
            req.destroy();
            done(null);
          }
        });
        response.on("end", () => {
          try {
            done(JSON.parse(body));
          } catch {
            done(null);
          }
        });
        response.on("error", () => done(null));
      },
    );

    // `timeout` above only arms the socket timer; it does not abort the request.
    req.on("timeout", () => {
      req.destroy();
      done(null);
    });
    req.on("error", () => done(null));
  });
}

/**
 * Who is on the port, according to its /api/status response.
 *
 * @typedef {{ kind: "peer", projectDir: string }
 *          | { kind: "self", projectDir: string }
 *          | { kind: "unknown" }} PortOccupant
 */

/**
 * Canonicalize a path for self/peer comparison.
 *
 * `resolve()` alone normalises separators and `..` segments but does not
 * resolve symlinks and does not case-fold, so the same directory reached
 * through a symlink (or, on win32, a different drive-letter/path casing)
 * compares unequal to itself. `realpathSync.native` fixes both — it also
 * returns the on-disk canonical casing on win32 — but requires the path to
 * exist. When it does not (deleted out from under the caller, or a payload
 * describing a directory this process cannot stat), fall back to the plain
 * `resolve()` form rather than throwing.
 *
 * @param {string} pathLike
 * @returns {string}
 */
function canonicalizePath(pathLike) {
  const resolved = resolve(pathLike);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Decide what a probed /api/status payload says about the port's occupant.
 *
 *   peer     — an n-dx dashboard serving a DIFFERENT directory. Must not be
 *              killed; the caller relocates to another port instead.
 *   self     — an n-dx dashboard serving THIS directory with no live PID file
 *              (deleted, or started from another checkout of the same tree).
 *              Restarting it is the documented idempotent behaviour of
 *              `ndx start`, so the caller keeps the existing kill path.
 *   unknown  — not an n-dx dashboard, or one too old to report `projectDir`.
 *              Attribution is impossible, so the caller keeps the existing
 *              kill path rather than guessing.
 *
 * @param {unknown} payload  Parsed /api/status body, or null.
 * @param {string} absDir    Absolute project directory this invocation serves.
 * @returns {PortOccupant}
 */
export function classifyPortOccupant(payload, absDir) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { kind: "unknown" };
  }
  // Shape check against the dashboard status payload — see ProjectStatus in
  // packages/web/src/server/routes-status.ts. A bare `projectDir` on some
  // unrelated service's JSON must not read as an n-dx server.
  for (const key of ["sv", "rex", "hench"]) {
    const section = payload[key];
    if (!section || typeof section !== "object") return { kind: "unknown" };
  }
  const served = payload.projectDir;
  if (typeof served !== "string" || served.length === 0) return { kind: "unknown" };

  const resolved = canonicalizePath(served);
  return resolved === canonicalizePath(absDir)
    ? { kind: "self", projectDir: resolved }
    : { kind: "peer", projectDir: resolved };
}

/**
 * Pids of the processes *listening* on `port`, in the order the platform query
 * reports them. Returns [] when nothing is listening, or when no usable query
 * tool is present — the caller treats both as "do not kill".
 *
 * Listening sockets only, which is the whole point. A bare `lsof -ti tcp:<port>`
 * also lists every CLIENT holding a socket on that port, so a browser tab, a
 * curl, or a poller with a CLOSE_WAIT socket to the dashboard ranked as a
 * candidate victim — above the listener, whenever it was the older process.
 *
 * @param {number} port
 * @returns {number[]} Distinct listener pids.
 */
export function listenerPidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      // netstat -ano lists TCP listeners; grep for ":PORT " at the local address
      const out = execFileSyncCli("netstat", ["-ano"], { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
      for (const line of out.split("\n")) {
        // Look for lines like "  TCP    127.0.0.1:3117    0.0.0.0:0    LISTENING    12345"
        const m = line.match(/TCP\s+[\d.]+:(\d+)\s+[\d.:]+\s+LISTENING\s+(\d+)/i);
        if (m && parseInt(m[1], 10) === port) pids.add(parseInt(m[2], 10));
      }
    } else {
      // lsof is available on macOS and most Linux distros. -sTCP:LISTEN drops
      // the clients. An lsof too old to support it errors out, which lands in
      // the catch below and reads as "nobody" — a refusal to kill, not a guess.
      const out = execFileSyncCli(
        "lsof",
        ["-t", "-sTCP:LISTEN", "-i", `tcp:${port}`],
        { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] },
      ).trim();
      for (const line of out.split("\n")) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid)) pids.add(pid);
      }
    }
  } catch {
    // No listener (lsof exits non-zero on no match), or no query tool at all.
    return [];
  }
  return [...pids];
}

/**
 * Decide which of `pids` to SIGKILL, or why not to.
 *
 * Pure, so the whom-to-kill decision is assertable without a process holding a
 * real socket. Every refusal is a case where killing would be a guess:
 *
 *   none      → the query named nobody; there is nothing to signal
 *   self      → this process is among the listeners (in-process test servers
 *               have exactly this shape). Without the guard, a regression in
 *               the peer branch does not fail an assertion — it SIGKILLs the
 *               test runner, and CI reports a dead worker instead of a bug.
 *   ambiguous → several listeners (SO_REUSEPORT, a pre-fork server). Picking
 *               the first is the arbitrary choice that made this function
 *               dangerous; failing loudly leaves the operator `--port=N`.
 *
 * @param {number[]} pids     Listener pids, from {@link listenerPidsOnPort}.
 * @param {number} [selfPid]  This process's pid.
 * @returns {{pid: number} | {refuse: "none" | "self"} | {refuse: "ambiguous", pids: number[]}}
 */
export function selectKillTarget(pids, selfPid = process.pid) {
  if (pids.length === 0) return { refuse: "none" };
  // Self-preservation outranks ambiguity: whichever pid we picked, signalling
  // from a list that includes us risks killing the decider.
  if (pids.includes(selfPid)) return { refuse: "self" };
  if (pids.length > 1) return { refuse: "ambiguous", pids };
  return { pid: pids[0] };
}

/**
 * Find and kill whichever process is listening on `port`.
 * Returns true if the port was freed, false if it was not.
 *
 * Callers must first rule out a peer dashboard via {@link probeStatusEndpoint}
 * plus {@link classifyPortOccupant}: this SIGKILLs whatever it finds, and the
 * occupant of 3117 is frequently another project's `ndx start`. The probe
 * decides *whether* to kill; {@link selectKillTarget} decides *whom*, and it
 * refuses rather than guess — the caller reports the port as uncleared.
 */
export async function killPortOccupant(port) {
  try {
    const target = selectKillTarget(listenerPidsOnPort(port));
    if (target.refuse) {
      if (target.refuse === "ambiguous") {
        // Loud, because the alternative is killing one of them at random.
        console.error(
          `Port ${port} has ${target.pids.length} listening processes (PIDs ${target.pids.join(", ")}); ` +
          "refusing to guess which to stop.",
        );
      }
      return false;
    }
    const pid = target.pid;

    if (process.platform === "win32") {
      execFileSyncCli("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
    } else {
      // SIGKILL direct, rather than spawning /bin/kill for a number we already have.
      process.kill(pid, "SIGKILL");
    }
    // Wait for the port to free up
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (!(await isPortInUse(port))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Read the port file written by the server process.
 * Returns the actual port number or null.
 */
async function readPortFile(dir) {
  const portPath = join(dir, PORT_FILE);
  if (!(await fileExists(portPath))) return null;
  try {
    const raw = await readFile(portPath, "utf-8");
    const port = parseInt(raw.trim(), 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

/**
 * Remove the port file.
 */
export async function removePortFile(dir) {
  const portPath = join(dir, PORT_FILE);
  try {
    await unlink(portPath);
  } catch {
    // ignore
  }
}

/**
 * Wait for the server process to write its port file, polling at intervals.
 * Returns the actual port or null if the timeout expires.
 */
async function waitForPortFile(dir, timeoutMs = 5000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const port = await readPortFile(dir);
    if (port !== null) return port;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

/**
 * Read the PID file for a given project directory.
 * Returns { pid, port } or null.
 */
export async function readPidFile(dir) {
  const pidPath = join(dir, PID_FILE);
  if (!(await fileExists(pidPath))) return null;
  try {
    const raw = await readFile(pidPath, "utf-8");
    const data = JSON.parse(raw);
    return data;
  } catch {
    return null;
  }
}

/**
 * Write PID file with process info.
 */
async function writePidFile(dir, pid, port) {
  const pidPath = join(dir, PID_FILE);
  await writeFile(
    pidPath,
    JSON.stringify({ pid, port, startedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf-8",
  );
}

/**
 * Remove PID file.
 */
export async function removePidFile(dir) {
  const pidPath = join(dir, PID_FILE);
  try {
    await unlink(pidPath);
  } catch {
    // ignore
  }
}

/**
 * Check if a process is still running.
 */
export function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Subcommands ──────────────────────────────────────────────────────────────

// The poll-until-exit helper that used to live here is gone: it existed only to
// support this file's own SIGTERM → grace → SIGKILL sequence, which now comes from
// child-lifecycle's terminateTreeByPid. Nothing else imported it.

/**
 * Stop a running background server and everything it spawned.
 *
 * Escalates SIGTERM → grace period → SIGKILL via child-lifecycle's shared
 * primitive, which also reaches the server's CHILDREN — `taskkill /T` on Windows,
 * a process-group signal on POSIX (the server is started detached, so it leads a
 * group there).
 *
 * The default grace period is intentionally short (2 s) so the CLI stop
 * command stays responsive.  For servers that need longer, pass gracePeriodMs
 * explicitly or set N_DX_STOP_GRACE_MS in the environment.
 *
 * @param {string} dir
 * @param {string} [label]
 * @param {number} [gracePeriodMs]  Grace period before SIGKILL. Default: 2 000 ms.
 */
async function stopServer(dir, label = "n-dx server", gracePeriodMs = Number(process.env.N_DX_STOP_GRACE_MS ?? 2_000)) {
  const info = await readPidFile(dir);
  if (!info) {
    log("No background server found.");
    return true;
  }

  if (!isProcessRunning(info.pid)) {
    log("Server process is no longer running (stale PID file).");
    await removePidFile(dir);
    await removePortFile(dir);
    return true;
  }

  // Delegated to child-lifecycle so the SIGTERM → grace → SIGKILL escalation
  // exists once in this package. It also takes the server's CHILDREN with it: this
  // used to signal only the recorded PID, which on Windows meant TerminateProcess
  // on one process and every `rex analyze` / `hench run` it had spawned orphaned —
  // and the server is started `detached: true`, which puts it outside libuv's job
  // object, so nothing else would have reaped them either.
  //
  // The result is deliberately not consulted — see the contract on
  // terminateTreeByPid, which cli.js's stop path follows for the same reason.
  // This used to branch on it and warn that the server "did not exit", one line
  // above the "Stopped" line below: a contradiction, and the warning was the
  // wrong half, because a signallable pid after SIGKILL is as likely to be a
  // zombie awaiting reaping as a survivor.
  await terminateTreeByPid(info.pid, {
    // web.js keeps its own, shorter grace period: `ndx start stop` is interactive
    // and must stay responsive, where child-lifecycle's tracker defaults to 5s for
    // shutdown. Consolidating the mechanism must not change the latency.
    forceKillTimeoutMs: gracePeriodMs,
  });

  log(`Stopped ${label} (PID ${info.pid}, port ${info.port}).`);
  await removePidFile(dir);
  await removePortFile(dir);
  return true;
}

/**
 * Show status of a background server.
 */
async function showStatus(dir, port, label = "n-dx server") {
  const info = await readPidFile(dir);
  if (!info) {
    log("No background server recorded.");
    // Still check if something is on the port
    if (await isPortInUse(port)) {
      log(`Note: Port ${port} is in use by another process.`);
    }
    return;
  }

  // The port file reflects the actual port the server bound to (may differ
  // from the PID file's port if dynamic allocation kicked in).
  const actualPort = (await readPortFile(dir)) ?? info.port;
  const running = isProcessRunning(info.pid);
  const portActive = await isPortInUse(actualPort);

  if (running && portActive) {
    log(`${label} is running (PID ${info.pid}, port ${actualPort}).`);
    log(`  URL: http://localhost:${actualPort}`);
    log(`  MCP (rex):          http://localhost:${actualPort}/mcp/rex`);
    log(`  MCP (sourcevision): http://localhost:${actualPort}/mcp/sourcevision`);
    log(`  Started: ${info.startedAt}`);
  } else if (running) {
    log(`Server process is running (PID ${info.pid}) but port ${actualPort} is not responding.`);
  } else {
    log("Server process is no longer running (stale PID file).");
    await removePidFile(dir);
    await removePortFile(dir);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run the server command (used by both `ndx start` and `ndx web`).
 *
 * @param {string} dir          Project directory
 * @param {string[]} rest       Remaining CLI arguments
 * @param {object} deps         Injected dependencies from cli.js
 * @param {Function} deps.run   Run a tool script (foreground)
 * @param {object} deps.tools   Tool script paths
 * @param {string} deps.__dir   Root directory of n-dx
 * @param {Function} deps.exit               Shared exit request helper for synchronous command flow
 * @param {Function} deps.flushExit          Shared async exit helper for signal callbacks
 * @param {string} [deps.commandName="web"]  CLI command name for messaging ("start" or "web")
 */
export async function runWeb(dir, rest, { exit, flushExit, run, tools, __dir, commandName = "web" }) {
  const absDir = resolve(dir);

  // Parse flags and detect subcommand
  const flags = {};
  let subcommand = null;

  for (const arg of rest) {
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else if (arg === "-q") {
      flags.quiet = true;
    } else if (!arg.startsWith("-") && arg !== dir) {
      // Non-flag, non-dir arg is a subcommand
      if (!subcommand) subcommand = arg;
    }
  }

  _quiet = !!(flags.quiet);

  // Resolve port: --port flag > .n-dx.json config > default
  let port = DEFAULT_PORT;
  if (flags.port) {
    const parsed = parseInt(flags.port, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid port: ${flags.port}`);
      exit(1);
    }
    port = parsed;
  } else {
    const configPort = await loadConfigPort(absDir);
    if (configPort) port = configPort;
  }

  const isBackground = flags.background || flags.daemon || flags.bg;

  // Labels for user-facing messages
  const label = commandName === "start" ? "n-dx server" : "n-dx dashboard";
  const stopCmd = `ndx ${commandName} stop`;

  // --- Subcommand: stop ---
  if (subcommand === "stop") {
    const ok = await stopServer(absDir, label);
    return ok ? 0 : 1;
  }

  // --- Subcommand: status ---
  if (subcommand === "status") {
    await showStatus(absDir, port, label);
    return 0;
  }

  if (subcommand) {
    console.error(`Unknown ${commandName} subcommand: ${subcommand}`);
    console.error("Available: stop, status");
    return 1;
  }

  // --- Check for stale PID / already running ---
  const existing = await readPidFile(absDir);
  if (existing && isProcessRunning(existing.pid)) {
    // Auto-restart: stop the old server so ndx start is idempotent.
    log(`Stopping previous ${label} (PID ${existing.pid}, port ${existing.port})…`);
    await stopServer(absDir, label);
  } else if (existing) {
    // Stale PID file — clean up
    await removePidFile(absDir);
    await removePortFile(absDir);
  }

  // If port is still occupied, wait briefly for the OS to release it after the
  // graceful stop above. If it's still busy after that, force-kill the occupant.
  if (await isPortInUse(port)) {
    // Give the just-stopped process time to release the socket (up to 2s)
    let portFree = false;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (!(await isPortInUse(port))) { portFree = true; break; }
    }
    if (!portFree) {
      // Ask the occupant who it is before killing it. The PID file above only
      // knows about servers started for THIS directory, so a second project or
      // worktree used to look like a stranger squatting on 3117 and got
      // SIGKILLed — taking a working dashboard down with it.
      const occupant = classifyPortOccupant(await probeStatusEndpoint(port), absDir);

      if (occupant.kind === "peer") {
        const next = await findRelocationPort(port);
        if (next === null) {
          console.error(
            `n-dx dashboard for ${occupant.projectDir} is already on :${port}, and no port near it or in ` +
            `${PORT_RANGE_START}–${PORT_RANGE_END} is free. Choose one with --port=N or set web.port in .n-dx.json`,
          );
          return 1;
        }
        log(`n-dx dashboard for ${occupant.projectDir} is already on :${port}; starting this one on :${next}`);
        port = next;
      } else {
        // Not identifiable as a peer — either a stranger, or this directory's
        // own untracked server, which `ndx start` restarts by contract.
        log(`Port ${port} is in use by another process — clearing it…`);
        const freed = await killPortOccupant(port);
        if (!freed) {
          console.error(`Port ${port} is occupied and could not be cleared. Choose a different port with --port=N or set web.port in .n-dx.json`);
          return 1;
        }
      }
    }
  }

  // --- Build serve args ---
  // --debug/--verbose must be forwarded explicitly: --background spawns a
  // brand-new detached child process below (`serve ...serveArgs`), which
  // never sees the original `rest` array the user actually typed after
  // `ndx start`. Without this, `ndx start --background --debug` silently
  // ran a non-debug server — the flag was parsed into `flags` here, in this
  // process, and then dropped on the floor.
  const serveArgs = ["serve", `--port=${port}`, absDir];
  if (flags.debug) serveArgs.push("--debug");
  else if (flags.verbose) serveArgs.push("--verbose");

  // --- Background mode ---
  if (isBackground) {
    // Remove stale port file before spawning so we can detect the fresh one
    await removePortFile(absDir);

    const script = resolve(__dir, tools.web);
    // Strip CLAUDECODE so child processes (rex analyze, hench run) can
    // spawn the claude CLI without the "nested session" guard blocking them.
    const { CLAUDECODE: _cc, ...serverEnv } = process.env;
    const child = spawn(process.execPath, [script, ...serveArgs], {
      stdio: "ignore",
      detached: true,
      windowsHide: true,
      env: serverEnv,
    });
    child.unref();

    // Wait for the server to write its port file with the actual bound port.
    // This handles dynamic port allocation — the actual port may differ from
    // the requested port if the requested port was already in use.
    const actualPort = await waitForPortFile(absDir);

    if (actualPort === null) {
      // Server may have failed to start. Check if process is still running.
      if (!isProcessRunning(child.pid)) {
        console.error(`${label} failed to start. Check logs for details.`);
        return 1;
      }
      // Process is alive but port file not written yet — use requested port as fallback
      await writePidFile(absDir, child.pid, port);
      log(`${label} started in background (PID ${child.pid}).`);
      log(`  URL: http://localhost:${port}`);
      log(`Use '${stopCmd}' to stop it.`);
      return 0;
    }

    await writePidFile(absDir, child.pid, actualPort);

    if (actualPort !== port) {
      console.error(`Warning: requested port ${port} was taken; server bound to ${actualPort}.`);
      console.error(`  URL: http://localhost:${actualPort}`);
    }

    log(`${label} started in background (PID ${child.pid}).`);
    log(`  URL: http://localhost:${actualPort}`);
    log(`  MCP (rex):          http://localhost:${actualPort}/mcp/rex`);
    log(`  MCP (sourcevision): http://localhost:${actualPort}/mcp/sourcevision`);
    log("");
    log("MCP setup:");
    log(`  Claude:  claude mcp add --transport http rex http://localhost:${actualPort}/mcp/rex`);
    log(`           claude mcp add --transport http sourcevision http://localhost:${actualPort}/mcp/sourcevision`);
    log("  Codex:   configured automatically via .codex/config.toml (stdio)");
    log("");
    log(`Use '${stopCmd}' to stop it.`);
    return 0;
  }

  // --- Foreground mode ---
  // Clean up PID and port files on exit (in case of SIGINT/SIGTERM)
  const cleanup = () => Promise.all([
    removePidFile(absDir).catch(() => {}),
    removePortFile(absDir).catch(() => {}),
  ]);

  process.on("SIGINT", async () => {
    await cleanup();
    await flushExit(0);
  });
  process.on("SIGTERM", async () => {
    await cleanup();
    await flushExit(0);
  });

  const code = await run(tools.web, serveArgs);
  await cleanup();
  return code;
}

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
 *   ndx start [dir]                  Register with the multi-project hub and print /p/<id>/ (0.7.0)
 *   ndx start --open [dir]           Same, then open the project URL in the browser
 *   ndx start --here [dir]           Standalone single-project server (the 0.6.0 behaviour)
 *   ndx start --port=4000 [dir]      Standalone server on a pinned port (implies --here)
 *   ndx start --background [dir]     Standalone server, detached (daemon mode)
 *   ndx start stop [dir]             Stop a background standalone server
 *   ndx start status [dir]           Check if a standalone server is running
 */

import { spawn } from "child_process";
import { get as httpGet, request as httpRequest } from "http";
import { createConnection } from "net";
import { createHash } from "crypto";
import { readFile, writeFile, unlink, access } from "fs/promises";
import { realpathSync } from "fs";
import { homedir } from "os";
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

// ── Hub mode (0.7.0) ─────────────────────────────────────────────────────────
// Bare `ndx start [dir]` no longer runs its own server: it registers the
// project with the machine-wide hub daemon (one per user, default :3117) and
// prints the project's /p/<id>/ URL. The hub spawns one `web serve` child per
// registered repository, so two repos coexist without a port fight and each
// keeps its own n-dx version. `--here`, an explicit --port, or a configured
// web.port keep the 0.6.0 single-project path byte-for-byte.
//
// Orchestration rules apply throughout: the hub is spawned (never imported),
// and all state is exchanged over HTTP plus the hub's own files on disk.

const HUB_DEFAULT_PORT = 3117;

/** Ceiling on waiting for a freshly spawned hub to answer /api/hub/health. */
const HUB_START_TIMEOUT_MS = 20_000;

/** The hub's state directory. N_DX_HUB_DIR is a test seam. */
export function hubStateDir() {
  return process.env.N_DX_HUB_DIR || join(homedir(), ".n-dx");
}

/** Hub port from <hubDir>/config.json ({ hub: { port } }), default 3117. */
async function readHubPort() {
  try {
    const raw = await readFile(join(hubStateDir(), "config.json"), "utf-8");
    const port = JSON.parse(raw)?.hub?.port;
    if (Number.isInteger(port) && port > 0 && port <= MAX_PORT) return port;
  } catch {
    // absent or malformed — default
  }
  return HUB_DEFAULT_PORT;
}

/**
 * The main worktree's path from `git worktree list --porcelain` output —
 * the first `worktree ` entry. Exported for unit tests.
 *
 * @param {string} porcelain
 * @returns {string|null}
 */
export function parseMainWorktree(porcelain) {
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) return line.slice("worktree ".length).trim();
  }
  return null;
}

/**
 * Slug a project name into the hub's id alphabet
 * (`^[A-Za-z0-9][A-Za-z0-9._-]*$`). Exported for unit tests.
 *
 * @param {string} name
 * @returns {string}
 */
export function slugifyProjectId(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "");
  return slug || "project";
}

/**
 * Derive the hub project id for a repo.
 *
 * The slugged project name wins; a 6-char hash of the origin remote URL (or
 * the repo root, when there is no origin) is appended ONLY when the registry
 * already holds the same id for a DIFFERENT repoRoot — two clones of
 * different projects that happen to share a name stay distinguishable, while
 * re-registering the same repo keeps its stable id. Exported for unit tests.
 *
 * @param {string} projectName   From .rex/config.json "project", or the repo basename.
 * @param {string} repoRoot      Canonical main-worktree path.
 * @param {Record<string, {repoRoot?: string}>} registryProjects  Current ~/.n-dx/hub.json projects.
 * @param {string|null} originUrl
 * @returns {string}
 */
export function deriveProjectId(projectName, repoRoot, registryProjects, originUrl) {
  const slug = slugifyProjectId(projectName);
  const existing = registryProjects[slug];
  if (!existing || canonicalizePath(existing.repoRoot ?? "") === canonicalizePath(repoRoot)) {
    return slug;
  }
  const discriminator = createHash("sha1")
    .update(originUrl || repoRoot)
    .digest("hex")
    .slice(0, 6);
  return `${slug}-${discriminator}`;
}

/**
 * Resolve what this invocation is about to register: the repository's main
 * worktree (repoRoot), this checkout when it is a linked worktree, and the
 * origin URL for id disambiguation. A directory outside any git repo
 * registers as its own root.
 *
 * @param {string} absDir
 * @returns {{repoRoot: string, worktree: string|undefined, originUrl: string|null}}
 */
function resolveRepoIdentity(absDir) {
  const thisDir = canonicalizePath(absDir);
  let repoRoot = thisDir;
  try {
    const porcelain = execFileSyncCli("git", ["worktree", "list", "--porcelain"], {
      cwd: absDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const main = parseMainWorktree(porcelain);
    if (main) repoRoot = canonicalizePath(main);
  } catch {
    // not a git checkout (or git absent) — the directory is the project root
  }

  let originUrl = null;
  try {
    originUrl = execFileSyncCli("git", ["remote", "get-url", "origin"], {
      cwd: absDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    // no origin remote — deriveProjectId falls back to hashing repoRoot
  }

  return {
    repoRoot,
    worktree: repoRoot === thisDir ? undefined : thisDir,
    originUrl,
  };
}

/** The project name for id derivation: .rex/config.json "project", else the repo basename. */
async function readProjectName(repoRoot) {
  try {
    const raw = await readFile(join(repoRoot, ".rex", "config.json"), "utf-8");
    const name = JSON.parse(raw)?.project;
    if (typeof name === "string" && name.trim()) return name;
  } catch {
    // uninitialised project — basename below
  }
  return repoRoot.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "project";
}

/** Current projects from <hubDir>/hub.json; {} when absent or unreadable. */
async function readHubRegistryProjects() {
  try {
    const raw = await readFile(join(hubStateDir(), "hub.json"), "utf-8");
    const projects = JSON.parse(raw)?.projects;
    return projects && typeof projects === "object" ? projects : {};
  } catch {
    return {};
  }
}

/** GET /api/hub/health and report whether a hub answered ok on the port. */
function probeHubHealth(port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((res) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      res(value);
    };
    const req = httpGet(
      { host: "127.0.0.1", port, path: "/api/hub/health", timeout: timeoutMs },
      (response) => {
        let body = "";
        response.setEncoding("utf-8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try {
            done(response.statusCode === 200 && JSON.parse(body)?.ok === true);
          } catch {
            done(false);
          }
        });
        response.on("error", () => done(false));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      done(false);
    });
    req.on("error", () => done(false));
  });
}

/**
 * Make sure a hub is answering on `hubPort`, spawning one detached if not.
 *
 * The spawn mirrors background mode: detached, stdio ignored, CLAUDECODE
 * stripped so children the hub's servers spawn can run the claude CLI.
 * `--hub-dir` is passed explicitly so the hub and this CLI always agree on
 * the state directory (including under the N_DX_HUB_DIR test seam).
 *
 * @param {number} hubPort
 * @param {{__dir: string, tools: {web: string}}} deps
 */
async function ensureHubRunning(hubPort, { __dir, tools }) {
  if (await probeHubHealth(hubPort)) return;

  const script = resolve(__dir, tools.web);
  const { CLAUDECODE: _cc, ...hubEnv } = process.env;
  const child = spawn(
    process.execPath,
    [script, "hub", `--port=${hubPort}`, `--hub-dir=${hubStateDir()}`],
    { stdio: "ignore", detached: true, windowsHide: true, env: hubEnv },
  );
  child.unref();

  const deadline = Date.now() + HUB_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeHubHealth(hubPort)) return;
    if (child.exitCode !== null) break; // died on startup — no point polling on
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Hub did not answer on 127.0.0.1:${hubPort} within ${HUB_START_TIMEOUT_MS}ms. ` +
    `Start it manually with: n-dx-web hub --port=${hubPort}`,
  );
}

/** POST JSON to the hub; resolves { status, body } and never rejects on HTTP errors. */
function postToHub(hubPort, path, payload) {
  return new Promise((res, reject) => {
    const data = JSON.stringify(payload);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: hubPort,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf-8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try {
            res({ status: response.statusCode ?? 0, body: JSON.parse(body) });
          } catch {
            res({ status: response.statusCode ?? 0, body: {} });
          }
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

/** Open a URL in the default browser, best effort. */
function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      // `start` is a cmd built-in; the empty string is the window title slot.
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch {
    // browser opening is a convenience — never fail the command over it
  }
}

/**
 * Hub-mode `ndx start`: resolve the repo, derive the id, ensure the hub is
 * up, register, and print (optionally open) the project URL. Returns an exit
 * code; the hub and its child servers keep running after this CLI exits.
 *
 * @param {string} absDir
 * @param {object} flags   Parsed --flags from runWeb.
 * @param {{__dir: string, tools: {web: string}, label: string}} deps
 */
async function runHubStart(absDir, flags, deps) {
  const { repoRoot, worktree, originUrl } = resolveRepoIdentity(absDir);
  const projectName = await readProjectName(repoRoot);
  const registry = await readHubRegistryProjects();
  const id = deriveProjectId(projectName, repoRoot, registry, originUrl);
  const hubPort = await readHubPort();

  await ensureHubRunning(hubPort, deps);

  // ndxBin is the web CLI of THIS install, spawned by the hub as
  // `<ndxBin> serve --port=0 <repoRoot>`. Passing cli.js here (as the
  // roadmap sketch suggested) would put an orchestration shim between the
  // hub and the server; killing that shim on Windows would orphan the
  // actual server, so the hub gets the process it must own directly.
  const ndxBin = resolve(deps.__dir, deps.tools.web);

  let result;
  try {
    result = await postToHub(hubPort, "/api/hub/projects", { id, repoRoot, worktree, ndxBin });
  } catch (err) {
    console.error(`Could not reach the hub on 127.0.0.1:${hubPort}: ${err.message}`);
    return 1;
  }
  if (result.status !== 200 && result.status !== 201) {
    console.error(`Hub refused the registration (${result.status}): ${result.body?.error ?? "unknown error"}`);
    return 1;
  }

  // Compatibility pointers: tooling that finds the dashboard through
  // <dir>/.n-dx-web.port (ndx refresh --live-server, the reload signal)
  // keeps working — the file now names the hub's port, and the hub routes
  // /api/reload to this project's child. The pid file records via: "hub" so
  // the legacy stop path knows this pid is the shared hub, not a private
  // server it may terminate.
  try {
    const hubPid = JSON.parse(await readFile(join(hubStateDir(), "hub.pid"), "utf-8"))?.pid ?? null;
    await writeFile(join(absDir, PORT_FILE), String(hubPort) + "\n", "utf-8");
    await writeFile(
      join(absDir, PID_FILE),
      JSON.stringify(
        { pid: hubPid, port: hubPort, startedAt: new Date().toISOString(), via: "hub", projectId: id },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  } catch (err) {
    // The registration succeeded; a failed pointer write only degrades
    // refresh --live-server, so report it rather than failing the start.
    console.error(`Warning: could not write ${PORT_FILE}/${PID_FILE} in ${absDir}: ${err.message}`);
  }

  const projectUrl = `http://localhost:${hubPort}/p/${encodeURIComponent(id)}/`;
  log(`${deps.label} registered with the hub as "${id}"${worktree ? ` (worktree: ${worktree})` : ""}.`);
  log(`  URL: ${projectUrl}`);
  log(`  MCP (rex):          http://localhost:${hubPort}/p/${encodeURIComponent(id)}/mcp/rex`);
  log(`  MCP (sourcevision): http://localhost:${hubPort}/p/${encodeURIComponent(id)}/mcp/sourcevision`);
  log("");
  log(`Use 'ndx start --here ${absDir}' for a standalone single-project server.`);

  if (flags.open) openBrowser(projectUrl);
  return 0;
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

  // A via:"hub" pid file names the SHARED hub daemon, not a server this
  // project owns — terminateTreeByPid here would take down every project's
  // dashboard. Hub-aware stop (unregister + keepAlive) is the follow-up
  // task; until then, refuse the kill and say why.
  if (info.via === "hub") {
    log(`This project is served by the n-dx hub (PID ${info.pid}, port ${info.port}).`);
    log("Stopping the shared hub from here is not supported yet — it would stop every project's dashboard.");
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
  const configPort = flags.port ? undefined : await loadConfigPort(absDir);
  if (flags.port) {
    const parsed = parseInt(flags.port, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid port: ${flags.port}`);
      exit(1);
    }
    port = parsed;
  } else if (configPort) {
    port = configPort;
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

  // --- Hub mode: the default for a bare `ndx start` (0.7.0) ---
  // An explicit --port, a configured web.port, --background, or --here keep
  // the 0.6.0 single-project server below, byte-for-byte. A pinned port is a
  // promise about where THIS project's dashboard listens — a machine-wide hub
  // at its own port cannot keep it — and --background scripts rely on the
  // standalone pid-file/stop contract, so both opt out.
  if (!flags.here && !flags.port && !configPort && !isBackground) {
    return runHubStart(absDir, flags, { __dir, tools, label });
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

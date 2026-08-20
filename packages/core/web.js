/**
 * Server orchestration for n-dx.
 *
 * Starts the unified server (@n-dx/web serve) with support for:
 *   - Configurable port (--port, config, default 3117)
 *   - Background/daemon mode (--background)
 *   - PID file management (.n-dx-web.pid)
 *   - Graceful stop (ndx start stop / ndx web stop)
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
import { createConnection } from "net";
import { readFile, writeFile, unlink, access } from "fs/promises";
import { join, resolve } from "path";
import { terminateTreeByPid } from "./child-lifecycle.js";
import { execFileSyncCli } from "./win-spawn.js";

const DEFAULT_PORT = 3117;
const PID_FILE = ".n-dx-web.pid";
const PORT_FILE = ".n-dx-web.port";

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
 */
function isPortInUse(port) {
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
 * Find and kill whichever process is listening on `port`.
 * Returns true if the port was freed, false if kill failed.
 */
async function killPortOccupant(port) {
  try {
    let pid = null;
    if (process.platform === "win32") {
      // netstat -ano lists TCP listeners; grep for ":PORT " at the local address
      const out = execFileSyncCli("netstat", ["-ano"], { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
      for (const line of out.split("\n")) {
        // Look for lines like "  TCP    127.0.0.1:3117    0.0.0.0:0    LISTENING    12345"
        const m = line.match(/TCP\s+[\d.]+:(\d+)\s+[\d.:]+\s+LISTENING\s+(\d+)/i);
        if (m && parseInt(m[1], 10) === port) {
          pid = parseInt(m[2], 10);
          break;
        }
      }
      if (pid) {
        execFileSyncCli("taskkill", ["/F", "/PID", String(pid)], { stdio: "ignore" });
      }
    } else {
      // lsof is available on macOS and most Linux distros
      const out = execFileSyncCli("lsof", ["-ti", `tcp:${port}`], { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
      if (out) {
        pid = parseInt(out.split("\n")[0], 10);
        // SIGKILL direct, rather than spawning /bin/kill for a number we already have.
        process.kill(pid, "SIGKILL");
      }
    }
    if (!pid) return false;
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
  const stopped = await terminateTreeByPid(info.pid, {
    // web.js keeps its own, shorter grace period: `ndx start stop` is interactive
    // and must stay responsive, where child-lifecycle's tracker defaults to 5s for
    // shutdown. Consolidating the mechanism must not change the latency.
    forceKillTimeoutMs: gracePeriodMs,
  });

  if (!stopped) {
    log(`Server (PID ${info.pid}) did not exit within ${gracePeriodMs} ms of SIGKILL.`);
  }

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
      // Something else is holding the port — kill it
      log(`Port ${port} is in use by another process — clearing it…`);
      const freed = await killPortOccupant(port);
      if (!freed) {
        console.error(`Port ${port} is occupied and could not be cleared. Choose a different port with --port=N or set web.port in .n-dx.json`);
        return 1;
      }
    }
  }

  // --- Build serve args ---
  const serveArgs = ["serve", `--port=${port}`, absDir];

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

/**
 * Web server orchestration for n-dx.
 *
 * Starts the unified dashboard (@n-dx/web serve) with support for:
 *   - Configurable port (--port, config, default 3117)
 *   - Background/daemon mode (--background)
 *   - PID file management (.n-dx-web.pid)
 *   - Graceful stop (ndx web stop)
 *
 * Usage:
 *   ndx web [dir]                    Start dashboard in foreground
 *   ndx web --port=4000 [dir]        Start on custom port
 *   ndx web --background [dir]       Start detached (daemon mode)
 *   ndx web stop [dir]               Stop a background server
 *   ndx web status [dir]             Check if server is running
 */

import { spawn } from "child_process";
import { createConnection } from "net";
import { readFile, writeFile, unlink, access } from "fs/promises";
import { join, resolve } from "path";

const DEFAULT_PORT = 3117;
const PID_FILE = ".n-dx-web.pid";

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
 * Read the PID file for a given project directory.
 * Returns { pid, port } or null.
 */
async function readPidFile(dir) {
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
async function removePidFile(dir) {
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
function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Subcommands ──────────────────────────────────────────────────────────────

/**
 * Stop a running background server.
 */
async function stopServer(dir) {
  const info = await readPidFile(dir);
  if (!info) {
    console.log("No background server found.");
    return true;
  }

  if (!isProcessRunning(info.pid)) {
    console.log("Server process is no longer running (stale PID file).");
    await removePidFile(dir);
    return true;
  }

  try {
    process.kill(info.pid, "SIGTERM");
    console.log(`Stopped n-dx dashboard (PID ${info.pid}, port ${info.port}).`);
    await removePidFile(dir);
    return true;
  } catch (err) {
    console.error(`Failed to stop server (PID ${info.pid}): ${err.message}`);
    return false;
  }
}

/**
 * Show status of a background server.
 */
async function showStatus(dir, port) {
  const info = await readPidFile(dir);
  if (!info) {
    console.log("No background server recorded.");
    // Still check if something is on the port
    if (await isPortInUse(port)) {
      console.log(`Note: Port ${port} is in use by another process.`);
    }
    return;
  }

  const running = isProcessRunning(info.pid);
  const portActive = await isPortInUse(info.port);

  if (running && portActive) {
    console.log(`n-dx dashboard is running (PID ${info.pid}, port ${info.port}).`);
    console.log(`  URL: http://localhost:${info.port}`);
    console.log(`  Started: ${info.startedAt}`);
  } else if (running) {
    console.log(`Server process is running (PID ${info.pid}) but port ${info.port} is not responding.`);
  } else {
    console.log("Server process is no longer running (stale PID file).");
    await removePidFile(dir);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run the web command.
 *
 * @param {string} dir          Project directory
 * @param {string[]} rest       Remaining CLI arguments
 * @param {object} deps         Injected dependencies from cli.js
 * @param {Function} deps.run   Run a tool script (foreground)
 * @param {object} deps.tools   Tool script paths
 * @param {string} deps.__dir   Root directory of n-dx
 */
export async function runWeb(dir, rest, { run, tools, __dir }) {
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
    } else if (!arg.startsWith("-") && arg !== dir) {
      // Non-flag, non-dir arg is a subcommand
      if (!subcommand) subcommand = arg;
    }
  }

  // Resolve port: --port flag > .n-dx.json config > default
  let port = DEFAULT_PORT;
  if (flags.port) {
    const parsed = parseInt(flags.port, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid port: ${flags.port}`);
      process.exit(1);
    }
    port = parsed;
  } else {
    const configPort = await loadConfigPort(absDir);
    if (configPort) port = configPort;
  }

  const isBackground = flags.background || flags.daemon || flags.bg;

  // --- Subcommand: stop ---
  if (subcommand === "stop") {
    const ok = await stopServer(absDir);
    return ok ? 0 : 1;
  }

  // --- Subcommand: status ---
  if (subcommand === "status") {
    await showStatus(absDir, port);
    return 0;
  }

  if (subcommand) {
    console.error(`Unknown web subcommand: ${subcommand}`);
    console.error("Available: stop, status");
    return 1;
  }

  // --- Check for stale PID / already running ---
  const existing = await readPidFile(absDir);
  if (existing && isProcessRunning(existing.pid)) {
    console.error(`n-dx dashboard is already running (PID ${existing.pid}, port ${existing.port}).`);
    console.error(`  URL: http://localhost:${existing.port}`);
    console.error("Use 'ndx web stop' to stop it first.");
    return 1;
  } else if (existing) {
    // Stale PID file — clean up
    await removePidFile(absDir);
  }

  // --- Check port availability ---
  if (await isPortInUse(port)) {
    console.error(`Port ${port} is already in use.`);
    console.error("Use --port=<N> to specify a different port.");
    return 1;
  }

  // --- Build serve args ---
  const serveArgs = ["serve", `--port=${port}`, absDir];

  // --- Background mode ---
  if (isBackground) {
    const script = resolve(__dir, tools.web);
    const child = spawn(process.execPath, [script, ...serveArgs], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();

    await writePidFile(absDir, child.pid, port);
    console.log(`n-dx dashboard started in background (PID ${child.pid}).`);
    console.log(`  URL: http://localhost:${port}`);
    console.log("Use 'ndx web stop' to stop it.");
    return 0;
  }

  // --- Foreground mode ---
  // Clean up PID file on exit (in case of SIGINT/SIGTERM)
  const cleanup = () => removePidFile(absDir).catch(() => {});

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });

  const code = await run(tools.web, serveArgs);
  await cleanup();
  return code;
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";

const CLI_PATH = join(import.meta.dirname, "../../cli.js");

function runResult(args) {
  try {
    const stdout = execFileSync("node", [CLI_PATH, "web", ...args], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status };
  }
}

/**
 * Set up a minimal project with .sourcevision dir (minimum for web command).
 */
async function setupProject(dir) {
  await mkdir(join(dir, ".sourcevision"), { recursive: true });
  await writeFile(
    join(dir, ".sourcevision", "manifest.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: new Date().toISOString(),
      targetPath: dir,
      modules: {
        inventory: { status: "complete", lastRun: new Date().toISOString() },
        imports: { status: "complete", lastRun: new Date().toISOString() },
        zones: { status: "complete", lastRun: new Date().toISOString() },
        components: { status: "complete", lastRun: new Date().toISOString() },
      },
    }),
  );
  await writeFile(
    join(dir, ".sourcevision", "inventory.json"),
    JSON.stringify({ files: [], summary: { totalFiles: 0, totalBytes: 0, languages: {} } }),
  );
  await writeFile(
    join(dir, ".sourcevision", "imports.json"),
    JSON.stringify({
      edges: [],
      external: {},
      summary: { totalEdges: 0, totalExternal: 0 },
    }),
  );
  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({
      zones: [],
      crossings: [],
      unzoned: [],
      summary: { totalZones: 0, totalFiles: 0 },
    }),
  );
  await writeFile(
    join(dir, ".sourcevision", "components.json"),
    JSON.stringify({
      components: [],
      routeModules: [],
      usageEdges: [],
      summary: { totalComponents: 0, totalRouteModules: 0, totalUsageEdges: 0 },
    }),
  );
}

/**
 * Find an available port by briefly listening on 0.
 */
function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * Block a port by holding a server on it.
 * Returns { server, port, close() }.
 */
function blockPort(port) {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(port, () => {
      resolve({
        server: srv,
        port,
        close: () => new Promise((r) => srv.close(r)),
      });
    });
    srv.on("error", reject);
  });
}

describe("n-dx web", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-web-e2e-"));
    await setupProject(tmpDir);
  });

  afterEach(async () => {
    // Clean up any stale PID files / background processes
    try {
      const pidPath = join(tmpDir, ".n-dx-web.pid");
      const raw = await readFile(pidPath, "utf-8");
      const data = JSON.parse(raw);
      try { process.kill(data.pid, "SIGTERM"); } catch {}
    } catch {}
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Invalid port ────────────────────────────────────────────────────────

  describe("port validation", () => {
    it("exits 1 for invalid port", () => {
      const { stderr, code } = runResult(["--port=abc", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("Invalid port");
    });

    it("exits 1 for port 0", () => {
      const { stderr, code } = runResult(["--port=0", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("Invalid port");
    });

    it("exits 1 for port above 65535", () => {
      const { stderr, code } = runResult(["--port=99999", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("Invalid port");
    });
  });

  // ── Port conflict (dynamic fallback) ─────────────────────────────────

  describe("port conflict detection", () => {
    it("falls back to another port when requested port is in use", async () => {
      const port = await findAvailablePort();
      const blocker = await blockPort(port);
      try {
        // Use background mode since a successful server won't exit
        const { stdout, code } = runResult([`--port=${port}`, "--background", tmpDir]);
        expect(code).toBe(0);
        expect(stdout).toContain("background");
      } finally {
        await blocker.close();
        // Clean up any background server
        runResult(["stop", tmpDir]);
      }
    });
  });

  // ── Unknown subcommand ─────────────────────────────────────────────────

  describe("unknown subcommand", () => {
    it("exits 1 for unknown web subcommand", () => {
      const { stderr, code } = runResult(["restart", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("Unknown web subcommand");
    });
  });

  // ── Status subcommand (no server running) ──────────────────────────────

  describe("status subcommand", () => {
    it("reports no server when none is running", () => {
      const { stdout, code } = runResult(["status", tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain("No background server");
    });
  });

  // ── Stop subcommand (no server running) ────────────────────────────────

  describe("stop subcommand", () => {
    it("reports no server to stop", () => {
      const { stdout, code } = runResult(["stop", tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain("No background server");
    });
  });

  // ── Config port integration ────────────────────────────────────────────

  describe("config integration", () => {
    it("reads port from .n-dx.json config", async () => {
      // Write a config with a port. Use background mode to verify the
      // config port is passed to the server (it appears in the output).
      const port = await findAvailablePort();
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ web: { port } }),
      );

      const { stdout, code } = runResult(["--background", tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain(`${port}`);

      // Clean up
      runResult(["stop", tmpDir]);
    });

    it("--port flag overrides config", async () => {
      const configPort = await findAvailablePort();
      const flagPort = await findAvailablePort();
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ web: { port: configPort } }),
      );

      const { stdout, code } = runResult([`--port=${flagPort}`, "--background", tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain(`${flagPort}`);

      // Clean up
      runResult(["stop", tmpDir]);
    });
  });

  // ── Background mode ────────────────────────────────────────────────────

  describe("background mode", () => {
    it("starts server in background and creates PID file", async () => {
      const port = await findAvailablePort();
      const { stdout, code } = runResult([`--port=${port}`, "--background", tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain("background");
      expect(stdout).toContain(`${port}`);

      // PID file should exist
      const pidPath = join(tmpDir, ".n-dx-web.pid");
      const raw = await readFile(pidPath, "utf-8");
      const pidData = JSON.parse(raw);
      expect(pidData).toHaveProperty("pid");
      expect(pidData).toHaveProperty("port", port);
      expect(pidData).toHaveProperty("startedAt");

      // Clean up
      try { process.kill(pidData.pid, "SIGTERM"); } catch {}
    });

    it("prevents starting a second background server", async () => {
      const port = await findAvailablePort();
      // Start first
      runResult([`--port=${port}`, "--background", tmpDir]);

      // Wait a moment for PID file to be written
      await new Promise((r) => setTimeout(r, 200));

      // Try to start second
      const port2 = await findAvailablePort();
      const { stderr, code } = runResult([`--port=${port2}`, "--background", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("already running");

      // Clean up
      const pidPath = join(tmpDir, ".n-dx-web.pid");
      try {
        const raw = await readFile(pidPath, "utf-8");
        const pidData = JSON.parse(raw);
        process.kill(pidData.pid, "SIGTERM");
      } catch {}
    });

    it("stop subcommand kills background server", async () => {
      const port = await findAvailablePort();
      runResult([`--port=${port}`, "--background", tmpDir]);

      // Wait for PID file
      await new Promise((r) => setTimeout(r, 200));

      const { stdout, code } = runResult(["stop", tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain("Stopped");
    });

    it("status shows running server info", async () => {
      const port = await findAvailablePort();
      runResult([`--port=${port}`, "--background", tmpDir]);

      // Wait for server to start
      await new Promise((r) => setTimeout(r, 500));

      const { stdout, code } = runResult(["status", tmpDir]);
      expect(code).toBe(0);
      expect(stdout).toContain("running");
      expect(stdout).toContain(`${port}`);

      // Clean up
      runResult(["stop", tmpDir]);
    });
  });

  // ── Help text ──────────────────────────────────────────────────────────

  describe("help text", () => {
    it("shows start/dashboard in the main help output", () => {
      const output = execFileSync("node", [CLI_PATH], {
        encoding: "utf-8",
        timeout: 10000,
        stdio: "pipe",
      });
      expect(output).toContain("start");
      expect(output).toContain("dashboard");
    });
  });
});

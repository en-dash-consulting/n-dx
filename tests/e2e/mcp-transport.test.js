/**
 * MCP HTTP transport contract test — validates that MCP endpoints
 * work end-to-end through the web server.
 *
 * Complements the unit-level routes-mcp.test.ts (which tests the
 * handler in isolation) by verifying the full server lifecycle:
 * start → MCP session → tool call → shutdown.
 *
 * The contract assertions live in mcp-transport-contract.js so the same
 * suite also runs through the hub (hub-mcp-transport.test.js) at
 * /p/<id>/mcp/* and the sole-project root alias.
 *
 * Uses raw fetch with JSON-RPC payloads to avoid SDK version coupling.
 *
 * @see packages/web/tests/unit/server/routes-mcp.test.ts — unit-level MCP tests
 * @see tests/e2e/cli-start.test.js — server lifecycle tests
 */

import { describe, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { join } from "node:path";
import {
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";
import { registerMcpTransportContract } from "./mcp-transport-contract.js";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

function isListenPermissionError(error) {
  return Boolean(error && typeof error === "object" && error.code === "EPERM");
}

/**
 * Wait for the server to accept connections on the given port.
 * Polls with fetch every 200ms, up to the timeout.
 */
async function waitForServer(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/api/health`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe("MCP HTTP transport (e2e)", { timeout: 120_000 }, () => {
  let tmpDir;
  let port;
  let serverProcess;
  let canBindPorts = true;

  beforeAll(async () => {
    tmpDir = await createTmpDir("ndx-mcp-e2e-");
    await setupRexDir(tmpDir);
    await setupSourcevisionDir(tmpDir);

    // Find an available port
    const { createServer } = await import("node:net");
    try {
      port = await new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, () => {
          const p = srv.address().port;
          srv.close(() => resolve(p));
        });
        srv.on("error", reject);
      });
    } catch (error) {
      if (isListenPermissionError(error)) {
        canBindPorts = false;
        return;
      }
      throw error;
    }

    // Start the server in the foreground (as a child process)
    serverProcess = spawn("node", [CLI_PATH, "start", "--port=" + port, tmpDir], {
      stdio: "pipe",
      env: { ...process.env },
    });

    // Capture stderr for debugging if needed
    let stderr = "";
    serverProcess.stderr.on("data", (chunk) => { stderr += chunk; });

    await waitForServer(port);
  }, 15000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      // Wait for process to exit
      await new Promise((resolve) => {
        serverProcess.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
    await removeTmpDir(tmpDir);
  });

  registerMcpTransportContract(
    () => `http://localhost:${port}`,
    () => canBindPorts,
  );
});

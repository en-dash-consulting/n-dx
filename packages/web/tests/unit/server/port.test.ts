import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import {
  checkPort,
  checkPortWithRetry,
  findAvailablePort,
  DEFAULT_PORT,
  PORT_RANGE_START,
  PORT_RANGE_END,
} from "../../../src/server/port.js";
import { PORT_FILE } from "../../../src/server/start.js";

/** Occupy a port by binding a TCP server to it. */
function occupyPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, () => resolve(server));
  });
}

/** Close a server and wait for it to finish. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("port utilities", () => {
  const servers: Server[] = [];

  afterEach(async () => {
    // Clean up all occupied ports
    await Promise.all(servers.map((s) => closeServer(s)));
    servers.length = 0;
  });

  describe("constants", () => {
    it("exports expected default values", () => {
      expect(DEFAULT_PORT).toBe(3117);
      expect(PORT_RANGE_START).toBe(3117);
      expect(PORT_RANGE_END).toBe(3200);
    });

    it("exports PORT_FILE constant for server-to-orchestrator communication", () => {
      expect(PORT_FILE).toBe(".n-dx-web.port");
    });
  });

  describe("checkPort", () => {
    it("reports an unused port as available", async () => {
      // Use port 0 trick: bind to 0 to get an OS-assigned port, close it, then check it
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      await closeServer(tmp);

      const result = await checkPort(port);
      expect(result.available).toBe(true);
      expect(result.port).toBe(port);
      expect(result.error).toBeUndefined();
    });

    it("reports an occupied port as unavailable", async () => {
      // Bind a port, then check it
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      servers.push(tmp);

      const result = await checkPort(port);
      expect(result.available).toBe(false);
      expect(result.port).toBe(port);
      expect(result.error).toBe("EADDRINUSE");
    });

    it("returns the correct port in the result", async () => {
      const result = await checkPort(0); // port 0 is always "available" (OS assigns)
      expect(result.port).toBe(0);
    });
  });

  describe("checkPortWithRetry", () => {
    it("returns available immediately when port is free on the first check", async () => {
      // Get a free port, close the server, then verify checkPortWithRetry succeeds fast
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      await closeServer(tmp);

      const result = await checkPortWithRetry(port, { maxRetries: 3, retryDelayMs: 50 });
      expect(result.available).toBe(true);
      expect(result.port).toBe(port);
      expect(result.error).toBeUndefined();
    });

    it("retries and eventually succeeds when the port is released during the retry window", async () => {
      // Occupy a port, then release it after a short delay so it becomes
      // available within the retry window.
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });

      // Release the port after 80ms — within the retry window below
      setTimeout(() => tmp.close(), 80);

      // Poll every 30ms with fixed backoff so we hit the freed port within ~3 attempts
      const result = await checkPortWithRetry(port, {
        maxRetries: 10,
        retryDelayMs: 30,
        backoffFactor: 1,
      });

      expect(result.available).toBe(true);
      expect(result.port).toBe(port);
    });

    it("returns unavailable after exhausting all retries when port stays occupied", async () => {
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      servers.push(tmp); // keep open through afterEach

      // Use minimal retries and delays to keep the test fast
      const result = await checkPortWithRetry(port, {
        maxRetries: 2,
        retryDelayMs: 10,
        backoffFactor: 1,
      });

      expect(result.available).toBe(false);
      expect(result.port).toBe(port);
      expect(result.error).toBe("EADDRINUSE");
    });

    it("respects maxRetries=0 (behaves identically to a single checkPort call)", async () => {
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      servers.push(tmp);

      const result = await checkPortWithRetry(port, { maxRetries: 0 });
      expect(result.available).toBe(false);
      expect(result.error).toBe("EADDRINUSE");
    });
  });

  describe("findAvailablePort", () => {
    it("returns the preferred port when it is available", async () => {
      // Find a free port to use as our "preferred"
      const tmp = createServer();
      const freePort = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      await closeServer(tmp);

      const result = await findAvailablePort(freePort, freePort, freePort + 10);
      expect(result.port).toBe(freePort);
      expect(result.isOriginal).toBe(true);
      expect(result.requestedPort).toBe(freePort);
    });

    it("falls back to next available port when preferred is occupied", async () => {
      // Get two consecutive free ports
      const tmp1 = createServer();
      const port1 = await new Promise<number>((resolve) => {
        tmp1.listen(0, "127.0.0.1", () => {
          const addr = tmp1.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      // Keep port1 occupied
      servers.push(tmp1);

      // Use a small range starting after port1 for the scan
      // We just need to verify that the preferred port is skipped
      const result = await findAvailablePort(port1, port1, port1 + 10);
      expect(result.port).not.toBe(port1);
      expect(result.isOriginal).toBe(false);
      expect(result.requestedPort).toBe(port1);
      expect(result.port).toBeGreaterThan(port1);
      expect(result.port).toBeLessThanOrEqual(port1 + 10);
    });

    it("throws when no port is available in range", async () => {
      // Occupy a small range of ports
      const tmp = createServer();
      const basePort = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      servers.push(tmp);

      // Occupy a couple more ports in the range
      for (let p = basePort + 1; p <= basePort + 2; p++) {
        try {
          const s = await occupyPort(p);
          servers.push(s);
        } catch {
          // Port might already be in use by something else, that's fine
        }
      }

      // Try with range that's just the occupied port
      // (single-port range guaranteed to fail)
      await expect(
        findAvailablePort(basePort, basePort, basePort),
      ).rejects.toThrow(/No available port found/);
    });

    it("skips the preferred port during range scan", async () => {
      // Occupy a port, use it as preferred, ensure it's not double-checked
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      servers.push(tmp);

      // Range includes the preferred port; should find the next one
      const result = await findAvailablePort(port, port, port + 5);
      expect(result.port).not.toBe(port);
      expect(result.isOriginal).toBe(false);
    });

    it("uses retryOpts to recover the preferred port when it is released during retries", async () => {
      // Occupy a port, release it after 80ms, verify findAvailablePort returns
      // the original port (not a fallback) when retryOpts are supplied.
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });

      // Release the port partway through the retry window
      setTimeout(() => tmp.close(), 80);

      const result = await findAvailablePort(port, port, port + 10, {
        maxRetries: 10,
        retryDelayMs: 30,
        backoffFactor: 1,
      });

      expect(result.port).toBe(port);
      expect(result.isOriginal).toBe(true);
      expect(result.requestedPort).toBe(port);
    });

    it("falls back to range scan after retryOpts exhausted when preferred stays occupied", async () => {
      const tmp = createServer();
      const port = await new Promise<number>((resolve) => {
        tmp.listen(0, () => {
          const addr = tmp.address();
          resolve(typeof addr === "object" && addr ? addr.port : 0);
        });
      });
      servers.push(tmp); // keep open

      // Very few retries so the test stays fast
      const result = await findAvailablePort(port, port, port + 10, {
        maxRetries: 1,
        retryDelayMs: 5,
        backoffFactor: 1,
      });

      expect(result.port).not.toBe(port);
      expect(result.isOriginal).toBe(false);
      expect(result.requestedPort).toBe(port);
      expect(result.port).toBeGreaterThan(port);
      expect(result.port).toBeLessThanOrEqual(port + 10);
    });
  });
});

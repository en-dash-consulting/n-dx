/**
 * `ndx start` must identify the occupant of a busy port before killing it.
 *
 * The PID file it consults lives inside the directory it was given, so a second
 * project or worktree has no entry there and a busy 3117 read as a stranger
 * squatting on the port — which `killPortOccupant` then SIGKILLed, taking down
 * another project's working dashboard.
 *
 * The decision now has three outcomes, all covered here:
 *   peer    → relocate, never kill
 *   self    → legacy path (restart is `ndx start`'s documented idempotency)
 *   unknown → legacy path (attribution impossible, so behaviour is unchanged)
 *
 * @see packages/core/web.js — probeStatusEndpoint / classifyPortOccupant
 * @see packages/web/src/server/routes-status.ts — the payload being probed
 */

import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  classifyPortOccupant,
  probeStatusEndpoint,
  findFreePortInRange,
  runWeb,
} from "../../packages/core/web.js";

/** A minimal but shape-valid /api/status payload for `projectDir`. */
function statusPayload(projectDir) {
  return {
    projectDir,
    sv: { freshness: "unavailable", analyzedAt: null, minutesAgo: null, modulesComplete: 0, modulesTotal: 5 },
    rex: { exists: false, percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null, items: [] },
    hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
  };
}

/** Servers started by a test, torn down in afterEach. */
const servers = [];

/**
 * Start a loopback HTTP server on an ephemeral port.
 * `handler(req, res)` owns the response.
 */
function startServer(handler) {
  return new Promise((res) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, "127.0.0.1", () => {
      res({ server, port: server.address().port });
    });
  });
}

/** Start a server that answers /api/status like a dashboard for `projectDir`. */
function startFakeDashboard(projectDir) {
  return startServer((req, res) => {
    if (req.url === "/api/status") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(statusPayload(projectDir)));
      return;
    }
    res.writeHead(404);
    res.end();
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise((res) => s.close(() => res()))),
  );
});

describe("classifyPortOccupant", () => {
  const dir = "/tmp/project-a";

  it("reports a dashboard for another directory as a peer", () => {
    expect(classifyPortOccupant(statusPayload("/tmp/project-b"), dir)).toEqual({
      kind: "peer",
      projectDir: "/tmp/project-b",
    });
  });

  it("reports a dashboard for this directory as self", () => {
    expect(classifyPortOccupant(statusPayload(dir), dir)).toEqual({
      kind: "self",
      projectDir: dir,
    });
  });

  it("normalizes both paths before comparing, so a trailing slash is still self", () => {
    // Without resolve() on both sides, `/tmp/project-a/` would be read as a
    // peer and this directory's own server would survive as a second dashboard.
    expect(classifyPortOccupant(statusPayload(`${dir}/`), dir).kind).toBe("self");
    expect(classifyPortOccupant(statusPayload(join(dir, "sub", "..")), dir).kind).toBe("self");
  });

  it("treats a failed probe as unknown", () => {
    expect(classifyPortOccupant(null, dir)).toEqual({ kind: "unknown" });
    expect(classifyPortOccupant(undefined, dir)).toEqual({ kind: "unknown" });
    expect(classifyPortOccupant("not json", dir)).toEqual({ kind: "unknown" });
    expect(classifyPortOccupant([statusPayload("/tmp/project-b")], dir)).toEqual({ kind: "unknown" });
  });

  it("treats a non-n-dx service as unknown even when it reports a projectDir", () => {
    // Shape check, not just field presence: some other dev server answering
    // /api/status with a projectDir must not be mistaken for a dashboard.
    expect(classifyPortOccupant({ projectDir: "/tmp/project-b" }, dir)).toEqual({ kind: "unknown" });
    const missingHench = statusPayload("/tmp/project-b");
    delete missingHench.hench;
    expect(classifyPortOccupant(missingHench, dir)).toEqual({ kind: "unknown" });
  });

  it("treats a dashboard that does not report projectDir as unknown", () => {
    // A server predating the projectDir field cannot be attributed, so the
    // legacy kill path stays in charge rather than guessing.
    const older = statusPayload("/tmp/project-b");
    delete older.projectDir;
    expect(classifyPortOccupant(older, dir)).toEqual({ kind: "unknown" });

    const blank = statusPayload("");
    expect(classifyPortOccupant(blank, dir)).toEqual({ kind: "unknown" });
  });
});

describe("probeStatusEndpoint", () => {
  it("parses a dashboard's status payload", async () => {
    const { port } = await startFakeDashboard("/tmp/project-b");
    const payload = await probeStatusEndpoint(port);
    expect(payload.projectDir).toBe("/tmp/project-b");
  });

  it("returns null when nothing is listening", async () => {
    // Bind and release to get a port that is almost certainly free.
    const { server, port } = await startServer(() => {});
    await new Promise((res) => server.close(() => res()));
    expect(await probeStatusEndpoint(port, 500)).toBeNull();
  });

  it("returns null for a non-200 response", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    expect(await probeStatusEndpoint(port)).toBeNull();
  });

  it("returns null for a non-JSON body", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html>some other dev server</html>");
    });
    expect(await probeStatusEndpoint(port)).toBeNull();
  });

  it("returns null instead of hanging when the occupant never responds", async () => {
    const { port } = await startServer(() => {
      // Accept the connection and stall — a wedged server must not stall
      // `ndx start` behind it.
    });
    const started = Date.now();
    expect(await probeStatusEndpoint(port, 300)).toBeNull();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("the probe decision, end to end", () => {
  it("classifies a live dashboard for another directory as a peer", async () => {
    const { port } = await startFakeDashboard("/tmp/project-b");
    const occupant = classifyPortOccupant(await probeStatusEndpoint(port), "/tmp/project-a");
    expect(occupant).toEqual({ kind: "peer", projectDir: "/tmp/project-b" });
  });

  it("classifies a live dashboard for this directory as self", async () => {
    const { port } = await startFakeDashboard("/tmp/project-a");
    const occupant = classifyPortOccupant(await probeStatusEndpoint(port), "/tmp/project-a");
    expect(occupant.kind).toBe("self");
  });

  it("classifies a live non-n-dx occupant as unknown", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
    const occupant = classifyPortOccupant(await probeStatusEndpoint(port), "/tmp/project-a");
    expect(occupant).toEqual({ kind: "unknown" });
  });
});

describe("runWeb, on a busy port", () => {
  /**
   * Run `runWeb` in foreground mode with the spawn stubbed out, and return the
   * `serve` argv it would have handed to @n-dx/web.
   *
   * The SIGINT/SIGTERM handlers runWeb installs are removed afterwards so
   * repeated calls do not pile up listeners on the shared test process.
   */
  async function captureServeArgs(dir, rest) {
    const before = {
      SIGINT: process.listeners("SIGINT"),
      SIGTERM: process.listeners("SIGTERM"),
    };
    let serveArgs = null;
    try {
      const code = await runWeb(dir, ["--quiet", ...rest], {
        exit: (c) => { throw new Error(`unexpected exit(${c})`); },
        flushExit: async () => {},
        run: async (_tool, args) => { serveArgs = args; return 0; },
        tools: { web: "web.js" },
        __dir: dir,
        commandName: "start",
      });
      return { code, serveArgs };
    } finally {
      for (const signal of ["SIGINT", "SIGTERM"]) {
        for (const fn of process.listeners(signal)) {
          if (!before[signal].includes(fn)) process.removeListener(signal, fn);
        }
      }
    }
  }

  let dir;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("relocates instead of killing when a peer dashboard holds the port", async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-start-peer-"));
    const peer = await startFakeDashboard(join(tmpdir(), "some-other-project"));

    const { code, serveArgs } = await captureServeArgs(dir, [`--port=${peer.port}`]);

    expect(code).toBe(0);
    // The peer is untouched…
    expect(peer.server.listening).toBe(true);
    // …and this invocation was handed a different port inside the range the
    // server's own allocator uses.
    const served = Number(serveArgs[1].replace("--port=", ""));
    expect(served).not.toBe(peer.port);
    expect(served).toBeGreaterThanOrEqual(3117);
    expect(served).toBeLessThanOrEqual(3200);
  }, 20_000);

  it("passes the requested port straight through when it is free", async () => {
    dir = await mkdtemp(join(tmpdir(), "ndx-start-free-"));
    // Bind and release to get a port that is almost certainly free.
    const { server, port } = await startServer(() => {});
    await new Promise((res) => server.close(() => res()));

    const { code, serveArgs } = await captureServeArgs(dir, [`--port=${port}`]);

    expect(code).toBe(0);
    expect(serveArgs).toEqual(["serve", `--port=${port}`, dir]);
  }, 20_000);
});

describe("findFreePortInRange", () => {
  it("skips the excluded port and returns the next free one", async () => {
    const { port } = await startServer(() => {});
    // Scan a two-port window whose first entry is the busy port.
    expect(await findFreePortInRange(0, port, port + 1)).toBe(port + 1);
    // …and one whose only entry is excluded.
    expect(await findFreePortInRange(port, port, port)).toBeNull();
  });

  it("returns null when every port in the range is taken", async () => {
    const { port } = await startServer(() => {});
    expect(await findFreePortInRange(0, port, port)).toBeNull();
  });
});

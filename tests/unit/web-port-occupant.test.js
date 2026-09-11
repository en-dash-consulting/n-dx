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
import { spawn } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, resolve } from "node:path";

import {
  classifyPortOccupant,
  probeStatusEndpoint,
  findFreePortInRange,
  findRelocationPort,
  isPortInUse,
  killPortOccupant,
  listenerPidsOnPort,
  selectKillTarget,
  isPortInUse,
  runWeb,
} from "../../packages/core/web.js";

/**
 * Absolute, platform-native fixture directories.
 *
 * classifyPortOccupant canonicalizes both sides before comparing, so it returns
 * a resolved path — never the literal it was handed. A bare POSIX literal like
 * "/tmp/…-a" is only equal to its own resolution on POSIX: on Windows
 * resolve() qualifies it with the current drive ("D:\\tmp\\project-a"), which is
 * what CI saw when these assertions compared against the literal. Resolving the
 * fixtures here keeps every assertion in the same form the code under test
 * produces, on every OS.
 *
 * The names are namespaced so the directories cannot plausibly exist: if they
 * did, canonicalizePath's realpathSync step would resolve them further (on
 * macOS /tmp is a symlink to /private/tmp) and diverge from resolve() again.
 */
const PROJECT_A = resolve("/tmp/ndx-port-occupant-fixture-a");
const PROJECT_B = resolve("/tmp/ndx-port-occupant-fixture-b");

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

// ── Out-of-process socket holders ────────────────────────────────────────────
// Whom-to-kill cannot be tested with in-process sockets: every pid the query
// returns would be this process, and the self-preservation guard short-circuits
// before the selection is exercised. These helpers put the listener and the
// client in separate processes so the query has a real choice to get wrong.

/** Child processes started by a test, reaped in afterEach. */
const children = [];

/** Self-exit fuse for every helper child, so a crashed test leaks nothing. */
const CHILD_LIFETIME_MS = 30_000;

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});

/** Resolve with the child's first line of stdout. */
function firstLine(child) {
  return new Promise((res, rej) => {
    let buf = "";
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      if (buf.includes("\n")) res(buf.slice(0, buf.indexOf("\n")));
    });
    child.once("exit", (code) => rej(new Error(`helper child exited (${code}) before reporting`)));
  });
}

/** Spawn a node child running `source`, tracked for teardown. */
function spawnHelper(source) {
  const child = spawn(process.execPath, ["-e", source], { stdio: ["pipe", "pipe", "ignore"] });
  children.push(child);
  return child;
}

/**
 * Spawn a child that connects to the port given on its stdin and holds the
 * socket open.
 *
 * It takes the port over stdin rather than in its source because it is spawned
 * before the listener exists — see {@link startListenerWithClient} — and it
 * retries because the listener may not have bound yet when the port arrives.
 */
function startClientProcess() {
  return spawnHelper(`
    const net = require("node:net");
    let buf = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
      if (!buf.includes("\\n")) return;
      const port = Number(buf.trim());
      buf = "";
      process.stdin.removeAllListeners("data");
      const timer = setInterval(() => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => { clearInterval(timer); console.log("connected"); });
        socket.once("error", () => socket.destroy());
      }, 50);
    });
    setTimeout(() => process.exit(0), ${CHILD_LIFETIME_MS});
  `);
}

/**
 * Spawn a child listening on an ephemeral loopback port.
 * Resolves with the child and the port it bound.
 */
async function startListenerProcess() {
  const child = spawnHelper(`
    const net = require("node:net");
    const server = net.createServer(() => {});
    server.listen(0, "127.0.0.1", () => console.log(server.address().port));
    setTimeout(() => process.exit(0), ${CHILD_LIFETIME_MS});
  `);
  const port = Number(await firstLine(child));
  return { child, port };
}

/**
 * A listener and a separate client, both out of process, both holding a socket
 * on the same port.
 *
 * The client is spawned FIRST on purpose. `lsof -ti tcp:<port>` prints pids in
 * ascending order, so the earlier-spawned client lands above the listener — the
 * exact ordering under which taking the first pid kills the wrong process. The
 * listener still picks its own ephemeral port, so nothing here races another
 * suite for a port number reserved in advance.
 */
async function startListenerWithClient() {
  const client = startClientProcess();
  const { child: listener, port } = await startListenerProcess();
  client.stdin.write(`${port}\n`);
  // Piped stdout starts paused, so the client's line is still there to read
  // even if it was written before this listener attached.
  await firstLine(client);
  return { port, listener, client };
}

/** Wait up to `timeoutMs` for a child to exit. Returns true if it did. */
async function waitForExit(child, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return true;
    await new Promise((res) => setTimeout(res, 50));
  }
  return false;
}

describe("classifyPortOccupant", () => {
  const dir = PROJECT_A;

  it("reports a dashboard for another directory as a peer", () => {
    expect(classifyPortOccupant(statusPayload(PROJECT_B), dir)).toEqual({
      kind: "peer",
      projectDir: PROJECT_B,
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
    expect(classifyPortOccupant([statusPayload(PROJECT_B)], dir)).toEqual({ kind: "unknown" });
  });

  it("treats a non-n-dx service as unknown even when it reports a projectDir", () => {
    // Shape check, not just field presence: some other dev server answering
    // /api/status with a projectDir must not be mistaken for a dashboard.
    expect(classifyPortOccupant({ projectDir: PROJECT_B }, dir)).toEqual({ kind: "unknown" });
    const missingHench = statusPayload(PROJECT_B);
    delete missingHench.hench;
    expect(classifyPortOccupant(missingHench, dir)).toEqual({ kind: "unknown" });
  });

  it("treats a dashboard that does not report projectDir as unknown", () => {
    // A server predating the projectDir field cannot be attributed, so the
    // legacy kill path stays in charge rather than guessing.
    const older = statusPayload(PROJECT_B);
    delete older.projectDir;
    expect(classifyPortOccupant(older, dir)).toEqual({ kind: "unknown" });

    const blank = statusPayload("");
    expect(classifyPortOccupant(blank, dir)).toEqual({ kind: "unknown" });
  });

  describe("symlinked project paths", () => {
    let real;
    let link;

    afterEach(async () => {
      if (real) await rm(real, { recursive: true, force: true });
      if (link) await rm(link, { force: true });
      real = null;
      link = null;
    });

    it("reports a dashboard as self when the same directory is reached through a symlink", async () => {
      // Without resolving symlinks, the server's realpath'd projectDir and
      // this invocation's symlink-spelled absDir compare unequal and the
      // caller relocates instead of restarting — starting a second dashboard
      // on the same PRD tree.
      real = await mkdtemp(join(tmpdir(), "ndx-port-occupant-real-"));
      link = join(tmpdir(), `ndx-port-occupant-link-${process.pid}`);
      await symlink(real, link);

      // The server reports the realpath'd directory it was started with...
      const payload = statusPayload(real);
      // ...while this invocation was started via the symlink spelling.
      expect(classifyPortOccupant(payload, link)).toEqual({
        kind: "self",
        // The temp dir itself may sit under a symlinked ancestor (e.g. macOS
        // /var -> /private/var), so compare against the fully realpath'd
        // form rather than the mkdtemp() spelling.
        projectDir: realpathSync.native(real),
      });
    });

    it("still reports two genuinely different directories as peers", async () => {
      real = await mkdtemp(join(tmpdir(), "ndx-port-occupant-real-"));
      const other = await mkdtemp(join(tmpdir(), "ndx-port-occupant-other-"));
      try {
        expect(classifyPortOccupant(statusPayload(other), real)).toEqual({
          kind: "peer",
          projectDir: realpathSync.native(other),
        });
      } finally {
        await rm(other, { recursive: true, force: true });
      }
    });

    it("falls back to a lexical comparison when the reported projectDir no longer exists", () => {
      // realpath throws ENOENT for a path that has been deleted out from
      // under the caller; classification must degrade to today's resolve()
      // comparison instead of throwing.
      const deleted = join(tmpdir(), "ndx-port-occupant-deleted-does-not-exist");
      expect(classifyPortOccupant(statusPayload(deleted), deleted)).toEqual({
        kind: "self",
        projectDir: deleted,
      });
      expect(classifyPortOccupant(statusPayload(deleted), `${deleted}-other`).kind).toBe(
        "peer",
      );
    });

    it.skipIf(platform() !== "win32")(
      "is insensitive to drive-letter and path casing on win32",
      async () => {
        real = await mkdtemp(join(tmpdir(), "ndx-port-occupant-real-"));
        const upper = real.toUpperCase();
        expect(classifyPortOccupant(statusPayload(upper), real).kind).toBe("self");
      },
    );
  });
});

describe("probeStatusEndpoint", () => {
  it("parses a dashboard's status payload", async () => {
    const { port } = await startFakeDashboard(PROJECT_B);
    const payload = await probeStatusEndpoint(port);
    expect(payload.projectDir).toBe(PROJECT_B);
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
    const { port } = await startFakeDashboard(PROJECT_B);
    const occupant = classifyPortOccupant(await probeStatusEndpoint(port), PROJECT_A);
    expect(occupant).toEqual({ kind: "peer", projectDir: PROJECT_B });
  });

  it("classifies a live dashboard for this directory as self", async () => {
    const { port } = await startFakeDashboard(PROJECT_A);
    const occupant = classifyPortOccupant(await probeStatusEndpoint(port), PROJECT_A);
    expect(occupant.kind).toBe("self");
  });

  it("classifies a live non-n-dx occupant as unknown", async () => {
    const { port } = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
    const occupant = classifyPortOccupant(await probeStatusEndpoint(port), PROJECT_A);
    expect(occupant).toEqual({ kind: "unknown" });
  });
});

describe("listenerPidsOnPort", () => {
  it("names the listener and never a client connected to the same port", async (ctx) => {
    // The defect this guards: `lsof -ti tcp:<port>` lists every process holding
    // a socket on the port, clients included, and the caller took the first pid.
    // A browser tab, a curl, or a polling test worker was therefore a candidate
    // victim — and being spawned earlier put it first in line.
    const { port, listener, client } = await startListenerWithClient();

    const pids = listenerPidsOnPort(port);

    if (pids.length === 0) {
      // No usable lsof/netstat here. The query degrades to "nobody", which makes
      // killPortOccupant refuse rather than guess, so there is no whom-to-kill
      // decision left to assert.
      ctx.skip();
      return;
    }
    expect(pids).toContain(listener.pid);
    expect(pids).not.toContain(client.pid);
    expect(pids).toEqual([listener.pid]);
  }, 20_000);
});

describe("selectKillTarget", () => {
  it("names the sole listener", () => {
    expect(selectKillTarget([4242], 99)).toEqual({ pid: 4242 });
  });

  it("refuses when the query found nobody", () => {
    expect(selectKillTarget([], 99)).toEqual({ refuse: "none" });
  });

  it("refuses when this process is the listener", () => {
    expect(selectKillTarget([99], 99)).toEqual({ refuse: "self" });
  });

  it("refuses when this process is one of several listeners", () => {
    // Self-preservation outranks ambiguity: whichever pid we picked, sending a
    // signal here risks SIGKILLing the process making the decision.
    expect(selectKillTarget([4242, 99], 99)).toEqual({ refuse: "self" });
  });

  it("refuses to guess between two listeners", () => {
    // SO_REUSEPORT and pre-fork servers both produce several listening pids.
    // Killing the first is the arbitrary choice that caused this bug; a loud
    // failure leaves the operator a port flag instead of a dead process.
    expect(selectKillTarget([4242, 4243], 99)).toEqual({
      refuse: "ambiguous",
      pids: [4242, 4243],
    });
  });
});

describe("killPortOccupant", () => {
  it("kills the listener and leaves a client connected to the port alive", async () => {
    const { port, listener, client } = await startListenerWithClient();

    expect(await killPortOccupant(port)).toBe(true);

    expect(await waitForExit(listener)).toBe(true);
    expect(client.exitCode).toBeNull();
    expect(client.signalCode).toBeNull();
  }, 30_000);

  it("refuses to signal this process", async () => {
    // lsof/netstat name whoever owns the listening socket. Every in-process
    // test of the peer path binds its fake dashboard HERE, so that owner is
    // the test runner: without the guard, this call SIGKILLs the process
    // executing it and the peer test below stops being able to fail cleanly.
    //
    // If this test ever starts killing the runner, the guard was removed —
    // that is the regression it exists to catch, and it cannot be asserted
    // any more gently than by surviving the call.
    const { server, port } = await startServer(() => {});

    expect(await killPortOccupant(port)).toBe(false);
    expect(server.listening).toBe(true);
  }, 20_000);
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
    // …and this invocation was relocated to the peer's own neighbourhood
    // (requested port + 1 upward), not dropped into 3117–3200 — the peer's
    // port here is an OS-assigned ephemeral port, so it sits far outside that
    // range, and an operator-chosen port outside 3117–3200 must be honoured
    // the same way.
    const served = Number(serveArgs[1].replace("--port=", ""));
    expect(served).not.toBe(peer.port);
    expect(served).toBe(peer.port + 1);
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

describe("findRelocationPort", () => {
  // Mirrors the constants in packages/core/web.js — not exported, since the
  // orchestration tier avoids exposing more surface than callers need.
  const PORT_RANGE_START = 3117;
  const PORT_RANGE_END = 3200;
  const NEAR_WINDOW_SIZE = PORT_RANGE_END - PORT_RANGE_START;

  /**
   * Bind a port whose immediate successor is verifiably free, so the
   * relocation target is deterministic.
   *
   * Do NOT use an OS-assigned ephemeral port here. On Windows the ephemeral
   * band (49152+) is where Hyper-V/WinNAT reserve large contiguous blocks, and
   * on the CI runner every port in an 83-wide window above one read as in use
   * — so relocation correctly fell back to 3117 and an assertion about the
   * near window failed for a platform reason, not a behavioural one. Binding
   * in a quiet band and checking the successor with the product's OWN
   * predicate makes the expectation exact and platform-independent.
   *
   * Returns null when no such pair exists, which is a real answer on a host
   * whose port space is that contended — the caller skips rather than fails.
   */
  async function bindPortWithFreeSuccessor() {
    for (let candidate = 34001; candidate < 34200; candidate += 2) {
      if (await isPortInUse(candidate + 1)) continue;
      const server = createServer(() => {});
      servers.push(server);
      const bound = await new Promise((res) => {
        server.once("error", () => res(false));
        server.listen(candidate, "127.0.0.1", () => res(true));
      });
      if (!bound) continue;
      // Re-check after binding: something may have taken the successor since.
      if (await isPortInUse(candidate + 1)) continue;
      return candidate;
    }
    return null;
  }

  it("scans upward from an explicit port outside the default range", async (ctx) => {
    const port = await bindPortWithFreeSuccessor();
    if (port === null) {
      // No bindable port with a free successor on this host. Nothing to assert
      // about the near window; see bindPortWithFreeSuccessor for why.
      ctx.skip();
      return;
    }
    expect(port < PORT_RANGE_START || port > PORT_RANGE_END).toBe(true);

    // Exact, because the successor was just verified free with the same
    // predicate findFreePortInRange uses.
    const relocated = await findRelocationPort(port);
    expect(relocated).toBe(port + 1);
    // The whole point of the near window: it must not jump to the default range.
    expect(relocated < PORT_RANGE_START || relocated > PORT_RANGE_END).toBe(true);
  });

  it("keeps today's behaviour for the default port: 3118, 3119, … within 3117–3200", async () => {
    // The near window for the default port (3118–3200) is exactly the
    // default fallback range, so this must land inside it just as before
    // this function existed.
    const relocated = await findRelocationPort(PORT_RANGE_START);
    expect(relocated).not.toBeNull();
    expect(relocated).toBeGreaterThanOrEqual(PORT_RANGE_START + 1);
    expect(relocated).toBeLessThanOrEqual(PORT_RANGE_END);
  });

  it("falls back to the default range once the near window is exhausted", async () => {
    const { port } = await startServer(() => {});
    // A zero-width near window (end < start) never finds anything, forcing
    // the fallback deterministically — occupying dozens of real sockets to
    // exhaust the real near window would be slow and flaky.
    const relocated = await findRelocationPort(port, 0);
    expect(relocated).not.toBeNull();
    expect(relocated).toBeGreaterThanOrEqual(PORT_RANGE_START);
    expect(relocated).toBeLessThanOrEqual(PORT_RANGE_END);
  });

  it("clamps the near window at 65535 instead of scanning past it", async () => {
    // requestedPort + 1 (65536) is already out of range, so the near window
    // is empty and this must fall straight through to the 3117–3200 fallback
    // instead of throwing ERR_SOCKET_BAD_PORT.
    const relocated = await findRelocationPort(65535);
    expect(relocated).not.toBeNull();
    expect(relocated).toBeGreaterThanOrEqual(PORT_RANGE_START);
    expect(relocated).toBeLessThanOrEqual(PORT_RANGE_END);
  });

  it("scans up to but never past 65535 for a near-boundary port", async () => {
    // The near window would naturally extend to 65500 + 83 = 65583; it must
    // be clamped so no candidate above 65535 is ever probed.
    const relocated = await findRelocationPort(65500);
    expect(relocated).not.toBeNull();
    expect(relocated).toBeGreaterThanOrEqual(65501);
    expect(relocated).toBeLessThanOrEqual(65535);
  });
});

describe("isPortInUse", () => {
  it("treats an out-of-range port as in use instead of throwing", async () => {
    // net.createConnection throws ERR_SOCKET_BAD_PORT synchronously for a
    // port outside 0–65535; the guard must intercept it before that call.
    await expect(isPortInUse(65536)).resolves.toBe(true);
    await expect(isPortInUse(70000)).resolves.toBe(true);
    await expect(isPortInUse(-1)).resolves.toBe(true);
    await expect(isPortInUse(3117.5)).resolves.toBe(true);
  });

  it("still probes a valid port normally", async () => {
    const { server, port } = await startServer(() => {});
    await expect(isPortInUse(port)).resolves.toBe(true);
    await new Promise((res) => server.close(() => res()));
  });
});

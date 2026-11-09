/**
 * `ndx start` against a hub older than itself.
 *
 * A source-linked `ndx` runs core from source but joins a hub spawned from
 * `packages/web/dist`, which can predate it. A hub from before landing nonces
 * reports no build identity on `/api/hub/health` and, with several projects
 * registered, proxies `POST /api/auth/nonce` and answers 409. `ndx start` used
 * to print a URL with no sign-in link and tell the operator to run `ndx hub
 * stop` and start again. It now replaces that hub itself — on the same port
 * and home, with every project from `hub.json` back on its own `/p/<id>/` URL —
 * unless live work is on it, when it defers and names `--replace-hub`.
 *
 * The older hub is a separate process that answers exactly as that hub did.
 * It is this user's hub by every check `ndx start` makes — `hub.pid` in the
 * ndx home names it, and it is the one listener on the port — so `ndx start`
 * may stop it. Everything runs in a temporary ndx home on a free port: the
 * real hub this replaces it with is spawned from this checkout's
 * `packages/web/dist`, and is stopped by its own pid at the end.
 *
 * @see packages/core/web.js — ensureHub, replaceOrDeferHub, restoreHubProjects
 * @see packages/core/hub-replacement.js — the decision and its wording
 * @see tests/unit/hub-replacement.test.js — the same rules as pure functions
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { terminateTreeByPid } from "../../packages/core/child-lifecycle.js";
import {
  CLI_PATH,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  waitForPidExit,
  withSandboxedClaudeConfig,
} from "./e2e-helpers.js";

const TOKEN = "t".repeat(48);

/**
 * A hub built before landing nonces and build identity. `busy` makes each
 * project's server report one open MCP session, which a replacement would cut.
 * `extra` (JSON) is merged into its health answer: a current build that
 * reports a fault is this same process with `{ build, faults }`.
 */
const OLDER_HUB = `
const { createServer } = require("node:http");
const { appendFileSync, writeFileSync } = require("node:fs");
const [portFile, token, busy, extra] = process.argv.slice(2);
const server = createServer((req, res) => {
  // Every request, in order, for the test to read once this process is gone.
  appendFileSync(portFile + ".seen", req.method + " " + req.url + "\\n");
  const reply = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers["x-ndx-token"] !== token) return reply(401, { error: "Unauthorized" });
  req.resume();
  req.on("end", () => {
    const url = req.url.split("?")[0];
    if (req.method === "GET" && url === "/api/hub/health") {
      return reply(200, { ok: true, pid: process.pid, port: server.address().port, startedAt: new Date().toISOString(), registryPath: "hub.json", projects: 2, ...JSON.parse(extra || "{}") });
    }
    if (req.method === "POST" && url === "/api/hub/projects") {
      return reply(201, { project: { id: "omega-app", status: { state: "healthy" } } });
    }
    if (req.method === "GET" && /^\\/p\\/[^/]+\\/api\\/hench\\/execute\\/status$/.test(url)) return reply(200, { executions: [] });
    const liveWork = /^\\/p\\/([^/]+)\\/api\\/live-work$/.exec(url);
    if (req.method === "GET" && liveWork) {
      // \`busy\`: one MCP session per project. \`extra.turns[id]\`: Sidecar turns in that project's server.
      const turns = (JSON.parse(extra || "{}").turns || {})[liveWork[1]] || { worktree: 0, hub: 0 };
      if (busy !== "busy" && !JSON.parse(extra || "{}").turns) return reply(404, { error: "Not found" });
      return reply(200, { mcpSessions: { rex: busy === "busy" ? 1 : 0, sourcevision: 0 }, sidecarTurns: turns });
    }
    // A newer hub has the nonce route; an older one proxies the request and gets 409.
    if (req.method === "POST" && url === "/api/auth/nonce" && JSON.parse(extra || "{}").nonce) return reply(200, { nonce: "n0nce", expiresAt: Date.now() + 60000 });
    // The root request reached the project proxy, which cannot pick one of two.
    return reply(409, { error: "Several projects are registered; address one as /p/<id>/…" });
  });
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
  process.stdout.write(server.address().port + "\\n");
});
`;

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function makeRepo(root, id, name) {
  const repo = join(root, id);
  mkdirSync(repo);
  git(repo, "init", "--quiet", "--initial-branch=main");
  await setupRexDir(repo, { project: name });
  git(repo, "add", "-A");
  git(repo, "commit", "--quiet", "-m", "init");
  return repo;
}

function runStart(args, home) {
  return new Promise((resolvePromise) => {
    execFile("node", [CLI_PATH, "start", ...args], {
      encoding: "utf-8",
      timeout: 150_000,
      ...withSandboxedClaudeConfig({ env: { ...process.env, N_DX_HOME: home } }),
    }, (err, stdout, stderr) => resolvePromise({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
  });
}

/** Start the older hub as its own process and record it as this home's hub. */
async function startOlderHub(home, busy, extra = {}) {
  const script = join(home, "older-hub.cjs");
  const portFile = join(home, "older-hub.port");
  writeFileSync(script, OLDER_HUB);
  const child = spawn(process.execPath, [script, portFile, TOKEN, busy ? "busy" : "idle", JSON.stringify(extra)], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  // It prints its port once listening: wait for that line, or for its exit.
  const port = await new Promise((resolvePromise) => {
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("\n")) resolvePromise(Number(out.trim()) || null);
    });
    child.once("exit", () => resolvePromise(null));
  });
  if (!port) throw new Error("the older hub did not start");
  writeFileSync(join(home, "hub.pid"), JSON.stringify({ pid: child.pid, port }));
  return { child, port };
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** One authenticated JSON GET against the hub. */
async function hubGet(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { "X-Ndx-Token": TOKEN } });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Whether this sandbox lets a test listen on loopback at all. */
async function canBind() {
  return new Promise((resolvePromise) => {
    const srv = createServer();
    srv.once("error", (err) => resolvePromise(err?.code !== "EPERM"));
    srv.listen(0, "127.0.0.1", () => srv.close(() => resolvePromise(true)));
  });
}

/**
 * A temp ndx home holding the token and a `hub.json` with two projects, as
 * the older hub left them, plus a third repository to run `ndx start` in.
 */
async function fixture() {
  const home = await createTmpDir("ndx-stale-hub-home-");
  const root = realpathSync.native(await createTmpDir("ndx-stale-hub-"));
  const alpha = await makeRepo(root, "alpha-app", "Alpha App");
  const beta = await makeRepo(root, "beta-app", "Beta App");
  const omega = await makeRepo(root, "omega-app", "Omega App");
  writeFileSync(join(home, "auth.token"), `${TOKEN}\n`, { mode: 0o600 });
  const record = (id, name, repoRoot) => ({ id, name, repoRoot, worktrees: [repoRoot], port: null, pid: null, lastSeen: null });
  writeFileSync(join(home, "hub.json"), JSON.stringify({
    version: 1,
    projects: { "alpha-app": record("alpha-app", "Alpha App", alpha), "beta-app": record("beta-app", "Beta App", beta) },
  }, null, 2));
  return { home, root, omega };
}

/** Stop whatever hub this home now records, by its own pid, and its project servers with it. */
async function stopHomeHub(home) {
  try {
    const { pid } = JSON.parse(readFileSync(join(home, "hub.pid"), "utf-8"));
    if (Number.isInteger(pid) && pid !== process.pid) {
      await terminateTreeByPid(pid, { forceKillTimeoutMs: 10_000 });
      await waitForPidExit(pid, 15_000);
    }
  } catch {
    // No hub recorded.
  }
}

/** The 'Stop:' line describes 'ndx hub stop' as a command, not as a fix; everything else may not name it. */
function expectNoManualRestart(text) {
  const advice = text.split(/\r?\n/).filter((line) => !line.startsWith("Stop: ")).join("\n");
  expect(advice).not.toContain("ndx hub stop");
  expect(advice).not.toMatch(/pnpm/);
}

/** Every project from hub.json, and the one just started, is healthy on the new hub. */
async function expectProjectsServedAgain(port) {
  const projects = await hubGet(port, "/api/hub/projects");
  expect(projects.status).toBe(200);
  const states = Object.fromEntries(projects.body.projects.map((p) => [p.id, p.status.state]));
  expect(states).toMatchObject({ "alpha-app": "healthy", "beta-app": "healthy", "omega-app": "healthy" });
  // The same /p/<id>/ URL reaches each one's own server.
  for (const id of ["alpha-app", "beta-app"]) {
    const status = await hubGet(port, `/p/${id}/api/status`);
    expect(status.status, id).toBe(200);
  }
  const health = await hubGet(port, "/api/hub/health");
  expect(health.body.build).toBeTruthy();
}

describe("ndx start — a hub older than this ndx (e2e)", { timeout: 300_000 }, () => {
  let canBindPorts = true;
  beforeAll(async () => {
    canBindPorts = await canBind();
  });

  describe("with nothing live on it", () => {
    let fx;
    let older;

    beforeAll(async () => {
      if (!canBindPorts) return;
      fx = await fixture();
      older = await startOlderHub(fx.home, false);
    }, 120_000);

    afterAll(async () => {
      if (older?.child && alive(older.child.pid)) older.child.kill();
      if (fx) {
        await stopHomeHub(fx.home);
        for (const dir of [fx.home, fx.root]) await removeTmpDir(dir);
      }
    }, 120_000);

    it("replaces it on the same port, brings every project back on its URL, and prints a sign-in link", async () => {
      if (!canBindPorts) return;
      const result = await runStart([`--port=${older.port}`, fx.omega], fx.home);
      expect(result.code, result.stderr + result.stdout).toBe(0);

      expect(result.stderr).toContain(`Replacing the n-dx hub on port ${older.port}: the running n-dx hub predates this ndx`);
      expect(result.stderr).toContain("Its 2 projects come back on the same /p/<id>/ URLs.");
      expect(result.stdout).toMatch(/Serving again on port \d+: alpha-app, beta-app\./);
      expect(await waitForPidExit(older.child.pid, 15_000)).toBe(true);
      // It asked the old hub to hand its signed-in sessions over before stopping it.
      expect(readFileSync(join(fx.home, "older-hub.port.seen"), "utf-8").split("\n")).toContain("POST /api/hub/handover");

      // The new hub minted the nonce the old one had no route for.
      expect(result.stdout).toContain("ndx_nonce=");
      expect(result.stdout).not.toContain("no sign-in link");
      expectNoManualRestart(result.stdout + result.stderr);

      const pidFile = JSON.parse(readFileSync(join(fx.home, "hub.pid"), "utf-8"));
      expect(pidFile.port).toBe(older.port);
      expect(pidFile.pid).not.toBe(older.child.pid);
      await expectProjectsServedAgain(older.port);
    });
  });

  // The build this ndx would spawn, as its web package and stamp describe it.
  const webDir = join(import.meta.dirname, "../../packages/web");
  const ownBuild = () => ({
    version: JSON.parse(readFileSync(join(webDir, "package.json"), "utf-8")).version,
    sourceHash: JSON.parse(readFileSync(join(webDir, "dist", ".build-stamp.json"), "utf-8")).sourceHash,
  });

  describe.each([
    {
      name: "newer than this ndx",
      build: () => ({ ...ownBuild(), version: "999.0.0", packageRoot: webDir }),
      replaced: false,
      says: /The running n-dx hub is @n-dx\/web 999\.0\.0, newer than this ndx's [^;]+; it keeps serving\./,
    },
    {
      name: "from another checkout, same version, other source",
      build: () => ({ ...ownBuild(), sourceHash: "f".repeat(64), packageRoot: join(webDir, "..", "..", "..", "other-checkout", "packages", "web") }),
      replaced: false,
      says: /started from another checkout's @n-dx\/web \(.*other-checkout.*\), not this ndx's; it keeps serving\./,
    },
    {
      name: "an earlier build of this same checkout",
      build: () => ({ ...ownBuild(), sourceHash: "f".repeat(64), packageRoot: webDir }),
      replaced: true,
      says: /Replacing the n-dx hub on port \d+: the running n-dx hub was started from an earlier build of this checkout's @n-dx\/web/,
    },
  ])("a hub $name", ({ build, replaced, says }) => {
    let fx;
    let other;

    beforeAll(async () => {
      if (!canBindPorts) return;
      fx = await fixture();
      other = await startOlderHub(fx.home, false, { build: build(), nonce: true });
    }, 120_000);

    afterAll(async () => {
      if (other?.child && alive(other.child.pid)) other.child.kill();
      if (fx) {
        await stopHomeHub(fx.home);
        for (const dir of [fx.home, fx.root]) await removeTmpDir(dir);
      }
    }, 120_000);

    it(replaced ? "is replaced" : "is left serving, with a one-line note and no instruction", async () => {
      if (!canBindPorts) return;
      const result = await runStart([`--port=${other.port}`, fx.omega], fx.home);
      expect(result.code, result.stderr + result.stdout).toBe(0);
      expect(result.stderr).toMatch(says);
      expectNoManualRestart(result.stdout + result.stderr);
      if (replaced) {
        expect(await waitForPidExit(other.child.pid, 15_000)).toBe(true);
        await expectProjectsServedAgain(other.port);
      } else {
        expect(alive(other.child.pid)).toBe(true);
        const notes = result.stderr.split(/\r?\n/).filter((line) => line.startsWith("Note: "));
        expect(notes).toHaveLength(1);
        expect(notes[0]).not.toMatch(/ndx start|ndx hub stop|restart|pnpm|--replace-hub/i);
        expect(result.stderr).not.toContain("Replacing");
      }
    });
  });

  describe("a current build that reports a fault", () => {
    let fx;
    let older;

    beforeAll(async () => {
      if (!canBindPorts) return;
      fx = await fixture();
      // The build this ndx spawns, so only the fault can be the reason.
      const webDir = join(import.meta.dirname, "../../packages/web");
      const build = {
        version: JSON.parse(readFileSync(join(webDir, "package.json"), "utf-8")).version,
        sourceHash: JSON.parse(readFileSync(join(webDir, "dist", ".build-stamp.json"), "utf-8")).sourceHash,
      };
      older = await startOlderHub(fx.home, false, { build, faults: ["no-ndx-cli"] });
    }, 120_000);

    afterAll(async () => {
      if (older?.child && alive(older.child.pid)) older.child.kill();
      if (fx) {
        await stopHomeHub(fx.home);
        for (const dir of [fx.home, fx.root]) await removeTmpDir(dir);
      }
    }, 120_000);

    it("is replaced by a hub given the n-dx CLI, without the user restarting anything", async () => {
      if (!canBindPorts) return;
      const result = await runStart([`--port=${older.port}`, fx.omega], fx.home);
      expect(result.code, result.stderr + result.stdout).toBe(0);
      expect(result.stderr).toContain(`Replacing the n-dx hub on port ${older.port}: it has no n-dx CLI to ask about extensions.`);
      expect(await waitForPidExit(older.child.pid, 15_000)).toBe(true);
      expectNoManualRestart(result.stdout + result.stderr);
      const health = await hubGet(older.port, "/api/hub/health");
      expect(health.body.faults).toEqual([]);
      await expectProjectsServedAgain(older.port);
    });
  });

  it("a plain ndx hub stop discards any session hand-over, so it still signs every tab out", async () => {
    if (!canBindPorts) return;
    const home = await createTmpDir("ndx-handover-stop-");
    try {
      const file = join(home, "hub-sessions.handover.json");
      writeFileSync(file, "{}");
      const port = await new Promise((resolvePromise) => {
        const srv = createServer();
        srv.listen(0, "127.0.0.1", () => { const p = srv.address().port; srv.close(() => resolvePromise(p)); });
      });
      const result = await new Promise((resolvePromise) => {
        execFile("node", [CLI_PATH, "hub", "stop", `--port=${port}`], {
          encoding: "utf-8",
          ...withSandboxedClaudeConfig({ env: { ...process.env, N_DX_HOME: home } }),
        }, (err, stdout, stderr) => resolvePromise({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
      });
      expect(result.code, result.stderr).toBe(0);
      expect(existsSync(file)).toBe(false);
    } finally {
      await removeTmpDir(home);
    }
  });

  describe("with Sidecar turns in flight on it", () => {
    let fx;
    let older;

    beforeAll(async () => {
      if (!canBindPorts) return;
      fx = await fixture();
      // beta-app's own Sidecar has a turn running; alpha-app's server hosts the hub's Sidecar, also mid-turn.
      older = await startOlderHub(fx.home, false, {
        turns: { "alpha-app": { worktree: 0, hub: 1 }, "beta-app": { worktree: 1, hub: 0 } },
      });
    }, 120_000);

    afterAll(async () => {
      if (older?.child && alive(older.child.pid)) older.child.kill();
      if (fx) {
        await stopHomeHub(fx.home);
        for (const dir of [fx.home, fx.root]) await removeTmpDir(dir);
      }
    }, 120_000);

    it("defers, naming the project-scope and the hub-scope turn", async () => {
      if (!canBindPorts) return;
      const result = await runStart([`--port=${older.port}`, fx.omega], fx.home);
      expect(result.code, result.stderr + result.stdout).toBe(0);
      expect(result.stderr).toContain("would interrupt 1 Sidecar turn in progress (beta-app) and a turn in progress in the hub's Sidecar");
      expect(result.stderr).toContain("--replace-hub");
      expect(alive(older.child.pid)).toBe(true);
      expectNoManualRestart(result.stdout + result.stderr);
    });
  });

  describe("with an MCP session open on it", () => {
    let fx;
    let older;

    beforeAll(async () => {
      if (!canBindPorts) return;
      fx = await fixture();
      older = await startOlderHub(fx.home, true);
    }, 120_000);

    afterAll(async () => {
      if (older?.child && alive(older.child.pid)) older.child.kill();
      if (fx) {
        await stopHomeHub(fx.home);
        for (const dir of [fx.home, fx.root]) await removeTmpDir(dir);
      }
    }, 120_000);

    it("defers, says what is in the way and when, and names the one flag — never ndx hub stop", async () => {
      if (!canBindPorts) return;
      const result = await runStart([`--port=${older.port}`, fx.omega], fx.home);
      expect(result.code, result.stderr + result.stdout).toBe(0);

      expect(result.stderr).toContain(`The n-dx hub on port ${older.port} needs replacing: the running n-dx hub predates this ndx`);
      expect(result.stderr).toContain("would interrupt 2 open MCP sessions (alpha-app, beta-app)");
      expect(result.stderr).toContain("after that work ends");
      expect(result.stderr).toContain("--replace-hub");
      expect(alive(older.child.pid)).toBe(true);

      // Registered on the older hub as it is; its sign-in note names the flag.
      expect(result.stdout).toContain("no sign-in link: the server is older than this ndx");
      expect(result.stdout).toContain("--replace-hub");
      expectNoManualRestart(result.stdout + result.stderr);
    });

    it("replaces it anyway with --replace-hub, saying what that interrupts", async () => {
      if (!canBindPorts) return;
      const result = await runStart(["--replace-hub", `--port=${older.port}`, fx.omega], fx.home);
      expect(result.code, result.stderr + result.stdout).toBe(0);
      expect(result.stderr).toContain(`Replacing the n-dx hub on port ${older.port}`);
      expect(result.stderr).toContain("This interrupts 2 open MCP sessions (alpha-app, beta-app), as --replace-hub asked.");
      expect(await waitForPidExit(older.child.pid, 15_000)).toBe(true);
      expect(result.stdout).toContain("ndx_nonce=");
      expectNoManualRestart(result.stdout + result.stderr);
      await expectProjectsServedAgain(older.port);
    });
  });
});

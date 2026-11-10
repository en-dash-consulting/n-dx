/**
 * `ndx start` against this user's hub running in the other authentication
 * mode.
 *
 * One hub serves every project, so whether it requires the per-user token is
 * a property of the hub. `ndx start` used to refuse a hub in the other mode
 * and tell the operator to stop it with `ndx hub stop`. It now replaces the
 * hub in the mode this command asked for and brings its projects back:
 *
 * - an open hub, for a command that wants the token, becomes a token hub;
 * - a token hub becomes an open one only for a command that asked for no
 *   token (`--no-auth`) and passed `--replace-hub`, and the notice says that
 *   was the operator's choice; `--no-auth` alone joins it with the token;
 * - with an agent run live on the hub, the replacement is deferred, the
 *   project is not registered on an open hub, and `--replace-hub` forces it.
 *
 * Real hubs, spawned from this checkout's `packages/web/dist`, in a temporary
 * ndx home on a free port; the last one is stopped by its own pid.
 *
 * @see packages/core/web.js — ensureHub, replaceOrDeferHub, hubAuthMismatchMessage
 * @see packages/core/hub-replacement.js — hubAuthReason, hubReplacementNotice
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

function freePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
  });
}

function expectNoManualRestart(text) {
  const advice = text.split(/\r?\n/).filter((line) => !line.startsWith("Stop: ")).join("\n");
  expect(advice).not.toContain("ndx hub stop");
  expect(advice).not.toMatch(/pnpm/);
}

describe("ndx start — a hub in the other authentication mode (e2e)", { timeout: 300_000 }, () => {
  let home;
  let root;
  let alpha;
  let beta;
  let port;
  let canBindPorts = true;

  const runStart = (args) => new Promise((resolvePromise) => {
    execFile("node", [CLI_PATH, "start", `--port=${port}`, ...args], {
      encoding: "utf-8",
      timeout: 150_000,
      ...withSandboxedClaudeConfig({ env: { ...process.env, N_DX_HOME: home } }),
    }, (err, stdout, stderr) => resolvePromise({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
  });
  const token = () => readFileSync(join(home, "auth.token"), "utf-8").trim();
  const hubPid = () => JSON.parse(readFileSync(join(home, "hub.pid"), "utf-8")).pid;
  const get = async (path, withToken) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: withToken ? { "X-Ndx-Token": token() } : {} });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const states = async () => {
    const { body } = await get("/api/hub/projects", true);
    return Object.fromEntries(body.projects.map((p) => [p.id, p.status.state]));
  };

  beforeAll(async () => {
    try {
      port = await freePort();
    } catch (error) {
      if (error?.code === "EPERM") { canBindPorts = false; return; }
      throw error;
    }
    home = await createTmpDir("ndx-hub-auth-home-");
    root = realpathSync.native(await createTmpDir("ndx-hub-auth-"));
    alpha = await makeRepo(root, "alpha-app", "Alpha App");
    beta = await makeRepo(root, "beta-app", "Beta App");
  }, 120_000);

  afterAll(async () => {
    try {
      const pid = hubPid();
      if (pid !== process.pid) {
        await terminateTreeByPid(pid, { forceKillTimeoutMs: 10_000 });
        await waitForPidExit(pid, 15_000);
      }
    } catch {
      // No hub recorded.
    }
    for (const dir of [home, root]) if (dir) await removeTmpDir(dir);
  }, 120_000);

  it("an open hub is replaced by a token hub for a command that wants the token, keeping its projects", async () => {
    if (!canBindPorts) return;
    const open = await runStart(["--no-auth", alpha]);
    expect(open.code, open.stderr + open.stdout).toBe(0);
    expect((await get("/api/hub/health", false)).status).toBe(200);
    const openPid = hubPid();

    const result = await runStart([beta]);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stderr).toContain(`Replacing the n-dx hub on port ${port}: it runs without authentication, and this project requires the per-user token.`);
    expect(await waitForPidExit(openPid, 15_000)).toBe(true);
    expect(result.stdout).toContain("ndx_nonce=");
    expectNoManualRestart(result.stdout + result.stderr);

    // Anonymous requests are refused now; the token is accepted.
    expect((await get("/api/hub/health", false)).status).toBe(401);
    expect(await states()).toMatchObject({ "alpha-app": "healthy", "beta-app": "healthy" });
  });

  it("one --no-auth joins the token hub as it is, served with the token, and opens nobody else's project", async () => {
    if (!canBindPorts) return;
    const tokenPid = hubPid();
    const result = await runStart(["--no-auth", beta]);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stderr).toContain(`The n-dx hub on port ${port} requires the per-user token, so this project is served with it`);
    expect(result.stderr).toContain("--replace-hub");
    expect(result.stderr).not.toContain("Replacing the n-dx hub");
    // Signed in with the token the hub requires.
    expect(result.stdout).toContain("ndx_nonce=");
    expectNoManualRestart(result.stdout + result.stderr);

    expect(hubPid()).toBe(tokenPid);
    expect((await get("/api/hub/health", false)).status).toBe(401);
    expect(await states()).toMatchObject({ "alpha-app": "healthy", "beta-app": "healthy" });
  });

  it("a token hub is replaced by an open one only because --no-auth and --replace-hub asked, and the notice says so", async () => {
    if (!canBindPorts) return;
    const tokenPid = hubPid();
    const result = await runStart(["--no-auth", "--replace-hub", beta]);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stderr).toContain("it requires the per-user token, and this command asked for no authentication");
    expect(result.stderr).toContain("Because this command asked for no authentication (--no-auth, or web.auth=false) and passed --replace-hub, the new hub serves every project on it without the token.");
    expect(await waitForPidExit(tokenPid, 15_000)).toBe(true);
    expectNoManualRestart(result.stdout + result.stderr);

    expect((await get("/api/hub/health", false)).status).toBe(200);
    expect(await states()).toMatchObject({ "alpha-app": "healthy", "beta-app": "healthy" });
  });

  it("with an agent run live on the open hub, a token command defers, does not register, and never says ndx hub stop", async () => {
    if (!canBindPorts) return;
    const openPid = hubPid();
    // A live hench run in alpha: its lock names a process that is alive (this one).
    const locks = join(alpha, ".hench", "locks");
    mkdirSync(locks, { recursive: true });
    const lock = join(locks, `${process.pid}.lock`);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), taskId: "t1" }));
    try {
      const result = await runStart([beta]);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(`The n-dx hub on port ${port} needs replacing: it runs without authentication`);
      expect(result.stderr).toContain("would interrupt 1 agent run (alpha-app)");
      expect(result.stderr).toContain("--replace-hub");
      expect(result.stderr).toContain("This project was not registered");
      expectNoManualRestart(result.stdout + result.stderr);
      // Still the open hub, untouched.
      expect(hubPid()).toBe(openPid);
      expect((await get("/api/hub/health", false)).status).toBe(200);

      // The one flag replaces it now.
      const forced = await runStart(["--replace-hub", beta]);
      expect(forced.code, forced.stderr + forced.stdout).toBe(0);
      expect(forced.stderr).toContain("This interrupts 1 agent run (alpha-app), as --replace-hub asked.");
      expect(await waitForPidExit(openPid, 15_000)).toBe(true);
      expect((await get("/api/hub/health", false)).status).toBe(401);
      expect(await states()).toMatchObject({ "alpha-app": "healthy", "beta-app": "healthy" });
    } finally {
      rmSync(lock, { force: true });
    }
  });
});

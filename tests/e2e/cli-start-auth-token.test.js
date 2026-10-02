/**
 * `ndx start` requires the per-user dashboard token by default.
 *
 * Loopback is shared by every account on a host, so the hub and the project
 * servers must tell this user's browser and CLI apart from another account's
 * process. Driven through the real CLI against a real hub: `ndx start`
 * creates `<ndx home>/auth.token`, prints a URL that carries it once, and
 * the hub answers 401 to anything that does not present it. `ndx start stop`
 * must still work, because the CLI sends the token on its own probes.
 *
 * The hub's home is redirected with $N_DX_HOME so nothing touches ~/.ndx.
 *
 * @see packages/core/web.js — resolveStartToken, hubRequest
 * @see packages/web/src/hub/request-guard.ts — enforceHubToken
 * @see tests/e2e/cli-start-hub.test.js — the same harness, with --no-auth
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_PATH,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
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

function findAvailablePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
    srv.on("error", reject);
  });
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe("ndx start — per-user token (e2e)", { timeout: 180_000 }, () => {
  let home;
  let tmpRoot;
  let repo;
  let hubPort;
  let canBindPorts = true;

  function runStart(args) {
    try {
      const stdout = execFileSync("node", [CLI_PATH, "start", ...args], {
        encoding: "utf-8",
        timeout: 120_000,
        stdio: "pipe",
        ...withSandboxedClaudeConfig({ env: { ...process.env, N_DX_HOME: home } }),
      });
      return { stdout, stderr: "", code: 0 };
    } catch (err) {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.status ?? 1 };
    }
  }

  beforeAll(async () => {
    home = await createTmpDir("ndx-start-auth-home-");
    tmpRoot = realpathSync.native(await createTmpDir("ndx-start-auth-"));
    repo = join(tmpRoot, "gamma-app");
    mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    await setupRexDir(repo, { project: "Gamma App" });
    await setupSourcevisionDir(repo);
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");
    try {
      hubPort = await findAvailablePort();
    } catch (error) {
      if (error && error.code === "EPERM") canBindPorts = false;
      else throw error;
    }
  }, 60_000);

  afterAll(async () => {
    const pids = [];
    try {
      const pidFile = JSON.parse(await readFile(join(home, "hub.pid"), "utf-8"));
      if (typeof pidFile?.pid === "number") pids.push(pidFile.pid);
    } catch {
      // no hub was started
    }
    for (const pid of pids) {
      if (!isAlive(pid)) continue;
      try { process.kill(pid, "SIGTERM"); } catch {}
      if (!(await waitForPidExit(pid, 15_000))) {
        try { process.kill(pid, "SIGKILL"); } catch {}
        await waitForPidExit(pid, 2_000);
      }
    }
    for (const dir of [home, tmpRoot]) if (dir) await removeTmpDir(dir);
  }, 60_000);

  it("creates the token, prints a URL that carries it, and the hub refuses requests without it", async () => {
    if (!canBindPorts) return;
    const result = runStart([`--port=${hubPort}`, repo]);
    expect(result.code, result.stderr + result.stdout).toBe(0);

    const tokenFile = join(home, "auth.token");
    const token = (await readFile(tokenFile, "utf-8")).trim();
    expect(token.length).toBeGreaterThanOrEqual(32);
    if (process.platform !== "win32") expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);

    // The printed URL carries the token once; the MCP lines carry the header.
    expect(result.stdout).toContain(`http://localhost:${hubPort}/p/gamma-app/?ndx_token=${encodeURIComponent(token)}`);
    expect(result.stdout).toContain(`--header "X-Ndx-Token: $(cat ${tokenFile})"`);

    const base = `http://127.0.0.1:${hubPort}`;
    expect((await fetch(`${base}/api/hub/health`)).status).toBe(401);
    expect((await fetch(`${base}/p/gamma-app/api/status`)).status).toBe(401);
    expect((await fetch(`${base}/api/hub/health`, { headers: { "X-Ndx-Token": token } })).status).toBe(200);

    // Through the proxy to the project server, which was started with the same token.
    const served = await fetch(`${base}/p/gamma-app/api/status`, { headers: { Cookie: `ndx_token=${token}` } });
    expect(served.status).toBe(200);
    expect((await served.json()).projectDir).toBe(repo);

    // The one-time URL sets the cookie and redirects to the clean URL.
    const redirect = await fetch(`${base}/p/gamma-app/?ndx_token=${encodeURIComponent(token)}`, { redirect: "manual" });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/p/gamma-app/");
    expect(redirect.headers.get("set-cookie")).toContain("ndx_token=");
  });

  it("ndx start status and stop still work: the CLI sends the token itself", async () => {
    if (!canBindPorts) return;
    const status = runStart(["status", repo]);
    expect(status.code, status.stderr + status.stdout).toBe(0);
    expect(status.stdout).toContain("gamma-app");

    const stop = runStart(["stop", repo]);
    expect(stop.code, stop.stderr + stop.stdout).toBe(0);
  });
});

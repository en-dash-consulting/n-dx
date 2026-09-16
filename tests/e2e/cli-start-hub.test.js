/**
 * `ndx start --hub` registers a repository with the per-user hub.
 *
 * Driven through the real CLI against a real hub and real project servers:
 * a temp repository with a linked worktree, started *from the worktree*, must
 * register the main checkout as repoRoot and list the worktree under it; a
 * second repository must register beside it on the same hub port with no
 * collision, and both project URLs must answer for their own directory.
 *
 * The hub's home is redirected with $N_DX_HOME so nothing touches ~/.n-dx.
 *
 * @see packages/core/web.js — runHubMode
 * @see packages/web/src/hub — the hub under test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_PATH,
  DEFAULT_TIMEOUT,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
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

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe("ndx start --hub (e2e)", { timeout: 180_000 }, () => {
  let home;
  let tmpRoot;
  let repoA;
  let worktreeA;
  let repoB;
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
    home = await createTmpDir("ndx-start-hub-home-");
    tmpRoot = realpathSync.native(await createTmpDir("ndx-start-hub-"));

    repoA = join(tmpRoot, "alpha-app");
    mkdirSync(repoA);
    git(repoA, "init", "--quiet", "--initial-branch=main");
    await setupRexDir(repoA, { project: "Alpha App" });
    await setupSourcevisionDir(repoA);
    git(repoA, "add", "-A");
    git(repoA, "commit", "--quiet", "-m", "init");
    worktreeA = join(tmpRoot, "alpha-feature");
    git(repoA, "worktree", "add", "--quiet", "-b", "feature", worktreeA);

    repoB = join(tmpRoot, "beta-app");
    mkdirSync(repoB);
    git(repoB, "init", "--quiet", "--initial-branch=main");
    await setupRexDir(repoB, { project: "Beta App" });
    await setupSourcevisionDir(repoB);
    git(repoB, "commit", "--allow-empty", "--quiet", "-m", "init");

    try {
      hubPort = await findAvailablePort();
    } catch (error) {
      if (error && error.code === "EPERM") canBindPorts = false;
      else throw error;
    }
  }, 60_000);

  afterAll(async () => {
    // Stop the hub (and, through its SIGTERM handler, every project server).
    try {
      const pidFile = JSON.parse(await readFile(join(home, "hub.pid"), "utf-8"));
      if (pidFile?.pid && isAlive(pidFile.pid)) {
        process.kill(pidFile.pid, "SIGTERM");
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline && isAlive(pidFile.pid)) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    } catch {
      // no hub was started
    }
    for (const dir of [home, tmpRoot]) if (dir) await removeTmpDir(dir);
  }, 30_000);

  it("started from a linked worktree, registers the main checkout and lists the worktree", async () => {
    if (!canBindPorts) return;
    const result = runStart(["--hub", `--port=${hubPort}`, worktreeA]);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain(`http://localhost:${hubPort}/p/alpha-app/`);
    expect(result.stdout).toContain(`/p/alpha-app/mcp/rex`);
    expect(result.stdout).toContain("n-dx hub started");

    const { status, body } = await getJson(`http://127.0.0.1:${hubPort}/api/hub/projects`);
    expect(status).toBe(200);
    const alpha = body.projects.find((p) => p.id === "alpha-app");
    expect(alpha).toBeDefined();
    expect(alpha.name).toBe("Alpha App");
    expect(alpha.repoRoot).toBe(repoA);
    expect(alpha.worktrees).toEqual([repoA, worktreeA]);
    expect(alpha.status.state).toBe("healthy");

    const served = await getJson(`http://127.0.0.1:${hubPort}/p/alpha-app/api/status`);
    expect(served.status).toBe(200);
    expect(served.body.projectDir).toBe(repoA);
  });

  it("a second repository registers beside the first; both URLs answer for their own directory", async () => {
    if (!canBindPorts) return;
    const result = runStart(["--hub", `--port=${hubPort}`, repoB]);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).not.toContain("n-dx hub started"); // reused the running hub
    expect(result.stdout).toContain(`/p/beta-app/`);

    const { body } = await getJson(`http://127.0.0.1:${hubPort}/api/hub/projects`);
    expect(body.projects.map((p) => p.id).sort()).toEqual(["alpha-app", "beta-app"]);

    const a = await getJson(`http://127.0.0.1:${hubPort}/p/alpha-app/api/status`);
    const b = await getJson(`http://127.0.0.1:${hubPort}/p/beta-app/api/status`);
    expect(a.body.projectDir).toBe(repoA);
    expect(b.body.projectDir).toBe(repoB);

    // Two projects: the root is ambiguous, not a collision.
    expect((await getJson(`http://127.0.0.1:${hubPort}/api/status`)).status).toBe(409);
  });

  it("re-running for a registered project is idempotent", async () => {
    if (!canBindPorts) return;
    const before = (await getJson(`http://127.0.0.1:${hubPort}/api/hub/projects`)).body.projects.find((p) => p.id === "alpha-app");
    const result = runStart(["--hub", `--port=${hubPort}`, repoA]);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("already known");
    const after = (await getJson(`http://127.0.0.1:${hubPort}/api/hub/projects`)).body.projects.find((p) => p.id === "alpha-app");
    expect(after.pid).toBe(before.pid);
    expect(after.worktrees).toEqual([repoA, worktreeA]);
  });

  it("--here still starts the single-project server on the requested port", async () => {
    if (!canBindPorts) return;
    const herePort = await findAvailablePort();
    const result = runStart(["--here", "--background", `--port=${herePort}`, repoB]);
    expect(result.code, result.stderr + result.stdout).toBe(0);
    try {
      const status = await getJson(`http://127.0.0.1:${herePort}/api/status`);
      expect(status.status).toBe(200);
      expect(status.body.projectDir).toBe(repoB);
      expect(result.stdout).toContain(`http://localhost:${herePort}`);
      expect(result.stdout).not.toContain("/p/");
    } finally {
      runStart(["stop", repoB]);
    }
  });
});

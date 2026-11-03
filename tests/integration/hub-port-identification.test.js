/**
 * `ndx start`, `ndx start status` and `ndx start stop` identify the listener
 * on the hub port before sending it the per-user token.
 *
 * The hub port is well known and a project's hub marker file names a port of
 * its own, so whatever answers there must be shown to be this user's hub —
 * the pid recorded in the 0700 ndx home, alive, this user's, and the sole
 * listener — before any request carries the token. A stub that answers every
 * request 401 with the n-dx realm stands in for an unidentified listener and
 * records every header it is sent.
 *
 * @see packages/core/web.js — identifyOwnHub, credentialedHubRequest, markerHubRequest
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_PATH,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
  withSandboxedClaudeConfig,
} from "../e2e/e2e-helpers.js";
import { identifyTokenTarget } from "../../packages/core/web.js";

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function findAvailablePort() {
  return new Promise((resolvePromise, reject) => {
    const srv = createNetServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolvePromise(port));
    });
    srv.on("error", reject);
  });
}

/** A listener that answers like a token-protected n-dx server and keeps every request's headers. */
function startStub() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: { ...req.headers } });
    res.writeHead(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer realm="n-dx"',
    });
    res.end(JSON.stringify({ error: "Authentication required" }));
  });
  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise({ server, port: server.address().port, seen }));
  });
}

const credentialed = (seen) => seen.filter((r) => r.headers["x-ndx-token"] !== undefined || r.headers["authorization"] !== undefined);

describe("hub port identification before the token is sent", { timeout: 120_000 }, () => {
  let home;
  let tmpRoot;
  let repo;
  let stub;
  let otherPort;
  let canBindPorts = true;

  /** Asynchronous on purpose: the stub answers from this process's event loop, which a sync exec would block. */
  function runStart(args) {
    return new Promise((resolvePromise) => {
      execFile(
        "node",
        [CLI_PATH, "start", ...args],
        { encoding: "utf-8", timeout: 60_000, ...withSandboxedClaudeConfig({ env: { ...process.env, N_DX_HOME: home } }) },
        (err, stdout, stderr) => resolvePromise({ stdout: stdout ?? "", stderr: stderr ?? "", code: err ? (err.code ?? 1) : 0 }),
      );
    });
  }

  function writeMarker(port) {
    writeFileSync(join(repo, ".n-dx-web.pid"), JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString(), via: "hub", projectId: "delta-app" }));
    writeFileSync(join(repo, ".n-dx-web.port"), `${port}\n`);
  }

  function configureHubPort(port) {
    writeFileSync(join(home, "config.json"), JSON.stringify({ hub: { port } }));
  }

  beforeAll(async () => {
    home = await createTmpDir("ndx-hub-ident-home-");
    tmpRoot = realpathSync.native(await createTmpDir("ndx-hub-ident-"));
    repo = join(tmpRoot, "delta-app");
    mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    await setupRexDir(repo, { project: "Delta App" });
    await setupSourcevisionDir(repo);
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");
    // A token that exists is the thing that must not leave this home.
    writeFileSync(join(home, "auth.token"), "secret-token-that-must-stay-home\n", { mode: 0o600 });
    try {
      stub = await startStub();
      otherPort = await findAvailablePort();
    } catch (error) {
      if (error && error.code === "EPERM") canBindPorts = false;
      else throw error;
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise((r) => (stub ? stub.server.close(() => r()) : r()));
    for (const dir of [home, tmpRoot]) if (dir) await removeTmpDir(dir);
  }, 30_000);

  it("ndx start refuses a 401 listener on the hub port without sending it the token", async () => {
    if (!canBindPorts) return;
    configureHubPort(stub.port);
    const result = await runStart([repo]);
    expect(result.code, result.stdout + result.stderr).not.toBe(0);
    expect(result.stderr).toMatch(/not this user's n-dx hub|held by another process/);
    expect(stub.seen.length, "the anonymous probe is allowed").toBeGreaterThan(0);
    expect(credentialed(stub.seen)).toEqual([]);
  });

  it("status and stop on a marker naming the hub port send nothing credentialed to a stranger there", async () => {
    if (!canBindPorts) return;
    configureHubPort(stub.port);
    writeMarker(stub.port);
    const before = stub.seen.length;

    const status = await runStart(["status", repo]);
    expect(status.code, status.stderr).toBe(0);
    expect(status.stdout).toMatch(/Nothing was sent to it/);

    writeMarker(stub.port);
    const stop = await runStart(["stop", repo]);
    expect(stop.code, stop.stderr).toBe(0);
    expect(stop.stdout).toMatch(/nothing was sent/);

    expect(stub.seen.slice(before), "an unidentified listener gets no request at all").toEqual([]);
    expect(credentialed(stub.seen)).toEqual([]);
  });

  it("a marker naming a port other than the hub port is never probed with the token", async () => {
    if (!canBindPorts) return;
    configureHubPort(otherPort);
    writeMarker(stub.port);
    const before = stub.seen.length;

    const status = await runStart(["status", repo]);
    expect(status.code, status.stderr).toBe(0);
    expect(status.stdout).toMatch(/is not this user's hub port/);

    writeMarker(stub.port);
    const stop = await runStart(["stop", repo]);
    expect(stop.code, stop.stderr).toBe(0);

    expect(stub.seen.slice(before)).toEqual([]);
    expect(credentialed(stub.seen)).toEqual([]);
  });

  it("refresh's live reload and the MCP shim refuse a marker port that is not identified", async () => {
    if (!canBindPorts) return;
    // The helper both of them consult before attaching the token.
    configureHubPort(stub.port);
    const asHub = await identifyTokenTarget(stub.port, null, { home });
    expect(asHub.ok).toBe(false);
    configureHubPort(otherPort);
    const asDashboard = await identifyTokenTarget(stub.port, repo, { home });
    expect(asDashboard.ok).toBe(false);
  });
});

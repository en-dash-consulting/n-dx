/**
 * The MCP shim finds a hub that requires the per-user token.
 *
 * A token hub refuses every anonymous `/api/hub/*` request with 401, so a
 * shim that probed health anonymously never bridged when auth was on: it read
 * the 401 as "no hub" and served in-process. The shim now identifies the
 * listener as this user's hub first and asks for health with the token.
 *
 * The hub here is a small server in this process that answers like a token
 * hub. `hub.pid` in a temporary ndx home names this process, which is the
 * sole listener on the port, so identification passes exactly as it would
 * for the real hub.
 *
 * @see packages/core/mcp-shim.js — resolveHubTarget
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTmpDir, removeTmpDir } from "../e2e/e2e-helpers.js";
import { resolveHubTarget } from "../../packages/core/mcp-shim.js";

const TOKEN = "shim-token-for-the-test-hub";

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

describe("resolveHubTarget against a hub that requires the token", { timeout: 60_000 }, () => {
  let home;
  let root;
  let repo;
  let server;
  let port;
  let seen;
  let canBindPorts = true;
  const savedEnv = {};

  beforeAll(async () => {
    home = await createTmpDir("ndx-shim-token-home-");
    root = realpathSync.native(await createTmpDir("ndx-shim-token-"));
    repo = join(root, "token-app");
    mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    writeFileSync(join(repo, "README.md"), "token app\n");
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");

    seen = [];
    server = createServer((req, res) => {
      const token = req.headers["x-ndx-token"];
      seen.push({ url: req.url, token: token ?? null });
      if (token !== TOKEN) {
        res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="n-dx"' });
        res.end(JSON.stringify({ error: "Authentication required" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid, registryPath: join(home, "hub.json"), projects: 1 }));
    });
    try {
      port = await new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
      });
    } catch (err) {
      if (err && err.code === "EPERM") canBindPorts = false;
      else throw err;
    }

    for (const key of ["NDX_HOME", "N_DX_HOME"]) savedEnv[key] = process.env[key];
    process.env.NDX_HOME = home;
    delete process.env.N_DX_HOME;

    writeFileSync(join(home, "auth.token"), `${TOKEN}\n`, { mode: 0o600 });
    writeFileSync(join(home, "config.json"), JSON.stringify({ hub: { port } }));
    writeFileSync(join(home, "hub.json"), JSON.stringify({
      projects: { "token-app": { id: "token-app", repoRoot: realpathSync.native(repo) } },
    }));
  }, 60_000);

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((r) => (server ? server.close(() => r()) : r()));
    for (const dir of [home, root]) if (dir) await removeTmpDir(dir);
  }, 30_000);

  beforeEach(() => {
    seen.length = 0;
  });

  it("bridges once the listener is identified as this user's hub", async () => {
    if (!canBindPorts) return;
    writeFileSync(join(home, "hub.pid"), JSON.stringify({ pid: process.pid, port }));

    const target = await resolveHubTarget("rex", repo);

    expect(target, `requests: ${JSON.stringify(seen)}`).not.toBeNull();
    expect(target.url).toBe(`http://127.0.0.1:${port}/p/token-app/mcp/rex`);
    // The health check that decided it carried the token.
    expect(seen.some((r) => r.url === "/api/hub/health" && r.token === TOKEN)).toBe(true);
  });

  it("sends no token and serves in-process when the listener is not identified", async () => {
    if (!canBindPorts) return;
    rmSync(join(home, "hub.pid"), { force: true });

    const target = await resolveHubTarget("rex", repo);

    expect(target).toBeNull();
    expect(seen.length, "the anonymous reachability probe is allowed").toBeGreaterThan(0);
    expect(seen.filter((r) => r.token !== null)).toEqual([]);
  });
});

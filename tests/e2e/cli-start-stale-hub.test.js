/**
 * `ndx start` against a hub older than itself.
 *
 * A source-linked `ndx` runs core from source but joins a hub spawned from
 * `packages/web/dist`, which can predate it. A hub from before landing nonces
 * reports no build identity on `/api/hub/health` and, with several projects
 * registered, proxies `POST /api/auth/nonce` and answers 409. `ndx start` used
 * to print a URL with no sign-in link and advice that could not fix it.
 *
 * The hub here is a fake in this process that answers exactly as that older
 * hub did. It is this user's hub by every check `ndx start` makes before it
 * sends the token — `hub.pid` in the ndx home names this process, which is the
 * one listener on the port — so the CLI talks to it as it would to the real
 * one. The CLI is spawned asynchronously so this process can keep answering.
 *
 * @see packages/core/web.js — runHubMode, hubBuildMismatch, noNonceNote, serverRefreshFix
 * @see tests/unit/web-stale-server.test.js — the same rules as pure functions
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_PATH,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  withSandboxedClaudeConfig,
} from "./e2e-helpers.js";

const TOKEN = "t".repeat(48);

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** A hub built before landing nonces and build identity, holding two projects. */
function olderHub() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const reply = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-ndx-token"] !== TOKEN) return reply(401, { error: "Unauthorized" });
    req.resume();
    req.on("end", () => {
      if (req.method === "GET" && req.url === "/api/hub/health") {
        return reply(200, { ok: true, pid: process.pid, port: server.address().port, startedAt: new Date().toISOString(), registryPath: "hub.json", projects: 2 });
      }
      if (req.method === "POST" && req.url === "/api/hub/projects") {
        return reply(201, { project: { id: "omega-app", status: { state: "healthy" } } });
      }
      // The root request reached the project proxy, which cannot pick one of two.
      return reply(409, { error: "Several projects are registered; address one as /p/<id>/…" });
    });
  });
  return { server, seen };
}

function runStart(args, home) {
  return new Promise((resolvePromise) => {
    execFile("node", [CLI_PATH, "start", ...args], {
      encoding: "utf-8",
      timeout: 120_000,
      ...withSandboxedClaudeConfig({ env: { ...process.env, N_DX_HOME: home } }),
    }, (err, stdout, stderr) => resolvePromise({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
  });
}

describe("ndx start — a hub older than this ndx (e2e)", { timeout: 180_000 }, () => {
  let home;
  let tmpRoot;
  let repo;
  let hub;
  let port;
  let canBindPorts = true;

  beforeAll(async () => {
    home = await createTmpDir("ndx-stale-hub-home-");
    tmpRoot = realpathSync.native(await createTmpDir("ndx-stale-hub-"));
    repo = join(tmpRoot, "omega-app");
    mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    await setupRexDir(repo, { project: "Omega App" });
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");

    hub = olderHub();
    try {
      await new Promise((resolvePromise, reject) => {
        hub.server.once("error", reject);
        hub.server.listen(0, "127.0.0.1", resolvePromise);
      });
    } catch (error) {
      if (error && error.code === "EPERM") { canBindPorts = false; return; }
      throw error;
    }
    port = hub.server.address().port;
    writeFileSync(join(home, "auth.token"), `${TOKEN}\n`, { mode: 0o600 });
    writeFileSync(join(home, "hub.pid"), JSON.stringify({ pid: process.pid, port }));
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolvePromise) => (hub?.server.listening ? hub.server.close(resolvePromise) : resolvePromise()));
    for (const dir of [home, tmpRoot]) if (dir) await removeTmpDir(dir);
  }, 60_000);

  it("names the older hub, and a fix that works, instead of a URL with no explanation", async () => {
    if (!canBindPorts) return;
    const result = await runStart([`--port=${port}`, repo], home);
    expect(result.code, result.stderr + result.stdout).toBe(0);

    // It did ask for a nonce, and got the older hub's 409.
    expect(hub.seen).toContain("POST /api/auth/nonce");
    expect(result.stdout).not.toContain("ndx_nonce=");

    // The sign-in note says why and what fixes it — not "run 'ndx start' again".
    expect(result.stdout).toContain("no sign-in link: the server is older than this ndx");
    expect(result.stdout).toContain("'ndx hub stop', then 'ndx start'");
    expect(result.stdout).not.toContain("could not get a sign-in link");

    // The build comparison named the hub before that, from its health answer.
    expect(result.stderr).toContain("the running n-dx hub predates this ndx");
  });
});

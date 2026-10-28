/**
 * REQUIRED TEST — the extensions contract across every process boundary.
 *
 * The fixture package in tests/e2e/fixture-extension/ (one command, one
 * sidecar, one project link, a config schema) is copied to a temp directory
 * and listed in `extensions.paths`, the development source, of an n-dx home
 * of the test's own. It is then driven only through the real CLI and a real
 * hub started by `ndx start`: discovery, approval, dispatch, the environment
 * contract, config, help, the sidecar launch and proxy, the hub API, the hub
 * home and `ndx hub stop`. Every acceptance criterion of the extensions epic
 * (docs/architecture/extensions.md, "PRD capture") that a process boundary
 * can show is asserted here.
 *
 * Left to in-process suites, because showing them through processes costs
 * minutes or needs a starved machine: idle stop, the 20 s health timeout's
 * 503, crash backoff and the memory floor
 * (packages/web/tests/integration/hub-sidecars.test.ts); manifest rules,
 * source precedence and the help timing budget (tests/unit/extension-*.test.js).
 *
 * Required on every change to dispatch, the hub proxy or discovery:
 * scripts/lib/select-suites.mjs selects it for the hub files, and core
 * changes run the whole root suite.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import {
  CLI_PATH,
  DEFAULT_TIMEOUT,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
  waitForPidExit,
  withSandboxedClaudeConfig,
} from "./e2e-helpers.js";

const FIXTURE = join(import.meta.dirname, "fixture-extension");
const PROJECT_ID = "fixture-app";

let root;
let home;
let extensionDir;
let workDir;

beforeAll(async () => {
  root = realpathSync.native(await createTmpDir("ndx-e2e-extension-fixture-"));
  home = join(root, "home");
  extensionDir = join(root, "fixture-extension");
  workDir = join(root, "work");
  for (const dir of [home, workDir]) mkdirSync(dir, { recursive: true });
  cpSync(FIXTURE, extensionDir, { recursive: true });
  // The memory floor is the hub's to enforce, and an in-process suite covers
  // it; here it would only make a loaded runner refuse the sidecar.
  writeJson(join(home, "config.json"), { extensions: { paths: [extensionDir] }, hub: { memoryFloorBytes: 0 } });
});

afterAll(async () => {
  if (root) await removeTmpDir(root);
});

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));

/** The test's own n-dx home; NDX_HOME cleared so the session's never leaks in. */
const env = () => ({ ...process.env, N_DX_HOME: home, NDX_HOME: "" });

/** Run the CLI, keeping stdout, stderr and the exit code whatever happens. */
function ndx(args, { cwd = workDir } = {}) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    windowsHide: true,
    ...withSandboxedClaudeConfig({ cwd, env: env() }),
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.status };
}

/** Run the CLI and require exit 0. */
function ndxOk(args, options) {
  const result = ndx(args, options);
  expect(result.code, `ndx ${args.join(" ")}\n${result.stderr}${result.stdout}`).toBe(0);
  return result.stdout;
}

/** The fixture command's JSON report: the first line it prints. */
const report = (stdout) => JSON.parse(stdout.split("\n")[0]);

const listed = () => JSON.parse(ndxOk(["extensions", "list", "--json"])).extensions.find((e) => e.name === "fixture");

/** The modules of the fixture that have run, in order. */
function loadedModules() {
  const log = join(extensionDir, "loaded.log");
  return existsSync(log) ? readFileSync(log, "utf-8").trim().split("\n") : [];
}

describe("the fixture extension through the CLI", () => {
  it("discovery finds it in the development source, unapproved, and runs none of its code", () => {
    expect(listed()).toMatchObject({ name: "fixture", version: "1.0.0", source: "dev", state: "unapproved" });
    expect(ndxOk(["extensions", "info", "fixture"])).toContain("ndx-fixture-extension");
    expect(ndx(["extensions", "doctor"]).stdout).not.toMatch(/fixture.*fix:/);
    expect(ndxOk(["--help"])).not.toContain("EXTENSIONS");
    expect(ndx(["extensions", "sidecar", "fixture", "--json"]).code).toBe(2);
    expect(loadedModules()).toEqual([]);
  });

  it("an unapproved command exits 2 naming enable, and runs nothing", () => {
    const result = ndx(["fixture"]);
    expect(result.code).toBe(2);
    expect(result.stderr.trim()).toMatch(/^Error: 'ndx fixture' comes from .* — fix: ndx extensions enable fixture$/);
    expect(loadedModules()).toEqual([]);
  });

  it("enable --yes approves it, and ndx --help lists its command with the summary", () => {
    ndxOk(["extensions", "enable", "fixture", "--yes"]);
    expect(listed().state).toBe("enabled");
    const help = ndxOk(["--help"]);
    const section = help.slice(help.indexOf("EXTENSIONS"));
    expect(section).toMatch(/^EXTENSIONS\n {2}fixture +Report what n-dx handed the fixture extension\n/);
    expect(loadedModules()).toEqual([]);
  });

  for (const code of [0, 1, 7]) {
    it(`runs the bin with the remaining args on n-dx's Node, in the caller's directory, and exits ${code}`, () => {
      const result = ndx(["fixture", "exit", String(code), "--flag"]);
      expect(result.code).toBe(code);
      const out = report(result.stdout);
      expect(out.args).toEqual(["exit", String(code), "--flag"]);
      expect(out.execPath).toBe(process.execPath);
      expect(realpathSync.native(out.cwd)).toBe(workDir);
    });
  }

  it("hands it the environment contract, with a state folder created on first run", () => {
    const out = report(ndxOk(["fixture"]));
    const stateDir = join(home, "ext", "fixture");
    expect(out.env).toMatchObject({
      NDX_EXTENSION_API: "1",
      NDX_BIN: realpathSync(CLI_PATH),
      NDX_HOME: home,
      NDX_EXTENSION_NAME: "fixture",
      NDX_EXTENSION_STATE_DIR: stateDir,
      NDX_EXTENSION_CONFIG: expect.stringMatching(/[\\/]ndx-config-\d+-[0-9a-f]+\.json$/),
    });
    expect(out.env.NDX_VERSION).toBe(ndxOk(["version"]).trim());
    expect(out.stateDirExists).toBe(true);
    expect(out.env).not.toHaveProperty("NDX_HUB_URL");
    expect(loadedModules()).toContain("cli");
    expect(loadedModules()).not.toContain("index");
  });

  it("ndx fixture --help is passed through to the extension", () => {
    const result = ndx(["fixture", "--help"]);
    expect(result.code).toBe(0);
    expect(report(result.stdout).args).toEqual(["--help"]);
  });

  it("writes its config section through ndx config, checked against its schema, and hands it over merged", () => {
    ndxOk(["config", "extensions.fixture.greeting", "hello", "--user"]);
    expect(report(ndxOk(["fixture"])).config).toEqual({ greeting: "hello" });
    ndxOk(["config", "extensions.fixture.greeting", "hi"], { cwd: workDir });
    expect(report(ndxOk(["fixture"])).config).toEqual({ greeting: "hi" });

    const refused = ndx(["config", "extensions.fixture.colour", "red"]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('must not have the property "colour"');
  });

  it("a changed manifest asks again before the next run", () => {
    const manifestPath = join(extensionDir, "package.json");
    const original = readFileSync(manifestPath, "utf-8");
    const pkg = JSON.parse(original);
    pkg.version = "1.0.1";
    writeJson(manifestPath, pkg);
    try {
      expect(listed().state).toBe("unapproved");
      expect(ndx(["fixture"]).code).toBe(2);
    } finally {
      writeFileSync(manifestPath, original);
    }
    expect(listed().state).toBe("enabled");
  });

  it("disable hides it: its name is an unknown command with a hint, and help drops it", () => {
    ndxOk(["extensions", "disable", "fixture"]);
    try {
      const result = ndx(["fixture"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/Unknown command: fixture/);
      expect(result.stderr).toMatch(/Hint: extension fixture .* is disabled: .*'ndx extensions enable fixture'/);
      expect(ndxOk(["--help"])).not.toContain("EXTENSIONS");
    } finally {
      ndxOk(["extensions", "enable", "fixture", "--yes"]);
    }
    expect(listed().state).toBe("enabled");
  });

  it.skipIf(process.platform === "win32")("forwards SIGTERM and passes the extension's exit code through", async () => {
    const child = spawn(process.execPath, [CLI_PATH, "fixture", "wait"], { cwd: workDir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      // The fixture installs its handler before publishing this report.
      if (stdout.includes("\n") && !child.killed) child.kill("SIGTERM");
    });
    const code = await new Promise((resolve) => child.on("close", resolve));
    expect(stdout).toContain("got SIGTERM");
    expect(code).toBe(7);
  });
});

// ── behind the hub ────────────────────────────────────────────────────────────

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/**
 * One HTTP request to the hub on a fresh connection. No keep-alive pool, so a
 * socket the hub closed between tests is never reused (see cli-start-hub).
 */
function hubRequest(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers, agent: false }, (res) => {
      let text = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    if (body !== undefined) {
      req.setHeader("Content-Type", "application/json");
      req.end(JSON.stringify(body));
    } else {
      req.end();
    }
  });
}

/** A WebSocket handshake through the hub; resolves to everything it sent back. */
function upgradeThroughHub(port, path, headers) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => {
      const lines = [
        `GET ${path} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      ];
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
    });
    let text = "";
    socket.setEncoding("utf-8");
    socket.on("data", (chunk) => { text += chunk; });
    socket.on("end", () => resolve(text));
    socket.on("error", reject);
  });
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("the fixture extension behind the hub", { timeout: 180_000 }, () => {
  let repo;
  let port;
  let token;
  let canBindPorts = true;
  /** Every sidecar pid seen, for the sweep in afterAll. */
  const sidecarPids = new Set();

  const auth = () => ({ "X-Ndx-Token": token });
  const get = (path, headers = auth()) => hubRequest(port, path, { headers });
  const getJson = async (path) => {
    const res = await get(path);
    return { status: res.status, body: JSON.parse(res.text) };
  };

  /** A request echoed by the sidecar; records its pid. */
  async function echo(path = "/x/fixture/echo", headers = auth()) {
    const res = await get(path, headers);
    expect(res.status, res.text).toBe(200);
    const body = JSON.parse(res.text);
    sidecarPids.add(body.pid);
    return body;
  }

  const fixtureView = async (query = "") =>
    (await getJson(`/api/hub/extensions${query}`)).body.extensions.find((e) => e.name === "fixture");

  beforeAll(async () => {
    try {
      port = await findAvailablePort();
    } catch (error) {
      if (error?.code === "EPERM") {
        canBindPorts = false;
        return;
      }
      throw error;
    }
    repo = join(root, PROJECT_ID);
    mkdirSync(repo);
    git(repo, "init", "--quiet", "--initial-branch=main");
    await setupRexDir(repo, { project: "Fixture App" });
    await setupSourcevisionDir(repo);
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");

    const started = ndx(["start", "--hub", `--port=${port}`, repo], { cwd: repo });
    expect(started.code, started.stderr + started.stdout).toBe(0);
    token = readFileSync(join(home, "auth.token"), "utf-8").trim();
  }, 120_000);

  afterAll(async () => {
    if (!canBindPorts) return;
    const pids = [...sidecarPids];
    try {
      const { body } = await getJson("/api/hub/projects");
      for (const p of body.projects ?? []) if (typeof p.pid === "number") pids.push(p.pid);
    } catch {
      // the hub has already stopped — the last test stops it
    }
    if (existsSync(join(home, "hub.pid"))) pids.unshift(readJson(join(home, "hub.pid")).pid);
    for (const pid of pids) {
      if (typeof pid !== "number" || !isAlive(pid)) continue;
      try { process.kill(pid, "SIGTERM"); } catch { /* exited meanwhile */ }
      if (!(await waitForPidExit(pid, 15_000))) {
        try { process.kill(pid, "SIGKILL"); } catch { /* exited meanwhile */ }
        await waitForPidExit(pid, 2_000);
      }
    }
  }, 60_000);

  it("refuses /x/fixture/ without the per-user token, before any sidecar starts", async () => {
    if (!canBindPorts) return;
    expect((await get("/x/fixture/echo", {})).status).toBe(401);
    expect((await fixtureView()).sidecar?.state ?? "stopped").toBe("stopped");
    expect(loadedModules()).not.toContain("serve");
  });

  it("starts the sidecar on the first request and forwards it with the prefix stripped and the credential dropped", async () => {
    if (!canBindPorts) return;
    const body = await echo("/x/fixture/echo?q=1", { ...auth(), Cookie: `ndx_token=${token}; theme=dark` });
    expect(body.path).toBe("/echo?q=1");
    expect(body.headers["x-ndx-base-path"]).toBe("/x/fixture/");
    expect(body.headers).not.toHaveProperty("x-ndx-token");
    expect(body.headers.cookie).toBe("theme=dark");
    expect(Number(body.port)).not.toBe(port);

    const bearer = await echo("/x/fixture/echo", { Authorization: `Bearer ${token}` });
    expect(bearer.headers).not.toHaveProperty("authorization");

    expect(body.env).toMatchObject({ NDX_EXTENSION_API: "1", NDX_EXTENSION_NAME: "fixture", NDX_HOME: home });
    expect(JSON.stringify(body.env)).not.toContain(token);
    expect(loadedModules()).toContain("serve");
  });

  it("redirects the bare mount to its trailing slash", async () => {
    if (!canBindPorts) return;
    const res = await get("/x/fixture");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.location).toBe("/x/fixture/");
  });

  it("pipes a WebSocket upgrade to the sidecar, with the prefix stripped and the base path added", async () => {
    if (!canBindPorts) return;
    const answer = await upgradeThroughHub(port, "/x/fixture/socket", auth());
    expect(answer).toMatch(/^HTTP\/1\.1 101 /);
    const echoed = JSON.parse(answer.slice(answer.indexOf("\r\n\r\n") + 4));
    expect(echoed.path).toBe("/socket");
    expect(echoed.headers["x-ndx-base-path"]).toBe("/x/fixture/");
    expect(echoed.headers).not.toHaveProperty("x-ndx-token");
  });

  it("writes the sidecar's output to its log file under the n-dx home", () => {
    if (!canBindPorts) return;
    const log = readFileSync(join(home, "ext", "fixture", "logs", "sidecar.log"), "utf-8");
    expect(log).toContain("fixture sidecar listening on");
  });

  it("lists it in the versioned hub API with its mount, sidecar and the project's links", async () => {
    if (!canBindPorts) return;
    const { status, body } = await getJson(`/api/hub/extensions?project=${PROJECT_ID}`);
    expect(status).toBe(200);
    expect(body.apiVersion).toBe(1);
    const view = body.extensions.find((e) => e.name === "fixture");
    expect(view).toMatchObject({
      packageName: "ndx-fixture-extension",
      version: "1.0.0",
      source: "dev",
      state: "enabled",
      compatible: true,
      mount: "/x/fixture/",
      sidecar: { state: "running" },
      links: [{ label: "Fixture report", url: `/x/fixture/project/${PROJECT_ID}` }],
    });

    // A dashboard asks under its own /p/<id>/ prefix.
    const scoped = await getJson(`/p/${PROJECT_ID}/api/hub/extensions`);
    expect(scoped.body.extensions.find((e) => e.name === "fixture").links).toEqual(view.links);
    expect((await getJson("/api/hub/extensions?project=ghost")).status).toBe(404);
  });

  it("shows a card on the hub home linking to the mount", async () => {
    if (!canBindPorts) return;
    // With one project registered, `/` is its dashboard; the home is `/hub`.
    const page = await get("/hub");
    expect(page.status).toBe(200);
    expect(page.text).toContain("Fixture app");
    expect(page.text).toContain('href="/x/fixture/"');
  });

  it("restarts a crashed sidecar on the next request", async () => {
    if (!canBindPorts) return;
    const before = (await echo()).pid;
    expect((await get("/x/fixture/die")).status).toBe(200);
    expect(await waitForPidExit(before, 15_000)).toBe(true);

    const after = (await echo()).pid;
    expect(after).not.toBe(before);
    expect((await fixtureView()).sidecar.recentCrashes).toBeGreaterThanOrEqual(1);
  });

  it("stops it on POST /api/hub/extensions/:name/stop, and the next request starts it again", async () => {
    if (!canBindPorts) return;
    const running = (await echo()).pid;
    const stop = await hubRequest(port, "/api/hub/extensions/fixture/stop", { method: "POST", headers: auth() });
    expect(JSON.parse(stop.text)).toEqual({ apiVersion: 1, name: "fixture", stopped: true });
    expect(await waitForPidExit(running, 15_000)).toBe(true);

    const again = await hubRequest(port, "/api/hub/extensions/fixture/stop", { method: "POST", headers: auth() });
    expect(JSON.parse(again.text).stopped).toBe(false);
    expect((await hubRequest(port, "/api/hub/extensions/Not_A_Name/stop", { method: "POST", headers: auth() })).status).toBe(404);

    expect((await echo()).pid).not.toBe(running);
  });

  it("answers 404 with the reason for an unknown or disabled name, and drops a disabled one's card and links", async () => {
    if (!canBindPorts) return;
    const unknown = await get("/x/ghost/");
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.text).error).toMatch(/ghost/);

    await hubRequest(port, "/api/hub/extensions/fixture/stop", { method: "POST", headers: auth() });
    ndxOk(["extensions", "disable", "fixture"]);
    try {
      const disabled = await get("/x/fixture/");
      expect(disabled.status).toBe(404);
      expect(JSON.parse(disabled.text).error).toMatch(/disabled/);
      expect((await fixtureView(`?project=${PROJECT_ID}`)).links).toEqual([]);
      expect((await get("/hub")).text).not.toContain('href="/x/fixture/"');
    } finally {
      ndxOk(["extensions", "enable", "fixture", "--yes"]);
    }
  });

  it("refuses to register a project whose id would collide with /x/", async () => {
    if (!canBindPorts) return;
    const res = await hubRequest(port, "/api/hub/projects", {
      method: "POST",
      headers: auth(),
      body: { id: "x", repoRoot: repo, ndxBin: realpathSync(CLI_PATH) },
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text).error).toMatch(/reserved/);
  });

  it("gives an extension command run beside the hub its URL and token file, never the token", () => {
    if (!canBindPorts) return;
    const out = report(ndxOk(["fixture"]));
    expect(out.env.NDX_HUB_URL).toContain(String(port));
    expect(out.env.NDX_TOKEN_FILE).toBe(join(home, "auth.token"));
    expect(JSON.stringify(out)).not.toContain(token);
  });

  it("ndx hub stop stops the sidecar with the hub", async () => {
    if (!canBindPorts) return;
    const sidecar = (await echo()).pid;
    ndxOk(["hub", "stop", `--port=${port}`]);
    expect(await waitForPidExit(sidecar, 20_000)).toBe(true);
  });
});

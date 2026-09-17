/**
 * `ndx mcp <server> [dir]` end to end, with no hub running.
 *
 * This is the path every project is in before `ndx start`, and the one an
 * editor falls back to whenever the hub is down — so it is the one that has
 * to work without qualification. The shim is driven exactly as an editor
 * drives it: spawn it, write a JSON-RPC frame to its stdin, read the response
 * off its stdout.
 *
 * The bridge half, which needs a hub to talk to, is covered against a fake one
 * in tests/integration/mcp-shim-bridge.test.js.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  CLI_PATH,
  createTmpDir,
  removeTmpDir,
  runResult,
  setupRexDir,
  setupSourcevisionDir,
  waitForPidExit,
  withSandboxedClaudeConfig,
} from "./e2e-helpers.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

function git(cwd, ...args) {
  return execFileSync(
    "git",
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** A port nothing is listening on, so the hub health probe definitively fails. */
function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
    probe.on("error", reject);
  });
}

/**
 * Drive the shim the way an editor does: one frame in, frames out.
 *
 * @returns {Promise<{frames: object[], stderr: string, code: number}>}
 */
function speakMcp(args, env, frames, timeoutMs = 60_000) {
  return new Promise((resolvePromise) => {
    const child = spawn("node", [CLI_PATH, "mcp", ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const finish = (code) => {
      const parsed = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
      resolvePromise({ frames: parsed, stderr, code: code ?? 0 });
    };

    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(null); }, timeoutMs);
    child.on("exit", (code) => { clearTimeout(timer); finish(code); });

    for (const frame of frames) child.stdin.write(`${JSON.stringify(frame)}\n`);
    // Give the server time to answer before closing its input.
    setTimeout(() => child.stdin.end(), 4_000);
  });
}

describe("ndx mcp (no hub running)", { timeout: 180_000 }, () => {
  let home;
  let project;
  let env;

  beforeAll(async () => {
    home = await createTmpDir("ndx-mcp-shim-home-");
    project = await createTmpDir("ndx-mcp-shim-project-");
    await setupRexDir(project, { project: "Shim Project" });
    await setupSourcevisionDir(project);
    git(project, "init", "--quiet", "--initial-branch=main");
    git(project, "add", "-A");
    git(project, "commit", "--quiet", "-m", "init");

    // A hub home of its own, pointed at a port nothing answers on, so the
    // probe fails for certain rather than depending on what this machine
    // happens to be running.
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.json"), JSON.stringify({ hub: { port: await findFreePort() } }));
    env = { N_DX_HOME: home };
  }, 120_000);

  afterAll(async () => {
    for (const dir of [home, project]) if (dir) await removeTmpDir(dir);
  });

  it("serves rex over stdio, answering an initialize the way an editor expects", async () => {
    const { frames, stderr } = await speakMcp(["rex", project], env, [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "shim-test", version: "0" },
        },
      },
    ]);

    const response = frames.find((f) => f.id === 1);
    expect(response, `no response. stderr:\n${stderr}`).toBeDefined();
    expect(response.jsonrpc).toBe("2.0");
    expect(response.result.serverInfo).toBeDefined();
    expect(response.error).toBeUndefined();
  });

  it("answers tools/list with the rex tools, so the fallback is a real server", async () => {
    const { frames, stderr } = await speakMcp(["rex", project], env, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);

    const list = frames.find((f) => f.id === 2);
    expect(list, `no tools/list response. stderr:\n${stderr}`).toBeDefined();
    const names = list.result.tools.map((t) => t.name);
    expect(names).toContain("get_next_task");
    expect(names).toContain("update_task_status");
  });

  it("serves sourcevision the same way", async () => {
    const { frames, stderr } = await speakMcp(["sourcevision", project], env, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
    ]);
    const response = frames.find((f) => f.id === 1);
    expect(response, `no response. stderr:\n${stderr}`).toBeDefined();
    expect(response.result.serverInfo).toBeDefined();
  });

  it("keeps stdout clean — every diagnostic goes to stderr", async () => {
    const { frames } = await speakMcp(["rex", project], env, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
    ]);
    // Every line on stdout parsed as JSON-RPC; a stale-project notice or a
    // banner there would desynchronise the editor's parser for the session.
    for (const frame of frames) expect(frame.jsonrpc).toBe("2.0");
  });

  it("names the servers it knows when given one it does not", () => {
    const result = runResult(["mcp", "nope", project]);
    expect(result.code).toBe(1);
    expect(result.stderr + result.stdout).toContain("rex");
    expect(result.stderr + result.stdout).toContain("sourcevision");
  });

  it("asks for a server when given none", () => {
    const result = runResult(["mcp"]);
    expect(result.code).toBe(1);
    expect(result.stderr + result.stdout).toContain("Usage: ndx mcp");
  });
});

describe("ndx mcp (bridging to a live hub)", { timeout: 300_000 }, () => {
  let home;
  let root;
  let repo;
  let worktree;
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
    home = await createTmpDir("ndx-mcp-bridge-home-");
    root = await createTmpDir("ndx-mcp-bridge-");
    repo = join(root, "bridge-app");
    mkdirSync(repo, { recursive: true });
    git(repo, "init", "--quiet", "--initial-branch=main");
    await setupRexDir(repo, { project: "Bridge App" });
    await setupSourcevisionDir(repo);
    git(repo, "add", "-A");
    git(repo, "commit", "--quiet", "-m", "init");
    worktree = join(root, "bridge-feature");
    git(repo, "worktree", "add", "--quiet", "-b", "feature", worktree);

    try {
      hubPort = await findFreePort();
    } catch (err) {
      if (err && err.code === "EPERM") canBindPorts = false;
      else throw err;
    }
    if (canBindPorts) {
      const started = runStart([`--port=${hubPort}`, repo]);
      expect(started.code, started.stderr + started.stdout).toBe(0);
      // How a persistent hub port is configured. Without it the shim can only
      // find the hub through a registered directory's marker file, which a
      // repository the hub has never heard of does not have.
      writeFileSync(join(home, "config.json"), JSON.stringify({ hub: { port: hubPort } }));
    }
  }, 240_000);

  afterAll(async () => {
    if (canBindPorts && hubPort) {
      // Stop the hub and every project server it spawned.
      const pids = [];
      try {
        const res = await fetch(`http://127.0.0.1:${hubPort}/api/hub/projects`);
        const body = await res.json();
        for (const p of body?.projects ?? []) if (typeof p.pid === "number") pids.push(p.pid);
      } catch { /* hub already gone */ }
      try {
        const { readFileSync: read } = await import("node:fs");
        const pidFile = JSON.parse(read(join(home, "hub.pid"), "utf-8"));
        if (typeof pidFile?.pid === "number") pids.unshift(pidFile.pid);
      } catch { /* no hub was started */ }
      for (const pid of pids) {
        try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
        if (!(await waitForPidExit(pid, 15_000))) {
          try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
          await waitForPidExit(pid, 2_000);
        }
      }
    }
    for (const dir of [home, root]) if (dir) await removeTmpDir(dir);
  }, 120_000);

  it("bridges to the hub from the main checkout, with no workspace header", async () => {
    if (!canBindPorts) return;
    const { frames, stderr } = await speakMcp(["rex", repo], { N_DX_HOME: home }, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
    ]);

    expect(stderr).toContain("bridging to");
    expect(stderr).toContain(`/p/bridge-app/mcp/rex`);
    expect(stderr).not.toContain("workspace ");
    const response = frames.find((f) => f.id === 1);
    expect(response, `no response. stderr:\n${stderr}`).toBeDefined();
    expect(response.result.serverInfo).toBeDefined();
  });

  it("bridges from a linked worktree, naming that worktree", async () => {
    if (!canBindPorts) return;
    // Same repository, different checkout: the same registered project, but
    // the tool call has to land on the worktree the editor was opened in.
    const { frames, stderr } = await speakMcp(["rex", worktree], { N_DX_HOME: home }, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    ]);

    expect(stderr).toContain("workspace bridge-feature");
    expect(stderr).toContain(`/p/bridge-app/mcp/rex`);
    const list = frames.find((f) => f.id === 2);
    expect(list, `no tools/list response. stderr:\n${stderr}`).toBeDefined();
    expect(list.result.tools.map((t) => t.name)).toContain("get_next_task");
  });

  it("serves in-process for a repository the hub does not know", async () => {
    if (!canBindPorts) return;
    const stranger = await createTmpDir("ndx-mcp-stranger-");
    try {
      await setupRexDir(stranger, { project: "Stranger" });
      await setupSourcevisionDir(stranger);
      git(stranger, "init", "--quiet", "--initial-branch=main");
      git(stranger, "add", "-A");
      git(stranger, "commit", "--quiet", "-m", "init");

      const { frames, stderr } = await speakMcp(["rex", stranger], { N_DX_HOME: home }, [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      ]);

      // The hub is up, but this repository is not registered with it — so the
      // shim says why and serves MCP itself rather than guessing at a project.
      expect(stderr).toContain("not registered");
      expect(stderr).not.toContain("bridging to");
      expect(frames.find((f) => f.id === 1)?.result?.serverInfo).toBeDefined();
    } finally {
      await removeTmpDir(stranger);
    }
  });
});

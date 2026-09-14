/**
 * Hub-mode `ndx start` — the PR 10 acceptance scenario, end to end.
 *
 * A bare `ndx start <dir>` (no --here, no --port, no web.port) must resolve
 * the repository through git, derive a stable project id, start the hub if
 * none is running, register, and print the /p/<id>/ URL — then exit, leaving
 * the hub and its child server running. Run from a linked worktree, the
 * registration must name the MAIN worktree as repoRoot and list the linked
 * one. A second repo registers beside the first without a port fight, and
 * both project URLs answer through the hub.
 *
 * The hub state lives under N_DX_HUB_DIR (the test seam) with a config-pinned
 * port, so the suite never touches ~/.n-dx or whatever real hub the developer
 * has on 3117.
 *
 * The legacy path is deliberately NOT exercised here — cli-start.test.js
 * covers it, unchanged, which is itself the other acceptance criterion:
 * explicit ports and subcommands behave exactly as 0.6.0.
 *
 * @see packages/core/web.js — runHubStart
 * @see tests/e2e/hub-mcp-transport.test.js — MCP through the same hub
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_PATH,
  DEFAULT_TIMEOUT,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

function isListenPermissionError(error) {
  return Boolean(error && typeof error === "object" && error.code === "EPERM");
}

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, "-c", "user.email=e2e@test", "-c", "user.name=e2e", ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("ndx start registers with the hub (e2e)", { timeout: 180_000 }, () => {
  let baseDir;
  let hubDir;
  let repoA;
  let worktreeA;
  let repoB;
  let hubPort;
  let canBindPorts = true;

  const hubUrl = (path) => `http://127.0.0.1:${hubPort}${path}`;

  /** Run `ndx start` (or another CLI invocation) with the hub seam applied. */
  function ndx(args) {
    return execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: DEFAULT_TIMEOUT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, N_DX_HUB_DIR: hubDir },
    });
  }

  beforeAll(async () => {
    baseDir = await createTmpDir("ndx-start-hub-e2e-");
    hubDir = join(baseDir, "hub-state");
    repoA = join(baseDir, "repo-a");
    worktreeA = join(baseDir, "repo-a-wt");
    repoB = join(baseDir, "repo-b");

    // A hub port pinned in the seam's config, so the suite cannot collide
    // with a real hub (or anything else) on 3117.
    const { createServer } = await import("node:net");
    try {
      hubPort = await new Promise((resolvePort, reject) => {
        const srv = createServer();
        srv.listen(0, () => {
          const p = srv.address().port;
          srv.close(() => resolvePort(p));
        });
        srv.on("error", reject);
      });
    } catch (error) {
      if (isListenPermissionError(error)) {
        canBindPorts = false;
        return;
      }
      throw error;
    }
    await mkdir(hubDir, { recursive: true });
    await writeFile(join(hubDir, "config.json"), JSON.stringify({ hub: { port: hubPort } }), "utf-8");

    // Repo A: a real git repo with a linked worktree. The project fixtures
    // live in the MAIN worktree — that is where the child server will serve.
    await mkdir(repoA, { recursive: true });
    git(repoA, ["init", "-b", "main"]);
    await setupRexDir(repoA, { project: "Hub Repo A" });
    await setupSourcevisionDir(repoA);
    await writeFile(join(repoA, "README.md"), "# a\n", "utf-8");
    git(repoA, ["add", "-A"]);
    git(repoA, ["commit", "-m", "init"]);
    git(repoA, ["worktree", "add", worktreeA, "-b", "feature"]);

    // Repo B: plain repo, no worktrees, different project name.
    await mkdir(repoB, { recursive: true });
    git(repoB, ["init", "-b", "main"]);
    await setupRexDir(repoB, { project: "Hub Repo B" });
    await setupSourcevisionDir(repoB);
    await writeFile(join(repoB, "README.md"), "# b\n", "utf-8");
    git(repoB, ["add", "-A"]);
    git(repoB, ["commit", "-m", "init"]);
  }, 60_000);

  afterAll(async () => {
    // Unregister through the API so the hub stops its child servers, then
    // take down the hub itself by pid — it was spawned detached by the CLI,
    // so nothing else owns it.
    if (canBindPorts) {
      for (const id of ["hub-repo-a", "hub-repo-b"]) {
        await fetch(hubUrl(`/api/hub/projects/${id}`), { method: "DELETE" }).catch(() => {});
      }
      try {
        const pidRaw = await readFile(join(hubDir, "hub.pid"), "utf-8");
        const pid = JSON.parse(pidRaw)?.pid;
        if (pid) {
          if (process.platform === "win32") {
            execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
          } else {
            process.kill(pid, "SIGTERM");
          }
        }
      } catch {
        // hub never started or already gone
      }
    }
    await removeTmpDir(baseDir);
  });

  it("registers the main worktree from a linked worktree, starting the hub on demand", async () => {
    if (!canBindPorts) return;

    const stdout = ndx(["start", worktreeA]);

    // The command reports the project URL and MCP endpoints, then exits.
    expect(stdout).toContain(`/p/hub-repo-a/`);
    expect(stdout).toContain(`http://localhost:${hubPort}/p/hub-repo-a/mcp/rex`);

    // The registry names the MAIN worktree as repoRoot and lists the linked one.
    const registry = JSON.parse(await readFile(join(hubDir, "hub.json"), "utf-8"));
    const project = registry.projects["hub-repo-a"];
    expect(project).toBeDefined();
    expect(project.repoRoot).toBe(realpathSync.native(repoA));
    expect(project.worktrees).toContain(realpathSync.native(worktreeA));

    // The project answers through the hub.
    const status = await fetch(hubUrl("/p/hub-repo-a/api/status"));
    expect(status.status).toBe(200);
  });

  it("a second repo registers beside the first; both URLs answer", async () => {
    if (!canBindPorts) return;

    const stdout = ndx(["start", repoB]);
    expect(stdout).toContain("/p/hub-repo-b/");

    const listed = await fetch(hubUrl("/api/hub/projects"));
    const { projects } = await listed.json();
    expect(projects.map((p) => p.id).sort()).toEqual(["hub-repo-a", "hub-repo-b"]);

    for (const id of ["hub-repo-a", "hub-repo-b"]) {
      const res = await fetch(hubUrl(`/p/${id}/api/status`));
      expect(res.status, id).toBe(200);
    }
  });

  it("writes .n-dx-web.port/.pid pointing at the hub, and refresh --live-server reloads THIS project through it", async () => {
    if (!canBindPorts) return;

    // The pointer files land in the invoked directory (the worktree): the
    // port file names the HUB's port, the pid file records via:"hub" so the
    // legacy stop/refresh cleanup paths know this pid is the shared daemon.
    const portFile = await readFile(join(worktreeA, ".n-dx-web.port"), "utf-8");
    expect(parseInt(portFile.trim(), 10)).toBe(hubPort);

    const pidFile = JSON.parse(await readFile(join(worktreeA, ".n-dx-web.pid"), "utf-8"));
    expect(pidFile.via).toBe("hub");
    expect(pidFile.projectId).toBe("hub-repo-a");
    expect(pidFile.port).toBe(hubPort);

    // With BOTH projects registered, the reload can only reach the right
    // dashboard by matching the sender's directory — the acceptance case.
    const stdout = ndx(["refresh", "--ui-only", "--no-build", "--live-server", worktreeA]);
    expect(stdout).toContain(`Live reload: attempted on :${hubPort} and succeeded`);
  });

  it("re-running from the same repo is idempotent — same id, no second entry", async () => {
    if (!canBindPorts) return;

    const stdout = ndx(["start", repoA]);
    expect(stdout).toContain("/p/hub-repo-a/");

    const registry = JSON.parse(await readFile(join(hubDir, "hub.json"), "utf-8"));
    expect(Object.keys(registry.projects).sort()).toEqual(["hub-repo-a", "hub-repo-b"]);
  });
});

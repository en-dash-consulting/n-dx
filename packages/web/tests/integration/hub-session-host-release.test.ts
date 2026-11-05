/**
 * Two real project servers sharing one ndx home: when the server holding the
 * hub session host lock has its web.sidecar turned off, it gives the lock up,
 * and the other server's next hub session request is served rather than
 * answered 409.
 *
 * `routes-sidecar-hub.test.ts` drives the release through its own handler,
 * which mirrors the call in `handleApiRoutes`; nothing there fails if start.ts
 * stops making it. So this boots the built server twice, each in its own
 * process: the lock is keyed by pid, so two servers in one process would
 * replace each other's lock rather than contend for it. Each child's exit is
 * its teardown, as in `feature-gate-enforcement.test.ts`.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { removeTempDir } from "../helpers/temp-dir.js";
import { readHubSessionHostLock } from "../../src/hub/index.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const SERVER_ENTRY_URL = pathToFileURL(join(WEB_PKG, "dist/server/start.js")).href;
const SESSIONS = "/api/sidecar/hub/sessions";

interface Server {
  child: ChildProcess;
  pid: number;
  port: number;
  dir: string;
}

let root: string;
let children: ChildProcess[] = [];

/** Boot the built server on `dir` in its own process, with `home` as its ndx home; it runs until killed. */
async function boot(dir: string, home: string): Promise<Server> {
  const script = join(dir, "driver.mjs");
  await writeFile(script, `
import { startServer } from ${JSON.stringify(SERVER_ENTRY_URL)};
const { port } = await startServer(${JSON.stringify(dir)}, 0, {});
console.log("NDX_PORT=" + port);
setInterval(() => {}, 60_000);
`, "utf-8");
  const env: NodeJS.ProcessEnv = { ...process.env, N_DX_HOME: home };
  delete env["NDX_HOME"];
  const child = spawn(process.execPath, [script], { env, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  const port = await new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error(`server on ${dir} printed no port:\n${out}`)), 60_000);
    child.stdout!.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const match = /NDX_PORT=(\d+)/.exec(out);
      if (match) {
        clearTimeout(timer);
        resolvePort(Number(match[1]));
      }
    });
    child.stderr!.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server on ${dir} exited (${code}) before printing its port:\n${out}`));
    });
  });
  return { child, pid: child.pid!, port, dir };
}

async function project(name: string, sidecar: boolean): Promise<string> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await setSidecar(dir, sidecar);
  return dir;
}

function setSidecar(dir: string, on: boolean): Promise<void> {
  return writeFile(join(dir, ".n-dx.json"), JSON.stringify({ features: { web: { sidecar: on } } }), "utf-8");
}

async function status(server: Server): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${server.port}${SESSIONS}`);
  await res.text();
  return res.status;
}

describe("the hub session host lock across two project servers", () => {
  beforeAll(() => {
    assertFreshServerBuild();
  });

  afterEach(async () => {
    for (const child of children) child.kill();
    await Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((done) => child.once("exit", done))));
    children = [];
    await removeTempDir(root);
  });

  it("is given up by a holder whose web.sidecar is turned off, so the other server serves the next request", async () => {
    root = await mkdtemp(join(tmpdir(), "ndx-hub-host-release-"));
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const a = await boot(await project("a", true), home);
    const b = await boot(await project("b", true), home);

    expect(await status(a)).toBe(200);
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: a.pid, port: a.port });
    expect(await status(b)).toBe(409);

    await setSidecar(a.dir, false);
    expect(await status(a)).toBe(403);

    // The release runs just after the refusal is answered.
    await vi.waitFor(async () => expect(await status(b)).toBe(200), { timeout: 10_000, interval: 100 });
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: b.pid, port: b.port });
  }, 120_000);

  // Windows has no SIGTERM to catch: kill() ends the process outright, and the dead-pid takeover covers it.
  it.skipIf(process.platform === "win32")("is given up by its holder's graceful shutdown", async () => {
    root = await mkdtemp(join(tmpdir(), "ndx-hub-host-release-"));
    const home = join(root, "home");
    await mkdir(home, { recursive: true });
    const a = await boot(await project("a", true), home);
    expect(await status(a)).toBe(200);
    expect(readHubSessionHostLock(home)).toMatchObject({ pid: a.pid, port: a.port });

    const exited = new Promise((done) => a.child.once("exit", done));
    a.child.kill("SIGTERM");
    await exited;
    expect(readHubSessionHostLock(home)).toBeNull();
  }, 120_000);
});

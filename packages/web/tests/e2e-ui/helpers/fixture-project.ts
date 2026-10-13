/**
 * Fixture-project helpers for browser-driven UI tests.
 *
 * Each spec file gets its own scratch project directory and its own
 * dashboard server process on a dynamically-allocated port — tests never
 * share a running server, so PRD mutations in one spec can't interfere
 * with another spec's fixtures, and specs can run in parallel.
 *
 * These tests drive the REAL dashboard server (packages/web/dist/cli) via
 * a real headless browser. Rebuild the web package (`pnpm run build` in
 * packages/web) before running this suite if server/viewer source changed
 * since the last build — the tests exercise dist/, not src/.
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

// packages/web/tests/e2e-ui/helpers -> repo root is 5 levels up.
const REPO_ROOT = resolve(import.meta.dirname, "../../../../..");
const CORE_CLI = join(REPO_ROOT, "packages/core/cli.js");
const REX_BIN = join(REPO_ROOT, "packages/core/bin/rex.js");
const WEB_CLI = join(REPO_ROOT, "packages/web/dist/cli/index.js");

export interface FixtureProject {
  dir: string;
  epicId: string;
  taskId: string;
}

export interface RunningDashboard {
  proc: ChildProcess;
  port: number;
  baseUrl: string;
  stdout: string[];
  stderr: string[];
}

function extractId(output: string): string {
  const m = output.match(/ID:\s*([a-f0-9-]{36})/i);
  if (!m) throw new Error(`Could not parse item ID from rex output:\n${output}`);
  return m[1];
}

/** Create a bare git repo with no n-dx integration — for setup-wizard tests. */
export async function createUninitializedFixtureProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ndx-e2e-ui-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  await writeFile(join(dir, "README.md"), "e2e-ui fixture project\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "user.email=e2e@test.local", "-c", "user.name=e2e-ui", "commit", "-q", "-m", "init"],
    { cwd: dir },
  );
  return dir;
}

/**
 * Create a fully-initialized project (v1 folder-tree PRD, local LLM
 * vendor) with one pending epic and one pending task under it, ready for
 * PRD and Hench Runs workflow tests.
 *
 * Vendor is deliberately "local" pointing at a port nothing listens on —
 * PRD/navigation tests never invoke the LLM, and the one Hench Runs test
 * that does start a task exercises the UI's live-feedback path for a
 * process that fails fast, without risking a real autonomous agent run
 * against test fixture files.
 */
export interface FixtureOptions {
  /**
   * Seed a few source files with imports before `ndx init`, so the analysis
   * has an inventory, an import graph and a zone. The happy-click specs need
   * this for Files, Zones and the map; the workflow specs do not.
   */
  sources?: boolean;
}

async function seedSources(dir: string): Promise<void> {
  await mkdir(join(dir, "src", "lib"), { recursive: true });
  const files: Record<string, string> = {
    "src/index.js": 'import { greet } from "./lib/greet.js";\nimport { format } from "./lib/format.js";\n\nexport function main(name) {\n  return format(greet(name));\n}\n',
    "src/lib/greet.js": 'import { format } from "./format.js";\n\nexport function greet(name) {\n  return format(`Hello, ${name}!`);\n}\n',
    "src/lib/format.js": "export function format(text) {\n  return String(text).trim();\n}\n",
    "src/cli.js": 'import { main } from "./index.js";\n\nconsole.log(main(process.argv[2] ?? "world"));\n',
    "package.json": JSON.stringify({ name: "e2e-ui-fixture", version: "0.0.0", private: true, type: "module" }, null, 2) + "\n",
  };
  for (const [rel, content] of Object.entries(files)) await writeFile(join(dir, rel), content);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "user.email=e2e@test.local", "-c", "user.name=e2e-ui", "commit", "-q", "-m", "seed sources"],
    { cwd: dir },
  );
}

export async function createFixtureProject(options: FixtureOptions = {}): Promise<FixtureProject> {
  const dir = await createUninitializedFixtureProject();
  if (options.sources) await seedSources(dir);

  execFileSync(
    "node",
    [CORE_CLI, "init", "--provider=local", "--no-claude", "--no-codex", dir],
    // The fixture is a v1 epic and task; init alone gives a new project v2.
    { stdio: "pipe", env: { ...process.env, NDX_INIT_LAYOUT: "v1" } },
  );

  const epicOut = execFileSync(
    "node",
    [REX_BIN, "add", "epic", "--title=E2E Fixture Epic", dir],
    { encoding: "utf-8" },
  );
  const epicId = extractId(epicOut);

  const taskOut = execFileSync(
    "node",
    [REX_BIN, "add", "task", "--title=E2E Fixture Task", `--parent=${epicId}`, dir],
    { encoding: "utf-8" },
  );
  const taskId = extractId(taskOut);

  return { dir, epicId, taskId };
}

export async function cleanupFixtureProject(dir: string): Promise<void> {
  // On Windows the just-killed server (or a child it spawned) can still hold
  // a handle for a moment; EBUSY/EPERM is retried rather than failing the suite.
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

async function waitForReady(port: number, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/status`);
      if (res.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Dashboard on port ${port} did not become ready within ${timeoutMs}ms: ${String(lastErr)}`);
}

/** Start the dashboard server (dist build) against `dir` on a free port. */
export async function startDashboard(dir: string): Promise<RunningDashboard> {
  const port = await getFreePort();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const proc = spawn("node", [WEB_CLI, "serve", `--port=${port}`, dir], { stdio: "pipe" });
  proc.stdout?.on("data", (d) => stdout.push(String(d)));
  proc.stderr?.on("data", (d) => stderr.push(String(d)));

  try {
    await waitForReady(port);
  } catch (err) {
    stopDashboard(proc);
    throw new Error(`${String(err)}\nstdout:\n${stdout.join("")}\nstderr:\n${stderr.join("")}`);
  }

  return { proc, port, baseUrl: `http://127.0.0.1:${port}`, stdout, stderr };
}

export function stopDashboard(proc: ChildProcess): void {
  try {
    proc.kill("SIGTERM");
  } catch {
    // already dead
  }
}

/**
 * Stop the dashboard and wait for the process to exit, so a cleanup that
 * follows does not race its file handles (Windows reports EBUSY otherwise).
 */
export async function stopDashboardAndWait(proc: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise<void>((resolveExit) => proc.once("exit", () => resolveExit()));
  stopDashboard(proc);
  await Promise.race([exited, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

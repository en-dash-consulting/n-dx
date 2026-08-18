/**
 * Unit tests for the /api/commands/recommend route.
 *
 * Regression: `rex recommend --format=json` emits a JSON *array*. The handler
 * used to do `{ ok: true, ...parsed }`, which spread the array into numeric
 * object keys and dropped the count — so the dashboard's "Refresh
 * Recommendations" button could not read the result. The response must expose
 * the recommendations as a real array with a matching count.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";

// Mock the CLI exec so the route returns controlled stdout without spawning rex.
// `vi.hoisted` makes the mocks available inside the hoisted vi.mock factory.
const { execMock, spawnManagedMock } = vi.hoisted(() => ({
  execMock: vi.fn(),
  spawnManagedMock: vi.fn(),
}));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, exec: execMock, spawnManaged: spawnManagedMock };
});

import type { ServerContext } from "../../../src/server/types.js";
import { handleCommandsRoute } from "../../../src/server/routes-commands.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

// ── spawnManaged mock helpers ─────────────────────────────────────────

interface ManagedResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface ManagedSpawnOpts {
  onStdout?: (chunk: string) => void;
}

/**
 * Configure spawnManagedMock to return a child whose completion the test
 * controls. Returns:
 *  - `finish(result)` — resolve the child's `done` promise
 *  - `emit(chunk)`    — stream a stdout chunk through the caller's onStdout
 *  - `kill`           — the handle's kill mock (spied for stop tests)
 */
function stubManagedChild(opts?: { killFinishes?: ManagedResult }) {
  let finish!: (r: ManagedResult) => void;
  const done = new Promise<ManagedResult>((resolve) => { finish = resolve; });
  let onStdout: ((chunk: string) => void) | undefined;
  const kill = vi.fn(() => {
    if (opts?.killFinishes) finish(opts.killFinishes);
    return true;
  });
  spawnManagedMock.mockImplementation(
    (_bin: string, _args: string[], spawnOpts: ManagedSpawnOpts) => {
      onStdout = spawnOpts.onStdout;
      return { done, kill, pid: 4242 };
    },
  );
  return {
    finish,
    emit: (chunk: string) => onStdout?.(chunk),
    kill,
  };
}

/** Configure spawnManagedMock to finish immediately with `result`. */
function stubManagedRun(result: Partial<ManagedResult>) {
  const full: ManagedResult = { exitCode: 0, stdout: "", stderr: "", ...result };
  spawnManagedMock.mockImplementation(
    (_bin: string, _args: string[], spawnOpts: ManagedSpawnOpts) => {
      if (full.stdout) spawnOpts.onStdout?.(full.stdout);
      return { done: Promise.resolve(full), kill: vi.fn(() => true), pid: 4242 };
    },
  );
}

const RECOMMENDATIONS = [
  { id: "a", title: "Rec A", level: "feature", priority: "high", source: "sourcevision" },
  { id: "b", title: "Rec B", level: "task", priority: "medium", source: "sourcevision" },
  { id: "c", title: "Rec C", level: "task", priority: "low", source: "sourcevision" },
];

describe("commands route — recommend", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-route-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns recommendations as an array with a matching count", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify(RECOMMENDATIONS),
      stderr: "",
      error: null,
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/commands/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    // The array must survive as an array — not be mangled into numeric keys.
    expect(Array.isArray(body.recommendations)).toBe(true);
    expect(body.recommendations).toHaveLength(3);
    expect(body.count).toBe(3);
    // Numeric-key leakage from an object spread must not be present.
    expect(body["0"]).toBeUndefined();
  });

  it("reports count 0 when there are no recommendations", async () => {
    execMock.mockResolvedValue({ stdout: "[]", stderr: "", error: null });

    const res = await fetch(`http://127.0.0.1:${port}/api/commands/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recommendations).toEqual([]);
    expect(body.count).toBe(0);
  });

  it("falls back to raw output when stdout is not JSON", async () => {
    execMock.mockResolvedValue({
      stdout: "plain text summary, not json",
      stderr: "",
      error: null,
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/commands/recommend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.output).toContain("plain text summary");
    expect(body.recommendations).toBeUndefined();
  });
});

describe("commands route — refresh (live-server data refresh)", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    spawnManagedMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-refresh-"));
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Poll the status endpoint until running=false (bounded). */
  async function waitForFinish(): Promise<Record<string, unknown>> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/commands/refresh/status`);
      const body = (await res.json()) as Record<string, unknown>;
      if (!body.running) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("refresh did not finish");
  }

  it("returns 202 and spawns ndx refresh with --data-only --live-server", async () => {
    stubManagedRun({ stdout: "[refresh] starting — 2 steps planned\n[refresh] complete" });

    const res = await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);

    await waitForFinish();
    expect(spawnManagedMock).toHaveBeenCalledTimes(1);
    const args = spawnManagedMock.mock.calls[0][1] as string[];
    expect(args).toContain("refresh");
    expect(args).toContain("--data-only");
    expect(args).toContain("--live-server");
    expect(args).not.toContain("--fast");
  });

  it("forwards fast mode as --fast", async () => {
    stubManagedRun({ stdout: "[refresh] ok" });

    await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fast: true }),
    });
    await waitForFinish();
    const args = spawnManagedMock.mock.calls[0][1] as string[];
    expect(args).toContain("--fast");
  });

  it("rejects a concurrent refresh with 409 while one is running", async () => {
    const child = stubManagedChild();

    const first = await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(202);

    const second = await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(second.status).toBe(409);

    child.finish({ exitCode: 0, stdout: "[refresh] done", stderr: "" });
    await waitForFinish();
  });

  it("status endpoint exposes phases parsed from [refresh] output", async () => {
    stubManagedRun({
      stdout: [
        "[refresh] starting — 2 steps planned",
        "[refresh] state snapshot captured (3 files)",
        "some delegated tool output",
        "[refresh] complete",
      ].join("\n"),
    });

    await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const status = await waitForFinish();
    expect(status.error).toBeNull();
    expect(status.phases).toEqual([
      "starting — 2 steps planned",
      "state snapshot captured (3 files)",
      "complete",
    ]);
    expect(status.finishedAt).toBeTruthy();
  });

  it("streams phases and output into status while the run is still going", async () => {
    // Regression: the buffered exec() only surfaced output after exit, so
    // the RefreshPanel's live phase list was always empty during a run.
    const child = stubManagedChild();

    await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    child.emit("[refresh] starting — 2 steps planned\n");
    child.emit("[refresh] state snapshot captured (3 files)\npartial li");

    const live = await (await fetch(`http://127.0.0.1:${port}/api/commands/refresh/status`)).json();
    expect(live.running).toBe(true);
    expect(live.phases).toEqual([
      "starting — 2 steps planned",
      "state snapshot captured (3 files)",
    ]);
    expect(live.output).toContain("starting — 2 steps planned");

    child.finish({
      exitCode: 0,
      stdout: "[refresh] starting — 2 steps planned\n[refresh] state snapshot captured (3 files)\npartial line ok\n[refresh] complete",
      stderr: "",
    });
    const done = await waitForFinish();
    expect(done.phases).toHaveLength(3);
  });

  it("parses phases from ANSI-colored output", async () => {
    // cli.js colorizes when FORCE_COLOR is set (the child inherits the
    // server's env), emitting \x1b[36m[refresh]\x1b[39m …. The strip regex
    // must consume the escape byte too — dropping only "[36m" leaves a bare
    // \x1b before "[refresh]" and every startsWith("[refresh]") check fails.
    stubManagedRun({
      stdout: [
        "\x1b[36m[refresh]\x1b[39m \x1b[1mdata\x1b[22m -> starting — 2 steps planned",
        "\x1b[36m[refresh]\x1b[39m complete",
      ].join("\n"),
    });

    await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const status = await waitForFinish();
    expect(status.phases).toEqual([
      "data -> starting — 2 steps planned",
      "complete",
    ]);
  });

  it("captures a failure into status.error", async () => {
    stubManagedRun({ exitCode: 1, stderr: "refresh exploded" });

    await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const status = await waitForFinish();
    expect(String(status.error)).toContain("refresh exploded");
  });
});

describe("commands route — shared .sourcevision write lock", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    spawnManagedMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-svlock-"));
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  function post(path: string, body: unknown = {}) {
    return fetch(`http://127.0.0.1:${port}/api/commands/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function waitForFinish(path: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/commands/${path}/status`);
      if (!((await res.json()) as { running: boolean }).running) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${path} did not finish`);
  }

  // sv-analyze --full, refresh --data-only, and ndx ci all write
  // .sourcevision/ — the CLAUDE.md concurrency contract forbids running any
  // two of them at once, and dashboard buttons made that one click away.

  it("rejects refresh while a full analysis runs, naming the in-flight job", async () => {
    const child = stubManagedChild();
    expect((await post("sv-analyze", { full: true })).status).toBe(202);

    const res = await post("refresh", {});
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; runningJob: string };
    expect(body.error).toContain("full analysis");
    expect(body.runningJob).toBe("full analysis");

    child.finish({ exitCode: 0, stdout: "", stderr: "" });
    await waitForFinish("sv-analyze");
  });

  it("rejects ci while a refresh runs, naming the in-flight job", async () => {
    const child = stubManagedChild();
    expect((await post("refresh", {})).status).toBe(202);

    const res = await post("ci", {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("refresh");

    child.finish({ exitCode: 0, stdout: "", stderr: "" });
    await waitForFinish("refresh");
  });

  it("rejects a quick analysis while a full run is in flight", async () => {
    const child = stubManagedChild();
    expect((await post("sv-analyze", { full: true })).status).toBe(202);

    const res = await post("sv-analyze", { lite: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("full analysis");
    expect(execMock).not.toHaveBeenCalled();

    child.finish({ exitCode: 0, stdout: "", stderr: "" });
    await waitForFinish("sv-analyze");
  });

  it("a quick analysis holds the lock against other writers", async () => {
    let release!: (r: { stdout: string; stderr: string; error: null }) => void;
    execMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const quick = post("sv-analyze", { lite: true });
    // Let the quick handler reach the exec call and take the lock.
    await new Promise((r) => setTimeout(r, 20));

    const res = await post("refresh", {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("quick analysis");

    release({ stdout: "ok", stderr: "", error: null });
    expect((await quick).status).toBe(200);
  });

  it("releases the lock when the job finishes, including failures", async () => {
    stubManagedRun({ exitCode: 1, stderr: "boom" });
    await post("sv-analyze", { full: true });
    await waitForFinish("sv-analyze");

    stubManagedRun({ stdout: "[refresh] ok" });
    expect((await post("refresh", {})).status).toBe(202);
    await waitForFinish("refresh");
  });
});

describe("commands route — ndx binary resolution ladder", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;
  let savedCliPath: string | undefined;

  beforeEach(async () => {
    execMock.mockReset();
    spawnManagedMock.mockReset();
    savedCliPath = process.env["N_DX_CLI_PATH"];
    delete process.env["N_DX_CLI_PATH"];
    tmpDir = await mkdtemp(join(tmpdir(), "commands-ndxbin-"));
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    if (savedCliPath === undefined) delete process.env["N_DX_CLI_PATH"];
    else process.env["N_DX_CLI_PATH"] = savedCliPath;
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Trigger refresh (which resolves the ndx bin) and wait for it to finish. */
  async function runRefresh(): Promise<void> {
    stubManagedRun({ stdout: "[refresh] ok" });
    await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/commands/refresh/status`);
      if (!((await res.json()) as { running: boolean }).running) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("refresh did not finish");
  }

  it("prefers the project-local .bin/ndx when present", async () => {
    const { writeFile: wf, mkdir: md } = await import("node:fs/promises");
    const binDir = join(tmpDir, "node_modules", ".bin");
    await md(binDir, { recursive: true });
    await wf(join(binDir, "ndx"), "#!/bin/sh\n");

    await runRefresh();
    expect(spawnManagedMock.mock.calls[0][0]).toBe(join(binDir, "ndx"));
  });

  it("uses N_DX_CLI_PATH when set and no local bin exists", async () => {
    // ndx start sets this to the launching CLI's own path, which is valid
    // for any install layout (global, npm, pnpm) — unlike the dogfood
    // packages/core/cli.js path, which only exists in the n-dx monorepo.
    const { writeFile: wf } = await import("node:fs/promises");
    const cliPath = join(tmpDir, "installed-cli.js");
    await wf(cliPath, "// stand-in for @n-dx/core/cli.js\n");
    process.env["N_DX_CLI_PATH"] = cliPath;

    await runRefresh();
    expect(spawnManagedMock.mock.calls[0][0]).toBe("node");
    expect((spawnManagedMock.mock.calls[0][1] as string[])[0]).toBe(cliPath);
  });

  // Below the env rung, the exact result is environment-dependent: whether
  // @n-dx/core resolves from the web module graph varies with the test
  // runner's module resolver (vitest pools differ from plain Node, where it
  // never resolves in this workspace — web must not depend on core). Both
  // remaining rungs end in core/cli.js, so these tests pin the ladder's
  // shape, not a specific path.
  it("ignores a stale N_DX_CLI_PATH that points at a missing file", async () => {
    const stale = join(tmpDir, "gone", "cli.js");
    process.env["N_DX_CLI_PATH"] = stale;

    await runRefresh();
    const target = (spawnManagedMock.mock.calls[0][1] as string[])[0];
    expect(target).not.toBe(stale);
    expect(target.endsWith(join("core", "cli.js"))).toBe(true);
  });

  it("falls through to a real cli.js when no local bin or env exists", async () => {
    await runRefresh();
    expect(spawnManagedMock.mock.calls[0][0]).toBe("node");
    const target = (spawnManagedMock.mock.calls[0][1] as string[])[0];
    expect(target.endsWith(join("core", "cli.js"))).toBe(true);
  });
});

describe("commands route — sv-analyze full flow (async)", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    spawnManagedMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-svfull-"));
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function waitForFinish(): Promise<Record<string, unknown>> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze/status`);
      const body = (await res.json()) as Record<string, unknown>;
      if (!body.running) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("full analysis did not finish");
  }

  it("full mode returns 202 and spawns analyze --full in the background", async () => {
    stubManagedRun({ stdout: "Phase 1 done\nPass 4 complete" });

    const res = await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: true }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const status = await waitForFinish();
    expect(status.error).toBeNull();
    expect(status.finishedAt).toBeTruthy();
    const args = spawnManagedMock.mock.calls[0][1] as string[];
    expect(args).toContain("analyze");
    expect(args).toContain("--full");
  });

  it("quick mode stays synchronous and returns 200 with output", async () => {
    execMock.mockResolvedValue({ stdout: "quick analysis ok", stderr: "", error: null });

    const res = await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lite: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.output).toContain("quick analysis ok");
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain("--lite");
    expect(args).not.toContain("--full");
  });

  it("rejects a concurrent full run with 409", async () => {
    const child = stubManagedChild();

    const first = await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: true }),
    });
    expect(first.status).toBe(202);

    const second = await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: true }),
    });
    expect(second.status).toBe(409);

    child.finish({ exitCode: 0, stdout: "done", stderr: "" });
    await waitForFinish();
  });

  it("status exposes recent output lines while and after running", async () => {
    // Regression: the buffered exec() populated recentOutput only after
    // exit, so AnalyzeControls and the enrichment gate showed nothing
    // during the minutes-long run.
    const child = stubManagedChild();

    await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: true }),
    });

    child.emit("Phase 1: inventory\nPhase 3: zones\n");
    const live = await (await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze/status`)).json();
    expect(live.running).toBe(true);
    expect(live.recentOutput).toContain("Phase 3: zones");

    child.finish({
      exitCode: 0,
      stdout: ["Phase 1: inventory", "Phase 3: zones", "Enrichment pass 4 complete"].join("\n"),
      stderr: "",
    });
    const status = await waitForFinish();
    expect(status.recentOutput).toContain("Enrichment pass 4 complete");
  });

  it("targetPass runs async and spawns --target-pass=N without --full", async () => {
    stubManagedRun({ stdout: "Enrichment pass 3 complete" });

    const res = await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetPass: 3 }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.message).toContain("pass 3");

    const status = await waitForFinish();
    expect(status.error).toBeNull();
    const args = spawnManagedMock.mock.calls[0][1] as string[];
    expect(args).toContain("--target-pass=3");
    expect(args).not.toContain("--full");
  });

  it("rejects out-of-range or non-integer targetPass with 400", async () => {
    for (const targetPass of [1, 5, 2.5, "3"]) {
      const res = await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPass }),
      });
      expect(res.status).toBe(400);
    }
    expect(execMock).not.toHaveBeenCalled();
    expect(spawnManagedMock).not.toHaveBeenCalled();
  });

  it("captures a failed full run into status.error", async () => {
    stubManagedRun({ exitCode: 1, stderr: "no LLM credentials" });

    await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: true }),
    });
    const status = await waitForFinish();
    expect(String(status.error)).toContain("no LLM credentials");
  });
});

describe("commands route — manifest (command reference)", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-manifest-"));
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function getManifest(): Promise<Record<string, any>> {
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/manifest`);
    expect(res.status).toBe(200);
    return res.json() as Promise<Record<string, any>>;
  }

  it("carries trigger metadata only for dashboard-triggerable commands", async () => {
    const body = await getManifest();
    const all = body.groups.flatMap((g: { commands: Array<Record<string, any>> }) => g.commands);

    // Empty-body POST takes the synchronous quick path (200, never 202), so
    // declaring a statusEndpoint here would describe a branch RunCell can
    // never reach.
    const analyze = all.find((c: Record<string, any>) => c.name === "analyze");
    expect(analyze.trigger).toEqual({ endpoint: "/api/commands/sv-analyze", method: "POST" });

    const refresh = all.find((c: Record<string, any>) => c.name === "refresh");
    expect(refresh.trigger).toMatchObject({
      endpoint: "/api/commands/refresh",
      method: "POST",
      statusEndpoint: "/api/commands/refresh/status",
    });
    // The trigger runs --data-only; the description must not claim UI
    // artifacts are rebuilt.
    expect(refresh.description).toContain("--data-only");

    const ci = all.find((c: Record<string, any>) => c.name === "ci");
    expect(ci.trigger).toMatchObject({
      endpoint: "/api/commands/ci",
      method: "POST",
      statusEndpoint: "/api/commands/ci/status",
    });

    // Excluded by design: work needs task selection; self-heal is
    // confirmation-gated; plan has no endpoint that runs the full
    // sourcevision-then-rex pipeline; init/config are terminal-side.
    for (const name of ["work", "self-heal", "plan", "init", "config"]) {
      const cmd = all.find((c: Record<string, any>) => c.name === name);
      expect(cmd.trigger).toBeUndefined();
    }
  });

  it("returns groups covering the five categories with described commands", async () => {
    const body = await getManifest();
    const ids = (body.groups as Array<{ id: string }>).map((g) => g.id);
    expect(ids).toEqual(["setup", "analysis", "planning", "execution", "config"]);
    for (const group of body.groups) {
      expect(group.label).toBeTruthy();
      expect(group.commands.length).toBeGreaterThan(0);
      for (const cmd of group.commands) {
        expect(cmd.name).toBeTruthy();
        expect(cmd.description).toBeTruthy();
        expect(["available", "needs-init", "needs-llm"]).toContain(cmd.status);
      }
    }
    const allNames = body.groups.flatMap((g: { commands: Array<{ name: string }> }) => g.commands.map((c) => c.name));
    for (const expected of ["init", "analyze", "plan", "work", "config"]) {
      expect(allNames).toContain(expected);
    }
  });

  it("resolves invocations with cli.name from .n-dx.json", async () => {
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(join(tmpDir, ".n-dx.json"), JSON.stringify({ cli: { name: "myapp" } }));
    const body = await getManifest();
    expect(body.cliName).toBe("myapp");
    const anyCmd = body.groups[0].commands[0];
    expect(anyCmd.invocation.startsWith("myapp ")).toBe(true);
  });

  it("defaults invocations to n-dx without cli.name", async () => {
    const body = await getManifest();
    expect(body.cliName).toBe("n-dx");
    expect(body.groups[0].commands[0].invocation.startsWith("n-dx ")).toBe(true);
  });

  it("marks init-requiring commands needs-init in an uninitialized project", async () => {
    const body = await getManifest();
    const all = body.groups.flatMap((g: { commands: Array<Record<string, unknown>> }) => g.commands);
    const work = all.find((c: Record<string, unknown>) => c.name === "work");
    const init = all.find((c: Record<string, unknown>) => c.name === "init");
    expect(work.status).not.toBe("available");
    expect(init.status).toBe("available");
  });

  it("marks LLM-requiring commands available once init dirs and vendor exist", async () => {
    const { writeFile: wf, mkdir: md } = await import("node:fs/promises");
    for (const d of [".rex", ".sourcevision", ".hench"]) {
      await md(join(tmpDir, d), { recursive: true });
    }
    await wf(join(tmpDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }));
    const body = await getManifest();
    const all = body.groups.flatMap((g: { commands: Array<Record<string, unknown>> }) => g.commands);
    expect(all.find((c: Record<string, unknown>) => c.name === "work").status).toBe("available");
    expect(all.find((c: Record<string, unknown>) => c.name === "status").status).toBe("available");
  });

  it("marks LLM-requiring commands available when initialized without an explicit vendor", async () => {
    // The CLI resolves an absent llm.vendor to "claude" (config.js
    // runAuthCheck), so a project that never set a vendor key can still run
    // every LLM command — the manifest must not report needs-llm for it.
    const { mkdir: md } = await import("node:fs/promises");
    for (const d of [".rex", ".sourcevision", ".hench"]) {
      await md(join(tmpDir, d), { recursive: true });
    }
    const body = await getManifest();
    const all = body.groups.flatMap((g: { commands: Array<Record<string, unknown>> }) => g.commands);
    expect(all.find((c: Record<string, unknown>) => c.name === "work").status).toBe("available");
    expect(all.find((c: Record<string, unknown>) => c.name === "status").status).toBe("available");
  });

  it("marks LLM-requiring commands available with an llm section that has only a model", async () => {
    const { writeFile: wf, mkdir: md } = await import("node:fs/promises");
    for (const d of [".rex", ".sourcevision", ".hench"]) {
      await md(join(tmpDir, d), { recursive: true });
    }
    await wf(join(tmpDir, ".n-dx.json"), JSON.stringify({ llm: { claude: { model: "claude-opus-4-6" } } }));
    const body = await getManifest();
    const all = body.groups.flatMap((g: { commands: Array<Record<string, unknown>> }) => g.commands);
    expect(all.find((c: Record<string, unknown>) => c.name === "plan").status).toBe("available");
  });
});

describe("commands route — self-heal stop", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    spawnManagedMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-selfheal-"));
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function statusOnce(): Promise<Record<string, unknown>> {
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/self-heal/status`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  it("409s when asked to stop with nothing running", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/self-heal/stop`, { method: "POST" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(String(body.error)).toMatch(/not running|no self-heal/i);
  });

  it("kills the running loop and records it as stopped", async () => {
    // The child exits on the SIGTERM the stop endpoint sends (a signal
    // death surfaces as a non-zero/null exit code, never exit 0).
    const child = stubManagedChild({
      killFinishes: { exitCode: null, stdout: "iteration 1 of 3\n", stderr: "" },
    });

    const start = await fetch(`http://127.0.0.1:${port}/api/commands/self-heal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iterations: 3 }),
    });
    expect(start.status).toBe(202);
    expect((await statusOnce()).running).toBe(true);

    const stop = await fetch(`http://127.0.0.1:${port}/api/commands/self-heal/stop`, { method: "POST" });
    expect(stop.status).toBe(200);
    expect((await stop.json()).ok).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    for (let i = 0; i < 50; i++) {
      const s = await statusOnce();
      if (!s.running) {
        expect(s.stopped).toBe(true);
        expect(s.finishedAt).toBeTruthy();
        // An operator-requested stop is not an error condition.
        expect(s.error).toBeNull();
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("self-heal did not stop");
  });

  it("streams loop output into status while running", async () => {
    // Regression: the buffered exec() populated `output` only after exit,
    // so SelfHealPanel's iteration/phase progress never rendered mid-run.
    const child = stubManagedChild();

    await fetch(`http://127.0.0.1:${port}/api/commands/self-heal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ iterations: 3 }),
    });

    child.emit("Self-heal iteration 2/3\nPhase: recommend\n");
    const live = await statusOnce();
    expect(live.running).toBe(true);
    expect(String(live.output)).toContain("iteration 2/3");

    child.finish({ exitCode: 0, stdout: "Self-heal complete", stderr: "" });
    for (let i = 0; i < 50; i++) {
      if (!(await statusOnce()).running) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  });
});

describe("commands route — validation actions (fix, ci, reshape)", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-validation-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  function post(path: string, body: unknown = {}) {
    return fetch(`http://127.0.0.1:${port}/api/commands/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function waitFor(path: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/commands/${path}`);
      const body = (await res.json()) as Record<string, unknown>;
      if (!body.running) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`${path} did not finish`);
  }

  // ── rex fix ──
  it("fix previews with --dry-run and returns the parsed report", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify({ fixed: 0, issues: [{ kind: "timestamp", id: "t1" }] }),
      stderr: "", error: null,
    });
    const res = await post("fix", { dryRun: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.report.issues).toHaveLength(1);

    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain("fix");
    expect(args).toContain("--format=json");
    expect(args).toContain("--dry-run");
  });

  it("fix applies without --dry-run", async () => {
    execMock.mockResolvedValue({ stdout: JSON.stringify({ fixed: 3 }), stderr: "", error: null });
    const body = await (await post("fix", {})).json();
    expect(body.dryRun).toBe(false);
    expect(body.report.fixed).toBe(3);
    expect(execMock.mock.calls[0][1] as string[]).not.toContain("--dry-run");
  });

  it("fix falls back to raw output when stdout is not JSON", async () => {
    execMock.mockResolvedValue({ stdout: "fixed 2 timestamps", stderr: "", error: null });
    const body = await (await post("fix", {})).json();
    expect(body.output).toContain("fixed 2 timestamps");
    expect(body.report).toBeUndefined();
  });

  // ── ndx ci ──
  it("ci runs asynchronously and exposes a structured result", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify({ health: 82, findings: 4, passed: true }),
      stderr: "", error: null,
    });
    const res = await post("ci");
    expect(res.status).toBe(202);
    const status = await waitFor("ci/status");
    expect(status.error).toBeNull();
    expect((status.report as Record<string, unknown>).health).toBe(82);
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain("ci");
    expect(args).toContain("--format=json");
  });

  it("ci rejects a concurrent run with 409", async () => {
    let release: (() => void) | undefined;
    execMock.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ stdout: "{}", stderr: "", error: null });
    }));
    expect((await post("ci")).status).toBe(202);
    expect((await post("ci")).status).toBe(409);
    release?.();
    await waitFor("ci/status");
  });

  // ── rex reshape ──
  it("reshape previews with --dry-run by default", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify({ proposals: [{ action: "merge", ids: ["a", "b"] }] }),
      stderr: "", error: null,
    });
    expect((await post("reshape", {})).status).toBe(202);
    const status = await waitFor("reshape/status");
    expect((status.report as { proposals: unknown[] }).proposals).toHaveLength(1);
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain("reshape");
    expect(args).toContain("--dry-run");
    expect(args).not.toContain("--accept");
  });

  it("reshape applies with --accept when confirmed", async () => {
    execMock.mockResolvedValue({ stdout: "{}", stderr: "", error: null });
    await post("reshape", { accept: true });
    await waitFor("reshape/status");
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain("--accept");
    expect(args).not.toContain("--dry-run");
  });

  it("reshape spawns with --quiet so stdout is pure JSON", async () => {
    // Without --quiet, reshape interleaves info() progress prose with the
    // --format=json payload and the report parse below can never succeed.
    execMock.mockResolvedValue({
      stdout: JSON.stringify({ dryRun: true, proposals: [] }),
      stderr: "", error: null,
    });
    await post("reshape", {});
    const status = await waitFor("reshape/status");
    expect(execMock.mock.calls[0][1] as string[]).toContain("--quiet");
    expect((status.report as { proposals: unknown[] }).proposals).toEqual([]);
  });

  it("reshape reports a null report when stdout mixes prose with JSON", async () => {
    // Regression shape for the pre---quiet failure mode: prose before the
    // JSON payload must fall back to raw output, never a bogus parse.
    const mixed = `Analyzing PRD structure...\n${JSON.stringify({ proposals: [{ id: "p1" }] })}`;
    execMock.mockResolvedValue({ stdout: mixed, stderr: "", error: null });
    await post("reshape", {});
    const status = await waitFor("reshape/status");
    expect(status.report).toBeNull();
    expect(status.output).toContain("Analyzing PRD structure...");
  });
});

describe("commands route — tier 3 triggers (auth, validate-tokens, export-pdf)", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "commands-tier3-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startRouteTestServer((req, res) =>
      handleCommandsRoute(req, res, ctx),
    );
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("auth reports ok when the credential check exits cleanly", async () => {
    execMock.mockResolvedValue({ stdout: "claude: credentials OK", stderr: "", error: null, exitCode: 0 });
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/auth`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(String(body.output)).toContain("credentials OK");
    expect(execMock.mock.calls[0][1] as string[]).toContain("auth");
  });

  it("auth reports not-ok with the failure text when credentials are missing", async () => {
    execMock.mockResolvedValue({
      stdout: "", stderr: "No API key found for vendor claude",
      error: new Error("exit 1"), exitCode: 1,
    });
    const body = await (await fetch(`http://127.0.0.1:${port}/api/commands/auth`)).json();
    expect(body.ok).toBe(false);
    expect(String(body.error)).toContain("No API key found");
  });

  it("validate-tokens runs the hench check and returns its output", async () => {
    execMock.mockResolvedValue({ stdout: "token reporting accurate", stderr: "", error: null });
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/validate-tokens`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(String(body.output)).toContain("token reporting accurate");
    expect(execMock.mock.calls[0][1] as string[]).toContain("validate-tokens");
  });

  it("export-pdf reports the written path", async () => {
    execMock.mockResolvedValue({
      stdout: "Wrote .sourcevision/report.pdf", stderr: "", error: null,
    });
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/export-pdf`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(String(body.output)).toContain("report.pdf");
    expect(execMock.mock.calls[0][1] as string[]).toContain("export-pdf");
  });

  it("export-pdf surfaces a failure", async () => {
    execMock.mockResolvedValue({ stdout: "", stderr: "no analysis data", error: new Error("exit 1") });
    const res = await fetch(`http://127.0.0.1:${port}/api/commands/export-pdf`, { method: "POST" });
    expect(res.status).toBe(500);
    expect(String((await res.json()).error)).toContain("no analysis data");
  });
});

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
// `vi.hoisted` makes execMock available inside the hoisted vi.mock factory.
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, exec: execMock };
});

import type { ServerContext } from "../../../src/server/types.js";
import { handleCommandsRoute } from "../../../src/server/routes-commands.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

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
    execMock.mockResolvedValue({
      stdout: "[refresh] starting — 2 steps planned\n[refresh] complete",
      stderr: "",
      error: null,
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);

    await waitForFinish();
    expect(execMock).toHaveBeenCalledTimes(1);
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain("refresh");
    expect(args).toContain("--data-only");
    expect(args).toContain("--live-server");
    expect(args).not.toContain("--fast");
  });

  it("forwards fast mode as --fast", async () => {
    execMock.mockResolvedValue({ stdout: "[refresh] ok", stderr: "", error: null });

    await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fast: true }),
    });
    await waitForFinish();
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain("--fast");
  });

  it("rejects a concurrent refresh with 409 while one is running", async () => {
    let release: (() => void) | undefined;
    execMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ stdout: "[refresh] done", stderr: "", error: null });
        }),
    );

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

    release?.();
    await waitForFinish();
  });

  it("status endpoint exposes phases parsed from [refresh] output", async () => {
    execMock.mockResolvedValue({
      stdout: [
        "[refresh] starting — 2 steps planned",
        "[refresh] state snapshot captured (3 files)",
        "some delegated tool output",
        "[refresh] complete",
      ].join("\n"),
      stderr: "",
      error: null,
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

  it("captures a failure into status.error", async () => {
    execMock.mockResolvedValue({
      stdout: "",
      stderr: "refresh exploded",
      error: new Error("exit 1"),
    });

    await fetch(`http://127.0.0.1:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const status = await waitForFinish();
    expect(String(status.error)).toContain("refresh exploded");
  });
});

describe("commands route — sv-analyze full flow (async)", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
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
    execMock.mockResolvedValue({ stdout: "Phase 1 done\nPass 4 complete", stderr: "", error: null });

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
    const args = execMock.mock.calls[0][1] as string[];
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
    let release: (() => void) | undefined;
    execMock.mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve({ stdout: "done", stderr: "", error: null });
      }),
    );

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

    release?.();
    await waitForFinish();
  });

  it("status exposes recent output lines while and after running", async () => {
    execMock.mockResolvedValue({
      stdout: ["Phase 1: inventory", "Phase 3: zones", "Enrichment pass 4 complete"].join("\n"),
      stderr: "",
      error: null,
    });

    await fetch(`http://127.0.0.1:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: true }),
    });
    const status = await waitForFinish();
    expect(status.recentOutput).toContain("Enrichment pass 4 complete");
  });

  it("targetPass runs async and spawns --target-pass=N without --full", async () => {
    execMock.mockResolvedValue({ stdout: "Enrichment pass 3 complete", stderr: "", error: null });

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
    const args = execMock.mock.calls[0][1] as string[];
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
  });

  it("captures a failed full run into status.error", async () => {
    execMock.mockResolvedValue({ stdout: "", stderr: "no LLM credentials", error: new Error("exit 1") });

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

    const analyze = all.find((c: Record<string, any>) => c.name === "analyze");
    expect(analyze.trigger).toMatchObject({ endpoint: "/api/commands/sv-analyze", method: "POST" });

    const refresh = all.find((c: Record<string, any>) => c.name === "refresh");
    expect(refresh.trigger).toMatchObject({
      endpoint: "/api/commands/refresh",
      method: "POST",
      statusEndpoint: "/api/commands/refresh/status",
    });

    const plan = all.find((c: Record<string, any>) => c.name === "plan");
    expect(plan.trigger).toMatchObject({ endpoint: "/api/rex/analyze", method: "POST" });

    // Excluded by design: work needs task selection; self-heal is
    // confirmation-gated; init/config are terminal-side.
    for (const name of ["work", "self-heal", "init", "config"]) {
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

  it("aborts the running loop and records it as stopped", async () => {
    // Honour the abort signal the handler passes, the way exec does.
    execMock.mockImplementation((_bin: string, _args: string[], opts: { signal?: AbortSignal }) =>
      new Promise((resolve) => {
        opts.signal?.addEventListener("abort", () => {
          const err = new Error("aborted") as Error & { name: string };
          err.name = "AbortError";
          resolve({ stdout: "iteration 1 of 3\n", stderr: "", error: err });
        });
      }),
    );

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

  it("passes an abort signal to the spawned loop", async () => {
    execMock.mockImplementation((_b: string, _a: string[], opts: { signal?: AbortSignal }) => {
      expect(opts.signal).toBeInstanceOf(AbortSignal);
      return Promise.resolve({ stdout: "done", stderr: "", error: null });
    });
    await fetch(`http://127.0.0.1:${port}/api/commands/self-heal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
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

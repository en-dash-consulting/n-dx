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
import { startRouteTestServer } from "../../helpers/server-route-test-support.js";

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
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns recommendations as an array with a matching count", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify(RECOMMENDATIONS),
      stderr: "",
      error: null,
    });

    const res = await fetch(`http://localhost:${port}/api/commands/recommend`, {
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

    const res = await fetch(`http://localhost:${port}/api/commands/recommend`, {
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

    const res = await fetch(`http://localhost:${port}/api/commands/recommend`, {
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
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Poll the status endpoint until running=false (bounded). */
  async function waitForFinish(): Promise<Record<string, unknown>> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://localhost:${port}/api/commands/refresh/status`);
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

    const res = await fetch(`http://localhost:${port}/api/commands/refresh`, {
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

    await fetch(`http://localhost:${port}/api/commands/refresh`, {
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

    const first = await fetch(`http://localhost:${port}/api/commands/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(first.status).toBe(202);

    const second = await fetch(`http://localhost:${port}/api/commands/refresh`, {
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

    await fetch(`http://localhost:${port}/api/commands/refresh`, {
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

    await fetch(`http://localhost:${port}/api/commands/refresh`, {
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
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function waitForFinish(): Promise<Record<string, unknown>> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://localhost:${port}/api/commands/sv-analyze/status`);
      const body = (await res.json()) as Record<string, unknown>;
      if (!body.running) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("full analysis did not finish");
  }

  it("full mode returns 202 and spawns analyze --full in the background", async () => {
    execMock.mockResolvedValue({ stdout: "Phase 1 done\nPass 4 complete", stderr: "", error: null });

    const res = await fetch(`http://localhost:${port}/api/commands/sv-analyze`, {
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

    const res = await fetch(`http://localhost:${port}/api/commands/sv-analyze`, {
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

    const first = await fetch(`http://localhost:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: true }),
    });
    expect(first.status).toBe(202);

    const second = await fetch(`http://localhost:${port}/api/commands/sv-analyze`, {
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

    await fetch(`http://localhost:${port}/api/commands/sv-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full: true }),
    });
    const status = await waitForFinish();
    expect(status.recentOutput).toContain("Enrichment pass 4 complete");
  });

  it("captures a failed full run into status.error", async () => {
    execMock.mockResolvedValue({ stdout: "", stderr: "no LLM credentials", error: new Error("exit 1") });

    await fetch(`http://localhost:${port}/api/commands/sv-analyze`, {
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
    server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function getManifest(): Promise<Record<string, any>> {
    const res = await fetch(`http://localhost:${port}/api/commands/manifest`);
    expect(res.status).toBe(200);
    return res.json() as Promise<Record<string, any>>;
  }

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

  it("defaults invocations to ndx without cli.name", async () => {
    const body = await getManifest();
    expect(body.cliName).toBe("ndx");
    expect(body.groups[0].commands[0].invocation.startsWith("ndx ")).toBe(true);
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

  it("marks LLM-requiring commands needs-llm when initialized without a vendor", async () => {
    const { mkdir: md } = await import("node:fs/promises");
    for (const d of [".rex", ".sourcevision", ".hench"]) {
      await md(join(tmpDir, d), { recursive: true });
    }
    const body = await getManifest();
    const all = body.groups.flatMap((g: { commands: Array<Record<string, unknown>> }) => g.commands);
    expect(all.find((c: Record<string, unknown>) => c.name === "work").status).toBe("needs-llm");
    expect(all.find((c: Record<string, unknown>) => c.name === "status").status).toBe("available");
  });
});

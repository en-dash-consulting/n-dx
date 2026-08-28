/**
 * Unit tests for POST /api/rex/analyze and GET /api/rex/analyze/status.
 *
 * Regression: `handleAnalyze` used to be fully synchronous — the caller
 * awaited one `foundationExec` call with a hardcoded 120s timeout. On a real
 * (non-trivial) project, `rex analyze` with LLM refinement is a genuine
 * multi-minute operation, so it reliably timed out. Worse, being
 * synchronous meant any page reload or dropped connection during the wait
 * discarded the entire (costly) result — nothing else in the codebase's
 * other slow LLM commands (sv-analyze full pass, self-heal, reshape, ci)
 * works that way; they all run as a background job with a status-poll
 * endpoint. This suite locks in the converted async-job behavior and the
 * timeout-config wiring.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));
vi.mock("@n-dx/llm-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@n-dx/llm-client")>();
  return { ...actual, exec: execMock };
});

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const result = handleRexRoute(req, res, ctx);
      if (result instanceof Promise) {
        if (await result) return;
      } else if (result) {
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

describe("POST /api/rex/analyze (background job)", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    execMock.mockReset();
    tmpDir = await mkdtemp(join(tmpdir(), "rex-analyze-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir: join(tmpDir, ".rex"),
      dev: false,
    };
    const started = await startTestServer(ctx);
    server = started.server;
    port = started.port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  function post(path: string, body: unknown = {}) {
    return fetch(`http://127.0.0.1:${port}/api/rex/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function waitForStatus(): Promise<Record<string, unknown>> {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/rex/analyze/status`);
      const body = (await res.json()) as Record<string, unknown>;
      if (!body.running) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("analyze/status did not finish");
  }

  it("starts as a 202 background job and exposes the parsed proposals via status", async () => {
    execMock.mockResolvedValue({
      stdout: JSON.stringify({ proposals: [{ epic: { title: "Epic A" }, features: [] }] }),
      stderr: "", error: null,
    });

    const res = await post("analyze", {});
    expect(res.status).toBe(202);
    const started = await res.json();
    expect(started.ok).toBe(true);
    expect(started.startedAt).toBeTruthy();

    const status = await waitForStatus();
    expect(status.error).toBeNull();
    const report = status.report as { proposals: Array<{ epic: { title: string } }> };
    expect(report.proposals).toHaveLength(1);
    expect(report.proposals[0].epic.title).toBe("Epic A");
  });

  it("rejects a concurrent run with 409 instead of starting a second subprocess", async () => {
    let release: (() => void) | undefined;
    execMock.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ stdout: "{}", stderr: "", error: null });
    }));
    expect((await post("analyze", {})).status).toBe(202);
    expect((await post("analyze", {})).status).toBe(409);
    release?.();
    await waitForStatus();
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  it("passes --accept, --no-llm, --lite flags through to the CLI", async () => {
    execMock.mockResolvedValue({ stdout: JSON.stringify({ proposals: [] }), stderr: "", error: null });
    await post("analyze", { accept: true, noLlm: true, lite: true });
    await waitForStatus();
    const args = execMock.mock.calls[0][1] as string[];
    expect(args).toContain("analyze");
    expect(args).toContain("--format=json");
    expect(args).toContain("--accept");
    expect(args).toContain("--no-llm");
    expect(args).toContain("--lite");
  });

  it("broadcasts rex:prd-changed only when --accept was requested", async () => {
    execMock.mockResolvedValue({ stdout: JSON.stringify({ proposals: [] }), stderr: "", error: null });
    const broadcasts: Array<{ type: string }> = [];
    const ctxWithBroadcast = ctx;
    const started = await new Promise<{ server: Server; port: number }>((resolve) => {
      const srv = createServer(async (req, res) => {
        const result = handleRexRoute(req, res, ctxWithBroadcast, (msg) => broadcasts.push(msg as { type: string }));
        if (result instanceof Promise) { if (await result) return; } else if (result) return;
        res.writeHead(404); res.end("Not found");
      });
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        resolve({ server: srv, port: typeof addr === "object" && addr ? addr.port : 0 });
      });
    });

    await fetch(`http://127.0.0.1:${started.port}/api/rex/analyze`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accept: true }),
    });
    for (let i = 0; i < 50; i++) {
      const s = await (await fetch(`http://127.0.0.1:${started.port}/api/rex/analyze/status`)).json();
      if (!s.running) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await closeRouteTestServer(started.server);

    expect(broadcasts.some((b) => b.type === "rex:prd-changed")).toBe(true);
  });

  it("resolves the analyze timeout via the 'plan' CLI-timeouts key, not 'analyze'", async () => {
    // The CLI Timeouts settings page's "analyze" entry documents sourcevision
    // static analysis (a different command/handler); this endpoint spawns
    // `rex analyze` directly, which is the settings page's "plan" entry.
    // Setting only cli.timeouts.plan must change the timeout passed through;
    // the untouched default otherwise applies.
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ cli: { timeouts: { plan: 42_000 } } }),
    );
    execMock.mockResolvedValue({ stdout: JSON.stringify({ proposals: [] }), stderr: "", error: null });

    await post("analyze", {});
    await waitForStatus();

    const opts = execMock.mock.calls[0][2] as { timeout: number };
    expect(opts.timeout).toBe(42_000);
  });

  it("falls back to the 30-minute default timeout when unconfigured", async () => {
    execMock.mockResolvedValue({ stdout: JSON.stringify({ proposals: [] }), stderr: "", error: null });
    await post("analyze", {});
    await waitForStatus();
    const opts = execMock.mock.calls[0][2] as { timeout: number };
    expect(opts.timeout).toBe(1_800_000);
  });

  it("reports status.error when the CLI exits non-zero with no parseable output", async () => {
    execMock.mockResolvedValue({ stdout: "", stderr: "boom", error: new Error("exit 1") });
    await post("analyze", {});
    const status = await waitForStatus();
    expect(status.error).toContain("boom");
    expect(status.report).toBeNull();
  });
});

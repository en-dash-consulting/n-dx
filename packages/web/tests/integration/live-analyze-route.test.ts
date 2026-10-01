/**
 * GET /api/live/analyze and POST /api/live/analyze/stop.
 *
 * The progress file is written by hand, the way the analyzing process writes
 * it, so the route is exercised for a run this server never started — the
 * terminal case, which has no slot, no stdout and only a pid to stop by.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerContext } from "../../src/server/types.js";
import {
  buildLiveAnalyzeSnapshot,
  clearLiveAnalyzeCaches,
  handleLiveAnalyzeRoute,
  priceAnalyzeUsage,
  type LiveAnalyzeSnapshot,
} from "../../src/server/routes-live-analyze.js";
import { readAnalyzeProgress, analyzeProgressPath } from "../../src/server/domain-gateway.js";
import type { LiveSources } from "../../src/server/routes-live.js";
import { startRouteTestServer, type RouteTestServer } from "../helpers/server-route-test-support.js";
import { removeTempDir } from "../helpers/temp-dir.js";

const STARTED = "2026-10-01T10:00:00.000Z";

let root: string;
let svDir: string;
let ctx: ServerContext;
let sources: LiveSources;
let server: RouteTestServer | null = null;
let child: ChildProcess | null = null;

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

function writeProgress(over: Record<string, unknown> = {}): void {
  writeJson(analyzeProgressPath(svDir), {
    version: 1,
    pid: process.pid,
    status: "running",
    mode: "generative",
    scope: null,
    startedAt: STARTED,
    updatedAt: STARTED,
    command: "sv analyze --full",
    phase: { index: 2, name: "imports", total: 6 },
    phases: [
      { index: 1, name: "inventory", startedAt: STARTED, endedAt: "2026-10-01T10:00:20.000Z", durationMs: 20_000, outcome: "ok" },
      { index: 2, name: "imports", startedAt: "2026-10-01T10:00:20.000Z" },
    ],
    pass: null,
    batch: null,
    judgmentCache: { hits: 0, misses: 0 },
    llm: { calls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, byTaskClass: {} },
    ...over,
  });
}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-live-analyze-")));
  svDir = join(root, ".sourcevision");
  mkdirSync(svDir, { recursive: true });
  ctx = { projectDir: root, svDir, rexDir: join(root, ".rex"), dev: false, workspace: "main" };
  sources = { listWorkspaces: () => [{ key: "main", path: root, branch: "feat/x", isAnchor: true }], memoryFloorBytes: () => 1 };
  clearLiveAnalyzeCaches();
});

afterEach(async () => {
  child?.kill("SIGKILL");
  child = null;
  await server?.close();
  server = null;
  await removeTempDir(root);
});

describe("GET /api/live/analyze", () => {
  it("answers an empty worktree with no progress and no history", () => {
    const snapshot = buildLiveAnalyzeSnapshot(ctx, sources);
    expect(snapshot.progress).toBeNull();
    expect(snapshot.startedFrom).toBeNull();
    expect(snapshot.output).toEqual({ available: false, lines: [] });
    expect(snapshot.modules).toEqual([]);
    expect(snapshot.recent).toEqual([]);
    expect(snapshot.worktree).toMatchObject({ key: "main", branch: "feat/x", isAnchor: true, isServed: true });
  });

  it("reports a terminal-started run from its progress file, with the previous same-mode run's timings", () => {
    writeProgress();
    // The history file is appended to: oldest first, newest last.
    mkdirSync(join(svDir, ".cache"), { recursive: true });
    writeFileSync(join(svDir, ".cache", "analyses.jsonl"), [
      JSON.stringify({ at: "2026-09-29T10:00:00.000Z", mode: "fast", durationMs: 9_000, phases: {}, llm: { byTaskClass: {} } }),
      "not json",
      JSON.stringify({ at: "2026-09-30T10:00:00.000Z", mode: "generative", durationMs: 250_000, phases: { inventory: 25_000 }, llm: { byTaskClass: { enrich: { calls: 4 } }, costUsd: 0.5 } }),
    ].join("\n") + "\n");
    const snapshot = buildLiveAnalyzeSnapshot(ctx, sources);
    expect(snapshot.progress).toMatchObject({ running: true, command: "sv analyze --full", previous: { durationMs: 250_000, phases: { inventory: 25_000 } } });
    expect(snapshot.startedFrom).toBe("terminal");
    // A terminal run's stdout is not ours to show.
    expect(snapshot.output.available).toBe(false);
    expect(snapshot.recent.map((r) => [r.mode, r.calls, r.costUsd])).toEqual([["generative", 4, 0.5], ["fast", 0, null]]);
  });

  it("describes a phase from the file this run wrote, and not from the previous run's", () => {
    writeProgress();
    const inventory = join(svDir, "inventory.json");
    writeJson(inventory, { files: [], summary: { totalFiles: 1204, byLanguage: { TypeScript: 812, JavaScript: 201, Markdown: 5, YAML: 1 } } });
    expect(buildLiveAnalyzeSnapshot(ctx, sources).results.inventory).toBe("1,204 files · TypeScript 812, JavaScript 201, Markdown 5");

    clearLiveAnalyzeCaches();
    const before = new Date("2026-09-30T09:00:00.000Z");
    utimesSync(inventory, before, before);
    expect(buildLiveAnalyzeSnapshot(ctx, sources).results).toEqual({});
  });

  it("carries the enrichment pass zones.json records once the zones phase has ended", () => {
    writeProgress({
      phase: null,
      phases: [{ index: 4, name: "zones", startedAt: STARTED, endedAt: "2026-10-01T10:01:00.000Z", durationMs: 60_000, outcome: "ok" }],
    });
    writeJson(join(svDir, "zones.json"), { zones: [{ id: "a" }, { id: "b" }], enrichmentPass: 3 });
    const snapshot = buildLiveAnalyzeSnapshot(ctx, sources);
    expect(snapshot.results.zones).toBe("2 zones");
    expect(snapshot.enrichmentPass).toBe(3);
  });

  it("lists manifest modules and background narration", () => {
    writeJson(join(svDir, "manifest.json"), {
      modules: { inventory: { status: "complete", completedAt: "2026-10-01T10:00:20.000Z" }, zones: { status: "error", error: "boom" } },
      narration: { status: "pending", zones: ["a", "b"], names: ["c"] },
    });
    const snapshot = buildLiveAnalyzeSnapshot(ctx, sources);
    expect(snapshot.modules).toEqual([
      { name: "inventory", status: "complete", startedAt: null, completedAt: "2026-10-01T10:00:20.000Z", error: null },
      { name: "zones", status: "error", startedAt: null, completedAt: null, error: "boom" },
    ]);
    expect(snapshot.narration).toEqual({ status: "pending", zones: 3, reason: null });
  });

  it("prices the run's model use per task class", () => {
    expect(priceAnalyzeUsage(null)).toBe(0);
    writeProgress({
      llm: {
        calls: 1, inputTokens: 1_000_000, outputTokens: 0, durationMs: 1,
        byTaskClass: { enrich: { calls: 1, inputTokens: 1_000_000, outputTokens: 0, durationMs: 1, vendor: "claude", model: "claude-sonnet-4-5" } },
      },
    });
    expect(buildLiveAnalyzeSnapshot(ctx, sources).costUsd).toBeGreaterThan(0);
  });

  it("is served as JSON on its path only", async () => {
    writeProgress();
    server = await startRouteTestServer(async (req, res) => handleLiveAnalyzeRoute(req, res, ctx, sources));
    const res = await fetch(`${server.baseUrl}/api/live/analyze`);
    expect(res.status).toBe(200);
    const body = await res.json() as LiveAnalyzeSnapshot;
    expect(body.progress?.running).toBe(true);
    expect((await fetch(`${server.baseUrl}/api/live/other`)).status).toBe(404);
  });
});

describe("POST /api/live/analyze/stop", () => {
  async function post(): Promise<Response> {
    server ??= await startRouteTestServer(async (req, res) => handleLiveAnalyzeRoute(req, res, ctx, sources));
    return fetch(`${server.baseUrl}/api/live/analyze/stop`, { method: "POST" });
  }

  it("refuses when nothing is running", async () => {
    expect((await post()).status).toBe(409);
    writeProgress({ status: "complete" });
    expect((await post()).status).toBe(409);
  });

  it("refuses a progress file whose process is gone", async () => {
    writeProgress({ pid: 2_147_483_000 });
    expect(readAnalyzeProgress(svDir)?.status).toBe("interrupted");
    expect((await post()).status).toBe(409);
  });

  it("signals the process the progress file names", async () => {
    child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    const exited = new Promise<NodeJS.Signals | null>((resolve) => child!.once("exit", (_code, signal) => resolve(signal)));
    writeProgress({ pid: child.pid });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await exited).toBe("SIGTERM");
  });

  it("never signals the server's own process", async () => {
    writeProgress({ pid: process.pid });
    const res = await post();
    expect(res.status).toBe(409);
  });
});

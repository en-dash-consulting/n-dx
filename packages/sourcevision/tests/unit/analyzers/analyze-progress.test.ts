import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeProgressPath,
  startAnalyzeProgress,
  finishAnalyzeProgress,
  isAnalyzeProgressActive,
  markPhaseStarted,
  markPhaseEnded,
  markPass,
  markBatch,
  markScope,
  noteAnalyzeError,
  openRootPhase,
  readAnalyzeProgress,
  readProcessCommandLine,
  isAnalyzeCommandLine,
  ANALYZE_PROGRESS_WRITE_INTERVAL_MS,
} from "../../../src/analyzers/analyze-progress.js";
import type { AnalyzeProgress } from "../../../src/analyzers/analyze-progress.js";
import { startRunLedger, recordLLMCall, recordJudgmentCache, setRunMode, snapshotRunLedger } from "../../../src/analyzers/run-ledger.js";

let svDir: string;

function onDisk(): AnalyzeProgress {
  return JSON.parse(readFileSync(analyzeProgressPath(svDir), "utf-8")) as AnalyzeProgress;
}

beforeEach(() => {
  svDir = mkdtempSync(join(tmpdir(), "sv-progress-"));
  startRunLedger("generative");
});

afterEach(() => {
  if (isAnalyzeProgressActive()) finishAnalyzeProgress("complete");
  vi.useRealTimers();
  rmSync(svDir, { recursive: true, force: true });
});

describe("analyze progress file", () => {
  it("lives under .cache and is written as soon as the run starts", () => {
    expect(analyzeProgressPath(svDir)).toBe(join(svDir, ".cache", "analyze-progress.json"));
    expect(startAnalyzeProgress(svDir)).toBe(true);
    const p = onDisk();
    expect(p).toMatchObject({ version: 1, pid: process.pid, status: "running", mode: "generative", scope: null, phase: null, pass: null, batch: null });
    expect(p.phases).toEqual([]);
    expect(Date.parse(p.startedAt)).not.toBeNaN();
  });

  it("starts at the ledger's start, so the run's own history line is never its 'previous'", () => {
    vi.useFakeTimers();
    startRunLedger("generative");
    const ledgerAt = snapshotRunLedger().at;
    vi.advanceTimersByTime(5);
    startAnalyzeProgress(svDir);
    expect(onDisk().startedAt).toBe(ledgerAt);
  });

  it("is owned by the outermost run only, so a nested analyze does not replace it", () => {
    expect(startAnalyzeProgress(svDir)).toBe(true);
    const other = mkdtempSync(join(tmpdir(), "sv-progress-nested-"));
    try {
      expect(startAnalyzeProgress(other)).toBe(false);
      expect(existsSync(analyzeProgressPath(other))).toBe(false);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("records the current phase and every phase's start, end and duration", () => {
    startAnalyzeProgress(svDir);
    markPhaseStarted(1, "inventory");
    expect(onDisk().phase).toEqual({ index: 1, name: "inventory", total: 6 });
    markPhaseEnded("inventory", "ok");
    markPhaseStarted(4, "zones");

    const p = onDisk();
    expect(p.phase).toEqual({ index: 4, name: "zones", total: 6 });
    expect(p.phases).toHaveLength(2);
    expect(p.phases[0]).toMatchObject({ index: 1, name: "inventory", outcome: "ok" });
    expect(p.phases[0].endedAt).toBeDefined();
    expect(p.phases[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(p.phases[1]).toMatchObject({ index: 4, name: "zones" });
    expect(p.phases[1].endedAt).toBeUndefined();
  });

  it("records the enrichment pass with its label and the batch k of n, cleared by the next phase", () => {
    startAnalyzeProgress(svDir);
    markPhaseStarted(4, "zones");
    markPass(3);
    markBatch("enrich", 1, 4);
    let p = onDisk();
    expect(p.pass).toEqual({ number: 3, label: "LLM anti-pattern detection" });
    expect(p.batch).toEqual({ label: "enrich", done: 1, total: 4 });

    markPhaseStarted(5, "components");
    p = onDisk();
    expect(p.pass).toBeNull();
    expect(p.batch).toBeNull();
  });

  it("names the sub-package a --deep run is analyzing and restarts the phase list for it", () => {
    startAnalyzeProgress(svDir);
    markScope("packages/a");
    markPhaseStarted(1, "inventory");
    expect(onDisk()).toMatchObject({ scope: "packages/a", phase: { index: 1 } });
    markScope(null);
    const p = onDisk();
    expect(p.scope).toBeNull();
    expect(p.phase).toBeNull();
    expect(p.phases).toEqual([]);
  });

  it("carries the ledger's mode, LLM calls per task class and judgment-cache counts", () => {
    startAnalyzeProgress(svDir);
    setRunMode("cascade");
    recordJudgmentCache(3, 1);
    recordLLMCall({ taskClass: "zone.judge", vendor: "typesafe", model: "jev-1", tokenUsage: { input: 100, output: 4 }, durationMs: 800 });
    finishAnalyzeProgress("complete");

    const p = onDisk();
    expect(p.mode).toBe("cascade");
    expect(p.judgmentCache).toEqual({ hits: 3, misses: 1 });
    expect(p.llm.byTaskClass["zone.judge"]).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 4, durationMs: 800 });
    expect(p.llm).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 4, durationMs: 800 });
  });

  it("writes a ledger change at once, coalescing a burst into one trailing write", () => {
    vi.useFakeTimers();
    startAnalyzeProgress(svDir);
    vi.advanceTimersByTime(ANALYZE_PROGRESS_WRITE_INTERVAL_MS);
    recordLLMCall({ taskClass: "a", vendor: "v", model: "m", durationMs: 1 });
    expect(onDisk().llm.calls).toBe(1);
    recordLLMCall({ taskClass: "a", vendor: "v", model: "m", durationMs: 1 });
    recordLLMCall({ taskClass: "a", vendor: "v", model: "m", durationMs: 1 });
    expect(onDisk().llm.calls).toBe(1);
    vi.advanceTimersByTime(ANALYZE_PROGRESS_WRITE_INTERVAL_MS);
    expect(onDisk().llm.calls).toBe(3);
  });

  it("is marked finished with an end time, closing any open phase", () => {
    startAnalyzeProgress(svDir);
    markPhaseStarted(2, "imports");
    finishAnalyzeProgress("failed");
    const p = onDisk();
    expect(p.status).toBe("failed");
    expect(p.endedAt).toBeDefined();
    expect(p.phase).toBeNull();
    expect(p.phases[0]).toMatchObject({ name: "imports", outcome: "failed" });
    expect(isAnalyzeProgressActive()).toBe(false);
  });

  it("is marked failed when the process exits without finishing (process.exit skips finally blocks)", () => {
    const before = new Set(process.listeners("exit"));
    startAnalyzeProgress(svDir);
    const added = process.listeners("exit").filter((l) => !before.has(l));
    expect(added).toHaveLength(1);
    // Invoke only the progress module's listener: emitting a real "exit" would
    // run the test worker's own listeners too.
    (added[0] as (code: number) => void)(1);
    expect(onDisk().status).toBe("failed");
    expect(isAnalyzeProgressActive()).toBe(false);

    // Finishing normally removes the listener again.
    startAnalyzeProgress(svDir);
    finishAnalyzeProgress("complete");
    expect(process.listeners("exit").filter((l) => !before.has(l))).toHaveLength(0);
  });

  it("ignores markers when no run owns the file", () => {
    markPhaseStarted(1, "inventory");
    markPass(2);
    markBatch("classify", 0, 2);
    expect(existsSync(analyzeProgressPath(svDir))).toBe(false);
  });
});

describe("analyze progress: command and error", () => {
  it("records the command the run was started with", () => {
    startAnalyzeProgress(svDir, "sv analyze --deep");
    expect(onDisk().command).toBe("sv analyze --deep");
  });

  it("omits command and error when none were given", () => {
    startAnalyzeProgress(svDir);
    const p = onDisk();
    expect(p).not.toHaveProperty("command");
    expect(p).not.toHaveProperty("error");
  });

  it("keeps the error line and the failed phase in the final write", () => {
    startAnalyzeProgress(svDir);
    markPhaseStarted(4, "zones");
    noteAnalyzeError("Phase 4 failed: rate limited");
    finishAnalyzeProgress("failed");
    const p = onDisk();
    expect(p).toMatchObject({ status: "failed", error: "Phase 4 failed: rate limited" });
    expect(p.phases[0]).toMatchObject({ name: "zones", outcome: "failed" });
  });

  it("names the open root phase, and none inside a --deep sub-package or between phases", () => {
    startAnalyzeProgress(svDir);
    expect(openRootPhase()).toBeNull();
    markPhaseStarted(2, "imports");
    expect(openRootPhase()).toBe("imports");
    markPhaseEnded("imports", "ok");
    expect(openRootPhase()).toBeNull();
    markScope("packages/a");
    markPhaseStarted(1, "inventory");
    expect(openRootPhase()).toBeNull();
  });

  it("ignores an error noted while no run owns the file", () => {
    expect(() => noteAnalyzeError("nobody is listening")).not.toThrow();
    expect(openRootPhase()).toBeNull();
  });
});

describe("readAnalyzeProgress", () => {
  function writeProgress(p: Partial<AnalyzeProgress>): void {
    mkdirSync(join(svDir, ".cache"), { recursive: true });
    const base: AnalyzeProgress = {
      version: 1, pid: 4242, status: "running", mode: "generative", scope: null,
      startedAt: "2026-09-30T12:00:00.000Z", updatedAt: "2026-09-30T12:00:05.000Z",
      phase: { index: 4, name: "zones", total: 6 }, phases: [], pass: null, batch: null,
      judgmentCache: { hits: 0, misses: 0 },
      llm: { calls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, byTaskClass: {} },
    };
    writeFileSync(analyzeProgressPath(svDir), JSON.stringify({ ...base, ...p }));
  }

  function writeHistory(lines: object[]): void {
    mkdirSync(join(svDir, ".cache"), { recursive: true });
    writeFileSync(join(svDir, ".cache", "analyses.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }

  it("returns null when no analysis has written progress", () => {
    expect(readAnalyzeProgress(svDir)).toBeNull();
  });

  it("returns null for a file it cannot parse rather than throwing", () => {
    mkdirSync(join(svDir, ".cache"), { recursive: true });
    writeFileSync(analyzeProgressPath(svDir), "{ half-written");
    expect(readAnalyzeProgress(svDir)).toBeNull();
  });

  const analyzeCommand = () => "node /repo/packages/sourcevision/dist/cli/index.js analyze --deep .";

  it("reports a running file whose pid is alive and is an analyze as running", () => {
    writeProgress({});
    const r = readAnalyzeProgress(svDir, { isPidAlive: () => true, processCommandLine: analyzeCommand })!;
    expect(r).toMatchObject({ status: "running", running: true, stale: false, pidReusedBy: null });
  });

  it("reports a running file whose pid now belongs to another program as interrupted", () => {
    writeProgress({});
    const r = readAnalyzeProgress(svDir, { isPidAlive: () => true, processCommandLine: () => "/usr/bin/vim notes.txt" })!;
    expect(r).toMatchObject({ status: "interrupted", running: false, stale: true, pidReusedBy: "/usr/bin/vim notes.txt" });
  });

  it("trusts liveness alone when the command line cannot be read", () => {
    writeProgress({});
    const r = readAnalyzeProgress(svDir, { isPidAlive: () => true, processCommandLine: () => null })!;
    expect(r).toMatchObject({ status: "running", running: true, pidReusedBy: null });
  });

  it("never reports a dead pid's file as running", () => {
    writeProgress({});
    const r = readAnalyzeProgress(svDir, { isPidAlive: () => false })!;
    expect(r).toMatchObject({ status: "interrupted", running: false, stale: true, phase: { name: "zones" } });
  });

  it("leaves a finished file finished whatever its pid", () => {
    writeProgress({ status: "complete", endedAt: "2026-09-30T12:09:00.000Z" });
    const r = readAnalyzeProgress(svDir, { isPidAlive: () => true })!;
    expect(r).toMatchObject({ status: "complete", running: false, stale: false });
  });

  it("returns the per-phase timings of the latest earlier run of the same mode", () => {
    writeHistory([
      { at: "2026-09-29T10:00:00.000Z", mode: "generative", durationMs: 100, phases: { zones: 90 }, llm: { byTaskClass: {} } },
      { at: "2026-09-29T11:00:00.000Z", mode: "cascade", durationMs: 50, phases: { zones: 40 }, llm: { byTaskClass: {} } },
      { at: "2026-09-29T12:00:00.000Z", mode: "generative", durationMs: 200, phases: { inventory: 10, zones: 180 }, llm: { byTaskClass: {} } },
      // This run's own line (written when it finished) and anything later are not "previous".
      { at: "2026-09-30T12:00:00.000Z", mode: "generative", durationMs: 300, phases: { zones: 290 }, llm: { byTaskClass: {} } },
    ]);
    writeProgress({ status: "complete" });
    expect(readAnalyzeProgress(svDir)!.previous).toEqual({
      at: "2026-09-29T12:00:00.000Z", durationMs: 200, phases: { inventory: 10, zones: 180 },
    });
  });

  it("has no previous run when the history holds none of this mode, or is unreadable", () => {
    writeProgress({ mode: "fast" });
    expect(readAnalyzeProgress(svDir, { isPidAlive: () => true, processCommandLine: analyzeCommand })!.previous).toBeNull();
    writeFileSync(join(svDir, ".cache", "analyses.jsonl"), "not json\n");
    expect(readAnalyzeProgress(svDir, { isPidAlive: () => true, processCommandLine: analyzeCommand })!.previous).toBeNull();
  });
});

describe("isAnalyzeCommandLine", () => {
  it.each([
    "node /repo/packages/sourcevision/dist/cli/index.js analyze --deep /repo",
    "/usr/local/bin/node /opt/lib/node_modules/@n-dx/core/node_modules/@n-dx/sourcevision/dist/cli/index.js analyze .",
    "node /usr/local/bin/sv analyze --full",
    "node /repo/packages/core/bin/sourcevision.js analyze .",
    "sourcevision analyze",
    "node C:\\repo\\packages\\sourcevision\\dist\\cli\\index.js analyze .",
  ])("accepts %s", (command) => {
    expect(isAnalyzeCommandLine(command)).toBe(true);
  });

  it.each([
    "/usr/bin/vim notes.txt",
    "node /repo/packages/sourcevision/dist/cli/index.js serve .",
    "python analyze.py",
    "node /repo/tools/analyze",
  ])("rejects %s", (command) => {
    expect(isAnalyzeCommandLine(command)).toBe(false);
  });
});

describe.skipIf(process.platform === "win32")("readProcessCommandLine", () => {
  it("reads a live process's command line", () => {
    expect(readProcessCommandLine(process.pid)).toContain("node");
  });

  it("cannot tell for a pid with no process", () => {
    expect(readProcessCommandLine(2_147_483_000)).toBeNull();
    expect(readProcessCommandLine(0)).toBeNull();
  });
});

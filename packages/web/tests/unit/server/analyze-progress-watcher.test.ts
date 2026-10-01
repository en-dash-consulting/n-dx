import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watchAnalyzeProgress, ANALYZE_PROGRESS_POLL_MS } from "../../../src/server/analyze-progress-watcher.js";
import { analyzeProgressPath } from "../../../src/server/domain-gateway.js";

let svDir: string;
let timer: ReturnType<typeof setInterval> | undefined;
const analyzeCommand = () => "node /repo/packages/sourcevision/dist/cli/index.js analyze .";

function writeProgress(fields: Record<string, unknown>): void {
  mkdirSync(join(svDir, ".cache"), { recursive: true });
  writeFileSync(analyzeProgressPath(svDir), JSON.stringify({
    version: 1, pid: 4242, status: "running", mode: "generative", scope: null,
    startedAt: "2026-09-30T12:00:00.000Z", updatedAt: "2026-09-30T12:00:00.000Z",
    phase: { index: 4, name: "zones", total: 6 }, phases: [], pass: null, batch: null,
    judgmentCache: { hits: 0, misses: 0 },
    llm: { calls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0, byTaskClass: {} },
    ...fields,
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  // Just after the fixtures' updatedAt, so none is past the heartbeat window.
  vi.setSystemTime(new Date("2026-09-30T12:00:05.000Z"));
  svDir = mkdtempSync(join(tmpdir(), "web-sv-progress-"));
});

afterEach(() => {
  if (timer) clearInterval(timer);
  timer = undefined;
  vi.useRealTimers();
  rmSync(svDir, { recursive: true, force: true });
});

describe("watchAnalyzeProgress", () => {
  it("polls often enough to report a change within 2 seconds", () => {
    expect(ANALYZE_PROGRESS_POLL_MS).toBeLessThanOrEqual(1000);
  });

  it("does not announce the state it found at startup", () => {
    writeProgress({ status: "complete" });
    const broadcast = vi.fn();
    timer = watchAnalyzeProgress(svDir, broadcast);
    vi.advanceTimersByTime(ANALYZE_PROGRESS_POLL_MS * 3);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("pushes the report when a run appears, and again on each change", () => {
    const broadcast = vi.fn();
    timer = watchAnalyzeProgress(svDir, broadcast, { isPidAlive: () => true, processCommandLine: analyzeCommand });

    // No .cache/ yet — the first analysis creates it while we watch.
    writeProgress({ updatedAt: "2026-09-30T12:00:01.000Z" });
    vi.advanceTimersByTime(ANALYZE_PROGRESS_POLL_MS);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0]).toMatchObject({
      type: "sv:analyze-progress",
      progress: { status: "running", running: true, phase: { name: "zones" } },
    });

    writeProgress({ updatedAt: "2026-09-30T12:00:02.000Z", pass: { number: 2, label: "x" }, batch: { label: "zone enrichment", done: 1, total: 3 } });
    vi.advanceTimersByTime(ANALYZE_PROGRESS_POLL_MS);
    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[1][0].progress).toMatchObject({ pass: { number: 2 }, batch: { done: 1, total: 3 } });

    // Nothing changed: nothing pushed.
    vi.advanceTimersByTime(ANALYZE_PROGRESS_POLL_MS * 3);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it("pushes 'interrupted' when the analyzing process dies without touching the file", () => {
    let alive = true;
    writeProgress({});
    const broadcast = vi.fn();
    timer = watchAnalyzeProgress(svDir, broadcast, { isPidAlive: () => alive, processCommandLine: analyzeCommand });
    vi.advanceTimersByTime(ANALYZE_PROGRESS_POLL_MS);
    expect(broadcast).not.toHaveBeenCalled();

    alive = false;
    vi.advanceTimersByTime(ANALYZE_PROGRESS_POLL_MS);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0].progress).toMatchObject({ status: "interrupted", running: false, stale: true });
  });

  it("pushes 'interrupted' when the recorded pid passes to another program", () => {
    let command = analyzeCommand();
    writeProgress({});
    const broadcast = vi.fn();
    timer = watchAnalyzeProgress(svDir, broadcast, { isPidAlive: () => true, processCommandLine: () => command });
    vi.advanceTimersByTime(ANALYZE_PROGRESS_POLL_MS);
    expect(broadcast).not.toHaveBeenCalled();

    command = "/usr/bin/vim notes.txt";
    vi.advanceTimersByTime(ANALYZE_PROGRESS_POLL_MS);
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0].progress).toMatchObject({ status: "interrupted", running: false, pidReusedBy: command });
  });

  it("returns an unref'd interval so it never holds the server open", () => {
    timer = watchAnalyzeProgress(svDir, vi.fn());
    expect(timer.hasRef()).toBe(false);
  });
});

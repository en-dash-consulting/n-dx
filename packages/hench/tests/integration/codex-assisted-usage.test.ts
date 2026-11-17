import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cmdUsage } from "../../src/cli/commands/usage.js";
import { cmdRecord } from "../../src/cli/commands/record.js";
import { listRuns } from "../../src/store/runs.js";
import { loadUsageCursor, resolveTranscriptPath } from "../../src/store/session-usage.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/index.js";

// Synthetic rollout envelopes from the public Codex protocol. No content or auth.
const meta = (id = "session-a") => JSON.stringify({ type: "session_meta", payload: { id } });
const usage = (n: number) => JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: {
  total_token_usage: { input_tokens: n * 10, cached_input_tokens: n * 4, output_tokens: n * 2, reasoning_output_tokens: n },
} } });

describe("Codex assisted marks through record persistence", () => {
  let dir: string, home: string, transcript: string, henchDir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(process.cwd(), ".test-codex-usage-"));
    home = join(dir, "codex");
    const rollouts = join(home, "sessions", "2026", "11", "16");
    await mkdir(rollouts, { recursive: true });
    transcript = join(rollouts, "rollout-2026-11-16T00-00-00-session-a.jsonl");
    henchDir = join(dir, ".hench");
    await mkdir(henchDir);
    await writeFile(join(henchDir, "config.json"), JSON.stringify(DEFAULT_HENCH_CONFIG()));
    vi.stubEnv("CODEX_HOME", home);
    vi.stubEnv("CODEX_THREAD_ID", "session-a");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });
  const mark = (dir: string, task: string) => cmdUsage(dir, ["mark"], { task });
  const record = (dir: string, task: string) => cmdRecord(dir, { task, format: "json" });

  it("does not create marks, records or claims within managed execution/review", async () => {
    await writeFile(transcript, [meta(), usage(10)].join("\n"));
    vi.stubEnv("NDX_MANAGED_USAGE", "1");
    await mark(dir, "automated-review");
    await cmdRecord(dir, { task: "automated-review", "input-tokens": "123", format: "json" });
    expect(await listRuns(henchDir)).toEqual([]);
    expect((await loadUsageCursor(henchDir, "session-a")).marks).toBeUndefined();
    vi.stubEnv("NDX_MANAGED_USAGE", "");
    await mark(dir, "standalone");
    await writeFile(transcript, [meta(), usage(10), usage(11)].join("\n"));
    await record(dir, "standalone");
    expect((await listRuns(henchDir))[0].tokenUsage.input).toBe(6);
  });

  it("discovers the exact session and persists three nested deltas without double charging", async () => {
    await writeFile(transcript, [meta(), usage(1)].join("\n"));
    await mark(dir, "outer");
    await writeFile(transcript, [meta(), usage(1), usage(2)].join("\n"));
    await mark(dir, "middle");
    await writeFile(transcript, [meta(), usage(1), usage(2), usage(3)].join("\n"));
    await mark(dir, "inner");
    await writeFile(transcript, [meta(), usage(1), usage(2), usage(3), usage(4), usage(4)].join("\n"));
    await record(dir, "inner");
    await record(dir, "middle");
    await record(dir, "outer");
    await record(dir, "repeat");
    const runs = await listRuns(henchDir);
    expect(runs.reduce((sum, r) => sum + r.tokenUsage.input, 0)).toBe(18);
    expect(runs.reduce((sum, r) => sum + r.tokenUsage.cacheReadInput!, 0)).toBe(12);
    expect(runs.find((r) => r.taskId === "repeat")?.tokenUsage.input).toBe(0);
    expect(runs.every((r) => r.vendor === "codex")).toBe(true);
    expect(runs.every((r) => r.diagnostics?.tokenDiagnosticStatus === "complete")).toBe(true);
  });

  it("recovers a missing prefix and keeps the cumulative watermark across repeated records", async () => {
    await writeFile(transcript, [meta(), usage(10)].join("\n"));
    await mark(dir, "task");
    await writeFile(transcript, [meta(), usage(12)].join("\n"));
    await record(dir, "task");
    await writeFile(transcript, [meta(), usage(13), '{"type":'].join("\n"));
    await record(dir, "next");
    await record(dir, "repeat");
    const runs = await listRuns(henchDir);
    expect(runs.reduce((sum, r) => sum + r.tokenUsage.input, 0)).toBe(18);
    expect(runs.find((r) => r.taskId === "next")?.diagnostics?.tokenDiagnosticStatus).toBe("partial");
    expect((await loadUsageCursor(henchDir, "session-a")).totals?.input).toBe(78);
  });

  it("distinguishes measured zero and rejects a timestamp-only Codex window", async () => {
    await writeFile(transcript, [meta(), usage(0)].join("\n"));
    await mark(dir, "task");
    await expect(cmdRecord(dir, { task: "task", since: "2026-01-01" })).rejects.toThrow(/--since/);
    await record(dir, "task");
    const [run] = await listRuns(henchDir);
    expect(run.tokenUsage.input).toBe(0);
    expect(run.diagnostics?.tokenDiagnosticStatus).toBe("complete");
  });

  it("keeps sibling nested claims disjoint and reads the model from turn_context", async () => {
    const context = JSON.stringify({ type: "turn_context", payload: { model: "synthetic-codex-model" } });
    const lines = [meta(), context, usage(1)];
    await writeFile(transcript, lines.join("\n"));
    await mark(dir, "outer");
    for (const n of [2, 4]) {
      lines.push(usage(n));
      await writeFile(transcript, lines.join("\n"));
      await mark(dir, `child-${n}`);
      lines.push(usage(n + 1));
      await writeFile(transcript, lines.join("\n"));
      await record(dir, `child-${n}`);
    }
    await record(dir, "outer");
    const runs = await listRuns(henchDir);
    expect(runs.reduce((sum, r) => sum + r.tokenUsage.input, 0)).toBe(24);
    expect(runs.find((r) => r.taskId === "outer")?.turns).toBe(2);
    expect(runs.every((r) => r.model === "synthetic-codex-model")).toBe(true);
  });

  it("does not claim reset counters or lose the boundary on an unavailable read", async () => {
    await writeFile(transcript, [meta(), usage(10)].join("\n"));
    await mark(dir, "task");
    await writeFile(transcript, [meta(), usage(2)].join("\n"));
    await record(dir, "task");
    expect((await listRuns(henchDir))[0].diagnostics?.tokenDiagnosticStatus).toBe("unavailable");
    expect((await loadUsageCursor(henchDir, "session-a")).marks?.task).toBeDefined();
    await writeFile(transcript, [meta(), usage(10), usage(11)].join("\n"));
    await record(dir, "task");
    expect((await listRuns(henchDir)).reduce((sum, r) => sum + r.tokenUsage.input, 0)).toBe(6);
  });

  it("never rewinds a recorded inner watermark when an older outer mark sees a stale rollout", async () => {
    await writeFile(transcript, [meta(), usage(1)].join("\n"));
    await mark(dir, "outer");
    await writeFile(transcript, [meta(), usage(1), usage(2)].join("\n"));
    await mark(dir, "inner");
    await writeFile(transcript, [meta(), usage(1), usage(2), usage(10)].join("\n"));
    await record(dir, "inner");
    await writeFile(transcript, [meta(), usage(6)].join("\n"));
    await record(dir, "outer");
    const stale = (await listRuns(henchDir)).find((run) => run.taskId === "outer")!;
    expect(stale.diagnostics?.tokenDiagnosticStatus).toBe("unavailable");
    expect((await loadUsageCursor(henchDir, "session-a")).totals?.input).toBe(60);
    await writeFile(transcript, [meta(), usage(1), usage(2), usage(10)].join("\n"));
    await record(dir, "outer");
    await record(dir, "repeat");
    expect((await listRuns(henchDir)).reduce((sum, r) => sum + r.tokenUsage.input, 0)).toBe(54);
  });

  it("refuses a start mark behind an already recorded cumulative watermark", async () => {
    await writeFile(transcript, [meta(), usage(10)].join("\n"));
    await record(dir, "first");
    await writeFile(transcript, [meta(), usage(5)].join("\n"));
    await mark(dir, "next");
    expect((await loadUsageCursor(henchDir, "session-a")).marks?.next).toBeUndefined();
    await writeFile(transcript, [meta(), usage(10)].join("\n"));
    await record(dir, "next");
    expect((await listRuns(henchDir)).reduce((sum, r) => sum + r.tokenUsage.input, 0)).toBe(60);
  });

  it("retains an incomplete start snapshot's diagnostic when the rollout is later repaired", async () => {
    await writeFile(transcript, [meta(), usage(1), '{"type":'].join("\n"));
    await mark(dir, "task");
    await writeFile(transcript, [meta(), usage(1), usage(2), usage(3)].join("\n"));
    await record(dir, "task");
    expect((await listRuns(henchDir))[0].diagnostics?.tokenDiagnosticStatus).toBe("partial");
  });

  it("retains an incomplete fallback watermark's diagnostic until a complete read replaces it", async () => {
    await writeFile(transcript, [meta(), usage(1), '{"type":'].join("\n"));
    await record(dir, "first");
    await writeFile(transcript, [meta(), usage(1), usage(2), usage(3)].join("\n"));
    await record(dir, "next");
    await record(dir, "repeat");
    const runs = await listRuns(henchDir);
    expect(runs.find((r) => r.taskId === "next")?.diagnostics?.tokenDiagnosticStatus).toBe("partial");
    expect(runs.find((r) => r.taskId === "repeat")?.diagnostics?.tokenDiagnosticStatus).toBe("complete");
  });

  it.each([
    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":2}}',
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 10 } } } }),
    meta(),
    [meta("different-session"), usage(1)].join("\n"),
  ])("reports unsupported/missing/mismatched usage explicitly", async (body) => {
    await writeFile(transcript, body);
    await mark(dir, "task");
    await record(dir, "task");
    const [run] = await listRuns(henchDir);
    expect(run.diagnostics?.tokenDiagnosticStatus).toBe("unavailable");
    expect(run.vendor).toBe("codex");
    expect(run.model).toBe("unknown");
    expect((await loadUsageCursor(henchDir, "session-a")).marks).toBeUndefined();
  });

  it.each([
    { "input-tokens": "7" },
    { "no-tokens": "true" },
  ])("keeps Codex provenance when usage is overridden: %j", async (flags) => {
    await writeFile(transcript, [meta(), usage(1)].join("\n"));
    await mark(dir, "task");
    await writeFile(transcript, [meta(), usage(1), usage(2)].join("\n"));
    await cmdRecord(dir, { task: "task", ...flags });
    const [run] = await listRuns(henchDir);
    expect(run.vendor).toBe("codex");
    expect(run.model).toBe("unknown");
    await record(dir, "repeat");
    expect((await listRuns(henchDir)).find((r) => r.taskId === "repeat")?.tokenUsage.input).toBe(0);
  });

  it("refuses another vendor's transcript without consuming the Codex boundary", async () => {
    await writeFile(transcript, [meta(), usage(1)].join("\n"));
    await mark(dir, "task");
    const before = await loadUsageCursor(henchDir, "session-a");
    await writeFile(transcript, JSON.stringify({ uuid: "claude-message", message: {
      id: "claude-request", model: "claude-synthetic", usage: { input_tokens: 999, output_tokens: 10 },
    } }));
    await mark(dir, "wrong-vendor");
    await record(dir, "task");
    const [run] = await listRuns(henchDir);
    expect(run.diagnostics?.tokenDiagnosticStatus).toBe("unavailable");
    expect(run.vendor).toBe("codex");
    expect(run.tokenUsage.input).toBe(0);
    expect(await loadUsageCursor(henchDir, "session-a")).toEqual(before);
  });

  it("isolates a new session, searches archived rollouts, and refuses ambiguous matches", async () => {
    await writeFile(transcript, [meta(), usage(1)].join("\n"));
    await mark(dir, "task");
    vi.stubEnv("CODEX_THREAD_ID", "session-b");
    await record(dir, "task");
    expect((await listRuns(henchDir))[0].diagnostics?.tokenDiagnosticStatus).toBe("unavailable");
    expect((await loadUsageCursor(henchDir, "session-a")).marks?.task).toBeDefined();
    const archive = join(home, "archived_sessions");
    await mkdir(archive);
    const archived = join(archive, "rollout-date-session-b.jsonl");
    await writeFile(archived, [meta("session-b"), usage(1)].join("\n"));
    expect(await resolveTranscriptPath("session-b", { vendor: "codex", codexHome: home })).toBe(archived);
    await writeFile(join(archive, "rollout-other-session-b.jsonl"), "");
    expect(await resolveTranscriptPath("session-b", { vendor: "codex", codexHome: home })).toBeNull();
  });
});

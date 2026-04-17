/**
 * Self-Heal Batch Pipeline — Codex Integration Tests
 *
 * Runs the self-heal batch loop against a mocked Codex CLI and asserts:
 *   1. A successful Codex batch completes and populates run.testGate.
 *   2. A rate-limit error triggers retry and the pipeline continues.
 *   3. Partial / malformed Codex output is handled without crashing.
 *
 * These tests mirror the Claude self-heal path so that both vendor paths
 * are covered symmetrically.  The Codex vendor is configured via
 * `.n-dx.json` (llm.vendor=codex) exactly as it would be in production.
 *
 * Mock strategy: vi.doMock("node:child_process") replaces the `spawn`
 * function so that spawnCodex receives a controllable EventEmitter instead
 * of a real child process.  This is the same technique used in
 * codex-token-accounting.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../src/store/config.js";

// ---------------------------------------------------------------------------
// Codex output fixtures
// ---------------------------------------------------------------------------

/**
 * Typical Codex verbose stdout — a human-readable session log.
 * normalizeCodexResponse returns this as plain assistantText (no toolEvents).
 * The IC-2 git-diff fallback compensates at the test-gate level.
 * Includes the two-line "tokens used / N" format so token parsing is covered.
 */
const CODEX_VERBOSE_SUCCESS = [
  "Reading additional input from stdin...",
  "OpenAI Codex v0.120.0 (research preview)",
  "--------",
  "workdir: /workspace",
  "model: gpt-5",
  "provider: openai",
  "approval: never",
  "sandbox: workspace-write [workdir, /tmp]",
  "--------",
  "Analysing task brief...",
  "Writing implementation...",
  "Running tests...",
  "Task complete.",
  "tokens used",
  "4200",
].join("\n");

/**
 * Truncated / partial JSON — simulates Codex output being cut off mid-stream.
 * parseMaybeJson returns the string unchanged (opening { without closing }),
 * so normalizeCodexResponse treats it as plain text and produces no toolEvents.
 */
const CODEX_PARTIAL_JSON =
  '{"status": "in_progress", "content": [{"type": "text", "te';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Create a mock child process that emits stdout/stderr data then closes.
 * Compatible with both spawnClaude (which reads proc.stdin) and spawnCodex
 * (which uses stdio:["ignore","pipe","pipe"]).
 */
function mockCliProcess(opts: { stdout?: string; stderr?: string; code: number }) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: () => void; end: () => void };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  // Stub stdin so spawnClaude (which writes to stdin) does not throw.
  proc.stdin = { write: () => {}, end: () => {} };

  queueMicrotask(() => {
    if (opts.stdout) proc.stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit("data", Buffer.from(opts.stderr));
    proc.emit("close", opts.code);
  });

  return proc;
}

/** Create an isolated temp project wired for Codex. */
async function setupProjectDir(): Promise<{
  projectDir: string;
  henchDir: string;
  rexDir: string;
}> {
  const projectDir = await mkdtemp(join(tmpdir(), "hench-self-heal-codex-"));
  const henchDir = join(projectDir, ".hench");
  const rexDir = join(projectDir, ".rex");

  await initConfig(henchDir);
  await mkdir(rexDir, { recursive: true });

  // Set Codex as the active vendor.
  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({ llm: { vendor: "codex" } }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "task-1",
          title: "Codex self-heal task",
          status: "pending",
          level: "task",
          priority: "high",
        },
      ],
    }),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  return { projectDir, henchDir, rexDir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Codex self-heal batch pipeline — integration", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupProjectDir());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  // ── AC-1: Successful Codex self-heal batch ─────────────────────────────────

  it("completes a Codex self-heal batch and populates run.testGate", async () => {
    // Arrange: mock Codex with verbose text output (no tool events).
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn.mockImplementationOnce(() =>
      mockCliProcess({ stdout: CODEX_VERBOSE_SUCCESS, code: 0 }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // Act
    const result = await cliLoop({
      config: { ...config, selfHeal: true },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Assert: pipeline ran to completion without an unhandled exception.
    expect(result.run).toBeDefined();
    expect(result.run.id).toBeTruthy();

    // Codex verbose stdout does not produce structured tool events (IC-4).
    expect(result.run.toolCalls).toHaveLength(0);

    // Self-heal gate was invoked: finalizeRun sets run.testGate when selfHeal=true.
    expect(result.run.testGate).toBeDefined();

    // Gate skipped: temp dir has no git repo, so the IC-2 git-diff fallback
    // finds no changed files, and runTestGate skips with a skipReason.
    expect(result.run.testGate!.ran).toBe(false);
    expect(result.run.testGate!.skipReason).toBe("No files modified in prior phases");
    // Skip is treated as a pass so the run is not marked failed by the gate.
    expect(result.run.testGate!.passed).toBe(true);

    // Tokens extracted from the two-line "tokens used / 4200" format.
    expect(result.run.turnTokenUsage).toHaveLength(1);
    expect(result.run.turnTokenUsage[0]).toMatchObject({
      vendor: "codex",
      input: 4200,
      output: 0,
    });
  });

  // ── AC-1b: Codex generic non-zero exit (empty stderr) → transient, retried ──

  it("retries Codex generic non-zero exit (no matching stderr) as transient", async () => {
    // Arrange: first spawn exits with code 1 and empty stderr.
    // spawnCodex sets result.error = "codex exited with code 1" when stderr is empty.
    // This pattern is now in TRANSIENT_PATTERNS → should retry rather than permanent-fail.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn
      .mockImplementationOnce(() =>
        // No stderr, non-zero exit → "codex exited with code 1"
        mockCliProcess({ code: 1 }),
      )
      .mockImplementationOnce(() =>
        mockCliProcess({ stdout: CODEX_VERBOSE_SUCCESS, code: 0 }),
      );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config: {
        ...config,
        selfHeal: true,
        retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
      },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Both spawn calls were made: first failed, second succeeded.
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Retry recorded.
    expect(result.run.retryAttempts).toBe(1);

    // Pipeline continued to testGate — not halted by the generic exit code.
    expect(result.run.testGate).toBeDefined();
  });

  // ── AC-3: Retry log contains vendor name, batch id, and attempt number ──────

  it("logs transient retry with vendor name and attempt info", async () => {
    // Arrange: one transient failure then success.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn
      .mockImplementationOnce(() =>
        mockCliProcess({ stderr: "429 Rate limit exceeded", code: 1 }),
      )
      .mockImplementationOnce(() =>
        mockCliProcess({ stdout: CODEX_VERBOSE_SUCCESS, code: 0 }),
      );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    await cliLoop({
      config: {
        ...config,
        selfHeal: true,
        retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
      },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Read the execution log and find the transient_error entry.
    const logPath = join(rexDir, "execution-log.jsonl");
    const logText = await readFile(logPath, "utf-8");
    const entries = logText
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string; detail?: string });

    const retryEntry = entries.find((e) => e.event === "transient_error");
    expect(retryEntry).toBeDefined();

    // Detail must include vendor name, batch id, and attempt number.
    expect(retryEntry!.detail).toContain("[codex]");
    expect(retryEntry!.detail).toContain("task-1");       // batch id
    expect(retryEntry!.detail).toContain("attempt 1/2");  // attempt 1 of 2
    expect(retryEntry!.detail).toContain("429");          // error summary
  });

  // ── AC-4: After max retries, loop status is error_transient (not failed) ────

  it("returns error_transient status after max retries so outer loop can skip", async () => {
    // Arrange: all spawn calls fail with a generic non-zero exit.
    // After maxRetries exhausted, run.status must be "error_transient" so
    // runIterations/runLoop can continue to the next task rather than stopping.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    // All attempts fail (1 initial + 1 retry = 2 calls total).
    mockSpawn.mockImplementation(() => mockCliProcess({ code: 1 }));

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config: {
        ...config,
        selfHeal: true,
        retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
      },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // All retries used: two spawn calls.
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Status is error_transient, not "failed" — enables outer loop to skip
    // rather than halt.
    expect(result.run.status).toBe("error_transient");
  });

  // ── AC-2: Rate-limit error triggers retry; pipeline continues ──────────────

  it("retries on 429 rate-limit error and continues the self-heal pipeline", async () => {
    // Arrange: first spawn → 429, second spawn → success.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn
      .mockImplementationOnce(() =>
        // Attempt 1: transient rate-limit failure.
        mockCliProcess({ stderr: "429 Rate limit exceeded", code: 1 }),
      )
      .mockImplementationOnce(() =>
        // Attempt 2: success.
        mockCliProcess({ stdout: CODEX_VERBOSE_SUCCESS, code: 0 }),
      );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // Act: zero-delay retry so the test does not actually sleep.
    const result = await cliLoop({
      config: {
        ...config,
        selfHeal: true,
        retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
      },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Retry happened: the loop executed two spawn calls.
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // retryAttempts records how many extra attempts were needed.
    expect(result.run.retryAttempts).toBe(1);

    // Pipeline continued after the retry: testGate is populated.
    expect(result.run.testGate).toBeDefined();

    // Token usage accumulated from both attempts.
    // Attempt 1 produces 0 tokens (stderr-only, no stdout).
    // Attempt 2 produces 4200 input tokens (two-line format).
    expect(result.run.turnTokenUsage).toHaveLength(2);
    expect(result.run.turnTokenUsage[0]).toMatchObject({ vendor: "codex", input: 0, output: 0 });
    expect(result.run.turnTokenUsage[1]).toMatchObject({ vendor: "codex", input: 4200, output: 0 });
  });

  // ── Partial-output path ────────────────────────────────────────────────────

  it("handles partial Codex JSON output without crashing and invokes self-heal gate", async () => {
    // Arrange: Codex returns truncated JSON that cannot be fully parsed.
    // normalizeCodexResponse treats it as plain text (no toolEvents).
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn.mockImplementationOnce(() =>
      // Exit 0 with malformed JSON — not a transient error, just bad output.
      mockCliProcess({ stdout: CODEX_PARTIAL_JSON, code: 0 }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // Act
    const result = await cliLoop({
      config: { ...config, selfHeal: true },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // No crash: pipeline reached finalizeRun.
    expect(result.run).toBeDefined();

    // Malformed output produces no structured tool events.
    expect(result.run.toolCalls).toHaveLength(0);

    // Self-heal gate was still invoked regardless of output quality.
    expect(result.run.testGate).toBeDefined();

    // Gate skipped (no files changed in temp dir without git).
    expect(result.run.testGate!.ran).toBe(false);
    expect(result.run.testGate!.passed).toBe(true);
  });
});

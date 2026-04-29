import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunRecord } from "../../src/schema/v1.js";
import { initConfig } from "../../src/store/config.js";
import { saveRun, listRuns } from "../../src/store/runs.js";
import { parseDocument, serializeDocument } from "@n-dx/rex";

function mockCliProcess(opts: { stdout?: string; stderr?: string; code: number }) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();

  queueMicrotask(() => {
    if (opts.stdout) proc.stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit("data", Buffer.from(opts.stderr));
    proc.emit("close", opts.code);
  });

  return proc;
}

async function setupProjectDir(): Promise<{
  projectDir: string;
  henchDir: string;
  rexDir: string;
}> {
  const projectDir = await mkdtemp(join(tmpdir(), "hench-test-codex-tokens-"));
  const henchDir = join(projectDir, ".hench");
  const rexDir = join(projectDir, ".rex");

  await initConfig(henchDir);
  await mkdir(rexDir, { recursive: true });

  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({
      llm: {
        vendor: "codex",
      },
    }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test",
      adapter: "file",
    }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "prd.md"),
    serializeDocument({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "task-1",
          title: "Codex token task",
          status: "pending",
          level: "task",
          priority: "high",
        },
      ],
    } as never),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  return { projectDir, henchDir, rexDir };
}

function totalTokens(runs: RunRecord[]): number {
  return runs.reduce((sum, run) => sum + run.tokenUsage.input + run.tokenUsage.output, 0);
}

describe("codex token accounting integration", () => {
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

  it("accumulates Codex token totals across retries and enforces budget using cumulative totals", async () => {
    const baselineRun: RunRecord = {
      id: "baseline-run",
      taskId: "task-baseline",
      taskTitle: "Existing run",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      status: "completed",
      turns: 1,
      tokenUsage: { input: 10, output: 5 },
      toolCalls: [],
      model: "sonnet",
    };
    await saveRun(henchDir, baselineRun);
    const beforeTotal = totalTokens(await listRuns(henchDir));

    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        spawn: mockSpawn,
      };
    });

    mockSpawn
      .mockImplementationOnce(() =>
        mockCliProcess({
          stdout: JSON.stringify({
            status: "completed",
            content: [{ type: "text", text: "attempt-1" }],
            usage: { input_tokens: 40, output_tokens: 10 },
          }),
          stderr: "503 overloaded",
          code: 1,
        }),
      )
      .mockImplementationOnce(() =>
        mockCliProcess({
          stdout: JSON.stringify({
            status: "completed",
            content: [{ type: "text", text: "attempt-2" }],
            usage: { input_tokens: 70, output_tokens: 30 },
          }),
          code: 0,
        }),
      );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config: { ...config, tokenBudget: 130 },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    expect(result.run.status).toBe("budget_exceeded");
    expect(result.run.tokenUsage).toEqual({ input: 110, output: 40 });
    expect(result.run.turnTokenUsage).toEqual([
      { turn: 1, input: 40, output: 10, vendor: "codex", model: "sonnet", diagnosticStatus: "complete" },
      { turn: 1, input: 70, output: 30, vendor: "codex", model: "sonnet", diagnosticStatus: "complete" },
    ]);
    expect(result.run.error).toContain("150 used of 130 budget");

    const afterRuns = await listRuns(henchDir);
    const afterTotal = totalTokens(afterRuns);
    expect(afterTotal).toBe(beforeTotal + 150);

    const prdRaw = await readFile(join(rexDir, "prd.md"), "utf-8");
    const prdParsed = parseDocument(prdRaw);
    if (!prdParsed.ok) throw prdParsed.error;
    const prd = prdParsed.data as {
      items: Array<{ id: string; status: string }>;
    };
    const task = prd.items.find((item) => item.id === "task-1");
    expect(task?.status).toBe("pending");
  });

  it("extracts tokens from text output when JSON usage is absent", async () => {
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        spawn: mockSpawn,
      };
    });

    // Simulate Codex CLI output with no JSON usage but text token line
    mockSpawn.mockImplementationOnce(() =>
      mockCliProcess({
        stdout: `[Codex] Starting execution...
[Codex] Running tool: shell
[Codex] Command completed successfully
Tokens used: 8,542 in, 2,130 out
[Codex] Execution complete`,
        code: 0,
      }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config,
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Tokens should be extracted from the text output
    expect(result.run.tokenUsage).toEqual({ input: 8542, output: 2130 });
    expect(result.run.turnTokenUsage).toHaveLength(1);
    expect(result.run.turnTokenUsage[0]).toMatchObject({
      turn: 1,
      input: 8542,
      output: 2130,
      vendor: "codex",
    });
  });

  it("emits no token event when Codex output contains no token line", async () => {
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        spawn: mockSpawn,
      };
    });

    // Simulate Codex CLI output with no JSON usage and no token line
    mockSpawn.mockImplementationOnce(() =>
      mockCliProcess({
        stdout: `[Codex] Starting execution...
[Codex] Running tool: shell
[Codex] Execution complete`,
        code: 0,
      }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config,
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Should default to zero tokens when no usage data is available
    expect(result.run.tokenUsage).toEqual({ input: 0, output: 0 });
    expect(result.run.turnTokenUsage[0]).toMatchObject({
      turn: 1,
      input: 0,
      output: 0,
      vendor: "codex",
    });
  });

  it("extracts tokens from two-line Codex format and accumulates in run record", async () => {
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        spawn: mockSpawn,
      };
    });

    // Two-line format: label on one line, total count on the next.
    mockSpawn.mockImplementationOnce(() =>
      mockCliProcess({
        stdout: `[Codex] Starting execution...
[Codex] Running tool: shell
[Codex] Command completed successfully
tokens used
8542
[Codex] Execution complete`,
        code: 0,
      }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config,
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Two-line format yields total count stored as input, output 0.
    expect(result.run.tokenUsage).toEqual({ input: 8542, output: 0 });
    expect(result.run.turnTokenUsage).toHaveLength(1);
    expect(result.run.turnTokenUsage[0]).toMatchObject({
      turn: 1,
      input: 8542,
      output: 0,
      vendor: "codex",
    });
  });

  it("cumulative two-line token totals at run end match sum of per-turn counts", async () => {
    // AC6: run.tokenUsage must equal the arithmetic sum of all turnTokenUsage entries.
    // Uses the two-line format across two retry attempts so we cover the multi-attempt path.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn
      .mockImplementationOnce(() =>
        mockCliProcess({
          stdout: "[Codex] Starting...\ntokens used\n500\n[Codex] Done.",
          stderr: "503 overloaded",
          code: 1,
        }),
      )
      .mockImplementationOnce(() =>
        mockCliProcess({
          stdout: "[Codex] Starting...\ntokens used\n300\n[Codex] Done.",
          code: 0,
        }),
      );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config: { ...config, tokenBudget: 0 },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Two-line format: each attempt stores total as input, output=0.
    expect(result.run.tokenUsage).toEqual({ input: 800, output: 0 });
    expect(result.run.turnTokenUsage).toHaveLength(2);
    expect(result.run.turnTokenUsage[0]).toMatchObject({ input: 500, output: 0, vendor: "codex" });
    expect(result.run.turnTokenUsage[1]).toMatchObject({ input: 300, output: 0, vendor: "codex" });

    // Invariant: cumulative total === sum of per-turn records.
    const sumOfTurns = result.run.turnTokenUsage.reduce(
      (s, t) => s + t.input + t.output,
      0,
    );
    expect(sumOfTurns).toBe(result.run.tokenUsage.input + result.run.tokenUsage.output);
  });

  it("two-line format run does not exceed budget when cumulative total is under limit", async () => {
    // AC7: budget check fires after run completes (not per-line). The two-line total
    // (800 tokens) is under the configured budget (1500), so status must not be
    // budget_exceeded — even though 800 alone would exceed a hypothetical per-turn
    // limit of, say, 500.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn.mockImplementationOnce(() =>
      mockCliProcess({
        stdout: "[Codex] Starting execution...\ntokens used\n800\n[Codex] Done.",
        code: 0,
      }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config: { ...config, tokenBudget: 1500 },
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Tokens correctly extracted from two-line format.
    expect(result.run.tokenUsage).toEqual({ input: 800, output: 0 });

    // Budget not exceeded — the budget check uses the full run total, not a
    // per-line intermediate value.
    expect(result.run.status).not.toBe("budget_exceeded");
  });

  it("uses last token line occurrence when multiple are present", async () => {
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return {
        ...actual,
        spawn: mockSpawn,
      };
    });

    mockSpawn.mockImplementationOnce(() =>
      mockCliProcess({
        stdout: `Processing first chunk...
Tokens used: 100 in, 50 out
Processing second chunk...
Tokens used: 1,234 in, 567 out
Done.`,
        code: 0,
      }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config,
      store,
      projectDir,
      henchDir,
      taskId: "task-1",
    });

    // Should use the last occurrence
    expect(result.run.tokenUsage).toEqual({ input: 1234, output: 567 });
  });
});

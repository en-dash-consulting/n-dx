import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunRecord } from "../../src/schema/v1.js";
import { initConfig } from "../../src/store/config.js";
import { saveRun, listRuns } from "../../src/store/runs.js";

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
    join(rexDir, "prd.json"),
    JSON.stringify({
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
    }),
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

    const { createStore } = await import("rex/dist/store/index.js");
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
      { turn: 1, input: 40, output: 10, vendor: "codex", model: "gpt-5-codex" },
      { turn: 1, input: 70, output: 30, vendor: "codex", model: "gpt-5-codex" },
    ]);
    expect(result.run.error).toContain("150 used of 130 budget");

    const afterRuns = await listRuns(henchDir);
    const afterTotal = totalTokens(afterRuns);
    expect(afterTotal).toBe(beforeTotal + 150);

    const prdRaw = await readFile(join(rexDir, "prd.json"), "utf-8");
    const prd = JSON.parse(prdRaw) as {
      items: Array<{ id: string; status: string }>;
    };
    const task = prd.items.find((item) => item.id === "task-1");
    expect(task?.status).toBe("pending");
  });
});

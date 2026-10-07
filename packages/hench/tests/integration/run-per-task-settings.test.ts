/**
 * Settings are resolved **per task, after selection** — so each task in a
 * `--loop` / `--iterations` / `--epic-by-epic` run gets its own, and a saved
 * `provider` chooses which loop runs that task.
 *
 * Before this, `cmdRun` resolved everything once before any task was selected
 * and handed the same model, provider, budgets and gates to every iteration.
 * These tests drive the real `cmdRun` over a real fixture with the two agent
 * loops stubbed, and assert what each loop was actually handed.
 *
 * @see packages/hench/src/cli/commands/run.ts — `runOne`
 * @see packages/hench/tests/integration/task-run-settings.test.ts — the resolver itself
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TIER_MODELS } from "@n-dx/llm-client";
import type { PRDDocument } from "@n-dx/rex";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import type { RunRecord } from "../../src/schema/index.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

/** One call into a stubbed agent loop: which loop, and what it was handed. */
interface LoopCall {
  loop: "cli" | "api";
  taskId: string;
  model?: string;
  modelWeight?: string;
  modelSource?: string;
  maxTurns?: number;
  permissionMode?: string;
  skipFullTestGate?: boolean;
  reviewPass?: boolean;
  reviewModel?: string;
  extraContext?: string;
}

const calls: LoopCall[] = [];

/**
 * Stand in for an agent loop: record what it was handed, mark the task
 * completed so the next iteration selects the next one, and hand back the
 * minimum run record `runOne` reads.
 */
async function stub(loop: "cli" | "api", opts: Record<string, unknown>): Promise<{ run: RunRecord }> {
  const store = opts.store as Awaited<ReturnType<typeof resolveStore>>;
  const taskId = opts.taskId as string;
  const config = (opts.config ?? {}) as { skipFullTestGate?: boolean };
  calls.push({
    loop,
    taskId,
    model: opts.model as string | undefined,
    modelWeight: opts.modelWeight as string | undefined,
    modelSource: opts.modelSource as string | undefined,
    maxTurns: opts.maxTurns as number | undefined,
    permissionMode: opts.permissionMode as string | undefined,
    skipFullTestGate: config.skipFullTestGate,
    reviewPass: opts.reviewPass as boolean | undefined,
    reviewModel: opts.reviewModel as string | undefined,
    extraContext: opts.extraContext as string | undefined,
  });

  const doc = (await store.loadDocument()) as PRDDocument;
  for (const epic of doc.items) {
    for (const child of epic.children ?? []) {
      if (child.id === taskId) child.status = "completed";
    }
  }
  await store.saveDocument(doc);

  return {
    run: {
      id: `run-${calls.length}`,
      taskId,
      taskTitle: taskId,
      startedAt: new Date().toISOString(),
      status: "completed",
      turns: 1,
      tokenUsage: { input: 0, output: 0 },
      turnTokenUsage: [],
      toolCalls: [],
      model: (opts.model as string) ?? "",
    } as RunRecord,
  };
}

vi.mock("../../src/agent/lifecycle/cli-loop.js", () => ({
  cliLoop: (opts: Record<string, unknown>) => stub("cli", opts),
}));
vi.mock("../../src/agent/lifecycle/loop.js", () => ({
  agentLoop: (opts: Record<string, unknown>) => stub("api", opts),
}));

const { cmdRun } = await import("../../src/cli/commands/run.js");

/** Two sibling tasks, each with its own saved `run` block. */
function doc(first: unknown, second: unknown): unknown {
  return {
    schema: "rex/v1",
    title: "Per-task settings",
    items: [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          { id: "t-one", title: "First", level: "task", status: "pending", priority: "high", ...(first ? { run: first } : {}) },
          { id: "t-two", title: "Second", level: "task", status: "pending", priority: "medium", ...(second ? { run: second } : {}) },
        ],
      },
    ],
  };
}

let projectDir: string;
let rexDir: string;

async function setup(document: unknown, llm: Record<string, unknown> = {}): Promise<void> {
  ({ projectDir, rexDir } = await setupProjectDir("hench-per-task-"));
  await (await resolveStore(rexDir)).saveDocument(document as never);
  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({ llm: { vendor: "claude", claude: { cli_path: process.execPath }, ...llm } }),
    "utf-8",
  );
  commitGitFixtureBaseline(projectDir);
}

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (projectDir) await cleanupProjectDir(projectDir);
});

describe("each task in a loop runs with its own saved settings", () => {
  it("gives two tasks in one --iterations run their own model, weight and source", async () => {
    await setup(
      doc({ models: { claude: TIER_MODELS.claude.heavy } }, { models: { claude: TIER_MODELS.claude.light } }),
    );

    await cmdRun(projectDir, { auto: "true", iterations: "2" });

    expect(calls.map((c) => c.taskId)).toEqual(["t-one", "t-two"]);
    expect(calls[0]).toMatchObject({
      model: TIER_MODELS.claude.heavy,
      modelWeight: "heavy",
      modelSource: "task.run.models",
    });
    expect(calls[1]).toMatchObject({
      model: TIER_MODELS.claude.light,
      modelWeight: "light",
      modelSource: "task.run.models",
    });
  });

  it("lets an explicit --model apply to every task in the loop", async () => {
    await setup(
      doc({ models: { claude: TIER_MODELS.claude.heavy } }, { models: { claude: TIER_MODELS.claude.light } }),
    );

    await cmdRun(projectDir, { auto: "true", iterations: "2", model: TIER_MODELS.claude.standard });

    expect(calls.map((c) => c.model)).toEqual([TIER_MODELS.claude.standard, TIER_MODELS.claude.standard]);
    expect(calls.map((c) => c.modelSource)).toEqual(["cli-flag", "cli-flag"]);
  });

  it("picks the api loop for a task that saved provider=api, and the cli loop for its sibling", async () => {
    await setup(doc({ provider: "api" }, { provider: "cli" }));

    await cmdRun(projectDir, { auto: "true", iterations: "2" });

    expect(calls.map((c) => [c.taskId, c.loop])).toEqual([
      ["t-one", "api"],
      ["t-two", "cli"],
    ]);
  });

  it("applies a task's saved gates and notes to that task only", async () => {
    await setup(
      doc({ permissionMode: "bypassPermissions", skipTestGate: true, contextNotes: "watch the lock" }, null),
    );

    await cmdRun(projectDir, { auto: "true", iterations: "2" });

    expect(calls[0]).toMatchObject({
      permissionMode: "bypassPermissions",
      skipFullTestGate: true,
      extraContext: "watch the lock",
    });
    expect(calls[1].permissionMode).toBe("acceptEdits");
    expect(calls[1].skipFullTestGate).not.toBe(true);
    expect(calls[1].extraContext).toBeUndefined();
  });

  it("applies a task's saved turn budget, which only the api loop takes", async () => {
    // `--max-turns` bounds the API turn loop; the CLI loop has no such dial, so
    // the budget only reaches a loop when the task runs on the api provider.
    await setup(doc({ provider: "api", maxTurns: 7 }, { provider: "api" }));

    await cmdRun(projectDir, { auto: "true", iterations: "2" });

    expect(calls[0]).toMatchObject({ loop: "api", maxTurns: 7 });
    expect(calls[1].maxTurns).not.toBe(7);
  });

  it("turns the review pass on for the one task that asked for it", async () => {
    await setup(doc({ review: true, reviewTier: "light" }, null));

    await cmdRun(projectDir, { auto: "true", iterations: "2" });

    expect(calls[0]).toMatchObject({ reviewPass: true, reviewModel: TIER_MODELS.claude.light });
    expect(calls[1].reviewPass).toBe(false);
  });

  it("warns and runs anyway when a task's saved model cannot run on the active vendor", async () => {
    // hench's `warn` writes to stderr via console.error.
    const warnings: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    });
    await setup(doc({ models: { claude: "gpt-5.6-terra" } }, null));

    await cmdRun(projectDir, { auto: "true", iterations: "2" });

    expect(calls.map((c) => c.taskId)).toEqual(["t-one", "t-two"]);
    expect(calls[0].model).not.toBe("gpt-5.6-terra");
    expect(warnings.join("\n")).toContain("gpt-5.6-terra");
  });

  it("records the honest weight for a model an explicit --model pinned", async () => {
    await setup(doc(null, null));

    await cmdRun(projectDir, { auto: "true", model: TIER_MODELS.claude.heavy });

    expect(calls[0]).toMatchObject({ modelWeight: "heavy", modelSource: "cli-flag" });
  });
});

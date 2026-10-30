/**
 * `hench.escalation` through the real `cmdRun`: the run history decides that a
 * task's next attempt is escalated, the loop is handed the escalation vendor
 * and model, and a task whose escalated attempt failed too is skipped as stuck.
 * The agent loops are stubbed; the selection, resolution and stuck detection
 * are real.
 *
 * @see packages/hench/tests/unit/agent/analysis/escalation.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TIER_MODELS } from "@n-dx/llm-client";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import { saveRun } from "../../src/store/runs.js";
import type { RunEscalation, RunRecord } from "../../src/schema/index.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

interface LoopCall {
  loop: "cli" | "api";
  taskId: string;
  model?: string;
  modelSource?: string;
  vendorOverride?: string;
  escalation?: RunEscalation;
}

const calls: LoopCall[] = [];

async function stub(loop: "cli" | "api", opts: Record<string, unknown>): Promise<{ run: RunRecord }> {
  const taskId = opts.taskId as string;
  calls.push({
    loop,
    taskId,
    model: opts.model as string | undefined,
    modelSource: opts.modelSource as string | undefined,
    vendorOverride: opts.vendorOverride as string | undefined,
    escalation: opts.escalation as RunEscalation | undefined,
  });
  return {
    run: {
      id: `stub-${calls.length}`,
      taskId,
      taskTitle: taskId,
      startedAt: new Date().toISOString(),
      status: "failed",
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

const ESCALATION_MODEL = TIER_MODELS.codex.heavy;

let projectDir: string;
let henchDir: string;
let seq = 0;

async function setup(escalation: Record<string, unknown> | undefined, maxFailedAttempts = 3): Promise<void> {
  let rexDir: string;
  ({ projectDir, henchDir, rexDir } = await setupProjectDir("hench-escalation-"));
  await (await resolveStore(rexDir)).saveDocument({
    schema: "rex/v1",
    title: "Escalation",
    items: [
      {
        id: "epic-1", title: "Epic", level: "epic", status: "pending",
        children: [
          { id: "t-one", title: "First", level: "task", status: "pending", priority: "high" },
          { id: "t-two", title: "Second", level: "task", status: "pending", priority: "medium" },
        ],
      },
    ],
  } as never);
  const configPath = join(henchDir, "config.json");
  const config = JSON.parse(await readFile(configPath, "utf-8"));
  await writeFile(
    configPath,
    JSON.stringify({ ...config, maxFailedAttempts, ...(escalation ? { escalation } : {}) }),
    "utf-8",
  );
  await writeFile(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }), "utf-8");
  await writeFile(
    join(projectDir, ".n-dx.local.json"),
    JSON.stringify({ llm: { claude: { cli_path: process.execPath }, codex: { cli_path: process.execPath } } }),
    "utf-8",
  );
  await writeFile(join(projectDir, ".gitignore"), ".n-dx.local.json\n", "utf-8");
  commitGitFixtureBaseline(projectDir);
}

/** A past failed attempt of `taskId`, saved where stuck detection and escalation read. */
async function pastFailure(taskId: string, escalated = false): Promise<void> {
  seq++;
  await saveRun(henchDir, {
    id: `past-${seq}`,
    taskId,
    taskTitle: taskId,
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    finishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    status: "failed",
    turns: 1,
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "m",
    ...(escalated ? { escalation: { escalated: true, vendor: "codex", failures: 2, reason: "r" } } : {}),
  } as RunRecord);
}

const ENABLED = { enabled: true, vendor: "codex", model: ESCALATION_MODEL };

beforeEach(() => {
  calls.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (projectDir) await cleanupProjectDir(projectDir);
});

describe("an escalated attempt", () => {
  it("runs on the escalation vendor and model after `after` consecutive failures", async () => {
    await setup(ENABLED);
    await pastFailure("t-one");
    await pastFailure("t-one");

    await cmdRun(projectDir, { task: "t-one", auto: "true" });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      loop: "cli",
      taskId: "t-one",
      vendorOverride: "codex",
      model: ESCALATION_MODEL,
      modelSource: "hench.escalation.model",
    });
    expect(calls[0].escalation).toMatchObject({
      escalated: true,
      vendor: "codex",
      model: ESCALATION_MODEL,
      fromVendor: "claude",
      failures: 2,
    });
  });

  it("is not made with escalation disabled", async () => {
    await setup({ ...ENABLED, enabled: false });
    await pastFailure("t-one");
    await pastFailure("t-one");

    await cmdRun(projectDir, { task: "t-one", auto: "true" });

    expect(calls[0].vendorOverride).toBeUndefined();
    expect(calls[0].escalation).toBeUndefined();
    expect(calls[0].modelSource).not.toBe("hench.escalation.model");
  });

  it("gives way to an explicit model flag", async () => {
    await setup(ENABLED);
    await pastFailure("t-one");
    await pastFailure("t-one");

    await cmdRun(projectDir, { task: "t-one", auto: "true", model: TIER_MODELS.claude.light });

    expect(calls[0]).toMatchObject({ model: TIER_MODELS.claude.light, modelSource: "cli-flag" });
    expect(calls[0].vendorOverride).toBeUndefined();
    expect(calls[0].escalation).toBeUndefined();
  });
});

describe("stuck-task skipping with escalation", () => {
  it("selects a task at the stuck threshold for its escalated attempt instead of skipping it", async () => {
    await setup(ENABLED, 2);
    await pastFailure("t-one");
    await pastFailure("t-one");

    await cmdRun(projectDir, { auto: "true" });

    // Autoselection runs stuck detection first; t-one has reached
    // maxFailedAttempts but is still owed its escalated attempt.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ taskId: "t-one", vendorOverride: "codex" });
  });

  it("skips the task as stuck once its escalated attempt has failed too", async () => {
    await setup(ENABLED, 2);
    await pastFailure("t-one");
    await pastFailure("t-one");
    await pastFailure("t-one", true);

    await cmdRun(projectDir, { auto: "true" });

    // Stuck detection before autoselection: t-one is stuck, t-two runs.
    expect(calls.map((c) => c.taskId)).toEqual(["t-two"]);
    expect(calls[0].escalation).toBeUndefined();
  });

  it("skips a task at the threshold exactly as before when escalation is off", async () => {
    await setup(undefined, 2);
    await pastFailure("t-one");
    await pastFailure("t-one");

    await cmdRun(projectDir, { auto: "true" });

    expect(calls.map((c) => c.taskId)).toEqual(["t-two"]);
    expect(calls[0].escalation).toBeUndefined();
  });
});

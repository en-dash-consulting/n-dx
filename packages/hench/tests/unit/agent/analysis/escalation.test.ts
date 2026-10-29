/**
 * `hench.escalation`: a task that keeps failing gets an attempt on a stronger
 * vendor or model before it is skipped as stuck.
 *
 * @see packages/hench/src/agent/analysis/escalation.ts
 * @see packages/hench/tests/integration/run-escalation.test.ts — the run path
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TIER_MODELS } from "@n-dx/llm-client";
import {
  activeEscalation,
  countEscalatedFailures,
  decideEscalation,
  isEscalationPending,
} from "../../../../src/agent/analysis/escalation.js";
import { getStuckTaskIds } from "../../../../src/agent/analysis/stuck.js";
import { initRunRecord } from "../../../../src/agent/lifecycle/shared.js";
import { saveRun, loadRun } from "../../../../src/store/runs.js";
import { planEscalation, resolveTaskRunSettings } from "../../../../src/cli/commands/run-settings.js";
import { formatEscalationLine } from "../../../../src/cli/commands/run.js";
import { DEFAULT_HENCH_CONFIG } from "../../../../src/schema/index.js";
import type { EscalationConfig, RunEscalation, RunRecord } from "../../../../src/schema/index.js";

let clock = 0;

/** A run of `taskId`, newest first when listed in creation order reversed. */
function run(taskId: string, status: RunRecord["status"], escalated = false): RunRecord {
  clock++;
  return {
    id: `run-${clock}`,
    taskId,
    taskTitle: taskId,
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString(),
    status,
    turns: 1,
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
    toolCalls: [],
    model: "m",
    ...(escalated ? { escalation: { escalated: true, vendor: "claude", failures: 2, reason: "r" } } : {}),
  } as RunRecord;
}

/** Runs given oldest first, returned most recent first, as listRuns orders them. */
function history(...runs: RunRecord[]): RunRecord[] {
  return [...runs].reverse();
}

const ON: EscalationConfig = { enabled: true, vendor: "claude", model: "claude-opus-5-5" };

describe("activeEscalation", () => {
  it("is off unless enabled with a vendor, and applies the defaults", () => {
    expect(activeEscalation(undefined)).toBeUndefined();
    expect(activeEscalation({ enabled: false, vendor: "claude" })).toBeUndefined();
    expect(activeEscalation({ enabled: true })).toBeUndefined();
    expect(activeEscalation({ enabled: true, vendor: "codex", model: "  " })).toEqual({
      after: 2,
      vendor: "codex",
      maxAttempts: 1,
    });
  });
});

describe("decideEscalation", () => {
  it("escalates the attempt after `after` consecutive failures", () => {
    const runs = history(run("t", "completed"), run("t", "failed"), run("t", "timeout"));
    const decision = decideEscalation("t", runs, ON, 3);
    expect(decision).toMatchObject({ escalate: true, failures: 2, escalatedFailures: 0 });
    expect(decision.escalation).toMatchObject({ vendor: "claude", model: "claude-opus-5-5" });
    expect(decision.reason).toBe("2 consecutive failed attempts; escalated attempt 1 of 1");
  });

  it("does not escalate before `after` failures, nor when escalation is off", () => {
    expect(decideEscalation("t", history(run("t", "failed")), ON, 3).escalate).toBe(false);
    const twoFailures = history(run("t", "failed"), run("t", "failed"));
    expect(decideEscalation("t", twoFailures, undefined, 3).escalate).toBe(false);
    expect(decideEscalation("t", twoFailures, { ...ON, enabled: false }, 3).escalate).toBe(false);
  });

  it("stops once maxAttempts escalated attempts have failed", () => {
    const runs = history(run("t", "failed"), run("t", "failed"), run("t", "failed", true));
    expect(countEscalatedFailures("t", runs)).toBe(1);
    expect(decideEscalation("t", runs, ON, 3).escalate).toBe(false);
    expect(decideEscalation("t", runs, { ...ON, maxAttempts: 2 }, 3)).toMatchObject({
      escalate: true,
      reason: "3 consecutive failed attempts; escalated attempt 2 of 2",
    });
  });

  it("escalates at the stuck threshold when that comes before `after`", () => {
    const runs = history(run("t", "failed"), run("t", "failed"));
    expect(decideEscalation("t", runs, { ...ON, after: 5 }, 2).escalate).toBe(true);
  });

  it("counts only the current streak, so a success resets it", () => {
    const runs = history(run("t", "failed", true), run("t", "completed"), run("t", "failed"));
    expect(countEscalatedFailures("t", runs)).toBe(0);
    expect(decideEscalation("t", runs, ON, 3).escalate).toBe(false);
  });
});

describe("stuck-task detection with escalation", () => {
  const stuckAfter = (runs: RunRecord[], config: EscalationConfig | undefined) =>
    getStuckTaskIds(runs, 2, config?.enabled ? (id) => isEscalationPending(id, runs, config) : undefined);

  it("holds a task back while an escalated attempt is still owed", () => {
    const runs = history(run("t", "failed"), run("t", "failed"));
    expect(stuckAfter(runs, ON).has("t")).toBe(false);
  });

  it("skips the task as stuck once the escalated attempt has failed too", () => {
    const runs = history(run("t", "failed"), run("t", "failed"), run("t", "failed", true));
    expect(stuckAfter(runs, ON).has("t")).toBe(true);
  });

  it("is unchanged with escalation disabled", () => {
    const runs = history(run("t", "failed"), run("t", "failed"));
    expect(stuckAfter(runs, undefined).has("t")).toBe(true);
    expect(stuckAfter(runs, { ...ON, enabled: false }).has("t")).toBe(true);
  });
});

describe("planEscalation and the per-task resolution", () => {
  const llmConfig = { vendor: "local" as const };
  const decision = decideEscalation(
    "t",
    history(run("t", "failed"), run("t", "failed")),
    { enabled: true, vendor: "claude", model: TIER_MODELS.claude.heavy },
    3,
  );
  const resolve = (flags: Record<string, string>, item?: { id: string; title: string; run?: unknown }) => {
    const { plan, skipped } = planEscalation({ decision, flags, vendor: "local", llmConfig });
    const settings = resolveTaskRunSettings({
      flags,
      config: { ...DEFAULT_HENCH_CONFIG(), provider: "api" },
      configuredHenchKeys: new Set(["provider"]),
      llmConfig: plan?.llmConfig ?? llmConfig,
      vendor: plan?.vendor ?? "local",
      autonomous: true,
      ...(item ? { item: item as never } : {}),
      ...(plan ? { escalation: plan.model ? { model: plan.model } : {} } : {}),
    });
    return { plan, skipped, settings };
  };

  it("picks the escalation vendor and model, on that vendor's CLI", () => {
    const { plan, settings } = resolve({});
    expect(plan).toMatchObject({ vendor: "claude", fromVendor: "local", failures: 2 });
    expect(plan?.llmConfig.vendor).toBe("claude");
    expect(settings.model).toMatchObject({ value: TIER_MODELS.claude.heavy, source: "hench.escalation.model" });
    expect(settings.provider).toMatchObject({ value: "cli", source: "hench.escalation" });
  });

  it("lets an explicit model flag win: the attempt is not escalated", () => {
    const { plan, skipped, settings } = resolve({ model: "gpt-oss-20b" });
    expect(plan).toBeUndefined();
    expect(skipped).toMatch(/^Not escalating: --model=gpt-oss-20b pins this run's model/);
    expect(settings.model).toMatchObject({ value: "gpt-oss-20b", source: "cli-flag" });
  });

  it("lets an explicit provider flag and a task's saved model keep their precedence", () => {
    const { settings } = resolve(
      { provider: "api" },
      { id: "t", title: "T", run: { models: { claude: TIER_MODELS.claude.light } } },
    );
    expect(settings.provider).toMatchObject({ value: "api", source: "cli-flag" });
    expect(settings.model).toMatchObject({ value: TIER_MODELS.claude.light, source: "task.run.models" });
  });

  it("does nothing when the decision does not escalate", () => {
    expect(planEscalation({ decision: { escalate: false, failures: 1, escalatedFailures: 0 }, flags: {}, vendor: "local", llmConfig })).toEqual({});
  });
});

describe("the run record notes the escalation", () => {
  let tmpBase: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpBase = await mkdtemp(join(tmpdir(), "hench-escalation-"));
    henchDir = join(tmpBase, ".hench");
    await mkdir(join(henchDir, "runs"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpBase, { recursive: true, force: true });
  });

  const escalation: RunEscalation = {
    escalated: true,
    vendor: "claude",
    model: "claude-opus-5-5",
    fromVendor: "local",
    failures: 2,
    reason: "2 consecutive failed attempts; escalated attempt 1 of 1",
  };

  it("records vendor, model and that it escalated, and keeps them through saveRun → loadRun", async () => {
    const { run: record } = await initRunRecord({
      taskId: "t-1",
      taskTitle: "A task",
      model: "claude-opus-5-5",
      vendor: "claude",
      henchDir,
      projectDir: tmpBase,
      invocationContext: "cli",
      escalation,
    });
    expect(record.escalation).toEqual(escalation);
    record.status = "failed";
    await saveRun(henchDir, record);
    expect((await loadRun(henchDir, record.id)).escalation).toEqual(escalation);
  });

  it("writes no escalation for an ordinary attempt", async () => {
    const { run: record } = await initRunRecord({
      taskId: "t-1", taskTitle: "A task", model: "m", henchDir, projectDir: tmpBase, invocationContext: "cli",
    });
    expect(Object.keys(record)).not.toContain("escalation");
  });

  it("logs one line naming the task, why and the vendor/model", () => {
    expect(formatEscalationLine("Scan repos", "t-1", escalation)).toBe(
      'Escalating "Scan repos" (t-1): 2 consecutive failed attempts; escalated attempt 1 of 1. ' +
        "Running this attempt on claude/claude-opus-5-5 instead of local.",
    );
  });
});

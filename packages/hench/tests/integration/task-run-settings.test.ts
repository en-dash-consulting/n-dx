/**
 * `ndx work` honours the run settings a task saved on itself.
 *
 * The settings live on the PRD item (`run:` in its front matter, written by the
 * rex MCP tools, `rex update --run` and the dashboard) and are resolved **per
 * task, after selection** — so a `--loop` or `--iterations` run applies each
 * task's own model, provider, budgets and gates, while an explicit CLI flag
 * applies to every task in the loop.
 *
 * Pinned here:
 *  - precedence, per setting: CLI flag > task `run` > `hench.*` > `llm.*` > default
 *  - a saved block that cannot be honoured never wedges a run: an incompatible
 *    model and a malformed block each warn and fall back
 *  - the run record tells the truth about which model ran: `weight` is the tier
 *    of the model actually sent (not the tier `agent.execute` routes to), and
 *    `modelSource` names the setting that chose it
 *  - `--resolve` reports the same resolution, from the same function
 *
 * @see packages/hench/src/cli/commands/run-settings.ts — the shared resolver
 * @see packages/rex/src/schema/v1.ts — `RunSettings`, and the precedence it declares
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NEWEST_MODELS, REVIEW_MODELS, TIER_MODELS, resolveModel } from "@n-dx/llm-client";
import type { LLMConfig, LLMVendor } from "@n-dx/llm-client";
import { resolveTaskRunSettings, weightOfModel } from "../../src/cli/commands/run-settings.js";
import type { TaskRunSettings } from "../../src/cli/commands/run-settings.js";
import { resolveRun } from "../../src/cli/commands/run-resolve.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/index.js";
import type { HenchConfig } from "../../src/schema/index.js";
import type { PRDItem } from "../../src/prd/rex-gateway.js";
import { resolveStore } from "../../src/prd/rex-gateway.js";
import { cleanupProjectDir, commitGitFixtureBaseline, setupProjectDir } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

/** A task carrying `run`, as the store would hand it to the resolver. */
function task(run: unknown, title = "Saved task"): Pick<PRDItem, "id" | "title" | "run"> {
  return { id: "t-1", title, run: run as PRDItem["run"] };
}

function resolveFor(
  options: {
    flags?: Record<string, string>;
    config?: Partial<HenchConfig>;
    llm?: LLMConfig;
    vendor?: LLMVendor;
    item?: Pick<PRDItem, "id" | "title" | "run">;
    autonomous?: boolean;
    contextFileText?: string;
  } = {},
): TaskRunSettings {
  return resolveTaskRunSettings({
    flags: options.flags ?? {},
    config: { ...DEFAULT_HENCH_CONFIG(), ...options.config } as HenchConfig,
    configuredHenchKeys: new Set(Object.keys(options.config ?? {})),
    llmConfig: options.llm ?? { vendor: "claude" },
    vendor: options.vendor ?? "claude",
    autonomous: options.autonomous ?? true,
    ...(options.item ? { item: options.item } : {}),
    ...(options.contextFileText !== undefined ? { contextFileText: options.contextFileText } : {}),
  });
}

describe("precedence: CLI flag > task run > hench.* > llm.* > default", () => {
  it("takes the model from the task's vendor pin when no flag overrides it", () => {
    const r = resolveFor({ item: task({ models: { claude: TIER_MODELS.claude.heavy } }) });

    expect(r.model).toMatchObject({
      value: TIER_MODELS.claude.heavy,
      source: "task.run.models",
      weight: "heavy",
    });
  });

  it("resolves a saved tier per vendor, through the project's own llm.tiers override", () => {
    const plain = resolveFor({ item: task({ tier: "light" }) });
    expect(plain.model).toMatchObject({ value: TIER_MODELS.claude.light, source: "task.run.tier", weight: "light" });

    const overridden = resolveFor({
      item: task({ tier: "light" }),
      llm: { vendor: "claude", tiers: { claude: { light: TIER_MODELS.claude.standard } } },
    });
    expect(overridden.model.value).toBe(TIER_MODELS.claude.standard);
    expect(overridden.model.source).toBe("task.run.tier");
  });

  it("prefers an exact vendor pin over the saved tier", () => {
    const r = resolveFor({ item: task({ tier: "light", models: { claude: TIER_MODELS.claude.heavy } }) });

    expect(r.model.value).toBe(TIER_MODELS.claude.heavy);
  });

  it("resolves the same saved tier to the vendor the run is actually on", () => {
    const r = resolveFor({
      item: task({ tier: "heavy", models: { claude: TIER_MODELS.claude.heavy } }),
      vendor: "codex",
      llm: { vendor: "codex" },
    });

    // The claude pin does not apply on codex; the portable tier does.
    expect(r.model).toMatchObject({ value: TIER_MODELS.codex.heavy, source: "task.run.tier" });
  });

  it("lets an explicit --model outrank every saved model", () => {
    const r = resolveFor({
      flags: { model: TIER_MODELS.claude.light },
      item: task({ tier: "heavy", models: { claude: TIER_MODELS.claude.heavy } }),
    });

    expect(r.model).toMatchObject({ value: TIER_MODELS.claude.light, source: "cli-flag", weight: "light" });
  });

  it("puts the saved model above hench.models and llm.*", () => {
    const r = resolveFor({
      item: task({ models: { claude: TIER_MODELS.claude.light } }),
      config: { models: { claude: TIER_MODELS.claude.heavy } },
      llm: { vendor: "claude", model: TIER_MODELS.claude.standard },
    });

    expect(r.model.value).toBe(TIER_MODELS.claude.light);
  });

  it("falls back to hench.models when the task saves no model", () => {
    const r = resolveFor({
      item: task({ review: true }),
      config: { models: { claude: TIER_MODELS.claude.light } },
    });

    expect(r.model).toMatchObject({ value: TIER_MODELS.claude.light, source: "hench.models.claude" });
  });

  it("carries provider, permission mode, budgets and gates off the saved block", () => {
    const r = resolveFor({
      item: task({
        provider: "api",
        permissionMode: "bypassPermissions",
        maxTurns: 7,
        tokenBudget: 1234,
        skipTestGate: true,
      }),
    });

    expect(r.provider).toMatchObject({ value: "api", source: "task.run" });
    expect(r.permissionMode).toMatchObject({ value: "bypassPermissions", source: "task.run" });
    expect(r.maxTurns).toEqual({ value: 7, source: "task.run" });
    expect(r.tokenBudget).toEqual({ value: 1234, source: "task.run" });
    expect(r.skipTestGate).toEqual({ value: true, source: "task.run" });
  });

  it("lets a CLI flag outrank each of them", () => {
    const r = resolveFor({
      flags: { provider: "cli", "permission-mode": "acceptEdits", "max-turns": "3", "token-budget": "9" },
      item: task({ provider: "api", permissionMode: "bypassPermissions", maxTurns: 7, tokenBudget: 1234 }),
    });

    expect(r.provider.source).toBe("cli-flag");
    expect(r.permissionMode).toEqual({ value: "acceptEdits", source: "cli-flag" });
    expect(r.maxTurns).toEqual({ value: 3, source: "cli-flag" });
    expect(r.tokenBudget).toEqual({ value: 9, source: "cli-flag" });
  });

  it("re-enables a test gate hench config skips, because saved false means false", () => {
    const skipped = resolveFor({ config: { skipFullTestGate: true } });
    expect(skipped.skipTestGate).toEqual({ value: true, source: "hench.skipFullTestGate" });

    const restored = resolveFor({ config: { skipFullTestGate: true }, item: task({ skipTestGate: false }) });
    expect(restored.skipTestGate).toEqual({ value: false, source: "task.run" });

    // The flag has no negative form, so it can only ever turn the gate off.
    const flagged = resolveFor({
      flags: { "skip-test-gate": "true" },
      config: { skipFullTestGate: true },
      item: task({ skipTestGate: false }),
    });
    expect(flagged.skipTestGate).toEqual({ value: true, source: "cli-flag" });
  });

  it("turns the review pass on from the saved block, with its own reviewer", () => {
    const r = resolveFor({
      item: task({ review: true, reviewTier: "light", reviewOptional: true }),
    });

    expect(r.review).toEqual({ value: true, source: "task.run" });
    expect(r.reviewModel).toMatchObject({ value: TIER_MODELS.claude.light, source: "task.run.reviewTier" });
    expect(r.reviewOptional).toEqual({ value: true, source: "task.run" });
  });

  it("prefers an exact saved reviewer pin over the saved review tier", () => {
    const r = resolveFor({
      item: task({ review: true, reviewTier: "light", reviewModels: { claude: TIER_MODELS.claude.heavy } }),
    });

    expect(r.reviewModel).toMatchObject({
      value: TIER_MODELS.claude.heavy,
      source: "task.run.reviewModels",
      vendorDefault: REVIEW_MODELS.claude,
    });
  });

  it("delivers saved context notes the way --context-file does, and lets the flag replace them", () => {
    const saved = resolveFor({ item: task({ contextNotes: "mind the lock" }) });
    expect(saved.contextNotes).toEqual({ value: "mind the lock", source: "task.run" });

    const flagged = resolveFor({ item: task({ contextNotes: "mind the lock" }), contextFileText: "from the file" });
    expect(flagged.contextNotes).toEqual({ value: "from the file", source: "cli-flag" });
  });
});

describe("a saved block that cannot be honoured never wedges a run", () => {
  it("skips a model the active vendor cannot run, warns naming the task, and carries on down the chain", () => {
    const r = resolveFor({
      vendor: "claude",
      item: task({ models: { claude: "gpt-5.6-terra" } }, "Mispinned task"),
    });

    expect(r.model.value).toBe(NEWEST_MODELS.claude);
    expect(r.model.source).toBe("vendor-default");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("Mispinned task");
    expect(r.warnings[0]).toContain("gpt-5.6-terra");
  });

  it("still honours the saved tier when the saved exact pin is incompatible", () => {
    const r = resolveFor({
      item: task({ tier: "light", models: { claude: "gpt-5.6-terra" } }),
    });

    expect(r.model).toMatchObject({ value: TIER_MODELS.claude.light, source: "task.run.tier" });
    expect(r.warnings).toHaveLength(1);
  });

  it("ignores a malformed block whole, with one warning, and resolves as if it were absent", () => {
    const r = resolveFor({
      config: { maxTurns: 11 },
      item: task({ tier: "free", maxTurns: 7 }, "Hand-edited task"),
    });

    expect(r.model.source).toBe("vendor-default");
    expect(r.maxTurns).toEqual({ value: 11, source: "hench.maxTurns" });
    expect(r.saved).toBeUndefined();
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("Hand-edited task");
  });

  it("treats an empty block as no block at all", () => {
    const r = resolveFor({ item: task({}) });

    expect(r.saved).toBeUndefined();
    expect(r.warnings).toEqual([]);
  });

  it("falls through a saved tier on local, which has no catalog to resolve it against", () => {
    const r = resolveFor({
      vendor: "local",
      llm: { vendor: "local", local: { model: "qwen-local" } },
      item: task({ tier: "heavy" }),
    });

    expect(r.model.value).toBe("qwen-local");
    expect(r.model.source).not.toBe("task.run.tier");
  });
});

// ---------------------------------------------------------------------------
// The run record's weight
// ---------------------------------------------------------------------------

describe("weight is the tier of the model that actually ran", () => {
  const llm: LLMConfig = { vendor: "claude" };

  it("records the routed tier for a model the llm.* chain picked", () => {
    expect(
      weightOfModel({
        vendor: "claude",
        model: NEWEST_MODELS.claude,
        llmConfig: llm,
        routedTier: "standard",
        fromRouteChain: true,
      }),
    ).toBe("standard");
  });

  it("reverse-maps an overridden model rather than reporting the route's tier", () => {
    expect(
      weightOfModel({
        vendor: "claude",
        model: TIER_MODELS.claude.light,
        llmConfig: llm,
        routedTier: "standard",
        fromRouteChain: false,
      }),
    ).toBe("light");
  });

  it("prefers the routed tier when several tiers name the same model, else the heaviest", () => {
    // Both standard and heavy resolve to the same model here.
    const tied: LLMConfig = {
      vendor: "claude",
      tiers: { claude: { standard: TIER_MODELS.claude.heavy, heavy: TIER_MODELS.claude.heavy } },
    };
    const shared = { vendor: "claude" as const, model: TIER_MODELS.claude.heavy, llmConfig: tied, fromRouteChain: false };

    expect(weightOfModel({ ...shared, routedTier: "standard" })).toBe("standard");
    expect(weightOfModel({ ...shared, routedTier: "light" })).toBe("heavy");
  });

  it("records a model in no tier as custom rather than filing it under standard", () => {
    expect(
      weightOfModel({
        vendor: "claude",
        model: "claude-3-5-haiku-20241022",
        llmConfig: llm,
        routedTier: "standard",
        fromRouteChain: false,
      }),
    ).toBe("custom");
  });

  it("gives an explicit heavy-tier --model the heavy weight, not the routed standard", () => {
    const r = resolveFor({ flags: { model: TIER_MODELS.claude.heavy } });

    expect(r.model.weight).toBe("heavy");
    expect(r.model.source).toBe("cli-flag");
  });
});

// ---------------------------------------------------------------------------
// `--resolve` reports the same resolution
// ---------------------------------------------------------------------------

const DOC = {
  schema: "rex/v1",
  title: "Saved settings",
  items: [
    {
      id: "epic-1",
      title: "Epic",
      level: "epic" as const,
      status: "pending" as const,
      children: [
        {
          id: "t-saved",
          title: "Task with saved settings",
          level: "task" as const,
          status: "pending" as const,
          run: { models: { claude: TIER_MODELS.claude.heavy }, maxTurns: 12, review: true },
        },
        { id: "t-plain", title: "Task with none", level: "task" as const, status: "pending" as const },
      ],
    },
  ],
};

describe("ndx work --resolve reports the task's saved settings", () => {
  let projectDir: string;
  let rexDir: string;

  beforeEach(async () => {
    ({ projectDir, rexDir } = await setupProjectDir("hench-task-run-settings-"));
    await (await resolveStore(rexDir)).saveDocument(DOC as never);
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", claude: { cli_path: process.execPath } } }),
      "utf-8",
    );
    commitGitFixtureBaseline(projectDir);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  it("names task.run as the source of each setting the task saved", async () => {
    const r = await resolveRun(projectDir, { task: "t-saved" });

    expect(r.resolved.model).toEqual({ value: TIER_MODELS.claude.heavy, source: "task.run.models" });
    expect(r.resolved.maxTurns).toEqual({ value: 12, source: "task.run" });
    expect(r.resolved.review).toEqual({ value: true, source: "task.run" });
    expect(r.refusals).toEqual([]);
  });

  it("leaves a task with no saved block resolving from config, as before", async () => {
    const r = await resolveRun(projectDir, { task: "t-plain" });

    expect(r.resolved.model).toEqual({ value: resolveModel(NEWEST_MODELS.claude), source: "vendor-default" });
    expect(r.resolved.review).toEqual({ value: false, source: "built-in" });
  });

  it("reports a CLI flag as the winner over the saved value, as a run would apply it", async () => {
    const r = await resolveRun(projectDir, { task: "t-saved", model: TIER_MODELS.claude.light, "max-turns": "4" });

    expect(r.resolved.model).toEqual({ value: TIER_MODELS.claude.light, source: "cli-flag" });
    expect(r.resolved.maxTurns).toEqual({ value: 4, source: "cli-flag" });
  });
});

/**
 * The model tier table of `GET /api/llm/config`: for the active vendor, which
 * model each tier resolves to, which config key supplied it, and which
 * commands run on it.
 *
 * Models come from llm-client's `resolveTaskModel` — with `agent.execute`'s
 * route forced to each tier — and the tier → commands grouping from `DEFAULT_ROUTES`
 * overlaid with the project's `llm.routes`, resolved through that same
 * function. Nothing here re-implements routing, so the table cannot disagree
 * with what a run uses. The page renders it and applies no rules of its own.
 */

import { DEFAULT_ROUTES, resolveTaskModel } from "@n-dx/llm-client";
import type { LLMConfig, LLMVendor, ModelSourceKey, TaskTier } from "@n-dx/llm-client";
import type { EffectiveAgentConfig } from "./effective-agent-config.js";

/** Rows of the table, in display order. */
export type TierName = "agent" | TaskTier;

export interface TierUse {
  /** Absent for a user that is not a task class, such as Prepare task's Heavy setting. */
  taskClass?: string;
  label: string;
}

export interface TierRow {
  tier: TierName;
  /** Fully-qualified model that tier resolves to. */
  model: string;
  /** The config key that supplied {@link TierRow.model}, or `catalog default`. */
  source: string;
  usedBy: TierUse[];
}

/**
 * User-facing name of each task class, as the commands and views are called.
 * Must cover every `DEFAULT_ROUTES` key — a test fails when one is missing.
 */
export const TASK_CLASS_LABELS: Record<string, string> = {
  "agent.execute": "ndx work",
  "git.commit-message": "commit messages",
  "context.summarize": "summaries",
  "context.distill": "context distillation",
  "prd.propose": "ndx plan",
  "prd.consolidate-check": "duplicate check",
  "prd.decompose": "task breakdown",
  "prd.rename": "rename/merge",
  "prd.merge": "rename/merge",
  "prd.assess": "assess",
  "prd.modify": "ndx edit",
  "prd.clarify": "clarifying questions",
  "prd.spec": "spec",
  "prd.smart-add": "ndx add",
  "prd.restructure": "reshape",
  "prd.place": "change placement",
  "prd.place.judge": "change placement (Jev)",
  "prd.migrate.judge": "migration review",
  "code.classify": "classify",
  "zone.enrich-scan": "analyze (scan)",
  "zone.enrich-deep": "deep analyze",
  "zone.meta-eval": "zone evaluation",
  "finding.judge": "finding review",
  "zone.judge": "zone review",
  "sourcevision.ask": "Ask",
};

/** Heavy has a user — a per-task setting that no task class names. */
const PREPARE_TASK_HEAVY: TierUse = {
  label: "tasks set to Heavy in Prepare task",
};

/** Tiers a task class can resolve to, in display order after `agent`. */
const TASK_TIERS: readonly TaskTier[] = ["standard", "light", "heavy", "free"];

/** The user-facing key name; the catalog rung is not a key, so it says so. */
function describeSource(source: ModelSourceKey): string {
  // `llm.routes` means a route picked a tier whose model is the vendor's.
  return source === "vendor-default" || source === "llm.routes" ? "catalog default" : source;
}

/** What `tier` resolves to, ignoring which class asked for it. */
function resolveTier(
  tier: TaskTier,
  vendor: LLMVendor,
  config: LLMConfig,
): { model: string; source: string } {
  // Force one registered class's route to the tier and leave the other routes
  // alone, as hench's `modelForTier` does, so `llm.tiers` overrides and vendor
  // normalisation apply exactly as in a run.
  const probe = resolveTaskModel(
    "agent.execute",
    { ...config, routes: { ...config.routes, "agent.execute": tier } },
    { vendor },
  );
  return { model: probe.model, source: describeSource(probe.source) };
}

/**
 * Build the tier table for `vendor`.
 *
 * `agent` reports the `effective` block's model, whose `hench.models.<vendor>`
 * pin wins over the tier chain. `free` appears only when
 * `llm.tiers.<vendor>.free` is set; otherwise free work runs on light.
 */
export function buildTierTable(
  vendor: LLMVendor,
  config: LLMConfig,
  effective: EffectiveAgentConfig,
): TierRow[] {
  const usedBy = new Map<TaskTier, TierUse[]>(TASK_TIERS.map((tier) => [tier, []]));
  for (const taskClass of Object.keys(DEFAULT_ROUTES)) {
    if (taskClass === "agent.execute") continue;
    const { tier } = resolveTaskModel(taskClass, config, { vendor });
    usedBy.get(tier)?.push({ taskClass, label: TASK_CLASS_LABELS[taskClass] ?? taskClass });
  }
  usedBy.get("heavy")?.push(PREPARE_TASK_HEAVY);

  const agentSource =
    effective.modelSource === "hench-override"
      ? `hench.models.${vendor}`
      : describeSource(resolveTaskModel("agent.execute", config, { vendor }).source);

  const rows: TierRow[] = [
    {
      tier: "agent",
      model: effective.model,
      source: agentSource,
      usedBy: [{ taskClass: "agent.execute", label: TASK_CLASS_LABELS["agent.execute"] ?? "agent.execute" }],
    },
  ];
  for (const tier of TASK_TIERS) {
    if (tier === "free" && !config.tiers?.[vendor]?.free) continue;
    rows.push({ tier, ...resolveTier(tier, vendor, config), usedBy: usedBy.get(tier) ?? [] });
  }
  return rows;
}

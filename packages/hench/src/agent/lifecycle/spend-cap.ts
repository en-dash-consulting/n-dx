/**
 * USD spend caps: `hench.maxCostUsdPerRun` and `hench.maxCostUsdPerDay`.
 *
 * Checked before every vendor spawn, so a run stops before it starts another
 * session it cannot afford rather than learning afterwards that it overspent.
 * Spend is priced with llm-client's model table — the arithmetic `ndx usage`
 * quotes — from the token counts the run ledger (`.hench/runs`) records.
 *
 * Both caps are operator settings only: a task's saved `run` block has no key
 * for them (rex's validator rejects one), so PRD content cannot raise them.
 *
 * @module
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveModelPricing, priceTokens } from "../../prd/llm-gateway.js";
import { listRunsByIds } from "../../store/runs.js";
import type { RunRecord, TokenUsage, TurnTokenUsage } from "../../schema/index.js";

/** What a run is priced from. */
export interface PricedUsage {
  tokenUsage: TokenUsage | undefined;
  turnTokenUsage?: ReadonlyArray<TurnTokenUsage>;
  /** The run's model; used for turns that name none and for any untracked remainder. */
  model: string | undefined;
}

function priceBucket(usage: Partial<TokenUsage> | undefined, model: string | undefined): number {
  if (!usage) return 0;
  return priceTokens(
    {
      inputTokens: usage.input ?? 0,
      outputTokens: usage.output ?? 0,
      cacheCreationTokens: usage.cacheCreationInput ?? 0,
      cacheReadTokens: usage.cacheReadInput ?? 0,
    },
    resolveModelPricing(model).pricing,
  ).totalRaw;
}

/**
 * The USD cost of a run's usage.
 *
 * Per-turn entries are priced at their own model (a review on another model is
 * charged at that model's rates); whatever the run total holds beyond the
 * per-turn entries is priced at the run's model. An unknown model is priced at
 * llm-client's fallback rates rather than at zero, so an unrecognised id never
 * reads as free.
 */
export function priceRunUsd(run: PricedUsage): number {
  const total = run.tokenUsage ?? { input: 0, output: 0 };
  const turns = run.turnTokenUsage ?? [];
  let cost = 0;
  const covered = { input: 0, output: 0, cacheCreationInput: 0, cacheReadInput: 0 };
  for (const turn of turns) {
    cost += priceBucket(turn, turn.model ?? run.model);
    covered.input += turn.input ?? 0;
    covered.output += turn.output ?? 0;
    covered.cacheCreationInput += turn.cacheCreationInput ?? 0;
    covered.cacheReadInput += turn.cacheReadInput ?? 0;
  }
  cost += priceBucket(
    {
      input: Math.max(0, (total.input ?? 0) - covered.input),
      output: Math.max(0, (total.output ?? 0) - covered.output),
      cacheCreationInput: Math.max(0, (total.cacheCreationInput ?? 0) - covered.cacheCreationInput),
      cacheReadInput: Math.max(0, (total.cacheReadInput ?? 0) - covered.cacheReadInput),
    },
    run.model,
  );
  return cost;
}

/** Local midnight of the day `now` falls in — the start of the per-day window. */
export function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * USD spent today by runs in the ledger, excluding `excludeRunId` (the run
 * asking, whose in-memory spend is newer than its last save).
 *
 * "Today" is the local calendar day, by each run's `startedAt`. Files last
 * written before midnight are skipped without being parsed: a run that started
 * today cannot have been written before today.
 */
export async function ledgerSpendTodayUsd(
  henchDir: string,
  now: Date,
  excludeRunId?: string,
): Promise<number> {
  const runsDir = join(henchDir, "runs");
  const since = startOfLocalDay(now).getTime();
  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return 0;
  }
  const ids: string[] = [];
  for (const file of files) {
    if (file.startsWith(".")) continue;
    const match = /^(.*)\.json(\.gz)?$/.exec(file);
    if (!match) continue;
    const id = match[1];
    if (id === excludeRunId) continue;
    try {
      if ((await stat(join(runsDir, file))).mtimeMs < since) continue;
    } catch {
      continue;
    }
    ids.push(id);
  }
  const runs: RunRecord[] = await listRunsByIds(henchDir, [...new Set(ids)]);
  let total = 0;
  for (const run of runs) {
    if (Date.parse(run.startedAt) < since) continue;
    total += priceRunUsd(run);
  }
  return total;
}

/** Which cap a run hit, and by how much. */
export interface SpendCapExceeded {
  cap: "maxCostUsdPerRun" | "maxCostUsdPerDay";
  limitUsd: number;
  spentUsd: number;
  message: string;
}

export interface SpendCapLimits {
  /** `hench.maxCostUsdPerRun`; 0 or undefined = unlimited. */
  maxCostUsdPerRun?: number;
  /** `hench.maxCostUsdPerDay`; 0 or undefined = unlimited. */
  maxCostUsdPerDay?: number;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

/**
 * Compare spend against the caps. A cap is reached at equality: a run that has
 * spent its whole allowance does not get another session.
 */
export function checkSpendCaps(
  limits: SpendCapLimits,
  spend: { runUsd: number; dayUsd?: number },
): SpendCapExceeded | undefined {
  const perRun = limits.maxCostUsdPerRun ?? 0;
  if (perRun > 0 && spend.runUsd >= perRun) {
    return {
      cap: "maxCostUsdPerRun",
      limitUsd: perRun,
      spentUsd: spend.runUsd,
      message:
        `Spend cap reached: this run has spent ${usd(spend.runUsd)} of its ` +
        `hench.maxCostUsdPerRun ${usd(perRun)}. No further vendor session was started.`,
    };
  }
  const perDay = limits.maxCostUsdPerDay ?? 0;
  if (perDay > 0 && spend.dayUsd !== undefined && spend.dayUsd >= perDay) {
    return {
      cap: "maxCostUsdPerDay",
      limitUsd: perDay,
      spentUsd: spend.dayUsd,
      message:
        `Spend cap reached: runs started today have spent ${usd(spend.dayUsd)} of ` +
        `hench.maxCostUsdPerDay ${usd(perDay)}. No further vendor session was started.`,
    };
  }
  return undefined;
}

/** A pre-spawn check: resolves to the cap that was hit, or undefined to proceed. */
export type SpendGate = () => Promise<SpendCapExceeded | undefined>;

/**
 * Build the gate a run passes to each vendor spawn. Undefined when neither cap
 * is set, so an uncapped run does no ledger reads at all.
 */
export function createSpendGate(opts: {
  limits: SpendCapLimits;
  henchDir: string;
  runId: string;
  /** This run's spend so far, from its in-memory counters. */
  currentRunUsd: () => number;
  now?: () => Date;
}): SpendGate | undefined {
  const perRun = opts.limits.maxCostUsdPerRun ?? 0;
  const perDay = opts.limits.maxCostUsdPerDay ?? 0;
  if (perRun <= 0 && perDay <= 0) return undefined;
  const now = opts.now ?? (() => new Date());
  return async () => {
    const runUsd = opts.currentRunUsd();
    const dayUsd = perDay > 0
      ? (await ledgerSpendTodayUsd(opts.henchDir, now(), opts.runId)) + runUsd
      : undefined;
    return checkSpendCaps(opts.limits, { runUsd, dayUsd });
  };
}

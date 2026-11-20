/**
 * What a run typically costs: the median wall time, tokens and dollars of the
 * finished task runs in a recent window, per tier and overall.
 *
 * Work's "Up next" list and its running rows read it as the estimate for a
 * run that has not finished. A median, not a mean, so one runaway run does not
 * double every estimate; with fewer than `MIN_SAMPLE` runs a group reports no
 * estimate rather than a number built on one or two runs.
 *
 * Pure: the route (`GET /api/hench/estimates` in routes-hench.ts) loads the
 * run summaries and the pricing function, so a test pins the arithmetic.
 *
 * @module web/server/run-estimates
 */

export const ESTIMATE_WINDOW_DAYS = 30;
/** Runs a group needs before it reports an estimate. */
export const MIN_SAMPLE = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The fields of a run summary this reads; routes-hench's `RunSummary` satisfies it. */
export interface EstimateRun {
  startedAt: string;
  finishedAt?: string;
  status: string;
  model: string;
  vendor?: string;
  weight?: string;
  tokenUsage: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
}

export interface RunEstimate {
  /** Finished runs the estimate is built on. */
  runs: number;
  /** Median wall time, start to finish. */
  durationMs: number;
  /** Median total tokens, cache reads and writes included. */
  tokens: number;
  /** Median priced cost in US dollars; null when no run in the group could be priced. */
  costUsd: number | null;
}

export interface RunEstimates {
  windowDays: number;
  /** Every finished run in the window; null below `MIN_SAMPLE`. */
  overall: RunEstimate | null;
  /** Per tier ("light", "standard", "heavy", "custom"), each only once it has `MIN_SAMPLE` runs. */
  byTier: Record<string, RunEstimate>;
}

/** Prices one run's tokens for its model; returns a non-finite number when it cannot. */
export type PriceRun = (run: EstimateRun) => number;

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function totalTokens(t: EstimateRun["tokenUsage"]): number {
  return t.input + t.output + (t.cacheCreationInput ?? 0) + (t.cacheReadInput ?? 0);
}

interface Sample { durationMs: number; tokens: number; costUsd: number | null }

function estimateOf(samples: readonly Sample[]): RunEstimate | null {
  if (samples.length < MIN_SAMPLE) return null;
  const costs = samples.flatMap((s) => (s.costUsd === null ? [] : [s.costUsd]));
  return {
    runs: samples.length,
    durationMs: Math.round(median(samples.map((s) => s.durationMs))),
    tokens: Math.round(median(samples.map((s) => s.tokens))),
    costUsd: costs.length === 0 ? null : median(costs),
  };
}

/**
 * Finished runs only: a run still going has no duration yet, and one with no
 * finish time or a finish before its start is a broken record, not a sample.
 */
export function summarizeEstimates(
  runs: readonly EstimateRun[],
  price: PriceRun,
  now: Date = new Date(),
  windowDays: number = ESTIMATE_WINDOW_DAYS,
): RunEstimates {
  const since = now.getTime() - windowDays * DAY_MS;
  const all: Sample[] = [];
  const tiers = new Map<string, Sample[]>();
  for (const run of runs) {
    if (run.status === "running" || !run.finishedAt) continue;
    const started = Date.parse(run.startedAt);
    const finished = Date.parse(run.finishedAt);
    if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) continue;
    if (started < since || started > now.getTime()) continue;
    const cost = price(run);
    const sample: Sample = {
      durationMs: finished - started,
      tokens: totalTokens(run.tokenUsage),
      costUsd: Number.isFinite(cost) && cost >= 0 ? cost : null,
    };
    all.push(sample);
    if (run.weight) {
      const list = tiers.get(run.weight) ?? [];
      list.push(sample);
      tiers.set(run.weight, list);
    }
  }
  const byTier: Record<string, RunEstimate> = {};
  for (const [tier, samples] of tiers) {
    const estimate = estimateOf(samples);
    if (estimate) byTier[tier] = estimate;
  }
  return { windowDays, overall: estimateOf(all), byTier };
}

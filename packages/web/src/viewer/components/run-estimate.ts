/**
 * What a run typically takes, read from `GET /api/hench/estimates`: the median
 * wall time, tokens and cost of the finished runs in the last 30 days, per
 * tier and overall. Work's Up next shows the overall figure once, above the
 * list, and a chip on a row only when that row's tier has a figure of its own,
 * so the same line is never repeated down the queue. Running now measures each
 * run against the overall figure.
 *
 * An estimate is a median of past runs, not a promise, so every line reads
 * "~" and says how many runs it rests on in its tooltip. A tier with too few
 * runs of its own falls back to the overall figure; with too few runs at all
 * the server sends none and nothing is shown.
 *
 * @module viewer/components/run-estimate
 */

import { h } from "preact";
import { useEffect, useState } from "preact/hooks";

/** Mirrors `RunEstimate` in server/run-estimates.ts. */
export interface RunEstimate {
  runs: number;
  durationMs: number;
  tokens: number;
  costUsd: number | null;
}

/** Mirrors `RunEstimates` in server/run-estimates.ts. */
export interface RunEstimates {
  windowDays: number;
  overall: RunEstimate | null;
  byTier: Record<string, RunEstimate>;
}

/** The estimate for a run on `tier`; the overall figure when the tier has none of its own. */
export function estimateFor(estimates: RunEstimates | null, tier?: string | null): RunEstimate | null {
  if (!estimates) return null;
  return (tier ? estimates.byTier[tier] : undefined) ?? estimates.overall;
}

/** "45s", "12 min", "1 h 20 min". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "850", "41k", "1.2M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "$0.85", "<$0.01". */
export function formatUsd(n: number): string {
  return n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

/** The estimate as one line: "~12 min · ~41k tokens · ~$0.85". */
export function estimateLine(e: RunEstimate): string {
  return [
    `~${formatDuration(e.durationMs)}`,
    `~${formatTokens(e.tokens)} tokens`,
    ...(e.costUsd === null ? [] : [`~${formatUsd(e.costUsd)}`]),
  ].join(" · ");
}

/** Where the estimate comes from, for its tooltip. */
export function estimateBasis(e: RunEstimate, estimates: RunEstimates, tier?: string | null): string {
  const scope = tier && estimates.byTier[tier] === e ? `${tier} runs` : "runs";
  return `Median of ${e.runs} finished ${scope} in the last ${estimates.windowDays} days`;
}

/**
 * The estimates, read once per mount; null until they arrive and when the
 * server has none. A failed read is no estimate rather than an error: the
 * rows it decorates still work without it.
 */
export function useRunEstimates(enabled = true): RunEstimates | null {
  const [estimates, setEstimates] = useState<RunEstimates | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/hench/estimates")
      .then((res) => (res.ok ? res.json() as Promise<RunEstimates> : null))
      .then((body) => { if (!cancelled && body && typeof body === "object") setEstimates(body); })
      .catch(() => { /* no estimate: the rows show none */ });
    return () => { cancelled = true; };
  }, [enabled]);
  return estimates;
}

/**
 * The estimate as a chip, or nothing when there is none. With `ownTier`, only a
 * tier's own figure is shown: a list that states the typical run once does not
 * repeat it on every row.
 */
export function EstimateChip({ estimates, tier, ownTier = false, class: cls }: {
  estimates: RunEstimates | null;
  tier?: string | null;
  ownTier?: boolean;
  class?: string;
}) {
  const e = ownTier ? (tier && estimates ? estimates.byTier[tier] ?? null : null) : estimateFor(estimates, tier);
  if (!e || !estimates) return null;
  return h("span", { class: `run-estimate${cls ? ` ${cls}` : ""}`, title: estimateBasis(e, estimates, tier) }, estimateLine(e));
}

/** "Typical run ~7 min · ~41k tokens · ~$0.85", stated once above a list; nothing without an estimate. */
export function TypicalRun({ estimates, class: cls }: { estimates: RunEstimates | null; class?: string }) {
  const e = estimates?.overall;
  if (!e || !estimates) return null;
  return h("p", { class: `run-typical${cls ? ` ${cls}` : ""}`, title: estimateBasis(e, estimates, null) },
    h("span", { class: "run-typical-label" }, "Typical run"),
    h("span", { class: "run-estimate" }, estimateLine(e)),
  );
}

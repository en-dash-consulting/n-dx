/**
 * Outcomes by tier — the gate pass rate per vendor and tier, from the run
 * records on this machine.
 *
 * Keyed on vendor plus tier, never on model name: models are renamed and
 * retired, tiers are what a project chooses. The resolved models stay on each
 * row for the tooltip. Pure — no Preact, no fetch — so a test can pin the
 * arithmetic against a hand count.
 */

/** The fields of a run record this reads; `RunSummary` satisfies it. */
export interface OutcomeRun {
  startedAt: string;
  status: string;
  vendor?: string;
  weight?: string;
  model?: string;
  gate?: "passed" | "failed";
}

export const OUTCOMES_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tiers in cost order; any other value sorts after them, alphabetically. */
const TIER_ORDER = ["light", "standard", "heavy", "custom"];

export interface OutcomeRow {
  vendor: string;
  tier: string;
  /** Runs with a gate verdict — the rate's denominator. */
  gated: number;
  passed: number;
  /** passed / gated, or null when no run in the group had a verdict. */
  rate: number | null;
  /** Runs in the group with no gate verdict, left out of the rate. */
  ungated: number;
  /** Every run in the group: gated + ungated. */
  runs: number;
  /** Distinct resolved models, for audit. */
  models: string[];
}

export interface OutcomeSummary {
  rows: OutcomeRow[];
  /** Finished runs in the window. */
  runs: number;
  /** Of those, runs with no gate verdict. */
  ungated: number;
  /** Start of the window, inclusive. */
  since: Date;
  windowDays: number;
}

/**
 * Group the window's finished runs by vendor and tier. A run still in flight
 * has no outcome yet, so it counts nowhere. A record with no vendor or tier
 * (older records) groups under "unknown" rather than being guessed at.
 */
export function summarizeOutcomes(
  runs: readonly OutcomeRun[],
  now: Date = new Date(),
  windowDays: number = OUTCOMES_WINDOW_DAYS,
): OutcomeSummary {
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  const groups = new Map<string, OutcomeRow>();
  let total = 0;
  let ungatedTotal = 0;

  for (const run of runs) {
    if (run.status === "running") continue;
    const started = Date.parse(run.startedAt);
    if (Number.isNaN(started) || started < since.getTime() || started > now.getTime()) continue;

    const vendor = run.vendor || "unknown";
    const tier = run.weight || "unknown";
    const key = `${vendor}\u0000${tier}`;
    let row = groups.get(key);
    if (!row) {
      row = { vendor, tier, gated: 0, passed: 0, rate: null, ungated: 0, runs: 0, models: [] };
      groups.set(key, row);
    }
    row.runs++;
    total++;
    if (run.model && !row.models.includes(run.model)) row.models.push(run.model);
    if (run.gate === undefined) {
      row.ungated++;
      ungatedTotal++;
    } else {
      row.gated++;
      if (run.gate === "passed") row.passed++;
    }
  }

  const rows = [...groups.values()];
  for (const row of rows) {
    row.rate = row.gated > 0 ? row.passed / row.gated : null;
    row.models.sort();
  }
  rows.sort((a, b) => a.vendor.localeCompare(b.vendor) || tierRank(a.tier) - tierRank(b.tier) || a.tier.localeCompare(b.tier));
  return { rows, runs: total, ungated: ungatedTotal, since, windowDays };
}

function tierRank(tier: string): number {
  const i = TIER_ORDER.indexOf(tier);
  return i === -1 ? TIER_ORDER.length : i;
}

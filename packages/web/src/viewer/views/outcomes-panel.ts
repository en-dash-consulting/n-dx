/**
 * Outcomes by tier — the Tune tile. One bar per vendor and tier: the share of
 * gated runs whose test gate passed, over the last 30 days. Read-only; it
 * fetches the same list the Runs view does and writes nothing.
 */

import { h } from "preact";
import type { ComponentChild } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { OUTCOMES_WINDOW_DAYS, summarizeOutcomes, type OutcomeRow, type OutcomeRun } from "./outcomes-by-tier.js";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; runs: OutcomeRun[] };

function percent(rate: number): number {
  return Math.round(rate * 100);
}

function band(pct: number): "good" | "fair" | "poor" {
  return pct >= 80 ? "good" : pct >= 50 ? "fair" : "poor";
}

function rowTitle(row: OutcomeRow): string {
  const models = row.models.length > 0 ? `Models: ${row.models.join(", ")}. ` : "";
  const gate = row.gated > 0 ? `${row.passed} of ${row.gated} gated runs passed.` : "No run had a gate result.";
  const ungated = row.ungated > 0 ? ` ${row.ungated} without a gate result left out.` : "";
  return `${models}${gate}${ungated}`;
}

function OutcomeBar({ row }: { row: OutcomeRow }): ComponentChild {
  const pct = row.rate === null ? null : percent(row.rate);
  return h("li", { class: "outcomes-row", title: rowTitle(row), "data-vendor": row.vendor, "data-tier": row.tier },
    h("span", { class: "outcomes-label" }, `${row.vendor} · ${row.tier}`),
    h("span", {
      class: `outcomes-meter${pct === null ? "" : ` outcomes-meter--${band(pct)}`}`,
      role: "img",
      "aria-label": pct === null ? "No gate result" : `${pct}% gate pass rate`,
    }, pct === null ? null : h("span", { style: `width: ${pct}%` })),
    h("span", { class: "outcomes-rate" }, pct === null ? "–" : `${pct}%`),
    h("span", { class: "outcomes-runs" }, `${row.runs} ${row.runs === 1 ? "run" : "runs"}`),
  );
}

export function OutcomesPanel(): ComponentChild {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // scope=repo, as the Runs view reads: every worktree still on this machine.
        const res = await fetch("/api/hench/runs?scope=repo");
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json() as { runs?: OutcomeRun[] };
        if (!cancelled) setLoad({ state: "ready", runs: body.runs ?? [] });
      } catch {
        if (!cancelled) setLoad({ state: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const summary = useMemo(
    () => (load.state === "ready" ? summarizeOutcomes(load.runs) : null),
    [load],
  );

  if (load.state === "loading") return h("p", { class: "stage-tile-empty" }, "Loading…");
  if (!summary) return h("p", { class: "stage-tile-empty" }, "Could not read run records.");

  const since = summary.since.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const caption = h("p", { class: "outcomes-note" },
    `Runs on this machine, last ${OUTCOMES_WINDOW_DAYS} days (since ${since}). Runs in removed worktrees are gone.`);

  if (summary.rows.length === 0) {
    return h("div", { class: "outcomes-panel" },
      h("p", { class: "outcomes-empty" }, "No runs in this window."),
      caption);
  }
  return h("div", { class: "outcomes-panel" },
    h("ul", { class: "outcomes-rows", "aria-label": "Gate pass rate by vendor and tier" },
      summary.rows.map((row) => h(OutcomeBar, { key: `${row.vendor}/${row.tier}`, row }))),
    summary.ungated > 0
      ? h("p", { class: "outcomes-note outcomes-ungated" },
          `${summary.ungated} ${summary.ungated === 1 ? "run" : "runs"} without a gate result, not in the rate.`)
      : null,
    caption);
}

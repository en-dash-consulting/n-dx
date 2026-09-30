import { h } from "preact";
import { useState, useCallback, useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo } from "../types.js";
import type { Finding } from "../external.js";
import { FindingsList } from "../visualization/index.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
import { effectiveEnrichmentPass } from "../enrichment-pass.js";
import { BrandedHeader, EnrichmentGate } from "../components/index.js";
import { findOperation } from "../hooks/index.js";
import type { JobTray } from "../hooks/index.js";
import { findingAskSeed } from "./finding-seed.js";

interface SuggestionsProps {
  data: LoadedData;
  navigateTo?: NavigateTo;
  /** State of the `sourcevision.ask` toggle — see the note in problems.ts. */
  askEnabled?: boolean;
  /** Shared job tray — `rex recommend` runs through it like any other job. */
  jobs: JobTray;
}

/**
 * Start `rex recommend` and read its state from the job tray.
 *
 * The button used to await the route directly, which meant a multi-minute LLM
 * pass held one browser request open with no elapsed time, no Stop, and
 * nothing left to receive the result if the page was reloaded. The route is
 * now an async job; this only starts it and reports what the tray says.
 */
function RefreshRecommendationsButton({ jobs }: { jobs: JobTray }) {
  const [error, setError] = useState<string | null>(null);

  const op = findOperation(jobs.operations, "recommend");
  const running = op?.status === "running";

  const handleClick = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/commands/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      // 409 means one is already running — the tray reports that one.
      if (!res.ok && res.status !== 409) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(String(err));
    }
    await jobs.refresh();
  }, [jobs]);

  return h("div", { class: "overview-reanalyze" },
    h("button", {
      class: "cmd-inline-trigger",
      onClick: handleClick,
      disabled: running,
      "aria-busy": running,
      title: "Re-run rex recommend to refresh suggestions",
    },
      running
        ? h("span", { class: "cmd-inline-spinner", "aria-hidden": "true" })
        : h("span", { "aria-hidden": "true" }, "\u{1F504}"),
      running ? "Refreshing..." : "Refresh Recommendations",
    ),
    running
      ? h("button", {
          class: "cmd-inline-trigger",
          onClick: () => { void jobs.stop(op!); },
          title: "Stop the recommend pass",
        }, "Stop")
      : null,
    h("span", { role: "status", "aria-live": "polite" },
      !running && op?.status === "done" && !op.stopped
        ? h("span", { class: "cmd-inline-result cmd-inline-result-ok" }, `✓ ${op.detail || "Done"}`)
        : null,
      error || op?.status === "failed"
        ? h("span", { class: "cmd-inline-result cmd-inline-result-err" }, error || op?.error || "Failed")
        : null,
    ),
  );
}

export function SuggestionsView({ data, navigateTo, askEnabled = false, jobs }: SuggestionsProps) {
  const { zones, manifest } = data;
  const enrichmentPass = effectiveEnrichmentPass(zones, manifest);

  // ── Every hook, before the enrichment gate ────────────────────────────────
  // The gate below returns early, and `enrichmentPass` comes from analysis data
  // that arrives after the first render and changes again when an analysis
  // finishes with the dashboard open. A hook called after the gate is therefore
  // called on some renders and not others, and Preact matches hooks by
  // position — so the slots shift under whatever state is already there.
  const findings = useMemo(
    () => (zones?.findings ?? []).filter((f: Finding) => f.type === "suggestion"),
    [zones?.findings],
  );

  const zonesAffected = useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) {
      if (f.scope !== "global") set.add(f.scope);
    }
    return set.size;
  }, [findings]);

  if (enrichmentPass < ENRICHMENT_THRESHOLDS.suggestions) {
    return h(EnrichmentGate, {
      title: "Suggestions",
      requiredPass: ENRICHMENT_THRESHOLDS.suggestions,
      currentPass: enrichmentPass,
    });
  }

  // Plain derivations — not hooks, so they stay next to the render that uses
  // them and cost nothing on a gated render.
  const legacyInsights = findings.length === 0
    ? (zones?.insights ?? []).filter(
        (s) => /suggest|refactor|improv|consider|opportunity|extract/i.test(s)
      )
    : [];

  // Count suggestions per scope
  const globalCount = findings.filter((f) => f.scope === "global").length;
  const zoneCount = findings.filter((f) => f.scope !== "global").length;

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Suggestions"),
    ),
    h("p", { class: "section-sub" },
      `${findings.length} suggestions for improvement`
    ),
    h(RefreshRecommendationsButton, { jobs }),

    findings.length > 0
      ? h("div", { class: "stat-grid" },
          h("div", { class: "stat-card" },
            h("div", { class: "value" }, String(globalCount)),
            h("div", { class: "label" }, "Global Suggestions")
          ),
          h("div", { class: "stat-card" },
            h("div", { class: "value" }, String(zoneCount)),
            h("div", { class: "label" }, "Zone-Specific")
          ),
          h("div", { class: "stat-card" },
            h("div", { class: "value" }, String(zonesAffected)),
            h("div", { class: "label" }, "Zones Affected")
          ),
        )
      : null,

    h(FindingsList, {
      findings,
      legacyInsights,
      groupBy: "severity",
      searchable: true,
      // Omitted without a navigation target, or with Ask toggled off — see the
      // note in problems.ts.
      ...(navigateTo && askEnabled
        ? { onExplain: (f: Finding) => navigateTo("ask", { askSeed: findingAskSeed(f) }) }
        : {}),
    })
  );
}

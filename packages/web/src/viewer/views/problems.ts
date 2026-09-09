import { h, Fragment } from "preact";
import { useCallback, useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo } from "../types.js";
import type { Finding } from "../external.js";
import { FindingsList, BarChart } from "../visualization/index.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
import { BrandedHeader, EnrichmentGate } from "../components/index.js";
import { useFeatureToggle } from "../hooks/index.js";
import { explainFinding } from "../ask-seed.js";

interface ProblemsProps {
  data: LoadedData;
  /** Absent in contexts with nowhere to navigate; Explain is then not offered. */
  navigateTo?: NavigateTo;
}

export function ProblemsView({ data, navigateTo }: ProblemsProps) {
  const { zones } = data;
  const enrichmentPass = zones?.enrichmentPass ?? 0;

  // ── Every hook, before the enrichment gate ────────────────────────────────
  // The gate below returns early, and `enrichmentPass` comes from analysis data
  // that arrives after the first render and changes again when an analysis
  // finishes with the dashboard open. A hook called after the gate is therefore
  // called on some renders and not others, and Preact matches hooks by
  // position — so the slots shift under whatever state is already there.
  const askEnabled = useFeatureToggle("sourcevision.ask", false);
  const handleExplain = useCallback(
    (finding: Finding) => { if (navigateTo) explainFinding(finding, navigateTo); },
    [navigateTo],
  );

  // Memoized on the source array, not recomputed per render: the chart below
  // keys its own memo on this, and a fresh array each time made that memo a
  // no-op that recomputed on every render anyway.
  const findings = useMemo(
    () => (zones?.findings ?? []).filter((f: Finding) => f.type === "anti-pattern"),
    [zones?.findings],
  );

  // Problems by zone
  const problemsByZone = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findings) {
      if (f.scope && f.scope !== "global") {
        map.set(f.scope, (map.get(f.scope) || 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([zone, count]) => ({
        label: zone,
        value: count,
        color: count >= 3 ? "var(--red)" : count >= 2 ? "var(--orange)" : "var(--accent)",
      }));
  }, [findings]);

  if (enrichmentPass < ENRICHMENT_THRESHOLDS.problems) {
    return h(EnrichmentGate, {
      title: "Problems",
      requiredPass: ENRICHMENT_THRESHOLDS.problems,
      currentPass: enrichmentPass,
    });
  }

  // Plain derivations — not hooks, so they stay next to the render that uses
  // them and cost nothing on a gated render.
  const legacyInsights = findings.length === 0
    ? (zones?.insights ?? []).filter(
        (s) => /problem|anti.?pattern|coupling|split|merge|smell|violation/i.test(s)
      )
    : [];

  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => !f.severity || f.severity === "info").length;

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Problems"),
    ),
    h("p", { class: "section-sub" },
      `${findings.length} anti-patterns detected`
    ),

    // Severity stat cards
    findings.length > 0
      ? h("div", { class: "stat-grid" },
          h("div", { class: "stat-card" },
            h("div", { class: "value text-red" }, String(critical)),
            h("div", { class: "label" }, "Critical")
          ),
          h("div", { class: "stat-card" },
            h("div", { class: "value text-orange" }, String(warning)),
            h("div", { class: "label" }, "Warnings")
          ),
          h("div", { class: "stat-card" },
            h("div", { class: "value" }, String(info)),
            h("div", { class: "label" }, "Info")
          ),
        )
      : null,

    // Problems by zone chart
    problemsByZone.length > 0
      ? h(Fragment, null,
          h("h3", { class: "section-header-sm" }, "Problems by Zone"),
          h("p", { class: "section-sub" }, "Which zones have the most anti-patterns."),
          h(BarChart, { data: problemsByZone }),
        )
      : null,

    h(FindingsList, {
      findings,
      legacyInsights,
      groupBy: "severity",
      searchable: true,
      // Only when the panel it leads to is actually reachable.
      ...(askEnabled && navigateTo ? { onExplain: handleExplain } : {}),
    })
  );
}

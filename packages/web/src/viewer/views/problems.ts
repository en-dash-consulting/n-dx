import { h, Fragment } from "preact";
import { useMemo } from "preact/hooks";
import type { LoadedData } from "../types.js";
import type { Finding } from "../../schema/v1.js";
import { FindingsList } from "../components/data-display/findings-list.js";
import { BarChart } from "../components/data-display/mini-charts.js";
import { ENRICHMENT_THRESHOLDS } from "../components/constants.js";
import { BrandedHeader } from "../components/logos.js";

interface ProblemsProps {
  data: LoadedData;
}

export function ProblemsView({ data }: ProblemsProps) {
  const { zones } = data;
  const enrichmentPass = zones?.enrichmentPass ?? 0;

  if (enrichmentPass < ENRICHMENT_THRESHOLDS.problems) {
    return h("div", { class: "locked-view" },
      h("div", { class: "locked-icon" }, "\u{1F512}"),
      h("h2", null, "Problems"),
      h("p", null, "Requires enrichment pass 3 (current: ", enrichmentPass, ")"),
      h("p", { class: "locked-hint" },
        "Run ", h("code", null, "sourcevision analyze"), " again to unlock."
      )
    );
  }

  const findings = (zones?.findings ?? []).filter(
    (f: Finding) => f.type === "anti-pattern"
  );

  const legacyInsights = findings.length === 0
    ? (zones?.insights ?? []).filter(
        (s) => /problem|anti.?pattern|coupling|split|merge|smell|violation/i.test(s)
      )
    : [];

  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const info = findings.filter((f) => !f.severity || f.severity === "info").length;

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
    })
  );
}

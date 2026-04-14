import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { LoadedData } from "../types.js";
import type { Finding } from "../external.js";
import { FindingsList } from "../visualization/index.js";
import { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
import { BrandedHeader } from "../components/index.js";

interface SuggestionsProps {
  data: LoadedData;
}

export function SuggestionsView({ data }: SuggestionsProps) {
  const { zones } = data;
  const enrichmentPass = zones?.enrichmentPass ?? 0;

  if (enrichmentPass < ENRICHMENT_THRESHOLDS.suggestions) {
    return h("div", { class: "locked-view" },
      h("div", { class: "locked-icon" }, "\u{1F512}"),
      h("h2", null, "Suggestions"),
      h("p", null, "Requires enrichment pass 4 (current: ", enrichmentPass, ")"),
      h("p", { class: "locked-hint" },
        "Run ", h("code", null, "sourcevision analyze"), " again to unlock."
      )
    );
  }

  const findings = (zones?.findings ?? []).filter(
    (f: Finding) => f.type === "suggestion"
  );

  const legacyInsights = findings.length === 0
    ? (zones?.insights ?? []).filter(
        (s) => /suggest|refactor|improv|consider|opportunity|extract/i.test(s)
      )
    : [];

  // Count suggestions per scope
  const globalCount = findings.filter((f) => f.scope === "global").length;
  const zoneCount = findings.filter((f) => f.scope !== "global").length;
  const zonesAffected = useMemo(() => {
    const set = new Set<string>();
    for (const f of findings) {
      if (f.scope !== "global") set.add(f.scope);
    }
    return set.size;
  }, [findings]);

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Suggestions"),
    ),
    h("p", { class: "section-sub" },
      `${findings.length} suggestions for improvement`
    ),

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
    })
  );
}

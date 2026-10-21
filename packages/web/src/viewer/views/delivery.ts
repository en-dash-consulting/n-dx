/**
 * Delivery & infrastructure: the SDLC readiness scorecard and the
 * infrastructure sourcevision discovered, on the Analyze dashboard.
 *
 * Both come from `analyze` (`readiness.json`, `infrastructure.json`) and are
 * read through `/data/`, so the panel works wherever the other data files do.
 * The shapes below mirror sourcevision's `ReadinessScore` and
 * `InfrastructureData`: the viewer is bundled for the browser and cannot
 * import the Node package. Every field is read defensively, because an
 * analysis made by an older build writes neither file, or an older shape.
 */
import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentChild } from "preact";

// ── Shapes ─────────────────────────────────────────────────────

export interface ReadinessEvidence {
  kind: string;
  path: string;
  line?: number;
  confidence?: string;
  excerpt?: string;
}

export interface ReadinessGap {
  summary: string;
  wouldRaiseScore: string;
}

export interface ReadinessDimension {
  score: number;
  weight: number;
  evidence: ReadinessEvidence[];
  gaps: ReadinessGap[];
}

export interface Readiness {
  overall: number;
  dimensions: Record<string, ReadinessDimension>;
  suggestions: string[];
}

export interface InfraResource {
  id: string;
  name: string;
  kind: string;
  origin: string;
  note?: string;
}

export interface Infrastructure {
  resources: InfraResource[];
  sawIaC: boolean;
}

// ── Model ──────────────────────────────────────────────────────

/** Display names, in sourcevision's report order (`DIMENSION_LABELS`). */
const DIMENSION_LABELS: Record<string, string> = {
  testing: "Testing",
  ci: "CI",
  cd: "CD",
  rollback: "Rollback",
  migrations: "Migrations",
  featureFlags: "Feature flags",
  qualityGates: "Quality gates",
  observability: "Observability",
  agentSafety: "Agent safety",
};

export interface DimensionRow {
  id: string;
  label: string;
  score: number;
  evidence: ReadinessEvidence[];
  gaps: ReadinessGap[];
}

/** Narrow parsed JSON to a readiness score, or null when it is not one. */
export function asReadiness(raw: unknown): Readiness | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Readiness>;
  if (typeof r.overall !== "number" || !r.dimensions || typeof r.dimensions !== "object") return null;
  return {
    overall: r.overall,
    dimensions: r.dimensions,
    suggestions: Array.isArray(r.suggestions) ? r.suggestions : [],
  };
}

/** Narrow parsed JSON to discovered infrastructure, or null when it is not. */
export function asInfrastructure(raw: unknown): Infrastructure | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Partial<Infrastructure>;
  if (!Array.isArray(d.resources)) return null;
  return { resources: d.resources, sawIaC: d.sawIaC === true };
}

/** One row per dimension: known ones in report order, then any newer ones. */
export function dimensionRows(readiness: Readiness): DimensionRow[] {
  const known = Object.keys(DIMENSION_LABELS).filter((id) => id in readiness.dimensions);
  const extra = Object.keys(readiness.dimensions).filter((id) => !(id in DIMENSION_LABELS));
  return [...known, ...extra].map((id) => {
    const d = readiness.dimensions[id]!;
    return {
      id,
      label: DIMENSION_LABELS[id] ?? id,
      score: typeof d.score === "number" ? d.score : 0,
      evidence: Array.isArray(d.evidence) ? d.evidence : [],
      gaps: Array.isArray(d.gaps) ? d.gaps : [],
    };
  });
}

export interface InfraGroup {
  kind: string;
  resources: InfraResource[];
}

/** Resources grouped by kind, kinds and names alphabetical. */
export function groupInfrastructure(infra: Infrastructure): InfraGroup[] {
  const groups = new Map<string, InfraResource[]>();
  for (const r of infra.resources) {
    const kind = r.kind || "other";
    groups.set(kind, [...(groups.get(kind) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, resources]) => ({
      kind,
      resources: [...resources].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

/** Where a resource was declared, in words. */
export function originLabel(origin: string): string {
  return origin === "config" ? "declared in project config" : origin;
}

/** Score band for colour: the same thresholds the health tiles use. */
export function scoreBand(score: number): "good" | "fair" | "poor" {
  return score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
}

// ── Data ───────────────────────────────────────────────────────

async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface DeliveryData {
  readiness: Readiness | null;
  infrastructure: Infrastructure | null;
}

/** Both artifacts, refetched whenever the analysis they belong to changes. */
function useDeliveryData(analyzedAt: string | null): DeliveryData | null {
  const [data, setData] = useState<DeliveryData | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([fetchJson("/data/readiness.json"), fetchJson("/data/infrastructure.json")])
      .then(([readiness, infrastructure]) => {
        if (live) setData({ readiness: asReadiness(readiness), infrastructure: asInfrastructure(infrastructure) });
      });
    return () => { live = false; };
  }, [analyzedAt]);
  return data;
}

// ── View ───────────────────────────────────────────────────────

const HEURISTIC_NOTE =
  "Readiness is a heuristic: it detects whether each practice exists and is wired up, not whether it is good.";

function missing(what: string): ComponentChild {
  return h("p", { class: "delivery-empty" },
    `No ${what} yet. Run `, h("code", null, "ndx analyze"), " to produce it.");
}

function ScoreMeter({ score }: { score: number }): ComponentChild {
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  return h("span", { class: `delivery-meter delivery-meter--${scoreBand(pct)}`, "aria-hidden": "true" },
    h("span", { style: `width: ${pct}%` }));
}

function ReadinessSummary({ readiness }: { readiness: Readiness }): ComponentChild {
  const rows = dimensionRows(readiness);
  return h("div", { class: "delivery-readiness" },
    h("p", { class: "delivery-overall" },
      h("span", { class: `delivery-overall-score delivery-score--${scoreBand(readiness.overall)}` }, String(readiness.overall)),
      h("span", { class: "delivery-overall-label" }, "SDLC readiness"),
    ),
    h("ul", { class: "delivery-dimensions", "aria-label": "Readiness by practice" },
      rows.map((r) => h("li", { key: r.id, class: "delivery-dimension" },
        h("span", { class: "delivery-dimension-label" }, r.label),
        h(ScoreMeter, { score: r.score }),
        h("span", { class: `delivery-dimension-score delivery-score--${scoreBand(r.score)}` }, String(r.score)),
      )),
    ),
  );
}

function InfrastructureSummary({ infra }: { infra: Infrastructure }): ComponentChild {
  const groups = groupInfrastructure(infra);
  if (groups.length === 0) {
    return h("p", { class: "delivery-empty" },
      infra.sawIaC
        ? "Infrastructure-as-code was found, but no resource it declares is one sourcevision recognises."
        : "No infrastructure found: no Terraform or CloudFormation, and none declared in project config.");
  }
  return h("p", { class: "delivery-infra-counts" },
    h("strong", null, "Infrastructure: "),
    groups.map((g) => `${g.resources.length} ${g.kind}`).join(" · "));
}

function ReadinessDetail({ readiness }: { readiness: Readiness }): ComponentChild {
  return h("section", { class: "delivery-section", "aria-labelledby": "delivery-readiness-title" },
    h("h3", { id: "delivery-readiness-title" }, `SDLC readiness · ${readiness.overall}`),
    readiness.suggestions.length > 0
      ? h("ul", { class: "delivery-suggestions" }, readiness.suggestions.map((s, i) => h("li", { key: i }, s)))
      : null,
    dimensionRows(readiness).map((r) => h("details", { key: r.id, class: "delivery-dimension-detail" },
      h("summary", null,
        h("span", { class: "delivery-dimension-label" }, r.label),
        h(ScoreMeter, { score: r.score }),
        h("span", { class: `delivery-dimension-score delivery-score--${scoreBand(r.score)}` }, String(r.score)),
      ),
      r.evidence.length > 0
        ? h("ul", { class: "delivery-evidence", "aria-label": `${r.label} evidence` },
            r.evidence.map((e, i) => h("li", { key: i },
              h("code", null, e.line ? `${e.path}:${e.line}` : e.path),
              e.excerpt ? h("span", { class: "delivery-excerpt" }, ` ${e.excerpt}`) : null,
              e.confidence ? h("span", { class: "delivery-confidence" }, ` (${e.confidence})`) : null,
            )))
        : h("p", { class: "delivery-empty" }, "No evidence found."),
      r.gaps.length > 0
        ? h("ul", { class: "delivery-gaps", "aria-label": `${r.label} gaps` },
            r.gaps.map((g, i) => h("li", { key: i }, `${g.summary} — ${g.wouldRaiseScore}`)))
        : null,
    )),
  );
}

function InfrastructureDetail({ infra }: { infra: Infrastructure }): ComponentChild {
  const groups = groupInfrastructure(infra);
  return h("section", { class: "delivery-section", "aria-labelledby": "delivery-infra-title" },
    h("h3", { id: "delivery-infra-title" }, `Infrastructure · ${infra.resources.length}`),
    groups.length === 0
      ? h(InfrastructureSummary, { infra })
      : groups.map((g) => h("div", { key: g.kind, class: "delivery-infra-group" },
          h("h4", null, `${g.kind} (${g.resources.length})`),
          h("ul", null, g.resources.map((r) => h("li", { key: r.id },
            h("span", { class: "delivery-infra-name" }, r.name),
            " ",
            h("code", { class: "delivery-infra-origin" }, originLabel(r.origin)),
          ))),
        )),
  );
}

/**
 * The tile shows the overall score, each practice's score and resource counts
 * by kind; opened, every practice's evidence and gaps and every resource with
 * the file that declares it.
 */
export function DeliveryPanel({ analyzedAt, opened = false }: { analyzedAt: string | null; opened?: boolean }): ComponentChild {
  const data = useDeliveryData(analyzedAt);
  const note = useMemo(() => h("p", { class: "delivery-note" }, HEURISTIC_NOTE), []);
  if (!data) return h("p", { class: "stage-tile-empty" }, "Loading…");
  const { readiness, infrastructure } = data;

  if (!opened) {
    return h("div", { class: "delivery-panel" },
      readiness ? h(ReadinessSummary, { readiness }) : missing("readiness score"),
      infrastructure ? h(InfrastructureSummary, { infra: infrastructure }) : missing("infrastructure scan"),
      readiness ? note : null,
    );
  }
  return h("div", { class: "delivery-panel delivery-panel--opened" },
    readiness ? note : null,
    readiness ? h(ReadinessDetail, { readiness }) : missing("readiness score"),
    infrastructure ? h(InfrastructureDetail, { infra: infrastructure }) : missing("infrastructure scan"),
  );
}

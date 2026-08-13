/**
 * Requirements view — coverage stats and the requirement → item
 * traceability matrix.
 *
 * The human surface for `rex verify` / the MCP `verify_criteria` tool:
 *   GET /api/rex/requirements/coverage      — coverage stats + breakdowns
 *   GET /api/rex/requirements/traceability  — requirement → applies-to matrix
 *
 * Per-item requirement CRUD (POST/PATCH/DELETE on
 * /api/rex/items/:id/requirements) is deliberately not part of this page —
 * editing belongs next to the item in the task detail panel.
 */

import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

// ── Wire types (from routes-rex/requirements.ts) ─────────────────────

interface CoverageStats {
  totalItems: number;
  itemsWithRequirements: number;
  itemsWithInheritedRequirements: number;
  itemsWithNoRequirements: number;
  totalRequirements: number;
  byCategory: Record<string, number>;
  byValidationType: Record<string, number>;
  byPriority: Record<string, number>;
  coveragePercent: number;
}

interface RequirementWire {
  id: string;
  title: string;
  description?: string;
  category: string;
  validationType: string;
  acceptanceCriteria: string[];
}

interface MatrixRow {
  requirement: RequirementWire;
  definedOnItemId: string;
  definedOnItemTitle: string;
  definedOnItemLevel: string;
  appliesTo: Array<{ id: string; title: string; level: string; status: string }>;
}

interface TraceabilityResponse {
  matrix: MatrixRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────

function Breakdown({ label, data }: { label: string; data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return h("div", { class: "req-breakdown" },
    h("h4", { class: "req-breakdown-label" }, label),
    h("ul", { class: "req-breakdown-list" },
      entries.map(([key, count]) =>
        h("li", { key, class: "req-breakdown-item" },
          h("span", { class: "tag" }, key), ` ${count}`,
        ),
      ),
    ),
  );
}

// ── View ─────────────────────────────────────────────────────────────

export function RequirementsView() {
  const [coverage, setCoverage] = useState<CoverageStats | null>(null);
  const [matrix, setMatrix] = useState<MatrixRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, tRes] = await Promise.all([
          fetch("/api/rex/requirements/coverage"),
          fetch("/api/rex/requirements/traceability"),
        ]);
        if (!cRes.ok) throw new Error(`HTTP ${cRes.status}`);
        const c = await cRes.json() as CoverageStats;
        const t = tRes.ok ? (await tRes.json() as TraceabilityResponse) : { matrix: [] };
        if (!cancelled) {
          setCoverage(c);
          setMatrix(t.matrix);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return h("div", { class: "req-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "Requirements"),
    ),
    h("p", { class: "section-sub" },
      "Requirement coverage and traceability: which acceptance criteria apply where, and how they are validated.",
    ),

    error
      ? h("div", { class: "cmd-result cmd-result-error", role: "alert" },
          `Could not load requirements: ${error}`)
      : null,

    !coverage && !error
      ? h("div", { class: "empty-state", role: "status" }, "Loading requirements…")
      : null,

    // ── Coverage ──
    coverage
      ? h("section", { class: "req-coverage", "aria-label": "Requirements coverage" },
          h("h3", { class: "section-header" }, "Coverage"),
          h("div", { class: "overview-metrics" },
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, `${Math.round(coverage.coveragePercent)}%`),
              h("div", { class: "metric-label" }, "Items covered"),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, String(coverage.totalRequirements)),
              h("div", { class: "metric-label" }, "Requirements"),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, String(coverage.itemsWithRequirements)),
              h("div", { class: "metric-label" }, "Items with direct requirements"),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, String(coverage.itemsWithInheritedRequirements)),
              h("div", { class: "metric-label" }, "Items inheriting requirements"),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, String(coverage.itemsWithNoRequirements)),
              h("div", { class: "metric-label" }, "Items without requirements"),
            ),
          ),
          h("div", { class: "req-breakdowns" },
            h(Breakdown, { label: "By category", data: coverage.byCategory }),
            h(Breakdown, { label: "By validation type", data: coverage.byValidationType }),
            h(Breakdown, { label: "By priority", data: coverage.byPriority }),
          ),
        )
      : null,

    // ── Traceability matrix ──
    coverage && matrix
      ? h("section", { class: "req-matrix", "aria-label": "Traceability matrix" },
          h("h3", { class: "section-header" }, `Traceability (${matrix.length})`),
          coverage.totalRequirements === 0 || matrix.length === 0
            ? h("div", { class: "empty-state" },
                "No requirements defined yet. Add requirements to epics or features and they will be traced to every descendant item here.")
            : h("table", { class: "data-table req-table" },
                h("thead", null,
                  h("tr", null,
                    h("th", null, "Requirement"),
                    h("th", null, "Category"),
                    h("th", null, "Validation"),
                    h("th", null, "Defined on"),
                    h("th", null, "Applies to"),
                  ),
                ),
                h("tbody", null,
                  matrix.flatMap((row) => {
                    const isOpen = expanded.has(row.requirement.id);
                    const cells = h("tr", { key: row.requirement.id },
                      h("td", null, row.requirement.title),
                      h("td", null, h("span", { class: "tag" }, row.requirement.category)),
                      h("td", null, h("span", { class: "tag" }, row.requirement.validationType)),
                      h("td", null,
                        `${row.definedOnItemTitle} `,
                        h("span", { class: "req-level" }, `(${row.definedOnItemLevel})`),
                      ),
                      h("td", null,
                        h("button", {
                          class: "collapsible-toggle",
                          "aria-expanded": isOpen,
                          onClick: () => toggleExpanded(row.requirement.id),
                        }, `${row.appliesTo.length} item${row.appliesTo.length === 1 ? "" : "s"} ${isOpen ? "▾" : "▸"}`),
                      ),
                    );
                    if (!isOpen) return [cells];
                    return [cells, h("tr", { key: `${row.requirement.id}-detail`, class: "req-detail-row" },
                      h("td", { colSpan: 5 },
                        row.requirement.acceptanceCriteria.length > 0
                          ? h(Fragment, null,
                              h("h5", { class: "req-detail-heading" }, "Acceptance criteria"),
                              h("ul", { class: "req-criteria-list" },
                                row.requirement.acceptanceCriteria.map((c, i) =>
                                  h("li", { key: i }, c)),
                              ),
                            )
                          : null,
                        h("h5", { class: "req-detail-heading" }, "Applies to"),
                        h("ul", { class: "req-applies-list" },
                          row.appliesTo.map((item) =>
                            h("li", { key: item.id, class: "req-applies-item" },
                              `${item.title} `,
                              h("span", { class: "req-level" }, `(${item.level})`),
                              " ",
                              h("span", { class: `tag req-status-${item.status}` }, item.status),
                            ),
                          ),
                        ),
                      ),
                    )];
                  }),
                ),
              ),
        )
      : null,
  );
}

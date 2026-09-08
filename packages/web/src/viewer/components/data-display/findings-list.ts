import { h } from "preact";
import { useState, useMemo, useCallback } from "preact/hooks";
import type { Finding } from "../../external.js";
import { CollapsibleSection } from "./collapsible-section.js";
import { SearchFilter } from "../search-filter.js";

interface FindingsListProps {
  findings: Finding[];
  legacyInsights?: string[];
  groupBy?: "severity" | "scope" | "type";
  searchable?: boolean;
  threshold?: number;
  /**
   * Offer an "Explain" action on every finding row, calling back with the
   * finding itself.
   *
   * Opt-in rather than always-on, and handed the `Finding` rather than
   * anything Ask-shaped: this component renders findings for the Problems,
   * Suggestions, and Architecture views, and only the first two have somewhere
   * to send one. Mapping a finding onto an Ask seed is the caller's job, so a
   * display component does not acquire a dependency on a feature.
   */
  onExplain?: (finding: Finding) => void;
}

const SEVERITY_ICON: Record<string, string> = {
  critical: "⛔",  // no entry
  warning: "⚠",   // warning sign
  info: "ℹ",      // info
};

const TYPE_ICON: Record<string, string> = {
  pattern: "⬢",       // hexagon
  relationship: "↔",  // left-right arrow
  "anti-pattern": "✘",// cross
  suggestion: "✨",    // sparkles
};

/**
 * Identify a finding by its content.
 *
 * Findings carry no ID of their own — `zones.json` writes them as a flat list
 * — so identity has to come from the fields that do not change between runs
 * for the same finding: what kind it is, where it is, and what it says. The
 * text is clipped because a re-run may reword a tail while describing the same
 * problem.
 *
 * Exported because the seed sent to the Ask panel names the finding with the
 * same string the row is keyed by; two derivations would drift.
 */
export function findingKey(f: Finding): string {
  return `${f.type}:${f.scope ?? "global"}:${f.text.slice(0, 40)}`;
}

/** Derive a stable DOM-safe ID from a finding's content. */
function findingDetailId(f: Finding): string {
  return "fd-" + findingKey(f).replace(/[^a-zA-Z0-9]/g, "-").replace(/-{2,}/g, "-").slice(0, 64);
}

export function FindingsList({
  findings,
  legacyInsights = [],
  groupBy = "severity",
  searchable = true,
  threshold = 8,
  onExplain,
}: FindingsListProps) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Compute distinct filter option values from findings
  const typeOptions = useMemo(() => {
    const types = [...new Set(findings.map((f) => f.type))].sort();
    return [
      { label: "All types", value: "all" },
      ...types.map((t) => ({ label: capitalize(t), value: t })),
    ];
  }, [findings]);

  const severityOptions = useMemo(() => {
    const sevs = new Set(findings.map((f) => f.severity || "info"));
    return [
      { label: "All severities", value: "all" },
      ...(["critical", "warning", "info"] as const)
        .filter((s) => sevs.has(s))
        .map((s) => ({ label: capitalize(s), value: s })),
    ];
  }, [findings]);

  const zoneOptions = useMemo(() => {
    const zones = [...new Set(
      findings.map((f) => f.scope).filter((s) => s && s !== "global")
    )].sort() as string[];
    return [
      { label: "All zones", value: "all" },
      ...(findings.some((f) => !f.scope || f.scope === "global")
        ? [{ label: "Global", value: "global" }]
        : []),
      ...zones.map((z) => ({ label: z, value: z })),
    ];
  }, [findings]);

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (search) {
        const q = search.toLowerCase();
        const matches =
          f.text.toLowerCase().includes(q) ||
          f.scope.toLowerCase().includes(q) ||
          (f.related ?? []).some((r) => r.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (typeFilter !== "all" && f.type !== typeFilter) return false;
      if (severityFilter !== "all" && (f.severity || "info") !== severityFilter) return false;
      if (zoneFilter !== "all" && f.scope !== zoneFilter) return false;
      return true;
    });
  }, [findings, search, typeFilter, severityFilter, zoneFilter]);

  const filteredLegacy = useMemo(() => {
    if (!search) return legacyInsights;
    const q = search.toLowerCase();
    return legacyInsights.filter((s) => s.toLowerCase().includes(q));
  }, [legacyInsights, search]);

  const groups = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of filtered) {
      let key: string;
      switch (groupBy) {
        case "severity":
          key = f.severity || "info";
          break;
        case "scope":
          key = f.scope === "global" ? "Global" : f.scope;
          break;
        case "type":
          key = f.type;
          break;
        default:
          key = "all";
      }
      let list = map.get(key);
      if (!list) {
        list = [];
        map.set(key, list);
      }
      list.push(f);
    }
    if (groupBy === "severity") {
      const ordered = new Map<string, Finding[]>();
      for (const sev of ["critical", "warning", "info"]) {
        const items = map.get(sev);
        if (items) ordered.set(sev, items);
      }
      return ordered;
    }
    return map;
  }, [filtered, groupBy]);

  function renderFinding(f: Finding, i: number) {
    const sev = f.severity || "info";
    const icon = SEVERITY_ICON[sev] || TYPE_ICON[f.type] || "•";
    const hasDetail = (f.related?.length ?? 0) > 0;
    const detailId = findingDetailId(f);
    const isExpanded = expandedIds.has(detailId);

    const headerContent = [
      h("span", { class: "finding-icon", "aria-hidden": "true" }, icon),
      h("span", {
        class: `severity-badge severity-${sev}`,
        "aria-label": `Severity: ${sev}`,
      }, sev),
      h("span", { class: "finding-type-badge" }, f.type),
      f.scope && f.scope !== "global"
        ? h("span", { class: "finding-scope-link" },
            h("span", { class: "finding-zone-dot", style: `background: var(--accent)`, "aria-hidden": "true" }),
            f.scope
          )
        : null,
      hasDetail
        ? h("span", {
            class: `finding-chevron${isExpanded ? " open" : ""}`,
            "aria-hidden": "true",
          }, "▶")
        : null,
    ];

    return h("li", {
      key: i,
      class: `finding-card severity-${sev}`,
    },
      // Header: button when expandable, div otherwise
      hasDetail
        ? h("button", {
            type: "button",
            class: "finding-header finding-header-btn",
            "aria-expanded": String(isExpanded),
            "aria-controls": detailId,
            onClick: () => toggleExpanded(detailId),
          }, ...headerContent)
        : h("div", { class: "finding-header" }, ...headerContent),
      // Main text — always visible
      h("p", { class: "finding-text" }, f.text),
      // Explain sits outside the header, not inside it: the header is itself a
      // button whenever the finding has related files, and a button nested in a
      // button is invalid markup that browsers resolve unpredictably.
      onExplain
        ? h("div", { class: "finding-actions" },
            h("button", {
              type: "button",
              class: "btn finding-explain-btn",
              // The row already shows type, severity, and zone; what the label
              // cannot show is which row this button belongs to, which is what
              // a screen reader hears out of context.
              "aria-label": `Explain this ${sev} ${f.type}: ${f.text}`,
              title: "Explain this finding in plain language",
              onClick: () => onExplain(f),
            }, "Explain"),
          )
        : null,
      // Expandable detail (related files)
      hasDetail
        ? h("div", {
            id: detailId,
            class: "finding-meta",
            hidden: !isExpanded,
          },
            h("span", { class: "finding-related-label" }, "Related:"),
            h("div", { class: "finding-related" },
              f.related!.map((r, j) => h("code", { key: j }, r))
            )
          )
        : null
    );
  }

  // Build filter descriptors for SearchFilter
  const filters = searchable && findings.length > 0
    ? [
        ...(typeOptions.length > 2
          ? [{
              label: "Type",
              value: typeFilter,
              options: typeOptions,
              onChange: setTypeFilter,
            }]
          : []),
        ...(severityOptions.length > 2
          ? [{
              label: "Severity",
              value: severityFilter,
              options: severityOptions,
              onChange: setSeverityFilter,
            }]
          : []),
        ...(zoneOptions.length > 2
          ? [{
              label: "Zone",
              value: zoneFilter,
              options: zoneOptions,
              onChange: setZoneFilter,
            }]
          : []),
      ]
    : [];

  const totalCount = findings.length + legacyInsights.length;
  const visibleCount = filtered.length + filteredLegacy.length;

  return h("div", { role: "region", "aria-label": "Findings list" },
    searchable
      ? h(SearchFilter, {
          placeholder: "Search findings...",
          value: search,
          onInput: setSearch,
          resultCount: visibleCount,
          totalCount,
          filters,
        })
      : null,

    [...groups.entries()].map(([key, items]) =>
      h(CollapsibleSection, {
        key,
        title: groupLabel(key, groupBy),
        count: items.length,
        defaultOpen: true,
        threshold,
        listTag: "ul",
      },
        ...items.map(renderFinding)
      )
    ),

    filteredLegacy.length > 0
      ? h(CollapsibleSection, {
          title: "Insights",
          count: filteredLegacy.length,
          defaultOpen: true,
          threshold,
          listTag: "ul",
        },
          ...filteredLegacy.map((s, i) =>
            h("li", { key: i, class: "finding-card severity-info" },
              h("div", { class: "finding-header" },
                h("span", { class: "finding-icon", "aria-hidden": "true" }, "ℹ"),
                h("span", {
                  class: "severity-badge severity-info",
                  "aria-label": "Severity: info",
                }, "insight"),
              ),
              h("p", { class: "finding-text" }, s)
            )
          )
        )
      : null,

    filtered.length === 0 && filteredLegacy.length === 0
      ? h("p", { class: "section-sub" }, "No findings match your search.")
      : null
  );
}

function groupLabel(key: string, groupBy: string): string {
  if (groupBy === "severity") {
    const labels: Record<string, string> = {
      critical: "⛔ Critical",
      warning: "⚠ Warnings",
      info: "ℹ Info",
    };
    return labels[key] || capitalize(key);
  }
  if (groupBy === "type") {
    const labels: Record<string, string> = {
      pattern: "⬢ Patterns",
      relationship: "↔ Relationships",
      "anti-pattern": "✘ Anti-Patterns",
      suggestion: "✨ Suggestions",
    };
    return labels[key] || capitalize(key);
  }
  return capitalize(key);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

import { h, Fragment } from "preact";
import { useState, useMemo } from "preact/hooks";
import type { Finding } from "../../external.js";
import { CollapsibleSection } from "./collapsible-section.js";
import { SearchFilter } from "../search-filter.js";

interface FindingsListProps {
  findings: Finding[];
  legacyInsights?: string[];
  groupBy?: "severity" | "scope" | "type";
  searchable?: boolean;
  threshold?: number;
}

const SEVERITY_ICON: Record<string, string> = {
  critical: "\u26D4",  // no entry
  warning: "\u26A0",   // warning sign
  info: "\u2139",      // info
};

const TYPE_ICON: Record<string, string> = {
  pattern: "\u2B22",       // hexagon
  relationship: "\u2194",  // left-right arrow
  "anti-pattern": "\u2718",// cross
  suggestion: "\u2728",    // sparkles
};

export function FindingsList({
  findings,
  legacyInsights = [],
  groupBy = "severity",
  searchable = true,
  threshold = 8,
}: FindingsListProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return findings;
    const q = search.toLowerCase();
    return findings.filter(
      (f) =>
        f.text.toLowerCase().includes(q) ||
        f.scope.toLowerCase().includes(q) ||
        (f.related ?? []).some((r) => r.toLowerCase().includes(q))
    );
  }, [findings, search]);

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
    const icon = SEVERITY_ICON[sev] || TYPE_ICON[f.type] || "\u2022";

    return h("div", {
      key: i,
      class: `finding-card severity-${sev}`,
      role: "article",
    },
      // Header row: icon + severity badge + scope
      h("div", { class: "finding-header" },
        h("span", { class: "finding-icon", "aria-hidden": "true" }, icon),
        h("span", {
          class: `severity-badge severity-${sev}`,
        }, sev),
        h("span", { class: "finding-type-badge" }, f.type),
        f.scope && f.scope !== "global"
          ? h("span", { class: "finding-scope-link" },
              h("span", { class: "finding-zone-dot", style: `background: var(--accent)` }),
              f.scope
            )
          : null,
      ),
      // Main text
      h("p", { class: "finding-text" }, f.text),
      // Related files/zones
      f.related?.length
        ? h("div", { class: "finding-meta" },
            h("span", { class: "finding-related-label" }, "Related:"),
            h("div", { class: "finding-related" },
              f.related.map((r, j) => h("code", { key: j }, r))
            )
          )
        : null
    );
  }

  return h("div", { role: "region", "aria-label": "Findings list" },
    searchable
      ? h(SearchFilter, {
          placeholder: "Search findings...",
          value: search,
          onInput: setSearch,
          resultCount: filtered.length + filteredLegacy.length,
          totalCount: findings.length + legacyInsights.length,
        })
      : null,

    [...groups.entries()].map(([key, items]) =>
      h(CollapsibleSection, {
        key,
        title: groupLabel(key, groupBy),
        count: items.length,
        defaultOpen: true,
        threshold,
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
        },
          ...filteredLegacy.map((s, i) =>
            h("div", { key: i, class: "finding-card severity-info", role: "article" },
              h("div", { class: "finding-header" },
                h("span", { class: "finding-icon", "aria-hidden": "true" }, "\u2139"),
                h("span", { class: "severity-badge severity-info" }, "insight"),
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
      critical: "\u26D4 Critical",
      warning: "\u26A0 Warnings",
      info: "\u2139 Info",
    };
    return labels[key] || capitalize(key);
  }
  if (groupBy === "type") {
    const labels: Record<string, string> = {
      pattern: "\u2B22 Patterns",
      relationship: "\u2194 Relationships",
      "anti-pattern": "\u2718 Anti-Patterns",
      suggestion: "\u2728 Suggestions",
    };
    return labels[key] || capitalize(key);
  }
  return capitalize(key);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

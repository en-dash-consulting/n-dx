import { h } from "preact";
import { useState, useMemo } from "preact/hooks";
import type { LoadedData, NavigateTo, DetailItem } from "../types.js";
import type { Zone, Finding } from "../../schema/v1.js";
import { ZONE_COLORS } from "../components/constants.js";
import { CollapsibleSection } from "../components/data-display/collapsible-section.js";
import { SearchFilter } from "../components/search-filter.js";
import { FlowDiagram } from "../components/data-display/mini-charts.js";
import { meterClass, buildFlowNodes, buildFlowEdges } from "../utils.js";
import { BrandedHeader } from "../components/logos.js";

interface ZonesViewProps {
  data: LoadedData;
  onSelect: (detail: DetailItem | null) => void;
  setSelectedZone?: (zone: string | null) => void;
  navigateTo?: NavigateTo;
}

export function ZonesView({ data, onSelect }: ZonesViewProps) {
  const { zones } = data;
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  if (!zones) {
    return h("div", { class: "loading" }, "No zone data available.");
  }

  const handleZoneClick = (zone: Zone) => {
    setSelectedZone(zone.id === selectedZone ? null : zone.id);
    onSelect({
      type: "zone",
      title: zone.name,
      id: zone.id,
      description: zone.description,
      files: zone.files.length,
      entryPoints: zone.entryPoints,
      cohesion: zone.cohesion.toFixed(2),
      coupling: zone.coupling.toFixed(2),
    });
  };

  // Cross-zone traffic summary
  const zoneTraffic = new Map<string, { incoming: number; outgoing: number }>();
  for (const z of zones.zones) {
    zoneTraffic.set(z.id, { incoming: 0, outgoing: 0 });
  }
  for (const c of zones.crossings) {
    const from = zoneTraffic.get(c.fromZone);
    const to = zoneTraffic.get(c.toZone);
    if (from) from.outgoing++;
    if (to) to.incoming++;
  }

  // FlowDiagram data
  const flowNodes = useMemo(() => buildFlowNodes(zones), [zones.zones]);
  const flowEdges = useMemo(() => buildFlowEdges(zones.crossings), [zones.crossings]);

  const handleFlowNodeClick = (id: string) => {
    const el = document.getElementById(`zone-card-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    setSelectedZone(id);
  };

  // Search filtering
  const filteredZones = useMemo(() => {
    if (!search) return zones.zones;
    const q = search.toLowerCase();
    return zones.zones.filter(
      (z) =>
        z.name.toLowerCase().includes(q) ||
        z.description.toLowerCase().includes(q) ||
        z.files.some((f) => f.toLowerCase().includes(q))
    );
  }, [zones.zones, search]);

  return h("div", null,
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
      h("h2", { class: "section-header" }, "Zones"),
    ),
    h("p", { class: "section-sub" },
      `${zones.zones.length} zones, ${zones.crossings.length} cross-zone dependencies, ${zones.unzoned.length} unzoned files`
    ),

    // Flow Diagram
    flowNodes.length > 1 && flowEdges.length > 0
      ? h(FlowDiagram, {
          nodes: flowNodes,
          edges: flowEdges,
          onNodeClick: handleFlowNodeClick,
        })
      : null,

    // Search
    h(SearchFilter, {
      placeholder: "Search zones, files...",
      value: search,
      onInput: setSearch,
      resultCount: filteredZones.length,
      totalCount: zones.zones.length,
    }),

    // Zone cards
    h("div", { class: "zone-grid" },
      filteredZones.map((zone, i) => {
        const globalIdx = zones.zones.indexOf(zone);
        const traffic = zoneTraffic.get(zone.id);
        const color = ZONE_COLORS[globalIdx % ZONE_COLORS.length];

        return h("div", {
          key: zone.id,
          id: `zone-card-${zone.id}`,
          class: `zone-card ${selectedZone === zone.id ? "selected" : ""}`,
          style: selectedZone === zone.id ? `border-color: ${color}` : "",
          onClick: () => handleZoneClick(zone),
        },
          h("div", { class: "flex-row" },
            h("div", {
              class: "zone-dot",
              style: `background: ${color}`,
            }),
            h("h3", null, zone.name)
          ),
          h("p", { class: "desc" }, zone.description),
          h("div", { class: "zone-metrics" },
            h("div", { class: "zone-metric" },
              h("div", { class: "val" }, zone.files.length),
              h("div", { class: "lbl" }, "Files")
            ),
            h("div", { class: "zone-metric" },
              h("div", { class: "val" }, zone.cohesion.toFixed(2)),
              h("div", { class: "lbl" }, "Cohesion"),
              h("div", { class: "meter" },
                h("div", {
                  class: `meter-fill ${meterClass(zone.cohesion)}`,
                  style: `width: ${zone.cohesion * 100}%`,
                })
              )
            ),
            h("div", { class: "zone-metric" },
              h("div", { class: "val" }, zone.coupling.toFixed(2)),
              h("div", { class: "lbl" }, "Coupling"),
              h("div", { class: "meter" },
                h("div", {
                  class: `meter-fill ${meterClass(zone.coupling, true)}`,
                  style: `width: ${zone.coupling * 100}%`,
                })
              )
            ),
            traffic
              ? h("div", { class: "zone-metric" },
                  h("div", { class: "val" }, `${traffic.incoming}/${traffic.outgoing}`),
                  h("div", { class: "lbl" }, "In/Out")
                )
              : null
          ),
          // Per-zone findings/insights
          (() => {
            const zoneFindings: Finding[] = (zones.findings ?? []).filter(
              (f: Finding) => f.scope === zone.id
            );
            const insightTexts = zoneFindings.length > 0
              ? zoneFindings.map((f) => f.text)
              : zone.insights ?? [];
            if (insightTexts.length === 0) return null;

            return h(CollapsibleSection, {
              title: "Insights",
              count: insightTexts.length,
              defaultOpen: true,
              threshold: 3,
            },
              ...insightTexts.map((text, j) =>
                h("div", { key: j, class: "insight-item" }, text)
              )
            );
          })()
        );
      })
    ),

    // Selected zone file list
    selectedZone
      ? (() => {
          const zone = zones.zones.find((z) => z.id === selectedZone);
          if (!zone) return null;

          return h(CollapsibleSection, {
            title: `Files in "${zone.name}"`,
            count: zone.files.length,
            defaultOpen: true,
            threshold: 20,
          },
            h("div", { class: "data-table-wrapper" },
              h("table", { class: "data-table" },
                h("thead", null,
                  h("tr", null,
                    h("th", null, "Path"),
                    h("th", null, "Entry Point")
                  )
                ),
                h("tbody", null,
                  zone.files.map((f) =>
                    h("tr", { key: f },
                      h("td", { class: "mono-sm" }, f),
                      h("td", null,
                        zone.entryPoints.includes(f)
                          ? h("span", { class: "tag tag-test" }, "entry")
                          : null
                      )
                    )
                  )
                )
              )
            )
          );
        })()
      : null,

    // Unzoned files
    zones.unzoned.length
      ? h(CollapsibleSection, {
          title: "Unzoned Files",
          count: zones.unzoned.length,
          defaultOpen: false,
          threshold: 10,
        },
          ...zones.unzoned.map((f) =>
            h("div", {
              key: f,
              class: "mono-sm text-dim",
              style: "line-height: 1.8",
            }, f)
          )
        )
      : null
  );
}

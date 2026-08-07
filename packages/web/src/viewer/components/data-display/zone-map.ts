import { h } from "preact";
import { useState, useMemo } from "preact/hooks";
import type { Zone, ZoneCrossing } from "../../external.js";
import { getZoneColorByIndex } from "../../utils.js";

/**
 * Zone Map - A hierarchical visualization of zones and their connections.
 * Shows zones as grouped boxes with connection lines between them.
 */

interface ZoneMapProps {
  zones: Zone[];
  crossings: ZoneCrossing[];
  selectedZone?: string | null;
  onZoneClick?: (zoneId: string) => void;
}

export function ZoneMap({ zones, crossings, selectedZone, onZoneClick }: ZoneMapProps) {
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);

  // Calculate zone metrics for sizing
  const zoneMetrics = useMemo(() => {
    const metrics = new Map<string, {
      files: number;
      incoming: number;
      outgoing: number;
      cohesion: number;
      coupling: number;
    }>();

    for (const z of zones) {
      metrics.set(z.id, {
        files: z.files.length,
        incoming: 0,
        outgoing: 0,
        cohesion: z.cohesion,
        coupling: z.coupling,
      });
    }

    for (const c of crossings) {
      const from = metrics.get(c.fromZone);
      const to = metrics.get(c.toZone);
      if (from) from.outgoing++;
      if (to) to.incoming++;
    }

    return metrics;
  }, [zones, crossings]);

  // Group crossings by zone pairs for connection rendering
  const connectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of crossings) {
      const key = [c.fromZone, c.toZone].sort().join(":");
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [crossings]);

  // Get unique zone pairs with connections
  const connections = useMemo(() => {
    const pairs: Array<{ from: string; to: string; count: number; bidirectional: boolean }> = [];
    const seen = new Set<string>();

    for (const c of crossings) {
      const key = [c.fromZone, c.toZone].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);

      const reverseKey = `${c.toZone}:${c.fromZone}`;
      const forwardCount = crossings.filter(x => x.fromZone === c.fromZone && x.toZone === c.toZone).length;
      const reverseCount = crossings.filter(x => x.fromZone === c.toZone && x.toZone === c.fromZone).length;

      pairs.push({
        from: c.fromZone,
        to: c.toZone,
        count: forwardCount + reverseCount,
        bidirectional: forwardCount > 0 && reverseCount > 0,
      });
    }

    return pairs.sort((a, b) => b.count - a.count);
  }, [crossings]);

  // Calculate grid layout
  const cols = Math.ceil(Math.sqrt(zones.length));
  const rows = Math.ceil(zones.length / cols);

  const maxFiles = Math.max(...zones.map(z => z.files.length), 1);

  return h("div", { class: "zone-map" },
    h("div", { class: "zone-map-header" },
      h("h4", null, "Architecture Map"),
      h("div", { class: "zone-map-legend" },
        h("span", { class: "legend-item" },
          h("span", { class: "legend-dot", style: "background: var(--green)", "aria-hidden": "true" }),
          "High cohesion"
        ),
        h("span", { class: "legend-item" },
          h("span", { class: "legend-dot", style: "background: var(--orange)", "aria-hidden": "true" }),
          "Bidirectional"
        ),
        h("span", { class: "legend-item" },
          h("span", { class: "legend-line", "aria-hidden": "true" }),
          "Dependency"
        )
      )
    ),
    h("div", {
      class: "zone-map-grid",
      style: `grid-template-columns: repeat(${cols}, 1fr)`,
    },
      zones.map((zone, i) => {
        const color = getZoneColorByIndex(i);
        const metrics = zoneMetrics.get(zone.id);
        const isSelected = selectedZone === zone.id;
        const isHovered = hoveredZone === zone.id;
        const isHighlighted = isSelected || isHovered;

        // Scale box size by file count
        const sizeScale = 0.7 + (zone.files.length / maxFiles) * 0.3;

        // Health indicator color
        const healthColor = zone.cohesion >= 0.7 ? "var(--green)"
          : zone.cohesion >= 0.4 ? "var(--orange)"
          : "var(--red)";

        // Coupling indicator
        const couplingLevel = zone.coupling >= 0.5 ? "high" : zone.coupling >= 0.3 ? "mid" : "low";

        return h("div", {
          key: zone.id,
          class: `zone-map-node ${isSelected ? "selected" : ""} ${isHovered ? "hovered" : ""}`,
          style: `
            --zone-color: ${color};
            transform: scale(${isHighlighted ? 1.05 : sizeScale});
            border-color: ${isHighlighted ? color : "var(--border)"};
          `,
          onClick: () => onZoneClick?.(zone.id),
          onMouseEnter: () => setHoveredZone(zone.id),
          onMouseLeave: () => setHoveredZone(null),
          ...(onZoneClick
            ? {
                role: "button",
                tabIndex: 0,
                "aria-pressed": isSelected,
                "aria-label": `Zone ${zone.name}: ${zone.files.length} files, cohesion ${zone.cohesion.toFixed(2)}, coupling ${zone.coupling.toFixed(2)}`,
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onZoneClick(zone.id);
                  }
                },
                onFocus: () => setHoveredZone(zone.id),
                onBlur: () => setHoveredZone(null),
              }
            : {}),
        },
          h("div", { class: "zone-map-node-header" },
            h("span", { class: "zone-map-node-dot", style: `background: ${color}`, "aria-hidden": "true" }),
            h("span", { class: "zone-map-node-name" }, zone.name)
          ),
          h("div", { class: "zone-map-node-body" },
            h("div", { class: "zone-map-node-stat" },
              h("span", { class: "stat-value" }, zone.files.length),
              h("span", { class: "stat-label" }, "files")
            ),
            h("div", { class: "zone-map-node-health", "aria-hidden": "true" },
              h("span", {
                class: "health-dot",
                style: `background: ${healthColor}`,
                title: `Cohesion: ${zone.cohesion.toFixed(2)}`,
              }),
              h("span", {
                class: `coupling-indicator ${couplingLevel}`,
                title: `Coupling: ${zone.coupling.toFixed(2)}`,
              }, zone.coupling > 0.3 ? "\u26A0" : "")
            )
          ),
          zone.subZones && zone.subZones.length > 0
            ? h("div", { class: "zone-map-node-subzones" },
                h("span", { class: "subzone-badge" }, `${zone.subZones.length} sub-zones`),
              )
            : null,
          metrics && (metrics.incoming > 0 || metrics.outgoing > 0)
            ? h("div", { class: "zone-map-node-io" },
                h("span", {
                  class: "io-in",
                  title: "Incoming deps",
                  "aria-label": `${metrics.incoming} incoming dependencies`,
                },
                  h("span", { "aria-hidden": "true" }, "\u2190"), metrics.incoming
                ),
                h("span", {
                  class: "io-out",
                  title: "Outgoing deps",
                  "aria-label": `${metrics.outgoing} outgoing dependencies`,
                },
                  metrics.outgoing, h("span", { "aria-hidden": "true" }, "\u2192")
                )
              )
            : null
        );
      })
    ),

    // Connection summary
    connections.length > 0
      ? h("div", { class: "zone-map-connections" },
          h("h5", null, "Zone Dependencies"),
          h("div", { class: "connection-list" },
            connections.slice(0, 10).map(conn => {
              const fromZone = zones.find(z => z.id === conn.from);
              const toZone = zones.find(z => z.id === conn.to);
              if (!fromZone || !toZone) return null;

              const fromIdx = zones.indexOf(fromZone);
              const toIdx = zones.indexOf(toZone);

              return h("div", {
                key: `${conn.from}-${conn.to}`,
                class: `connection-item ${conn.bidirectional ? "bidirectional" : ""}`,
              },
                h("span", {
                  class: "connection-zone",
                  style: `--zone-color: ${getZoneColorByIndex(fromIdx)}`,
                },
                  fromZone.name
                ),
                h("span", {
                  class: "connection-arrow",
                  role: "img",
                  "aria-label": conn.bidirectional ? "depends on and is used by" : "depends on",
                },
                  conn.bidirectional ? "\u21C4" : "\u2192"
                ),
                h("span", {
                  class: "connection-zone",
                  style: `--zone-color: ${getZoneColorByIndex(toIdx)}`,
                },
                  toZone.name
                ),
                h("span", { class: "connection-count" }, conn.count)
              );
            }),
            connections.length > 10
              ? h("div", { class: "connection-more" },
                  `+${connections.length - 10} more connections`
                )
              : null
          )
        )
      : null
  );
}


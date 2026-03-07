import { h } from "preact";
import { useState, useMemo } from "preact/hooks";
import type { Zone, ZoneCrossing } from "../../../schema/v1.js";
import { getZoneColorByIndex, basename } from "../../utils.js";

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
          h("span", { class: "legend-dot", style: "background: var(--green)" }),
          "High cohesion"
        ),
        h("span", { class: "legend-item" },
          h("span", { class: "legend-dot", style: "background: var(--orange)" }),
          "Bidirectional"
        ),
        h("span", { class: "legend-item" },
          h("span", { class: "legend-line" }),
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
        },
          h("div", { class: "zone-map-node-header" },
            h("span", { class: "zone-map-node-dot", style: `background: ${color}` }),
            h("span", { class: "zone-map-node-name" }, zone.name)
          ),
          h("div", { class: "zone-map-node-body" },
            h("div", { class: "zone-map-node-stat" },
              h("span", { class: "stat-value" }, zone.files.length),
              h("span", { class: "stat-label" }, "files")
            ),
            h("div", { class: "zone-map-node-health" },
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
                h("span", { class: "io-in", title: "Incoming deps" },
                  "\u2190", metrics.incoming
                ),
                h("span", { class: "io-out", title: "Outgoing deps" },
                  metrics.outgoing, "\u2192"
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
                h("span", { class: "connection-arrow" },
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

/**
 * Zone Detail Popup - Shows detailed info when a zone is selected.
 */
interface ZoneDetailProps {
  zone: Zone;
  crossings: ZoneCrossing[];
  allZones: Zone[];
  onClose: () => void;
  onFileClick?: (path: string) => void;
}

export function ZoneDetail({ zone, crossings, allZones, onClose, onFileClick }: ZoneDetailProps) {
  const [showFiles, setShowFiles] = useState(false);

  // Get connections for this zone
  const incoming = crossings.filter(c => c.toZone === zone.id);
  const outgoing = crossings.filter(c => c.fromZone === zone.id);

  // Group by source/target zone
  const incomingByZone = groupBy(incoming, c => c.fromZone);
  const outgoingByZone = groupBy(outgoing, c => c.toZone);

  const zoneIdx = allZones.indexOf(zone);
  const color = getZoneColorByIndex(zoneIdx);

  return h("div", { class: "zone-detail-overlay" },
    h("div", { class: "zone-detail-panel", style: `--zone-color: ${color}` },
      h("div", { class: "zone-detail-header" },
        h("h3", null, zone.name),
        h("button", { class: "close-btn", onClick: onClose }, "\u2715")
      ),

      h("p", { class: "zone-detail-desc" }, zone.description),

      // Metrics row
      h("div", { class: "zone-detail-metrics" },
        h("div", { class: "metric" },
          h("span", { class: "metric-val" }, zone.files.length),
          h("span", { class: "metric-lbl" }, "files")
        ),
        h("div", { class: "metric" },
          h("span", {
            class: "metric-val",
            style: `color: ${zone.cohesion >= 0.7 ? "var(--green)" : zone.cohesion >= 0.4 ? "var(--orange)" : "var(--red)"}`,
          }, zone.cohesion.toFixed(2)),
          h("span", { class: "metric-lbl" }, "cohesion")
        ),
        h("div", { class: "metric" },
          h("span", {
            class: "metric-val",
            style: `color: ${zone.coupling <= 0.3 ? "var(--green)" : zone.coupling <= 0.5 ? "var(--orange)" : "var(--red)"}`,
          }, zone.coupling.toFixed(2)),
          h("span", { class: "metric-lbl" }, "coupling")
        )
      ),

      // Entry points
      zone.entryPoints.length > 0
        ? h("div", { class: "zone-detail-section" },
            h("h4", null, "Entry Points"),
            h("ul", { class: "entry-point-list" },
              zone.entryPoints.slice(0, 5).map(ep =>
                h("li", { key: ep, class: "mono-sm" }, basename(ep))
              ),
              zone.entryPoints.length > 5
                ? h("li", { class: "more" }, `+${zone.entryPoints.length - 5} more`)
                : null
            )
          )
        : null,

      // Insights
      zone.insights && zone.insights.length > 0
        ? h("div", { class: "zone-detail-section" },
            h("h4", null, "Insights"),
            h("ul", { class: "insight-list" },
              zone.insights.slice(0, 5).map((ins, i) =>
                h("li", { key: i }, ins)
              ),
              zone.insights.length > 5
                ? h("li", { class: "more" }, `+${zone.insights.length - 5} more`)
                : null
            )
          )
        : null,

      // Dependencies
      (Object.keys(incomingByZone).length > 0 || Object.keys(outgoingByZone).length > 0)
        ? h("div", { class: "zone-detail-section" },
            h("h4", null, "Dependencies"),
            h("div", { class: "dep-grid" },
              Object.keys(outgoingByZone).length > 0
                ? h("div", { class: "dep-col" },
                    h("span", { class: "dep-label" }, "Depends on:"),
                    ...Object.entries(outgoingByZone).slice(0, 5).map(([zoneId, items]) => {
                      const targetZone = allZones.find(z => z.id === zoneId);
                      return h("div", { key: zoneId, class: "dep-item" },
                        targetZone?.name || zoneId,
                        h("span", { class: "dep-count" }, items.length)
                      );
                    })
                  )
                : null,
              Object.keys(incomingByZone).length > 0
                ? h("div", { class: "dep-col" },
                    h("span", { class: "dep-label" }, "Used by:"),
                    ...Object.entries(incomingByZone).slice(0, 5).map(([zoneId, items]) => {
                      const sourceZone = allZones.find(z => z.id === zoneId);
                      return h("div", { key: zoneId, class: "dep-item" },
                        sourceZone?.name || zoneId,
                        h("span", { class: "dep-count" }, items.length)
                      );
                    })
                  )
                : null
            )
          )
        : null,

      // Files toggle
      h("div", { class: "zone-detail-section" },
        h("button", {
          class: "toggle-files-btn",
          onClick: () => setShowFiles(!showFiles),
        },
          showFiles ? "Hide files" : `Show ${zone.files.length} files`
        ),
        showFiles
          ? h("ul", { class: "file-list" },
              zone.files.map(f =>
                h("li", {
                  key: f,
                  class: "file-item mono-sm",
                  onClick: onFileClick ? () => onFileClick(f) : undefined,
                },
                  f,
                  zone.entryPoints.includes(f)
                    ? h("span", { class: "entry-badge" }, "entry")
                    : null
                )
              )
            )
          : null
      )
    )
  );
}

// Helper
function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result;
}

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import type { Zone, ZoneCrossing } from "../external.js";
import { getZoneColorByIndex } from "../visualization/colors.js";
import { meterClass } from "../visualization/metrics.js";
import { basename } from "../utils.js";
import type { NavigateTo } from "../types.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface ZoneSlideoutProps {
  /** Zone to display, or null to hide the panel. */
  zone: Zone | null;
  /** All crossings for computing dependencies. */
  crossings: ZoneCrossing[];
  /** Full zone list for color lookup and dependency name resolution. */
  allZones: Zone[];
  /** Close the slideout. */
  onClose: () => void;
  /** Navigate to a file when clicked. */
  onFileClick?: (path: string) => void;
  /** Navigate to a different view. */
  navigateTo?: NavigateTo;
}

// ── Component ──────────────────────────────────────────────────────────

export function ZoneSlideout({
  zone,
  crossings,
  allZones,
  onClose,
  onFileClick,
  navigateTo,
}: ZoneSlideoutProps) {
  const [showFiles, setShowFiles] = useState(false);

  // Reset file list when zone changes
  useEffect(() => { setShowFiles(false); }, [zone?.id]);

  // Close on Escape
  useEffect(() => {
    if (!zone) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [zone, onClose]);

  // Trap focus inside the panel when open
  const panelRef = useCallback((el: HTMLElement | null) => {
    if (el) el.focus();
  }, []);

  if (!zone) return null;

  const zoneIdx = allZones.indexOf(zone);
  const color = getZoneColorByIndex(zoneIdx >= 0 ? zoneIdx : 0);

  // Dependencies
  const incoming = crossings.filter((c) => c.toZone === zone.id);
  const outgoing = crossings.filter((c) => c.fromZone === zone.id);
  const incomingByZone = groupBy(incoming, (c) => c.fromZone);
  const outgoingByZone = groupBy(outgoing, (c) => c.toZone);

  return h(Fragment, null,
    // Backdrop — click to dismiss
    h("div", {
      class: "zone-slideout-backdrop open",
      onClick: onClose,
      "aria-hidden": "true",
    }),
    // Panel
    h("aside", {
      ref: panelRef,
      class: "zone-slideout open",
      role: "complementary",
      "aria-label": `Zone details: ${zone.name}`,
      tabIndex: -1,
      style: `--zone-accent: ${color}`,
    },
      // Header
      h("div", { class: "zone-slideout-header" },
        h("div", { class: "zone-slideout-title" },
          h("span", { class: "zone-slideout-dot", style: `background: ${color}` }),
          h("h3", null, zone.name),
        ),
        h("button", {
          class: "zone-slideout-close",
          onClick: onClose,
          "aria-label": "Close zone details",
          title: "Close (Esc)",
        }, "\u2715"),
      ),

      // Description
      zone.description
        ? h("p", { class: "zone-slideout-desc" }, zone.description)
        : null,

      // Metrics row
      h("div", { class: "zone-slideout-metrics" },
        h("div", { class: "zone-slideout-metric" },
          h("span", { class: "zone-slideout-metric-val" }, zone.files.length),
          h("span", { class: "zone-slideout-metric-lbl" }, "files"),
        ),
        h("div", { class: "zone-slideout-metric" },
          h("span", {
            class: "zone-slideout-metric-val",
            style: `color: ${cohesionColor(zone.cohesion)}`,
          }, zone.cohesion.toFixed(2)),
          h("span", { class: "zone-slideout-metric-lbl" }, "cohesion"),
        ),
        h("div", { class: "zone-slideout-metric" },
          h("span", {
            class: "zone-slideout-metric-val",
            style: `color: ${couplingColor(zone.coupling)}`,
          }, zone.coupling.toFixed(2)),
          h("span", { class: "zone-slideout-metric-lbl" }, "coupling"),
        ),
      ),

      // Cohesion meter
      h("div", { class: "zone-slideout-meter-row" },
        h("span", { class: "zone-slideout-meter-label" }, "Cohesion"),
        h("div", { class: "meter" },
          h("div", {
            class: `meter-fill ${meterClass(zone.cohesion)}`,
            style: `width: ${zone.cohesion * 100}%`,
          }),
        ),
      ),

      // Coupling meter
      h("div", { class: "zone-slideout-meter-row" },
        h("span", { class: "zone-slideout-meter-label" }, "Coupling"),
        h("div", { class: "meter" },
          h("div", {
            class: `meter-fill ${meterClass(zone.coupling, true)}`,
            style: `width: ${zone.coupling * 100}%`,
          }),
        ),
      ),

      // Entry points
      zone.entryPoints.length > 0
        ? h("div", { class: "zone-slideout-section" },
            h("h4", null, "Entry Points"),
            h("ul", { class: "zone-slideout-list" },
              zone.entryPoints.slice(0, 8).map((ep) =>
                h("li", {
                  key: ep,
                  class: `zone-slideout-list-item mono-sm ${onFileClick ? "clickable" : ""}`,
                  title: ep,
                  onClick: onFileClick ? () => onFileClick(ep) : undefined,
                }, basename(ep)),
              ),
              zone.entryPoints.length > 8
                ? h("li", { class: "zone-slideout-list-more" },
                    `+${zone.entryPoints.length - 8} more`,
                  )
                : null,
            ),
          )
        : null,

      // Insights
      zone.insights && zone.insights.length > 0
        ? h("div", { class: "zone-slideout-section" },
            h("h4", null, "Insights"),
            h("ul", { class: "zone-slideout-list" },
              zone.insights.slice(0, 6).map((ins, i) =>
                h("li", { key: i, class: "zone-slideout-list-item" }, ins),
              ),
              zone.insights.length > 6
                ? h("li", { class: "zone-slideout-list-more" },
                    `+${zone.insights.length - 6} more`,
                  )
                : null,
            ),
          )
        : null,

      // Sub-zones
      zone.subZones && zone.subZones.length > 0
        ? h("div", { class: "zone-slideout-section" },
            h("h4", null, "Sub-zones"),
            h("ul", { class: "zone-slideout-list" },
              zone.subZones.slice(0, 6).map((sz) =>
                h("li", { key: sz.id, class: "zone-slideout-dep-item" },
                  h("span", null, sz.name),
                  h("span", { class: "zone-slideout-dep-count" }, `${sz.files.length} files`),
                ),
              ),
              zone.subZones.length > 6
                ? h("li", { class: "zone-slideout-list-more" },
                    `+${zone.subZones.length - 6} more`,
                  )
                : null,
            ),
          )
        : null,

      // Dependencies
      (Object.keys(incomingByZone).length > 0 || Object.keys(outgoingByZone).length > 0)
        ? h("div", { class: "zone-slideout-section" },
            h("h4", null, "Dependencies"),
            h("div", { class: "zone-slideout-deps" },
              Object.keys(outgoingByZone).length > 0
                ? h("div", { class: "zone-slideout-dep-col" },
                    h("span", { class: "zone-slideout-dep-label" }, "Depends on"),
                    ...Object.entries(outgoingByZone).slice(0, 6).map(([zoneId, items]) => {
                      const target = allZones.find((z) => z.id === zoneId);
                      return h("div", { key: zoneId, class: "zone-slideout-dep-item" },
                        h("span", null, target?.name || zoneId),
                        h("span", { class: "zone-slideout-dep-count" }, items.length),
                      );
                    }),
                  )
                : null,
              Object.keys(incomingByZone).length > 0
                ? h("div", { class: "zone-slideout-dep-col" },
                    h("span", { class: "zone-slideout-dep-label" }, "Used by"),
                    ...Object.entries(incomingByZone).slice(0, 6).map(([zoneId, items]) => {
                      const source = allZones.find((z) => z.id === zoneId);
                      return h("div", { key: zoneId, class: "zone-slideout-dep-item" },
                        h("span", null, source?.name || zoneId),
                        h("span", { class: "zone-slideout-dep-count" }, items.length),
                      );
                    }),
                  )
                : null,
            ),
          )
        : null,

      // Files toggle
      h("div", { class: "zone-slideout-section" },
        h("button", {
          class: "zone-slideout-files-toggle",
          onClick: () => setShowFiles(!showFiles),
        },
          showFiles ? "Hide files" : `Show ${zone.files.length} files`,
        ),
        showFiles
          ? h("ul", { class: "zone-slideout-file-list" },
              zone.files.map((f) =>
                h("li", {
                  key: f,
                  class: `zone-slideout-file-item mono-sm ${onFileClick ? "clickable" : ""}`,
                  onClick: onFileClick ? () => onFileClick(f) : undefined,
                },
                  h("span", { class: "zone-slideout-file-path" }, f),
                  zone.entryPoints.includes(f)
                    ? h("span", { class: "zone-slideout-entry-badge" }, "entry")
                    : null,
                ),
              ),
            )
          : null,
      ),

      // Navigation buttons
      navigateTo
        ? h("div", { class: "zone-slideout-nav" },
            h("button", {
              class: "zone-slideout-nav-btn",
              onClick: () => navigateTo("files", { zone: zone.id }),
            }, "\u2630 View in Files"),
            h("button", {
              class: "zone-slideout-nav-btn",
              onClick: () => navigateTo("problems"),
            }, "\u26A0 View Problems"),
            h("button", {
              class: "zone-slideout-nav-btn",
              onClick: () => navigateTo("suggestions"),
            }, "\u2728 View Suggestions"),
          )
        : null,
    ),
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function cohesionColor(v: number): string {
  return v >= 0.7 ? "var(--green)" : v >= 0.4 ? "var(--orange)" : "var(--red)";
}

function couplingColor(v: number): string {
  return v <= 0.3 ? "var(--green)" : v <= 0.5 ? "var(--orange)" : "var(--red)";
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
  }
  return result;
}

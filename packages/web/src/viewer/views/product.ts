/**
 * Product page — the product as built, one row per capability.
 *
 * Answers "what does this product do, and does it work" directly, instead of
 * leaving a reader to infer it from a history of completed work. Areas group
 * capabilities; each row carries a computed status and health, and the open
 * changes against it are drawn as overlays — what is coming, before it is
 * true. Revised (the spec has moved ahead of the build) and defective (it is
 * broken now) are highlighted, because those are the rows people come for.
 *
 * Driven entirely by its `map` prop: no fetch and no route, so it renders
 * from a v2 fixture until the v2 reader and its routes land.
 */

import { h, Fragment } from "preact";
import { BrandedHeader } from "../components/index.js";
import {
  CAPABILITY_HEALTH_LABELS,
  CAPABILITY_STATUS_LABELS,
  CHANGE_STAGE_LABELS,
  needsAttention,
  productTotals,
  sortCapabilities,
  type AreaSection,
  type CapabilityRow,
  type ConstraintRow,
  type OpenChangeOverlay,
  type ProductMap,
} from "./product-model.js";

// ── Helpers ──────────────────────────────────────────────────────────

function StatusTag({ row }: { row: Pick<CapabilityRow, "status"> }) {
  return h("span", {
    class: `tag pm-status pm-status-${row.status}`,
    "data-status": row.status,
  }, CAPABILITY_STATUS_LABELS[row.status]);
}

function HealthTag({ health }: { health: CapabilityRow["health"] }) {
  return h("span", {
    class: `tag pm-health pm-health-${health}`,
    "data-health": health,
  }, CAPABILITY_HEALTH_LABELS[health]);
}

/**
 * The open changes against one capability. Each is an overlay rather than a
 * fact: it says what a change will do to the spec, and at which stage.
 */
function OverlayList({ changes }: { changes: OpenChangeOverlay[] }) {
  if (changes.length === 0) return h("span", { class: "pm-overlay-none" }, "—");
  return h("ul", { class: "pm-overlays" },
    changes.map((change) =>
      h("li", { key: change.id, class: "pm-overlay", "data-stage": change.stage },
        h("span", { class: "pm-overlay-id" }, change.displayId ?? change.id),
        " ",
        h("span", { class: "pm-overlay-title" }, change.title),
        " ",
        h("span", { class: "pm-overlay-stage" }, CHANGE_STAGE_LABELS[change.stage]),
        change.delta
          ? h("span", { class: `pm-overlay-delta pm-delta-${change.delta}` }, change.delta)
          : null,
      ),
    ),
  );
}

function CapabilityRowCells({ row, onSelect }: {
  row: CapabilityRow;
  onSelect?: (id: string) => void;
}) {
  const attention = needsAttention(row);
  return h("tr", {
    class: `pm-row${attention ? " pm-row-attention" : ""}`,
    "data-capability-id": row.id,
    ...(attention ? { "data-attention": "true" } : {}),
  },
    h("td", { class: "pm-cell-title" },
      onSelect
        ? h("button", {
            type: "button",
            class: "pm-capability-link",
            onClick: () => onSelect(row.id),
          }, row.title)
        : row.title,
      row.displayId ? h("span", { class: "pm-display-id" }, row.displayId) : null,
      row.statement ? h("p", { class: "pm-statement" }, row.statement) : null,
    ),
    h("td", null, h(StatusTag, { row })),
    h("td", null, h(HealthTag, { health: row.health })),
    h("td", { class: "pm-cell-criteria" }, String(row.criteriaCount)),
    h("td", { class: "pm-cell-overlays" }, h(OverlayList, { changes: row.openChanges })),
  );
}

function Area({ area, onSelectCapability }: {
  area: AreaSection;
  onSelectCapability?: (id: string) => void;
}) {
  return h("section", { class: "pm-area", "aria-label": area.title },
    h("h3", { class: "section-header" },
      area.title,
      area.displayId ? h("span", { class: "pm-display-id" }, area.displayId) : null,
    ),
    area.summary ? h("p", { class: "section-sub" }, area.summary) : null,
    area.stewards && area.stewards.length > 0
      ? h("p", { class: "pm-stewards" },
          "Stewards: ",
          area.stewards.map((steward, i) =>
            h(Fragment, { key: steward }, i > 0 ? ", " : null, h("span", { class: "tag" }, steward))),
        )
      : null,
    area.capabilities.length === 0
      ? h("div", { class: "empty-state" }, "No capabilities in this area yet.")
      : h("table", { class: "data-table pm-table" },
          h("thead", null,
            h("tr", null,
              h("th", null, "Capability"),
              h("th", null, "Status"),
              h("th", null, "Health"),
              h("th", null, "Criteria"),
              h("th", null, "Open changes"),
            ),
          ),
          h("tbody", null,
            sortCapabilities(area.capabilities).map((row) =>
              h(CapabilityRowCells, { key: row.id, row, onSelect: onSelectCapability })),
          ),
        ),
  );
}

function Constraints({ constraints }: { constraints: ConstraintRow[] }) {
  if (constraints.length === 0) return null;
  return h("section", { class: "pm-constraints", "aria-label": "Constraints" },
    h("h3", { class: "section-header" }, `Constraints (${constraints.length})`),
    h("table", { class: "data-table pm-table" },
      h("thead", null,
        h("tr", null,
          h("th", null, "Constraint"),
          h("th", null, "Health"),
          h("th", null, "Applies to"),
        ),
      ),
      h("tbody", null,
        constraints.map((constraint) =>
          h("tr", {
            key: constraint.id,
            class: `pm-row${constraint.health === "defective" ? " pm-row-attention" : ""}`,
            "data-constraint-id": constraint.id,
          },
            h("td", { class: "pm-cell-title" },
              constraint.title,
              constraint.displayId ? h("span", { class: "pm-display-id" }, constraint.displayId) : null,
              constraint.statement ? h("p", { class: "pm-statement" }, constraint.statement) : null,
            ),
            h("td", null, h(HealthTag, { health: constraint.health })),
            h("td", null,
              constraint.appliesTo === "all"
                ? h("span", { class: "tag" }, "all map nodes")
                : constraint.appliesTo.map((title) => h("span", { key: title, class: "tag" }, title)),
            ),
          ),
        ),
      ),
    ),
  );
}

// ── View ─────────────────────────────────────────────────────────────

export function ProductView({ map, onSelectCapability }: {
  map: ProductMap;
  /** Opens the capability page. Omitted, titles render as plain text. */
  onSelectCapability?: (id: string) => void;
}) {
  const totals = productTotals(map);
  const empty = map.areas.length === 0 && map.constraints.length === 0;

  return h("div", { class: "pm-container" },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, "Product"),
    ),
    map.statement
      ? h("p", { class: "section-sub" }, map.statement)
      : h("p", { class: "section-sub" },
          "Areas and capabilities as built, with status and health computed. Open changes show as overlays."),

    empty
      ? h("div", { class: "empty-state", role: "status" },
          "No product map yet. Areas and capabilities appear here once the product layer is populated.")
      : h(Fragment, null,
          h("div", { class: "overview-metrics pm-totals" },
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, String(totals.capabilities)),
              h("div", { class: "metric-label" }, "Capabilities"),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, String(totals.met)),
              h("div", { class: "metric-label" }, "Met"),
            ),
            h("div", { class: "metric-card pm-metric-revised" },
              h("div", { class: "metric-value" }, String(totals.revised)),
              h("div", { class: "metric-label" }, "Revised"),
            ),
            h("div", { class: "metric-card pm-metric-defective" },
              h("div", { class: "metric-value" }, String(totals.defective)),
              h("div", { class: "metric-label" }, "Defective"),
            ),
            h("div", { class: "metric-card" },
              h("div", { class: "metric-value" }, String(totals.openChanges)),
              h("div", { class: "metric-label" }, "Open changes"),
            ),
          ),
          map.areas.map((area) =>
            h(Area, { key: area.id, area, onSelectCapability })),
          h(Constraints, { constraints: map.constraints }),
        ),
  );
}

/**
 * Capability page — one capability's spec, its criteria, what moved it, and
 * where it lives in code.
 *
 * Reached from a Product page row. The spec and criteria are intent, authored
 * by a person; status, health and history are computed from the changes that
 * amended it. "Where it lives" is the answer a map gives that a task list
 * cannot: the code that makes the statement true.
 *
 * Driven entirely by its `capability` prop: no fetch and no route, so it
 * renders from a v2 fixture until the v2 reader and its routes land.
 */

import { h } from "preact";
import { BrandedHeader } from "../components/index.js";
import {
  CAPABILITY_HEALTH_LABELS,
  CAPABILITY_STATUS_LABELS,
  CHANGE_STAGE_LABELS,
  needsAttention,
  type CapabilityDetail,
  type CapabilityHistoryEntry,
} from "./product-model.js";

// ── Helpers ──────────────────────────────────────────────────────────

function Criteria({ capability }: { capability: CapabilityDetail }) {
  return h("section", { class: "cap-criteria", "aria-label": "Acceptance criteria" },
    h("h3", { class: "section-header" }, `Criteria (${capability.criteria.length})`),
    capability.criteria.length === 0
      ? h("div", { class: "empty-state" },
          "No criteria yet. A capability with no criteria cannot be shown to be met.")
      : h("ul", { class: "cap-criteria-list" },
          capability.criteria.map((criterion) =>
            h("li", {
              key: criterion.id,
              class: `cap-criterion${criterion.inheritedFrom ? " cap-criterion-inherited" : ""}`,
            },
              criterion.text,
              criterion.inheritedFrom
                ? h("span", { class: "tag cap-inherited" }, `inherited from ${criterion.inheritedFrom}`)
                : null,
            ),
          ),
        ),
  );
}

function History({ entries }: { entries: CapabilityHistoryEntry[] }) {
  return h("section", { class: "cap-history", "aria-label": "History" },
    h("h3", { class: "section-header" }, `History (${entries.length})`),
    entries.length === 0
      ? h("div", { class: "empty-state" }, "Nothing has amended this capability yet.")
      : h("table", { class: "data-table cap-history-table" },
          h("thead", null,
            h("tr", null,
              h("th", null, "Change"),
              h("th", null, "Delta"),
              h("th", null, "Stage"),
              h("th", null, "Shipped in"),
              h("th", null, "When"),
            ),
          ),
          h("tbody", null,
            entries.map((entry) =>
              h("tr", { key: entry.changeId, "data-change-id": entry.changeId },
                h("td", null,
                  entry.changeDisplayId
                    ? h("span", { class: "cap-display-id" }, entry.changeDisplayId)
                    : null,
                  entry.changeTitle,
                ),
                h("td", null,
                  entry.delta
                    ? h("span", { class: `tag cap-delta cap-delta-${entry.delta}` }, entry.delta)
                    : h("span", { class: "tag cap-delta cap-delta-touches" }, "touches"),
                ),
                h("td", null, CHANGE_STAGE_LABELS[entry.stage]),
                h("td", null, entry.shippedIn ?? "—"),
                h("td", null, entry.at ?? "—"),
              ),
            ),
          ),
        ),
  );
}

function WhereItLives({ capability }: { capability: CapabilityDetail }) {
  return h("section", { class: "cap-code", "aria-label": "Where it lives in code" },
    h("h3", { class: "section-header" }, "Where it lives in code"),
    capability.code.length === 0
      ? h("div", { class: "empty-state" },
          "No code sites recorded. They are stamped by the changes that build the capability.")
      : h("ul", { class: "cap-code-list" },
          capability.code.map((site) =>
            h("li", { key: site.path, class: "cap-code-site" },
              h("code", { class: "cap-code-path" }, site.path),
              site.role ? h("span", { class: "cap-code-role" }, site.role) : null,
            ),
          ),
        ),
  );
}

// ── View ─────────────────────────────────────────────────────────────

export function CapabilityPage({ capability, onBack }: {
  capability: CapabilityDetail;
  /** Returns to the Product page. Omitted, no back control renders. */
  onBack?: () => void;
}) {
  const attention = needsAttention(capability);

  return h("div", {
    class: `cap-container${attention ? " cap-container-attention" : ""}`,
    "data-capability-id": capability.id,
  },
    h("div", { class: "view-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", { class: "view-title" }, capability.title),
    ),

    h("nav", { class: "cap-breadcrumb", "aria-label": "Breadcrumb" },
      onBack
        ? h("button", { type: "button", class: "cap-back", onClick: onBack }, "Product")
        : h("span", { class: "cap-back-static" }, "Product"),
      h("span", { class: "cap-breadcrumb-sep" }, "/"),
      h("span", { class: "cap-area" }, capability.areaTitle),
    ),

    h("div", { class: "cap-badges" },
      capability.displayId ? h("span", { class: "cap-display-id" }, capability.displayId) : null,
      h("span", {
        class: `tag pm-status pm-status-${capability.status}`,
        "data-status": capability.status,
      }, CAPABILITY_STATUS_LABELS[capability.status]),
      h("span", {
        class: `tag pm-health pm-health-${capability.health}`,
        "data-health": capability.health,
      }, CAPABILITY_HEALTH_LABELS[capability.health]),
      capability.specReviewed
        ? h("span", { class: "tag cap-spec-reviewed" }, "Spec reviewed")
        : h("span", { class: "tag cap-spec-unreviewed" }, "Spec not reviewed"),
    ),

    h("section", { class: "cap-statement", "aria-label": "Statement" },
      h("h3", { class: "section-header" }, "Statement"),
      capability.statement
        ? h("p", { class: "cap-statement-text" }, capability.statement)
        : h("div", { class: "empty-state" }, "No statement yet."),
    ),

    h(Criteria, { capability }),

    capability.openChanges.length > 0
      ? h("section", { class: "cap-open-changes", "aria-label": "Open changes" },
          h("h3", { class: "section-header" }, `Open changes (${capability.openChanges.length})`),
          h("ul", { class: "pm-overlays" },
            capability.openChanges.map((change) =>
              h("li", { key: change.id, class: "pm-overlay", "data-stage": change.stage },
                h("span", { class: "pm-overlay-id" }, change.displayId ?? change.id),
                " ",
                h("span", { class: "pm-overlay-title" }, change.title),
                " ",
                h("span", { class: "pm-overlay-stage" }, CHANGE_STAGE_LABELS[change.stage]),
              ),
            ),
          ),
        )
      : null,

    capability.dependsOn.length > 0
      ? h("section", { class: "cap-depends-on", "aria-label": "Depends on" },
          h("h3", { class: "section-header" }, "Depends on"),
          h("ul", { class: "cap-depends-list" },
            capability.dependsOn.map((dep) =>
              h("li", { key: dep.id }, dep.title)),
          ),
        )
      : null,

    h(History, { entries: capability.history }),
    h(WhereItLives, { capability }),
  );
}

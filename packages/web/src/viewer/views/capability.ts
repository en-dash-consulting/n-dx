/**
 * Capability page — one capability's spec, its criteria, what moved it, and
 * where it lives in code.
 *
 * Reached from a Product page row. The spec and criteria are intent, authored
 * by a person; status, health and history are computed from the changes that
 * amended it. "Where it lives" is the answer a map gives that a task list
 * cannot: the code that makes the statement true.
 *
 * The spec can be edited in place, with an editorial checkbox saying the
 * wording moved and nothing was asked for. The page submits the edit and
 * renders the capability it is handed back; what an edit *does* to a node's
 * status is rex's to decide, like every other computed field here.
 *
 * Driven entirely by its `capability` prop: `product-pages.ts` fetches it
 * from `GET /api/rex/product/capability/<id>`, and tests render it from a
 * fixture. `onEdit` is the seam the page wires a direct edit to.
 */

import { h } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { CRITERIA_LABEL } from "../external.js";
import {
  CAPABILITY_HEALTH_LABELS,
  CAPABILITY_STATUS_LABELS,
  CHANGE_STAGE_LABELS,
  editorialBlockedReason,
  isEditable,
  needsAttention,
  type CapabilityDetail,
  type CapabilityHistoryEntry,
  type ProductEdit,
} from "./product-model.js";

// ── Helpers ──────────────────────────────────────────────────────────

function Criteria({ capability }: { capability: CapabilityDetail }) {
  return h("section", { class: "cap-criteria", "aria-label": CRITERIA_LABEL.capability },
    h("h3", { class: "section-header" }, `${CRITERIA_LABEL.capability} (${capability.criteria.length})`),
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

// ── Direct edit ──────────────────────────────────────────────────────

/**
 * Edit the spec in place.
 *
 * The statement and the capability's own criteria are editable; inherited
 * criteria are not, because they belong to the capability they come from and
 * editing one here would be editing a node other than the one this page names.
 *
 * The **editorial** checkbox is the whole point of the form. Checked, it says
 * the wording moved and nothing was asked for: the node stays met and the edit
 * is recorded as history. Unchecked, the spec has moved ahead of the build and
 * a change is drafted to build the difference. Only the author can tell those
 * apart, so the form asks rather than guessing — and says which one is about to
 * happen before the edit is submitted.
 */
function EditForm({ capability, onEdit }: {
  capability: CapabilityDetail;
  onEdit: (edit: ProductEdit) => void;
}) {
  const own = useMemo(() => capability.criteria.filter((c) => !c.inheritedFrom), [capability.criteria]);

  const [statement, setStatement] = useState(capability.statement ?? "");
  const [criteria, setCriteria] = useState<Record<string, string>>(
    () => Object.fromEntries(own.map((c) => [c.id, c.text])),
  );
  const [editorial, setEditorial] = useState(false);

  const blocked = editorialBlockedReason(capability);
  const editorialChecked = editorial && blocked === null;

  const changed =
    statement !== (capability.statement ?? "") ||
    own.some((c) => criteria[c.id] !== c.text);

  const submit = useCallback((event: Event) => {
    event.preventDefault();
    onEdit({
      id: capability.id,
      statement,
      criteria: own.map((c) => ({ id: c.id, text: criteria[c.id] ?? c.text })),
      editorial: editorialChecked,
    });
  }, [onEdit, capability.id, statement, criteria, own, editorialChecked]);

  return h("section", { class: "cap-edit", "aria-label": "Edit this capability" },
    h("h3", { class: "section-header" }, "Edit"),
    h("form", { class: "cap-edit-form", onSubmit: submit },
      h("label", { class: "cap-edit-label", for: "cap-edit-statement" }, "Statement"),
      h("textarea", {
        id: "cap-edit-statement",
        class: "cap-edit-statement",
        rows: 3,
        value: statement,
        onInput: (e: Event) => setStatement((e.target as HTMLTextAreaElement).value),
      }),

      own.length > 0
        ? h("fieldset", { class: "cap-edit-criteria" },
            h("legend", null, CRITERIA_LABEL.capability),
            own.map((criterion) =>
              h("input", {
                key: criterion.id,
                type: "text",
                class: "cap-edit-criterion",
                "data-criterion-id": criterion.id,
                "aria-label": `${CRITERIA_LABEL.capability}: ${criterion.text}`,
                value: criteria[criterion.id] ?? criterion.text,
                onInput: (e: Event) =>
                  setCriteria((prev) => ({ ...prev, [criterion.id]: (e.target as HTMLInputElement).value })),
              }),
            ),
          )
        : null,

      h("div", { class: "cap-edit-editorial" },
        h("label", { class: `cap-edit-editorial-label${blocked ? " cap-edit-editorial-blocked" : ""}` },
          h("input", {
            type: "checkbox",
            class: "cap-edit-editorial-check",
            checked: editorialChecked,
            disabled: blocked !== null,
            onChange: (e: Event) => setEditorial((e.target as HTMLInputElement).checked),
          }),
          " Editorial — wording only, nothing to build",
        ),
        blocked
          ? h("p", { class: "cap-edit-editorial-reason" }, blocked)
          : null,
      ),

      // What is about to happen, in the words the outcome will be recorded in.
      h("p", { class: "cap-edit-outcome" },
        editorialChecked
          ? "It stays met. A History line records the edit, and no change is drafted."
          : "The spec moves ahead of the build: a change is drafted in the Inbox to build the difference.",
      ),

      h("button", {
        type: "submit",
        class: "cap-edit-submit",
        disabled: !changed,
      }, "Save edit"),
    ),
  );
}

// ── View ─────────────────────────────────────────────────────────────

export function CapabilityPage({ capability, onBack, onEdit }: {
  capability: CapabilityDetail;
  /** Returns to the Product page. Omitted, no back control renders. */
  onBack?: () => void;
  /**
   * Submits a direct edit to the spec. Omitted, the page is read-only and no
   * form renders — the Product page's own rows have nowhere to send one.
   */
  onEdit?: (edit: ProductEdit) => void;
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

    onEdit && isEditable(capability)
      ? h(EditForm, { capability, onEdit })
      : null,

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

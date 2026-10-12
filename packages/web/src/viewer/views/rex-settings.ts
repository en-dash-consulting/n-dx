/**
 * Rex settings — the PRD section of the Workflow page.
 *
 * Two settings: when a completed change's amendments reach the product layer
 * (`rex.applyOn`), and when a placement is accepted without a human
 * (`rex.placement.autoAccept`). Both are stored in `.n-dx.json`, which is the
 * file `rex` itself reads, so what is saved here is what the CLI acts on.
 *
 * The *choices* are not declared here. They arrive in the GET response, which
 * takes them from rex's own accepted-value lists — a viewer-local list would
 * be free to offer a value rex rejects, and the save would then appear to work
 * and change nothing. The labels below are presentation for the values that
 * exist today; a value with no entry renders as itself rather than blank.
 *
 * `useRexSettingsForm` owns the state; `views/workflow.ts` composes the
 * section onto the shared SettingsFrame, which owns Save and the
 * unsaved-changes prompt.
 *
 * Data comes from GET /api/rex/settings and PUT /api/rex/settings.
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";

// ── Types ─────────────────────────────────────────────────────────────

/** The GET /api/rex/settings response. Declared here because the viewer may not import the server's types. */
interface RexSettingsResponse {
  applyOn: string;
  applyOnSet: boolean;
  placementAutoAccept: string;
  placementAutoAcceptSet: boolean;
  choices: { applyOn: string[]; placementAutoAccept: string[] };
  defaults: { applyOn: string; placementAutoAccept: string };
  /** Rex's complaints about stored values it had to fall back from. */
  warnings: string[];
  /** The file the settings live in, relative to the project root. */
  configFile: string;
}

// ── Presentation for the values that exist today ──────────────────────

interface ChoiceMeta {
  label: string;
  description: string;
}

const APPLY_ON_META: Record<string, ChoiceMeta> = {
  complete: {
    label: "On complete",
    description: "A change applies to the product layer as soon as it completes on its branch.",
  },
  review: {
    label: "On review",
    description: "A completed change waits for a steward to apply it.",
  },
  release: {
    label: "On release",
    description: "Completed changes apply together when a release is stamped.",
  },
};

const AUTO_ACCEPT_META: Record<string, ChoiceMeta> = {
  none: {
    label: "Never",
    description: "Every placement is held for a person to confirm.",
  },
  agree: {
    label: "When models agree",
    description: "A pick is taken when the models that ran agree on it; anything else is held.",
  },
  confident: {
    label: "When confident",
    description: "A pick is taken when the judge is confident enough, even without a second opinion.",
  },
};

/** The label for a value, or the value itself when it is newer than this table. */
function metaFor(table: Record<string, ChoiceMeta>, value: string): ChoiceMeta {
  return table[value] ?? { label: value, description: "" };
}

// ── Field ─────────────────────────────────────────────────────────────

function ChoiceField({ fieldKey, title, description, meta, choices, saved, isSet, defaultValue, editValue, onchange, onReset }: {
  /** The config key, shown so the form and a hand-edited file speak the same names. */
  fieldKey: string;
  title: string;
  description: string;
  meta: Record<string, ChoiceMeta>;
  choices: string[];
  saved: string;
  /** Whether the value is written in the config, or is just the default. */
  isSet: boolean;
  defaultValue: string;
  editValue: string;
  onchange: (value: string) => void;
  onReset: () => void;
}) {
  const dirty = editValue !== saved;
  const selected = metaFor(meta, editValue);

  return h("div", { class: `ct-field${isSet ? " ct-field-modified" : ""}${dirty ? " ct-field-dirty" : ""}`, "data-field": fieldKey },
    h("div", { class: "ct-field-header" },
      h("div", { class: "ct-field-label-row" },
        h("span", { class: "ct-field-name" }, title),
        isSet ? h("span", { class: "ct-badge-modified" }, "modified") : null,
        dirty ? h("span", { class: "ct-badge-unsaved" }, "unsaved") : null,
      ),
      h("div", { class: "ct-field-actions" },
        h("span", { class: "ct-field-key" }, fieldKey),
        dirty
          ? h("button", {
              type: "button",
              class: "ct-reset-btn",
              onClick: onReset,
              title: "Revert to current saved value",
            }, "Revert")
          : null,
      ),
    ),
    h("p", { class: "ct-field-desc" }, description),
    h("div", { class: "ct-control-row" },
      h("select", {
        class: "ct-select",
        value: editValue,
        onChange: (e: Event) => onchange((e.target as HTMLSelectElement).value),
        "aria-label": title,
      },
        choices.map((choice) =>
          h("option", { key: choice, value: choice },
            metaFor(meta, choice).label + (choice === defaultValue ? " (default)" : ""),
          ),
        ),
      ),
    ),
    selected.description
      ? h("div", { class: dirty ? "ct-field-preview" : "ct-field-impact" },
          dirty ? h("span", { class: "ct-field-preview-label" }, "Preview: ") : null,
          selected.description,
        )
      : null,
  );
}

// ── Form state ────────────────────────────────────────────────────────

/** State and actions of the rex-settings form. The Workflow page owns it. */
export interface RexSettingsForm {
  data: RexSettingsResponse | null;
  loading: boolean;
  loadError: string | null;
  /** Why the last save failed. Cleared by the next save or a discard. */
  saveError: string | null;
  /** Raw edits, or null when untouched. */
  applyOnEdit: string | null;
  autoAcceptEdit: string | null;
  /** True while either value differs from what is saved. */
  dirty: boolean;
  onApplyOnChange: (value: string) => void;
  onApplyOnReset: () => void;
  onAutoAcceptChange: (value: string) => void;
  onAutoAcceptReset: () => void;
  /**
   * PUT the changed values. Resolves true once saved (or when nothing is
   * dirty); false leaves the edits in place with `saveError` set.
   */
  save: () => Promise<boolean>;
  /** Drop every edit. */
  discard: () => void;
  /** Re-read from the server. */
  reload: () => Promise<void>;
}

export function useRexSettingsForm(): RexSettingsForm {
  const [data, setData] = useState<RexSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [applyOnEdit, setApplyOnEdit] = useState<string | null>(null);
  const [autoAcceptEdit, setAutoAcceptEdit] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/rex/settings");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setLoadError((body as { error?: string }).error ?? "Failed to load rex settings");
        return;
      }
      const body = await res.json() as RexSettingsResponse;
      // The chooser is built from `choices`; a body without them would render
      // an empty select that silently saves nothing. Treat it as a failed load
      // and say so, rather than drawing a control that cannot work.
      if (!Array.isArray(body?.choices?.applyOn) || !Array.isArray(body?.choices?.placementAutoAccept)) {
        setLoadError("The server did not say which values these settings accept");
        return;
      }
      setData(body);
      setLoadError(null);
      setApplyOnEdit(null);
      setAutoAcceptEdit(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load rex settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const pendingBody = useMemo(() => {
    const body: { applyOn?: string; placementAutoAccept?: string } = {};
    if (!data) return body;
    if (applyOnEdit !== null && applyOnEdit !== data.applyOn) body.applyOn = applyOnEdit;
    if (autoAcceptEdit !== null && autoAcceptEdit !== data.placementAutoAccept) {
      body.placementAutoAccept = autoAcceptEdit;
    }
    return body;
  }, [data, applyOnEdit, autoAcceptEdit]);

  const dirty = Object.keys(pendingBody).length > 0;

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaveError(null);
    try {
      const res = await fetch("/api/rex/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingBody),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveError((errBody as { error?: string }).error ?? "Save failed");
        return false;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    }
    await reload();
    return true;
  }, [dirty, pendingBody, reload]);

  const discard = useCallback(() => {
    setApplyOnEdit(null);
    setAutoAcceptEdit(null);
    setSaveError(null);
  }, []);

  return {
    data,
    loading,
    loadError,
    saveError,
    applyOnEdit,
    autoAcceptEdit,
    dirty,
    onApplyOnChange: setApplyOnEdit,
    onApplyOnReset: () => setApplyOnEdit(null),
    onAutoAcceptChange: setAutoAcceptEdit,
    onAutoAcceptReset: () => setAutoAcceptEdit(null),
    save,
    discard,
    reload,
  };
}

// ── Section ───────────────────────────────────────────────────────────

export function RexSettingsSection({ form }: { form: RexSettingsForm }) {
  const { data } = form;

  if (form.loading) {
    return h("div", { class: "ct-container" }, h("div", { class: "loading" }, "Loading PRD settings..."));
  }

  if (!data) {
    return h("div", { class: "ct-container" },
      h("div", { class: "ct-error-state" }, form.loadError ?? "Failed to load PRD settings"),
    );
  }

  return h("div", { class: "ct-container rex-settings" },
    h("p", { class: "ct-header-subtitle" },
      "When a finished change reaches the product map, and when a change is filed without being asked. " +
      "Saved to ",
      h("code", null, data.configFile),
      " — the same file ",
      h("code", null, "rex"),
      " reads.",
    ),

    form.saveError ? h("div", { class: "ct-error-banner" }, form.saveError) : null,

    // Rex read the config and had to fall back; say so here, where it can be fixed.
    data.warnings.length > 0
      ? h("div", { class: "ct-info-box rex-settings-warnings", role: "status" },
          h("p", null, `Ignored in ${data.configFile}, running on the default instead:`),
          h("ul", null, data.warnings.map((w) => h("li", { key: w }, w))),
        )
      : null,

    h("div", { class: "ct-field-list" },
      h(ChoiceField, {
        fieldKey: "rex.applyOn",
        title: "Apply amendments",
        description: "A change amends the product map. This is the moment those amendments are written to it.",
        meta: APPLY_ON_META,
        choices: data.choices.applyOn,
        saved: data.applyOn,
        isSet: data.applyOnSet,
        defaultValue: data.defaults.applyOn,
        editValue: form.applyOnEdit ?? data.applyOn,
        onchange: form.onApplyOnChange,
        onReset: form.onApplyOnReset,
      }),
      h(ChoiceField, {
        fieldKey: "rex.placement.autoAccept",
        title: "Accept placements",
        description: "A new change has to be filed somewhere on the map. This is when that pick is taken without a person.",
        meta: AUTO_ACCEPT_META,
        choices: data.choices.placementAutoAccept,
        saved: data.placementAutoAccept,
        isSet: data.placementAutoAcceptSet,
        defaultValue: data.defaults.placementAutoAccept,
        editValue: form.autoAcceptEdit ?? data.placementAutoAccept,
        onchange: form.onAutoAcceptChange,
        onReset: form.onAutoAcceptReset,
      }),
    ),
  );
}

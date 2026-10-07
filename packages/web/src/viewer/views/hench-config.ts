/**
 * Work settings — the hench config section of the Workflow page.
 *
 * `useHenchConfigForm` owns the form state (loaded fields, edits, validation,
 * save); `HenchConfigSection` renders it with proper form controls
 * (dropdowns, number inputs, toggles, tag lists) and a real-time impact
 * preview. `views/workflow.ts` composes both onto the shared SettingsFrame,
 * which owns Save and the unsaved-changes prompt.
 *
 * Provider and model are not rendered: Robot Wrangler owns them, and the
 * section shows a link there in their place.
 *
 * Data comes from GET /api/hench/config (read) and
 * PUT /api/hench/config (update).
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { GlossaryLine } from "../components/index.js";

// ── Types ────────────────────────────────────────────────────────────

export interface ConfigField {
  path: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "enum" | "array";
  enumValues?: string[];
  category: string;
  value: unknown;
  defaultValue: unknown;
  isDefault: boolean;
  impact: string;
}

interface ConfigResponse {
  config: Record<string, unknown>;
  fields: ConfigField[];
}

/**
 * Fields the server serves that this section does not render: Robot Wrangler
 * owns provider and model. `CONFIG_FIELD_META` keeps both, because
 * `tests/e2e/hench-config-gate-contract.test.js` compares its keys with hench's.
 */
export const ROBOT_WRANGLER_FIELDS: ReadonlySet<string> = new Set(["provider", "model"]);

// ── Category metadata ────────────────────────────────────────────────

/**
 * Heading, icon and blurb per category. Exported so
 * `tests/unit/viewer/hench-config.test.ts` can check it against the server's
 * field list — a category with no entry here renders under its raw id.
 */
export const CATEGORY_META: Record<string, { label: string; icon: string; description: string }> = {
  execution: {
    label: "Execution Strategy",
    icon: "\u25B6",
    description: "Controls how the agent runs: turn limits, token budgets and permissions",
  },
  session: {
    label: "Session Reuse",
    icon: "\u21BB",
    description: "How task spawns relate to vendor sessions, and how long a cached one lives",
  },
  "task-selection": {
    label: "Task Selection",
    icon: "\u2611",
    description: "How tasks are picked and when they're considered stuck",
  },
  retry: {
    label: "Retry Policy",
    icon: "\u21BA",
    description: "How transient API errors are handled with exponential backoff",
  },
  prune: {
    label: "Context Prune",
    icon: "\u2702",
    description: "When an API run summarizes its older turns, and how much it keeps verbatim",
  },
  "test-gate": {
    label: "Test Gate",
    icon: "\u2714",
    description: "The full-suite run that must pass before a commit",
  },
  git: {
    label: "Git Safety",
    icon: "\u2387",
    description: "Committing, rollback on failure, and the pre-run working-tree gate",
  },
  guard: {
    label: "Guard Rails",
    icon: "\u26A0",
    description: "Security boundaries: blocked paths, allowed commands, size limits",
  },
  general: {
    label: "General",
    icon: "\u2699",
    description: "Miscellaneous configuration settings",
  },
};

/** Display order. Exported for the same reason as {@link CATEGORY_META}. */
export const CATEGORY_ORDER = [
  "execution",
  "session",
  "task-selection",
  "retry",
  "prune",
  "test-gate",
  "git",
  "guard",
  "general",
];

// ── Helpers ──────────────────────────────────────────────────────────

export function formatDisplayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Parse a raw form value back to the proper typed value for a field.
 * Returns the coerced value or throws with a validation error.
 */
export function coerceFieldValue(field: ConfigField, rawValue: string): unknown {
  switch (field.type) {
    case "number": {
      const n = Number(rawValue);
      if (rawValue.trim() === "" || isNaN(n)) throw new Error(`${field.label} must be a valid number`);
      if (n < 0) throw new Error(`${field.label} must be non-negative`);
      return n;
    }
    case "boolean":
      return rawValue === "true";
    case "enum":
      if (field.enumValues && !field.enumValues.includes(rawValue)) {
        throw new Error(`${field.label} must be one of: ${field.enumValues.join(", ")}`);
      }
      return rawValue;
    case "array":
      return rawValue.split(",").map((s) => s.trim()).filter(Boolean);
    default:
      if (rawValue.trim() === "") throw new Error(`${field.label} must not be empty`);
      return rawValue;
  }
}

/**
 * Validate a field's raw string value.
 * Returns null if valid, or an error message string.
 */
export function validateField(field: ConfigField, rawValue: string): string | null {
  try {
    coerceFieldValue(field, rawValue);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Check if a raw edit value differs from the original field value. */
function isDirty(field: ConfigField, rawValue: string): boolean {
  return rawValue !== formatDisplayValue(field.value);
}

/** Compute impact text for a pending change (client-side preview). */
export function getPreviewImpact(field: ConfigField, rawValue: string): string {
  try {
    let value: unknown;
    switch (field.type) {
      case "number":
        value = Number(rawValue);
        if (isNaN(value as number)) return "";
        break;
      case "array":
        value = rawValue.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      default:
        value = rawValue;
    }

    switch (field.path) {
      case "maxTurns": {
        const n = Number(value);
        return `Agent will stop after ${n} turns (${n <= 10 ? "short" : n <= 30 ? "medium" : "long"} runs)`;
      }
      case "maxTokens":
        return `Each API response limited to ${Number(value).toLocaleString()} tokens`;
      case "tokenBudget":
        return Number(value) === 0
          ? "No token limit per run (unlimited)"
          : `Run will stop after ${Number(value).toLocaleString()} total tokens`;
      case "loopPauseMs":
        return `${Number(value) / 1000}s pause between consecutive task runs`;
      case "maxFailedAttempts":
        return `Tasks skipped as stuck after ${value} consecutive failures`;
      case "retry.maxRetries":
        return `Transient errors retried up to ${value} times`;
      case "retry.baseDelayMs":
        return `First retry after ${Number(value) / 1000}s, then exponential backoff`;
      case "retry.maxDelayMs":
        return `Retry delay capped at ${Number(value) / 1000}s`;
      case "guard.commandTimeout":
        return `Commands killed after ${Number(value) / 1000}s`;
      case "guard.maxFileSize":
        return `File write limit: ${(Number(value) / 1024 / 1024).toFixed(1)}MB`;
      case "guard.blockedPaths":
        return `${(value as string[]).length} blocked path patterns`;
      case "guard.allowedCommands":
        return `Allowed: ${(value as string[]).join(", ")}`;
      default:
        return "";
    }
  } catch {
    return "";
  }
}

// ── Tag list editor sub-component ───────────────────────────────────

function TagListEditor({ value, onChange, disabled }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [inputValue, setInputValue] = useState("");
  const tags = value.split(",").map((s) => s.trim()).filter(Boolean);

  const addTag = useCallback(() => {
    const tag = inputValue.trim();
    if (!tag) return;
    const updated = [...tags, tag];
    onChange(updated.join(", "));
    setInputValue("");
  }, [inputValue, tags, onChange]);

  const removeTag = useCallback((index: number) => {
    const updated = tags.filter((_, i) => i !== index);
    onChange(updated.join(", "));
  }, [tags, onChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    }
  }, [addTag]);

  return h("div", { class: "hench-config-tags" },
    h("div", { class: "hench-config-tag-list" },
      ...tags.map((tag, i) =>
        h("span", { key: `${tag}-${i}`, class: "hench-config-tag" },
          h("span", { class: "hench-config-tag-text" }, tag),
          !disabled
            ? h("button", {
                type: "button",
                class: "hench-config-tag-remove",
                onClick: () => removeTag(i),
                "aria-label": `Remove ${tag}`,
              }, "\u00D7")
            : null,
        ),
      ),
    ),
    !disabled
      ? h("div", { class: "hench-config-tag-input-row" },
          h("input", {
            type: "text",
            class: "hench-config-tag-input",
            value: inputValue,
            placeholder: "Add item...",
            onInput: (e: Event) => setInputValue((e.target as HTMLInputElement).value),
            onKeyDown: handleKeyDown,
          }),
          h("button", {
            type: "button",
            class: "hench-config-tag-add-btn",
            onClick: addTag,
            disabled: !inputValue.trim(),
          }, "Add"),
        )
      : null,
  );
}

// ── Field control component ─────────────────────────────────────────

function FieldControl({ field, value, onChange, error }: {
  field: ConfigField;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
}) {
  const inputClass = `hench-config-input${error ? " input-error" : ""}`;

  switch (field.type) {
    case "enum":
      return h("select", {
        class: `hench-config-select${error ? " input-error" : ""}`,
        value,
        onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
      },
        ...(field.enumValues ?? []).map((v) => h("option", { value: v, key: v }, v)),
      );

    case "number":
      return h("input", {
        class: inputClass,
        type: "number",
        value,
        min: "0",
        onInput: (e: Event) => onChange((e.target as HTMLInputElement).value),
      });

    case "boolean":
      return h("label", { class: "hench-config-toggle" },
        h("input", {
          type: "checkbox",
          checked: value === "true",
          onChange: (e: Event) => onChange(String((e.target as HTMLInputElement).checked)),
        }),
        h("span", { class: "hench-config-toggle-slider" }),
        h("span", { class: "hench-config-toggle-label" }, value === "true" ? "Enabled" : "Disabled"),
      );

    case "array":
      return h(TagListEditor, { value, onChange });

    default: // string
      return h("input", {
        class: inputClass,
        type: "text",
        value,
        onInput: (e: Event) => onChange((e.target as HTMLInputElement).value),
      });
  }
}

// ── Field editor component ──────────────────────────────────────────

function FieldEditor({ field, editValue, error, onFieldChange }: {
  field: ConfigField;
  editValue: string;
  error: string | null;
  onFieldChange: (path: string, rawValue: string) => void;
}) {
  const dirty = isDirty(field, editValue);
  const previewImpact = dirty ? getPreviewImpact(field, editValue) : null;

  const handleChange = useCallback((rawValue: string) => {
    onFieldChange(field.path, rawValue);
  }, [field.path, onFieldChange]);

  const handleReset = useCallback(() => {
    onFieldChange(field.path, formatDisplayValue(field.value));
  }, [field.path, field.value, onFieldChange]);

  return h("div", { class: `hench-config-field${!field.isDefault ? " modified" : ""}${dirty ? " dirty" : ""}` },
    h("div", { class: "hench-config-field-header" },
      h("div", { class: "hench-config-field-label" },
        h("span", { class: "hench-config-field-name" }, field.label),
        !field.isDefault ? h("span", { class: "hench-config-modified-badge" }, "modified") : null,
        dirty ? h("span", { class: "hench-config-dirty-badge" }, "unsaved") : null,
      ),
      h("div", { class: "hench-config-field-actions" },
        h("span", { class: "hench-config-field-path" }, field.path),
        dirty
          ? h("button", {
              type: "button",
              class: "hench-config-reset-btn",
              onClick: handleReset,
              title: "Revert to current saved value",
            }, "Revert")
          : null,
      ),
    ),
    h("p", { class: "hench-config-field-desc" }, field.description),

    // Form control
    h("div", { class: "hench-config-control-row" },
      h(FieldControl, { field, value: editValue, onChange: handleChange, error }),
    ),

    // Impact preview or current impact
    (dirty && previewImpact)
      ? h("div", { class: "hench-config-preview" },
          h("span", { class: "hench-config-preview-label" }, "Impact: "),
          h("span", null, previewImpact),
        )
      : h("div", { class: "hench-config-impact" },
          h("span", null, field.impact),
        ),

    // Validation error
    error
      ? h("div", { class: "hench-config-error" }, error)
      : null,
  );
}

// ── Category section ─────────────────────────────────────────────────

function CategorySection({ category, fields, editValues, errors, onFieldChange, lead }: {
  category: string;
  fields: ConfigField[];
  editValues: Record<string, string>;
  errors: Record<string, string | null>;
  onFieldChange: (path: string, rawValue: string) => void;
  /** Rendered ahead of the fields — the Robot Wrangler link, in place of provider and model. */
  lead?: ComponentChildren;
}) {
  const meta = CATEGORY_META[category] ?? { label: category, icon: "\u2022", description: "" };

  return h("div", { class: "hench-config-category" },
    h("div", { class: "hench-config-category-header" },
      h("span", { class: "hench-config-category-icon" }, meta.icon),
      h("div", null,
        h("h3", { class: "hench-config-category-title" }, meta.label),
        h("p", { class: "hench-config-category-desc" }, meta.description),
        category === "guard" ? h(GlossaryLine, { term: "guard rail" }) : null,
      ),
    ),
    h("div", { class: "hench-config-fields" },
      lead ?? null,
      ...fields.map((field) =>
        h(FieldEditor, {
          key: field.path,
          field,
          editValue: editValues[field.path] ?? formatDisplayValue(field.value),
          error: errors[field.path] ?? null,
          onFieldChange,
        }),
      ),
    ),
  );
}

// ── Form state ───────────────────────────────────────────────────────

/** State and actions of the work-settings form. The Workflow page owns it. */
export interface HenchConfigForm {
  /** Loaded fields, or null before the first successful load. */
  data: ConfigResponse | null;
  loading: boolean;
  /** Why the config could not be loaded. */
  loadError: string | null;
  /** Why the last save failed. Cleared by the next save or a discard. */
  saveError: string | null;
  editValues: Record<string, string>;
  fieldErrors: Record<string, string | null>;
  /** True while any field differs from its saved value. */
  dirty: boolean;
  onFieldChange: (path: string, rawValue: string) => void;
  /**
   * PUT the dirty fields to /api/hench/config. Resolves true once saved (or
   * when nothing is dirty); false leaves the edits in place with `saveError` set.
   */
  save: () => Promise<boolean>;
  /** Drop every edit. */
  discard: () => void;
  /** Re-read the saved config, dropping edits — used after a template is applied. */
  reload: () => Promise<void>;
}

export function useHenchConfigForm(): HenchConfigForm {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Maps field path → current raw string value in the form.
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/config");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setLoadError((body as { error?: string }).error ?? "Failed to load configuration");
        return;
      }
      setData(await res.json() as ConfigResponse);
      setLoadError(null);
      setEditValues({});
      setFieldErrors({});
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onFieldChange = useCallback((path: string, rawValue: string) => {
    setEditValues((prev) => ({ ...prev, [path]: rawValue }));
    const field = data?.fields.find((f) => f.path === path);
    if (field) setFieldErrors((prev) => ({ ...prev, [path]: validateField(field, rawValue) }));
  }, [data]);

  const dirtyFields = useMemo(() => {
    if (!data) return [];
    return data.fields.filter((f) => {
      const raw = editValues[f.path];
      return raw !== undefined && isDirty(f, raw);
    });
  }, [data, editValues]);

  const save = useCallback(async (): Promise<boolean> => {
    if (dirtyFields.length === 0) return true;
    setSaveError(null);

    const changes: Record<string, unknown> = {};
    for (const field of dirtyFields) {
      const raw = editValues[field.path] ?? formatDisplayValue(field.value);
      const invalid = validateField(field, raw);
      if (invalid) {
        setSaveError(invalid);
        return false;
      }
      changes[field.path] = coerceFieldValue(field, raw);
    }

    try {
      const res = await fetch("/api/hench/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveError((body as { error?: string }).error ?? "Save failed");
        return false;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    }
    // Re-read so `isDefault`, `impact` and the values reflect what was written.
    await reload();
    return true;
  }, [dirtyFields, editValues, reload]);

  const discard = useCallback(() => {
    setEditValues({});
    setFieldErrors({});
    setSaveError(null);
  }, []);

  return {
    data,
    loading,
    loadError,
    saveError,
    editValues,
    fieldErrors,
    dirty: dirtyFields.length > 0,
    onFieldChange,
    save,
    discard,
    reload,
  };
}

// ── Section ──────────────────────────────────────────────────────────

/**
 * The work-settings form. `robotWranglerLink` is rendered where provider and
 * model would be — at the head of their category.
 */
export function HenchConfigSection({ form, robotWranglerLink }: {
  form: HenchConfigForm;
  robotWranglerLink: ComponentChildren;
}) {
  const { data } = form;

  if (form.loading) {
    return h("div", { class: "hench-config-container" },
      h("div", { class: "loading" }, "Loading work settings..."),
    );
  }

  if (!data) {
    return h("div", { class: "hench-config-container" },
      h("div", { class: "hench-config-error-state" },
        h("p", null, form.loadError ?? "Failed to load configuration"),
        // Deliberately names the command rather than the directory: where
        // hench keeps its state depends on the project's layout, and the
        // viewer runs in a browser with no resolver to ask. Naming `.hench/`
        // here sent operators on the new layout looking for a directory they
        // do not have.
        h("p", { class: "hench-config-error-hint" },
          "Make sure hench is initialized for this project. Run ",
          h("code", null, "hench init"),
          " to create its state directory.",
        ),
      ),
    );
  }

  // Group fields by category. A category whose only fields are the ones Robot
  // Wrangler owns still gets a section, so the link has somewhere to sit.
  const byCategory = new Map<string, ConfigField[]>();
  let linkCategory: string | null = null;
  for (const field of data.fields) {
    if (!byCategory.has(field.category)) byCategory.set(field.category, []);
    if (ROBOT_WRANGLER_FIELDS.has(field.path)) {
      linkCategory ??= field.category;
      continue;
    }
    byCategory.get(field.category)!.push(field);
  }

  const modifiedCount = data.fields
    .filter((f) => !f.isDefault && !ROBOT_WRANGLER_FIELDS.has(f.path)).length;

  return h("div", { class: "hench-config-container" },
    modifiedCount > 0
      ? h("p", { class: "hench-config-modified-count" },
          `${modifiedCount} field${modifiedCount > 1 ? "s differ" : " differs"} from defaults`,
        )
      : null,

    form.saveError
      ? h("div", { class: "hench-config-save-error" }, form.saveError)
      : null,

    // Any category the server sends that CATEGORY_ORDER does not name is
    // appended rather than dropped. Filtering to the known list alone is how a
    // whole group of settings can disappear from this page while the server
    // still serves it — which is what happened when the field list grew and
    // this array did not. CategorySection already falls back to the raw
    // category name for its heading.
    ...[...CATEGORY_ORDER, ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c))]
      .filter((cat) => (byCategory.get(cat)?.length ?? 0) > 0 || cat === linkCategory)
      .map((cat) =>
        h(CategorySection, {
          key: cat,
          category: cat,
          fields: byCategory.get(cat)!,
          editValues: form.editValues,
          errors: form.fieldErrors,
          onFieldChange: form.onFieldChange,
          lead: cat === linkCategory ? robotWranglerLink : null,
        }),
      ),
  );
}


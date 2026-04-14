/**
 * Hench Config view — workflow configuration form editor.
 *
 * Displays current hench configuration in an editable form with proper
 * form controls (dropdowns, number inputs, toggles, tag lists). Shows
 * a real-time impact preview for pending changes, validates client-side,
 * and supports batch saving all changes at once.
 *
 * Data comes from GET /api/hench/config (read) and
 * PUT /api/hench/config (update).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

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

interface AppliedChange {
  path: string;
  oldValue: unknown;
  newValue: unknown;
  impact: string;
}

// ── Category metadata ────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: string; description: string }> = {
  execution: {
    label: "Execution Strategy",
    icon: "\u25B6",
    description: "Controls how the agent runs: model selection, turn limits, and token budgets",
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

const CATEGORY_ORDER = ["execution", "task-selection", "retry", "guard", "general"];

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
      case "provider":
        return value === "cli"
          ? "Agent will use Claude Code CLI"
          : "Agent will call Anthropic API directly";
      case "model":
        return `Agent will use model "${value}"`;
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

function CategorySection({ category, fields, editValues, errors, onFieldChange }: {
  category: string;
  fields: ConfigField[];
  editValues: Record<string, string>;
  errors: Record<string, string | null>;
  onFieldChange: (path: string, rawValue: string) => void;
}) {
  const meta = CATEGORY_META[category] ?? { label: category, icon: "\u2022", description: "" };

  return h("div", { class: "hench-config-category" },
    h("div", { class: "hench-config-category-header" },
      h("span", { class: "hench-config-category-icon" }, meta.icon),
      h("div", null,
        h("h3", { class: "hench-config-category-title" }, meta.label),
        h("p", { class: "hench-config-category-desc" }, meta.description),
      ),
    ),
    h("div", { class: "hench-config-fields" },
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

// ── Changes summary panel ────────────────────────────────────────────

function ChangesSummary({ pendingChanges, onSave, onDiscard, saving }: {
  pendingChanges: Array<{ path: string; label: string; oldDisplay: string; newDisplay: string; impact: string }>;
  onSave: () => void;
  onDiscard: () => void;
  saving: boolean;
}) {
  if (pendingChanges.length === 0) return null;

  return h("div", { class: "hench-config-changes-panel" },
    h("div", { class: "hench-config-changes-header" },
      h("span", { class: "hench-config-changes-title" },
        `${pendingChanges.length} unsaved change${pendingChanges.length > 1 ? "s" : ""}`,
      ),
    ),
    h("div", { class: "hench-config-changes-list" },
      ...pendingChanges.map((change) =>
        h("div", { key: change.path, class: "hench-config-change-item" },
          h("div", { class: "hench-config-change-label" }, change.label),
          h("div", { class: "hench-config-change-diff" },
            h("span", { class: "hench-config-change-old" }, change.oldDisplay || "(empty)"),
            h("span", { class: "hench-config-change-arrow" }, "\u2192"),
            h("span", { class: "hench-config-change-new" }, change.newDisplay || "(empty)"),
          ),
          h("div", { class: "hench-config-change-impact" }, change.impact),
        ),
      ),
    ),
    h("div", { class: "hench-config-changes-actions" },
      h("button", {
        type: "button",
        class: "hench-config-discard-btn",
        onClick: onDiscard,
        disabled: saving,
      }, "Discard All"),
      h("button", {
        type: "button",
        class: "hench-config-save-all-btn",
        onClick: onSave,
        disabled: saving,
      }, saving ? "Saving..." : "Save All Changes"),
    ),
  );
}

// ── Toast notification ───────────────────────────────────────────────

function SaveToast({ changes }: { changes: AppliedChange[] }) {
  if (changes.length === 0) return null;

  return h("div", { class: "hench-config-toast" },
    h("span", { class: "hench-config-toast-icon" }, "\u2714"),
    h("span", null, `Saved ${changes.length} change${changes.length > 1 ? "s" : ""}`),
  );
}

// ── Main view ────────────────────────────────────────────────────────

export function HenchConfigView() {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentChanges, setRecentChanges] = useState<AppliedChange[]>([]);
  const [saving, setSaving] = useState(false);

  // Edit state: maps field path → current raw string value in form
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  // Validation errors per field
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | null>>({});

  // Track toast timeout so we can clean up
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/config");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load configuration");
        return;
      }
      const json = await res.json() as ConfigResponse;
      setData(json);
      setError(null);
      // Reset edit state to match loaded values
      setEditValues({});
      setFieldErrors({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Clean up toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleFieldChange = useCallback((path: string, rawValue: string) => {
    setEditValues((prev) => ({ ...prev, [path]: rawValue }));
    // Validate on change
    if (data) {
      const field = data.fields.find((f) => f.path === path);
      if (field) {
        const err = validateField(field, rawValue);
        setFieldErrors((prev) => ({ ...prev, [path]: err }));
      }
    }
  }, [data]);

  // Compute pending changes
  const pendingChanges = useMemo(() => {
    if (!data) return [];
    const changes: Array<{ path: string; label: string; oldDisplay: string; newDisplay: string; impact: string }> = [];
    for (const field of data.fields) {
      const rawValue = editValues[field.path];
      if (rawValue !== undefined && isDirty(field, rawValue)) {
        changes.push({
          path: field.path,
          label: field.label,
          oldDisplay: formatDisplayValue(field.value),
          newDisplay: rawValue,
          impact: getPreviewImpact(field, rawValue),
        });
      }
    }
    return changes;
  }, [data, editValues]);

  // Check if all pending changes are valid
  const hasValidationErrors = useMemo(() => {
    if (!data) return false;
    for (const change of pendingChanges) {
      const field = data.fields.find((f) => f.path === change.path);
      if (field) {
        const err = validateField(field, editValues[field.path] ?? formatDisplayValue(field.value));
        if (err) return true;
      }
    }
    return false;
  }, [data, pendingChanges, editValues]);

  const handleSaveAll = useCallback(async () => {
    if (!data || pendingChanges.length === 0 || hasValidationErrors) return;

    setSaving(true);
    setError(null);

    try {
      // Coerce all values
      const changes: Record<string, unknown> = {};
      for (const change of pendingChanges) {
        const field = data.fields.find((f) => f.path === change.path);
        if (field) {
          changes[field.path] = coerceFieldValue(field, editValues[field.path] ?? formatDisplayValue(field.value));
        }
      }

      const res = await fetch("/api/hench/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setError((body as { error?: string }).error ?? "Save failed");
        return;
      }

      const result = await res.json() as { applied: AppliedChange[] };

      // Show toast
      setRecentChanges(result.applied);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setRecentChanges([]), 3000);

      // Refresh config (this also clears edit state)
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [data, pendingChanges, hasValidationErrors, editValues, fetchConfig]);

  const handleDiscard = useCallback(() => {
    setEditValues({});
    setFieldErrors({});
  }, []);

  if (loading) {
    return h("div", { class: "hench-config-container" },
      h("div", { class: "loading" }, "Loading configuration..."),
    );
  }

  if (error && !data) {
    return h("div", { class: "hench-config-container" },
      h(BrandedHeader, { product: "hench", title: "Workflow Configuration" }),
      h("div", { class: "hench-config-error-state" },
        h("p", null, error),
        h("p", { class: "hench-config-error-hint" },
          "Make sure ",
          h("code", null, ".hench/"),
          " exists. Run ",
          h("code", null, "hench init"),
          " to create it.",
        ),
      ),
    );
  }

  if (!data) return null;

  // Group fields by category
  const byCategory = new Map<string, ConfigField[]>();
  for (const field of data.fields) {
    if (!byCategory.has(field.category)) {
      byCategory.set(field.category, []);
    }
    byCategory.get(field.category)!.push(field);
  }

  const modifiedCount = data.fields.filter((f) => !f.isDefault).length;

  return h("div", { class: "hench-config-container" },
    h("div", { class: "hench-config-header" },
      h(BrandedHeader, { product: "hench", title: "Workflow Configuration" }),
      modifiedCount > 0
        ? h("span", { class: "hench-config-modified-count" },
            `${modifiedCount} field${modifiedCount > 1 ? "s differ" : " differs"} from defaults`,
          )
        : null,
    ),

    // Save error banner
    error
      ? h("div", { class: "hench-config-save-error" }, error)
      : null,

    // Changes summary + save bar (sticky at top when there are changes)
    h(ChangesSummary, {
      pendingChanges,
      onSave: handleSaveAll,
      onDiscard: handleDiscard,
      saving,
    }),

    ...CATEGORY_ORDER
      .filter((cat) => byCategory.has(cat))
      .map((cat) =>
        h(CategorySection, {
          key: cat,
          category: cat,
          fields: byCategory.get(cat)!,
          editValues,
          errors: fieldErrors,
          onFieldChange: handleFieldChange,
        }),
      ),
    h(SaveToast, { changes: recentChanges }),
  );
}

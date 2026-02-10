/**
 * Hench Config view — workflow configuration editor.
 *
 * Displays current hench configuration in an editable form grouped
 * by category. Each field shows its current value, description,
 * and a real-time impact preview when changed.
 *
 * Data comes from GET /api/hench/config (read) and
 * PUT /api/hench/config (update).
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { BrandedHeader } from "../components/logos.js";

// ── Types ────────────────────────────────────────────────────────────

interface ConfigField {
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

function formatDisplayValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

// ── Field editor component ──────────────────────────────────────────

function FieldEditor({ field, onSave }: {
  field: ConfigField;
  onSave: (path: string, value: unknown) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = useCallback(() => {
    setEditValue(formatDisplayValue(field.value));
    setEditing(true);
    setError(null);
  }, [field.value]);

  const cancel = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      let coerced: unknown;
      switch (field.type) {
        case "number":
          coerced = Number(editValue);
          if (isNaN(coerced as number)) {
            setError("Must be a number");
            setSaving(false);
            return;
          }
          break;
        case "boolean":
          coerced = editValue === "true";
          break;
        case "array":
          coerced = editValue.split(",").map((s) => s.trim()).filter(Boolean);
          break;
        default:
          coerced = editValue;
      }
      await onSave(field.path, coerced);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [editValue, field, onSave]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancel();
  }, [save, cancel]);

  // Impact preview for pending change
  const pendingImpact = editing ? getPreviewImpact(field, editValue) : null;
  const valueChanged = editing && editValue !== formatDisplayValue(field.value);

  return h("div", { class: `hench-config-field${!field.isDefault ? " modified" : ""}` },
    h("div", { class: "hench-config-field-header" },
      h("div", { class: "hench-config-field-label" },
        h("span", { class: "hench-config-field-name" }, field.label),
        !field.isDefault ? h("span", { class: "hench-config-modified-badge" }, "modified") : null,
      ),
      h("span", { class: "hench-config-field-path" }, field.path),
    ),
    h("p", { class: "hench-config-field-desc" }, field.description),

    editing
      ? h("div", { class: "hench-config-edit-row" },
          field.type === "enum" && field.enumValues
            ? h("select", {
                class: "hench-config-select",
                value: editValue,
                onChange: (e: Event) => setEditValue((e.target as HTMLSelectElement).value),
                disabled: saving,
              },
                ...field.enumValues.map((v) => h("option", { value: v }, v)),
              )
            : h("input", {
                class: "hench-config-input",
                type: field.type === "number" ? "number" : "text",
                value: editValue,
                onInput: (e: Event) => setEditValue((e.target as HTMLInputElement).value),
                onKeyDown: handleKeyDown,
                disabled: saving,
                autofocus: true,
              }),
          h("button", {
            class: "hench-config-save-btn",
            onClick: save,
            disabled: saving || !valueChanged,
          }, saving ? "Saving..." : "Save"),
          h("button", {
            class: "hench-config-cancel-btn",
            onClick: cancel,
            disabled: saving,
          }, "Cancel"),
        )
      : h("div", { class: "hench-config-value-row" },
          h("span", { class: "hench-config-value" }, formatDisplayValue(field.value)),
          h("button", {
            class: "hench-config-edit-btn",
            onClick: startEditing,
          }, "Edit"),
        ),

    // Impact preview
    (editing && pendingImpact && valueChanged)
      ? h("div", { class: "hench-config-preview" },
          h("span", { class: "hench-config-preview-label" }, "Impact: "),
          h("span", null, pendingImpact),
        )
      : h("div", { class: "hench-config-impact" },
          h("span", null, field.impact),
        ),

    error
      ? h("div", { class: "hench-config-error" }, error)
      : null,
  );
}

/** Compute impact text for a pending change (client-side preview). */
function getPreviewImpact(field: ConfigField, rawValue: string): string {
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

    // Simple impact descriptions
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

// ── Category section ─────────────────────────────────────────────────

function CategorySection({ category, fields, onSave }: {
  category: string;
  fields: ConfigField[];
  onSave: (path: string, value: unknown) => Promise<void>;
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
        h(FieldEditor, { key: field.path, field, onSave }),
      ),
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = useCallback(async (path: string, value: unknown) => {
    const res = await fetch("/api/hench/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes: { [path]: value } }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Save failed" }));
      throw new Error((body as { error?: string }).error ?? "Save failed");
    }

    const result = await res.json() as { applied: AppliedChange[] };

    // Show toast
    setRecentChanges(result.applied);
    setTimeout(() => setRecentChanges([]), 3000);

    // Refresh config
    await fetchConfig();
  }, [fetchConfig]);

  if (loading) {
    return h("div", { class: "hench-config-container" },
      h("div", { class: "loading" }, "Loading configuration..."),
    );
  }

  if (error) {
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
    ...CATEGORY_ORDER
      .filter((cat) => byCategory.has(cat))
      .map((cat) =>
        h(CategorySection, {
          key: cat,
          category: cat,
          fields: byCategory.get(cat)!,
          onSave: handleSave,
        }),
      ),
    h(SaveToast, { changes: recentChanges }),
  );
}

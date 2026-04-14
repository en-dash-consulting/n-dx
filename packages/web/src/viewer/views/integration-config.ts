/**
 * Generic Integration Configuration view — dynamic form generation
 * based on integration schemas.
 *
 * This view lists all available integrations and generates configuration
 * forms dynamically from their schema definitions. It replaces the need
 * for per-integration hardcoded configuration views (though existing
 * views like NotionConfigView continue to work for backward compatibility).
 *
 * Data comes from:
 *   GET    /api/integrations                — list available integrations
 *   GET    /api/integrations/:id/schema     — get schema for one integration
 *   GET    /api/integrations/:id/config     — current config (masked)
 *   PUT    /api/integrations/:id/config     — save credentials
 *   DELETE /api/integrations/:id/config     — remove config
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback, useRef, useMemo } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

// ── Types (duplicated from rex for browser context) ──────────────────

interface FieldValidationRule {
  type: "pattern" | "minLength" | "maxLength" | "min" | "max" | "custom";
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  validator?: string;
  message: string;
}

interface FieldSelectOption {
  label: string;
  value: string;
  description?: string;
}

interface IntegrationFieldSchema {
  required: boolean;
  description: string;
  sensitive?: boolean;
  label?: string;
  inputType?: string;
  placeholder?: string;
  helpText?: string;
  docUrl?: string;
  docLabel?: string;
  defaultValue?: string | number | boolean;
  validationRules?: FieldValidationRule[];
  options?: FieldSelectOption[];
  group?: string;
  order?: number;
}

interface IntegrationFieldGroup {
  label: string;
  icon?: string;
  order?: number;
  description?: string;
}

interface IntegrationSchema {
  id: string;
  name: string;
  description: string;
  icon?: string;
  docsUrl?: string;
  setupGuide?: string[];
  fields: Record<string, IntegrationFieldSchema>;
  groups?: Record<string, IntegrationFieldGroup>;
  supportsConnectionTest?: boolean;
  supportsSchemaValidation?: boolean;
  builtIn?: boolean;
}

interface IntegrationConfig {
  configured: boolean;
  integration: string;
  values: Record<string, unknown>;
  masked: Record<string, string>;
  envVars: Record<string, string>;
}

// ── Client-side validation ───────────────────────────────────────────

function validateFieldValue(
  value: unknown,
  schema: IntegrationFieldSchema,
): string | null {
  const strValue = value === undefined || value === null ? "" : String(value);

  // Required check
  if (schema.required && strValue.trim().length === 0) {
    return `${schema.label ?? "This field"} is required`;
  }

  // Skip further validation for empty optional fields
  if (strValue.trim().length === 0) return null;

  if (!schema.validationRules) return null;

  for (const rule of schema.validationRules) {
    switch (rule.type) {
      case "pattern":
        if (rule.pattern && !new RegExp(rule.pattern).test(strValue)) {
          return rule.message;
        }
        break;
      case "minLength":
        if (rule.minLength !== undefined && strValue.length < rule.minLength) {
          return rule.message;
        }
        break;
      case "maxLength":
        if (rule.maxLength !== undefined && strValue.length > rule.maxLength) {
          return rule.message;
        }
        break;
      case "min":
        if (rule.min !== undefined && Number(value) < rule.min) {
          return rule.message;
        }
        break;
      case "max":
        if (rule.max !== undefined && Number(value) > rule.max) {
          return rule.message;
        }
        break;
    }
  }

  return null;
}

// ── Organize fields by group ─────────────────────────────────────────

interface GroupedFields {
  groupKey: string | null;
  group: IntegrationFieldGroup | null;
  fields: Array<{ key: string; schema: IntegrationFieldSchema }>;
}

function groupFields(schema: IntegrationSchema): GroupedFields[] {
  const grouped = new Map<string | null, Array<{ key: string; schema: IntegrationFieldSchema }>>();

  for (const [key, field] of Object.entries(schema.fields)) {
    const groupKey = field.group ?? null;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey)!.push({ key, schema: field });
  }

  // Sort fields within each group by order
  for (const fields of grouped.values()) {
    fields.sort((a, b) => (a.schema.order ?? 999) - (b.schema.order ?? 999));
  }

  // Build result sorted by group order
  const result: GroupedFields[] = [];

  // Get sorted group keys
  const groupKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === null) return 1; // ungrouped fields go last
    if (b === null) return -1;
    const ga = schema.groups?.[a];
    const gb = schema.groups?.[b];
    return (ga?.order ?? 999) - (gb?.order ?? 999);
  });

  for (const groupKey of groupKeys) {
    result.push({
      groupKey,
      group: groupKey ? (schema.groups?.[groupKey] ?? null) : null,
      fields: grouped.get(groupKey) ?? [],
    });
  }

  return result;
}

// ── Dynamic form field component ─────────────────────────────────────

function DynamicField({
  fieldKey,
  schema,
  value,
  error,
  configured,
  masked,
  onInput,
}: {
  fieldKey: string;
  schema: IntegrationFieldSchema;
  value: unknown;
  error: string | undefined;
  configured: boolean;
  masked: string | undefined;
  onInput: (key: string, value: unknown) => void;
}) {
  const [visible, setVisible] = useState(false);
  const inputType = schema.inputType ?? "text";
  const strValue = value === undefined || value === null ? "" : String(value);
  const hasError = !!error;

  const handleInput = useCallback((e: Event) => {
    const target = e.target as HTMLInputElement;
    if (inputType === "checkbox") {
      onInput(fieldKey, target.checked);
    } else {
      onInput(fieldKey, target.value);
    }
  }, [fieldKey, inputType, onInput]);

  const handleSelect = useCallback((e: Event) => {
    onInput(fieldKey, (e.target as HTMLSelectElement).value);
  }, [fieldKey, onInput]);

  return h("div", {
    class: `intg-field${hasError ? " intg-field-error" : ""}`,
  },
    // Label
    h("label", { class: "intg-field-label" },
      schema.label ?? fieldKey,
      configured && (schema.sensitive ? masked : undefined)
        ? h("span", { class: "intg-field-badge" }, "configured")
        : null,
      schema.required
        ? h("span", { class: "intg-field-required" }, "*")
        : null,
    ),

    // Help text
    schema.helpText
      ? h("p", { class: "intg-field-help" },
          schema.helpText,
          schema.docUrl
            ? h(Fragment, null,
                " ",
                h("a", {
                  href: schema.docUrl,
                  target: "_blank",
                  rel: "noopener noreferrer",
                  class: "intg-field-doc-link",
                }, schema.docLabel ?? "Learn more"),
              )
            : null,
        )
      : null,

    // Input element
    inputType === "checkbox"
      ? h("label", { class: "intg-checkbox-wrapper" },
          h("input", {
            type: "checkbox",
            checked: value === true || value === "true",
            onChange: handleInput,
          }),
          h("span", { class: "intg-checkbox-label" }, schema.description),
        )
      : inputType === "select"
        ? h("select", {
            class: "intg-input intg-select",
            value: strValue || (schema.defaultValue !== undefined ? String(schema.defaultValue) : ""),
            onChange: handleSelect,
          },
            h("option", { value: "" }, "— Select —"),
            (schema.options ?? []).map((opt) =>
              h("option", { key: opt.value, value: opt.value, title: opt.description }, opt.label),
            ),
          )
        : inputType === "textarea"
          ? h("textarea", {
              class: "intg-input intg-textarea",
              value: strValue,
              placeholder: configured && masked
                ? `Current: ${masked}`
                : (schema.placeholder ?? ""),
              onInput: handleInput,
              rows: 4,
            })
          : inputType === "password"
            ? h("div", { class: "intg-input-row" },
                h("input", {
                  type: visible ? "text" : "password",
                  class: "intg-input",
                  value: strValue,
                  placeholder: configured && masked
                    ? `Current: ${masked}`
                    : (schema.placeholder ?? ""),
                  onInput: handleInput,
                  autocomplete: "off",
                  spellcheck: false,
                }),
                h("button", {
                  type: "button",
                  class: "intg-toggle-vis",
                  onClick: () => setVisible(!visible),
                  title: visible ? "Hide" : "Show",
                  "aria-label": visible ? "Hide value" : "Show value",
                }, visible ? "\u{1F441}" : "\u{1F441}\u200D\u{1F5E8}"),
              )
            : h("input", {
                type: inputType,
                class: "intg-input",
                value: strValue,
                placeholder: configured && masked
                  ? `Current: ${masked}`
                  : (schema.placeholder ?? ""),
                onInput: handleInput,
                autocomplete: "off",
                spellcheck: false,
              }),

    // Error message
    hasError
      ? h("div", { class: "intg-field-error-text" }, error)
      : null,
  );
}

// ── Integration detail view (config form) ────────────────────────────

function IntegrationDetail({
  schema,
  onBack,
}: {
  schema: IntegrationSchema;
  onBack: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<IntegrationConfig | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const groupedFields = useMemo(() => groupFields(schema), [schema]);

  // ── Fetch current config ────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/integrations/${schema.id}/config`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load configuration");
        return;
      }
      const data = await res.json() as IntegrationConfig;
      setConfig(data);
      setError(null);

      // Initialize form with existing non-sensitive values
      if (data.configured) {
        setFormValues({ ...data.values });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setLoading(false);
    }
  }, [schema.id]);

  useEffect(() => {
    fetchConfig();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [fetchConfig]);

  // ── Field change handler ────────────────────────────────────────────

  const handleFieldInput = useCallback((key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    const fieldSchema = schema.fields[key];
    if (fieldSchema) {
      const strVal = value === undefined || value === null ? "" : String(value);
      if (strVal.trim().length > 0) {
        const err = validateFieldValue(value, fieldSchema);
        setFieldErrors((prev) => {
          const next = { ...prev };
          if (err) next[key] = err;
          else delete next[key];
          return next;
        });
      } else {
        setFieldErrors((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    }
  }, [schema.fields]);

  // ── Save handler ────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    // Validate all non-empty fields
    const errors: Record<string, string> = {};
    const payload: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(formValues)) {
      const strVal = val === undefined || val === null ? "" : String(val);
      if (strVal.trim().length > 0) {
        const fieldSchema = schema.fields[key];
        if (fieldSchema) {
          const err = validateFieldValue(val, fieldSchema);
          if (err) errors[key] = err;
          else payload[key] = val;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    if (Object.keys(payload).length === 0) {
      setError("Enter at least one field to save");
      return;
    }

    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const res = await fetch(`/api/integrations/${schema.id}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        if ((body as { errors?: Record<string, string> }).errors) {
          setFieldErrors((body as { errors: Record<string, string> }).errors);
        } else {
          setError((body as { error?: string }).error ?? "Save failed");
        }
        return;
      }

      setSaveSuccess(true);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveSuccess(false), 3000);

      // Clear sensitive fields from form
      setFormValues((prev) => {
        const next = { ...prev };
        for (const [key, fieldSchema] of Object.entries(schema.fields)) {
          if (fieldSchema.sensitive) delete next[key];
        }
        return next;
      });

      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [formValues, schema, fetchConfig]);

  // ── Remove handler ──────────────────────────────────────────────────

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    try {
      const res = await fetch(`/api/integrations/${schema.id}/config`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Remove failed" }));
        setError((body as { error?: string }).error ?? "Remove failed");
        return;
      }
      setFormValues({});
      setConfirmRemove(false);
      await fetchConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }, [schema.id, fetchConfig]);

  // ── Check if form has values ────────────────────────────────────────

  const hasValues = Object.entries(formValues).some(([, v]) => {
    const s = v === undefined || v === null ? "" : String(v);
    return s.trim().length > 0;
  });

  const isConfigured = config?.configured ?? false;

  // ── Render ──────────────────────────────────────────────────────────

  if (loading) {
    return h("div", { class: "intg-container" },
      h("div", { class: "loading" }, `Loading ${schema.name} configuration...`),
    );
  }

  return h("div", { class: "intg-container" },
    // ── Back button ──────────────────────────────────────────────────
    h("button", {
      type: "button",
      class: "intg-back-btn",
      onClick: onBack,
    }, "\u2190 All Integrations"),

    // ── Header ──────────────────────────────────────────────────────
    h("div", { class: "intg-header" },
      h(BrandedHeader, { product: "rex", title: `${schema.name} Integration` }),
      h("p", { class: "intg-subtitle" }, schema.description),
    ),

    // ── Error banner ─────────────────────────────────────────────────
    error
      ? h("div", { class: "intg-error-banner" }, error)
      : null,

    // ── Save success toast ───────────────────────────────────────────
    saveSuccess
      ? h("div", { class: "intg-toast" },
          h("span", { class: "intg-toast-icon" }, "\u2714"),
          "Configuration saved",
        )
      : null,

    // ── Form fields grouped ──────────────────────────────────────────
    groupedFields.map(({ groupKey, group, fields }) =>
      h("div", { key: groupKey ?? "__ungrouped", class: "intg-section" },
        group
          ? h("h3", { class: "intg-section-title" },
              group.icon ? h("span", { class: "intg-section-icon" }, group.icon) : null,
              group.label,
            )
          : null,
        group?.description
          ? h("p", { class: "intg-section-desc" }, group.description)
          : null,
        fields.map(({ key, schema: fieldSchema }) =>
          h(DynamicField, {
            key,
            fieldKey: key,
            schema: fieldSchema,
            value: formValues[key],
            error: fieldErrors[key],
            configured: isConfigured,
            masked: config?.masked[key],
            onInput: handleFieldInput,
          }),
        ),
      ),
    ),

    // ── Actions ──────────────────────────────────────────────────────
    h("div", { class: "intg-actions" },
      h("div", { class: "intg-actions-primary" },
        h("button", {
          type: "button",
          class: "intg-save-btn",
          onClick: handleSave,
          disabled: saving || !hasValues,
        }, saving ? "Saving..." : "Save Configuration"),
      ),
      isConfigured
        ? h("div", { class: "intg-actions-danger" },
            confirmRemove
              ? h(Fragment, null,
                  h("span", { class: "intg-confirm-text" }, `Remove ${schema.name} config?`),
                  h("button", {
                    type: "button",
                    class: "intg-confirm-yes",
                    onClick: handleRemove,
                    disabled: removing,
                  }, removing ? "Removing..." : "Yes, Remove"),
                  h("button", {
                    type: "button",
                    class: "intg-confirm-no",
                    onClick: () => setConfirmRemove(false),
                  }, "Cancel"),
                )
              : h("button", {
                  type: "button",
                  class: "intg-remove-btn",
                  onClick: () => setConfirmRemove(true),
                }, "Remove Configuration"),
          )
        : null,
    ),

    // ── Environment variable hints ───────────────────────────────────
    isConfigured && Object.keys(config?.envVars ?? {}).length > 0
      ? h("div", { class: "intg-section" },
          h("div", { class: "intg-env-hint" },
            h("span", { class: "intg-env-hint-icon" }, "\u{1F512}"),
            h("div", { class: "intg-env-hint-content" },
              h("p", { class: "intg-env-hint-title" }, "Credentials stored securely"),
              h("p", { class: "intg-env-hint-desc" },
                "Sensitive fields are redacted on disk. Set these environment variables at runtime:",
              ),
              Object.entries(config!.envVars).map(([key, envVar]) =>
                h("code", { key, class: "intg-env-hint-code" },
                  `export ${envVar}="your-${key}"`,
                ),
              ),
            ),
          ),
        )
      : null,

    // ── Setup guide ──────────────────────────────────────────────────
    schema.setupGuide && schema.setupGuide.length > 0
      ? h("div", { class: "intg-section intg-help" },
          h("h3", { class: "intg-section-title" },
            h("span", { class: "intg-section-icon" }, "\u2139"),
            "Setup Guide",
          ),
          h("ol", { class: "intg-steps" },
            schema.setupGuide.map((step, i) =>
              h("li", { key: i }, step),
            ),
          ),
          schema.docsUrl
            ? h("p", { class: "intg-docs-link" },
                h("a", {
                  href: schema.docsUrl,
                  target: "_blank",
                  rel: "noopener noreferrer",
                }, `${schema.name} documentation \u2192`),
              )
            : null,
        )
      : null,
  );
}

// ── Integration list card ────────────────────────────────────────────

function IntegrationCard({
  schema,
  configured,
  onClick,
}: {
  schema: IntegrationSchema;
  configured: boolean;
  onClick: () => void;
}) {
  return h("div", {
    class: `intg-card${configured ? " intg-card-configured" : ""}`,
    onClick,
    role: "button",
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick();
      }
    },
  },
    h("div", { class: "intg-card-icon" }, schema.icon ?? "\u{1F50C}"),
    h("div", { class: "intg-card-content" },
      h("div", { class: "intg-card-header" },
        h("h3", { class: "intg-card-name" }, schema.name),
        configured
          ? h("span", { class: "intg-card-badge" }, "\u2714 Configured")
          : null,
        schema.builtIn
          ? h("span", { class: "intg-card-builtin" }, "Built-in")
          : null,
      ),
      h("p", { class: "intg-card-desc" }, schema.description),
      h("div", { class: "intg-card-meta" },
        h("span", null, `${Object.keys(schema.fields).length} fields`),
        schema.supportsConnectionTest
          ? h("span", null, "\u2022 Connection test")
          : null,
      ),
    ),
    h("span", { class: "intg-card-arrow" }, "\u203A"),
  );
}

// ── Main view ────────────────────────────────────────────────────────

export function IntegrationConfigView() {
  const [loading, setLoading] = useState(true);
  const [schemas, setSchemas] = useState<IntegrationSchema[]>([]);
  const [configuredIds, setConfiguredIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Fetch integration list ──────────────────────────────────────────

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations");
      if (!res.ok) {
        setError("Failed to load integrations");
        return;
      }
      const data = await res.json() as { integrations: IntegrationSchema[] };
      setSchemas(data.integrations);

      // Check which are configured
      const configured = new Set<string>();
      for (const s of data.integrations) {
        try {
          const cfgRes = await fetch(`/api/integrations/${s.id}/config`);
          if (cfgRes.ok) {
            const cfg = await cfgRes.json() as { configured: boolean };
            if (cfg.configured) configured.add(s.id);
          }
        } catch {
          // ignore
        }
      }
      setConfiguredIds(configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  // ── Selected schema ─────────────────────────────────────────────────

  const selectedSchema = useMemo(() => {
    return schemas.find((s) => s.id === selectedId) ?? null;
  }, [schemas, selectedId]);

  // ── Render ──────────────────────────────────────────────────────────

  if (selectedSchema) {
    return h(IntegrationDetail, {
      schema: selectedSchema,
      onBack: () => {
        setSelectedId(null);
        // Refresh config status
        fetchIntegrations();
      },
    });
  }

  if (loading) {
    return h("div", { class: "intg-container" },
      h("div", { class: "loading" }, "Loading integrations..."),
    );
  }

  return h("div", { class: "intg-container" },
    h("div", { class: "intg-header" },
      h(BrandedHeader, { product: "rex", title: "Integrations" }),
      h("p", { class: "intg-subtitle" },
        "Connect external services to sync PRD data bidirectionally.",
      ),
    ),

    error
      ? h("div", { class: "intg-error-banner" }, error)
      : null,

    h("div", { class: "intg-list" },
      schemas.map((s) =>
        h(IntegrationCard, {
          key: s.id,
          schema: s,
          configured: configuredIds.has(s.id),
          onClick: () => setSelectedId(s.id),
        }),
      ),
    ),

    schemas.length === 0
      ? h("div", { class: "intg-empty" },
          h("p", null, "No integrations available."),
          h("p", { class: "intg-empty-hint" },
            "Integration schemas are registered by the rex adapter system.",
          ),
        )
      : null,
  );
}

/**
 * Integrations section — the other trackers this PRD can sync with, as the
 * Project page renders them (only while `rex.integrations` is on). Forms are
 * generated from each integration's schema.
 *
 * One integration is open at a time, and its form is what `useIntegrationsForm`
 * tracks: the page's Save writes it. Going back to the list and Remove
 * Configuration are held back while the open form has unsaved edits, so
 * neither can discard them silently; Remove itself is an immediate action and
 * never changes whether the form is dirty.
 *
 * Data comes from:
 *   GET    /api/integrations                — list available integrations
 *   GET    /api/integrations/:id/config     — current config (masked)
 *   PUT    /api/integrations/:id/config     — save credentials
 *   DELETE /api/integrations/:id/config     — remove config
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";

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

const asText = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

function validateFieldValue(
  value: unknown,
  schema: IntegrationFieldSchema,
): string | null {
  const strValue = asText(value);

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

  // Get sorted group keys
  const groupKeys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === null) return 1; // ungrouped fields go last
    if (b === null) return -1;
    const ga = schema.groups?.[a];
    const gb = schema.groups?.[b];
    return (ga?.order ?? 999) - (gb?.order ?? 999);
  });

  return groupKeys.map((groupKey) => ({
    groupKey,
    group: groupKey ? (schema.groups?.[groupKey] ?? null) : null,
    fields: grouped.get(groupKey) ?? [],
  }));
}

// ── Form state ───────────────────────────────────────────────────────

/** State and actions of the integrations form. The Project page owns it. */
export interface IntegrationsForm {
  schemas: IntegrationSchema[];
  configuredIds: ReadonlySet<string>;
  /** True until the integration list (or the open integration's config) has loaded. */
  loading: boolean;
  /** Why the list could not be loaded. */
  loadError: string | null;
  /** The open integration, or null while the list shows. */
  selected: IntegrationSchema | null;
  /** The open integration's saved config. */
  config: IntegrationConfig | null;
  formValues: Record<string, unknown>;
  fieldErrors: Record<string, string>;
  /** Why the last save failed. Cleared by the next save or a discard. */
  saveError: string | null;
  /** Why the last immediate action (remove) failed. */
  actionError: string | null;
  confirmRemove: boolean;
  removing: boolean;
  /** True while the open form holds a value that differs from what is saved. */
  dirty: boolean;
  /** Open an integration. */
  open: (id: string) => void;
  /** Return to the list. Ignored while the open form is dirty. */
  back: () => void;
  onFieldInput: (key: string, value: unknown) => void;
  setConfirmRemove: (confirm: boolean) => void;
  /** DELETE the open integration's config and reset its form. Not an edit. */
  remove: () => Promise<void>;
  /**
   * PUT the open form to /api/integrations/:id/config. Resolves true once
   * saved (or when nothing is dirty); false leaves the edits in place with an
   * error set.
   */
  save: () => Promise<boolean>;
  /** Restore the open form to what is saved. */
  discard: () => void;
}

/**
 * @param enabled False while `rex.integrations` is off: nothing is fetched and
 *   the form stays clean, so a hidden section can never hold the page dirty.
 */
export function useIntegrationsForm(enabled: boolean): IntegrationsForm {
  const [loading, setLoading] = useState(true);
  const [schemas, setSchemas] = useState<IntegrationSchema[]>([]);
  const [configuredIds, setConfiguredIds] = useState<ReadonlySet<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [config, setConfig] = useState<IntegrationConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  const selected = useMemo(
    () => schemas.find((s) => s.id === selectedId) ?? null,
    [schemas, selectedId],
  );

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations");
      if (!res.ok) {
        setLoadError("Failed to load integrations");
        return;
      }
      const data = await res.json() as { integrations: IntegrationSchema[] };
      setSchemas(data.integrations);
      setLoadError(null);

      const configured = new Set<string>();
      for (const s of data.integrations) {
        try {
          const cfgRes = await fetch(`/api/integrations/${s.id}/config`);
          if (cfgRes.ok && (await cfgRes.json() as { configured: boolean }).configured) {
            configured.add(s.id);
          }
        } catch {
          // A card whose status cannot be read simply shows as not configured.
        }
      }
      setConfiguredIds(configured);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void fetchList();
  }, [enabled, fetchList]);

  const fetchConfig = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/integrations/${id}/config`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setActionError((body as { error?: string }).error ?? "Failed to load configuration");
        return;
      }
      const data = await res.json() as IntegrationConfig;
      setConfig(data);
      // Sensitive values are never returned; the form starts from what is stored.
      setFormValues(data.configured ? { ...data.values } : {});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to load configuration");
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled && selectedId) void fetchConfig(selectedId);
  }, [enabled, selectedId, fetchConfig]);

  const savedValues = config?.configured ? config.values : {};
  const dirty = enabled && selected != null && Object.entries(formValues).some(([key, value]) => {
    const text = asText(value);
    return text.trim().length > 0 && text !== asText(savedValues[key]);
  });

  const open = useCallback((id: string) => {
    setConfig(null);
    setFormValues({});
    setFieldErrors({});
    setSaveError(null);
    setActionError(null);
    setConfirmRemove(false);
    setConfigLoading(true);
    setSelectedId(id);
  }, []);

  const back = useCallback(() => {
    if (dirty) return;
    setSelectedId(null);
    setConfig(null);
    void fetchList();
  }, [dirty, fetchList]);

  const onFieldInput = useCallback((key: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    const fieldSchema = selected?.fields[key];
    const err = fieldSchema && asText(value).trim().length > 0
      ? validateFieldValue(value, fieldSchema)
      : null;
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[key] = err;
      else delete next[key];
      return next;
    });
  }, [selected]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty || !selected) return true;
    setSaveError(null);

    const errors: Record<string, string> = {};
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(formValues)) {
      const fieldSchema = selected.fields[key];
      if (asText(value).trim().length === 0 || !fieldSchema) continue;
      const err = validateFieldValue(value, fieldSchema);
      if (err) errors[key] = err;
      else payload[key] = value;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setSaveError(`Fix the highlighted ${selected.name} fields before saving`);
      return false;
    }

    try {
      const res = await fetch(`/api/integrations/${selected.id}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" })) as
          { error?: string; errors?: Record<string, string> };
        if (body.errors) setFieldErrors(body.errors);
        setSaveError(body.error ?? `${selected.name} configuration was not saved`);
        return false;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    }

    setFieldErrors({});
    await fetchConfig(selected.id);
    return true;
  }, [dirty, selected, formValues, fetchConfig]);

  const discard = useCallback(() => {
    setFormValues(config?.configured ? { ...config.values } : {});
    setFieldErrors({});
    setSaveError(null);
  }, [config]);

  const remove = useCallback(async () => {
    if (!selected) return;
    setRemoving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/integrations/${selected.id}/config`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Remove failed" }));
        setActionError((body as { error?: string }).error ?? "Remove failed");
        return;
      }
      setConfirmRemove(false);
      await fetchConfig(selected.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  }, [selected, fetchConfig]);

  return {
    schemas, configuredIds,
    loading: loading || (selectedId !== null && configLoading),
    loadError, selected, config,
    formValues, fieldErrors, saveError, actionError,
    confirmRemove, removing, dirty,
    open, back, onFieldInput, setConfirmRemove, remove,
    save, discard,
  };
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
  const strValue = asText(value);
  const hasError = !!error;
  const inputId = `intg-${fieldKey}`;

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

  const placeholder = configured && masked ? `Current: ${masked}` : (schema.placeholder ?? "");

  return h("div", {
    class: `intg-field${hasError ? " intg-field-error" : ""}`,
  },
    h("label", { class: "intg-field-label", htmlFor: inputId },
      schema.label ?? fieldKey,
      configured && (schema.sensitive ? masked : undefined)
        ? h("span", { class: "intg-field-badge" }, "configured")
        : null,
      schema.required
        ? h("span", { class: "intg-field-required" }, "*")
        : null,
    ),

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

    inputType === "checkbox"
      ? h("label", { class: "intg-checkbox-wrapper" },
          h("input", {
            id: inputId,
            type: "checkbox",
            checked: value === true || value === "true",
            onChange: handleInput,
          }),
          h("span", { class: "intg-checkbox-label" }, schema.description),
        )
      : inputType === "select"
        ? h("select", {
            id: inputId,
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
              id: inputId,
              class: "intg-input intg-textarea",
              value: strValue,
              placeholder,
              onInput: handleInput,
              rows: 4,
            })
          : inputType === "password"
            ? h("div", { class: "intg-input-row" },
                h("input", {
                  id: inputId,
                  type: visible ? "text" : "password",
                  class: "intg-input",
                  value: strValue,
                  placeholder,
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
                }, visible ? "\u{1F441}" : "\u{1F441}‍\u{1F5E8}"),
              )
            : h("input", {
                id: inputId,
                type: inputType,
                class: "intg-input",
                value: strValue,
                placeholder,
                onInput: handleInput,
                autocomplete: "off",
                spellcheck: false,
              }),

    hasError
      ? h("div", { class: "intg-field-error-text" }, error)
      : null,
  );
}

// ── Integration detail view (config form) ────────────────────────────

/** Why Back and Remove are unavailable, shown beside them. */
export const INTEGRATION_BLOCKED_HINT = "Save or discard your edits first.";

function IntegrationDetail({ form, schema }: { form: IntegrationsForm; schema: IntegrationSchema }) {
  const groupedFields = useMemo(() => groupFields(schema), [schema]);
  const { config } = form;
  const isConfigured = config?.configured ?? false;
  const error = form.saveError ?? form.actionError;

  return h("div", { class: "intg-container" },
    h("div", { class: "intg-nav" },
      h("button", {
        type: "button",
        class: "intg-back-btn",
        onClick: form.back,
        disabled: form.dirty,
        title: form.dirty ? INTEGRATION_BLOCKED_HINT : undefined,
      }, "← All Integrations"),
      form.dirty
        ? h("span", { class: "intg-blocked-hint" }, INTEGRATION_BLOCKED_HINT)
        : null,
    ),

    h("div", { class: "intg-header" },
      h("h3", { class: "intg-detail-title" }, `${schema.name} Integration`),
      h("p", { class: "intg-subtitle" }, schema.description),
    ),

    error
      ? h("div", { class: "intg-error-banner", role: "alert" }, error)
      : null,

    groupedFields.map(({ groupKey, group, fields }) =>
      h("div", { key: groupKey ?? "__ungrouped", class: "intg-section" },
        group
          ? h("h4", { class: "intg-section-title" },
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
            value: form.formValues[key],
            error: form.fieldErrors[key],
            configured: isConfigured,
            masked: config?.masked[key],
            onInput: form.onFieldInput,
          }),
        ),
      ),
    ),

    isConfigured
      ? h("div", { class: "intg-actions" },
          h("div", { class: "intg-actions-danger" },
            form.confirmRemove
              ? h(Fragment, null,
                  h("span", { class: "intg-confirm-text" }, `Remove ${schema.name} config?`),
                  h("button", {
                    type: "button",
                    class: "intg-confirm-yes",
                    onClick: () => void form.remove(),
                    disabled: form.removing,
                  }, form.removing ? "Removing..." : "Yes, Remove"),
                  h("button", {
                    type: "button",
                    class: "intg-confirm-no",
                    onClick: () => form.setConfirmRemove(false),
                  }, "Cancel"),
                )
              : h("button", {
                  type: "button",
                  class: "intg-remove-btn",
                  onClick: () => form.setConfirmRemove(true),
                  disabled: form.dirty,
                  title: form.dirty ? INTEGRATION_BLOCKED_HINT : undefined,
                }, "Remove Configuration"),
          ),
        )
      : null,

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

    schema.setupGuide && schema.setupGuide.length > 0
      ? h("div", { class: "intg-section intg-help" },
          h("h4", { class: "intg-section-title" },
            h("span", { class: "intg-section-icon" }, "ℹ"),
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
                }, `${schema.name} documentation →`),
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
          ? h("span", { class: "intg-card-badge" }, "✔ Configured")
          : null,
        schema.builtIn
          ? h("span", { class: "intg-card-builtin" }, "Built-in")
          : null,
      ),
      h("p", { class: "intg-card-desc" }, schema.description),
      h("div", { class: "intg-card-meta" },
        h("span", null, `${Object.keys(schema.fields).length} fields`),
        schema.supportsConnectionTest
          ? h("span", null, "• Connection test")
          : null,
      ),
    ),
    h("span", { class: "intg-card-arrow" }, "›"),
  );
}

// ── Section ──────────────────────────────────────────────────────────

export function IntegrationsSection({ form }: { form: IntegrationsForm }) {
  if (form.loading) {
    return h("div", { class: "loading" }, "Loading integrations...");
  }

  if (form.selected) {
    return h(IntegrationDetail, { form, schema: form.selected });
  }

  return h("div", { class: "intg-container" },
    h("p", { class: "intg-subtitle" },
      "Connect external services to sync PRD data bidirectionally.",
    ),

    form.loadError
      ? h("div", { class: "intg-error-banner", role: "alert" }, form.loadError)
      : null,

    h("div", { class: "intg-list" },
      form.schemas.map((s) =>
        h(IntegrationCard, {
          key: s.id,
          schema: s,
          configured: form.configuredIds.has(s.id),
          onClick: () => form.open(s.id),
        }),
      ),
    ),

    form.schemas.length === 0 && !form.loadError
      ? h("div", { class: "intg-empty" },
          h("p", null, "No integrations available."),
          h("p", { class: "intg-empty-hint" },
            "Integration schemas are registered by the rex adapter system.",
          ),
        )
      : null,
  );
}

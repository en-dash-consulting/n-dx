/**
 * Notion database schema validation wizard.
 *
 * An interactive component that validates the target Notion database schema
 * against the expected PRD property structure, shows per-property diagnostics,
 * and offers to auto-create missing properties where the Notion API allows it.
 *
 * Data comes from:
 *   POST /api/notion/schema      — validate database schema
 *   POST /api/notion/schema/fix   — create missing properties
 */

import { h, Fragment } from "preact";
import { useState, useCallback, useEffect } from "preact/hooks";

// ── Types ────────────────────────────────────────────────────────────

interface SchemaPropertyResult {
  name: string;
  expectedType: string;
  actualType: string | null;
  required: boolean;
  status: "ok" | "missing" | "wrong_type";
  canAutoCreate: boolean;
  guidance?: string;
}

interface SchemaValidationResponse {
  valid: boolean;
  databaseTitle: string;
  properties: SchemaPropertyResult[];
  summary: {
    total: number;
    ok: number;
    missing: number;
    wrongType: number;
    fixable: number;
  };
}

interface ConnectionErrorResponse {
  status: "red" | "yellow";
  message: string;
  details?: {
    authValid: boolean;
    databaseAccessible: boolean;
  };
}

type SchemaResponse = SchemaValidationResponse | ConnectionErrorResponse;

function isConnectionError(r: SchemaResponse): r is ConnectionErrorResponse {
  return "status" in r && typeof (r as ConnectionErrorResponse).status === "string"
    && ((r as ConnectionErrorResponse).status === "red" || (r as ConnectionErrorResponse).status === "yellow");
}

// ── Persistence key ──────────────────────────────────────────────────

const SCHEMA_CACHE_KEY = "notion-schema-validation";

function loadCachedSchema(): SchemaValidationResponse | null {
  try {
    const raw = sessionStorage.getItem(SCHEMA_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SchemaValidationResponse;
  } catch {
    return null;
  }
}

function saveCachedSchema(result: SchemaValidationResponse): void {
  try {
    sessionStorage.setItem(SCHEMA_CACHE_KEY, JSON.stringify(result));
  } catch {
    // sessionStorage may be unavailable
  }
}

function clearCachedSchema(): void {
  try {
    sessionStorage.removeItem(SCHEMA_CACHE_KEY);
  } catch {
    // noop
  }
}

// ── Property type display names ──────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  title: "Title",
  status: "Status",
  select: "Select",
  multi_select: "Multi-select",
  rich_text: "Text",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

// ── Status icon helper ───────────────────────────────────────────────

function statusIcon(status: "ok" | "missing" | "wrong_type"): string {
  switch (status) {
    case "ok": return "\u2705";
    case "missing": return "\u274C";
    case "wrong_type": return "\u26A0\uFE0F";
  }
}

// ── Property row component ───────────────────────────────────────────

function PropertyRow({ prop, selected, onToggle }: {
  prop: SchemaPropertyResult;
  selected: boolean;
  onToggle: (name: string) => void;
}) {
  const showCheckbox = prop.status === "missing" && prop.canAutoCreate;

  return h("div", {
    class: `schema-prop-row schema-prop-${prop.status}`,
  },
    // Checkbox column (for fixable properties)
    h("div", { class: "schema-prop-check" },
      showCheckbox
        ? h("input", {
            type: "checkbox",
            checked: selected,
            onChange: () => onToggle(prop.name),
            "aria-label": `Select ${prop.name} for auto-creation`,
          })
        : null,
    ),
    // Status icon
    h("span", { class: "schema-prop-icon" }, statusIcon(prop.status)),
    // Property info
    h("div", { class: "schema-prop-info" },
      h("div", { class: "schema-prop-name-row" },
        h("span", { class: "schema-prop-name" }, prop.name),
        prop.required
          ? h("span", { class: "schema-prop-required" }, "required")
          : h("span", { class: "schema-prop-optional" }, "optional"),
        h("span", { class: "schema-prop-type" }, typeLabel(prop.expectedType)),
      ),
      prop.status === "wrong_type"
        ? h("div", { class: "schema-prop-error" },
            `Type mismatch: found "${typeLabel(prop.actualType ?? "unknown")}" instead of "${typeLabel(prop.expectedType)}"`,
          )
        : null,
      prop.guidance
        ? h("div", { class: "schema-prop-guidance" }, prop.guidance)
        : null,
    ),
  );
}

// ── Summary bar component ────────────────────────────────────────────

function SummaryBar({ summary, valid }: {
  summary: SchemaValidationResponse["summary"];
  valid: boolean;
}) {
  return h("div", { class: `schema-summary ${valid ? "schema-summary-valid" : "schema-summary-invalid"}` },
    h("div", { class: "schema-summary-status" },
      valid
        ? h(Fragment, null,
            h("span", { class: "schema-summary-icon schema-summary-icon-ok" }, "\u2705"),
            h("span", null, "Database schema is valid for PRD sync"),
          )
        : h(Fragment, null,
            h("span", { class: "schema-summary-icon schema-summary-icon-error" }, "\u26A0\uFE0F"),
            h("span", null, "Database schema needs attention"),
          ),
    ),
    h("div", { class: "schema-summary-counts" },
      h("span", { class: "schema-count schema-count-ok" },
        `${summary.ok} ok`,
      ),
      summary.missing > 0
        ? h("span", { class: "schema-count schema-count-missing" },
            `${summary.missing} missing`,
          )
        : null,
      summary.wrongType > 0
        ? h("span", { class: "schema-count schema-count-wrong" },
            `${summary.wrongType} wrong type`,
          )
        : null,
    ),
  );
}

// ── Main wizard component ────────────────────────────────────────────

export function NotionSchemaWizard({ isConfigured }: { isConfigured: boolean }) {
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<SchemaValidationResponse | null>(
    () => loadCachedSchema(),
  );
  const [error, setError] = useState<string | null>(null);

  // Fix flow state
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<{
    created: string[];
    failed: Array<{ name: string; error: string }>;
  } | null>(null);
  const [selectedProps, setSelectedProps] = useState<Set<string>>(new Set());

  // Clear cached schema when config changes
  useEffect(() => {
    if (!isConfigured) {
      clearCachedSchema();
      setResult(null);
    }
  }, [isConfigured]);

  // Auto-select all fixable properties when result changes
  useEffect(() => {
    if (result) {
      const fixable = result.properties
        .filter((p) => p.status === "missing" && p.canAutoCreate)
        .map((p) => p.name);
      setSelectedProps(new Set(fixable));
    }
  }, [result]);

  const handleValidate = useCallback(async () => {
    setValidating(true);
    setError(null);
    setFixResult(null);

    try {
      const res = await fetch("/api/notion/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Validation failed" }));
        setError((body as { error?: string }).error ?? "Schema validation failed");
        return;
      }

      const data = await res.json() as SchemaResponse;

      if (isConnectionError(data)) {
        setError(data.message);
        return;
      }

      setResult(data);
      saveCachedSchema(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schema validation failed");
    } finally {
      setValidating(false);
    }
  }, []);

  const handleToggleProp = useCallback((name: string) => {
    setSelectedProps((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const handleFix = useCallback(async () => {
    if (selectedProps.size === 0) return;

    setFixing(true);
    setFixResult(null);

    try {
      const res = await fetch("/api/notion/schema/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties: [...selectedProps] }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Fix failed" }));
        setError((body as { error?: string }).error ?? "Property creation failed");
        return;
      }

      const data = await res.json() as {
        created: string[];
        failed: Array<{ name: string; error: string }>;
      };
      setFixResult(data);

      // Re-validate after fix to refresh the property list
      if (data.created.length > 0) {
        // Brief delay to let Notion propagate the changes
        setTimeout(() => handleValidate(), 1000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Property creation failed");
    } finally {
      setFixing(false);
    }
  }, [selectedProps, handleValidate]);

  // Count fixable selected
  const fixableSelected = result
    ? result.properties.filter(
        (p) => p.status === "missing" && p.canAutoCreate && selectedProps.has(p.name),
      ).length
    : 0;

  const hasFixableProps = result
    ? result.properties.some((p) => p.status === "missing" && p.canAutoCreate)
    : false;

  return h("div", { class: "schema-wizard" },
    h("h3", { class: "notion-config-section-title" },
      h("span", { class: "notion-config-section-icon" }, "\u{1F9E9}"),
      "Database Schema",
    ),
    h("p", { class: "schema-wizard-desc" },
      "Validate that your Notion database has the required properties for PRD sync.",
    ),

    // Validate button
    h("div", { class: "schema-wizard-actions" },
      h("button", {
        type: "button",
        class: "schema-validate-btn",
        onClick: handleValidate,
        disabled: validating || !isConfigured,
      }, validating ? "Validating..." : result ? "Re-validate Schema" : "Validate Schema"),
      !isConfigured
        ? h("span", { class: "schema-wizard-hint" }, "Save credentials first")
        : null,
    ),

    // Error display
    error
      ? h("div", { class: "schema-wizard-error" }, error)
      : null,

    // Fix result toast
    fixResult
      ? h("div", {
          class: fixResult.failed.length > 0
            ? "schema-fix-result schema-fix-partial"
            : "schema-fix-result schema-fix-success",
        },
          fixResult.created.length > 0
            ? h("div", null,
                h("strong", null, `Created ${fixResult.created.length} properties: `),
                fixResult.created.join(", "),
              )
            : null,
          fixResult.failed.length > 0
            ? h("div", { class: "schema-fix-failures" },
                ...fixResult.failed.map((f) =>
                  h("div", null,
                    h("strong", null, `${f.name}: `),
                    f.error,
                  ),
                ),
              )
            : null,
        )
      : null,

    // Validation results
    result
      ? h("div", { class: "schema-results" },
          // Database title
          h("div", { class: "schema-db-title" },
            h("span", { class: "schema-db-title-label" }, "Database: "),
            h("span", { class: "schema-db-title-name" }, result.databaseTitle),
          ),

          // Summary bar
          h(SummaryBar, { summary: result.summary, valid: result.valid }),

          // Property list
          h("div", { class: "schema-prop-list" },
            ...result.properties.map((prop) =>
              h(PropertyRow, {
                prop,
                selected: selectedProps.has(prop.name),
                onToggle: handleToggleProp,
              }),
            ),
          ),

          // Fix button (if there are fixable properties)
          hasFixableProps
            ? h("div", { class: "schema-fix-actions" },
                h("p", { class: "schema-fix-desc" },
                  "Select missing properties above and click to create them automatically.",
                ),
                h("button", {
                  type: "button",
                  class: "schema-fix-btn",
                  onClick: handleFix,
                  disabled: fixing || fixableSelected === 0,
                },
                  fixing
                    ? "Creating..."
                    : `Create ${fixableSelected} Missing ${fixableSelected === 1 ? "Property" : "Properties"}`,
                ),
              )
            : null,

          // Manual setup hint for non-API-creatable properties
          result.properties.some(
            (p) => p.status === "missing" && !p.canAutoCreate && p.required,
          )
            ? h("div", { class: "schema-manual-hint" },
                h("span", { class: "schema-manual-hint-icon" }, "\u{1F6E0}\uFE0F"),
                h("div", null,
                  h("strong", null, "Manual setup required"),
                  h("p", null,
                    "Some required properties (like Status) cannot be created via the API. ",
                    "Open your database in Notion and create them manually.",
                  ),
                ),
              )
            : null,
        )
      : null,
  );
}

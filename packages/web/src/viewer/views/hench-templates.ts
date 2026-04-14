/**
 * Hench Templates view — browse, apply, and manage workflow templates.
 *
 * Displays a gallery of built-in and user-defined templates with metadata,
 * use cases, and config overrides. Users can apply templates to their
 * current configuration or save their current config as a new template.
 *
 * Data comes from:
 *   GET  /api/hench/templates          (list)
 *   GET  /api/hench/templates/:id      (detail)
 *   POST /api/hench/templates/:id/apply (apply)
 *   POST /api/hench/templates          (create)
 *   DELETE /api/hench/templates/:id    (delete)
 */

import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";

// ── Types ────────────────────────────────────────────────────────────

interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  useCases: string[];
  tags: string[];
  config: Record<string, unknown>;
  builtIn: boolean;
  createdAt?: string;
}

interface TemplatesResponse {
  templates: WorkflowTemplate[];
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Flatten nested config into dot-path key/value pairs for display. */
function flattenConfig(obj: Record<string, unknown>, prefix = ""): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      entries.push(...flattenConfig(value as Record<string, unknown>, path));
    } else {
      entries.push([path, value]);
    }
  }
  return entries;
}

function formatConfigValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined) return "";
  return String(value);
}

// ── Template card component ──────────────────────────────────────────

function TemplateCard({ template, onApply, onDelete, applying }: {
  template: WorkflowTemplate;
  onApply: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  applying: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const configEntries = flattenConfig(template.config);
  const isApplying = applying === template.id;

  return h("div", { class: `hench-template-card${template.builtIn ? " built-in" : " user-defined"}` },
    h("div", { class: "hench-template-card-header", onClick: () => setExpanded(!expanded) },
      h("div", { class: "hench-template-card-title-row" },
        h("h3", { class: "hench-template-card-name" }, template.name),
        template.builtIn
          ? h("span", { class: "hench-template-badge built-in" }, "built-in")
          : h("span", { class: "hench-template-badge user" }, "custom"),
      ),
      h("p", { class: "hench-template-card-desc" }, template.description),
      template.tags.length > 0
        ? h("div", { class: "hench-template-tags" },
            ...template.tags.map((tag) =>
              h("span", { key: tag, class: "hench-template-tag" }, tag),
            ),
          )
        : null,
    ),

    expanded
      ? h("div", { class: "hench-template-card-detail" },
          template.useCases.length > 0
            ? h("div", { class: "hench-template-use-cases" },
                h("h4", null, "Recommended use cases"),
                h("ul", null,
                  ...template.useCases.map((uc, i) =>
                    h("li", { key: i }, uc),
                  ),
                ),
              )
            : null,

          configEntries.length > 0
            ? h("div", { class: "hench-template-config" },
                h("h4", null, "Config overrides"),
                h("table", { class: "hench-template-config-table" },
                  h("tbody", null,
                    ...configEntries.map(([key, value]) =>
                      h("tr", { key },
                        h("td", { class: "hench-template-config-key" }, key),
                        h("td", { class: "hench-template-config-value" }, formatConfigValue(value)),
                      ),
                    ),
                  ),
                ),
              )
            : null,

          template.createdAt
            ? h("p", { class: "hench-template-created" },
                "Created: ",
                new Date(template.createdAt).toLocaleDateString(),
              )
            : null,
        )
      : null,

    h("div", { class: "hench-template-card-actions" },
      h("button", {
        class: "hench-template-expand-btn",
        onClick: () => setExpanded(!expanded),
      }, expanded ? "Less" : "Details"),
      h("button", {
        class: "hench-template-apply-btn",
        onClick: () => onApply(template.id),
        disabled: isApplying,
      }, isApplying ? "Applying..." : "Apply"),
      !template.builtIn
        ? h("button", {
            class: "hench-template-delete-btn",
            onClick: () => onDelete(template.id),
          }, "Delete")
        : null,
    ),
  );
}

// ── Save template form ───────────────────────────────────────────────

function SaveTemplateForm({ onSave, saving }: {
  onSave: (data: { id: string; name: string; description: string; tags: string }) => Promise<void>;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!id.match(/^[a-z][a-z0-9-]{1,49}$/)) {
      setError("ID must be lowercase, start with a letter, use hyphens (2-50 chars)");
      return;
    }
    setError(null);
    try {
      await onSave({ id, name: name || id, description, tags });
      setOpen(false);
      setId("");
      setName("");
      setDescription("");
      setTags("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id, name, description, tags, onSave]);

  if (!open) {
    return h("button", {
      class: "hench-template-save-current-btn",
      onClick: () => setOpen(true),
    }, "Save Current Config as Template");
  }

  return h("div", { class: "hench-template-save-form" },
    h("h3", null, "Save Current Config as Template"),
    h("div", { class: "hench-template-form-field" },
      h("label", null, "Template ID"),
      h("input", {
        type: "text",
        value: id,
        placeholder: "my-template",
        onInput: (e: Event) => setId((e.target as HTMLInputElement).value),
      }),
    ),
    h("div", { class: "hench-template-form-field" },
      h("label", null, "Name"),
      h("input", {
        type: "text",
        value: name,
        placeholder: "My Template",
        onInput: (e: Event) => setName((e.target as HTMLInputElement).value),
      }),
    ),
    h("div", { class: "hench-template-form-field" },
      h("label", null, "Description"),
      h("input", {
        type: "text",
        value: description,
        placeholder: "Brief description of this template",
        onInput: (e: Event) => setDescription((e.target as HTMLInputElement).value),
      }),
    ),
    h("div", { class: "hench-template-form-field" },
      h("label", null, "Tags (comma-separated)"),
      h("input", {
        type: "text",
        value: tags,
        placeholder: "fast, lightweight",
        onInput: (e: Event) => setTags((e.target as HTMLInputElement).value),
      }),
    ),
    error ? h("div", { class: "hench-template-form-error" }, error) : null,
    h("div", { class: "hench-template-form-actions" },
      h("button", {
        class: "hench-template-apply-btn",
        onClick: handleSave,
        disabled: saving || !id,
      }, saving ? "Saving..." : "Save Template"),
      h("button", {
        class: "hench-template-cancel-btn",
        onClick: () => setOpen(false),
      }, "Cancel"),
    ),
  );
}

// ── Toast notification ───────────────────────────────────────────────

function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return h("div", { class: "hench-template-toast" },
    h("span", { class: "hench-template-toast-icon" }, "\u2714"),
    h("span", null, message),
  );
}

// ── Main view ────────────────────────────────────────────────────────

export function HenchTemplatesView() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/hench/templates");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load templates");
        return;
      }
      const json = await res.json() as TemplatesResponse;
      setTemplates(json.templates);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleApply = useCallback(async (id: string) => {
    setApplying(id);
    try {
      const res = await fetch(`/api/hench/templates/${id}/apply`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Apply failed" }));
        throw new Error((body as { error?: string }).error ?? "Apply failed");
      }
      const result = await res.json() as { templateName: string };
      showToast(`Applied template "${result.templateName}"`);
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setApplying(null);
    }
  }, [showToast]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/hench/templates/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error((body as { error?: string }).error ?? "Delete failed");
      }
      showToast(`Deleted template "${id}"`);
      await fetchTemplates();
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [showToast, fetchTemplates]);

  const handleSaveTemplate = useCallback(async (data: { id: string; name: string; description: string; tags: string }) => {
    setSaving(true);
    try {
      // First get current config to use as the template overlay
      const configRes = await fetch("/api/hench/config");
      if (!configRes.ok) throw new Error("Failed to load current config");
      const configJson = await configRes.json() as { config: Record<string, unknown> };

      // Strip schema field from overlay
      const { schema: _schema, ...overlay } = configJson.config;

      const res = await fetch("/api/hench/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: data.id,
          name: data.name,
          description: data.description,
          tags: data.tags.split(",").map((s) => s.trim()).filter(Boolean),
          config: overlay,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        throw new Error((body as { error?: string }).error ?? "Save failed");
      }

      showToast(`Saved template "${data.name || data.id}"`);
      await fetchTemplates();
    } finally {
      setSaving(false);
    }
  }, [showToast, fetchTemplates]);

  if (loading) {
    return h("div", { class: "hench-templates-container" },
      h("div", { class: "loading" }, "Loading templates..."),
    );
  }

  if (error) {
    return h("div", { class: "hench-templates-container" },
      h(BrandedHeader, { product: "hench", title: "Workflow Templates" }),
      h("div", { class: "hench-templates-error" },
        h("p", null, error),
        h("p", { class: "hench-templates-error-hint" },
          "Make sure ",
          h("code", null, ".hench/"),
          " exists. Run ",
          h("code", null, "hench init"),
          " to create it.",
        ),
      ),
    );
  }

  const builtIn = templates.filter((t) => t.builtIn);
  const user = templates.filter((t) => !t.builtIn);

  return h("div", { class: "hench-templates-container" },
    h("div", { class: "hench-templates-header" },
      h(BrandedHeader, { product: "hench", title: "Workflow Templates" }),
      h("p", { class: "hench-templates-subtitle" },
        "Pre-configured workflow setups for common development patterns. Apply a template to quickly configure your agent.",
      ),
    ),

    h(SaveTemplateForm, { onSave: handleSaveTemplate, saving }),

    builtIn.length > 0
      ? h("div", { class: "hench-templates-section" },
          h("h2", { class: "hench-templates-section-title" }, "Built-in Templates"),
          h("div", { class: "hench-templates-grid" },
            ...builtIn.map((t) =>
              h(TemplateCard, {
                key: t.id,
                template: t,
                onApply: handleApply,
                onDelete: handleDelete,
                applying,
              }),
            ),
          ),
        )
      : null,

    user.length > 0
      ? h("div", { class: "hench-templates-section" },
          h("h2", { class: "hench-templates-section-title" }, "Custom Templates"),
          h("div", { class: "hench-templates-grid" },
            ...user.map((t) =>
              h(TemplateCard, {
                key: t.id,
                template: t,
                onApply: handleApply,
                onDelete: handleDelete,
                applying,
              }),
            ),
          ),
        )
      : null,

    h(Toast, { message: toast }),
  );
}

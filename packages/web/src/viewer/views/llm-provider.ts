/**
 * LLM Provider view — configure active vendor and per-vendor model selection.
 *
 * Surfaces llm.vendor (claude/codex), llm.claude.model, llm.claude.lightModel,
 * llm.codex.model, and llm.codex.lightModel from `.n-dx.json`.  Legacy
 * claude.model / claude.lightModel fields are shown as read-only context when
 * present and no modern equivalent is set.
 *
 * Data comes from GET /api/llm/config (read) and
 * PUT /api/llm/config (update).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { NdxLogoPng } from "../components/index.js";

// ── Types ─────────────────────────────────────────────────────────────

interface VendorConfig {
  model: string | null;
  lightModel: string | null;
}

interface LlmConfigResponse {
  vendor: string | null;
  claude: VendorConfig;
  codex: VendorConfig;
  legacyClaude: VendorConfig;
  autoFailover?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────

const VENDORS = [
  {
    id: "claude",
    label: "Claude",
    description: "Anthropic Claude — use claude-code CLI or API key",
  },
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI Codex — use codex CLI or API key",
  },
];

const MODEL_SUGGESTIONS: Record<string, string[]> = {
  claude: [
    "claude-sonnet-4-5",
    "claude-opus-4-5",
    "claude-haiku-3-5",
    "claude-3-7-sonnet-20250219",
  ],
  codex: [
    "codex-mini",
    "o4-mini",
    "o3",
  ],
};

// ── Sub-components ────────────────────────────────────────────────────

function VendorSelector({
  vendor,
  onChange,
}: {
  vendor: string | null;
  onChange: (v: string | null) => void;
}) {
  return h("div", { class: "llm-vendor-selector" },
    h("label", { class: "llm-section-label" }, "Active vendor"),
    h("p", { class: "llm-field-desc" },
      "All LLM commands (ndx work, ndx plan, ndx recommend) use this vendor.",
    ),
    h("div", { class: "llm-vendor-cards" },
      VENDORS.map((v) =>
        h("button", {
          key: v.id,
          class: `llm-vendor-card${vendor === v.id ? " llm-vendor-card-active" : ""}`,
          onClick: () => onChange(vendor === v.id ? null : v.id),
          "aria-pressed": String(vendor === v.id),
          "aria-label": `Select ${v.label}`,
        },
          h("span", { class: "llm-vendor-name" }, v.label),
          h("span", { class: "llm-vendor-desc" }, v.description),
          vendor === v.id
            ? h("span", { class: "llm-vendor-active-badge" }, "active")
            : null,
        ),
      ),
    ),
  );
}

function ModelField({
  fieldKey,
  label,
  description,
  value,
  suggestions,
  onChange,
  dirty,
}: {
  fieldKey: string;
  label: string;
  description: string;
  value: string;
  suggestions: string[];
  onChange: (key: string, v: string) => void;
  dirty: boolean;
}) {
  const listId = `llm-datalist-${fieldKey}`;
  return h("div", { class: `llm-field${dirty ? " llm-field-dirty" : ""}` },
    h("label", { class: "llm-field-label", htmlFor: fieldKey },
      label,
      dirty ? h("span", { class: "llm-dirty-indicator" }, " •") : null,
    ),
    h("p", { class: "llm-field-desc" }, description),
    h("div", { class: "llm-field-row" },
      h("input", {
        id: fieldKey,
        type: "text",
        class: "llm-text-input",
        value,
        list: listId,
        placeholder: "e.g. " + (suggestions[0] ?? "model-id"),
        onInput: (e: Event) => onChange(fieldKey, (e.target as HTMLInputElement).value),
      }),
      h("datalist", { id: listId },
        suggestions.map((s) => h("option", { key: s, value: s })),
      ),
    ),
  );
}

function ToggleField({
  fieldKey,
  label,
  description,
  value,
  onChange,
  dirty,
}: {
  fieldKey: string;
  label: string;
  description: string;
  value: boolean;
  onChange: (key: string, v: boolean) => void;
  dirty: boolean;
}) {
  return h("div", { class: `llm-field${dirty ? " llm-field-dirty" : ""}` },
    h("label", { class: "llm-field-label", htmlFor: fieldKey },
      label,
      dirty ? h("span", { class: "llm-dirty-indicator" }, " •") : null,
    ),
    h("p", { class: "llm-field-desc" }, description),
    h("div", { class: "llm-field-row" },
      h("input", {
        id: fieldKey,
        type: "checkbox",
        class: "llm-checkbox-input",
        checked: value,
        onChange: (e: Event) => onChange(fieldKey, (e.target as HTMLInputElement).checked),
      }),
    ),
  );
}

function VendorSection({
  vendorId,
  config,
  editValues,
  onChange,
  dirtyKeys,
}: {
  vendorId: string;
  config: VendorConfig;
  editValues: Record<string, string>;
  onChange: (key: string, v: string) => void;
  dirtyKeys: Set<string>;
}) {
  const meta = VENDORS.find((v) => v.id === vendorId);
  const suggestions = MODEL_SUGGESTIONS[vendorId] ?? [];
  const modelKey = `${vendorId}.model`;
  const lightKey = `${vendorId}.lightModel`;

  return h("div", { class: "llm-vendor-section" },
    h("h3", { class: "llm-vendor-section-title" },
      h("span", { class: `llm-vendor-dot llm-vendor-dot-${vendorId}` }),
      meta?.label ?? vendorId,
      " Settings",
    ),
    h("div", { class: "llm-fields" },
      h(ModelField, {
        fieldKey: modelKey,
        label: "Model",
        description: `Primary model for agentic tasks (ndx work, ndx plan). Override the default with a specific ${meta?.label ?? vendorId} model ID.`,
        value: editValues[modelKey] ?? config.model ?? "",
        suggestions,
        onChange,
        dirty: dirtyKeys.has(modelKey),
      }),
      h(ModelField, {
        fieldKey: lightKey,
        label: "Light model",
        description: `Fast, cheaper model for lightweight tasks (recommendations, summaries). Leave blank to use the same model as primary.`,
        value: editValues[lightKey] ?? config.lightModel ?? "",
        suggestions,
        onChange,
        dirty: dirtyKeys.has(lightKey),
      }),
    ),
  );
}

// ── Toast ─────────────────────────────────────────────────────────────

function SaveToast({ message }: { message: string | null }) {
  if (!message) return null;
  return h("div", { class: "llm-toast", role: "status", "aria-live": "polite" },
    h("span", { class: "llm-toast-icon" }, "\u2714"),
    h("span", null, message),
  );
}

// ── Main view ─────────────────────────────────────────────────────────

export function LlmProviderView() {
  const [data, setData] = useState<LlmConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending edits: fieldKey → raw string value
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  // Pending toggle edits: fieldKey → boolean value
  const [editToggles, setEditToggles] = useState<Record<string, boolean>>({});
  // Vendor selection may differ from saved
  const [pendingVendor, setPendingVendor] = useState<string | null | undefined>(undefined);

  const effectiveVendor = pendingVendor !== undefined ? pendingVendor : data?.vendor ?? null;

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/llm/config");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load LLM config");
        return;
      }
      const json = await res.json() as LlmConfigResponse;
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load LLM config");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  // Clean up toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastRef.current) clearTimeout(toastRef.current);
    };
  }, []);

  const handleVendorChange = useCallback((v: string | null) => {
    setPendingVendor(v);
  }, []);

  const handleFieldChange = useCallback((key: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleToggleChange = useCallback((key: string, value: boolean) => {
    setEditToggles((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Compute dirty set
  const dirtyKeys = new Set<string>();
  if (data) {
    for (const vendorId of ["claude", "codex"]) {
      const vendorData = data[vendorId as keyof Pick<LlmConfigResponse, "claude" | "codex">];
      for (const field of ["model", "lightModel"] as const) {
        const key = `${vendorId}.${field}`;
        if (key in editValues) {
          const saved = vendorData[field] ?? "";
          if (editValues[key] !== saved) dirtyKeys.add(key);
        }
      }
    }
  }
  const vendorDirty = pendingVendor !== undefined && pendingVendor !== (data?.vendor ?? null);

  // Track dirty state for toggles
  const dirtyToggles = new Set<string>();
  if (data && "autoFailover" in editToggles) {
    const saved = data.autoFailover ?? false;
    if (editToggles.autoFailover !== saved) dirtyToggles.add("autoFailover");
  }

  const hasPendingChanges = dirtyKeys.size > 0 || vendorDirty || dirtyToggles.size > 0;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const changes: Record<string, string | null | boolean> = {};

      if (vendorDirty) {
        changes["llm.vendor"] = pendingVendor;
      }

      for (const key of dirtyKeys) {
        const [vendorId, field] = key.split(".");
        const raw = editValues[key] ?? "";
        // Map "claude.model" → "llm.claude.model"
        changes[`llm.${vendorId}.${field}`] = raw.trim() === "" ? null : raw.trim();
      }

      for (const key of dirtyToggles) {
        if (key === "autoFailover") {
          changes["llm.autoFailover"] = editToggles.autoFailover;
        }
      }

      const res = await fetch("/api/llm/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setError((body as { error?: string }).error ?? "Failed to save");
        return;
      }

      const json = await res.json() as { config: LlmConfigResponse };
      setData(json.config);
      setEditValues({});
      setEditToggles({});
      setPendingVendor(undefined);

      setToast("LLM settings saved");
      if (toastRef.current) clearTimeout(toastRef.current);
      toastRef.current = setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [vendorDirty, pendingVendor, dirtyKeys, dirtyToggles, editValues, editToggles]);

  const handleDiscard = useCallback(() => {
    setEditValues({});
    setEditToggles({});
    setPendingVendor(undefined);
    setError(null);
  }, []);

  if (loading) {
    return h("div", { class: "llm-container" },
      h("div", { class: "loading" }, "Loading LLM provider settings\u2026"),
    );
  }

  if (error && !data) {
    return h("div", { class: "llm-container" },
      h("div", { class: "llm-header" },
        h("div", { class: "llm-header-brand" },
          h(NdxLogoPng, { size: 16, class: "llm-header-logo" }),
          h("span", { class: "llm-header-title" }, "LLM Provider"),
        ),
      ),
      h("div", { class: "llm-error-state" },
        h("p", null, error),
      ),
    );
  }

  const legacy = data?.legacyClaude;
  const showLegacy =
    legacy && (legacy.model || legacy.lightModel) &&
    !data?.claude.model && !data?.claude.lightModel;

  return h("div", { class: "llm-container" },
    // ── Header
    h("div", { class: "llm-header" },
      h("div", { class: "llm-header-brand" },
        h(NdxLogoPng, { size: 16, class: "llm-header-logo" }),
        h("span", { class: "llm-header-title" }, "LLM Provider"),
      ),
      h("p", { class: "llm-header-subtitle" },
        "General settings used by all LLM commands (",
        h("code", null, "ndx work"),
        ", ",
        h("code", null, "ndx plan"),
        ", ",
        h("code", null, "ndx recommend"),
        "). Select the active vendor and configure model IDs. ",
        "Changes are saved to ",
        h("code", null, ".n-dx.json"),
        " and take effect on the next run.",
      ),
    ),

    // ── Error banner
    error
      ? h("div", { class: "llm-error-banner" }, error)
      : null,

    // ── Vendor selector
    h(VendorSelector, {
      vendor: effectiveVendor,
      onChange: handleVendorChange,
    }),

    // ── Failover settings
    h("div", { class: "llm-failover-section" },
      h(ToggleField, {
        fieldKey: "autoFailover",
        label: "Automatic Failover",
        description: "When enabled, hench will retry failed runs on fallback models before surfacing the original error.",
        value: editToggles.autoFailover ?? data?.autoFailover ?? false,
        onChange: handleToggleChange,
        dirty: dirtyToggles.has("autoFailover"),
      }),
    ),

    // ── Per-vendor model sections
    h("div", { class: "llm-vendors" },
      VENDORS.map((v) =>
        h(VendorSection, {
          key: v.id,
          vendorId: v.id,
          config: data![v.id as "claude" | "codex"],
          editValues,
          onChange: handleFieldChange,
          dirtyKeys,
        }),
      ),
    ),

    // ── Legacy note
    showLegacy
      ? h("div", { class: "llm-legacy-notice" },
          h("span", { class: "llm-legacy-icon" }, "\u2139"),
          h("div", null,
            h("strong", null, "Legacy claude.* fields detected"),
            h("p", null,
              "Your ",
              h("code", null, ".n-dx.json"),
              " has legacy ",
              h("code", null, "claude.model"),
              legacy!.model ? ` (${legacy!.model})` : "",
              legacy!.lightModel ? ` / claude.lightModel (${legacy!.lightModel})` : "",
              ". Set the modern ",
              h("code", null, "llm.claude.*"),
              " fields above to override them.",
            ),
          ),
        )
      : null,

    // ── Save / Discard bar
    hasPendingChanges
      ? h("div", { class: "llm-save-bar" },
          h("span", { class: "llm-save-bar-hint" },
            `${dirtyKeys.size + dirtyToggles.size + (vendorDirty ? 1 : 0)} unsaved change${dirtyKeys.size + dirtyToggles.size + (vendorDirty ? 1 : 0) === 1 ? "" : "s"}`,
          ),
          h("button", {
            class: "llm-btn llm-btn-secondary",
            onClick: handleDiscard,
            disabled: saving,
          }, "Discard"),
          h("button", {
            class: "llm-btn llm-btn-primary",
            onClick: handleSave,
            disabled: saving,
          }, saving ? "Saving\u2026" : "Save changes"),
        )
      : null,

    h(SaveToast, { message: toast }),
  );
}

/**
 * Project Settings view — configure project-level n-dx settings.
 *
 * Surfaces the following fields from `.n-dx.json`:
 * - web.port           — dashboard server port (numeric, 1–65535)
 * - language           — project language override (select)
 * - sourcevision.zones.mergeThreshold — zone merge sensitivity (0–1)
 * - sourcevision.zones.pins           — file → zone override map (key-value)
 *
 * Data comes from GET /api/project-settings (read) and
 * PUT /api/project-settings (update).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { NdxLogoPng } from "../components/index.js";

// ── Types ─────────────────────────────────────────────────────────────

interface ProjectSettingsResponse {
  port: number | null;
  language: string | null;
  sourcevisionMergeThreshold: number | null;
  sourcevisionPins: Record<string, string>;
}

// ── Constants ─────────────────────────────────────────────────────────

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "go", label: "Go" },
];

const DEFAULT_PORT = 3117;

// ── Toast ─────────────────────────────────────────────────────────────

function SaveToast({ message }: { message: string | null }) {
  if (!message) return null;
  return h("div", { class: "ps-toast", role: "status", "aria-live": "polite" },
    h("span", { class: "ps-toast-icon" }, "\u2714"),
    h("span", null, message),
  );
}

// ── Zone pins editor ──────────────────────────────────────────────────

interface PinRow {
  id: string;
  filePath: string;
  zoneId: string;
  saved: boolean;
}

function PinEditor({
  pins,
  onChange,
}: {
  pins: Record<string, string>;
  onChange: (updates: Record<string, string | null>) => void;
}) {
  const [rows, setRows] = useState<PinRow[]>(() =>
    Object.entries(pins).map(([filePath, zoneId], i) => ({
      id: String(i),
      filePath,
      zoneId,
      saved: true,
    })),
  );

  // Sync when props change (after save)
  const propsRef = useRef(pins);
  useEffect(() => {
    if (pins === propsRef.current) return;
    propsRef.current = pins;
    setRows(
      Object.entries(pins).map(([filePath, zoneId], i) => ({
        id: String(i),
        filePath,
        zoneId,
        saved: true,
      })),
    );
  }, [pins]);

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      { id: String(Date.now()), filePath: "", zoneId: "", saved: false },
    ]);
  }, []);

  const updateRow = useCallback((id: string, field: "filePath" | "zoneId", value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value, saved: false } : r)),
    );
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      const removed = prev.find((r) => r.id === id);
      const next = prev.filter((r) => r.id !== id);
      // Signal removal of saved key
      if (removed?.saved && removed.filePath) {
        onChange({ [removed.filePath]: null });
      }
      return next;
    });
  }, [onChange]);

  // Emit changes whenever rows mutate
  const rowsRef = useRef(rows);
  useEffect(() => {
    if (rows === rowsRef.current) return;
    rowsRef.current = rows;
    const updates: Record<string, string | null> = {};
    for (const row of rows) {
      if (!row.saved && row.filePath) {
        updates[row.filePath] = row.zoneId || null;
      }
    }
    if (Object.keys(updates).length > 0) onChange(updates);
  }, [rows, onChange]);

  return h("div", { class: "ps-pin-editor" },
    rows.length === 0
      ? h("p", { class: "ps-pin-empty" }, "No zone pins configured. Add a pin to override zone detection for a specific file.")
      : h("table", { class: "ps-pin-table" },
          h("thead", null,
            h("tr", null,
              h("th", null, "File path"),
              h("th", null, "Zone ID"),
              h("th", null),
            ),
          ),
          h("tbody", null,
            rows.map((row) =>
              h("tr", { key: row.id },
                h("td", null,
                  h("input", {
                    type: "text",
                    class: "ps-pin-input",
                    value: row.filePath,
                    placeholder: "src/server/index.ts",
                    onInput: (e: Event) =>
                      updateRow(row.id, "filePath", (e.target as HTMLInputElement).value),
                  }),
                ),
                h("td", null,
                  h("input", {
                    type: "text",
                    class: "ps-pin-input",
                    value: row.zoneId,
                    placeholder: "web-server",
                    onInput: (e: Event) =>
                      updateRow(row.id, "zoneId", (e.target as HTMLInputElement).value),
                  }),
                ),
                h("td", null,
                  h("button", {
                    class: "ps-pin-remove",
                    onClick: () => removeRow(row.id),
                    "aria-label": "Remove pin",
                    title: "Remove",
                  }, "\u2715"),
                ),
              ),
            ),
          ),
        ),
    h("button", { class: "ps-pin-add", onClick: addRow },
      h("span", { "aria-hidden": "true" }, "+"),
      " Add pin",
    ),
  );
}

// ── Main view ─────────────────────────────────────────────────────────

export function ProjectSettingsView() {
  const [data, setData] = useState<ProjectSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Editable state (strings for controlled inputs)
  const [portRaw, setPortRaw] = useState<string>("");
  const [language, setLanguage] = useState<string>("auto");
  const [mergeThreshold, setMergeThreshold] = useState<string>("");
  // Pending pin updates: filePath → zoneId | null (null = remove)
  const [pinUpdates, setPinUpdates] = useState<Record<string, string | null>>({});

  const [portError, setPortError] = useState<string | null>(null);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/project-settings");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load project settings");
        return;
      }
      const json = await res.json() as ProjectSettingsResponse;
      setData(json);
      setPortRaw(json.port != null ? String(json.port) : "");
      setLanguage(json.language ?? "auto");
      setMergeThreshold(
        json.sourcevisionMergeThreshold != null
          ? String(json.sourcevisionMergeThreshold)
          : "",
      );
      setPinUpdates({});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  useEffect(() => {
    return () => {
      if (toastRef.current) clearTimeout(toastRef.current);
    };
  }, []);

  // Validation helpers
  const validatePort = useCallback((raw: string): string | null => {
    if (raw === "") return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return "Must be an integer between 1 and 65535";
    return null;
  }, []);

  const validateMerge = useCallback((raw: string): string | null => {
    if (raw === "") return null;
    const n = Number(raw);
    if (isNaN(n) || n < 0 || n > 1) return "Must be a number between 0 and 1";
    return null;
  }, []);

  const handlePortChange = useCallback((raw: string) => {
    setPortRaw(raw);
    setPortError(validatePort(raw));
  }, [validatePort]);

  const handleMergeChange = useCallback((raw: string) => {
    setMergeThreshold(raw);
    setMergeError(validateMerge(raw));
  }, [validateMerge]);

  const handlePinUpdates = useCallback((updates: Record<string, string | null>) => {
    setPinUpdates((prev) => ({ ...prev, ...updates }));
  }, []);

  // Dirty detection
  const portDirty = data != null && portRaw !== (data.port != null ? String(data.port) : "");
  const langDirty = data != null && language !== (data.language ?? "auto");
  const mergeDirty =
    data != null &&
    mergeThreshold !==
      (data.sourcevisionMergeThreshold != null ? String(data.sourcevisionMergeThreshold) : "");
  const pinsDirty = Object.keys(pinUpdates).length > 0;
  const hasPendingChanges = portDirty || langDirty || mergeDirty || pinsDirty;
  const hasErrors = portError != null || mergeError != null;

  const handleSave = useCallback(async () => {
    if (hasErrors) return;
    setSaving(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {};

      if (portDirty) {
        body["port"] = portRaw === "" ? null : parseInt(portRaw, 10);
      }
      if (langDirty) {
        body["language"] = language === "auto" ? null : language;
      }
      if (mergeDirty) {
        body["sourcevisionMergeThreshold"] =
          mergeThreshold === "" ? null : parseFloat(mergeThreshold);
      }
      if (pinsDirty) {
        body["sourcevisionPins"] = pinUpdates;
      }

      const res = await fetch("/api/project-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Save failed" }));
        setError((errBody as { error?: string }).error ?? "Failed to save");
        return;
      }

      const json = await res.json() as { settings: ProjectSettingsResponse };
      const s = json.settings;
      setData(s);
      setPortRaw(s.port != null ? String(s.port) : "");
      setLanguage(s.language ?? "auto");
      setMergeThreshold(
        s.sourcevisionMergeThreshold != null ? String(s.sourcevisionMergeThreshold) : "",
      );
      setPinUpdates({});

      setToast("Project settings saved");
      if (toastRef.current) clearTimeout(toastRef.current);
      toastRef.current = setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [
    hasErrors,
    portDirty,
    portRaw,
    langDirty,
    language,
    mergeDirty,
    mergeThreshold,
    pinsDirty,
    pinUpdates,
  ]);

  const handleDiscard = useCallback(() => {
    if (!data) return;
    setPortRaw(data.port != null ? String(data.port) : "");
    setLanguage(data.language ?? "auto");
    setMergeThreshold(
      data.sourcevisionMergeThreshold != null ? String(data.sourcevisionMergeThreshold) : "",
    );
    setPinUpdates({});
    setPortError(null);
    setMergeError(null);
    setError(null);
  }, [data]);

  if (loading) {
    return h("div", { class: "ps-container" },
      h("div", { class: "loading" }, "Loading project settings\u2026"),
    );
  }

  if (error && !data) {
    return h("div", { class: "ps-container" },
      h("div", { class: "ps-header" },
        h("div", { class: "ps-header-brand" },
          h(NdxLogoPng, { size: 16, class: "ps-header-logo" }),
          h("span", { class: "ps-header-title" }, "Project Settings"),
        ),
      ),
      h("div", { class: "ps-error-state" }, h("p", null, error)),
    );
  }

  return h("div", { class: "ps-container" },
    // ── Header
    h("div", { class: "ps-header" },
      h("div", { class: "ps-header-brand" },
        h(NdxLogoPng, { size: 16, class: "ps-header-logo" }),
        h("span", { class: "ps-header-title" }, "Project Settings"),
      ),
      h("p", { class: "ps-header-subtitle" },
        "Project-level configuration stored in ",
        h("code", null, ".n-dx.json"),
        ". Controls language detection (all commands), zone analysis (",
        h("code", null, "ndx analyze / plan"),
        "), and dashboard port (",
        h("code", null, "ndx start"),
        ").",
      ),
    ),

    // ── Error banner
    error ? h("div", { class: "ps-error-banner" }, error) : null,

    // ── General section (affects all commands)
    h("section", { class: "ps-section" },
      h("h3", { class: "ps-section-title" },
        h("span", { class: "ps-section-icon" }, "\u2699"),
        "General",
        h("span", { class: "ps-section-cmd" }, "all commands"),
      ),
      h("div", { class: "ps-field" },
        h("label", { class: "ps-field-label", htmlFor: "ps-language" },
          "Project language",
          langDirty ? h("span", { class: "ps-dirty-indicator" }, " \u2022") : null,
        ),
        h("p", { class: "ps-field-desc" },
          "Override the auto-detected project language. Used by sourcevision analysis, ",
          "hench guard defaults, and ndx init. Leave as Auto-detect for most projects.",
        ),
        h("select", {
          id: "ps-language",
          class: "ps-select",
          value: language,
          onChange: (e: Event) => setLanguage((e.target as HTMLSelectElement).value),
        },
          LANGUAGE_OPTIONS.map((opt) =>
            h("option", { key: opt.value, value: opt.value }, opt.label),
          ),
        ),
      ),
    ),

    // ── ndx analyze / plan section
    h("section", { class: "ps-section" },
      h("h3", { class: "ps-section-title" },
        h("span", { class: "ps-section-icon" }, "\u25A3"),
        "ndx analyze / plan",
      ),
      h("p", { class: "ps-section-desc" },
        "Zone detection settings for ",
        h("code", null, "ndx analyze"),
        " and ",
        h("code", null, "ndx plan"),
        ".",
      ),
      h("div", { class: "ps-field" },
        h("label", { class: "ps-field-label", htmlFor: "ps-merge-threshold" },
          "Merge threshold",
          mergeDirty ? h("span", { class: "ps-dirty-indicator" }, " \u2022") : null,
        ),
        h("p", { class: "ps-field-desc" },
          "Louvain modularity threshold for zone merging (0\u20131). ",
          "Lower values produce more zones; higher values produce fewer. Default: 0.5.",
        ),
        h("div", { class: "ps-field-row" },
          h("input", {
            id: "ps-merge-threshold",
            type: "number",
            class: `ps-number-input${mergeError ? " ps-input-error" : ""}`,
            value: mergeThreshold,
            min: 0,
            max: 1,
            step: 0.05,
            placeholder: "0.5",
            onInput: (e: Event) => handleMergeChange((e.target as HTMLInputElement).value),
          }),
          mergeThreshold === "" && !mergeDirty
            ? h("span", { class: "ps-field-default" }, "Using default (0.5)")
            : null,
        ),
        mergeError ? h("p", { class: "ps-field-error" }, mergeError) : null,
      ),
      h("div", { class: "ps-field" },
        h("label", { class: "ps-field-label" },
          "Zone pins",
          pinsDirty ? h("span", { class: "ps-dirty-indicator" }, " \u2022") : null,
        ),
        h("p", { class: "ps-field-desc" },
          "Pin specific files to named zones, overriding Louvain community detection. ",
          "Useful when a file is repeatedly misclassified.",
        ),
        h(PinEditor, {
          pins: data?.sourcevisionPins ?? {},
          onChange: handlePinUpdates,
        }),
      ),
    ),

    // ── ndx start section
    h("section", { class: "ps-section" },
      h("h3", { class: "ps-section-title" },
        h("span", { class: "ps-section-icon" }, "\uD83C\uDF10"),
        "ndx start",
      ),
      h("div", { class: "ps-field" },
        h("label", { class: "ps-field-label", htmlFor: "ps-port" },
          "Dashboard port",
          portDirty ? h("span", { class: "ps-dirty-indicator" }, " \u2022") : null,
        ),
        h("p", { class: "ps-field-desc" },
          `Port the web dashboard listens on. Default: ${DEFAULT_PORT}. `,
          "Change takes effect after restarting the server (",
          h("code", null, "ndx start stop && ndx start"),
          ").",
        ),
        h("div", { class: "ps-field-row" },
          h("input", {
            id: "ps-port",
            type: "number",
            class: `ps-number-input${portError ? " ps-input-error" : ""}`,
            value: portRaw,
            min: 1,
            max: 65535,
            placeholder: String(DEFAULT_PORT),
            onInput: (e: Event) => handlePortChange((e.target as HTMLInputElement).value),
          }),
          portRaw === "" && !portDirty
            ? h("span", { class: "ps-field-default" }, `Using default (${DEFAULT_PORT})`)
            : null,
        ),
        portError
          ? h("p", { class: "ps-field-error" }, portError)
          : null,
      ),
    ),

    // ── Save / Discard bar
    hasPendingChanges
      ? h("div", { class: "ps-save-bar" },
          h("span", { class: "ps-save-bar-hint" },
            hasErrors ? "Fix errors before saving" : "You have unsaved changes",
          ),
          h("button", {
            class: "ps-btn ps-btn-secondary",
            onClick: handleDiscard,
            disabled: saving,
          }, "Discard"),
          h("button", {
            class: `ps-btn ps-btn-primary${hasErrors ? " ps-btn-disabled" : ""}`,
            onClick: handleSave,
            disabled: saving || hasErrors,
          }, saving ? "Saving\u2026" : "Save changes"),
        )
      : null,

    h(SaveToast, { message: toast }),
  );
}

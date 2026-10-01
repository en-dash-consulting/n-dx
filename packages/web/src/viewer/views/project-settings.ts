/**
 * Project settings section — the project-level n-dx settings the Project page
 * renders: language, zone analysis (`analyze` / `plan`) and the dashboard port.
 *
 * Surfaces the following fields from `.n-dx.json`:
 * - web.port           — dashboard server port (numeric, 1–65535)
 * - language           — project language override (select)
 * - sourcevision.zones.mergeThreshold — small-zone merge threshold (min zone size in files)
 * - sourcevision.zones.pins           — file → zone override map (key-value)
 *
 * Data comes from GET /api/project-settings (read) and
 * PUT /api/project-settings (update). The page owns the frame and the Save
 * button; this module owns the form state (`useProjectSettingsForm`) and the
 * fields (`ProjectSettingsSection`).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { useCliName } from "../hooks/index.js";

// ── Types ─────────────────────────────────────────────────────────────

interface ProjectSettingsResponse {
  port: number | null;
  language: string | null;
  sourcevisionMergeThreshold: number | null;
  sourcevisionPins: Record<string, string>;
}

/** One editable row of the zone-pins table. `id` is a stable render key. */
interface PinRow {
  id: number;
  filePath: string;
  zoneId: string;
}

// ── Constants ─────────────────────────────────────────────────────────

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "go", label: "Go" },
];

const DEFAULT_PORT = 3117;

function validatePort(raw: string): string | null {
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return "Must be an integer between 1 and 65535";
  return null;
}

function validateMerge(raw: string): string | null {
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return "Must be a non-negative integer (zone size in files)";
  return null;
}

const asText = (n: number | null): string => (n != null ? String(n) : "");

function rowsFrom(pins: Record<string, string>): PinRow[] {
  return Object.entries(pins).map(([filePath, zoneId], i) => ({ id: i, filePath, zoneId }));
}

/**
 * The PUT body for a pins table: a removed or renamed path maps to null, a new
 * or changed pin to its zone. A row with no path is not a pin yet and is ignored.
 */
export function diffPins(
  saved: Record<string, string>,
  rows: readonly PinRow[],
): Record<string, string | null> {
  const wanted = new Map<string, string>();
  for (const row of rows) {
    if (row.filePath) wanted.set(row.filePath, row.zoneId);
  }
  const updates: Record<string, string | null> = {};
  for (const path of Object.keys(saved)) {
    if (!wanted.has(path)) updates[path] = null;
  }
  for (const [path, zoneId] of wanted) {
    if (saved[path] !== zoneId) updates[path] = zoneId || null;
  }
  return updates;
}

// ── Form state ────────────────────────────────────────────────────────

/** State and actions of the project-settings form. The Project page owns it. */
export interface ProjectSettingsForm {
  data: ProjectSettingsResponse | null;
  loading: boolean;
  /** Why the settings could not be loaded. */
  loadError: string | null;
  /** Why the last save failed. Cleared by the next save or a discard. */
  saveError: string | null;
  portRaw: string;
  language: string;
  mergeThreshold: string;
  pinRows: PinRow[];
  portError: string | null;
  mergeError: string | null;
  portDirty: boolean;
  langDirty: boolean;
  mergeDirty: boolean;
  pinsDirty: boolean;
  /** True while any field differs from its saved value. */
  dirty: boolean;
  setPortRaw: (raw: string) => void;
  setLanguage: (value: string) => void;
  setMergeThreshold: (raw: string) => void;
  addPin: () => void;
  updatePin: (id: number, field: "filePath" | "zoneId", value: string) => void;
  removePin: (id: number) => void;
  /**
   * PUT the changed fields to /api/project-settings. Resolves true once saved
   * (or when nothing is dirty); false leaves the edits in place with
   * `saveError` set.
   */
  save: () => Promise<boolean>;
  /** Restore every field to its saved value. */
  discard: () => void;
}

export function useProjectSettingsForm(): ProjectSettingsForm {
  const [data, setData] = useState<ProjectSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [portRaw, setPortRaw] = useState("");
  const [language, setLanguage] = useState("auto");
  const [mergeThreshold, setMergeThreshold] = useState("");
  const [pinRows, setPinRows] = useState<PinRow[]>([]);
  const [nextPinId, setNextPinId] = useState(0);

  /** Make `s` the saved state and every field show it. */
  const adopt = useCallback((s: ProjectSettingsResponse) => {
    setData(s);
    setPortRaw(asText(s.port));
    setLanguage(s.language ?? "auto");
    setMergeThreshold(asText(s.sourcevisionMergeThreshold));
    const rows = rowsFrom(s.sourcevisionPins);
    setPinRows(rows);
    setNextPinId(rows.length);
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/project-settings");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setLoadError((body as { error?: string }).error ?? "Failed to load project settings");
        return;
      }
      adopt(await res.json() as ProjectSettingsResponse);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load project settings");
    } finally {
      setLoading(false);
    }
  }, [adopt]);

  useEffect(() => { void fetchSettings(); }, [fetchSettings]);

  const portError = validatePort(portRaw);
  const mergeError = validateMerge(mergeThreshold);

  const savedPins = data?.sourcevisionPins;
  const pinUpdates = useMemo(
    () => (savedPins ? diffPins(savedPins, pinRows) : {}),
    [savedPins, pinRows],
  );

  const portDirty = data != null && portRaw !== asText(data.port);
  const langDirty = data != null && language !== (data.language ?? "auto");
  const mergeDirty = data != null && mergeThreshold !== asText(data.sourcevisionMergeThreshold);
  const pinsDirty = Object.keys(pinUpdates).length > 0;
  const dirty = portDirty || langDirty || mergeDirty || pinsDirty;
  const hasErrors = portError != null || mergeError != null;

  const addPin = useCallback(() => {
    setPinRows((prev) => [...prev, { id: nextPinId, filePath: "", zoneId: "" }]);
    setNextPinId((n) => n + 1);
  }, [nextPinId]);

  const updatePin = useCallback((id: number, field: "filePath" | "zoneId", value: string) => {
    setPinRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }, []);

  const removePin = useCallback((id: number) => {
    setPinRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaveError(null);
    if (hasErrors) {
      setSaveError("Fix the invalid project settings before saving");
      return false;
    }
    const body: Record<string, unknown> = {};
    if (portDirty) body["port"] = portRaw === "" ? null : parseInt(portRaw, 10);
    if (langDirty) body["language"] = language === "auto" ? null : language;
    if (mergeDirty) {
      body["sourcevisionMergeThreshold"] =
        mergeThreshold === "" ? null : parseInt(mergeThreshold, 10);
    }
    if (pinsDirty) body["sourcevisionPins"] = pinUpdates;

    try {
      const res = await fetch("/api/project-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveError((errBody as { error?: string }).error ?? "Failed to save");
        return false;
      }
      adopt((await res.json() as { settings: ProjectSettingsResponse }).settings);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
      return false;
    }
  }, [
    dirty, hasErrors, portDirty, portRaw, langDirty, language,
    mergeDirty, mergeThreshold, pinsDirty, pinUpdates, adopt,
  ]);

  const discard = useCallback(() => {
    if (data) adopt(data);
    setSaveError(null);
  }, [data, adopt]);

  return {
    data, loading, loadError, saveError,
    portRaw, language, mergeThreshold, pinRows,
    portError, mergeError,
    portDirty, langDirty, mergeDirty, pinsDirty, dirty,
    setPortRaw, setLanguage, setMergeThreshold,
    addPin, updatePin, removePin,
    save, discard,
  };
}

// ── Zone pins editor ──────────────────────────────────────────────────

function PinEditor({ form }: { form: ProjectSettingsForm }) {
  const { pinRows } = form;
  return h("div", { class: "ps-pin-editor" },
    pinRows.length === 0
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
            pinRows.map((row) =>
              h("tr", { key: row.id },
                h("td", null,
                  h("input", {
                    type: "text",
                    class: "ps-pin-input",
                    value: row.filePath,
                    placeholder: "src/server/index.ts",
                    "aria-label": "Pinned file path",
                    onInput: (e: Event) =>
                      form.updatePin(row.id, "filePath", (e.target as HTMLInputElement).value),
                  }),
                ),
                h("td", null,
                  h("input", {
                    type: "text",
                    class: "ps-pin-input",
                    value: row.zoneId,
                    placeholder: "web-server",
                    "aria-label": "Pinned zone ID",
                    onInput: (e: Event) =>
                      form.updatePin(row.id, "zoneId", (e.target as HTMLInputElement).value),
                  }),
                ),
                h("td", null,
                  h("button", {
                    type: "button",
                    class: "ps-pin-remove",
                    onClick: () => form.removePin(row.id),
                    "aria-label": "Remove pin",
                    title: "Remove",
                  }, "✕"),
                ),
              ),
            ),
          ),
        ),
    h("button", { type: "button", class: "ps-pin-add", onClick: form.addPin },
      h("span", { "aria-hidden": "true" }, "+"),
      " Add pin",
    ),
  );
}

// ── Section ───────────────────────────────────────────────────────────

/** A fresh vnode per use: one vnode object must not be mounted in two places. */
const dirtyMark = () => h("span", { class: "ps-dirty-indicator" }, " •");

export function ProjectSettingsSection({ form }: { form: ProjectSettingsForm }) {
  const cliName = useCliName();

  if (form.loading) {
    return h("div", { class: "loading" }, "Loading project settings…");
  }

  if (form.loadError && !form.data) {
    return h("div", { class: "ps-error-state" }, h("p", null, form.loadError));
  }

  const { portRaw, mergeThreshold, portError, mergeError } = form;

  return h("div", { class: "ps-sections" },
    form.saveError ? h("div", { class: "ps-error-banner", role: "alert" }, form.saveError) : null,

    // ── General (affects all commands)
    h("section", { class: "ps-section" },
      h("h3", { class: "ps-section-title" },
        h("span", { class: "ps-section-icon" }, "⚙"),
        "General",
        h("span", { class: "ps-section-cmd" }, "all commands"),
      ),
      h("div", { class: "ps-field" },
        h("label", { class: "ps-field-label", htmlFor: "ps-language" },
          "Project language",
          form.langDirty ? dirtyMark() : null,
        ),
        h("p", { class: "ps-field-desc" },
          "Override the auto-detected project language. Used by sourcevision analysis, ",
          `hench guard defaults, and ${cliName} init. Leave as Auto-detect for most projects.`,
        ),
        h("select", {
          id: "ps-language",
          class: "ps-select",
          value: form.language,
          onChange: (e: Event) => form.setLanguage((e.target as HTMLSelectElement).value),
        },
          LANGUAGE_OPTIONS.map((opt) =>
            h("option", { key: opt.value, value: opt.value }, opt.label),
          ),
        ),
      ),
    ),

    // ── ndx analyze / plan
    h("section", { class: "ps-section" },
      h("h3", { class: "ps-section-title" },
        h("span", { class: "ps-section-icon" }, "▣"),
        `${cliName} analyze / plan`,
      ),
      h("p", { class: "ps-section-desc" },
        "Zone detection settings for ",
        h("code", null, `${cliName} analyze`),
        " and ",
        h("code", null, `${cliName} plan`),
        ".",
      ),
      h("div", { class: "ps-field" },
        h("label", { class: "ps-field-label", htmlFor: "ps-merge-threshold" },
          "Merge threshold",
          form.mergeDirty ? dirtyMark() : null,
        ),
        h("p", { class: "ps-field-desc" },
          "Minimum zone size in files: zones with fewer files are merged into ",
          "their closest neighbor by import affinity. Higher values produce fewer, ",
          "larger zones. Default: 3.",
        ),
        h("div", { class: "ps-field-row" },
          h("input", {
            id: "ps-merge-threshold",
            type: "number",
            class: `ps-number-input${mergeError ? " ps-input-error" : ""}`,
            value: mergeThreshold,
            min: 0,
            step: 1,
            placeholder: "3",
            onInput: (e: Event) => form.setMergeThreshold((e.target as HTMLInputElement).value),
          }),
          mergeThreshold === "" && !form.mergeDirty
            ? h("span", { class: "ps-field-default" }, "Using default (3)")
            : null,
        ),
        mergeError ? h("p", { class: "ps-field-error" }, mergeError) : null,
      ),
      h("div", { class: "ps-field" },
        h("span", { class: "ps-field-label" },
          "Zone pins",
          form.pinsDirty ? dirtyMark() : null,
        ),
        h("p", { class: "ps-field-desc" },
          "Pin specific files to named zones, overriding Louvain community detection. ",
          "Useful when a file is repeatedly misclassified.",
        ),
        h(PinEditor, { form }),
      ),
    ),

    // ── ndx start
    h("section", { class: "ps-section" },
      h("h3", { class: "ps-section-title" },
        h("span", { class: "ps-section-icon" }, "🌐"),
        `${cliName} start`,
      ),
      h("div", { class: "ps-field" },
        h("label", { class: "ps-field-label", htmlFor: "ps-port" },
          "Dashboard port",
          form.portDirty ? dirtyMark() : null,
        ),
        h("p", { class: "ps-field-desc" },
          `Port the web dashboard listens on. Default: ${DEFAULT_PORT}. `,
          "Change takes effect after restarting the server (",
          h("code", null, `${cliName} start stop && ${cliName} start`),
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
            onInput: (e: Event) => form.setPortRaw((e.target as HTMLInputElement).value),
          }),
          portRaw === "" && !form.portDirty
            ? h("span", { class: "ps-field-default" }, `Using default (${DEFAULT_PORT})`)
            : null,
        ),
        portError ? h("p", { class: "ps-field-error" }, portError) : null,
      ),
    ),
  );
}

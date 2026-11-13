/**
 * Project settings — the project-level n-dx settings the Project page renders
 * as rows: language and zone analysis under Analysis, the port under Dashboard.
 *
 * Surfaces the following fields from `.n-dx.json`:
 * - web.port           — dashboard server port (numeric, 1–65535)
 * - language           — project language override (select)
 * - sourcevision.zones.mergeThreshold — small-zone merge threshold (min zone size in files)
 * - sourcevision.zones.pins           — file → zone override map (key-value)
 * - web.sidecarGithubReads           — the server saves it to the local config
 *
 * Data comes from GET /api/project-settings (read) and
 * PUT /api/project-settings (update). The page owns the frame and the Save
 * button; this module owns the form state (`useProjectSettingsForm`) and the
 * rows (`projectSettingRows`).
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { ActionIcon } from "../components/index.js";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { SettingRow, Switch, type SettingRowSpec } from "./setting-row.js";
import type { ProjectSectionId } from "./project-sections.js";

// ── Types ─────────────────────────────────────────────────────────────

interface ProjectSettingsResponse {
  port: number | null;
  language: string | null;
  sourcevisionMergeThreshold: number | null;
  sourcevisionPins: Record<string, string>;
  /** `web.sidecarGithubReads` in force. */
  githubReads: boolean;
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
  /** Something the last save could not do although it succeeded. Cleared like saveError. */
  notice: string | null;
  portRaw: string;
  language: string;
  mergeThreshold: string;
  pinRows: PinRow[];
  githubReads: boolean;
  portError: string | null;
  mergeError: string | null;
  portDirty: boolean;
  langDirty: boolean;
  mergeDirty: boolean;
  pinsDirty: boolean;
  githubReadsDirty: boolean;
  /** True while any field differs from its saved value. */
  dirty: boolean;
  setPortRaw: (raw: string) => void;
  setLanguage: (value: string) => void;
  setMergeThreshold: (raw: string) => void;
  setGithubReads: (on: boolean) => void;
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
  const [notice, setNotice] = useState<string | null>(null);

  const [portRaw, setPortRaw] = useState("");
  const [githubReads, setGithubReads] = useState(false);
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
    setGithubReads(s.githubReads === true);
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
  const githubReadsDirty = data != null && githubReads !== (data.githubReads === true);
  const dirty = portDirty || langDirty || mergeDirty || pinsDirty || githubReadsDirty;
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
    setNotice(null);
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
    if (githubReadsDirty) body["githubReads"] = githubReads;

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
      const saved = (await res.json() as { settings: ProjectSettingsResponse }).settings;
      adopt(saved);
      // The answer is the value in force, which is not always the one saved:
      // a local config that git tracks is honoured only in a trusted checkout.
      if (githubReadsDirty && saved.githubReads !== githubReads) {
        setNotice("Saved, but GitHub reads are still off: this checkout's local config is tracked by git, so it applies only once the checkout is trusted.");
      }
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
      return false;
    }
  }, [
    dirty, hasErrors, portDirty, portRaw, langDirty, language,
    mergeDirty, mergeThreshold, pinsDirty, pinUpdates, githubReadsDirty, githubReads, adopt,
  ]);

  const discard = useCallback(() => {
    if (data) adopt(data);
    setSaveError(null);
    setNotice(null);
  }, [data, adopt]);

  return {
    data, loading, loadError, saveError, notice,
    portRaw, language, mergeThreshold, pinRows, githubReads,
    portError, mergeError,
    portDirty, langDirty, mergeDirty, pinsDirty, githubReadsDirty, dirty,
    setPortRaw, setLanguage, setMergeThreshold, setGithubReads,
    addPin, updatePin, removePin,
    save, discard,
  };
}

// ── Zone pins editor ──────────────────────────────────────────────────

function PinEditor({ form }: { form: ProjectSettingsForm }) {
  const { pinRows } = form;
  return h("div", { class: "ps-pin-editor", id: "ps-pin-editor" },
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
                  }, h(ActionIcon, { name: "close" })),
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

// ── Rows ──────────────────────────────────────────────────────────────

const PINS_KEY = "sourcevision.zones.pins";

/** Zone pins collapse to a count; Edit opens the table in place. */
function PinsRow({ form }: { form: ProjectSettingsForm }) {
  const [open, setOpen] = useState(false);
  const count = form.pinRows.filter((r) => r.filePath).length;
  return h(SettingRow, {
    configKey: PINS_KEY,
    label: "Zone pins",
    description: "Pin a file to a named zone when zone detection keeps placing it wrong.",
    unsaved: form.pinsDirty,
    control: h("span", { class: "srow-inline" },
      h("span", { class: "srow-value" }, count === 1 ? "1 pin" : `${count} pins`),
      h("button", {
        type: "button",
        class: "srow-button",
        "aria-expanded": String(open),
        "aria-controls": "ps-pin-editor",
        onClick: () => setOpen(!open),
      }, open ? "Done" : "Edit"),
    ),
  }, open ? h(PinEditor, { form }) : null);
}

const GITHUB_READS_KEY = "web.sidecarGithubReads";
const GITHUB_READS_DESC = "Let the Sidecar and branch health read pull requests, issues and checks with gh, without asking each time.";

/**
 * The project settings as rows: language, merge threshold and zone pins under
 * Analysis, the port under Dashboard, and GitHub reads under Connections while
 * something that uses it (the Sidecar, branch health) is on — or while it
 * holds an unsaved edit, so a save that failed as its readers were turned off
 * leaves the edit on screen to retry or discard.
 */
export function projectSettingRows(
  form: ProjectSettingsForm,
  cliName: string,
  { githubReadsUsed }: { githubReadsUsed: boolean },
): SettingRowSpec<ProjectSectionId>[] {
  if (!form.data) return [];
  const { portRaw, mergeThreshold, portError, mergeError } = form;
  const spec = (section: ProjectSectionId, configKey: string, label: string, description: string, node: ComponentChildren): SettingRowSpec<ProjectSectionId> =>
    ({ section, configKey, searchText: `${label} ${description} ${configKey}`, node });

  const languageDesc = `The project's language, when auto-detection gets it wrong. Analysis, hench's guard defaults and ${cliName} init use it.`;
  const mergeDesc = "Zones with fewer files than this merge into their closest neighbour. Higher means fewer, larger zones.";
  const portDesc = `The port ${cliName} start serves the dashboard on.`;

  return [
    spec("analysis", "language", "Project language", languageDesc, h(SettingRow, {
      key: "language",
      configKey: "language",
      label: "Project language",
      description: languageDesc,
      controlId: "ps-language",
      unsaved: form.langDirty,
      onReset: form.language !== "auto" ? () => form.setLanguage("auto") : undefined,
      control: h("select", {
        id: "ps-language",
        class: "ps-select",
        value: form.language,
        onChange: (e: Event) => form.setLanguage((e.target as HTMLSelectElement).value),
      }, LANGUAGE_OPTIONS.map((opt) => h("option", { key: opt.value, value: opt.value }, opt.label))),
    })),
    spec("analysis", "sourcevision.zones.mergeThreshold", "Merge threshold", mergeDesc, h(SettingRow, {
      key: "merge",
      configKey: "sourcevision.zones.mergeThreshold",
      label: "Merge threshold",
      description: mergeDesc,
      controlId: "ps-merge-threshold",
      unsaved: form.mergeDirty,
      onReset: mergeThreshold !== "" ? () => form.setMergeThreshold("") : undefined,
      control: h("input", {
        id: "ps-merge-threshold",
        type: "number",
        class: `ps-number-input${mergeError ? " ps-input-error" : ""}`,
        value: mergeThreshold,
        min: 0,
        step: 1,
        placeholder: "3",
        "aria-describedby": mergeError ? "ps-merge-error" : undefined,
        onInput: (e: Event) => form.setMergeThreshold((e.target as HTMLInputElement).value),
      }),
    }, mergeError ? h("p", { id: "ps-merge-error", class: "ps-field-error" }, mergeError) : null)),
    spec("analysis", PINS_KEY, "Zone pins", "Pin a file to a named zone when zone detection keeps placing it wrong.",
      h(PinsRow, { key: "pins", form })),
    spec("dashboard", "web.port", "Dashboard port", portDesc, h(SettingRow, {
      key: "port",
      configKey: "web.port",
      label: "Dashboard port",
      description: portDesc,
      tags: ["Restart"],
      info: h("p", null,
        `Takes effect when the server restarts (`,
        h("code", null, `${cliName} start stop && ${cliName} start`),
        `). Empty uses ${DEFAULT_PORT}.`,
      ),
      controlId: "ps-port",
      unsaved: form.portDirty,
      onReset: portRaw !== "" ? () => form.setPortRaw("") : undefined,
      control: h("input", {
        id: "ps-port",
        type: "number",
        class: `ps-number-input${portError ? " ps-input-error" : ""}`,
        value: portRaw,
        min: 1,
        max: 65535,
        placeholder: String(DEFAULT_PORT),
        "aria-describedby": portError ? "ps-port-error" : undefined,
        onInput: (e: Event) => form.setPortRaw((e.target as HTMLInputElement).value),
      }),
    }, portError ? h("p", { id: "ps-port-error", class: "ps-field-error" }, portError) : null)),
    ...(githubReadsUsed || form.githubReadsDirty
      ? [spec("connections", GITHUB_READS_KEY, "GitHub reads", GITHUB_READS_DESC, h(SettingRow, {
          key: "github-reads",
          configKey: GITHUB_READS_KEY,
          label: "GitHub reads",
          description: GITHUB_READS_DESC,
          info: h("p", null,
            "Reads run with your own gh login. Off, each Sidecar read raises a card to approve, and branch health shows no GitHub facts. ",
            "Saved to your local config; the shared config's true applies only in a trusted checkout. It never allows a post.",
          ),
          unsaved: form.githubReadsDirty,
          onReset: form.githubReads ? () => form.setGithubReads(false) : undefined,
          control: h(Switch, { checked: form.githubReads, label: "Toggle GitHub reads", onChange: form.setGithubReads }),
        }))]
      : []),
  ];
}

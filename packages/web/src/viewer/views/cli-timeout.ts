/**
 * CLI timeouts — the timeout section of the Workflow page.
 *
 * Surfaces the global CLI timeout and per-command overrides from `.n-dx.json`
 * in an editable form. `useCliTimeoutsForm` owns the state; values are
 * validated client-side (non-numeric and negative values rejected inline)
 * before `save` writes them. `views/workflow.ts` composes the section onto
 * the shared SettingsFrame, which owns Save and the unsaved-changes prompt.
 *
 * Data comes from GET /api/cli/timeouts (read) and
 * PUT /api/cli/timeouts (write).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";

// ── Types ─────────────────────────────────────────────────────────────

interface CliTimeoutsResponse {
  timeoutMs: number | null;
  timeouts: Record<string, number>;
  defaultTimeoutMs: number;
  noDefaultTimeoutCommands: string[];
  /** The file the overrides live in, relative to the project root; the server resolves it. */
  configFile: string;
}

// ── Known commands with metadata ──────────────────────────────────────

interface CommandMeta {
  label: string;
  description: string;
  category: "analysis" | "workflow" | "server";
}

const KNOWN_COMMANDS: Record<string, CommandMeta> = {
  analyze: {
    label: "analyze",
    description: "Run sourcevision static analysis on the project.",
    category: "analysis",
  },
  recommend: {
    label: "recommend",
    description: "Generate PRD recommendations from sourcevision output.",
    category: "analysis",
  },
  plan: {
    label: "plan",
    description: "Analyze codebase and propose PRD items.",
    category: "analysis",
  },
  ci: {
    label: "ci",
    description: "Run the analysis pipeline and validate PRD health.",
    category: "analysis",
  },
  work: {
    label: "work",
    description: "Autonomous agent run (hench).",
    category: "workflow",
  },
  "self-heal": {
    label: "self-heal",
    description: "Iterative improvement loop: analyze → recommend → execute.",
    category: "workflow",
  },
  add: {
    label: "add",
    description: "Smart-add PRD items from freeform descriptions.",
    category: "workflow",
  },
  export: {
    label: "export",
    description: "Export a static deployable dashboard.",
    category: "workflow",
  },
  refresh: {
    label: "refresh",
    description: "Refresh dashboard artifacts.",
    category: "workflow",
  },
  start: {
    label: "start",
    description: "Start the web dashboard server. Runs indefinitely — no default timeout.",
    category: "server",
  },
  dev: {
    label: "dev",
    description: "Start the web dev server with live reload. Runs indefinitely — no default timeout.",
    category: "server",
  },
};

const CATEGORY_META: Record<string, { label: string; icon: string; description: string }> = {
  analysis: {
    label: "Analysis Commands",
    icon: "\u25A3",
    description: "Commands that scan the codebase or generate reports",
  },
  workflow: {
    label: "Workflow Commands",
    icon: "\u25B6",
    description: "Agent execution and PRD management commands",
  },
  server: {
    label: "Server Commands",
    icon: "\u{1F4BB}",
    description: "Long-running server processes — no default timeout applied",
  },
};

const CATEGORY_ORDER: Array<"analysis" | "workflow" | "server"> = ["analysis", "workflow", "server"];

// ── Helpers ───────────────────────────────────────────────────────────

/** Format milliseconds to a human-readable string. */
export function formatMs(ms: number): string {
  if (ms === 0) return "no timeout";
  if (ms < 60_000) return `${ms / 1000}s`;
  const minutes = Math.round(ms / 60_000);
  return `${minutes} min`;
}

/** Parse a raw input string to a number of milliseconds. Returns null if invalid. */
export function parseMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!isFinite(n) || isNaN(n)) return null;
  if (n < 0) return null;
  return n;
}

/** Validate a raw timeout input. Returns an error string or null if valid. */
export function validateTimeoutInput(raw: string, label: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return `${label} must not be empty`;
  const n = Number(trimmed);
  if (isNaN(n) || !isFinite(n)) return `${label} must be a valid number`;
  if (n < 0) return `${label} must be 0 or greater (0 = no timeout)`;
  if (!Number.isInteger(n)) return `${label} must be a whole number of milliseconds`;
  return null;
}

/** Check whether a raw input value differs from the current saved value. */
function isDirty(savedMs: number | null, raw: string, defaultMs: number): boolean {
  const n = parseMs(raw);
  if (n === null) return false; // invalid input — not considered a dirty save
  const effective = savedMs ?? defaultMs;
  return n !== effective;
}

// ── Field component ───────────────────────────────────────────────────

function TimeoutField({ fieldKey, label, description, savedMs, defaultMs, editValue, error, noDefaultTimeout, onchange, onReset }: {
  fieldKey: string;
  label: string;
  description: string;
  savedMs: number | null;
  defaultMs: number;
  editValue: string;
  error: string | null;
  noDefaultTimeout: boolean;
  onchange: (key: string, raw: string) => void;
  onReset: (key: string) => void;
}) {
  const dirty = isDirty(savedMs, editValue, defaultMs);
  const isModified = savedMs !== null;

  const parsedMs = parseMs(editValue);
  const preview = dirty && parsedMs !== null
    ? (parsedMs === 0 ? "Command will run without any time limit" : `Command will timeout after ${formatMs(parsedMs)}`)
    : null;

  return h("div", { class: `ct-field${isModified ? " ct-field-modified" : ""}${dirty ? " ct-field-dirty" : ""}` },
    h("div", { class: "ct-field-header" },
      h("div", { class: "ct-field-label-row" },
        h("span", { class: "ct-field-name" }, label),
        isModified ? h("span", { class: "ct-badge-modified" }, "modified") : null,
        dirty ? h("span", { class: "ct-badge-unsaved" }, "unsaved") : null,
      ),
      h("div", { class: "ct-field-actions" },
        h("span", { class: "ct-field-key" }, `cli.timeouts.${fieldKey}`),
        dirty
          ? h("button", {
              type: "button",
              class: "ct-reset-btn",
              onClick: () => onReset(fieldKey),
              title: "Revert to current saved value",
            }, "Revert")
          : null,
      ),
    ),
    h("p", { class: "ct-field-desc" }, description),
    h("div", { class: "ct-control-row" },
      h("input", {
        type: "number",
        class: `ct-input${error ? " ct-input-error" : ""}`,
        value: editValue,
        min: "0",
        step: "1",
        placeholder: noDefaultTimeout ? "0 (no timeout)" : String(defaultMs),
        onInput: (e: Event) => onchange(fieldKey, (e.target as HTMLInputElement).value),
        "aria-label": `Timeout for ${label} in milliseconds`,
      }),
      h("span", { class: "ct-input-unit" }, "ms"),
    ),
    preview
      ? h("div", { class: "ct-field-preview" },
          h("span", { class: "ct-field-preview-label" }, "Preview: "),
          preview,
        )
      : (savedMs !== null
          ? h("div", { class: "ct-field-impact" }, `Currently: ${formatMs(savedMs)}`)
          : h("div", { class: "ct-field-impact" }, noDefaultTimeout ? "No timeout by default" : `Default: ${formatMs(defaultMs)}`)),
    error ? h("div", { class: "ct-field-error" }, error) : null,
  );
}

// ── Global timeout field ──────────────────────────────────────────────

function GlobalTimeoutField({ savedMs, defaultMs, editValue, error, onchange, onReset }: {
  savedMs: number | null;
  defaultMs: number;
  editValue: string;
  error: string | null;
  onchange: (raw: string) => void;
  onReset: () => void;
}) {
  const dirty = isDirty(savedMs, editValue, defaultMs);
  const isModified = savedMs !== null;

  const parsedMs = parseMs(editValue);
  const preview = dirty && parsedMs !== null
    ? (parsedMs === 0 ? "All bounded commands will run without any time limit" : `All bounded commands will timeout after ${formatMs(parsedMs)} (unless overridden)`)
    : null;

  return h("div", { class: `ct-field${isModified ? " ct-field-modified" : ""}${dirty ? " ct-field-dirty" : ""}` },
    h("div", { class: "ct-field-header" },
      h("div", { class: "ct-field-label-row" },
        h("span", { class: "ct-field-name" }, "Global Default Timeout"),
        isModified ? h("span", { class: "ct-badge-modified" }, "modified") : null,
        dirty ? h("span", { class: "ct-badge-unsaved" }, "unsaved") : null,
      ),
      h("div", { class: "ct-field-actions" },
        h("span", { class: "ct-field-key" }, "cli.timeoutMs"),
        dirty
          ? h("button", {
              type: "button",
              class: "ct-reset-btn",
              onClick: onReset,
              title: "Revert to current saved value",
            }, "Revert")
          : null,
      ),
    ),
    h("p", { class: "ct-field-desc" },
      "Global timeout applied to all bounded CLI commands when no per-command override is set. " +
      "Set to 0 for no timeout. Leave unset to use the built-in default (30 minutes).",
    ),
    h("div", { class: "ct-control-row" },
      h("input", {
        type: "number",
        class: `ct-input${error ? " ct-input-error" : ""}`,
        value: editValue,
        min: "0",
        step: "1",
        placeholder: String(defaultMs),
        onInput: (e: Event) => onchange((e.target as HTMLInputElement).value),
        "aria-label": "Global CLI timeout in milliseconds",
      }),
      h("span", { class: "ct-input-unit" }, "ms"),
    ),
    preview
      ? h("div", { class: "ct-field-preview" },
          h("span", { class: "ct-field-preview-label" }, "Preview: "),
          preview,
        )
      : h("div", { class: "ct-field-impact" }, isModified ? `Currently: ${formatMs(savedMs!)}` : `Default: ${formatMs(defaultMs)}`),
    error ? h("div", { class: "ct-field-error" }, error) : null,
  );
}

// ── Form state ────────────────────────────────────────────────────────

/** State and actions of the CLI-timeouts form. The Workflow page owns it. */
export interface CliTimeoutsForm {
  /** Loaded timeouts, or null before the first successful load. */
  data: CliTimeoutsResponse | null;
  loading: boolean;
  /** Why the timeouts could not be loaded. */
  loadError: string | null;
  /** Why the last save failed. Cleared by the next save or a discard. */
  saveError: string | null;
  /** Raw global edit, or null when untouched. */
  globalEdit: string | null;
  perCmdEdit: Record<string, string>;
  globalError: string | null;
  perCmdErrors: Record<string, string | null>;
  /** True while any value differs from its saved value, or holds invalid input. */
  dirty: boolean;
  onGlobalChange: (raw: string) => void;
  onGlobalReset: () => void;
  onPerCmdChange: (key: string, raw: string) => void;
  onPerCmdReset: (key: string) => void;
  /**
   * PUT the changed values to /api/cli/timeouts. Resolves true once saved (or
   * when nothing is dirty); false leaves the edits in place with `saveError` set.
   */
  save: () => Promise<boolean>;
  /** Drop every edit. */
  discard: () => void;
}

export function useCliTimeoutsForm(): CliTimeoutsForm {
  const [data, setData] = useState<CliTimeoutsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit state: maps field key → raw string input value
  const [globalEdit, setGlobalEdit] = useState<string | null>(null);
  const [perCmdEdit, setPerCmdEdit] = useState<Record<string, string>>({});

  // Validation errors per field
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [perCmdErrors, setPerCmdErrors] = useState<Record<string, string | null>>({});

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/cli/timeouts");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setLoadError((body as { error?: string }).error ?? "Failed to load timeout configuration");
        return;
      }
      setData(await res.json() as CliTimeoutsResponse);
      setLoadError(null);
      setGlobalEdit(null);
      setPerCmdEdit({});
      setGlobalError(null);
      setPerCmdErrors({});
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load timeout configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchConfig(); }, [fetchConfig]);

  const onGlobalChange = useCallback((raw: string) => {
    setGlobalEdit(raw);
    setGlobalError(validateTimeoutInput(raw, "Global timeout"));
  }, []);

  const onGlobalReset = useCallback(() => {
    setGlobalEdit(null);
    setGlobalError(null);
  }, []);

  const onPerCmdChange = useCallback((key: string, raw: string) => {
    setPerCmdEdit((prev) => ({ ...prev, [key]: raw }));
    setPerCmdErrors((prev) => ({ ...prev, [key]: validateTimeoutInput(raw, KNOWN_COMMANDS[key]?.label ?? key) }));
  }, []);

  const onPerCmdReset = useCallback((key: string) => {
    setPerCmdEdit((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPerCmdErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** The request body for the values that differ from what is saved. */
  const pendingBody = useMemo(() => {
    const body: { timeoutMs?: number | null; timeouts?: Record<string, number | null> } = {};
    if (!data) return body;
    if (globalEdit !== null && isDirty(data.timeoutMs, globalEdit, data.defaultTimeoutMs)) {
      body.timeoutMs = parseMs(globalEdit);
    }
    const perCmdChanges: Record<string, number | null> = {};
    for (const [key, raw] of Object.entries(perCmdEdit)) {
      if (isDirty(data.timeouts[key] ?? null, raw, data.defaultTimeoutMs)) perCmdChanges[key] = parseMs(raw);
    }
    if (Object.keys(perCmdChanges).length > 0) body.timeouts = perCmdChanges;
    return body;
  }, [data, globalEdit, perCmdEdit]);

  const hasErrors = globalError !== null || Object.values(perCmdErrors).some((e) => e !== null && e !== undefined);

  // `isDirty` treats unparseable input as clean (there is no value to save),
  // but the page must still count it as an unsaved edit — otherwise typing
  // "abc" leaves Save disabled and the leave prompt unarmed, and the edit is
  // lost silently on navigation.
  const dirty = Object.keys(pendingBody).length > 0 || hasErrors;

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaveError(null);
    if (hasErrors) {
      setSaveError("Fix the invalid timeouts before saving");
      return false;
    }
    try {
      const res = await fetch("/api/cli/timeouts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pendingBody),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveError((errBody as { error?: string }).error ?? "Save failed");
        return false;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    }
    await fetchConfig();
    return true;
  }, [dirty, hasErrors, pendingBody, fetchConfig]);

  const discard = useCallback(() => {
    setGlobalEdit(null);
    setPerCmdEdit({});
    setGlobalError(null);
    setPerCmdErrors({});
    setSaveError(null);
  }, []);

  return {
    data,
    loading,
    loadError,
    saveError,
    globalEdit,
    perCmdEdit,
    globalError,
    perCmdErrors,
    dirty,
    onGlobalChange,
    onGlobalReset,
    onPerCmdChange,
    onPerCmdReset,
    save,
    discard,
  };
}

// ── Section ───────────────────────────────────────────────────────────

export function CliTimeoutsSection({ form }: { form: CliTimeoutsForm }) {
  const { data } = form;

  if (form.loading) {
    return h("div", { class: "ct-container" },
      h("div", { class: "loading" }, "Loading timeout configuration..."),
    );
  }

  if (!data) {
    return h("div", { class: "ct-container" },
      h("div", { class: "ct-error-state" }, form.loadError ?? "Failed to load timeout configuration"),
    );
  }

  // Group known commands by category
  const byCategory = new Map<string, string[]>();
  for (const [cmd, meta] of Object.entries(KNOWN_COMMANDS)) {
    if (!byCategory.has(meta.category)) byCategory.set(meta.category, []);
    byCategory.get(meta.category)!.push(cmd);
  }

  // Collect any per-command overrides that are set in config but not in KNOWN_COMMANDS
  const customOverrides = Object.keys(data.timeouts).filter((cmd) => !(cmd in KNOWN_COMMANDS));

  const overrideCount = Object.keys(data.timeouts).length;
  const effectiveGlobal = data.timeoutMs ?? data.defaultTimeoutMs;

  const globalEditValue = form.globalEdit ?? (data.timeoutMs !== null ? String(data.timeoutMs) : "");

  return h("div", { class: "ct-container" },
    h("p", { class: "ct-header-subtitle" },
      "How long each CLI command may run before being cancelled. " +
      "Settings are persisted to ",
      h("code", null, data.configFile),
      ".",
    ),

    // Stats bar
    h("div", { class: "ct-stats" },
      h("div", { class: "ct-stat" },
        h("span", { class: "ct-stat-value" }, formatMs(effectiveGlobal)),
        h("span", { class: "ct-stat-label" }, data.timeoutMs !== null ? "global timeout (custom)" : "global timeout (default)"),
      ),
      h("div", { class: "ct-stat" },
        h("span", { class: "ct-stat-value" }, String(overrideCount)),
        h("span", { class: "ct-stat-label" }, `per-command override${overrideCount !== 1 ? "s" : ""} active`),
      ),
    ),

    form.saveError ? h("div", { class: "ct-error-banner" }, form.saveError) : null,

    // Info box
    h("div", { class: "ct-info-box" },
      h("p", null,
        "Timeouts are expressed in milliseconds. Use ",
        h("code", null, "0"),
        " to disable the timeout for a command. " +
        "Per-command overrides take priority over the global default.",
      ),
      h("p", null,
        "Server commands (",
        h("code", null, "start"),
        ", ",
        h("code", null, "dev"),
        ") run indefinitely by design — they only get a timeout if you explicitly set one.",
      ),
    ),

    // Global timeout section
    h("div", { class: "ct-section" },
      h("div", { class: "ct-section-header" },
        h("span", { class: "ct-section-icon" }, "⚙"),
        h("div", null,
          h("h3", { class: "ct-section-title" }, "Global Default"),
          h("p", { class: "ct-section-desc" }, "Applied to all bounded commands unless a per-command override is set"),
        ),
      ),
      h("div", { class: "ct-field-list" },
        h(GlobalTimeoutField, {
          savedMs: data.timeoutMs,
          defaultMs: data.defaultTimeoutMs,
          editValue: globalEditValue,
          error: form.globalError,
          onchange: form.onGlobalChange,
          onReset: form.onGlobalReset,
        }),
      ),
    ),

    // Per-command sections
    ...CATEGORY_ORDER
      .filter((cat) => byCategory.has(cat))
      .map((cat) => {
        const catMeta = CATEGORY_META[cat];
        const cmds = byCategory.get(cat)!;
        return h("div", { key: cat, class: "ct-section" },
          h("div", { class: "ct-section-header" },
            h("span", { class: "ct-section-icon" }, catMeta.icon),
            h("div", null,
              h("h3", { class: "ct-section-title" }, catMeta.label),
              h("p", { class: "ct-section-desc" }, catMeta.description),
            ),
          ),
          h("div", { class: "ct-field-list" },
            ...cmds.map((cmd) => {
              const meta = KNOWN_COMMANDS[cmd];
              const savedMs = data.timeouts[cmd] ?? null;
              const rawEdit = form.perCmdEdit[cmd] ?? (savedMs !== null ? String(savedMs) : "");
              const noDefaultTimeout = data.noDefaultTimeoutCommands.includes(cmd);
              return h(TimeoutField, {
                key: cmd,
                fieldKey: cmd,
                label: meta.label,
                description: meta.description,
                savedMs,
                defaultMs: noDefaultTimeout ? 0 : (data.timeoutMs ?? data.defaultTimeoutMs),
                editValue: rawEdit,
                error: form.perCmdErrors[cmd] ?? null,
                noDefaultTimeout,
                onchange: form.onPerCmdChange,
                onReset: form.onPerCmdReset,
              });
            }),
          ),
        );
      }),

    // Custom overrides not in KNOWN_COMMANDS
    customOverrides.length > 0
      ? h("div", { class: "ct-section" },
          h("div", { class: "ct-section-header" },
            h("span", { class: "ct-section-icon" }, "▦"),
            h("div", null,
              h("h3", { class: "ct-section-title" }, "Custom Overrides"),
              h("p", { class: "ct-section-desc" }, `Per-command overrides set manually in ${data.configFile}`),
            ),
          ),
          h("div", { class: "ct-field-list" },
            ...customOverrides.map((cmd) => {
              const savedMs = data.timeouts[cmd] ?? null;
              const rawEdit = form.perCmdEdit[cmd] ?? (savedMs !== null ? String(savedMs) : "");
              return h(TimeoutField, {
                key: cmd,
                fieldKey: cmd,
                label: cmd,
                description: `Custom per-command timeout for "${cmd}".`,
                savedMs,
                defaultMs: data.timeoutMs ?? data.defaultTimeoutMs,
                editValue: rawEdit,
                error: form.perCmdErrors[cmd] ?? null,
                noDefaultTimeout: false,
                onchange: form.onPerCmdChange,
                onReset: form.onPerCmdReset,
              });
            }),
          ),
        )
      : null,
  );
}


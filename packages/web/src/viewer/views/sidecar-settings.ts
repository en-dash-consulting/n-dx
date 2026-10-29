/**
 * Sidecar settings — the Sidecar section of the Workflow page, drawn as field
 * cards like the rest of that page and shown only while `web.sidecar` is on.
 *
 * Fields: the allow-list editor (the broker's allow-list file), mode, the
 * context ceilings, the idle window and the GitHub reads toggle. Nothing is
 * written until the page's Save: `useSidecarSettingsForm` holds the edits,
 * `save` sends them and refuses an invalid value with a message first.
 *
 * Data comes from GET/PUT /api/sidecar/settings and GET/POST/DELETE
 * /api/sidecar/allow-list. The server decides what can never be allow-listed
 * (work, reset, push); the locked rows below only show that.
 */

import { h, type ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { resolveCliLabel, useCliName } from "../hooks/index.js";

interface SettingsResponse {
  mode: "ask";
  contextCeiling: { worktree: number; hub: number };
  idleMs: number;
  githubReads: boolean;
  defaults: { contextCeiling: { worktree: number; hub: number }; idleMs: number };
  configFile: string;
}

interface Rule {
  tool: string;
  key: string;
}

const MS_PER_MINUTE = 60_000;

/** Commands that are never allow-listed; shown locked, and the server refuses them. `{cli}` is resolveCliLabel's. */
export const LOCKED_COMMANDS = ["{cli} work", "git reset", "git push"] as const;

export const SIDECAR_LOCKED_MODE = "Auto";

/** A rule as the operator reads it: the command for `run_command`, else the tool. */
export function describeRule(rule: Rule): string {
  if (rule.tool !== "run_command") return rule.tool;
  try {
    const argv: unknown = JSON.parse(rule.key);
    if (Array.isArray(argv)) return argv.join(" ");
  } catch {
    // A key that is not JSON is shown as written.
  }
  return rule.key;
}

function validateWhole(raw: string, label: string, unit: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return `${label} must not be empty`;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return `${label} must be a whole number of ${unit} above 0`;
  return null;
}

export interface SidecarSettingsForm {
  settings: SettingsResponse | null;
  rules: Rule[];
  loading: boolean;
  loadError: string | null;
  saveError: string | null;
  /** Raw edits by field; absent means untouched. */
  ceilingEdit: { worktree?: string; hub?: string };
  idleMinutesEdit: string | null;
  githubReadsEdit: boolean | null;
  /** Commands staged to add, and rules staged to remove, until Save. */
  added: string[];
  removed: Rule[];
  errors: Record<string, string | null>;
  dirty: boolean;
  onCeilingChange: (scope: "worktree" | "hub", raw: string) => void;
  onIdleChange: (raw: string) => void;
  onGithubReadsChange: (on: boolean) => void;
  onAddRule: (command: string) => void;
  onUnstageAdd: (command: string) => void;
  onToggleRemove: (rule: Rule) => void;
  /** Read the settings and allow-list; clears every edit. */
  load: () => Promise<void>;
  save: () => Promise<boolean>;
  discard: () => void;
}

const sameRule = (a: Rule, b: Rule) => a.tool === b.tool && a.key === b.key;

async function failure(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({})) as { error?: string };
  return body.error ?? fallback;
}

/**
 * The form state. It loads nothing itself: the section calls `load` when it
 * mounts, so a project with `web.sidecar` off makes no Sidecar request.
 */
export function useSidecarSettingsForm(): SidecarSettingsForm {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ceilingEdit, setCeilingEdit] = useState<{ worktree?: string; hub?: string }>({});
  const [idleMinutesEdit, setIdleMinutesEdit] = useState<string | null>(null);
  const [githubReadsEdit, setGithubReadsEdit] = useState<boolean | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<Rule[]>([]);

  const reset = useCallback(() => {
    setCeilingEdit({});
    setIdleMinutesEdit(null);
    setGithubReadsEdit(null);
    setAdded([]);
    setRemoved([]);
    setSaveError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      const [settingsRes, rulesRes] = await Promise.all([fetch("/api/sidecar/settings"), fetch("/api/sidecar/allow-list")]);
      if (!settingsRes.ok) throw new Error(await failure(settingsRes, "Failed to load Sidecar settings"));
      if (!rulesRes.ok) throw new Error(await failure(rulesRes, "Failed to load the allow-list"));
      setSettings(await settingsRes.json() as SettingsResponse);
      setRules((await rulesRes.json() as { rules: Rule[] }).rules);
      setLoadError(null);
      reset();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load Sidecar settings");
    } finally {
      setLoading(false);
    }
  }, [reset]);

  const errors = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const scope of ["worktree", "hub"] as const) {
      const raw = ceilingEdit[scope];
      out[scope] = raw === undefined ? null : validateWhole(raw, `The ${scope} context ceiling`, "tokens");
    }
    out.idle = idleMinutesEdit === null ? null : validateWhole(idleMinutesEdit, "The idle window", "minutes");
    return out;
  }, [ceilingEdit, idleMinutesEdit]);

  const hasErrors = Object.values(errors).some((e) => e !== null);
  const dirty = Object.keys(ceilingEdit).length > 0 || idleMinutesEdit !== null || githubReadsEdit !== null
    || added.length > 0 || removed.length > 0;

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty || !settings) return true;
    setSaveError(null);
    if (hasErrors) {
      setSaveError("Fix the invalid Sidecar settings before saving");
      return false;
    }
    try {
      for (const command of added) {
        const argv = command.trim().split(/\s+/);
        const res = await fetch("/api/sidecar/allow-list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tool: "run_command", argv }),
        });
        if (!res.ok) {
          setSaveError(`Not allow-listed (${command}): ${await failure(res, "Save failed")}`);
          return false;
        }
      }
      for (const rule of removed) {
        const res = await fetch("/api/sidecar/allow-list", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rule),
        });
        if (!res.ok) {
          setSaveError(await failure(res, "Save failed"));
          return false;
        }
      }
      const patch: Record<string, unknown> = {};
      const ceiling: Record<string, number> = {};
      for (const scope of ["worktree", "hub"] as const) {
        const raw = ceilingEdit[scope];
        if (raw !== undefined && Number(raw) !== settings.contextCeiling[scope]) ceiling[scope] = Number(raw);
      }
      if (Object.keys(ceiling).length > 0) patch.contextCeiling = ceiling;
      if (idleMinutesEdit !== null && Number(idleMinutesEdit) * MS_PER_MINUTE !== settings.idleMs) {
        patch.idleMs = Number(idleMinutesEdit) * MS_PER_MINUTE;
      }
      if (githubReadsEdit !== null && githubReadsEdit !== settings.githubReads) patch.githubReads = githubReadsEdit;
      if (Object.keys(patch).length > 0) {
        const res = await fetch("/api/sidecar/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          setSaveError(await failure(res, "Save failed"));
          return false;
        }
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
      return false;
    }
    await load();
    return true;
  }, [dirty, settings, hasErrors, added, removed, ceilingEdit, idleMinutesEdit, githubReadsEdit, load]);

  return {
    settings,
    rules,
    loading,
    loadError,
    saveError,
    ceilingEdit,
    idleMinutesEdit,
    githubReadsEdit,
    added,
    removed,
    errors,
    dirty,
    onCeilingChange: (scope, raw) => setCeilingEdit((prev) => ({ ...prev, [scope]: raw })),
    onIdleChange: setIdleMinutesEdit,
    onGithubReadsChange: setGithubReadsEdit,
    onAddRule: (command) => {
      const trimmed = command.trim().replace(/\s+/g, " ");
      if (trimmed) setAdded((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    },
    onUnstageAdd: (command) => setAdded((prev) => prev.filter((c) => c !== command)),
    onToggleRemove: (rule) =>
      setRemoved((prev) => (prev.some((r) => sameRule(r, rule)) ? prev.filter((r) => !sameRule(r, rule)) : [...prev, rule])),
    load,
    save,
    discard: reset,
  };
}

// ── Fields ────────────────────────────────────────────────────────────

function Card({ field, title, description, children, error }: {
  field: string;
  title: string;
  description: string;
  children?: ComponentChildren;
  error?: string | null;
}) {
  return h("div", { class: "ct-field", "data-field": field },
    h("div", { class: "ct-field-header" },
      h("div", { class: "ct-field-label-row" }, h("span", { class: "ct-field-name" }, title)),
    ),
    h("p", { class: "ct-field-desc" }, description),
    children,
    error ? h("div", { class: "ct-field-error" }, error) : null,
  );
}

function NumberInput({ label, value, placeholder, unit, error, onInput }: {
  label: string;
  value: string;
  placeholder: string;
  unit: string;
  error: string | null;
  onInput: (raw: string) => void;
}) {
  return h("div", { class: "ct-control-row" },
    h("input", {
      type: "number",
      class: `ct-input${error ? " ct-input-error" : ""}`,
      value,
      min: "1",
      step: "1",
      placeholder,
      "aria-label": label,
      onInput: (e: Event) => onInput((e.target as HTMLInputElement).value),
    }),
    h("span", { class: "ct-input-unit" }, unit),
  );
}

function AllowListEditor({ form }: { form: SidecarSettingsForm }) {
  const [draft, setDraft] = useState("");
  const cliName = useCliName();
  const add = () => {
    form.onAddRule(draft);
    setDraft("");
  };
  return h(Card, {
    field: "allowList",
    title: "Allow-list",
    description: "Commands the Sidecar may run without asking. Anything not listed raises a card first.",
  },
    h("ul", { class: "sidecar-allow-rules", "aria-label": "Allow-list rules" },
      ...form.rules.map((rule) => {
        const removing = form.removed.some((r) => r.tool === rule.tool && r.key === rule.key);
        return h("li", { key: `${rule.tool}:${rule.key}`, class: "sidecar-allow-rule", "data-state": removing ? "removing" : "saved" },
          h("code", null, describeRule(rule)),
          h("button", { type: "button", class: "ct-reset-btn", onClick: () => form.onToggleRemove(rule) }, removing ? "Keep" : "Remove"),
        );
      }),
      ...form.added.map((command) =>
        h("li", { key: `new:${command}`, class: "sidecar-allow-rule", "data-state": "adding" },
          h("code", null, command),
          h("span", { class: "ct-badge-unsaved" }, "unsaved"),
          h("button", { type: "button", class: "ct-reset-btn", onClick: () => form.onUnstageAdd(command) }, "Cancel"),
        )),
      ...LOCKED_COMMANDS.map((command) =>
        h("li", { key: `locked:${command}`, class: "sidecar-allow-rule", "data-state": "locked" },
          h("code", null, resolveCliLabel(command, cliName)),
          h("span", { class: "ct-badge-modified" }, "locked"),
          h("span", { class: "ct-field-impact" }, "never allow-listed"),
        )),
    ),
    h("div", { class: "ct-control-row" },
      h("input", {
        type: "text",
        class: "ct-input",
        value: draft,
        placeholder: `${cliName} status`,
        "aria-label": "Command to allow",
        onInput: (e: Event) => setDraft((e.target as HTMLInputElement).value),
        onKeyDown: (e: KeyboardEvent) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        },
      }),
      h("button", { type: "button", class: "ct-reset-btn", disabled: draft.trim() === "", onClick: add }, "Add"),
    ),
  );
}

export function SidecarSettingsSection({ form }: { form: SidecarSettingsForm }) {
  const { settings, load } = form;
  useEffect(() => { void load(); }, [load]);
  if (form.loading) return h("div", { class: "loading" }, "Loading Sidecar settings...");
  if (!settings) return h("div", { class: "ct-error-state" }, form.loadError ?? "Failed to load Sidecar settings");

  const ceilingValue = (scope: "worktree" | "hub") => form.ceilingEdit[scope] ?? String(settings.contextCeiling[scope]);
  const idleValue = form.idleMinutesEdit ?? String(settings.idleMs / MS_PER_MINUTE);
  const githubReads = form.githubReadsEdit ?? settings.githubReads;

  return h("div", { class: "ct-container sidecar-settings" },
    form.saveError ? h("div", { class: "ct-error-banner", role: "alert" }, form.saveError) : null,
    h(AllowListEditor, { form }),
    h(Card, { field: "mode", title: "Mode", description: "How the Sidecar acts on what it proposes." },
      h("div", { class: "ct-control-row" },
        h("select", { class: "ct-input", "aria-label": "Sidecar mode", value: "ask", onChange: () => undefined },
          h("option", { value: "ask" }, "Ask"),
          h("option", { value: "auto", disabled: true }, `${SIDECAR_LOCKED_MODE} (locked: not available yet)`),
        ),
      ),
    ),
    h(Card, {
      field: "contextCeiling.worktree",
      title: "Worktree context ceiling",
      description: `Tokens of context after which a worktree session checkpoints and starts cold. Default ${settings.defaults.contextCeiling.worktree}.`,
      error: form.errors.worktree,
    }, h(NumberInput, {
      label: "Worktree context ceiling in tokens",
      value: ceilingValue("worktree"),
      placeholder: String(settings.defaults.contextCeiling.worktree),
      unit: "tokens",
      error: form.errors.worktree,
      onInput: (raw) => form.onCeilingChange("worktree", raw),
    })),
    h(Card, {
      field: "contextCeiling.hub",
      title: "Hub context ceiling",
      description: `The same for a hub session. Default ${settings.defaults.contextCeiling.hub}.`,
      error: form.errors.hub,
    }, h(NumberInput, {
      label: "Hub context ceiling in tokens",
      value: ceilingValue("hub"),
      placeholder: String(settings.defaults.contextCeiling.hub),
      unit: "tokens",
      error: form.errors.hub,
      onInput: (raw) => form.onCeilingChange("hub", raw),
    })),
    h(Card, {
      field: "idle",
      title: "Idle window",
      description: `A session idle this long forgets its resume id; its transcript stays. Default ${settings.defaults.idleMs / MS_PER_MINUTE} minutes.`,
      error: form.errors.idle,
    }, h(NumberInput, {
      label: "Idle window in minutes",
      value: idleValue,
      placeholder: String(settings.defaults.idleMs / MS_PER_MINUTE),
      unit: "minutes",
      error: form.errors.idle,
      onInput: form.onIdleChange,
    })),
    h(Card, {
      field: "githubReads",
      title: "GitHub reads",
      description: "Allow the Sidecar to read issues, pull requests and checks without a card. Saved now; nothing uses it until the GitHub lens ships.",
    }, h("label", { class: "ct-control-row" },
      h("input", {
        type: "checkbox",
        checked: githubReads,
        "aria-label": "GitHub reads",
        onChange: (e: Event) => form.onGithubReadsChange((e.target as HTMLInputElement).checked),
      }),
      " Allow GitHub reads",
    )),
  );
}

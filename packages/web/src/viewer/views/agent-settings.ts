/**
 * Work › Tune's Agent settings tile: the settings that steer an agent run,
 * editable in place.
 *
 * - **Models** — the model per tier and what each tier is used for, saved
 *   through `PUT /api/llm/config` with Robot Wrangler's own key mapping.
 * - **Rules** — what the agent may run and touch, the test gate it must pass,
 *   its review pass and spend caps: a subset of the Workflow page's fields,
 *   saved through `PUT /api/hench/config` with the same field editor.
 * - **Agent prompt** — the project's prompt file, added to every n-dx agent's
 *   system prompt (`agent-prompt.ts`).
 *
 * Each section links to the Settings page that holds the rest, and a save on
 * either side makes the other re-read (`settings-sync.ts`), so the two
 * surfaces never show different values.
 *
 * @module viewer/views/agent-settings
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { appUrl } from "../base-path.js";
import { viewPathname } from "../route-state.js";
import type { NavigateTo } from "../types.js";
import { responseError } from "../utils/response-error.js";
import { FieldEditor, formatDisplayValue, useHenchConfigForm } from "./hench-config.js";
import {
  AGENT_KEY_PREFIX,
  savedTierValue,
  tierConfigPath,
  tierKey,
  tierLabel,
  type LlmCatalog,
  type LlmConfigResponse,
  type TierRow,
  type ViewerLLMVendor,
} from "./robot-wrangler.js";
import type { RobotWranglerSection } from "./robot-wrangler-sections.js";
import { announceSettingsSaved, useSettingsSaved } from "./settings-sync.js";
import { AgentPromptSection } from "./agent-prompt.js";

const SOURCE = "work-tune";

/**
 * The Workflow fields the tile edits, in the order shown: what the agent may
 * run and touch, the checks its work must pass, and what it may spend.
 */
export const RULE_FIELDS: readonly string[] = [
  "guard.allowedCommands",
  "guard.allowedGitSubcommands",
  "guard.blockedPaths",
  "projectSkills",
  "fullTestCommand",
  "testGate.command",
  "review.mode",
  "maxCostUsdPerRun",
  "maxCostUsdPerDay",
];

/** The config key a tier edit writes, as PUT /api/llm/config takes it. */
export function tierChangeKey(key: string): string {
  return key.startsWith(AGENT_KEY_PREFIX) ? `hench.models.${key.slice(AGENT_KEY_PREFIX.length)}` : `llm.${key}`;
}

/** "Used for analysis, planning" — or nothing when no command picks the tier. */
export function usedForLine(row: Pick<TierRow, "usedBy">): string | null {
  return row.usedBy.length > 0 ? `Used for ${row.usedBy.map((u) => u.label).join(", ")}` : null;
}

/** A link to a settings page, kept a real anchor so it opens in a new tab like any other. */
function SettingsLink({ view, section, navigateTo, children }: {
  view: "robot-wrangler" | "workflow";
  section?: string;
  navigateTo: NavigateTo;
  children?: ComponentChildren;
}) {
  const query = section ? `?${new URLSearchParams({ section })}` : "";
  return h("a", {
    class: "as-settings-link",
    href: appUrl(`${viewPathname(view, null)}${query}`),
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigateTo(view, section ? { section } : undefined);
    },
  }, children);
}

// ── Models ─────────────────────────────────────────────────────

function ModelsSection({ navigateTo }: { navigateTo: NavigateTo }) {
  const [data, setData] = useState<LlmConfigResponse | null>(null);
  const [catalog, setCatalog] = useState<LlmCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/llm/config");
      if (!res.ok) {
        setError(await responseError(res, "Could not load the models"));
        return;
      }
      setData(await res.json() as LlmConfigResponse);
      setEdits({});
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the models");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    fetch("/api/llm/catalog")
      .then((res) => (res.ok ? res.json() as Promise<LlmCatalog> : null))
      .then((body) => { if (body) setCatalog(body); })
      .catch(() => { /* no catalog: each row takes a typed model id */ });
  }, []);
  const dirty = Object.keys(edits).length > 0;
  useSettingsSaved(["llm"], SOURCE, () => { if (!dirty) void load(); });

  if (error && !data) return h("p", { class: "as-error", role: "alert" }, error);
  if (!data) return h("p", { class: "as-loading", role: "status" }, "Loading…");

  const vendor = data.effective.vendor as ViewerLLMVendor;
  const rows = data.tiers ?? [];
  const models = catalog?.[vendor]?.models ?? [];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const changes: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(edits)) changes[tierChangeKey(key)] = value.trim() || null;
      const res = await fetch("/api/llm/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) {
        setError(await responseError(res, "Save failed", "Could not save the models"));
        return;
      }
      const body = await res.json() as { config?: LlmConfigResponse };
      if (body.config) setData(body.config);
      setEdits({});
      setSaved(true);
      announceSettingsSaved("llm", SOURCE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the models");
    } finally {
      setSaving(false);
    }
  };

  return h("section", { class: "as-section as-models", "aria-labelledby": "as-models-title" },
    h("div", { class: "as-section-head" },
      h("h3", { id: "as-models-title", class: "as-section-title" }, "Models"),
      h("span", { class: "as-section-sub" }, `Which ${vendor} model each tier runs, and when`),
    ),
    rows.length === 0
      ? h("p", { class: "as-empty" }, "No model tiers for this vendor yet.")
      : h("div", { class: "as-tiers", role: "group", "aria-label": "Model per tier" },
          rows.map((row) => {
            const key = tierKey(vendor, row.tier);
            const savedValue = savedTierValue(data, vendor, row);
            const value = edits[key] ?? savedValue;
            const label = tierLabel(vendor, row.tier);
            const id = `as-tier-${row.tier}`;
            const used = usedForLine(row);
            const choices = [...new Set([...models, ...(value ? [value] : [])])];
            const onChange = (next: string) => setEdits((prev) => {
              const rest = { ...prev };
              if (next === savedValue) delete rest[key];
              else rest[key] = next;
              setSaved(false);
              return rest;
            });
            return h("div", { key: row.tier, class: `as-tier${key in edits ? " as-dirty" : ""}`, "data-tier": row.tier },
              h("label", { class: "as-tier-name", htmlFor: id }, label),
              used ? h("span", { class: "as-tier-used" }, used) : h("span", { class: "as-tier-used as-muted" }, "Not used by a command"),
              choices.length > 0
                ? h("select", {
                    id,
                    class: "as-select llm-select-input",
                    value,
                    title: `Saved in ${tierConfigPath(vendor, row.tier)}`,
                    onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value),
                  },
                    h("option", { value: "" }, `Default (${row.model})`),
                    choices.map((m) => h("option", { key: m, value: m }, m)),
                  )
                : h("input", {
                    id,
                    type: "text",
                    class: "as-input llm-text-input",
                    value,
                    placeholder: row.model,
                    title: `Saved in ${tierConfigPath(vendor, row.tier)}`,
                    onInput: (e: Event) => onChange((e.target as HTMLInputElement).value),
                  }),
            );
          }),
        ),
    error ? h("p", { class: "as-error", role: "alert" }, error) : null,
    h("div", { class: "as-actions" },
      h("button", { type: "button", class: "btn btn-sm btn-primary", disabled: !dirty || saving, onClick: () => void save() }, saving ? "Saving…" : "Save models"),
      dirty ? h("button", { type: "button", class: "btn btn-sm", onClick: () => setEdits({}) }, "Discard") : null,
      saved && !dirty ? h("span", { class: "as-saved", role: "status" }, "Saved") : null,
      h(SettingsLink, { view: "robot-wrangler", section: "models" satisfies RobotWranglerSection, navigateTo }, "Vendor, failover and review in Robot Wrangler ↗"),
    ),
  );
}

// ── Rules ──────────────────────────────────────────────────────

function RulesSection({ navigateTo }: { navigateTo: NavigateTo }) {
  const form = useHenchConfigForm(SOURCE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fields = useMemo(() => {
    const byPath = new Map((form.data?.fields ?? []).map((f) => [f.path, f]));
    return RULE_FIELDS.flatMap((path) => byPath.get(path) ?? []);
  }, [form.data]);

  if (form.loading) return h("p", { class: "as-loading", role: "status" }, "Loading…");
  if (!form.data) return h("p", { class: "as-error", role: "alert" }, form.loadError ?? "Could not load the work settings");

  const save = async () => {
    setSaving(true);
    const ok = await form.save();
    setSaving(false);
    setSaved(ok);
  };

  return h("section", { class: "as-section as-rules", "aria-labelledby": "as-rules-title" },
    h("div", { class: "as-section-head" },
      h("h3", { id: "as-rules-title", class: "as-section-title" }, "Rules"),
      h("span", { class: "as-section-sub" }, "What the agent may run and touch, the checks it must pass, what it may spend"),
    ),
    h("div", { class: "as-fields" },
      fields.map((field) => h(FieldEditor, {
        key: field.path,
        field,
        editValue: form.editValues[field.path] ?? formatDisplayValue(field.value),
        error: form.fieldErrors[field.path] ?? null,
        onFieldChange: (path: string, raw: string) => { setSaved(false); form.onFieldChange(path, raw); },
      })),
    ),
    form.saveError ? h("p", { class: "as-error", role: "alert" }, form.saveError) : null,
    h("div", { class: "as-actions" },
      h("button", { type: "button", class: "btn btn-sm btn-primary", disabled: !form.dirty || saving, onClick: () => void save() }, saving ? "Saving…" : "Save rules"),
      form.dirty ? h("button", { type: "button", class: "btn btn-sm", onClick: form.discard }, "Discard") : null,
      saved && !form.dirty ? h("span", { class: "as-saved", role: "status" }, "Saved") : null,
      h(SettingsLink, { view: "workflow", navigateTo }, "Every work setting in Workflow ↗"),
    ),
  );
}

// ── Tile ───────────────────────────────────────────────────────

export function AgentSettingsPanel({ navigateTo }: { navigateTo: NavigateTo }) {
  return h("div", { class: "agent-settings" },
    h(ModelsSection, { navigateTo }),
    h(RulesSection, { navigateTo }),
    h("section", { class: "as-section as-prompt", "aria-labelledby": "as-prompt-title" },
      h("div", { class: "as-section-head" },
        h("h3", { id: "as-prompt-title", class: "as-section-title" }, "Agent prompt"),
      ),
      h(AgentPromptSection, { compact: true }),
    ),
  );
}

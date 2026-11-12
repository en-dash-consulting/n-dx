/**
 * Feature toggles on Settings › Project: the form state, and one row per
 * toggle in the section its registry `group` names.
 *
 * A toggle is an edit, not an action: flipping one changes the form, and Save
 * writes every changed flag in one request. Only after that request succeeds
 * is `feature-toggle-changed` dispatched for each changed key, so the rest of
 * the dashboard (which gates surfaces on these flags) never sees a flag that
 * was not persisted.
 *
 * Data comes from GET /api/features (read) and PUT /api/features (update).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";

// ── Types (canonical definitions in src/shared/features.ts) ──────────
import type { FeatureToggle, FeaturesResponse } from "../external.js";
import { SettingRow, Switch, type SettingRowSpec, type SettingTag } from "./setting-row.js";
import type { ProjectSectionId } from "./project-sections.js";

// ── Form state ───────────────────────────────────────────────────────

/** State and actions of the feature-flags form. The Project page owns it. */
export interface FeatureTogglesForm {
  /** Every flag with `enabled` showing the edited value, or empty before the first load. */
  toggles: FeatureToggle[];
  loading: boolean;
  /** Why the flags could not be loaded. */
  loadError: string | null;
  /** Why the last save failed. Cleared by the next save or a discard. */
  saveError: string | null;
  /** Keys of the flags whose edited value differs from the saved one. */
  unsaved: ReadonlySet<string>;
  /** True while any flag differs from its saved value. */
  dirty: boolean;
  /** Flip one flag in the form; flipping it back leaves the form clean. */
  toggle: (key: string, enabled: boolean) => void;
  /**
   * PUT the changed flags to /api/features, then announce each one. Resolves
   * true once saved (or when nothing is dirty); false leaves the edits in
   * place with `saveError` set and announces nothing.
   */
  save: () => Promise<boolean>;
  /** Drop every edit. */
  discard: () => void;
}

export function useFeatureTogglesForm(): FeatureTogglesForm {
  const [saved, setSaved] = useState<FeatureToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** key → edited value, only for flags that differ from `saved`. */
  const [edits, setEdits] = useState<Record<string, boolean>>({});

  const fetchFeatures = useCallback(async () => {
    try {
      const res = await fetch("/api/features");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setLoadError((body as { error?: string }).error ?? "Failed to load feature toggles");
        return;
      }
      setSaved((await res.json() as FeaturesResponse).toggles);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load feature toggles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchFeatures(); }, [fetchFeatures]);

  const toggle = useCallback((key: string, enabled: boolean) => {
    const was = saved.find((t) => t.key === key)?.enabled;
    setEdits((prev) => {
      const next = { ...prev };
      if (enabled === was) delete next[key];
      else next[key] = enabled;
      return next;
    });
  }, [saved]);

  const toggles = useMemo(
    () => saved.map((t) => (t.key in edits ? { ...t, enabled: edits[t.key]! } : t)),
    [saved, edits],
  );

  const unsaved = useMemo(() => new Set(Object.keys(edits)), [edits]);
  const dirty = unsaved.size > 0;

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaveError(null);
    const changes = edits;
    try {
      const res = await fetch("/api/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setSaveError((body as { error?: string }).error ?? "Failed to save");
        return false;
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
      return false;
    }
    setSaved((prev) => prev.map((t) => (t.key in changes ? { ...t, enabled: changes[t.key]! } : t)));
    setEdits({});
    for (const [key, enabled] of Object.entries(changes)) {
      window.dispatchEvent(new CustomEvent("feature-toggle-changed", { detail: { key, enabled } }));
    }
    return true;
  }, [dirty, edits]);

  const discard = useCallback(() => {
    setEdits({});
    setSaveError(null);
  }, []);

  return { toggles, loading, loadError, saveError, unsaved, dirty, toggle, save, discard };
}

// ── Rows ─────────────────────────────────────────────────────────────

function tagsOf(toggle: FeatureToggle): SettingTag[] {
  const tags: SettingTag[] = [];
  if (toggle.costsTokens) tags.push("Tokens");
  if (toggle.stability === "experimental") tags.push("Experimental");
  if (toggle.stability === "deprecated") tags.push("Deprecated");
  return tags;
}

/** One row per toggle, in registry order, each in its group's section. */
export function featureToggleRows(form: FeatureTogglesForm): SettingRowSpec<ProjectSectionId>[] {
  return form.toggles.map((toggle) => {
    const configKey = `features.${toggle.key}`;
    return {
      section: toggle.group,
      configKey,
      searchText: `${toggle.label} ${toggle.description} ${configKey}`,
      node: h(SettingRow, {
        key: configKey,
        configKey,
        label: toggle.label,
        description: toggle.description,
        tags: tagsOf(toggle),
        info: h("div", null,
          h("p", null, toggle.impact),
          toggle.details ? h("p", { class: "srow-details-long" }, toggle.details) : null,
        ),
        unsaved: form.unsaved.has(toggle.key),
        onReset: toggle.enabled !== toggle.defaultValue
          ? () => form.toggle(toggle.key, toggle.defaultValue)
          : undefined,
        control: h(Switch, {
          checked: toggle.enabled,
          label: `Toggle ${toggle.label}`,
          onChange: (next) => form.toggle(toggle.key, next),
        }),
      }),
    };
  });
}

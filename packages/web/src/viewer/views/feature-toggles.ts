/**
 * Feature flags section — experimental and stable feature flags, organised by
 * package (sourcevision, rex, hench), as the Project page renders them.
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
import { useCliName, resolveCliLabel } from "../hooks/index.js";

// ── Types (canonical definitions in src/shared/features.ts) ──────────
import type { FeatureToggle, FeaturesResponse } from "../external.js";

// ── Package metadata ─────────────────────────────────────────────────

const PACKAGE_META: Record<string, { label: string; icon: string; description: string }> = {
  sourcevision: {
    label: "{cli} analyze / plan",
    icon: "▣",
    description: "Static analysis, file inventory, import graph, and zone detection",
  },
  rex: {
    label: "{cli} work",
    icon: "▨",
    description: "PRD management, task tracking, and analysis proposals",
  },
  hench: {
    label: "{cli} work",
    icon: "▶",
    description: "Autonomous agent execution, retry policies, and guard rails",
  },
};

const PACKAGE_ORDER = ["sourcevision", "rex", "hench"];

const STABILITY_META: Record<string, { label: string; class: string }> = {
  experimental: { label: "Experimental", class: "ft-badge-experimental" },
  stable:       { label: "Stable",       class: "ft-badge-stable" },
  deprecated:   { label: "Deprecated",   class: "ft-badge-deprecated" },
};

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

// ── Toggle item component ────────────────────────────────────────────

function ToggleItem({ toggle, isUnsaved, onToggle }: {
  toggle: FeatureToggle;
  /** True when the flag was flipped and not yet saved. */
  isUnsaved: boolean;
  onToggle: (key: string, enabled: boolean) => void;
}) {
  const isNonDefault = toggle.enabled !== toggle.defaultValue;
  const stability = STABILITY_META[toggle.stability] ?? STABILITY_META.stable;

  const handleChange = useCallback(() => {
    onToggle(toggle.key, !toggle.enabled);
  }, [toggle.key, toggle.enabled, onToggle]);

  return h("div", { class: `ft-toggle-item${isNonDefault ? " ft-toggle-modified" : ""}` },
    h("div", { class: "ft-toggle-header" },
      h("div", { class: "ft-toggle-title-row" },
        h("span", { class: "ft-toggle-label" }, toggle.label),
        h("span", { class: `ft-badge ${stability.class}` }, stability.label),
        isNonDefault
          ? h("span", { class: "ft-badge ft-badge-modified" }, "modified")
          : null,
        isUnsaved
          ? h("span", { class: "ft-badge ft-badge-unsaved" }, "unsaved")
          : null,
      ),
      h("label", { class: "ft-toggle-switch" },
        h("input", {
          type: "checkbox",
          checked: toggle.enabled,
          onChange: handleChange,
          "aria-label": `Toggle ${toggle.label}`,
        }),
        h("span", { class: "ft-toggle-slider" }),
        h("span", { class: "ft-toggle-status" }, toggle.enabled ? "Enabled" : "Disabled"),
      ),
    ),
    h("p", { class: "ft-toggle-desc" }, toggle.description),
    h("div", { class: "ft-toggle-impact" },
      h("span", { class: "ft-toggle-impact-icon", "aria-hidden": "true" }, "⚠"),
      h("span", null, toggle.impact),
    ),
  );
}

// ── Package section component ────────────────────────────────────────

function PackageSection({ pkg, toggles, unsaved, onToggle }: {
  pkg: string;
  toggles: FeatureToggle[];
  unsaved: ReadonlySet<string>;
  onToggle: (key: string, enabled: boolean) => void;
}) {
  const cliName = useCliName();
  const rawMeta = PACKAGE_META[pkg] ?? { label: pkg, icon: "•", description: "" };
  const meta = { ...rawMeta, label: resolveCliLabel(rawMeta.label, cliName) };

  return h("div", { class: "ft-package-section" },
    h("div", { class: `ft-package-header ft-package-${pkg}` },
      h("span", { class: "ft-package-icon" }, meta.icon),
      h("div", null,
        h("h3", { class: "ft-package-title" }, meta.label),
        h("p", { class: "ft-package-desc" }, meta.description),
      ),
    ),
    h("div", { class: "ft-toggle-list" },
      ...toggles.map((toggle) =>
        h(ToggleItem, {
          key: toggle.key,
          toggle,
          isUnsaved: unsaved.has(toggle.key),
          onToggle,
        }),
      ),
    ),
  );
}

// ── Stats bar ────────────────────────────────────────────────────────

function StatsBar({ toggles }: { toggles: FeatureToggle[] }) {
  const total = toggles.length;
  const enabled = toggles.filter((t) => t.enabled).length;
  const experimental = toggles.filter((t) => t.stability === "experimental").length;
  const modified = toggles.filter((t) => t.enabled !== t.defaultValue).length;

  return h("div", { class: "ft-stats" },
    h("div", { class: "ft-stat" },
      h("span", { class: "ft-stat-value" }, String(enabled)),
      h("span", { class: "ft-stat-label" }, `of ${total} enabled`),
    ),
    h("div", { class: "ft-stat" },
      h("span", { class: "ft-stat-value" }, String(experimental)),
      h("span", { class: "ft-stat-label" }, "experimental"),
    ),
    h("div", { class: "ft-stat" },
      h("span", { class: "ft-stat-value" }, String(modified)),
      h("span", { class: "ft-stat-label" }, "modified from defaults"),
    ),
  );
}

// ── Section ──────────────────────────────────────────────────────────

export function FeatureTogglesSection({ form }: { form: FeatureTogglesForm }) {
  const cliName = useCliName();
  const { toggles } = form;

  if (form.loading) {
    return h("div", { class: "loading" }, "Loading feature toggles...");
  }

  if (form.loadError && toggles.length === 0) {
    return h("div", { class: "ft-error-state" },
      h("p", null, form.loadError),
      h("p", { class: "ft-error-hint" },
        "Make sure the n-dx server is running. Run ",
        h("code", null, `${cliName} start .`),
        " to start it.",
      ),
    );
  }

  const byPackage = new Map<string, FeatureToggle[]>();
  for (const toggle of toggles) {
    if (!byPackage.has(toggle.package)) byPackage.set(toggle.package, []);
    byPackage.get(toggle.package)!.push(toggle);
  }

  return h("div", { class: "ft-sections" },
    form.saveError ? h("div", { class: "ft-error-banner", role: "alert" }, form.saveError) : null,
    h(StatsBar, { toggles }),
    ...PACKAGE_ORDER
      .filter((pkg) => byPackage.has(pkg))
      .map((pkg) =>
        h(PackageSection, {
          key: pkg,
          pkg,
          toggles: byPackage.get(pkg)!,
          unsaved: form.unsaved,
          onToggle: form.toggle,
        }),
      ),
    h("div", { class: "ft-legend" },
      h("span", { class: "ft-legend-title" }, "Stability Levels:"),
      h("span", { class: "ft-badge ft-badge-stable" }, "Stable"),
      h("span", { class: "ft-legend-sep" }, "— Production-ready features"),
      h("span", { class: "ft-badge ft-badge-experimental" }, "Experimental"),
      h("span", { class: "ft-legend-sep" }, "— May change or have rough edges"),
      h("span", { class: "ft-badge ft-badge-deprecated" }, "Deprecated"),
      h("span", { class: "ft-legend-sep" }, "— Will be removed in a future version"),
    ),
  );
}

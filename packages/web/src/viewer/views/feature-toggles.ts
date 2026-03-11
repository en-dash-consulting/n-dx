/**
 * Feature Toggles view — manage experimental and stable feature flags.
 *
 * Displays feature flags organized by package (sourcevision, rex, hench)
 * with toggle controls. Changes are saved immediately on toggle and
 * reflected without server restart.
 *
 * Data comes from GET /api/features (read) and
 * PUT /api/features (update).
 */

import { h } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { NdxLogoPng } from "../components/logos.js";

// ── Types (canonical definitions in src/schema/features.ts) ──────────
import type { FeatureToggle, FeaturesResponse } from "../external.js";

// ── Package metadata ─────────────────────────────────────────────────

const PACKAGE_META: Record<string, { label: string; icon: string; description: string }> = {
  sourcevision: {
    label: "SourceVision",
    icon: "\u25A3",
    description: "Static analysis, file inventory, import graph, and zone detection",
  },
  rex: {
    label: "Rex",
    icon: "\u25A8",
    description: "PRD management, task tracking, and analysis proposals",
  },
  hench: {
    label: "Hench",
    icon: "\u25B6",
    description: "Autonomous agent execution, retry policies, and guard rails",
  },
};

const PACKAGE_ORDER = ["sourcevision", "rex", "hench"];

const STABILITY_META: Record<string, { label: string; class: string }> = {
  experimental: { label: "Experimental", class: "ft-badge-experimental" },
  stable:       { label: "Stable",       class: "ft-badge-stable" },
  deprecated:   { label: "Deprecated",   class: "ft-badge-deprecated" },
};

// ── Toggle item component ────────────────────────────────────────────

function ToggleItem({ toggle, onToggle, saving }: {
  toggle: FeatureToggle;
  onToggle: (key: string, enabled: boolean) => void;
  saving: string | null;
}) {
  const isSaving = saving === toggle.key;
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
      ),
      h("label", { class: "ft-toggle-switch" },
        h("input", {
          type: "checkbox",
          checked: toggle.enabled,
          onChange: handleChange,
          disabled: isSaving,
          "aria-label": `Toggle ${toggle.label}`,
        }),
        h("span", { class: "ft-toggle-slider" }),
        h("span", { class: "ft-toggle-status" },
          isSaving ? "Saving..." : (toggle.enabled ? "Enabled" : "Disabled"),
        ),
      ),
    ),
    h("p", { class: "ft-toggle-desc" }, toggle.description),
    h("div", { class: "ft-toggle-impact" },
      h("span", { class: "ft-toggle-impact-icon", "aria-hidden": "true" }, "\u26A0"),
      h("span", null, toggle.impact),
    ),
  );
}

// ── Package section component ────────────────────────────────────────

function PackageSection({ pkg, toggles, onToggle, saving }: {
  pkg: string;
  toggles: FeatureToggle[];
  onToggle: (key: string, enabled: boolean) => void;
  saving: string | null;
}) {
  const meta = PACKAGE_META[pkg] ?? { label: pkg, icon: "\u2022", description: "" };

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
          onToggle,
          saving,
        }),
      ),
    ),
  );
}

// ── Toast notification ───────────────────────────────────────────────

function SaveToast({ message }: { message: string | null }) {
  if (!message) return null;

  return h("div", { class: "ft-toast", role: "status", "aria-live": "polite" },
    h("span", { class: "ft-toast-icon" }, "\u2714"),
    h("span", null, message),
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

// ── Main view ────────────────────────────────────────────────────────

export function FeatureTogglesView() {
  const [toggles, setToggles] = useState<FeatureToggle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFeatures = useCallback(async () => {
    try {
      const res = await fetch("/api/features");
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed to load" }));
        setError((body as { error?: string }).error ?? "Failed to load feature toggles");
        return;
      }
      const json = await res.json() as FeaturesResponse;
      setToggles(json.toggles);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load feature toggles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  // Clean up toast timer on unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const handleToggle = useCallback(async (key: string, enabled: boolean) => {
    setSaving(key);
    setError(null);

    try {
      const res = await fetch("/api/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: { [key]: enabled } }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }));
        setError((body as { error?: string }).error ?? "Failed to save");
        return;
      }

      // Update local state immediately
      setToggles((prev) =>
        prev.map((t) => t.key === key ? { ...t, enabled } : t),
      );

      // Notify other components that a toggle changed
      window.dispatchEvent(new CustomEvent("feature-toggle-changed", { detail: { key, enabled } }));

      // Find the toggle label for the toast
      const toggle = toggles.find((t) => t.key === key);
      const label = toggle?.label ?? key;
      const action = enabled ? "enabled" : "disabled";
      setToast(`${label} ${action}`);

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  }, [toggles]);

  if (loading) {
    return h("div", { class: "ft-container" },
      h("div", { class: "loading" }, "Loading feature toggles..."),
    );
  }

  if (error && toggles.length === 0) {
    return h("div", { class: "ft-container" },
      h("div", { class: "ft-header" },
        h("div", { class: "ft-header-brand" },
          h(NdxLogoPng, { size: 16, class: "ft-header-logo" }),
          h("span", { class: "ft-header-title" }, "Feature Flags"),
        ),
      ),
      h("div", { class: "ft-error-state" },
        h("p", null, error),
        h("p", { class: "ft-error-hint" },
          "Make sure the n-dx server is running. Run ",
          h("code", null, "ndx start ."),
          " to start it.",
        ),
      ),
    );
  }

  // Group toggles by package
  const byPackage = new Map<string, FeatureToggle[]>();
  for (const toggle of toggles) {
    if (!byPackage.has(toggle.package)) {
      byPackage.set(toggle.package, []);
    }
    byPackage.get(toggle.package)!.push(toggle);
  }

  return h("div", { class: "ft-container" },
    h("div", { class: "ft-header" },
      h("div", { class: "ft-header-brand" },
        h(NdxLogoPng, { size: 16, class: "ft-header-logo" }),
        h("span", { class: "ft-header-title" }, "Feature Flags"),
      ),
      h("p", { class: "ft-header-subtitle" },
        "Manage experimental and stable features across all n-dx packages. ",
        "Changes apply immediately without restart.",
      ),
    ),

    // Error banner
    error
      ? h("div", { class: "ft-error-banner" }, error)
      : null,

    // Stats bar
    h(StatsBar, { toggles }),

    // Package sections
    ...PACKAGE_ORDER
      .filter((pkg) => byPackage.has(pkg))
      .map((pkg) =>
        h(PackageSection, {
          key: pkg,
          pkg,
          toggles: byPackage.get(pkg)!,
          onToggle: handleToggle,
          saving,
        }),
      ),

    // Legend
    h("div", { class: "ft-legend" },
      h("span", { class: "ft-legend-title" }, "Stability Levels:"),
      h("span", { class: "ft-badge ft-badge-stable" }, "Stable"),
      h("span", { class: "ft-legend-sep" }, "\u2014 Production-ready features"),
      h("span", { class: "ft-badge ft-badge-experimental" }, "Experimental"),
      h("span", { class: "ft-legend-sep" }, "\u2014 May change or have rough edges"),
      h("span", { class: "ft-badge ft-badge-deprecated" }, "Deprecated"),
      h("span", { class: "ft-legend-sep" }, "\u2014 Will be removed in a future version"),
    ),

    h(SaveToast, { message: toast }),
  );
}

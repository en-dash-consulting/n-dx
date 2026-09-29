/**
 * Settings as a full overlay over the page, opened from the bottom bar's cog.
 *
 * Every settings page keeps its own route (`/llm-provider`, `/hench-config`, …);
 * the overlay is what those routes look like. The page underneath stays
 * mounted, so closing returns to exactly where you were. The configuration
 * summary that used to sit in the sidebar footer heads the settings list.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect, useMemo } from "preact/hooks";
import type { ViewId } from "../api.js";
import { SETTINGS_ENTRIES, useFeatureToggle, useCliName } from "../api.js";
import { resolveCliLabel } from "../hooks/index.js";
import { ConfigFooter, type ServerIdentity } from "./config-footer.js";
import { SidebarDensitySelector } from "./density-selector.js";

export interface SettingsOverlayProps {
  view: ViewId;
  validViews: ReadonlySet<ViewId>;
  onNavigate: (view: ViewId) => void;
  onClose: () => void;
  server?: ServerIdentity | null;
  /**
   * The active settings view, rendered by the registry. Optional in the type
   * because `h()` passes children as its third argument.
   */
  children?: ComponentChildren;
}

export function SettingsOverlay({ view, validViews, onNavigate, onClose, server = null, children }: SettingsOverlayProps) {
  const cliName = useCliName();
  const notionSync = useFeatureToggle("rex.notionSync", false);
  const integrations = useFeatureToggle("rex.integrations", false);

  const entries = useMemo(() => {
    const gates: Record<string, boolean> = { "rex.notionSync": notionSync, "rex.integrations": integrations };
    return SETTINGS_ENTRIES
      .filter((e) => validViews.has(e.view))
      .filter((e) => !e.featureGate || gates[e.featureGate])
      .map((e) => ({ ...e, label: resolveCliLabel(e.label, cliName) }));
  }, [validViews, notionSync, integrations, cliName]);

  const current = entries.find((e) => e.view === view);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return h("section", {
    class: "settings-overlay",
    id: "settings-overlay",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "Settings",
  },
    h("div", { class: "settings-overlay-head" },
      h("span", { class: "settings-overlay-glyph", "aria-hidden": "true" }, "⚙"),
      h("div", { class: "settings-overlay-crumbs" },
        "Settings",
        current ? h("span", { class: "settings-overlay-sep", "aria-hidden": "true" }, " / ") : null,
        current ? h("b", null, current.label) : null,
      ),
      h("button", {
        type: "button",
        class: "settings-overlay-close",
        onClick: onClose,
        "aria-label": "Close settings",
        title: "Close (Esc)",
      }, "✕"),
    ),
    h("div", { class: "settings-overlay-body" },
      h("nav", { class: "settings-overlay-nav", "aria-label": "Settings pages" },
        h("div", { class: "settings-overlay-summary" }, h(ConfigFooter, { server })),
        entries.map((e) =>
          h("button", {
            key: e.view,
            type: "button",
            class: `settings-overlay-item${e.view === view ? " active" : ""}`,
            onClick: () => onNavigate(e.view),
            "aria-current": e.view === view ? "page" : undefined,
          },
            h("span", { class: "settings-overlay-item-glyph", "aria-hidden": "true" }, e.glyph),
            e.label,
          ),
        ),
        h("div", { class: "settings-overlay-density" },
          h("span", { class: "settings-overlay-density-label" }, "Density"),
          h(SidebarDensitySelector, null),
        ),
      ),
      h("div", { class: "settings-overlay-content" }, children),
    ),
  );
}

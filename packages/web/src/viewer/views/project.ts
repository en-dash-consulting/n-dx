/**
 * Project — the settings page for what belongs to the project rather than to a
 * command: analyze and plan settings, and feature flags. One SettingsFrame for
 * all of it.
 *
 * Exactly one frame for the whole page: the leave guard holds a single
 * module-level registration, and unmounting any frame clears it, so a frame
 * per section would let one section disarm another's guard.
 *
 * The page is dirty when any section differs from its saved values. Save
 * writes each dirty section to its own endpoint (PUT /api/project-settings,
 * /api/features). A section that saves becomes clean; one whose write fails
 * stays dirty, and the frame names it. Discard restores every section.
 *
 * The export and refresh panels live on the Commands page.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { PixelIcon, SettingsFrame } from "../components/index.js";
import { useCliName } from "../hooks/index.js";
import { ProjectSettingsSection, useProjectSettingsForm } from "./project-settings.js";
import { FeatureTogglesSection, useFeatureTogglesForm } from "./feature-toggles.js";

/** What the page needs from one section's form. */
interface SettingsPart {
  /** Named in the frame's error when this part fails to save. */
  label: string;
  dirty: boolean;
  /** Resolves true when saved or already clean; false leaves the part dirty. */
  save: () => Promise<boolean>;
  discard: () => void;
}

/** `children` is optional in the type because `h()` passes them as its third argument. */
function Section({ id, title, children }: { id: string; title: string; children?: ComponentChildren }) {
  return h("section", { class: "project-section", "aria-labelledby": `project-${id}-title` },
    h("h2", { id: `project-${id}-title`, class: "project-section-title" }, title),
    children,
  );
}

export function ProjectView() {
  const cliName = useCliName();

  const settings = useProjectSettingsForm();
  const features = useFeatureTogglesForm();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parts: SettingsPart[] = [
    { label: "project settings", dirty: settings.dirty, save: settings.save, discard: settings.discard },
    { label: "feature flags", dirty: features.dirty, save: features.save, discard: features.discard },
  ];

  const dirty = parts.some((p) => p.dirty);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // One at a time: project settings and feature flags both rewrite the
      // project config file, which has no locking, so parallel writes could
      // lose one. Each part saves independently of the others' outcome, and a
      // clean part resolves true without a request.
      const failed: string[] = [];
      for (const part of parts) {
        if (!(await part.save())) failed.push(part.label);
      }
      if (failed.length > 0) {
        setError(`Not saved: ${failed.join(", ")} — see the error in that section.`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    for (const part of parts) part.discard();
    setError(null);
  };

  return h(SettingsFrame, {
    dirty,
    saving,
    error,
    onSave: handleSave,
    onDiscard: handleDiscard,
  },
    h("div", { class: "project-container" },
      h("div", { class: "project-header" },
        h("div", { class: "project-header-brand" },
          h(PixelIcon, { name: "project", variant: "tile", size: 40, class: "project-header-tile" }),
          h("h1", { class: "project-header-title" }, "Project"),
        ),
        h("p", { class: "project-header-subtitle" },
          "What belongs to this project: language and zone analysis for ",
          h("code", null, `${cliName} analyze`),
          " and ",
          h("code", null, `${cliName} plan`),
          ", the dashboard port and feature flags.",
        ),
      ),

      h(Section, { id: "settings", title: "Analyze and plan" },
        h(ProjectSettingsSection, { form: settings }),
      ),

      h(Section, { id: "features", title: "Feature flags" },
        h("p", { class: "project-section-note" },
          "Flags take effect when you save. They apply without restarting the server.",
        ),
        h(FeatureTogglesSection, { form: features }),
      ),
    ),
  );
}

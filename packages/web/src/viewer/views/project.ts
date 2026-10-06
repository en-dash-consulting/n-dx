/**
 * Project — the settings page for what belongs to the project rather than to a
 * command: analyze and plan settings, feature flags, and the Notion and
 * integration connections. One SettingsFrame for all of it.
 *
 * Exactly one frame for the whole page: the leave guard holds a single
 * module-level registration, and unmounting any frame clears it, so a frame
 * per section would let one section disarm another's guard.
 *
 * The page is dirty when any section differs from its saved values. Save
 * writes each dirty section to its own endpoint (PUT /api/project-settings,
 * /api/features, /api/notion/config, /api/integrations/<id>/config). A section
 * that saves becomes clean; one whose write fails stays dirty, and the frame
 * names it. Discard restores every section.
 *
 * Notion and Integrations appear only while `rex.notionSync` / `rex.integrations`
 * is on, as their settings entries did. Their immediate actions (test, sync,
 * disconnect, remove) stay buttons inside the section and are not part of the
 * dirty model. The export and refresh panels live on the Commands page.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { PixelIcon, SettingsFrame } from "../components/index.js";
import { useCliName, useFeatureToggle } from "../hooks/index.js";
import { ProjectSettingsSection, useProjectSettingsForm } from "./project-settings.js";
import { FeatureTogglesSection, useFeatureTogglesForm } from "./feature-toggles.js";
import { NotionSection, useNotionForm } from "./notion-config.js";
import { IntegrationsSection, useIntegrationsForm } from "./integration-config.js";

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
  const notionOn = useFeatureToggle("rex.notionSync", false);
  const integrationsOn = useFeatureToggle("rex.integrations", false);

  const settings = useProjectSettingsForm();
  const features = useFeatureTogglesForm();
  const notion = useNotionForm(notionOn);
  const integrations = useIntegrationsForm(integrationsOn);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A section that is not shown cannot be dirty (its form is told it is
  // disabled), so listing it here never holds the page dirty.
  const parts: SettingsPart[] = [
    { label: "project settings", dirty: settings.dirty, save: settings.save, discard: settings.discard },
    { label: "feature flags", dirty: features.dirty, save: features.save, discard: features.discard },
    { label: "Notion", dirty: notion.dirty, save: notion.save, discard: notion.discard },
    { label: "integrations", dirty: integrations.dirty, save: integrations.save, discard: integrations.discard },
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
          ", the dashboard port, feature flags and the services the PRD syncs with.",
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

      notionOn
        ? h(Section, { id: "notion", title: "Notion" },
            h(NotionSection, { form: notion }),
          )
        : null,

      integrationsOn
        ? h(Section, { id: "integrations", title: "Integrations" },
            h(IntegrationsSection, { form: integrations }),
          )
        : null,
    ),
  );
}

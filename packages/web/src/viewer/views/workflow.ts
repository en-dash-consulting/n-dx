/**
 * Workflow — the settings page for how agent runs behave: work settings,
 * CLI timeouts and templates, on one shared SettingsFrame.
 *
 * Exactly one frame for the whole page: the leave guard holds a single
 * module-level registration, and unmounting any frame clears it, so a frame
 * per section would let one section disarm another's guard.
 *
 * The page is dirty when either form has unsaved edits. Save writes each dirty
 * part to its own endpoint (PUT /api/hench/config, PUT /api/cli/timeouts); a
 * part that saves becomes clean, and a part whose write fails stays dirty with
 * its error shown in its section. Templates are immediate actions outside that
 * model, disabled while the page is dirty; applying one reloads the work
 * settings so the form shows what was written.
 *
 * Provider and model are not edited here — Robot Wrangler owns them, and the
 * work-settings section links there in their place.
 */

import { h } from "preact";
import { useCallback, useState } from "preact/hooks";
import { NdxLogoPng, SettingsFrame } from "../components/index.js";
import { useCliName } from "../hooks/index.js";
import type { NavigateTo } from "../types.js";
import { HenchConfigSection, useHenchConfigForm } from "./hench-config.js";
import { CliTimeoutsSection, useCliTimeoutsForm } from "./cli-timeout.js";
import { HenchTemplatesSection } from "./hench-templates.js";

export function WorkflowView({ navigateTo }: { navigateTo: NavigateTo }) {
  const cliName = useCliName();
  const work = useHenchConfigForm();
  const timeouts = useCliTimeoutsForm();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = work.dirty || timeouts.dirty;
  const saveWork = work.save;
  const saveTimeouts = timeouts.save;
  const discardWork = work.discard;
  const discardTimeouts = timeouts.discard;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Each `save` is a no-op that resolves true when its part is clean, so
      // only the dirty parts are written. They write different files, so
      // neither waits on the other.
      const [workSaved, timeoutsSaved] = await Promise.all([saveWork(), saveTimeouts()]);
      const failed = [
        workSaved ? null : "work settings",
        timeoutsSaved ? null : "CLI timeouts",
      ].filter((part): part is string => part !== null);
      if (failed.length > 0) {
        setError(`Not saved: ${failed.join(" and ")} — see the error in that section.`);
      }
    } finally {
      setSaving(false);
    }
  }, [saveWork, saveTimeouts]);

  const handleDiscard = useCallback(() => {
    discardWork();
    discardTimeouts();
    setError(null);
  }, [discardWork, discardTimeouts]);

  const robotWranglerLink = h("p", { class: "workflow-wrangler-link" },
    "Provider and model are set on ",
    h("button", {
      type: "button",
      class: "link-btn",
      onClick: () => navigateTo("robot-wrangler"),
    }, "Robot Wrangler"),
    ".",
  );

  return h(SettingsFrame, {
    dirty,
    saving,
    error,
    onSave: handleSave,
    onDiscard: handleDiscard,
  },
    h("div", { class: "workflow-container" },
      h("div", { class: "workflow-header" },
        h("div", { class: "workflow-header-brand" },
          h(NdxLogoPng, { size: 16, class: "workflow-header-logo" }),
          h("h1", { class: "workflow-header-title" }, "Workflow"),
        ),
        h("p", { class: "workflow-header-subtitle" },
          "How ",
          h("code", null, `${cliName} work`),
          " runs, how long each command may take, and the templates that set both at once.",
        ),
      ),

      h("section", { class: "workflow-section", "aria-labelledby": "workflow-work-title" },
        h("h2", { id: "workflow-work-title", class: "workflow-section-title" }, "Work settings"),
        h(HenchConfigSection, { form: work, robotWranglerLink }),
      ),

      h("section", { class: "workflow-section", "aria-labelledby": "workflow-timeouts-title" },
        h("h2", { id: "workflow-timeouts-title", class: "workflow-section-title" }, "CLI timeouts"),
        h(CliTimeoutsSection, { form: timeouts }),
      ),

      h("section", { class: "workflow-section", "aria-labelledby": "workflow-templates-title" },
        h("h2", { id: "workflow-templates-title", class: "workflow-section-title" }, "Templates"),
        h(HenchTemplatesSection, { blocked: dirty, onApplied: work.reload }),
      ),
    ),
  );
}

/**
 * Project — the settings page for what belongs to the project rather than to a
 * command, grouped by what you are changing: Analysis, Dashboard, Git and
 * commits, Display, Optional features and Connections. Every setting is one
 * row (`setting-row.ts`); the sections are listed in the Settings overlay's
 * nav, and a search box filters the rows by label, description or config key.
 *
 * Exactly one frame for the whole page: the leave guard holds a single
 * module-level registration, and unmounting any frame clears it, so a frame
 * per section would let one section disarm another's guard.
 *
 * The page is dirty when any form differs from its saved values. Save writes
 * each dirty form to its own endpoint (PUT /api/project-settings,
 * /api/features, /api/sidecar/settings). A form that saves becomes clean; one
 * whose write fails stays dirty, and the frame names it. Discard restores
 * every form.
 *
 * The export and refresh panels live on the Commands page.
 */

import { h } from "preact";
import { useState } from "preact/hooks";
import { PixelIcon, SettingsFrame, settingsSectionAnchor, useSettingsSections } from "../components/index.js";
import { useCliName, useFeatureToggle } from "../hooks/index.js";
import { projectSettingRows, useProjectSettingsForm } from "./project-settings.js";
import { featureToggleRows, useFeatureTogglesForm } from "./feature-toggles.js";
import { githubReadsRows, useGithubReadsForm } from "./github-reads.js";
import { ConnectionsSection } from "./connections.js";
import { PROJECT_SECTIONS, type ProjectSectionId } from "./project-sections.js";
import { SettingRow, matchesQuery, type SettingRowSpec } from "./setting-row.js";

/** What the page needs from one form. */
interface SettingsPart {
  /** Named in the frame's error when this part fails to save. */
  label: string;
  dirty: boolean;
  /** Resolves true when saved or already clean; false leaves the part dirty. */
  save: () => Promise<boolean>;
  discard: () => void;
}

const SERVERS_KEY = "connections";
const SERVERS_LABEL = "MCP servers";
const SERVERS_DESC = "Servers the Sidecar can call: sign in, test, see their tools, and set tracker sync rules. Saved as you change them.";

/** The connected MCP servers, a row whose body is the whole Connections editor. */
function serversRow(): SettingRowSpec<ProjectSectionId> {
  return {
    section: "connections",
    configKey: SERVERS_KEY,
    searchText: `${SERVERS_LABEL} ${SERVERS_DESC} ${SERVERS_KEY} connection sign in tracker sync`,
    node: h(SettingRow, { key: SERVERS_KEY, configKey: SERVERS_KEY, label: SERVERS_LABEL, description: SERVERS_DESC },
      h(ConnectionsSection, null)),
  };
}

export function ProjectView() {
  const cliName = useCliName();
  const sidecarOn = useFeatureToggle("web.sidecar", false);

  const settings = useProjectSettingsForm();
  const features = useFeatureTogglesForm();
  const githubReads = useGithubReadsForm(sidecarOn);

  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GitHub reads saves before the flags: its route answers only while the
  // Sidecar is on, and the same Save may be turning the Sidecar off.
  const parts: SettingsPart[] = [
    { label: "project settings", dirty: settings.dirty, save: settings.save, discard: settings.discard },
    { label: "GitHub reads", dirty: githubReads.dirty, save: githubReads.save, discard: githubReads.discard },
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
        setError(`Not saved: ${failed.join(", ")} — see the error above.`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    for (const part of parts) part.discard();
    setError(null);
  };

  // Read-only rows (the server editor) save on their own and never make the page dirty.
  // Only the Sidecar uses connections and GitHub reads.
  const rows: SettingRowSpec<ProjectSectionId>[] = [
    ...projectSettingRows(settings, cliName),
    ...featureToggleRows(features),
    ...(sidecarOn ? [...githubReadsRows(githubReads), serversRow()] : []),
  ];
  // A row matches on its own text or its section title: "commit" finds Git and commits.
  // Every row stays mounted; a search hides the ones it leaves out, so an open
  // editor or a half-filled form keeps its state when the search is cleared.
  const sections = PROJECT_SECTIONS.map((s) => {
    const inSection = rows
      .filter((r) => r.section === s.id)
      .map((r) => ({ ...r, shown: matchesQuery(`${s.title} ${r.searchText}`, query) }));
    return { ...s, rows: inSection, shown: inSection.some((r) => r.shown) };
  }).filter((s) => s.rows.length > 0);
  const shownSections = sections.filter((s) => s.shown);
  const shownCount = shownSections.reduce((n, s) => n + s.rows.filter((r) => r.shown).length, 0);

  useSettingsSections(shownSections.map(({ id, title }) => ({ id, title })));

  const loading = settings.loading || features.loading;
  // Each names its form: two failures can share a message ("Failed to fetch").
  const problems = [
    ["project-load", "Project settings", settings.loadError && !settings.data ? settings.loadError : null],
    ["flags-load", "Feature flags", features.loadError && features.toggles.length === 0 ? features.loadError : null],
    ["github-load", "GitHub reads", githubReads.loadError],
    ["project-save", "Project settings", settings.saveError],
    ["flags-save", "Feature flags", features.saveError],
    ["github-save", "GitHub reads", githubReads.saveError],
  ].filter((p): p is [string, string, string] => p[2] !== null);

  const searching = query.trim() !== "";

  return h(SettingsFrame, {
    dirty,
    saving,
    error,
    onSave: handleSave,
    onDiscard: handleDiscard,
  },
    // Inert while saving: an edit made mid-save would be cleared by the save's
    // own "now clean" step without ever being written.
    h("div", { class: "project-container", inert: saving, "aria-busy": saving ? "true" : undefined },
      h("div", { class: "project-header" },
        h("div", { class: "project-header-brand" },
          h(PixelIcon, { name: "project", variant: "tile", size: 40, class: "project-header-tile" }),
          h("h1", { class: "project-header-title" }, "Project"),
        ),
        h("p", { class: "project-header-subtitle" },
          "What belongs to this project rather than to one command, grouped by what it changes. ",
          "Each row names the config key it is stored under, the same key ",
          h("code", null, `${cliName} config`),
          " takes.",
        ),
      ),

      h("div", { class: "project-search" },
        h("input", {
          type: "search",
          id: "project-search",
          class: "project-search-input",
          value: query,
          placeholder: "Search: a name, a word, or a config key",
          "aria-label": "Search Project settings",
          "aria-controls": "project-sections",
          onInput: (e: Event) => setQuery((e.target as HTMLInputElement).value),
          // Escape clears a search; only an empty box lets it close Settings.
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Escape" && query !== "") {
              e.stopPropagation();
              setQuery("");
            }
          },
        }),
        h("p", { class: "project-search-status", role: "status" },
          searching && !loading
            ? (shownCount === 0 ? `No settings match “${query.trim()}”.` : `${shownCount} matching`)
            : ""),
      ),

      ...problems.map(([key, form, message]) => h("div", { key, class: "project-alert", role: "alert" }, `${form}: ${message}`)),

      loading ? h("div", { class: "loading" }, "Loading settings…") : null,

      h("div", { id: "project-sections" },
        sections.map((s) =>
          h("section", {
            key: s.id,
            id: settingsSectionAnchor(s.id),
            class: "project-section",
            hidden: !s.shown,
            "aria-labelledby": `project-${s.id}-title`,
          },
            h("h2", { id: `project-${s.id}-title`, class: "project-section-title", tabIndex: -1 }, s.title),
            h("div", { class: "srow-list" },
              s.rows.map((r) => h("div", { key: r.configKey, class: "srow-slot", hidden: !r.shown }, r.node))),
          )),
      ),
    ),
  );
}

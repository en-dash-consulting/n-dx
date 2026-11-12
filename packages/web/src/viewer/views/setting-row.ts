/**
 * One setting on one line: its label, a one-line description, the config key
 * it writes and its control, with short tags beside the label. Cost and
 * impact sit behind an info button, a dot marks a value changed and not yet
 * saved, and Reset puts the default back for the page's Save to write.
 *
 * Settings › Project is the only page built from these rows. Workflow and
 * Robot Wrangler are meant to adopt them next; move this file to
 * `components/` when the second page does.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

/** A short tag shown beside the label. */
export type SettingTag = "Experimental" | "Deprecated" | "Tokens" | "Restart";

export interface SettingRowProps {
  /** The key the setting is stored under, as `.n-dx.json` and `ndx config` name it. */
  configKey: string;
  label: string;
  description: ComponentChildren;
  tags?: readonly SettingTag[];
  /** Cost and impact, revealed by the info button. Omit for no button. */
  info?: ComponentChildren;
  /** The edited value differs from the saved one. */
  unsaved?: boolean;
  /** Present while the edited value differs from the default. */
  onReset?: () => void;
  /** The control's id, so the label names it. Omit when the control labels itself. */
  controlId?: string;
  /** The control, beside the text. */
  control?: ComponentChildren;
  /** A full-width body below the text: a validation message, or an editor the row opens. */
  children?: ComponentChildren;
}

const idPart = (key: string) => key.replace(/[^a-zA-Z0-9]/g, "-");

export function SettingRow({ configKey, label, description, tags = [], info, unsaved = false, onReset, controlId, control, children }: SettingRowProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = `srow-info-${idPart(configKey)}`;

  return h("div", { class: `srow${unsaved ? " srow--unsaved" : ""}`, "data-key": configKey },
    h("div", { class: "srow-text" },
      h("div", { class: "srow-head" },
        controlId
          ? h("label", { class: "srow-label", htmlFor: controlId }, label)
          : h("span", { class: "srow-label" }, label),
        unsaved
          ? h("span", { class: "srow-dot", title: "Not saved yet" }, h("span", { class: "sr-only" }, "unsaved"))
          : null,
        ...tags.map((tag) => h("span", { key: tag, class: `srow-tag srow-tag--${tag.toLowerCase()}` }, tag)),
        info
          ? h("button", {
              type: "button",
              class: `srow-info${infoOpen ? " srow-info--open" : ""}`,
              onClick: () => setInfoOpen(!infoOpen),
              "aria-expanded": String(infoOpen),
              "aria-controls": infoId,
              "aria-label": `More about ${label}`,
              title: `More about ${label}`,
            }, "ⓘ")
          : null,
      ),
      h("p", { class: "srow-desc" }, description),
      h("code", { class: "srow-key" }, configKey),
      info && infoOpen ? h("div", { class: "srow-details", id: infoId }, info) : null,
    ),
    h("div", { class: "srow-control" },
      control,
      onReset
        ? h("button", { type: "button", class: "srow-reset", onClick: onReset, "aria-label": `Reset ${label} to its default` }, "Reset")
        : null,
    ),
    children ? h("div", { class: "srow-body" }, children) : null,
  );
}

/** An on/off switch. `label` is its accessible name. */
export function Switch({ checked, label, onChange }: { checked: boolean; label: string; onChange: (next: boolean) => void }) {
  return h("label", { class: "srow-switch" },
    h("input", {
      type: "checkbox",
      role: "switch",
      checked,
      onChange: () => onChange(!checked),
      "aria-label": label,
    }),
    h("span", { class: "srow-switch-slider", "aria-hidden": "true" }),
  );
}

/**
 * A row as the page lays it out: which section it belongs to, the text a
 * search matches against, and the row itself.
 */
export interface SettingRowSpec<Section extends string = string> {
  section: Section;
  /** Stable key for rendering; the config key. */
  configKey: string;
  /** Label, description and config key, as one string, for the page's search. */
  searchText: string;
  node: ComponentChildren;
}

/**
 * True when every word of `query` appears in `text`, ignoring case. An empty
 * query matches everything.
 */
export function matchesQuery(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}

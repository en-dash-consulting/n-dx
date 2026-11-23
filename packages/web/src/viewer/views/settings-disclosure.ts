/**
 * A Settings page whose content sits behind a dropdown: a header button that
 * expands it, and collapses it again (Workspaces). The choice is remembered
 * per page in the browser; the content mounts only while it is expanded, so a
 * collapsed page fetches nothing.
 *
 * @module viewer/views/settings-disclosure
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

const OPEN_KEY = "ndx.settings-disclosure";

function readOpen(id: string): boolean | null {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    const value = raw ? (JSON.parse(raw) as Record<string, boolean>)[id] : undefined;
    return typeof value === "boolean" ? value : null;
  } catch {
    return null;
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    all[id] = open;
    localStorage.setItem(OPEN_KEY, JSON.stringify(all));
  } catch { /* storage unavailable — the choice lasts for this page */ }
}

export interface SettingsDisclosureProps {
  /** Keys the remembered choice and the body's id. */
  id: string;
  title: string;
  blurb: string;
  /** Expanded when nothing is remembered. Default false. */
  defaultOpen?: boolean;
  children?: ComponentChildren;
}

export function SettingsDisclosure({ id, title, blurb, defaultOpen = false, children }: SettingsDisclosureProps) {
  const [open, setOpen] = useState<boolean>(() => readOpen(id) ?? defaultOpen);
  const bodyId = `settings-disclosure-${id}`;
  const toggle = () => {
    setOpen(!open);
    writeOpen(id, !open);
  };
  return h("section", { class: open ? "settings-disclosure settings-disclosure--open" : "settings-disclosure", "data-disclosure": id },
    h("button", {
      type: "button",
      class: "settings-disclosure-toggle",
      "aria-expanded": String(open),
      "aria-controls": bodyId,
      onClick: toggle,
    },
      h("span", { class: "settings-disclosure-caret", "aria-hidden": "true" }, open ? "▾" : "▸"),
      h("span", { class: "settings-disclosure-titles" },
        h("span", { class: "settings-disclosure-title" }, title),
        h("span", { class: "settings-disclosure-blurb" }, blurb),
      ),
    ),
    open ? h("div", { class: "settings-disclosure-body", id: bodyId }, children) : null,
  );
}

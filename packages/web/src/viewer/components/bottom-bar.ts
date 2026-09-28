/**
 * Bottom bar: which server this window is talking to, the settings cog beside
 * it, live status for each stage, the theme control, help, and the Commands
 * button on the right that lifts the commands sheet over the page.
 */

import { h } from "preact";
import type { ViewId } from "../api.js";
import {
  useProjectStatus,
  SvFreshnessIndicator,
  RexCompletionIndicator,
  HenchActivityIndicator,
} from "../api.js";
import { identityLine, identityTooltip, type ServerIdentity } from "./config-footer.js";
import { ThemeToggle } from "./theme-toggle.js";
import { GlobalFAQ } from "./faq.js";

export interface BottomBarProps {
  server?: ServerIdentity | null;
  onNavigate: (view: ViewId) => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  onToggleCommands: () => void;
  commandsOpen: boolean;
}

export function BottomBar({
  server = null,
  onNavigate,
  onOpenSettings,
  settingsOpen,
  onToggleCommands,
  commandsOpen,
}: BottomBarProps) {
  const status = useProjectStatus();

  return h("footer", { class: "bottombar", "aria-label": "Status and controls" },
    h("span", { class: "bottombar-server", title: server ? identityTooltip(server) : undefined },
      h("span", { class: `bottombar-dot${server ? "" : " bottombar-dot--off"}`, "aria-hidden": "true" }),
      server ? identityLine(server) : "n-dx",
    ),
    h("button", {
      type: "button",
      class: `bottombar-icon-btn bottombar-settings${settingsOpen ? " active" : ""}`,
      onClick: onOpenSettings,
      title: "Settings",
      "aria-label": "Settings",
      "aria-haspopup": "dialog",
      "aria-expanded": String(settingsOpen),
    }, "⚙"),

    h("div", { class: "bottombar-status", role: "group", "aria-label": "Project status" },
      status?.sv ? h(SvFreshnessIndicator, { status: status.sv, onNavigate, tabIndex: 0 }) : null,
      status?.rex ? h(RexCompletionIndicator, { status: status.rex, onNavigate, tabIndex: 0 }) : null,
      status?.hench ? h(HenchActivityIndicator, { status: status.hench, onNavigate, tabIndex: 0 }) : null,
    ),

    h("div", { class: "bottombar-controls" },
      h(ThemeToggle, null),
      h(GlobalFAQ, null),
      h("button", {
        type: "button",
        class: "bottombar-commands",
        onClick: onToggleCommands,
        "aria-expanded": String(commandsOpen),
        "aria-controls": "commands-sheet",
      },
        h("span", { class: "bottombar-commands-glyph", "aria-hidden": "true" }, "⌘"),
        "Commands",
        h("span", { class: "bottombar-commands-caret", "aria-hidden": "true" }, "▲"),
      ),
    ),
  );
}

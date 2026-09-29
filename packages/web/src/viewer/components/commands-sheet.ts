/**
 * The commands sheet: lifts from the bottom bar over the current page with
 * every command — run the ones the dashboard can run, read what the rest do.
 * Opening it is UI state, not a route: the page underneath does not change,
 * and the full reference still has its own page at `/command-reference`.
 */

import { h } from "preact";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";

export interface CommandsSheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * The command reference, rendered by the registry. Mounted only while open.
   * Optional in the type because `h()` passes children as its third argument.
   */
  children?: ComponentChildren;
}

export function CommandsSheet({ open, onClose, children }: CommandsSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return h("div", { class: `commands-sheet-layer${open ? " open" : ""}` },
    open ? h("div", { class: "commands-sheet-scrim", onClick: onClose, "aria-hidden": "true" }) : null,
    h("section", {
      class: `commands-sheet${open ? " open" : ""}`,
      id: "commands-sheet",
      role: "dialog",
      "aria-label": "Commands",
      "aria-hidden": open ? undefined : "true",
    },
      h("div", { class: "commands-sheet-head" },
        h("span", { class: "commands-sheet-title" }, "Commands"),
        h("span", { class: "commands-sheet-sub" }, "run a command or look one up"),
        h("button", {
          type: "button",
          class: "commands-sheet-close",
          onClick: onClose,
          "aria-label": "Close commands",
          title: "Close (Esc)",
        }, "✕"),
      ),
      h("div", { class: "commands-sheet-body" }, open ? children : null),
    ),
  );
}

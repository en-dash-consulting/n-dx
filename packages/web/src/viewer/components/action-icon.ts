/**
 * ActionIcon — the icon inside an icon-only action button (copy, close, more,
 * full-screen).
 *
 * Inline SVG, stroked in `currentColor`, sized by the `--icon-size` token
 * (styles/tokens.css). Unicode glyphs (`⎘`, `✕`, `⋯`) were sized by each
 * button's font-size and drawn by whatever font supplied them, so the same
 * action rendered at a few pixels in one place and full size in another.
 *
 * Decorative: the button carries the accessible name (`aria-label`), so the
 * icon is hidden from assistive technology.
 */

import { h } from "preact";

export type ActionIconName = "copy" | "check" | "close" | "more" | "expand";

/** 24×24 path data, drawn with a 2px round stroke. */
const PATHS: Record<ActionIconName, readonly string[]> = {
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  expand: ["M14 4h6v6", "M10 20H4v-6", "M20 4l-6 6", "M4 20l6-6"],
};

export function ActionIcon({ name, class: className }: { name: ActionIconName; class?: string }) {
  return h(
    "svg",
    {
      class: className ? `action-icon ${className}` : "action-icon",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": name === "more" ? 3 : 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true",
      focusable: "false",
    },
    PATHS[name].map((d) => h("path", { key: d, d })),
  );
}

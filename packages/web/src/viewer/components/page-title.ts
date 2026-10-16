/**
 * The title of a view's own page: its glyph, name and blurb from the
 * navigation model, the same strings the stage page and top bar use.
 *
 * The breadcrumb row's last segment used to be the only title a view's page
 * had (views' own `.view-header` blocks are hidden — they predate the shell
 * and disagree with each other). With the breadcrumb gone, the shell names
 * the page here. Stage pages have their own heading, Home is its own
 * landing, and the Live pages carry the Live bar, so those get none.
 */

import { h } from "preact";
import type { ViewId } from "../types.js";
import { VIEW_META, isStageId, isLiveView, viewBlurb, viewGlyph } from "../api.js";
import type { ViewMeta } from "../api.js";
import { useCliName, resolveCliLabel } from "../hooks/index.js";

export function PageTitle({ view }: { view: ViewId }) {
  const cliName = useCliName();
  // Looked up rather than asserted: a restored navigation state can name a
  // view a newer build removed (see project-context.ts).
  const meta = VIEW_META[view] as ViewMeta | undefined;
  if (!meta || view === "home" || isStageId(view) || isLiveView(view)) return null;
  return h("div", { class: "page-title" },
    h("span", { class: "page-title-glyph", "aria-hidden": "true" }, viewGlyph(view)),
    h("h1", { class: "page-title-text" }, resolveCliLabel(meta.label, cliName)),
    h("p", { class: "page-title-blurb" }, resolveCliLabel(viewBlurb(view), cliName)),
  );
}
